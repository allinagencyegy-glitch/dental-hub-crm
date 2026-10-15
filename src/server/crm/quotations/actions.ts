'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import {
  createQuotationUseCase,
  getQuotationUseCase,
  listQuotationsUseCase,
  listQuotationSnapshotsUseCase,
  reviseQuotationUseCase,
  transitionQuotationUseCase,
  updateDraftQuotationUseCase,
  type Actor,
  type QuotationCommercialInput,
  type QuotationResult,
} from './service';
import type { QuotationDetail, QuotationListItem, QuotationRevisionSnapshot } from './repository';

const itemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
});

const commercialInputSchema = z.object({
  items: z.array(itemSchema).min(1),
  discountAmount: z.number().nullable().optional(),
  taxAmount: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  termsConditions: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
});

function parseCommercialInput(input: unknown): QuotationCommercialInput | null {
  const parsed = commercialInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

const INVALID_INPUT = {
  ok: false,
  error: 'VALIDATION',
  message: 'The quotation data could not be read.',
} as const;

/** Creates a DRAFT quotation on an opportunity the actor may see. */
export async function createQuotationAction(
  opportunityId: string,
  input: unknown,
): Promise<QuotationResult> {
  const session = await assertPermission('quotations:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const commercial = parseCommercialInput(input);
  if (!commercial) return INVALID_INPUT;

  return createQuotationUseCase(actor, opportunityId, commercial);
}

/** One quotation with its items, or null when missing / out of scope. */
export async function getQuotationAction(
  quotationId: string,
): Promise<QuotationDetail | null> {
  const session = await assertPermission('quotations:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return getQuotationUseCase(actor, quotationId);
}

/** The commercial history of one opportunity, oldest first. Empty out of scope. */
export async function listQuotationsAction(
  opportunityId: string,
): Promise<QuotationListItem[]> {
  const session = await assertPermission('quotations:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return listQuotationsUseCase(actor, opportunityId);
}

/** Edits a DRAFT quotation's items and commercial fields. */
export async function updateDraftQuotationAction(
  quotationId: string,
  input: unknown,
): Promise<QuotationResult> {
  const session = await assertPermission('quotations:write');
  const actor: Actor = { userId: session.user.id, role: session.role };

  const parsed = z
    .object({ changeReason: z.string().nullable().optional() })
    .safeParse(input);
  const changeReason = parsed.success ? (parsed.data.changeReason ?? null) : null;

  const commercial = parseCommercialInput(input);
  if (!commercial) return INVALID_INPUT;

  return updateDraftQuotationUseCase(actor, quotationId, { ...commercial, changeReason });
}

/** Sends a DRAFT quotation to the customer. */
export async function sendQuotationAction(quotationId: string): Promise<QuotationResult> {
  const session = await assertPermission('quotations:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return transitionQuotationUseCase(actor, quotationId, 'SENT');
}

/** Records the customer's acceptance of a SENT quotation. */
export async function acceptQuotationAction(quotationId: string): Promise<QuotationResult> {
  const session = await assertPermission('quotations:close');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return transitionQuotationUseCase(actor, quotationId, 'ACCEPTED');
}

/** Records the customer's rejection of a SENT quotation. */
export async function rejectQuotationAction(quotationId: string): Promise<QuotationResult> {
  const session = await assertPermission('quotations:close');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return transitionQuotationUseCase(actor, quotationId, 'REJECTED');
}

/** Marks a DRAFT or SENT quotation as expired. */
export async function expireQuotationAction(quotationId: string): Promise<QuotationResult> {
  const session = await assertPermission('quotations:close');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return transitionQuotationUseCase(actor, quotationId, 'EXPIRED');
}

/** Supersedes a committed quotation with a new DRAFT revision. */
export async function reviseQuotationAction(quotationId: string): Promise<QuotationResult> {
  const session = await assertPermission('quotations:write');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return reviseQuotationUseCase(actor, quotationId);
}

/** The immutable snapshot log of one quotation, newest first. Empty out of scope. */
export async function listQuotationSnapshotsAction(
  quotationId: string,
): Promise<QuotationRevisionSnapshot[]> {
  const session = await assertPermission('quotations:read');
  const actor: Actor = { userId: session.user.id, role: session.role };
  return listQuotationSnapshotsUseCase(actor, quotationId);
}
