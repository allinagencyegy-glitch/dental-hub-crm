import { PageHeader } from '@/components/crm/Ui';
import { requirePermission } from '@/server/auth/dal';
import { getMessages } from '@/i18n/server';
import { ChangePasswordForm } from './change-password-form';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.password.pageTitle) };
}

export default async function PasswordSettingsPage() {
  const session = await requirePermission('crm:access');
  const m = await getMessages();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        eyebrow={m.password.eyebrow}
        title={m.password.heading}
        description={m.password.description(session.user.email)}
      />
      <ChangePasswordForm />
    </div>
  );
}
