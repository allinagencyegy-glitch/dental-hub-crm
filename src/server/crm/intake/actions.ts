'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import { db as defaultDb } from '@/server/db/client';
import { listWhatsAppMessages, type WhatsAppMessageEntry } from './repository';

const id = z.uuid();

/** What the customer wrote on WhatsApp about a lead, within the caller's row scope. */
export async function listLeadWhatsAppMessagesAction(leadId: string): Promise<WhatsAppMessageEntry[]> {
  const session = await assertPermission('leads:read');
  if (!id.safeParse(leadId).success) return [];
  return listWhatsAppMessages(defaultDb(), { userId: session.user.id, role: session.role }, { leadId });
}

/** The same conversation, from the deal the lead became. */
export async function listOpportunityWhatsAppMessagesAction(opportunityId: string): Promise<WhatsAppMessageEntry[]> {
  const session = await assertPermission('opportunities:read');
  if (!id.safeParse(opportunityId).success) return [];
  return listWhatsAppMessages(defaultDb(), { userId: session.user.id, role: session.role }, { opportunityId });
}
