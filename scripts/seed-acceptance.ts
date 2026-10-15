/**
 * npm run db:seed:acceptance
 *
 * Creates idempotent development acceptance records in the LOCAL development
 * database only. Hard guards:
 *   - refuses under NODE_ENV=production;
 *   - refuses unless the target database is named exactly "dental_hub_crm"
 *     (the documented local dev database from .env.example).
 *
 * This script talks to the repositories directly, not the use-case layer:
 * the use-case layer pulls in `server-only`, which is a Next.js enforcement
 * that has no meaning in a standalone Node script.
 *
 * Records created (each marked with a stable note so re-running is a no-op):
 *   - one active lead (NEW)
 *   - one disqualified lead
 *   - one qualified lead -> open opportunity (QUALIFIED)
 *   - follow-ups on that opportunity: overdue, due today (UTC), upcoming
 *   - one active campaign on the facebook source (for campaign UI checks)
 *
 * Every record is synthetic. No production data is ever touched.
 */
import { Client } from 'pg';
import { loadEnv } from './load-env';
import { findUserByEmail } from '@/server/users/repository';
import { createSourceCampaign, findSourceByCode } from '@/server/crm/catalog/repository';
import {
  createLead,
  disqualifyLead,
  resolveOrCreateContact,
  resolvePrimaryAccount,
  type Lead,
} from '@/server/crm/leads/repository';
import {
  createOpportunity,
  recordStageChange,
} from '@/server/crm/opportunities/repository';
import { createFollowUp } from '@/server/crm/opportunities/followups';
import type { FollowUpActionType } from '@/server/crm/opportunities/followup-actions';
import {
  createQuotation,
  createRevision,
  transitionQuotation,
} from '@/server/crm/quotations/repository';
import type { QuotationStatus } from '@/server/crm/quotations/status';

loadEnv();

const DEV_DATABASE_NAME = 'dental_hub_crm';
type Actor = { userId: string; role: 'ADMIN' | 'SALES_MANAGER' | 'SALES_REP' };

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function pinDue(bucket: 'overdue' | 'today' | 'upcoming'): string {
  if (bucket === 'overdue') return `now() - interval '1 day'`;
  if (bucket === 'today') {
    // Inside the Cairo business day, mirroring the queue's boundary SQL.
    return `LEAST(now() + interval '2 hours', date_trunc('day', now() + interval '1 day', 'Africa/Cairo') - interval '5 minutes')`;
  }
  return `date_trunc('day', now() + interval '1 day', 'Africa/Cairo') + interval '2 hours'`;
}

async function captureLike(
  client: Client,
  actor: Actor,
  input: {
    fullName: string;
    phone: string;
    email: string;
    sourceCode: string;
    campaignCode?: string | null;
    productCategoryCode?: string | null;
    note: string;
    ownerUserId: string;
  },
): Promise<Lead> {
  const source = await findSourceByCode(client, input.sourceCode);
  if (!source) throw new Error(`Source ${input.sourceCode} not found.`);

  let campaignId: string | null = null;
  if (input.campaignCode) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_source_campaign WHERE source_id = $1 AND code = $2`,
      [source.id, input.campaignCode],
    );
    campaignId = rows[0]?.id ?? null;
  }

  let productCategoryId: string | null = null;
  if (input.productCategoryCode) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_product_category WHERE code = $1`,
      [input.productCategoryCode],
    );
    productCategoryId = rows[0]?.id ?? null;
  }

  const { contactId } = await resolveOrCreateContact(client, {
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
  });
  const accountId = await resolvePrimaryAccount(client, contactId);

  return createLead(client, {
    sourceId: source.id,
    campaignId,
    contactId,
    accountId,
    productCategoryId,
    note: input.note,
    ownerUserId: input.ownerUserId,
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed acceptance data: NODE_ENV is production.');
  }

  const connectionString = process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set it.');
  }

  const targetName = databaseNameOf(connectionString);
  if (targetName !== DEV_DATABASE_NAME) {
    throw new Error(
      `Refusing to seed acceptance data: target database "${targetName}" is not the local dev database "${DEV_DATABASE_NAME}".`,
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const manager = await findUserByEmail(client, 'manager@dentalhub.test');
    const rep = await findUserByEmail(client, 'rep@dentalhub.test');
    if (!manager || !rep) {
      throw new Error('Dev operators missing. Run `npm run db:seed` first.');
    }
    const actor: Actor = { userId: manager.id, role: 'SALES_MANAGER' };

    // 1. A campaign on facebook, so the capture form can show the positive path.
    const facebook = await findSourceByCode(client, 'facebook');
    if (!facebook) throw new Error('facebook source missing.');
    const { rows: campaignRows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM crm_source_campaign
        WHERE source_id = $1 AND code = 'acceptance_ramadan'`,
      [facebook.id],
    );
    if (campaignRows[0].count === '0') {
      await createSourceCampaign(client, {
        sourceId: facebook.id,
        code: 'acceptance_ramadan',
        name: 'Ramadan Offer 2026 (acceptance)',
      });
      console.log('  created   campaign facebook / acceptance_ramadan');
    } else {
      console.log('  exists    campaign facebook / acceptance_ramadan');
    }

    const { rows: reasonRows } = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM crm_outcome_reason WHERE kind = 'disqualify' AND is_active = true ORDER BY code ASC`,
    );
    if (reasonRows.length === 0) {
      throw new Error('No active disqualify reasons found.');
    }

    async function leadIdByNote(marker: string): Promise<string | null> {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM crm_lead WHERE note = $1 LIMIT 1`,
        [marker],
      );
      return rows[0]?.id ?? null;
    }

    // 2. Active lead (NEW).
    const activeMarker = '[acceptance] active lead';
    let activeLeadId = await leadIdByNote(activeMarker);
    if (!activeLeadId) {
      const lead = await captureLike(client, actor, {
        fullName: 'Acceptance Active Doctor',
        phone: '+201000001001',
        email: 'acceptance-active@dentalhub.test',
        sourceCode: 'website',
        productCategoryCode: 'dental_units',
        note: activeMarker,
        ownerUserId: rep.id,
      });
      activeLeadId = lead.id;
      console.log('  created   active lead', activeLeadId);
    } else {
      console.log('  exists    active lead', activeLeadId);
    }

    // 3. Disqualified lead.
    const disqualifiedMarker = '[acceptance] disqualified lead';
    let disqualifiedLeadId = await leadIdByNote(disqualifiedMarker);
    if (!disqualifiedLeadId) {
      const lead = await captureLike(client, actor, {
        fullName: 'Acceptance Disqualified Doctor',
        phone: '+201000001002',
        email: 'acceptance-disqualified@dentalhub.test',
        sourceCode: 'facebook',
        campaignCode: 'acceptance_ramadan',
        productCategoryCode: 'clinic_packages',
        note: disqualifiedMarker,
        ownerUserId: rep.id,
      });
      await disqualifyLead(
        client,
        lead.id,
        { userId: actor.userId, role: actor.role },
        { reasonId: reasonRows[0].id, note: '[acceptance] seeded disqualified record' },
      );
      disqualifiedLeadId = lead.id;
      console.log('  created   disqualified lead', disqualifiedLeadId);
    } else {
      console.log('  exists    disqualified lead', disqualifiedLeadId);
    }

    // 4. Open opportunity (via qualification).
    const opportunityMarker = '[acceptance] opportunity lead';
    let opportunityLeadId = await leadIdByNote(opportunityMarker);
    if (!opportunityLeadId) {
      const lead = await captureLike(client, actor, {
        fullName: 'Acceptance Opportunity Doctor',
        phone: '+201000001003',
        email: 'acceptance-opportunity@dentalhub.test',
        sourceCode: 'whatsapp',
        productCategoryCode: 'dental_units',
        note: opportunityMarker,
        ownerUserId: rep.id,
      });
      opportunityLeadId = lead.id;
    }

    let opportunityId: string;
    const { rows: opportunityRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_opportunity WHERE lead_id = $1`,
      [opportunityLeadId],
    );
    if (opportunityRows.length === 0) {
      const lead = await client.query<{ contact_id: string; account_id: string | null; owner_user_id: string }>(
        `SELECT contact_id, account_id, owner_user_id FROM crm_lead WHERE id = $1`,
        [opportunityLeadId],
      );
      const leadRow = lead.rows[0];
      const opportunity = await createOpportunity(client, {
        leadId: opportunityLeadId,
        contactId: leadRow.contact_id,
        accountId: leadRow.account_id,
        ownerUserId: leadRow.owner_user_id,
        productCategoryId: null,
        estimatedValue: 250000,
        notes: '[acceptance] seeded opportunity',
      });
      await recordStageChange(client, {
        opportunityId: opportunity.id,
        fromStage: null,
        toStage: 'QUALIFIED',
        changedBy: actor.userId,
        note: '[acceptance] seeded opportunity',
      });
      await client.query(
        `UPDATE crm_lead SET status = 'CONTACTED', updated_at = now() WHERE id = $1 AND status = 'NEW'`,
        [opportunityLeadId],
      );
      opportunityId = opportunity.id;
      console.log('  created   opportunity', opportunityId);
    } else {
      opportunityId = opportunityRows[0].id;
      console.log('  exists    opportunity', opportunityId);
    }

    // 5. Follow-ups in the three pending buckets.
    const followUpMarkers: { bucket: 'overdue' | 'today' | 'upcoming'; actionType: FollowUpActionType; marker: string }[] = [
      { bucket: 'overdue', actionType: 'CALL', marker: '[acceptance] overdue follow-up' },
      { bucket: 'today', actionType: 'MEETING', marker: '[acceptance] due-today follow-up' },
      { bucket: 'upcoming', actionType: 'WHATSAPP', marker: '[acceptance] upcoming follow-up' },
    ];

    for (const spec of followUpMarkers) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM crm_followup WHERE opportunity_id = $1 AND note = $2`,
        [opportunityId, spec.marker],
      );
      if (rows.length > 0) {
        console.log('  exists    follow-up', spec.bucket, rows[0].id);
        continue;
      }

      const followUp = await createFollowUp(client, {
        opportunityId,
        ownerUserId: rep.id,
        actionType: spec.actionType,
        note: spec.marker,
        dueAt: new Date(Date.now() + 86_400_000),
        actorUserId: actor.userId,
      });
      await client.query(
        `UPDATE crm_followup SET due_at = ${pinDue(spec.bucket)} WHERE id = $1`,
        [followUp.id],
      );
      console.log('  created   follow-up', spec.bucket, followUp.id);
    }

    // 6. Quotations: one per lifecycle state plus a revision chain, so the
    //    opportunity page, the quotation workspace and the print view can all
    //    be verified against real rows.
    const quotationSpecs: { marker: string; status: QuotationStatus; tax: number }[] = [
      { marker: '[acceptance] quotation draft', status: 'DRAFT', tax: 10000 },
      { marker: '[acceptance] quotation sent', status: 'SENT', tax: 10000 },
      { marker: '[acceptance] quotation accepted', status: 'ACCEPTED', tax: 12000 },
      { marker: '[acceptance] quotation rejected', status: 'REJECTED', tax: 0 },
    ];

    for (const spec of quotationSpecs) {
      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM crm_quotation WHERE opportunity_id = $1 AND notes = $2`,
        [opportunityId, spec.marker],
      );
      if (existing.length > 0) {
        console.log('  exists    quotation', spec.status, existing[0].id);
        continue;
      }

      const quotation = await createQuotation(client, actor, {
        opportunityId,
        items: [
          { description: 'Dental unit - premium chair package', quantity: 1, unitPrice: 210000 },
          { description: 'Delivery, installation and staff training', quantity: 1, unitPrice: 15000 },
          { description: 'First-year service contract', quantity: 1, unitPrice: 18000 },
        ],
        discountAmount: spec.status === 'REJECTED' ? 0 : 5000,
        taxAmount: spec.tax,
        notes: spec.marker,
        termsConditions: '50% deposit with order, balance before delivery. Warranty per manufacturer terms.',
        validUntil: new Date(Date.now() + 30 * 86_400_000),
      });
      if (spec.status === 'ACCEPTED' || spec.status === 'REJECTED') {
        await transitionQuotation(client, quotation.id, actor, 'SENT');
        await transitionQuotation(client, quotation.id, actor, spec.status);
      } else if (spec.status !== 'DRAFT') {
        await transitionQuotation(client, quotation.id, actor, spec.status);
      }
      console.log('  created   quotation', spec.status, quotation.id, quotation.quoteNumber);
    }

    // Revision chain: the SENT quotation gets a newer DRAFT revision, so the
    // "revises Q-..." lineage renders in the UI.
    const { rows: sentRows } = await client.query<{ id: string }>(
      `SELECT id FROM crm_quotation WHERE opportunity_id = $1 AND notes = $2`,
      [opportunityId, '[acceptance] quotation sent'],
    );
    if (sentRows.length > 0) {
      const { rows: revisionRows } = await client.query<{ id: string }>(
        `SELECT id FROM crm_quotation WHERE previous_quote_id = $1`,
        [sentRows[0].id],
      );
      if (revisionRows.length === 0) {
        const revision = await createRevision(client, sentRows[0].id, actor);
        console.log('  created   quotation revision', revision.id, revision.quoteNumber);
      } else {
        console.log('  exists    quotation revision', revisionRows[0].id);
      }
    }

    console.log('\nAcceptance data ready. Sign in as:');
    console.log('  manager@dentalhub.test   (Sales Manager)');
    console.log('  rep@dentalhub.test       (Sales Rep)');
    console.log('  admin@dentalhub.test     (Admin)');
    console.log(`  password: ${process.env.SEED_DEV_PASSWORD ?? 'DentalHubDev!2024'}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
