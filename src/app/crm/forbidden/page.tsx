import Link from 'next/link';
import { requireSession } from '@/server/auth/dal';
import { ROLE_LABELS } from '@/server/authz/permissions';

export const metadata = { title: 'Not authorised | Dental Hub CRM' };

export default async function ForbiddenPage() {
  const session = await requireSession();

  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">403</p>
      <h1 className="mt-2 text-xl font-semibold text-white">You do not have access to that page</h1>
      <p className="mt-3 text-sm text-slate-400">
        Your role ({ROLE_LABELS[session.role]}) is not permitted to view it. Ask an admin if you
        believe this is wrong.
      </p>
      <Link
        href="/crm"
        className="mt-6 inline-block rounded-md border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:text-white"
      >
        Back to home
      </Link>
    </div>
  );
}
