import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { captureLeadUseCase, updateLeadUseCase, type Actor } from '../../src/server/crm/leads/service';
import {
  createFollowUpUseCase,
  createLeadFollowUpUseCase,
  qualifyLeadUseCase,
  reassignOpportunityOwnerUseCase,
} from '../../src/server/crm/opportunities/service';
import { createQuotationUseCase, transitionQuotationUseCase } from '../../src/server/crm/quotations/service';
import {
  getNotificationsUseCase,
  markAllNotificationsReadUseCase,
  markNotificationReadUseCase,
} from '../../src/server/crm/notifications/service';
import type { NotificationEntry } from '../../src/server/crm/notifications/repository';
import { messagesFor } from '../../src/i18n/messages';
import { formatters } from '../../src/i18n/format';
import { isolate as i, notificationHref, notificationText } from '../../src/i18n/notification';
import { uniqueToken } from './setup/db';

/**
 * In-app notifications: who hears about what, row scope on the recipient,
 * marking read, and the live follow-up reminder.
 */
describe('notifications', () => {
  let database: DisposableDatabase;
  let client: Client;
  const repA: Actor = { userId: '', role: 'SALES_REP' };
  const repB: Actor = { userId: '', role: 'SALES_REP' };
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const admin: Actor = { userId: '', role: 'ADMIN' };
  let inactiveManagerId: string;

  async function mkUser(displayName: string, role: Actor['role']) {
    return (
      await createUser(client, {
        displayName,
        email: uniqueToken(displayName.replace(/\s/g, '.')) + '@test.com',
        password: 'Password123!',
        role,
      })
    ).id;
  }

  async function capture(actor: Actor, fullName: string, ownerUserId?: string) {
    const result = await captureLeadUseCase(
      actor,
      { fullName, email: uniqueToken('lead') + '@clinic.test', sourceCode: 'website', ownerUserId },
      client,
    );
    if (!result.ok) throw new Error(`capture failed: ${result.message}`);
    return result.leadId;
  }

  async function opportunityFor(owner: Actor, fullName: string) {
    const leadId = await capture(owner, fullName);
    const result = await qualifyLeadUseCase(owner, leadId, { estimatedValue: 50000 }, client);
    if (!result.ok) throw new Error(`qualify failed: ${result.message}`);
    return result.opportunity.id;
  }

  /** Who was told what about one record, as "kind recipient" pairs. */
  async function noticesAbout(column: 'lead_id' | 'opportunity_id' | 'followup_id' | 'quotation_id', id: string) {
    const { rows } = await client.query<{ kind: string; recipient_user_id: string }>(
      `SELECT kind, recipient_user_id FROM crm_notification WHERE ${column} = $1 ORDER BY kind, recipient_user_id`,
      [id],
    );
    return rows.map((row) => `${row.kind} ${row.recipient_user_id}`).sort();
  }

  async function entriesFor(actor: Actor): Promise<NotificationEntry[]> {
    return (await getNotificationsUseCase(actor.userId, client)).entries;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);
    repA.userId = await mkUser('Rep Alpha', 'SALES_REP');
    repB.userId = await mkUser('Rep Bravo', 'SALES_REP');
    manager.userId = await mkUser('Mona Manager', 'SALES_MANAGER');
    admin.userId = await mkUser('Adam Admin', 'ADMIN');
    inactiveManagerId = await mkUser('Gone Manager', 'SALES_MANAGER');
    await client.query(`UPDATE crm_user SET is_active = false WHERE id = $1`, [inactiveManagerId]);
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('new leads', () => {
    it('tells the active managers and admins when a rep enters a lead for themselves', async () => {
      const leadId = await capture(repA, 'Dr. Self Entered');
      expect(await noticesAbout('lead_id', leadId)).toEqual(
        [`LEAD_RECEIVED ${manager.userId}`, `LEAD_RECEIVED ${admin.userId}`].sort(),
      );
    });

    it('tells the owner the lead is theirs, and the other managers that it arrived', async () => {
      const leadId = await capture(manager, 'Dr. Handed Over', repB.userId);
      expect(await noticesAbout('lead_id', leadId)).toEqual(
        [`LEAD_ASSIGNED ${repB.userId}`, `LEAD_RECEIVED ${admin.userId}`].sort(),
      );
    });

    it('sends a manager who owns the new lead one notice, not two', async () => {
      const leadId = await capture(admin, 'Dr. For The Manager', manager.userId);
      expect(await noticesAbout('lead_id', leadId)).toEqual([`LEAD_ASSIGNED ${manager.userId}`]);
    });
  });

  describe('assignments', () => {
    it('tells the new owner when a lead is handed to them, and nobody when it stays', async () => {
      const leadId = await capture(repA, 'Dr. Moving Lead');
      await client.query(`DELETE FROM crm_notification WHERE lead_id = $1`, [leadId]);

      const unchanged = await updateLeadUseCase(manager, leadId, { ownerUserId: repA.userId }, client);
      expect(unchanged.ok).toBe(true);
      expect(await noticesAbout('lead_id', leadId)).toEqual([]);

      const moved = await updateLeadUseCase(manager, leadId, { ownerUserId: repB.userId }, client);
      expect(moved.ok).toBe(true);
      expect(await noticesAbout('lead_id', leadId)).toEqual([`LEAD_ASSIGNED ${repB.userId}`]);
    });

    it('tells the new owner when an opportunity is handed to them', async () => {
      const opportunityId = await opportunityFor(repA, 'Dr. Moving Deal');
      const result = await reassignOpportunityOwnerUseCase(manager, opportunityId, repB.userId, client);
      expect(result.ok).toBe(true);
      expect(await noticesAbout('opportunity_id', opportunityId)).toEqual([`OPPORTUNITY_ASSIGNED ${repB.userId}`]);
    });

    it('tells the assignee about a follow-up someone else gave them, but not about their own', async () => {
      const opportunityId = await opportunityFor(repA, 'Dr. Follow Up');
      const due = new Date(Date.now() + 2 * 86_400_000);

      const own = await createFollowUpUseCase(repA, opportunityId, { actionType: 'CALL', dueAt: due }, client);
      if (!own.ok) throw new Error(own.message);
      expect(await noticesAbout('followup_id', own.followUp.id)).toEqual([]);

      const given = await createFollowUpUseCase(
        manager,
        opportunityId,
        { actionType: 'MEETING', dueAt: due, ownerUserId: repA.userId },
        client,
      );
      if (!given.ok) throw new Error(given.message);
      expect(await noticesAbout('followup_id', given.followUp.id)).toEqual([`FOLLOW_UP_ASSIGNED ${repA.userId}`]);

      const leadId = await capture(repB, 'Dr. Lead Callback');
      const onLead = await createLeadFollowUpUseCase(
        manager,
        leadId,
        { actionType: 'CALL', dueAt: due, ownerUserId: repB.userId },
        client,
      );
      if (!onLead.ok) throw new Error(onLead.message);
      expect(await noticesAbout('followup_id', onLead.followUp.id)).toEqual([`FOLLOW_UP_ASSIGNED ${repB.userId}`]);
    });
  });

  describe('quotation results', () => {
    async function sentQuotation(opportunityId: string) {
      const created = await createQuotationUseCase(
        repA,
        opportunityId,
        { items: [{ description: 'Dental unit', quantity: 1, unitPrice: 90000 }] },
        client,
      );
      if (!created.ok) throw new Error(created.message);
      const sent = await transitionQuotationUseCase(repA, created.quotation.id, 'SENT', client);
      if (!sent.ok) throw new Error(sent.message);
      return created.quotation;
    }

    it('tells the deal owner when a manager records the customer accepted', async () => {
      const opportunityId = await opportunityFor(repA, 'Dr. Accepts');
      const quotation = await sentQuotation(opportunityId);
      // Sending is the owner's own step: nothing to tell.
      expect(await noticesAbout('quotation_id', quotation.id)).toEqual([]);

      const accepted = await transitionQuotationUseCase(manager, quotation.id, 'ACCEPTED', client);
      expect(accepted.ok).toBe(true);
      expect(await noticesAbout('quotation_id', quotation.id)).toEqual([`QUOTATION_ACCEPTED ${repA.userId}`]);
    });

    it('tells the deal owner about a rejection, and nobody when they record it themselves', async () => {
      const opportunityId = await opportunityFor(repA, 'Dr. Declines');
      const first = await sentQuotation(opportunityId);
      const rejected = await transitionQuotationUseCase(manager, first.id, 'REJECTED', client);
      expect(rejected.ok).toBe(true);
      expect(await noticesAbout('quotation_id', first.id)).toEqual([`QUOTATION_REJECTED ${repA.userId}`]);

      const managerOwned = await opportunityFor(manager, 'Dr. Manager Deal');
      const created = await createQuotationUseCase(
        manager,
        managerOwned,
        { items: [{ description: 'Scaler', quantity: 1, unitPrice: 9000 }] },
        client,
      );
      if (!created.ok) throw new Error(created.message);
      await transitionQuotationUseCase(manager, created.quotation.id, 'SENT', client);
      await transitionQuotationUseCase(manager, created.quotation.id, 'REJECTED', client);
      expect(await noticesAbout('quotation_id', created.quotation.id)).toEqual([]);
    });
  });

  describe('the bell', () => {
    it('shows a person only their own notifications, newest first, with the facts to word them', async () => {
      const recipient: Actor = { userId: await mkUser('Bell Rep', 'SALES_REP'), role: 'SALES_REP' };
      const leadId = await capture(manager, 'Dr. Bell Lead', recipient.userId);
      const opportunityId = await opportunityFor(repA, 'Dr. Bell Deal');
      await reassignOpportunityOwnerUseCase(manager, opportunityId, recipient.userId, client);

      const entries = await entriesFor(recipient);
      expect(entries.map((entry) => entry.kind)).toEqual(['OPPORTUNITY_ASSIGNED', 'LEAD_ASSIGNED']);
      expect(entries[1]).toMatchObject({
        actorName: 'Mona Manager',
        customerName: 'Dr. Bell Lead',
        leadId,
        readAt: null,
      });
      expect(entries[0]).toMatchObject({ customerName: 'Dr. Bell Deal', opportunityId });

      // Another person's bell holds none of these.
      const others = await entriesFor(repB);
      expect(others.some((entry) => entry.leadId === leadId || entry.opportunityId === opportunityId)).toBe(false);
    });

    it('marks one read only for its recipient, and all read at once', async () => {
      const recipient: Actor = { userId: await mkUser('Reader Rep', 'SALES_REP'), role: 'SALES_REP' };
      await capture(manager, 'Dr. Read One', recipient.userId);
      await capture(manager, 'Dr. Read Two', recipient.userId);
      const [newest] = await entriesFor(recipient);
      expect((await getNotificationsUseCase(recipient.userId, client)).unread).toBe(2);

      // Someone else's id matches nothing.
      await markNotificationReadUseCase(repB.userId, newest.id, client);
      expect((await getNotificationsUseCase(recipient.userId, client)).unread).toBe(2);

      await markNotificationReadUseCase(recipient.userId, newest.id, client);
      const afterOne = await getNotificationsUseCase(recipient.userId, client);
      expect(afterOne.unread).toBe(1);
      expect(afterOne.entries.find((entry) => entry.id === newest.id)?.readAt).toBeInstanceOf(Date);

      await markAllNotificationsReadUseCase(recipient.userId, client);
      expect((await getNotificationsUseCase(recipient.userId, client)).unread).toBe(0);
    });

    it('opens the deal a follow-up belongs to, and the quotation a result is about', async () => {
      const recipient: Actor = { userId: await mkUser('Link Rep', 'SALES_REP'), role: 'SALES_REP' };
      const opportunityId = await opportunityFor(recipient, 'Dr. Link Deal');
      const followUp = await createFollowUpUseCase(
        manager,
        opportunityId,
        { actionType: 'WHATSAPP', dueAt: new Date(Date.now() + 86_400_000), ownerUserId: recipient.userId },
        client,
      );
      if (!followUp.ok) throw new Error(followUp.message);

      const [entry] = await entriesFor(recipient);
      expect(entry).toMatchObject({
        kind: 'FOLLOW_UP_ASSIGNED',
        opportunityId,
        followUpActionType: 'WHATSAPP',
        customerName: 'Dr. Link Deal',
      });
      expect(notificationHref(entry)).toBe(`/crm/opportunities/${opportunityId}`);
    });

    it('counts the person’s own overdue and due-today follow-ups, live', async () => {
      const recipient: Actor = { userId: await mkUser('Late Rep', 'SALES_REP'), role: 'SALES_REP' };
      const opportunityId = await opportunityFor(recipient, 'Dr. Late Deal');
      const later = await createFollowUpUseCase(
        recipient,
        opportunityId,
        { actionType: 'CALL', dueAt: new Date(Date.now() + 5 * 86_400_000) },
        client,
      );
      if (!later.ok) throw new Error(later.message);
      expect((await getNotificationsUseCase(recipient.userId, client)).overdueFollowUps).toBe(0);

      // Its due time passes.
      await client.query(`UPDATE crm_followup SET due_at = now() - interval '1 hour' WHERE id = $1`, [later.followUp.id]);
      const payload = await getNotificationsUseCase(recipient.userId, client);
      expect(payload.overdueFollowUps).toBe(1);
      // A manager's reminder is their own work, not the team's.
      const managerCounts = await getNotificationsUseCase(manager.userId, client);
      expect(managerCounts.overdueFollowUps).toBe(0);
    });
  });

  describe('wording', () => {
    const base: NotificationEntry = {
      id: 'n-1',
      kind: 'LEAD_ASSIGNED',
      createdAt: new Date('2026-10-25T10:00:00Z'),
      readAt: null,
      actorName: 'Mona Manager',
      customerName: 'Smile Clinic',
      leadId: 'l-1',
      opportunityId: null,
      quotationId: null,
      quoteNumber: null,
      followUpActionType: null,
      followUpDueAt: null,
    };
    const ar = messagesFor('ar');
    const en = messagesFor('en');

    it('words every kind in both languages', () => {
      const entries: NotificationEntry[] = [
        { ...base, kind: 'LEAD_RECEIVED' },
        { ...base, kind: 'LEAD_ASSIGNED' },
        { ...base, kind: 'OPPORTUNITY_ASSIGNED', leadId: null, opportunityId: 'o-1' },
        {
          ...base,
          kind: 'FOLLOW_UP_ASSIGNED',
          opportunityId: 'o-1',
          leadId: null,
          followUpActionType: 'MEETING',
          followUpDueAt: new Date('2026-10-27T09:00:00Z'),
        },
        { ...base, kind: 'QUOTATION_ACCEPTED', quotationId: 'q-1', opportunityId: 'o-1', quoteNumber: 'Q-00007' },
        { ...base, kind: 'QUOTATION_REJECTED', quotationId: 'q-1', opportunityId: 'o-1', quoteNumber: 'Q-00007' },
        { ...base, kind: 'WHATSAPP_LEAD', actorName: null },
        { ...base, kind: 'WHATSAPP_MESSAGE', actorName: null, leadId: null, opportunityId: 'o-1' },
      ];
      // Names and quote numbers are isolated, so English inside Arabic keeps its place.
      const [mona, clinic, quote] = [i('Mona Manager'), i('Smile Clinic'), i('Q-00007')];
      const due = formatters('ar').dateTime(new Date('2026-10-27T09:00:00Z'));
      expect(entries.map((entry) => notificationText(entry, ar, formatters('ar')))).toEqual([
        `عميل محتمل جديد: ${clinic}، سجّله ${mona}`,
        `أسند إليك ${mona} العميل المحتمل ${clinic}`,
        `أسند إليك ${mona} الفرصة ${clinic}`,
        `أسند إليك ${mona} متابعة: اجتماع مع ${clinic}، موعدها ${due}`,
        `قُبل عرض السعر ${quote} لـ ${clinic}، وسجّله ${mona}`,
        `رُفض عرض السعر ${quote} لـ ${clinic}، وسجّله ${mona}`,
        `عميل محتمل جديد من واتساب: ${clinic}`,
        `رسالة واتساب جديدة من ${clinic}`,
      ]);
      for (const entry of entries) {
        expect(notificationText(entry, en, formatters('en'))).not.toMatch(/[؀-ۿ]/);
      }
      expect(entries.map(notificationHref)).toEqual([
        '/crm/leads/l-1',
        '/crm/leads/l-1',
        '/crm/opportunities/o-1',
        '/crm/opportunities/o-1',
        '/crm/quotations/q-1',
        '/crm/quotations/q-1',
        '/crm/leads/l-1',
        '/crm/opportunities/o-1',
      ]);
    });

    it('still reads when the person or the customer is unknown', () => {
      expect(notificationText({ ...base, actorName: null, customerName: null }, en, formatters('en'))).toBe(
        `${i('Someone')} gave you the lead ${i('a customer')}`,
      );
    });
  });
});
