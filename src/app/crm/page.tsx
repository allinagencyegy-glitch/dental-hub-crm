import Link from 'next/link';
import { requireSession } from '@/server/auth/dal';
import { ROLE_LABELS, can } from '@/server/authz/permissions';

export const metadata = { title: 'Home | Dental Hub CRM' };

const AVAILABLE_MODULES: { label: string; href: string; permission: Parameters<typeof can>[1] }[] = [
  { label: 'Leads', href: '/crm/leads', permission: 'leads:read' },
  { label: 'Opportunities', href: '/crm/opportunities', permission: 'opportunities:read' },
  { label: 'Follow-ups', href: '/crm/followups', permission: 'followups:read' },
];

const DEFERRED_MODULES = [
  'Customers',
  'Pipeline',
  'Quotations',
  'Reports',
  'Team',
];

export default async function CrmHomePage() {
  const session = await requireSession();

  const reachable = AVAILABLE_MODULES.filter((module) => can(session.role, module.permission));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        Welcome, {session.user.displayName}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        You are signed in to Dental Hub CRM as {ROLE_LABELS[session.user.role]}.
      </p>

      <section className="mt-8 rounded-lg border border-white/10 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-white">Sales workspace</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Capture a lead, qualify it into an opportunity, and keep every promised next action on
          time. The modules below are live.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {reachable.map((module) => (
            <li key={module.label}>
              <Link
                href={module.href}
                className="inline-block rounded-full border border-teal-400/40 bg-teal-400/10 px-3 py-1 text-xs font-semibold text-teal-300 transition hover:border-teal-300 hover:text-teal-200"
              >
                {module.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-white">Planned</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          These modules are reserved in the navigation but not implemented yet. Their nav entries
          are visibly disabled, never dead links.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {DEFERRED_MODULES.map((module) => (
            <li
              key={module}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-500"
            >
              {module}
            </li>
          ))}
        </ul>
      </section>

      {can(session.role, 'users:read') ? (
        <Link
          href="/crm/settings/users"
          className="mt-6 inline-block rounded-md border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:text-white"
        >
          Manage users
        </Link>
      ) : null}
    </div>
  );
}
