'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';
import { notificationHref, notificationText } from '@/i18n/notification';
import {
  getNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/crm/notifications/actions';
import type { NotificationsPayload } from '@/server/crm/notifications/service';

const PANEL_ID = 'notification-panel';

/** How often the badge is refreshed while the page stays open. */
const REFRESH_MS = 60_000;

/**
 * The bell in the header.
 *
 * The badge counts unread notifications plus the person's own overdue
 * follow-ups, so missed work stays visible until it is done. It refreshes on
 * every page change, when the tab regains focus, and once a minute.
 */
export function NotificationBell() {
  const m = useMessages();
  const format = useFormatters();
  const t = m.notifications;
  const pathname = usePathname();
  const [payload, setPayload] = useState<NotificationsPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setPayload(await getNotificationsAction());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Following a link out of the panel closes it.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // A page change refreshes the badge. The guard drops a reply that arrives
  // after the next page change has already asked again.
  useEffect(() => {
    let current = true;
    getNotificationsAction().then(
      (next) => {
        if (!current) return;
        setPayload(next);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // Escape or a click outside closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const unread = payload?.unread ?? 0;
  const overdue = payload?.overdueFollowUps ?? 0;
  const dueToday = payload?.dueTodayFollowUps ?? 0;
  const badge = unread + overdue;

  const toggle = () => {
    if (!open) void load();
    setOpen((value) => !value);
  };

  const markAll = async () => {
    await markAllNotificationsReadAction();
    await load();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={badge > 0 ? t.openWithCount(badge) : t.open}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-[#dbe2e5] bg-white text-[#53616b] transition hover:bg-[#f7f9fa]"
      >
        <CrmIcon name="bell" className="h-4 w-4" />
        {badge > 0 ? (
          <span className="absolute -end-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#c43f47] px-1 text-[9px] font-bold text-white ring-2 ring-white">
            {badge > 99 ? '99+' : format.number(badge)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={PANEL_ID}
          role="region"
          aria-label={t.title}
          className="fixed inset-x-4 top-[84px] z-[120] overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_rgba(20,35,45,0.16)] ring-1 ring-[#dfe5e8] sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-[360px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#e7ebed] px-4 py-3">
            <h2 className="text-xs font-semibold text-[#1c2831]">{t.title}</h2>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                className="text-[10px] font-bold text-[#118e82] transition hover:text-[#08756b]"
              >
                {t.markAllRead}
              </button>
            ) : null}
          </div>

          {overdue + dueToday > 0 ? (
            <Link
              href="/crm/followups"
              className="flex items-center gap-2.5 border-b border-[#f4d9db] bg-[#fff6f6] px-4 py-2.5 transition hover:bg-[#ffeeef]"
            >
              <CrmIcon name="alert" className="h-3.5 w-3.5 shrink-0 text-[#c43f47]" />
              <span className="min-w-0 flex-1 text-[10px] font-semibold text-[#8f2f35]">
                {[overdue > 0 ? t.overdue(overdue) : null, dueToday > 0 ? t.dueToday(dueToday) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="text-[9px] font-bold text-[#c43f47]">{t.openFollowUps}</span>
            </Link>
          ) : null}

          <div className="max-h-[min(420px,calc(100vh-180px))] overflow-y-auto">
            {failed && !payload ? (
              <p role="alert" className="px-4 py-6 text-center text-[11px] text-[#b83c43]">
                {t.loadFailed}
              </p>
            ) : payload && payload.entries.length === 0 ? (
              <p className="px-4 py-8 text-center text-[11px] text-[#89949c]">{t.empty}</p>
            ) : (
              <ul className="divide-y divide-[#edf0f1]">
                {(payload?.entries ?? []).map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={notificationHref(entry)}
                      onClick={() => {
                        if (!entry.readAt) void markNotificationReadAction(entry.id);
                      }}
                      className={`flex gap-2.5 px-4 py-3 transition hover:bg-[#f7f9fa] ${entry.readAt ? '' : 'bg-[#f2fbf9]'}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${entry.readAt ? 'bg-transparent' : 'bg-[#18b6a4]'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[11px] leading-5 ${entry.readAt ? 'text-[#53616b]' : 'font-semibold text-[#1c2831]'}`}>
                          {notificationText(entry, m, format)}
                        </span>
                        <span className="mt-0.5 block text-[9px] text-[#929da4]">{format.dateTime(entry.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
