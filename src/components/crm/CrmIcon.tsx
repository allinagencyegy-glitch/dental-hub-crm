import type { SVGProps } from 'react';

export type CrmIconName =
  | 'home' | 'leads' | 'customers' | 'pipeline' | 'followups' | 'quotation'
  | 'reports' | 'team' | 'settings' | 'search' | 'bell' | 'chevron'
  | 'plus' | 'filter' | 'calendar' | 'clock' | 'phone'
  | 'message' | 'mail' | 'meeting' | 'demo' | 'money'
  | 'alert' | 'more' | 'arrow' | 'building' | 'location' | 'check'
  | 'sparkles' | 'pause' | 'target' | 'external' | 'activity' | 'x';

export function CrmIcon({ name, ...props }: { name: CrmIconName } & SVGProps<SVGSVGElement>) {
  const paths: Record<CrmIconName, React.ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/></>,
    leads: <><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5M8 17h3"/></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    pipeline: <><path d="M4 5h16M4 12h10M4 19h6"/><circle cx="19" cy="12" r="2"/><circle cx="15" cy="19" r="2"/></>,
    followups: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    quotation: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h7M9 16h5"/></>,
    reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    team: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M15 15a5 5 0 0 1 6 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-1.6-1H2v-4h.1A1.7 1.7 0 0 0 4.2 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4a1.7 1.7 0 0 0 1-1.6V2h4v.1A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h1v4h-.1a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>, plus: <path d="M12 5v14M5 12h14"/>,
    filter: <path d="M3 5h18l-7 8v6l-4 2v-8z"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.07 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z"/>,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    meeting: <><circle cx="8" cy="7" r="3"/><circle cx="17" cy="8" r="2"/><path d="M2 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 5"/></>,
    demo: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3zM8 22h8M12 18v4"/></>,
    money: <><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9H5v6h1M18 9h1v6h-1"/></>,
    alert: <><path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    building: <><path d="M4 21V3h12v18M16 8h4v13M8 7h4M8 11h4M8 15h4M2 21h20"/></>,
    location: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></>,
    check: <path d="m5 12 4 4L19 6"/>, sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8zM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6z"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>, target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>, activity: <><path d="M3 12h4l2-7 4 14 2-7h6"/></>, x: <><path d="M18 6 6 18M6 6l12 12"/></>,
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
