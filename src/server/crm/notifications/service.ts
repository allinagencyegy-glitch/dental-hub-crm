/**
 * In-app notifications: what the bell shows, and marking it read.
 *
 * Everything here acts for the signed-in person only; the repository
 * qualifies every query on the recipient.
 */
import { db as defaultDb } from '@/server/db/client';
import type { Db } from '@/server/db/types';
import { countOwnDueFollowUps } from '@/server/crm/opportunities/followups';
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationEntry,
} from './repository';

function getDb(db?: Db): Db {
  return db ?? defaultDb();
}

export interface NotificationsPayload {
  entries: NotificationEntry[];
  unread: number;
  /** The person's own pending follow-ups, counted live. */
  overdueFollowUps: number;
  dueTodayFollowUps: number;
}

/** The bell: latest notifications, the unread count and the follow-up reminder. */
export async function getNotificationsUseCase(userId: string, db?: Db): Promise<NotificationsPayload> {
  const database = getDb(db);
  const [entries, unread, due] = await Promise.all([
    listNotifications(database, userId),
    countUnreadNotifications(database, userId),
    countOwnDueFollowUps(database, userId),
  ]);
  return { entries, unread, overdueFollowUps: due.overdue, dueTodayFollowUps: due.today };
}

export async function markNotificationReadUseCase(userId: string, notificationId: string, db?: Db): Promise<void> {
  await markNotificationRead(getDb(db), userId, notificationId);
}

export async function markAllNotificationsReadUseCase(userId: string, db?: Db): Promise<void> {
  await markAllNotificationsRead(getDb(db), userId);
}
