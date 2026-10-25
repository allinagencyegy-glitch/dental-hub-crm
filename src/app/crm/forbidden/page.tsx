import Link from 'next/link';
import { requireSession } from '@/server/auth/dal';
import { ROLE_LABELS } from '@/server/authz/permissions';

export const metadata = { title: 'Not authorised | Dental Hub CRM' };

export default async function ForbiddenPage() {
  const session = await requireSession();

  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#18a897]">403</p>
      <h1 className="mt-2 text-xl font-semibold text-[#16232c]">You do not have access to that page</h1>
      <p className="mt-3 text-sm text-[#75828c]">
        Your role ({ROLE_LABELS[session.role]}) is not permitted to view it. Ask an admin if you
        believe this is wrong.
      </p>
      <Link
        href="/crm"
        className="mt-6 inline-flex h-9 items-center rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944]"
      >
        Back to home
      </Link>
    </div>
  );
}
