import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/server/auth/dal';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in | Dental Hub CRM' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Authoritative check: a stale or revoked cookie simply shows the form again.
  if (await getCurrentSession()) redirect('/crm');

  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/crm';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-white">Dental Hub CRM</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to continue</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
