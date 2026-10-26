import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { LanguageSwitch } from '@/components/shell/LanguageSwitch';
import { BRAND_LOGO } from '@/components/brand/company';
import { LoginForm } from './login-form';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.login.pageTitle) };
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Authoritative check: a stale or revoked cookie simply shows the form again.
  if (await getCurrentSession()) redirect('/crm');

  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/crm';
  const m = await getMessages();

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="absolute end-4 top-4">
        <LanguageSwitch className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5 hover:text-white" />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image
            src={BRAND_LOGO.src}
            width={BRAND_LOGO.width}
            height={BRAND_LOGO.height}
            alt={m.company.logoAlt}
            priority
            unoptimized
            className="mx-auto mb-6 h-14 w-auto"
          />
          <h1 className="text-xl font-semibold tracking-tight text-white">{m.app.name}</h1>
          <p className="mt-1 text-sm text-slate-400">{m.login.subtitle}</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
