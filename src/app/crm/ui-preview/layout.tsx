import type { Metadata } from 'next';
import { PreviewShell } from '@/components/crm/PreviewShell';
import { requireSession } from '@/server/auth/dal';

export const metadata: Metadata = {
  title: 'CRM UI Preview | Dental Hub',
  description: 'Synthetic, non-persistent preview of the Dental Hub CRM interface.',
};

export default async function CrmPreviewLayout({ children }: LayoutProps<'/crm/ui-preview'>) {
  const session = await requireSession();
  return <PreviewShell displayName={session.user.displayName}>{children}</PreviewShell>;
}
