import { PageHeader } from '@/components/crm/Ui';
import { requirePermission } from '@/server/auth/dal';
import { db } from '@/server/db/client';
import { listUsers } from '@/server/users/repository';
import { ROLE_LABELS, can } from '@/server/authz/permissions';
import { CreateUserForm } from './create-user-form';
import { UserRowActions } from './user-row-actions';

export const metadata = { title: 'Users | Dental Hub CRM' };

export default async function UsersSettingsPage() {
  // Authoritative, server-side. Non-admins never reach the query below.
  const session = await requirePermission('users:read');
  const users = await listUsers(db());
  const mayManage = can(session.role, 'users:manage');

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title="Users"
        description="Dental Hub staff accounts. Add people, change their role, reset a forgotten password, and deactivate anyone who leaves."
      />

      {mayManage ? (
        <div className="mt-6">
          <CreateUserForm />
        </div>
      ) : null}

      <ul className="mt-6 divide-y divide-[#edf0f2] overflow-hidden rounded-xl border border-[#dfe5e8] bg-white">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#1c2831]">
                <span className="truncate">{user.displayName}</span>
                {user.id === session.user.id ? (
                  <span className="rounded-full bg-[#edf0f2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#63707a]">
                    You
                  </span>
                ) : null}
                {user.isActive ? null : (
                  <span className="rounded-full bg-[#ffe9ea] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#c43f47]">
                    Inactive
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-[#53616b]">{user.email}</p>
              <p className="mt-0.5 text-xs text-[#8a959d]">{ROLE_LABELS[user.role]}</p>
            </div>

            {mayManage ? <UserRowActions user={user} isSelf={user.id === session.user.id} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
