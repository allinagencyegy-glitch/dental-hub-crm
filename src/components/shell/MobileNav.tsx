'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { useMessages } from '@/i18n/I18nProvider';
import { SidebarNav } from './SidebarNav';
import { BrandBlock, UserCard } from './SidebarChrome';
import type { NavItem } from './navigation';

const DRAWER_ID = 'mobile-nav-drawer';

/** The scrollable region of the shell: the page behind the drawer must not move. */
const SCROLL_CONTAINER = '[data-shell-scroll]';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Navigation for narrow screens.
 *
 * Below the lg breakpoint the sidebar is not rendered at all, so the header
 * carries a menu button that opens the same navigation in a drawer. The
 * component is handed plain data only - the navigation the signed-in role may
 * reach, the display name and the role label - and imports nothing from the
 * server.
 */
export function MobileNav({
  primaryNav,
  settingsNav,
  displayName,
  roleLabel,
}: {
  primaryNav: NavItem[];
  settingsNav: NavItem[];
  displayName: string;
  roleLabel: string;
}) {
  const m = useMessages();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  // A route change means the user followed a link: the drawer has done its job.
  // Adjusting the state during render is React's own pattern for reacting to a
  // changed input; doing it in an effect would flash the drawer once more.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Escape closes the drawer; Tab never leaves it while it is open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;

      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (!drawer.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // The page behind the drawer must not scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const previousBodyOverflow = body.style.overflow;
    const scroller = document.querySelector<HTMLElement>(SCROLL_CONTAINER);
    const previousScrollerOverflow = scroller?.style.overflow ?? null;

    body.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousBodyOverflow;
      if (scroller) scroller.style.overflow = previousScrollerOverflow ?? '';
    };
  }, [open]);

  // Focus moves into the drawer on open and back to the button on close.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      drawerRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  // The drawer is a narrow-screen surface only: a resize to the desktop
  // breakpoint closes it and releases the scroll lock.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) close();
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, [close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? m.nav.closeMenu : m.nav.openMenu}
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#dbe2e5] bg-white text-[#53616b] transition hover:bg-[#f7f9fa] lg:hidden print:hidden"
      >
        <CrmIcon name={open ? 'x' : 'menu'} className="h-[18px] w-[18px]" />
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[200] lg:hidden print:hidden">
              <div
                className="absolute inset-0 bg-[#081017]/70"
                onClick={close}
                aria-hidden="true"
              />
              <div
                ref={drawerRef}
                id={DRAWER_ID}
                role="dialog"
                aria-modal="true"
                aria-label={m.nav.navigation}
                tabIndex={-1}
                className="absolute inset-y-0 start-0 flex w-[288px] max-w-[85vw] flex-col bg-[#101c24] text-white shadow-[0_18px_60px_rgba(0,0,0,0.45)] outline-none"
              >
                <div className="relative">
                  <BrandBlock />
                  <button
                    type="button"
                    onClick={close}
                    aria-label={m.nav.closeMenu}
                    className="absolute end-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    <CrmIcon name="x" className="h-[18px] w-[18px]" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pt-6">
                  <SidebarNav
                    title={m.nav.workspace}
                    items={primaryNav}
                    ariaLabel={m.nav.crmNavigation}
                    onNavigate={close}
                  />
                  <SidebarNav
                    title={m.nav.settings}
                    items={settingsNav}
                    ariaLabel={m.nav.settingsNavigation}
                    onNavigate={close}
                  />
                </div>

                <UserCard displayName={displayName} roleLabel={roleLabel} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
