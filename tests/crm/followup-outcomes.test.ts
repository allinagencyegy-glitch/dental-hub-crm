import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead } from '../../src/server/crm/leads/repository';
import {
  qualifyLeadUseCase,
  createFollowUpUseCase,
  createLeadFollowUpUseCase,
  completeFollowUpUseCase,
  listFollowUpsUseCase,
  listLeadFollowUpsUseCase,
  getOpportunityActivityUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import {
  FOLLOW_UP_OUTCOMES,
  NOT_REACHED_OUTCOMES,
  isFollowUpOutcome,
  isNotReached,
  notReachedAttempts,
  type FollowUpOutcome,
} from '../../src/server/crm/opportunities/followup-actions';
import { activityTitle } from '../../src/i18n/activity';
import { messagesFor } from '../../src/i18n/messages';
import { uniqueToken } from './setup/db';

/**
 * Call results V1: a completed follow-up records what happened, picked from a
 * fixed list, so the team's calls can be counted the way they are in the
 * old system ("no answer", "asking about prices", ...).
 */
describe('follow-up results', () => {
  let database: DisposableDatabase;
  let client: Client;
  const rep: Actor = { userId: '', role: 'SALES_REP' };
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  let contactId: string;
  let sourceId: string;

  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function newLead(): Promise<string> {
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId: rep.userId,
    });
    return lead.id;
  }

  async function leadFollowUp(leadId: string, note?: string) {
    const created = await createLeadFollowUpUseCase(
      rep,
      leadId,
      { actionType: 'CALL', dueAt: inDays(1), note: note ?? null },
      client,
    );
    if (!created.ok) throw new Error('setup failed');
    return created.followUp;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (displayName: string, role: Actor['role']) =>
      (
        await createUser(client, {
          displayName,
          email: uniqueToken(displayName.replace(/ /g, '.')) + '@test.com',
          password: 'Password123!',
          role,
        })
      ).id;
    rep.userId = await mkUser('Outcome Rep', 'SALES_REP');
    manager.userId = await mkUser('Outcome Manager', 'SALES_MANAGER');
    contactId = (await createContact(client, { fullName: 'Dr Outcome' })).id;
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM crm_source WHERE code = 'whatsapp'`);
    sourceId = rows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('completing with a result', () => {
    it('completes with a result alone, leaving the plan note as it was', async () => {
      const followUp = await leadFollowUp(await newLead(), 'Ask about the A1 Pro');

      const done = await completeFollowUpUseCase(rep, followUp.id, { outcome: 'NO_ANSWER' }, client);

      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.followUp.outcome).toBe('NO_ANSWER');
      expect(done.followUp.completedAt).not.toBeNull();
      expect(done.followUp.note).toBe('Ask about the A1 Pro');
    });

    it('keeps the result and the note together', async () => {
      const followUp = await leadFollowUp(await newLead());

      const done = await completeFollowUpUseCase(
        rep,
        followUp.id,
        { outcome: 'ASKING_PRICES', completionNote: 'Wants the instalment price of the E1' },
        client,
      );

      expect(done).toMatchObject({
        ok: true,
        followUp: { outcome: 'ASKING_PRICES', note: 'Wants the instalment price of the E1' },
      });
    });

    it('still accepts a note alone, as before results existed', async () => {
      const followUp = await leadFollowUp(await newLead());
      const done = await completeFollowUpUseCase(rep, followUp.id, { completionNote: 'Spoke briefly' }, client);
      expect(done).toMatchObject({ ok: true, followUp: { outcome: null } });
    });

    it('refuses an unknown result and leaves the follow-up pending', async () => {
      const followUp = await leadFollowUp(await newLead());

      const refused = await completeFollowUpUseCase(rep, followUp.id, { outcome: 'MAYBE' }, client);
      expect(refused).toMatchObject({ ok: false, error: 'VALIDATION' });

      const { rows } = await client.query<{ completed_at: Date | null }>(
        `SELECT completed_at FROM crm_followup WHERE id = $1`,
        [followUp.id],
      );
      expect(rows[0].completed_at).toBeNull();
    });

    it('lets the database refuse a result on a pending follow-up, or an unknown one', async () => {
      const followUp = await leadFollowUp(await newLead());
      await expect(
        client.query(`UPDATE crm_followup SET outcome = 'BUSY' WHERE id = $1`, [followUp.id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        client.query(`UPDATE crm_followup SET completed_at = now(), outcome = 'MAYBE' WHERE id = $1`, [followUp.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('reading results back', () => {
    it('shows the result in the lead history and the completed queue', async () => {
      const leadId = await newLead();
      const followUp = await leadFollowUp(leadId);
      await completeFollowUpUseCase(rep, followUp.id, { outcome: 'BUSY' }, client);

      const history = await listLeadFollowUpsUseCase(rep, leadId, client);
      expect(history.find((row) => row.id === followUp.id)?.outcome).toBe('BUSY');

      const queue = await listFollowUpsUseCase(rep, { window: 'completed', limit: 200 }, client);
      expect(queue.followUps.find((row) => row.id === followUp.id)?.outcome).toBe('BUSY');
    });

    it('names the result on the deal timeline, in Arabic and English', async () => {
      const qualified = await qualifyLeadUseCase(manager, await newLead(), {}, client);
      if (!qualified.ok) throw new Error('setup failed');
      const created = await createFollowUpUseCase(
        rep,
        qualified.opportunity.id,
        { actionType: 'CALL', dueAt: inDays(1) },
        client,
      );
      if (!created.ok) throw new Error('setup failed');
      await completeFollowUpUseCase(rep, created.followUp.id, { outcome: 'QUOTATION_REQUESTED' }, client);

      const activity = await getOpportunityActivityUseCase(rep, qualified.opportunity.id, client);
      const completion = activity.find((entry) => entry.activityType === 'FOLLOW_UP_COMPLETED');
      expect(completion?.metadata).toMatchObject({ outcome: 'QUOTATION_REQUESTED' });
      expect(activityTitle(completion!, messagesFor('ar'))).toBe('مكالمة: طلب عرض سعر');
      expect(activityTitle(completion!, messagesFor('en'))).toBe('Call completed: Asked for a quotation');
    });
  });

  describe('the vocabulary', () => {
    it('matches the list the database accepts', () => {
      const sql = readFileSync(path.resolve(process.cwd(), 'migrations/0015_crm_followup_outcomes.sql'), 'utf8');
      const list = /outcome IN \(([\s\S]*?)\)/.exec(sql)?.[1] ?? '';
      const codes = [...list.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
      expect(codes).toEqual([...FOLLOW_UP_OUTCOMES]);
      expect(isFollowUpOutcome('NO_ANSWER')).toBe(true);
      expect(isFollowUpOutcome('no_answer')).toBe(false);
    });

    it('has text for every result in both languages', () => {
      for (const m of [messagesFor('ar'), messagesFor('en')]) {
        expect(Object.keys(m.followUpOutcomes).sort()).toEqual([...FOLLOW_UP_OUTCOMES].sort());
      }
      expect(messagesFor('ar').followUpOutcomes.NO_ANSWER).toBe('لم يرد');
      expect(messagesFor('ar').followUp.attempt(3)).toBe('المحاولة 3');
    });

    it('treats only the unanswered results as "not reached"', () => {
      expect(NOT_REACHED_OUTCOMES).toEqual(['NO_ANSWER', 'BUSY', 'UNREACHABLE', 'MESSAGED_ON_WHATSAPP']);
      expect(isNotReached('BUSY')).toBe(true);
      expect(isNotReached('ASKING_PRICES')).toBe(false);
      expect(isNotReached(null)).toBe(false);
    });
  });

  describe('counting tries', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 9, minutes));
    const row = (id: string, outcome: FollowUpOutcome | null, minutes: number | null) => ({
      id,
      outcome,
      completedAt: minutes === null ? null : at(minutes),
    });

    it('numbers unanswered tries in completion order and starts again after a real conversation', () => {
      const attempts = notReachedAttempts([
        // Deliberately out of order: the count follows completion time.
        row('c', 'UNREACHABLE', 30),
        row('a', 'NO_ANSWER', 10),
        row('b', 'BUSY', 20),
        row('d', 'ASKING_PRICES', 40),
        row('e', 'NO_ANSWER', 50),
        row('pending', null, null),
      ]);
      expect(Object.fromEntries(attempts)).toEqual({ a: 1, b: 2, c: 3, e: 1 });
    });

    it('skips completions recorded before results existed', () => {
      const attempts = notReachedAttempts([row('a', 'NO_ANSWER', 10), row('old', null, 15), row('b', 'NO_ANSWER', 20)]);
      expect(Object.fromEntries(attempts)).toEqual({ a: 1, b: 2 });
    });
  });
});
