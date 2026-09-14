import Link from 'next/link';
import { requireSession } from '@/server/auth/dal';
import { ROLE_LABELS, can } from '@/server/authz/permissions';

export const metadata = { title: 'Home | Dental Hub CRM' };

const DEFERRED_MODULES = [
  'Leads',
  'Customers',
  'Pipeline',
  'Follow-ups',
  'Quotations',
  'Reports',
  'Team',
];

export default async function CrmHomePage() {
  const session = await requireSession();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-white">
        Welcome, {session.user.displayName}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        You are signed in to Dental Hub CRM as {ROLE_LABELS[session.user.role]}.
      </p>

      <section className="mt-8 rounded-lg border border-white/10 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-white">Foundation v0</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          This release establishes persistence, migrations, authentication, users, roles and the
          application shell. The CRM modules below are reserved in the navigation and are not yet
          implemented.
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
