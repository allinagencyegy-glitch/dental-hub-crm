import Link from 'next/link';
import { requireSession } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.forbidden.pageTitle) };
}

export default async function ForbiddenPage() {
  const session = await requireSession();
  const m = await getMessages();

  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#18a897]">403</p>
      <h1 className="mt-2 text-xl font-semibold text-[#16232c]">{m.forbidden.heading}</h1>
      <p className="mt-3 text-sm text-[#75828c]">{m.forbidden.body(m.roles[session.role])}</p>
      <Link
        href="/crm"
        className="mt-6 inline-flex h-9 items-center rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944]"
      >
        {m.forbidden.backHome}
      </Link>
    </div>
  );
}
