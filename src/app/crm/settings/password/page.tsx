import { PageHeader } from '@/components/crm/Ui';
import { requirePermission } from '@/server/auth/dal';
import { ChangePasswordForm } from './change-password-form';

export const metadata = { title: 'Password | Dental Hub CRM' };

export default async function PasswordSettingsPage() {
  const session = await requirePermission('crm:access');

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        eyebrow="Settings"
        title="Change password"
        description={`Signed in as ${session.user.email}. Changing your password signs you out on every other device.`}
      />
      <ChangePasswordForm />
    </div>
  );
}
