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
      <h1 className="text-2xl font-semibold tracking-tight text-white">Users</h1>
      <p className="mt-2 text-sm text-slate-400">
        Dental Hub staff accounts. Add people, change their role, and deactivate anyone who leaves.
      </p>

      {mayManage ? (
        <div className="mt-6">
          <CreateUserForm />
        </div>
      ) : null}

      <ul className="mt-6 divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-slate-900/40">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-white">
                <span className="truncate">{user.displayName}</span>
                {user.id === session.user.id ? (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                    You
                  </span>
                ) : null}
                {user.isActive ? null : (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-300">
                    Inactive
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-400">{user.email}</p>
              <p className="mt-0.5 text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
            </div>

            {mayManage ? <UserRowActions user={user} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
