import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser } from '../../src/server/users/repository';
import { createContact } from '../../src/server/crm/contacts/repository';
import { createLead, markLeadContacted } from '../../src/server/crm/leads/repository';
import {
  qualifyLeadUseCase,
  changeOpportunityStageUseCase,
  type Actor,
} from '../../src/server/crm/opportunities/service';
import { countFollowUpsByWindow, createFollowUp } from '../../src/server/crm/opportunities/followups';
import {
  createQuotationUseCase,
  transitionQuotationUseCase,
} from '../../src/server/crm/quotations/service';
import {
  getDashboardUseCase,
  getPipelineBoardUseCase,
  type DashboardInput,
} from '../../src/server/crm/dashboard/service';
import { uniqueToken } from './setup/db';

/**
 * Pipeline + Management Dashboard V1 analytics.
 *
 * Every case either pins a metric definition (which field, which boundary) or
 * proves a row-scope guarantee. Timestamps are moved with direct SQL so the
 * period metrics see deterministic instants.
 */
describe('pipeline + management dashboard', () => {
  let database: DisposableDatabase;
  let client: Client;

  let repAId: string;
  let repBId: string;
  let managerId: string;
  let contactId: string;
  let sourceWebsiteId: string;
  let sourcePhoneId: string;
  let reasonNoBudgetId: string;
  let reasonCheaperElsewhereId: string;

  const repA: Actor = { userId: '', role: 'SALES_REP' };
  const repB: Actor = { userId: '', role: 'SALES_REP' };
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };

  async function newLead(ownerUserId: string, status: 'NEW' | 'CONTACTED' = 'NEW'): Promise<string> {
    const lead = await createLead(client, {
      sourceId: sourceWebsiteId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId,
    });
    if (status === 'CONTACTED') {
      await markLeadContacted(client, lead.id, { userId: managerId, role: 'SALES_MANAGER' });
    }
    return lead.id;
  }

  async function newOpportunity(ownerUserId: string, sourceOverride?: string) {
    const lead = await createLead(client, {
      sourceId: sourceOverride ?? sourceWebsiteId,
      campaignId: null,
      contactId,
      accountId: null,
      productCategoryId: null,
      note: null,
      ownerUserId,
    });
    const result = await qualifyLeadUseCase(manager, lead.id, { estimatedValue: 100000 }, client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('setup failed');
    return result.opportunity;
  }

  async function advanceTo(opportunityId: string, toStage: string) {
    const path: Record<string, string[]> = {
      NEEDS_ANALYSIS: ['NEEDS_ANALYSIS'],
      PROPOSAL: ['NEEDS_ANALYSIS', 'PROPOSAL'],
      NEGOTIATION: ['NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION'],
      WON: ['NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'WON'],
      LOST: ['LOST'],
      ON_HOLD: ['ON_HOLD'],
    };
    for (const stage of path[toStage] ?? [toStage]) {
      const moved = await changeOpportunityStageUseCase(
        manager,
        opportunityId,
        { toStage: stage, lostReasonId: stage === 'LOST' ? reasonNoBudgetId : null },
        client,
      );
      expect(moved.ok).toBe(true);
    }
  }

  const sql = (fragment: string, params: unknown[] = []) => client.query(fragment, params);

  async function addOverdueLeadFollowUp(leadId: string, ownerUserId: string): Promise<void> {
    await sql(
      `INSERT INTO crm_followup (lead_id, owner_user_id, action_type, note, due_at)
       VALUES ($1, $2, 'CALL', NULL, now() - interval '1 day')`,
      [leadId, ownerUserId],
    );
  }

  /** Sends (and optionally accepts) a one-item quotation on an opportunity. */
  async function sendQuotation(opportunityId: string, accept = false): Promise<string> {
    const created = await createQuotationUseCase(
      manager,
      opportunityId,
      { items: [{ description: 'Unit', quantity: 1, unitPrice: 50000 }] },
      client,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('quotation setup failed');
    await transitionQuotationUseCase(manager, created.quotation.id, 'SENT', client);
    if (accept) {
      await transitionQuotationUseCase(manager, created.quotation.id, 'ACCEPTED', client);
    }
    return created.quotation.id;
  }

  // Every case starts from empty commercial data so aggregate assertions are
  // exact, not cumulative. Users, sources and reasons are shared reference data.
  beforeEach(async () => {
    await client.query(
      `TRUNCATE crm_lead, crm_opportunity, crm_followup, crm_quotation,
                 crm_quotation_item, crm_quotation_revision,
                 crm_opportunity_stage_history, crm_opportunity_activity CASCADE`,
    );
  });

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (displayName: string, role: Actor['role']) =>
      (
        await createUser(client, {
          displayName,
          email: uniqueToken(displayName) + '@test.com',
          password: 'Password123!',
          role,
        })
      ).id;

    repAId = await mkUser('Rep Alpha', 'SALES_REP');
    repBId = await mkUser('Rep Bravo', 'SALES_REP');
    managerId = await mkUser('Manager', 'SALES_MANAGER');
    repA.userId = repAId;
    repB.userId = repBId;
    manager.userId = managerId;

    contactId = (await createContact(client, { fullName: 'Dashboard Contact' })).id;

    const { rows: sources } = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM crm_source WHERE code IN ('website', 'phone')`,
    );
    sourceWebsiteId = sources.find((row) => row.code === 'website')!.id;
    sourcePhoneId = sources.find((row) => row.code === 'phone')!.id;

    const { rows: reasons } = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM crm_outcome_reason WHERE kind = 'lost' AND code IN ('no_budget', 'price_too_high')`,
    );
    reasonNoBudgetId = reasons.find((row) => row.code === 'no_budget')!.id;
    reasonCheaperElsewhereId = reasons.find((row) => row.code === 'price_too_high')!.id;
  });

  afterAll(async () => {
    await client.end();
    await dropDisposableDatabase(database);
  });

  describe('overview KPIs and date ranges', () => {
    it('counts new leads by lead.created_at with half-open boundaries', async () => {
      await newLead(repAId); // now -> inside every range
      await sql(`UPDATE crm_lead SET created_at = now() - interval '3 days' WHERE owner_user_id = $1`, [repAId]);
      const oldLeadId = await newLead(repAId);
      await sql(`UPDATE crm_lead SET created_at = now() - interval '10 days' WHERE id = $1`, [oldLeadId]);

      const last7 = await getDashboardUseCase(manager, { range: 'last7' }, client);
      const last30 = await getDashboardUseCase(manager, { range: 'last30' }, client);

      // Only the 3-day-old lead is inside last7; both are inside last30.
      expect(last7.overview.newLeads).toBe(1);
      expect(last30.overview.newLeads).toBe(2);
    });

    it('reports leads by current status as a snapshot', async () => {
      const contactedId = await newLead(repAId, 'CONTACTED');
      await sql(`UPDATE crm_lead SET created_at = now() - interval '20 days' WHERE id = $1`, [contactedId]);

      const payload = await getDashboardUseCase(manager, { range: 'last7' }, client);
      const statuses = Object.fromEntries(
        payload.overview.leadsByStatus.map((entry) => [entry.status, entry.count]),
      );
      // Snapshot: the 20-day-old contacted lead is outside the period but
      // still counted in the status breakdown.
      expect(statuses.CONTACTED).toBeGreaterThanOrEqual(1);
    });

    it('computes open opportunities and pipeline value as a snapshot of open stages', async () => {
      await newOpportunity(repAId);
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');

      const payload = await getDashboardUseCase(manager, { range: 'last7' }, client);
      // One open (100k), one won (excluded from the snapshot).
      expect(payload.overview.openOpportunities).toBe(1);
      expect(payload.overview.pipelineValue).toBe(100000);
    });

    it('counts won and lost by their outcome timestamps', async () => {
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');
      await sql(`UPDATE crm_opportunity SET won_at = now() - interval '3 days' WHERE id = $1`, [won.id]);

      const lost = await newOpportunity(repAId);
      await advanceTo(lost.id, 'LOST');
      await sql(`UPDATE crm_opportunity SET lost_at = now() - interval '10 days' WHERE id = $1`, [lost.id]);

      const last7 = await getDashboardUseCase(manager, { range: 'last7' }, client);
      const last30 = await getDashboardUseCase(manager, { range: 'last30' }, client);

      expect(last7.overview.wonCount).toBe(1);
      expect(last7.overview.wonValue).toBe(100000);
      expect(last7.overview.lostCount).toBe(0);
      expect(last30.overview.lostCount).toBe(1);
      expect(last30.overview.lostValue).toBe(100000);
    });

    it('excludes an outcome exactly at the range start (>= semantics)', async () => {
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');
      await sql(
        `UPDATE crm_opportunity SET won_at = now() - interval '7 days' - interval '1 minute' WHERE id = $1`,
        [won.id],
      );

      const payload = await getDashboardUseCase(manager, { range: 'last7' }, client);
      expect(payload.overview.wonCount).toBe(0);
    });

    it('counts overdue and due-today follow-ups as snapshots, excluding closed deals', async () => {
      const open = await newOpportunity(repAId);
      await createFollowUp(client, {
        opportunityId: open.id,
        ownerUserId: repAId,
        actionType: 'CALL',
        note: null,
        dueAt: new Date(Date.now() + 86_400_000),
        actorUserId: repAId,
      });
      await sql(`UPDATE crm_followup SET due_at = now() - interval '1 day' WHERE opportunity_id = $1`, [open.id]);

      const dueTodayId = (
        await client.query<{ id: string }>(
          `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, note, due_at)
           VALUES ($1, $2, 'CALL', NULL, LEAST(now() + interval '2 hours',
             date_trunc('day', now() + interval '1 day', 'Africa/Cairo') - interval '5 minutes'))
           RETURNING id`,
          [open.id, repAId],
        )
      ).rows[0].id;

      // A pending overdue follow-up on a WON deal must not nag anyone. The
      // domain refuses to schedule on closed deals, so this legacy row is
      // inserted directly.
      const closed = await newOpportunity(repAId);
      await advanceTo(closed.id, 'WON');
      await client.query(
        `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, note, due_at)
         VALUES ($1, $2, 'CALL', NULL, now() - interval '2 days')`,
        [closed.id, repAId],
      );

      const payload = await getDashboardUseCase(manager, { range: 'last7' }, client);
      expect(payload.overview.overdueFollowUps).toBe(1);
      expect(payload.overview.dueTodayFollowUps).toBe(1);
      expect(payload.overview.dueTodayFollowUps).toBeGreaterThan(0);
      void dueTodayId;
    });

    it('counts an open lead follow-up in overview and the lead owner’s performance row', async () => {
      const leadId = await newLead(repAId);
      // Assignment can differ from parent ownership. The team row uses the lead owner.
      await addOverdueLeadFollowUp(leadId, repBId);
      await sql(
        `INSERT INTO crm_followup (lead_id, owner_user_id, action_type, note, due_at, completed_at, created_at)
         VALUES ($1, $2, 'CALL', NULL, now() - interval '2 days', now() - interval '1 day', now() - interval '3 days')`,
        [leadId, repBId],
      );

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      expect(payload.overview.overdueFollowUps).toBe(1);
      expect(payload.repPerformance.find((row) => row.userId === repAId)).toMatchObject({
        overdueFollowUps: 1,
        completedFollowUps: 1,
      });
      expect(payload.repPerformance.find((row) => row.userId === repBId)?.overdueFollowUps).toBe(0);

      const ownerFiltered = await getDashboardUseCase(
        manager, { range: 'last30', ownerUserId: repAId }, client,
      );
      expect(ownerFiltered.overview.overdueFollowUps).toBe(1);
      const otherOwner = await getDashboardUseCase(
        manager, { range: 'last30', ownerUserId: repBId }, client,
      );
      expect(otherOwner.overview.overdueFollowUps).toBe(0);
    });

    it('excludes pending follow-ups on disqualified and archived leads', async () => {
      const openId = await newLead(repAId);
      const disqualifiedId = await newLead(repAId);
      const archivedId = await newLead(repAId);
      for (const leadId of [openId, disqualifiedId, archivedId]) {
        await addOverdueLeadFollowUp(leadId, repAId);
      }
      await sql(`UPDATE crm_lead SET status = 'DISQUALIFIED' WHERE id = $1`, [disqualifiedId]);
      await sql(
        `UPDATE crm_lead SET archived_at = now(), archived_by_user_id = $2 WHERE id = $1`,
        [archivedId, managerId],
      );

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      expect(payload.overview.overdueFollowUps).toBe(1);
      expect(payload.repPerformance.find((row) => row.userId === repAId)?.overdueFollowUps).toBe(1);
    });

    it('matches the Follow-ups overdue count for a rep and manager without filters', async () => {
      const leadId = await newLead(repAId);
      await addOverdueLeadFollowUp(leadId, repBId);
      const opportunity = await newOpportunity(repBId);
      await sql(
        `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, note, due_at)
         VALUES ($1, $2, 'CALL', NULL, now() - interval '1 day')`,
        [opportunity.id, repBId],
      );

      for (const actor of [repA, manager]) {
        const dashboard = await getDashboardUseCase(actor, { range: 'last30' }, client);
        const followUps = await countFollowUpsByWindow(client, actor);
        expect(dashboard.overview.overdueFollowUps).toBe(followUps.overdue);
      }
      expect((await countFollowUpsByWindow(client, repA)).overdue).toBe(1);
      expect((await countFollowUpsByWindow(client, manager)).overdue).toBe(2);
    });

    it('applies the source filter to lead follow-ups', async () => {
      const websiteLeadId = await newLead(repAId);
      const phoneLead = await createLead(client, {
        sourceId: sourcePhoneId,
        campaignId: null,
        contactId,
        accountId: null,
        productCategoryId: null,
        note: null,
        ownerUserId: repAId,
      });
      await addOverdueLeadFollowUp(websiteLeadId, repAId);
      await addOverdueLeadFollowUp(phoneLead.id, repAId);

      const website = await getDashboardUseCase(
        manager, { range: 'last30', sourceId: sourceWebsiteId }, client,
      );
      const phone = await getDashboardUseCase(
        manager, { range: 'last30', sourceId: sourcePhoneId }, client,
      );
      expect(website.overview.overdueFollowUps).toBe(1);
      expect(phone.overview.overdueFollowUps).toBe(1);
      expect(website.repPerformance.find((row) => row.userId === repAId)?.overdueFollowUps).toBe(1);
      expect(phone.repPerformance.find((row) => row.userId === repAId)?.overdueFollowUps).toBe(1);
    });

    it('counts quotation outcomes by their status timestamps', async () => {
      const opportunity = await newOpportunity(repAId);
      const created = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Unit', quantity: 1, unitPrice: 50000 }] },
        client,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await transitionQuotationUseCase(manager, created.quotation.id, 'SENT', client);
      await sql(`UPDATE crm_quotation SET sent_at = now() - interval '2 days' WHERE id = $1`, [created.quotation.id]);

      const accepted = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Unit', quantity: 1, unitPrice: 50000 }] },
        client,
      );
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;
      await transitionQuotationUseCase(manager, accepted.quotation.id, 'SENT', client);
      await transitionQuotationUseCase(manager, accepted.quotation.id, 'ACCEPTED', client);
      await sql(
        `UPDATE crm_quotation SET sent_at = now() - interval '12 days', accepted_at = now() - interval '12 days' WHERE id = $1`,
        [accepted.quotation.id],
      );

      const last7 = await getDashboardUseCase(manager, { range: 'last7' }, client);
      const last30 = await getDashboardUseCase(manager, { range: 'last30' }, client);

      expect(last7.overview.quotationsSent).toBe(1);
      expect(last7.overview.quotationsAccepted).toBe(0);
      expect(last30.overview.quotationsAccepted).toBe(1);
      expect(last30.overview.quotationsSent).toBe(2);
    });

    it('supports a custom Cairo-day range with exact midnight boundaries', async () => {
      const cairoDate = (offsetDays: number) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(
          new Date(Date.now() + offsetDays * 86_400_000),
        );
      const startDate = cairoDate(-2);
      const endDate = cairoDate(1);

      const includedId = await newLead(repAId);
      await sql(
        `UPDATE crm_lead SET created_at = ($1::date::timestamp AT TIME ZONE 'Africa/Cairo') WHERE id = $2`,
        [startDate, includedId],
      );
      const excludedId = await newLead(repAId);
      await sql(
        `UPDATE crm_lead SET created_at = (($1::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo') WHERE id = $2`,
        [endDate, excludedId],
      );

      const payload = await getDashboardUseCase(
        manager,
        { range: 'custom', startDate, endDate },
        client,
      );
      expect(payload.overview.newLeads).toBe(1);
    });
  });

  describe('row scope', () => {
    it('scopes every KPI aggregate to the rep', async () => {
      await newLead(repAId);
      await newLead(repBId);
      const oppA = await newOpportunity(repAId);
      const oppB = await newOpportunity(repBId);
      await sql(`UPDATE crm_opportunity SET estimated_value = 300000 WHERE id = $1`, [oppB.id]);

      const repAPayload = await getDashboardUseCase(repA, { range: 'last30' }, client);
      const repBPayload = await getDashboardUseCase(repB, { range: 'last30' }, client);
      const managerPayload = await getDashboardUseCase(manager, { range: 'last30' }, client);

      // Each rep: their plain lead plus the lead behind their opportunity.
      expect(repAPayload.overview.newLeads).toBe(2);
      expect(repBPayload.overview.newLeads).toBe(2);
      expect(managerPayload.overview.newLeads).toBe(4);
      expect(repAPayload.overview.openOpportunities).toBe(1);
      expect(repAPayload.overview.pipelineValue).toBe(100000);
      expect(repBPayload.overview.pipelineValue).toBe(300000);
      expect(managerPayload.overview.pipelineValue).toBe(400000);
      expect(repAPayload.overview.wonCount).toBe(0);
      expect(repAPayload.overview.lostCount).toBe(0);
      void oppA;
    });

    it('never leaks another rep through a manager-style owner filter', async () => {
      await newLead(repAId);
      await newLead(repBId);

      // A rep asking for repB's book gets their own scope, not repB's data.
      const sneaky = await getDashboardUseCase(
        repA,
        { range: 'last30', ownerUserId: repBId },
        client,
      );
      expect(sneaky.overview.newLeads).toBe(1);
    });

    it('limits the rep performance table to the rep themselves', async () => {
      await newLead(repAId);
      await newLead(repBId);

      const forRep = await getDashboardUseCase(repA, { range: 'last30' }, client);
      expect(forRep.repPerformance).toHaveLength(1);
      expect(forRep.repPerformance[0].userId).toBe(repAId);
      expect(forRep.repPerformance[0].activeLeads).toBe(1);

      const forManager = await getDashboardUseCase(manager, { range: 'last30' }, client);
      expect(forManager.repPerformance.map((row) => row.userId)).toContain(repAId);
      expect(forManager.repPerformance.map((row) => row.userId)).toContain(repBId);
    });

    it('scopes the pipeline board to the rep', async () => {
      const oppA = await newOpportunity(repAId);
      const oppB = await newOpportunity(repBId);

      const boardA = await getPipelineBoardUseCase(repA, {}, client);
      const boardB = await getPipelineBoardUseCase(repB, {}, client);
      const boardManager = await getPipelineBoardUseCase(manager, {}, client);

      expect(boardA.cards.map((card) => card.id)).toEqual([oppA.id]);
      expect(boardB.cards.map((card) => card.id)).toEqual([oppB.id]);
      expect(boardManager.cards).toHaveLength(2);
    });
  });

  describe('stage distribution and pipeline values', () => {
    it('zero-fills every stage and sums per-stage values', async () => {
      const proposal = await newOpportunity(repAId);
      await advanceTo(proposal.id, 'PROPOSAL');
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const byStage = Object.fromEntries(
        payload.stageDistribution.map((entry) => [entry.stage, entry]),
      );
      expect(byStage.PROPOSAL.count).toBe(1);
      expect(byStage.PROPOSAL.value).toBe(100000);
      expect(byStage.WON.count).toBe(1);
      expect(byStage.WON.value).toBe(100000);
      expect(byStage.QUALIFIED.count).toBe(0);
      expect(payload.stageDistribution).toHaveLength(7);
    });
  });

  describe('conversion funnel', () => {
    it('reports a nested Leads received -> Qualified -> Won funnel over the cohort', async () => {
      await newLead(repAId); // received only
      await newLead(repAId, 'CONTACTED'); // contacted, never qualified
      await newOpportunity(repAId); // qualified, not won
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const byKey = Object.fromEntries(payload.funnel.map((step) => [step.key, step.count]));

      expect(payload.funnel.map((step) => step.key)).toEqual(['leads', 'qualified', 'won']);
      expect(byKey.leads).toBe(4);
      expect(byKey.qualified).toBe(2);
      expect(byKey.won).toBe(1);
      // Step one is the very cohort the New Leads KPI counts.
      expect(byKey.leads).toBe(payload.overview.newLeads);
      // Nested by construction: a share can only fall down the funnel.
      expect(byKey.won).toBeLessThanOrEqual(byKey.qualified);
      expect(byKey.qualified).toBeLessThanOrEqual(byKey.leads);
    });

    it('never treats Contacted as a conversion milestone', async () => {
      const contacted = await newLead(repAId, 'CONTACTED');
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');
      const wonLeadId = (
        await client.query<{ lead_id: string }>(
          `SELECT lead_id FROM crm_opportunity WHERE id = $1`,
          [won.id],
        )
      ).rows[0].lead_id;

      // Adversarial: rewrite both labels straight through SQL. A status change
      // must never move a deal between steps - the funnel reads the opportunity
      // and the cohort, and lead status is a mutable annotation.
      await sql(`UPDATE crm_lead SET status = 'NEW' WHERE id = $1`, [contacted]);
      await sql(`UPDATE crm_lead SET status = 'DISQUALIFIED' WHERE id = $1`, [wonLeadId]);

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const byKey = Object.fromEntries(payload.funnel.map((step) => [step.key, step.count]));

      expect(payload.funnel).toHaveLength(3);
      expect(byKey.leads).toBe(2);
      expect(byKey.qualified).toBe(1);
      expect(byKey.won).toBe(1);
      // The label DID change - only the status panel reflects it.
      expect(
        payload.overview.leadsByStatus.find((entry) => entry.status === 'DISQUALIFIED')?.count,
      ).toBe(1);
    });

    it('keeps quotation conversion outside the funnel, because winning never required one', async () => {
      const wonWithoutQuote = await newOpportunity(repAId);
      await advanceTo(wonWithoutQuote.id, 'WON');

      const quotedAndAccepted = await newOpportunity(repAId);
      await sendQuotation(quotedAndAccepted.id, true); // decided, deal still open

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const funnel = Object.fromEntries(payload.funnel.map((step) => [step.key, step.count]));
      const quotes = Object.fromEntries(
        payload.quotationFunnel.map((step) => [step.key, step.count]),
      );

      // Quoting is not a step of the main ladder...
      expect(payload.funnel.map((step) => step.key)).toEqual(['leads', 'qualified', 'won']);
      expect(funnel.won).toBe(1);
      // ...and its own ladder is nested over the same cohort: the win with no
      // quotation proves the two are independent ladders.
      expect(payload.quotationFunnel.map((step) => step.key)).toEqual(['quoted', 'accepted']);
      expect(quotes.quoted).toBe(1);
      expect(quotes.accepted).toBe(1);
      expect(quotes.accepted).toBeLessThanOrEqual(quotes.quoted);
      expect(quotes.quoted).toBeLessThanOrEqual(funnel.qualified);
      expect(quotes.quoted).toBeLessThanOrEqual(funnel.leads);
    });

    it('single-counts a lead carrying an opportunity and several quotations', async () => {
      const everything = await newOpportunity(repAId);
      await sendQuotation(everything.id);
      await sendQuotation(everything.id, true);
      await advanceTo(everything.id, 'WON');

      const lost = await newOpportunity(repAId);
      await sendQuotation(lost.id);
      await advanceTo(lost.id, 'LOST');

      await newLead(repAId, 'CONTACTED');

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const funnel = Object.fromEntries(payload.funnel.map((step) => [step.key, step.count]));
      const quotes = Object.fromEntries(
        payload.quotationFunnel.map((step) => [step.key, step.count]),
      );

      // Two quotations on one opportunity and one lead with everything attached:
      // neither the lateral join nor the quotation aggregate may inflate a lead.
      expect(funnel).toEqual({ leads: 3, qualified: 2, won: 1 });
      expect(quotes).toEqual({ quoted: 2, accepted: 1 });
      expect(quotes.quoted).toBeLessThanOrEqual(funnel.qualified);
    });

    it('keeps cohort parity with the New Leads KPI even for archived leads', async () => {
      await newOpportunity(repAId);
      const plain = await newLead(repAId);
      await sql(`UPDATE crm_lead SET status = 'DISQUALIFIED' WHERE id = $1`, [plain]);
      // The disqualified lead is archived afterwards: the status panel drops it,
      // the cohort must not. Archive metadata must be written in one piece.
      await sql(
        `UPDATE crm_lead SET archived_at = now(), archived_by_user_id = $2 WHERE id = $1`,
        [plain, managerId],
      );

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const byKey = Object.fromEntries(payload.funnel.map((step) => [step.key, step.count]));

      // The cohort is "leads received in the period", exactly like the KPI.
      expect(byKey.leads).toBe(2);
      expect(byKey.leads).toBe(payload.overview.newLeads);
      expect(byKey.qualified).toBe(1);
      // Only the status panel excludes archived rows - documented difference.
      expect(
        payload.overview.leadsByStatus.find((entry) => entry.status === 'DISQUALIFIED')?.count,
      ).toBe(0);
    });
  });

  describe('lost reasons', () => {
    it('groups lost opportunities by structured reason with values', async () => {
      const lost1 = await newOpportunity(repAId);
      await sql(`UPDATE crm_opportunity SET estimated_value = 250000 WHERE id = $1`, [lost1.id]);
      await advanceTo(lost1.id, 'LOST');
      await sql(`UPDATE crm_opportunity SET lost_reason_id = $2 WHERE id = $1`, [lost1.id, reasonNoBudgetId]);

      const lost2 = await newOpportunity(repAId);
      await advanceTo(lost2.id, 'LOST');
      await sql(`UPDATE crm_opportunity SET lost_reason_id = $2 WHERE id = $1`, [lost2.id, reasonCheaperElsewhereId]);

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const byCode = Object.fromEntries(payload.lostReasons.map((entry) => [entry.code, entry]));

      expect(byCode.no_budget.count).toBe(1);
      expect(byCode.no_budget.lostValue).toBe(250000);
      expect(byCode.price_too_high.count).toBe(1);
      expect(byCode.price_too_high.lostValue).toBe(100000);
    });

    it('is empty when nothing was lost in the range', async () => {
      const payload = await getDashboardUseCase(repB, { range: 'last30' }, client);
      expect(payload.lostReasons).toEqual([]);
    });
  });

  describe('source breakdown', () => {
    it('attributes new leads and wins to their source without double counting', async () => {
      await newLead(repAId);
      const wonFromPhone = await newOpportunity(repAId, sourcePhoneId);
      await advanceTo(wonFromPhone.id, 'WON');

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const website = payload.sources.find((entry) => entry.id === sourceWebsiteId);
      const phone = payload.sources.find((entry) => entry.id === sourcePhoneId);

      expect(website?.leads).toBe(1);
      expect(website?.wins).toBe(0);
      expect(phone?.leads).toBe(1);
      expect(phone?.wins).toBe(1);
      expect(phone?.wonValue).toBe(100000);
    });
  });

  describe('sales rep performance', () => {
    it('computes factual per-rep operational metrics without double counting', async () => {
      await newLead(repAId);
      const opportunity = await newOpportunity(repAId);

      // Two follow-ups on the same opportunity: one overdue, one completed.
      await createFollowUp(client, {
        opportunityId: opportunity.id,
        ownerUserId: repAId,
        actionType: 'CALL',
        note: null,
        dueAt: new Date(Date.now() + 86_400_000),
        actorUserId: repAId,
      });
      await sql(`UPDATE crm_followup SET due_at = now() - interval '1 day' WHERE opportunity_id = $1`, [opportunity.id]);
      await client.query(
        `INSERT INTO crm_followup (opportunity_id, owner_user_id, action_type, note, due_at, completed_at, created_at)
         VALUES ($1, $2, 'CALL', NULL, now() - interval '3 days', now() - interval '1 day', now() - interval '4 days')`,
        [opportunity.id, repAId],
      );

      // Two quotations on the same opportunity, both sent.
      for (let i = 0; i < 2; i++) {
        const created = await createQuotationUseCase(
          manager,
          opportunity.id,
          { items: [{ description: 'Unit', quantity: 1, unitPrice: 50000 }] },
          client,
        );
        expect(created.ok).toBe(true);
        if (created.ok) await transitionQuotationUseCase(manager, created.quotation.id, 'SENT', client);
      }

      // One won deal.
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');

      const payload = await getDashboardUseCase(manager, { range: 'last30' }, client);
      const row = payload.repPerformance.find((entry) => entry.userId === repAId);
      expect(row).toBeDefined();

      // The 1:1 joins must not inflate the opportunity count or pipeline value.
      // Active leads: the plain lead + the opportunity's lead + the won lead.
      expect(row!.activeLeads).toBe(3);
      expect(row!.openOpportunities).toBe(1);
      expect(row!.pipelineValue).toBe(100000);
      expect(row!.overdueFollowUps).toBe(1);
      expect(row!.completedFollowUps).toBe(1);
      expect(row!.quotationsSent).toBe(2);
      expect(row!.wins).toBe(1);
      expect(row!.wonValue).toBe(100000);
      expect(row!.losses).toBe(0);
    });
  });

  describe('global source and owner filters', () => {
    it('scopes every metric to the source of the lead behind it', async () => {
      // website: a lost deal with a sent quotation.
      const lostWebsite = await newOpportunity(repAId, sourceWebsiteId);
      await sendQuotation(lostWebsite.id);
      await advanceTo(lostWebsite.id, 'LOST');

      // phone: a won deal whose quotation was accepted.
      const wonPhone = await newOpportunity(repAId, sourcePhoneId);
      await sendQuotation(wonPhone.id, true);
      await advanceTo(wonPhone.id, 'WON');

      const website = await getDashboardUseCase(
        manager,
        { range: 'last30', sourceId: sourceWebsiteId },
        client,
      );
      const phone = await getDashboardUseCase(
        manager,
        { range: 'last30', sourceId: sourcePhoneId },
        client,
      );

      // KPI cards.
      expect(website.overview).toMatchObject({
        newLeads: 1,
        wonCount: 0,
        wonValue: 0,
        lostCount: 1,
        quotationsSent: 1,
        quotationsAccepted: 0,
        openOpportunities: 0,
        pipelineValue: 0,
      });
      expect(phone.overview).toMatchObject({
        newLeads: 1,
        wonCount: 1,
        wonValue: 100000,
        lostCount: 0,
        quotationsSent: 1,
        quotationsAccepted: 1,
      });

      // Stage distribution.
      expect(website.stageDistribution.find((e) => e.stage === 'WON')?.count).toBe(0);
      expect(website.stageDistribution.find((e) => e.stage === 'LOST')?.count).toBe(1);
      expect(phone.stageDistribution.find((e) => e.stage === 'WON')?.count).toBe(1);
      expect(phone.stageDistribution.find((e) => e.stage === 'LOST')?.count).toBe(0);

      // Funnel and quotation ladder.
      const websiteFunnel = Object.fromEntries(
        website.funnel.map((step) => [step.key, step.count]),
      );
      const phoneFunnel = Object.fromEntries(phone.funnel.map((step) => [step.key, step.count]));
      const websiteQuotes = Object.fromEntries(
        website.quotationFunnel.map((step) => [step.key, step.count]),
      );
      const phoneQuotes = Object.fromEntries(
        phone.quotationFunnel.map((step) => [step.key, step.count]),
      );
      expect(websiteFunnel).toEqual({ leads: 1, qualified: 1, won: 0 });
      expect(phoneFunnel).toEqual({ leads: 1, qualified: 1, won: 1 });
      expect(websiteQuotes).toEqual({ quoted: 1, accepted: 0 });
      expect(phoneQuotes).toEqual({ quoted: 1, accepted: 1 });

      // Quotation outcomes panel.
      expect(website.quotationOutcomes).toEqual({ sent: 1, accepted: 0, rejected: 0 });
      expect(phone.quotationOutcomes).toEqual({ sent: 1, accepted: 1, rejected: 0 });

      // Lost reasons.
      expect(website.lostReasons.map((entry) => entry.code)).toEqual(['no_budget']);
      expect(phone.lostReasons).toEqual([]);

      // Rep metrics.
      const websiteRep = website.repPerformance.find((row) => row.userId === repAId);
      const phoneRep = phone.repPerformance.find((row) => row.userId === repAId);
      expect(websiteRep).toMatchObject({
        activeLeads: 1,
        newLeads: 1,
        losses: 1,
        wins: 0,
        quotationsSent: 1,
      });
      expect(phoneRep).toMatchObject({
        activeLeads: 1,
        newLeads: 1,
        wins: 1,
        wonValue: 100000,
        quotationsSent: 1,
      });

      // The source panel narrows to the selected source instead of contradicting it.
      expect(website.sources.map((entry) => entry.id)).toEqual([sourceWebsiteId]);
      expect(phone.sources.map((entry) => entry.id)).toEqual([sourcePhoneId]);

      // Pipeline board: cards and totals.
      const phoneBoard = await getPipelineBoardUseCase(
        manager,
        { sourceId: sourcePhoneId },
        client,
      );
      expect(phoneBoard.cards.map((card) => card.id)).toEqual([wonPhone.id]);
      expect(phoneBoard.totals.find((entry) => entry.stage === 'WON')?.count).toBe(1);
      expect(phoneBoard.totals.find((entry) => entry.stage === 'LOST')?.count).toBe(0);
    });

    it('scopes period outcomes, breakdowns and the rep table to one owner', async () => {
      const lostA = await newOpportunity(repAId);
      await sendQuotation(lostA.id);
      await advanceTo(lostA.id, 'LOST');

      const wonB = await newOpportunity(repBId);
      await sendQuotation(wonB.id, true);
      await advanceTo(wonB.id, 'WON');

      const forA = await getDashboardUseCase(
        manager,
        { range: 'last30', ownerUserId: repAId },
        client,
      );

      expect(forA.overview).toMatchObject({
        wonCount: 0,
        lostCount: 1,
        quotationsSent: 1,
        quotationsAccepted: 0,
      });
      expect(forA.quotationOutcomes).toEqual({ sent: 1, accepted: 0, rejected: 0 });
      expect(forA.lostReasons.map((entry) => entry.code)).toEqual(['no_budget']);
      expect(forA.stageDistribution.find((e) => e.stage === 'WON')?.count).toBe(0);
      expect(forA.stageDistribution.find((e) => e.stage === 'LOST')?.count).toBe(1);
      expect(forA.funnel.find((step) => step.key === 'won')?.count).toBe(0);
      expect(forA.repPerformance.map((row) => row.userId)).toEqual([repAId]);
      expect(forA.repPerformance[0]).toMatchObject({
        losses: 1,
        wins: 0,
        quotationsSent: 1,
      });

      const boardA = await getPipelineBoardUseCase(
        manager,
        { ownerUserId: repAId },
        client,
      );
      expect(boardA.cards.map((card) => card.id)).toEqual([lostA.id]);

      // And the rep still cannot borrow the manager's owner filter.
      const sneaky = await getDashboardUseCase(
        repA,
        { range: 'last30', ownerUserId: repBId, sourceId: sourceWebsiteId },
        client,
      );
      expect(sneaky.overview.wonCount).toBe(0);
      expect(sneaky.overview.lostCount).toBe(1);
    });

    it('ignores stage as a dashboard filter while the pipeline honours it', async () => {
      const proposal = await newOpportunity(repAId);
      await advanceTo(proposal.id, 'PROPOSAL');
      const won = await newOpportunity(repAId);
      await advanceTo(won.id, 'WON');

      // Stage is not part of DashboardInput: a stray payload field must not be
      // able to silently narrow half the dashboard.
      const input = { range: 'last30', stage: 'PROPOSAL' } as unknown as DashboardInput;
      const payload = await getDashboardUseCase(manager, input, client);
      const byStage = Object.fromEntries(
        payload.stageDistribution.map((entry) => [entry.stage, entry]),
      );
      expect(byStage.PROPOSAL.count).toBe(1);
      expect(byStage.WON.count).toBe(1);
      expect(payload.overview.openOpportunities).toBe(1);
      expect(payload.overview.wonCount).toBe(1);

      const board = await getPipelineBoardUseCase(manager, { stage: 'PROPOSAL' }, client);
      expect(board.cards.map((card) => card.id)).toEqual([proposal.id]);
      expect(board.totals.find((entry) => entry.stage === 'PROPOSAL')?.count).toBe(1);
      expect(board.totals.find((entry) => entry.stage === 'WON')?.count).toBe(0);

      // An unknown stage falls back to the whole board rather than an error.
      const bogus = await getPipelineBoardUseCase(manager, { stage: 'NOT_A_STAGE' }, client);
      expect(bogus.cards).toHaveLength(2);
    });
  });

  describe('zero-data behavior', () => {
    it('returns zeros and empty breakdowns, never errors', async () => {
      const payload = await getDashboardUseCase(repB, { range: 'last7' }, client);

      expect(payload.overview.newLeads).toBe(0);
      expect(payload.overview.openOpportunities).toBe(0);
      expect(payload.overview.pipelineValue).toBe(0);
      expect(payload.overview.overdueFollowUps).toBe(0);
      expect(payload.overview.wonCount).toBe(0);
      expect(payload.overview.quotationsSent).toBe(0);
      expect(payload.stageDistribution.every((entry) => entry.count === 0 && entry.value === 0)).toBe(true);
      expect(payload.funnel.every((step) => step.count === 0)).toBe(true);
      expect(payload.quotationFunnel.every((step) => step.count === 0)).toBe(true);
      expect(payload.repPerformance).toHaveLength(1);
      expect(payload.sources).toEqual([]);

      const board = await getPipelineBoardUseCase(repB, {}, client);
      expect(board.cards).toEqual([]);
      expect(board.totals.every((entry) => entry.count === 0)).toBe(true);
    });
  });

  describe('pipeline board', () => {
    it('attaches the next pending follow-up and the latest quotation to each card', async () => {
      const opportunity = await newOpportunity(repAId);
      await createFollowUp(client, {
        opportunityId: opportunity.id,
        ownerUserId: repAId,
        actionType: 'CALL',
        note: 'Call the doctor',
        dueAt: new Date(Date.now() + 86_400_000),
        actorUserId: repAId,
      });
      const created = await createQuotationUseCase(
        manager,
        opportunity.id,
        { items: [{ description: 'Unit', quantity: 1, unitPrice: 50000 }] },
        client,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const board = await getPipelineBoardUseCase(manager, {}, client);
      const card = board.cards.find((entry) => entry.id === opportunity.id);
      expect(card).toBeDefined();
      expect(card!.nextAction?.actionType).toBe('CALL');
      expect(card!.latestQuotation?.status).toBe('DRAFT');
      expect(card!.latestQuotation?.quoteNumber).toBe(created.quotation.quoteNumber);
      expect(card!.ownerName).toBe('Rep Alpha');
    });
  });
});
