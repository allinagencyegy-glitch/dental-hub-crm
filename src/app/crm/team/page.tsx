import Link from 'next/link';
import { requirePermission } from '@/server/auth/dal';
import { getLocale, getMessages } from '@/i18n/server';
import { formatAgo, formatters } from '@/i18n/format';
import { canAssignOwner } from '@/server/authz/permissions';
import { getTeamBoardAction } from '@/server/crm/team/actions';
import type { TeamMember } from '@/server/crm/team/repository';
import { attentionFor, type AttentionFlag } from '@/server/crm/team/attention';
import { Avatar, PageHeader } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import type { Messages } from '@/i18n/messages';

export async function generateMetadata() {
  const m = await getMessages();
  return { title: m.app.title(m.teamPage.pageTitle) };
}

interface Group {
  key: string;
  title: string;
  members: TeamMember[];
}

function sum(members: TeamMember[], pick: (member: TeamMember) => number): number {
  return members.reduce((total, member) => total + pick(member), 0);
}

export default async function TeamPage() {
  const session = await requirePermission('dashboard:read');
  const board = await getTeamBoardAction();
  const m = await getMessages();
  const locale = await getLocale();
  const format = formatters(locale);
  const t = m.teamPage;
  const now = new Date();
  const ago = (value: Date) => formatAgo(locale, value, now);
  const isRep = session.role === 'SALES_REP';
  // A rep's own lists are already theirs; anyone else narrows them to the person.
  const ownerQuery = (userId: string) => (canAssignOwner(session.role) ? `?owner=${userId}` : '');

  // Teams by leader, then management, then reps not on a team.
  const teams = new Map<string, Group>();
  const managers: Group = { key: 'managers', title: t.groups.managers, members: [] };
  const noTeam: Group = { key: 'none', title: t.groups.noTeam, members: [] };
  for (const member of board.members) {
    if (member.teamLeaderId && member.teamName) {
      const group = teams.get(member.teamLeaderId) ?? {
        key: member.teamLeaderId,
        title: t.groups.team(member.teamName),
        members: [],
      };
      group.members.push(member);
      teams.set(member.teamLeaderId, group);
    } else if (member.role === 'SALES_MANAGER') {
      managers.members.push(member);
    } else {
      noTeam.members.push(member);
    }
  }
  const groups = [...teams.values(), managers, noTeam].filter((group) => group.members.length > 0);

  const all = board.members;
  const oldestWaiting = all
    .map((member) => member.oldestWaitingAt)
    .filter((value): value is Date => value !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const cards = [
    { key: 'people', label: t.cards.people, value: format.number(all.length), hint: null, alert: false },
    {
      key: 'waiting',
      label: t.cards.waiting,
      value: format.number(sum(all, (member) => member.waitingLeads)),
      hint: oldestWaiting ? t.cards.oldestWaiting(ago(oldestWaiting)) : t.cards.noneWaiting,
      alert: false,
    },
    {
      key: 'overdue',
      label: t.cards.overdue,
      value: format.number(sum(all, (member) => member.overdue)),
      hint: t.cards.dueToday(format.number(sum(all, (member) => member.dueToday))),
      alert: sum(all, (member) => member.overdue) > 0,
    },
    {
      key: 'pipeline',
      label: t.cards.pipeline,
      value: format.currency(sum(all, (member) => member.pipelineValue)),
      hint: t.cards.openDeals(format.number(sum(all, (member) => member.openDeals))),
      alert: false,
    },
    {
      key: 'sales',
      label: t.cards.monthSales,
      value: format.currency(sum(all, (member) => member.monthWonValue)),
      hint: t.cards.monthWins(format.number(sum(all, (member) => member.monthWins))),
      alert: false,
    },
  ];

  const flagLabel = (flag: AttentionFlag) => {
    if (flag.kind === 'overdue') return t.attention.overdue(format.number(flag.count));
    if (flag.kind === 'waiting') return t.attention.waiting(ago(flag.since));
    return flag.since ? t.attention.away(ago(flag.since)) : t.attention.neverSignedIn;
  };
  const needsAttention = all
    .map((member) => ({ member, flags: attentionFor(member, now) }))
    .filter((entry) => entry.flags.length > 0);

  return (
    <>
      <PageHeader
        eyebrow={t.eyebrow}
        title={isRep ? t.headingRep : t.heading}
        description={isRep ? t.descriptionRep : t.description}
      />

      {all.length === 0 ? (
        <div className="rounded-xl border border-[#dfe5e8] bg-white p-8 text-center text-[11px] text-[#89949c]">{t.empty}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {cards.map((card) => (
              <div key={card.key} className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#e4e9eb]">
                <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">{card.label}</p>
                <p className={`mt-2 text-[19px] font-semibold tracking-[-0.04em] ${card.alert ? 'text-[#bd3941]' : 'text-[#17242c]'}`}>
                  {card.value}
                </p>
                {card.hint ? <p className="mt-0.5 text-[10px] text-[#89949c]">{card.hint}</p> : null}
              </div>
            ))}
          </div>

          <section className="mt-5 rounded-xl border border-[#dfe5e8] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#1c2831]">{t.attention.title}</h2>
            <p className="mt-0.5 text-[10px] text-[#8a959d]">{t.attention.hint}</p>
            {needsAttention.length === 0 ? (
              <p className="mt-4 flex items-center gap-2 text-[11px] font-medium text-[#167955]">
                <CrmIcon name="check" className="h-4 w-4" />
                {t.attention.allClear}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[#edf0f1]">
                {needsAttention.map(({ member, flags }) => (
                  <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                    <a href={`#member-${member.userId}`} className="flex min-w-[160px] items-center gap-2 text-[11px] font-semibold text-[#1c2831] hover:text-[#118e82]">
                      <Avatar name={member.displayName} />
                      {member.displayName}
                    </a>
                    <span className="flex flex-wrap gap-1.5">
                      {flags.map((flag) => (
                        <span
                          key={flag.kind}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            flag.kind === 'overdue'
                              ? 'bg-[#ffeaeb] text-[#bd3941]'
                              : flag.kind === 'waiting'
                                ? 'bg-[#fff3dc] text-[#9e6700]'
                                : 'bg-[#edf0f2] text-[#63707a]'
                          }`}
                        >
                          {flagLabel(flag)}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-5 space-y-5">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`group-${group.key}`}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 id={`group-${group.key}`} className="text-sm font-semibold text-[#1c2831]">
                    {/* Isolated, so an Arabic name in the English title keeps the count out of it. */}
                    <bdi>{group.title}</bdi>
                    <span className="ms-2 text-[10px] font-medium text-[#8a959d]">
                      {t.groups.members(format.number(group.members.length))}
                    </span>
                  </h2>
                  {group.members.length > 1 ? (
                    <p className="text-[10px] text-[#6f7d86]">
                      {t.groups.totals(
                        format.number(sum(group.members, (member) => member.waitingLeads)),
                        format.number(sum(group.members, (member) => member.overdue)),
                        format.currency(sum(group.members, (member) => member.pipelineValue)),
                        format.currency(sum(group.members, (member) => member.monthWonValue)),
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.members.map((member) => (
                    <MemberCard
                      key={member.userId}
                      member={member}
                      t={t.member}
                      roleLabel={m.roles[member.role]}
                      ago={ago}
                      number={format.number}
                      currency={format.currency}
                      ownerQuery={ownerQuery(member.userId)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function MemberCard({
  member,
  t,
  roleLabel,
  ago,
  number,
  currency,
  ownerQuery,
}: {
  member: TeamMember;
  t: Messages['teamPage']['member'];
  roleLabel: string;
  ago: (value: Date) => string;
  number: (value: number) => string;
  currency: (value: number) => string;
  ownerQuery: string;
}) {
  const stats: { key: string; label: string; value: string; hint?: string; tone?: 'alert' | 'warn' }[] = [
    {
      key: 'waiting',
      label: t.waiting,
      value: number(member.waitingLeads),
      hint: member.oldestWaitingAt ? t.waitingSince(ago(member.oldestWaitingAt)) : undefined,
      tone: member.waitingLeads > 0 ? 'warn' : undefined,
    },
    { key: 'openLeads', label: t.openLeads, value: number(member.openLeads) },
    { key: 'overdue', label: t.overdue, value: number(member.overdue), tone: member.overdue > 0 ? 'alert' : undefined },
    { key: 'dueToday', label: t.dueToday, value: number(member.dueToday) },
    { key: 'callsToday', label: t.callsToday, value: number(member.callsToday) },
    { key: 'openDeals', label: t.openDeals, value: number(member.openDeals), hint: currency(member.pipelineValue) },
  ];

  return (
    <article id={`member-${member.userId}`} className="scroll-mt-20 rounded-xl border border-[#dfe5e8] bg-white p-4">
      <div className="flex items-start gap-3">
        <Avatar name={member.displayName} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-[#1c2831]">{member.displayName}</p>
          <p className="mt-0.5 text-[10px] text-[#7b8790]">
            {member.role === 'SALES_TEAM_LEADER' ? t.leader : roleLabel}
          </p>
        </div>
        <div className="text-end">
          <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">{t.monthSales}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-[#14815f]">{currency(member.monthWonValue)}</p>
          <p className="text-[10px] text-[#7b8790]">{t.monthWins(number(member.monthWins))}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.key}
            className={`rounded-lg px-2.5 py-2 ${
              stat.tone === 'alert' ? 'bg-[#ffeaeb]' : stat.tone === 'warn' ? 'bg-[#fff6e3]' : 'bg-[#f6f8f9]'
            }`}
          >
            <dt className="text-[9px] font-semibold text-[#7b8790]">{stat.label}</dt>
            <dd
              className={`mt-0.5 text-[15px] font-semibold ${
                stat.tone === 'alert' ? 'text-[#bd3941]' : stat.tone === 'warn' ? 'text-[#9e6700]' : 'text-[#1c2831]'
              }`}
            >
              {stat.value}
            </dd>
            {stat.hint ? <dd className="text-[9px] leading-tight text-[#7b8790]">{stat.hint}</dd> : null}
          </div>
        ))}
      </dl>

      <div className="mt-3 space-y-1 text-[10px] text-[#6f7d86]">
        <p className="flex items-center gap-1.5">
          <CrmIcon name="clock" className="h-3.5 w-3.5 shrink-0" />
          {member.lastSignInAt ? t.lastSignIn(ago(member.lastSignInAt)) : t.neverSignedIn}
        </p>
        <p className="flex items-center gap-1.5">
          <CrmIcon name="phone" className="h-3.5 w-3.5 shrink-0" />
          {member.lastCallAt ? t.lastCall(ago(member.lastCallAt)) : t.noCalls}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#edf0f1] pt-3">
        {[
          { href: `/crm/opportunities${ownerQuery}`, label: t.deals },
          { href: `/crm/quotations${ownerQuery}`, label: t.quotations },
          { href: `/crm/customers${ownerQuery}`, label: t.customers },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#dce2e5] px-2.5 text-[10px] font-semibold text-[#53616b] transition hover:border-[#18b6a4] hover:text-[#118e82]"
          >
            {link.label}
            <CrmIcon name="arrow" className="h-3 w-3" />
          </Link>
        ))}
      </div>
    </article>
  );
}
