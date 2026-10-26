import { PageHeader } from '@/components/crm/Ui';
import { requirePermission } from '@/server/auth/dal';
import { db } from '@/server/db/client';
import { listUsers } from '@/server/users/repository';
import { can } from '@/server/authz/permissions';
import { getMessages } from '@/i18n/server';
import { CreateUserForm } from './create-user-form';
import { UserRowActions } from './user-row-actions';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.users.pageTitle) };
}

export default async function UsersSettingsPage() {
  // Authoritative, server-side. Non-admins never reach the query below.
  const session = await requirePermission('users:read');
  const users = await listUsers(db());
  const mayManage = can(session.role, 'users:manage');
  const m = await getMessages();
  const teamLeaders = users
    .filter((user) => user.role === 'SALES_TEAM_LEADER' && user.isActive)
    .map((user) => ({ id: user.id, displayName: user.displayName }));
  const nameById = new Map(users.map((user) => [user.id, user.displayName]));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={m.users.eyebrow}
        title={m.users.heading}
        description={m.users.description}
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
                    {m.users.you}
                  </span>
                ) : null}
                {user.isActive ? null : (
                  <span className="rounded-full bg-[#ffe9ea] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#c43f47]">
                    {m.users.inactive}
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-[#53616b]">{user.email}</p>
              <p className="mt-0.5 text-xs text-[#8a959d]">
                {m.roles[user.role]}
                {user.teamLeaderId && nameById.has(user.teamLeaderId)
                  ? ` · ${m.users.teamOf(nameById.get(user.teamLeaderId)!)}`
                  : null}
              </p>
            </div>

            {mayManage ? <UserRowActions user={user} isSelf={user.id === session.user.id} teamLeaders={teamLeaders} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
