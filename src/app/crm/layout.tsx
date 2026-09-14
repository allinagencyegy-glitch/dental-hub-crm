import { AppShell } from '@/components/shell/AppShell';
import { requireSession } from '@/server/auth/dal';

/**
 * Every route under /crm passes through this layout, so the authoritative
 * session check runs for all of them - not just the ones Proxy happens to match.
 */
export default async function CrmLayout({ children }: LayoutProps<'/crm'>) {
  const session = await requireSession();
  return <AppShell user={session.user}>{children}</AppShell>;
}
