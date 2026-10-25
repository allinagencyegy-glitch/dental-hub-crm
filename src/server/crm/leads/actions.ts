'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import type { Messages } from '@/i18n/messages';
import {
  captureLeadUseCase,
  listLeadsUseCase,
  getLeadDetailUseCase,
  markLeadContactedUseCase,
  disqualifyLeadUseCase,
  getLeadCaptureCatalogUseCase,
  getSourceCampaignsUseCase,
  getDisqualifyReasonsUseCase,
  getAssignableOwnersUseCase,
  archiveLeadUseCase,
  restoreLeadUseCase,
  updateLeadUseCase,
  linkLeadToAccountUseCase,
  type CaptureLeadInput,
  type CaptureLeadResult,
  type Actor,
  type UpdateLeadInput,
  type UpdateLeadResult,
  type LinkLeadAccountResult,
} from './service';
import { localise, statusFailure } from './messages';
import type { Lead, LeadDetail, LeadStatus } from './repository';

const MAX_CLINIC_NAME = 200;

/**
 * Input schema for lead capture.
 * SALES_REP: owner_user_id is forced to current session user.
 * SALES_MANAGER/ADMIN: may explicitly assign an owner.
 */
function captureLeadSchema(m: Messages) {
  return z.object({
    fullName: z.string(m.leads.fullNameRequired).trim().min(1, m.leads.fullNameRequired).max(200),
    phone: z.string().max(50).optional().nullable(),
    email: z.email(m.leads.invalidEmail).max(254).optional().nullable(),
    sourceCode: z.string(m.leads.sourceRequired).min(1, m.leads.sourceRequired),
    campaignCode: z.string().optional().nullable(),
    productCategoryCode: z.string().optional().nullable(),
    note: z.string().max(5000).optional().nullable(),
    ownerUserId: z.uuid(m.leads.errors.ownerInvalid).optional().nullable(),
  });
}

export async function captureLeadAction(input: CaptureLeadInput): Promise<CaptureLeadResult> {
  const session = await assertPermission('leads:write');
  const m = await getMessages();
  const parsed = captureLeadSchema(m).safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION', message: parsed.error.issues[0]?.message ?? m.common.invalidInput };
  }

  const actor: Actor = { userId: session.user.id, role: session.role };
  return localise(await captureLeadUseCase(actor, parsed.data), m);
}

/**
 * Lists leads for the current actor with row-scope authorization.
 * `search` matches contact name, phone, email, account, source, campaign,
 * category, owner and the lead reference.
 */
export async function listLeadsAction(options: { status?: LeadStatus; archiveFilter?: 'active' | 'archived' | 'all'; search?: string; limit?: number; offset?: number } = {}): Promise<{ leads: Lead[]; total: number }> {
  const session = await assertPermission('leads:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return listLeadsUseCase(actor, options);
}

/**
 * Gets lead detail by ID with row-scope authorization.
 */
export async function getLeadDetailAction(leadId: string): Promise<LeadDetail | null> {
  const session = await assertPermission('leads:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getLeadDetailUseCase(actor, leadId);
}

/**
 * Marks a lead as CONTACTED.
 */
export async function markLeadContactedAction(leadId: string): Promise<{ ok: true; lead: Lead } | { ok: false; error: string; message: string }> {
  const session = await assertPermission('leads:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  try {
    const lead = await markLeadContactedUseCase(actor, leadId);
    return { ok: true, lead };
  } catch (error) {
    const failure = statusFailure(error, await getMessages());
    if (failure) return failure;
    throw error;
  }
}

/**
 * Disqualifies a lead.
 */
export async function disqualifyLeadAction(
  leadId: string,
  input: { reasonId: string; note?: string | null },
): Promise<{ ok: true; lead: Lead } | { ok: false; error: string; message: string }> {
  const session = await assertPermission('leads:disqualify');
  const actor: Actor = { userId: session.user.id, role: session.role };

  try {
    const lead = await disqualifyLeadUseCase(actor, leadId, input);
    return { ok: true, lead };
  } catch (error) {
    const failure = statusFailure(error, await getMessages());
    if (failure) return failure;
    throw error;
  }
}

/**
 * Gets catalog data for the capture form.
 */
export async function getLeadCaptureCatalogAction(): Promise<{
  sources: { id: string; code: string; name: string }[];
  productCategories: { id: string; code: string; name: string }[];
}> {
  await assertPermission('leads:write');
  return getLeadCaptureCatalogUseCase();
}

/**
 * Gets campaigns for a source.
 */
export async function getSourceCampaignsAction(sourceCode: string): Promise<{ id: string; code: string; name: string }[]> {
  await assertPermission('leads:write');
  return getSourceCampaignsUseCase(sourceCode);
}

/**
 * Gets disqualification reasons for the disqualify dialog.
 */
export async function getDisqualifyReasonsAction(): Promise<{ id: string; code: string; label: string; requiresNote: boolean }[]> {
  await assertPermission('leads:disqualify');
  return getDisqualifyReasonsUseCase();
}

/**
 * Gets assignable owners for lead capture (SALES_REP and SALES_MANAGER who are active).
 * Only available to SALES_MANAGER and ADMIN.
 */
export async function getAssignableOwnersAction(): Promise<{ id: string; displayName: string; email: string; role: string }[]> {
  await assertPermission('leads:write');
  return getAssignableOwnersUseCase();
}

/**
 * Archives a lead.
 */
export async function archiveLeadAction(leadId: string): Promise<{ ok: true; lead: Lead } | { ok: false; error: string; message: string }> {
  const session = await assertPermission('leads:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  try {
    const lead = await archiveLeadUseCase(actor, leadId);
    return { ok: true, lead };
  } catch (error) {
    const failure = statusFailure(error, await getMessages());
    if (failure) return failure;
    throw error;
  }
}

/**
 * Restores an archived lead.
 */
export async function restoreLeadAction(leadId: string): Promise<{ ok: true; lead: Lead } | { ok: false; error: string; message: string }> {
  const session = await assertPermission('leads:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  try {
    const lead = await restoreLeadUseCase(actor, leadId);
    return { ok: true, lead };
  } catch (error) {
    const failure = statusFailure(error, await getMessages());
    if (failure) return failure;
    throw error;
  }
}

/**
 * Updates a lead (source, campaign, category, note, owner, contact info).
 * Single atomic operation.
 */
export async function updateLeadAction(leadId: string, input: UpdateLeadInput): Promise<UpdateLeadResult> {
  const session = await assertPermission('leads:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  return localise(await updateLeadUseCase(actor, leadId, input), await getMessages());
}

/**
 * Links a lead's contact to an existing clinic/account, or creates a new
 * clinic and links it. Row scope: a rep may only do this on their own leads.
 */
export async function linkLeadToAccountAction(
  leadId: string,
  input: { accountId?: string | null; newAccountName?: string | null },
): Promise<LinkLeadAccountResult> {
  const session = await assertPermission('leads:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  const m = await getMessages();

  // The use case checks these too; asking here first says which one in the
  // reader's language.
  const newAccountName = input.newAccountName?.trim();
  if (!input.accountId && !newAccountName) {
    return { ok: false, error: 'VALIDATION', message: m.leads.errors.chooseOrNameClinic };
  }
  if (!input.accountId && newAccountName && newAccountName.length > MAX_CLINIC_NAME) {
    return { ok: false, error: 'VALIDATION', message: m.leads.errors.clinicNameTooLong(MAX_CLINIC_NAME) };
  }

  return localise(await linkLeadToAccountUseCase(actor, leadId, input), m);
}