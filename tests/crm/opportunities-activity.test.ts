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
  changeOpportunityStageUseCase,
  updateOpportunityUseCase,
  reassignOpportunityOwnerUseCase,
  createFollowUpUseCase,
  completeFollowUpUseCase,
  rescheduleFollowUpUseCase,
  getOpportunityActivityUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import { uniqueToken } from './setup/db';

/**
 * The unified opportunity activity feed (Phase 4).
 *
 * crm_opportunity_activity (migration 0007) is the durable interaction log:
 * every qualification, stage move, follow-up event, owner change and notes
 * update lands there, and the timeline reads it back with actor names.
 */
describe('opportunity activity feed', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let managerId: string;
  let sourceId: string;

  const repA: Actor = { userId: '', role: 'SALES_REP' };
  const repB: Actor = { userId: '', role: 'SALES_REP' };
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };

  async function newOpportunity(ownerUserId = repAId) {
    const contact = await createContact(client, { fullName: uniqueToken('act-doc') });
    const lead = await createLead(client, {
      sourceId,
      campaignId: null,
      contactId: contact.id,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId,
    });
    const result = await qualifyLeadUseCase(manager, lead.id, {}, client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('setup failed');
    return result.opportunity;
  }

  async function advanceTo(opportunityId: string, toStage: 'PROPOSAL' | 'NEGOTIATION' | 'WON') {
    const result = await changeOpportunityStageUseCase(
      manager,
      opportunityId,
      { toStage },
      client,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('setup failed');
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    repAId = (
      await createUser(client, {
        displayName: 'Activity Rep Alpha',
        email: uniqueToken('act-a') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    repBId = (
      await createUser(client, {
        displayName: 'Activity Rep Bravo',
        email: uniqueToken('act-b') + '@test.com',
        password: 'Password123!',
        role: 'SALES_REP',
      })
    ).id;
    managerId = (
      await createUser(client, {
        displayName: 'Activity Manager',
        email: uniqueToken('act-m') + '@test.com',
        password: 'Password123!',
        role: 'SALES_MANAGER',
      })
    ).id;
    repA.userId = repAId;
    repB.userId = repBId;
    manager.userId = managerId;

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source WHERE code = 'website'`,
    );
    sourceId = rows[0].id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  it('records the qualification as the opening STAGE_CHANGE', async () => {
    const opportunity = await newOpportunity();
    const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);

    expect(activity.some((a) => a.activityType === 'STAGE_CHANGE' && a.description === 'Qualified into an opportunity')).toBe(true);
  });

  it('records stage moves with from and to in the description', async () => {
    const opportunity = await newOpportunity();
    await advanceTo(opportunity.id, 'PROPOSAL');

    const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
    const move = activity.find(
      (a) =>
        a.activityType === 'STAGE_CHANGE' &&
        a.metadata?.fromStage === 'QUALIFIED' &&
        a.metadata?.toStage === 'PROPOSAL',
    );
    expect(move).toBeDefined();
    expect(move?.description).toContain('Qualified → Proposal');
    expect(move?.actorName).toBe('Activity Manager');
  });

  it('records follow-up scheduling, rescheduling and completion with the follow-up id', async () => {
    const opportunity = await newOpportunity();
    const created = await createFollowUpUseCase(
      repA,
      opportunity.id,
      { actionType: 'CALL', dueAt: new Date(Date.now() + 3_600_000) },
      client,
    );
    if (!created.ok) throw new Error('setup failed');

    const rescheduled = await rescheduleFollowUpUseCase(
      repA,
      created.followUp.id,
      new Date(Date.now() + 7_200_000),
      client,
    );
    if (!rescheduled.ok) throw new Error('setup failed');

    const completed = await completeFollowUpUseCase(repA, created.followUp.id, {}, client);
    if (!completed.ok) throw new Error('setup failed');

    const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
    const createdEntry = activity.find((a) => a.activityType === 'FOLLOW_UP_CREATED');
    const rescheduledEntry = activity.find((a) => a.activityType === 'FOLLOW_UP_RESCHEDULED');
    const completedEntry = activity.find((a) => a.activityType === 'FOLLOW_UP_COMPLETED');

    expect(createdEntry?.metadata?.followUpId).toBe(created.followUp.id);
    expect(rescheduledEntry?.metadata?.followUpId).toBe(created.followUp.id);
    expect(completedEntry?.metadata?.followUpId).toBe(created.followUp.id);
  });

  it('records owner changes', async () => {
    const opportunity = await newOpportunity();
    const result = await reassignOpportunityOwnerUseCase(manager, opportunity.id, repBId, client);
    expect(result.ok).toBe(true);

    const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
    const ownerChange = activity.find((a) => a.activityType === 'OWNER_CHANGED');
    expect(ownerChange).toBeDefined();
    expect(ownerChange?.description).toBe('Owner changed to Activity Rep Bravo');
    expect(ownerChange?.metadata?.toOwnerUserId).toBe(repBId);
  });

  it('records a notes update but not a value-only edit', async () => {
    const opportunity = await newOpportunity();

    const valueOnly = await updateOpportunityUseCase(
      manager,
      opportunity.id,
      { estimatedValue: 25000 },
      client,
    );
    expect(valueOnly.ok).toBe(true);

    const notes = await updateOpportunityUseCase(
      manager,
      opportunity.id,
      { notes: 'Clinic is expanding to two more chairs.' },
      client,
    );
    expect(notes.ok).toBe(true);

    const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
    const noteEntries = activity.filter((a) => a.activityType === 'NOTE_ADDED');
    expect(noteEntries).toHaveLength(1);
    expect(noteEntries[0].metadata?.note).toBe('Clinic is expanding to two more chairs.');
  });

  it('hides the feed from an actor who cannot see the deal', async () => {
    const opportunity = await newOpportunity(repAId);
    const activity = await getOpportunityActivityUseCase(repB, opportunity.id, client);
    expect(activity).toEqual([]);
  });

  it('returns the feed newest first', async () => {
    const opportunity = await newOpportunity();
    await advanceTo(opportunity.id, 'PROPOSAL');
    const created = await createFollowUpUseCase(
      repA,
      opportunity.id,
      { actionType: 'MEETING', dueAt: new Date(Date.now() + 3_600_000) },
      client,
    );
    if (!created.ok) throw new Error('setup failed');

    const activity = await getOpportunityActivityUseCase(manager, opportunity.id, client);
    const timestamps = activity.map((a) => a.createdAt.getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});
