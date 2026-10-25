'use server';

import 'server-only';
import { z } from 'zod';
import { assertPermission } from '@/server/auth/dal';
import {
  getNotificationsUseCase,
  markAllNotificationsReadUseCase,
  markNotificationReadUseCase,
  type NotificationsPayload,
} from './service';

/** The signed-in person's bell. Everyone in the CRM has one. */
export async function getNotificationsAction(): Promise<NotificationsPayload> {
  const session = await assertPermission('crm:access');
  return getNotificationsUseCase(session.user.id);
}

/** Marks one of the signed-in person's notifications read. */
export async function markNotificationReadAction(notificationId: unknown): Promise<void> {
  const session = await assertPermission('crm:access');
  const parsed = z.uuid().safeParse(notificationId);
  if (!parsed.success) return;
  await markNotificationReadUseCase(session.user.id, parsed.data);
}

/** Marks all of the signed-in person's notifications read. */
export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await assertPermission('crm:access');
  await markAllNotificationsReadUseCase(session.user.id);
}
