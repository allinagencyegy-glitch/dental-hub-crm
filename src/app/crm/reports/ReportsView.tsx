'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { REPORT_PERIODS, type ReportPeriod } from '@/server/crm/reports/period';
import type { ReportBreakdownRow, ReportPersonRow, SalesReport } from '@/server/crm/reports/repository';
import { catalogLabel } from '@/i18n/format';
import { INTL_LOCALE } from '@/i18n/config';
import { useFormatters, useLocale, useMessages } from '@/i18n/I18nProvider';

type Cell = string | number;

/** Saves rows as a CSV file Excel opens with Arabic intact (UTF-8 with a BOM). */
function downloadCsv(fileName: string, rows: Cell[][]) {
  const escape = (cell: Cell) => {
    const text = String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = '﻿' + rows.map((row) => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** A calendar date string shown in the reader's language (noon UTC is the same day in Cairo). */
function calendarDate(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function Section({
  title,
  hint,
  onExport,
  exportLabel,
  children,
}: {
  title: string;
  hint?: string;
  onExport?: () => void;
  exportLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#dfe5e8] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1c2831]">{title}</h2>
          {hint ? <p className="mt-0.5 text-[10px] text-[#8a959d]">{hint}</p> : null}
        </div>
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce2e5] bg-white px-3 text-[10px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
          >
            <CrmIcon name="reports" className="h-3.5 w-3.5" />
            {exportLabel}
          </button>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ReportsView({ report, period }: { report: SalesReport; period: ReportPeriod }) {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const format = useFormatters();
  const t = m.reports;

  const [from, setFrom] = useState(report.dates.startDate);
  const [to, setTo] = useState(report.dates.endDate);

  const percentFormat = new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'percent', maximumFractionDigits: 0 });
  const percent = (part: number, whole: number) => (whole > 0 ? percentFormat.format(part / whole) : '—');
  const monthFormat = new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-01T12:00:00Z`));
  const fileName = (section: string) => `dental-hub-${section}-${report.dates.startDate}_${report.dates.endDate}.csv`;

  const choosePeriod = (next: ReportPeriod) => {
    if (next === 'custom') {
      router.push(`/crm/reports?period=custom&from=${from}&to=${to}`);
    } else {
      router.push(next === 'thisMonth' ? '/crm/reports' : `/crm/reports?period=${next}`);
    }
  };

  // Totals over everyone in scope.
  const sum = (key: keyof ReportPersonRow) =>
    report.people.reduce((total, row) => total + (typeof row[key] === 'number' ? (row[key] as number) : 0), 0);
  const totals = {
    newLeads: sum('newLeads'),
    qualified: sum('qualified'),
    quotationsSent: sum('quotationsSent'),
    wins: sum('wins'),
    wonValue: sum('wonValue'),
    losses: sum('losses'),
    callsLogged: sum('callsLogged'),
    callsReached: sum('callsReached'),
  };

  const cards = [
    { key: 'newLeads', label: t.cards.newLeads, value: format.number(totals.newLeads), hint: null },
    { key: 'qualified', label: t.cards.qualified, value: format.number(totals.qualified), hint: null },
    { key: 'wins', label: t.cards.wins, value: format.number(totals.wins), hint: null },
    { key: 'wonValue', label: t.cards.wonValue, value: format.currency(totals.wonValue), hint: null },
    { key: 'conversion', label: t.cards.conversion, value: percent(totals.wins, totals.newLeads), hint: null },
    {
      key: 'calls',
      label: t.cards.calls,
      value: format.number(totals.callsLogged),
      hint: totals.callsLogged > 0 ? t.cards.reachRate(percent(totals.callsReached, totals.callsLogged)) : null,
    },
  ];

  // People grouped by team, in the order the report gives them.
  const groups: { team: string | null; people: ReportPersonRow[] }[] = [];
  for (const person of report.people) {
    const last = groups[groups.length - 1];
    if (last && last.team === person.teamName) last.people.push(person);
    else groups.push({ team: person.teamName, people: [person] });
  }
  const groupTotal = (people: ReportPersonRow[], key: keyof ReportPersonRow) =>
    people.reduce((total, row) => total + (row[key] as number), 0);

  const personCells = (row: Pick<ReportPersonRow, 'newLeads' | 'qualified' | 'quotationsSent' | 'wins' | 'wonValue' | 'losses' | 'callsLogged' | 'callsReached'>) => [
    format.number(row.newLeads),
    format.number(row.qualified),
    format.number(row.quotationsSent),
    format.number(row.wins),
    format.currency(row.wonValue),
    format.number(row.losses),
    percent(row.wins, row.newLeads),
    `${format.number(row.callsLogged)} (${format.number(row.callsReached)})`,
  ];

  const exportTeam = () =>
    downloadCsv(fileName('team'), [
      [t.team.person, t.team.team, t.team.newLeads, t.team.qualified, t.team.quotationsSent, t.team.wins, t.team.wonValue, t.team.losses, t.team.calls],
      ...report.people.map((row) => [
        row.displayName,
        row.teamName ?? t.team.noTeam,
        row.newLeads,
        row.qualified,
        row.quotationsSent,
        row.wins,
        row.wonValue,
        row.losses,
        `${row.callsLogged} (${row.callsReached})`,
      ]),
    ]);

  const breakdownTable = (rows: ReportBreakdownRow[], nameHeader: string, label: (row: ReportBreakdownRow) => string) =>
    rows.length === 0 ? (
      <p className="text-[11px] text-[#89949c]">{t.breakdown.empty}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-start">
          <thead className="border-b border-[#e5eaec] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
            <tr>
              <th className="py-2 pe-3 text-start">{nameHeader}</th>
              <th className="px-3 py-2 text-end">{t.breakdown.leads}</th>
              <th className="px-3 py-2 text-end">{t.breakdown.qualified}</th>
              <th className="px-3 py-2 text-end">{t.breakdown.wins}</th>
              <th className="px-3 py-2 text-end">{t.breakdown.conversion}</th>
              <th className="py-2 ps-3 text-end">{t.breakdown.wonValue}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf0f1] text-[11px] text-[#33414a]">
            {rows.map((row) => (
              <tr key={row.code}>
                <td className="py-2.5 pe-3 font-semibold">{label(row)}</td>
                <td className="px-3 py-2.5 text-end">{format.number(row.leads)}</td>
                <td className="px-3 py-2.5 text-end">{format.number(row.qualified)}</td>
                <td className="px-3 py-2.5 text-end">{format.number(row.wins)}</td>
                <td className="px-3 py-2.5 text-end">{percent(row.wins, row.leads)}</td>
                <td className="py-2.5 ps-3 text-end font-semibold">{format.currency(row.wonValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const exportBreakdown = (section: string, nameHeader: string, rows: ReportBreakdownRow[], label: (row: ReportBreakdownRow) => string) =>
    downloadCsv(fileName(section), [
      [nameHeader, t.breakdown.leads, t.breakdown.qualified, t.breakdown.wins, t.breakdown.wonValue],
      ...rows.map((row) => [label(row), row.leads, row.qualified, row.wins, row.wonValue]),
    ]);

  const categoryLabel = (row: ReportBreakdownRow) => catalogLabel(m.catalog.productCategories, row.code, row.name);
  const sourceLabel = (row: ReportBreakdownRow) => catalogLabel(m.catalog.sources, row.code, row.name);

  const maxMonthValue = Math.max(1, ...report.months.map((month) => month.wonValue));
  const totalCalls = report.outcomes.reduce((total, row) => total + row.count, 0);
  const maxOutcome = Math.max(1, ...report.outcomes.map((row) => row.count));

  const reasonList = (rows: SalesReport['lostReasons'], labels: Readonly<Record<string, string>>, empty: string) =>
    rows.length === 0 ? (
      <p className="text-[11px] text-[#89949c]">{empty}</p>
    ) : (
      <ul className="divide-y divide-[#edf0f1]">
        {rows.map((row) => (
          <li key={row.code} className="flex items-center justify-between gap-3 py-2 text-[11px]">
            <span className="text-[#33414a]">{catalogLabel(labels, row.code, row.label)}</span>
            <span className="font-semibold text-[#1c2831]">{format.number(row.count)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.heading} description={t.description} />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[#dfe5e8] bg-white p-3.5">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_PERIODS.filter((option) => option !== 'custom').map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => choosePeriod(option)}
              className={`h-8 rounded-lg px-3 text-[11px] font-semibold transition ${
                period === option ? 'bg-[#18b6a4] text-white' : 'border border-[#dce2e5] text-[#53616b] hover:bg-[#f7f9fa]'
              }`}
            >
              {t.periods[option]}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            choosePeriod('custom');
          }}
        >
          <label className="text-[10px] font-semibold text-[#7b8790]">
            <span className="mb-1 block">{t.from}</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="h-8 rounded-lg border border-[#dce2e5] px-2 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            />
          </label>
          <label className="text-[10px] font-semibold text-[#7b8790]">
            <span className="mb-1 block">{t.to}</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className="h-8 rounded-lg border border-[#dce2e5] px-2 text-[11px] text-[#3c4a54] outline-none focus:border-[#18b6a4]"
            />
          </label>
          <button
            type="submit"
            className={`h-8 rounded-lg px-3 text-[11px] font-semibold transition ${
              period === 'custom' ? 'bg-[#18b6a4] text-white' : 'bg-[#132932] text-white hover:bg-[#1b3944]'
            }`}
          >
            {t.apply}
          </button>
        </form>
      </div>
      <p className="mt-2 text-[11px] font-medium text-[#53616b]">
        {t.periodLine(format.date(calendarDate(report.dates.startDate)), format.date(calendarDate(report.dates.endDate)))}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.key} className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(20,35,45,0.04)] ring-1 ring-[#e4e9eb]">
            <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[#7e8992]">{card.label}</p>
            <p className="mt-2 text-[19px] font-semibold tracking-[-0.04em] text-[#17242c]">{card.value}</p>
            {card.hint ? <p className="mt-0.5 text-[10px] text-[#89949c]">{card.hint}</p> : null}
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-5">
        <Section title={t.team.title} hint={t.team.hint} onExport={exportTeam} exportLabel={t.exportCsv}>
          {report.people.length === 0 ? (
            <p className="text-[11px] text-[#89949c]">{t.team.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-start">
                <thead className="border-b border-[#e5eaec] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]">
                  <tr>
                    <th className="py-2 pe-3 text-start">{t.team.person}</th>
                    <th className="px-3 py-2 text-end">{t.team.newLeads}</th>
                    <th className="px-3 py-2 text-end">{t.team.qualified}</th>
                    <th className="px-3 py-2 text-end">{t.team.quotationsSent}</th>
                    <th className="px-3 py-2 text-end">{t.team.wins}</th>
                    <th className="px-3 py-2 text-end">{t.team.wonValue}</th>
                    <th className="px-3 py-2 text-end">{t.team.losses}</th>
                    <th className="px-3 py-2 text-end">{t.team.conversion}</th>
                    <th className="py-2 ps-3 text-end">{t.team.calls}</th>
                  </tr>
                </thead>
                <tbody className="text-[11px] text-[#33414a]">
                  {groups.map((group) => (
                    <TeamRows
                      key={group.team ?? '-'}
                      title={group.team ?? t.team.noTeam}
                      people={group.people}
                      totalLabel={group.team && group.people.length > 1 ? t.team.teamTotal(group.team) : null}
                      personCells={personCells}
                      groupTotal={groupTotal}
                      roleLabel={(role) => (role in m.roles ? m.roles[role as keyof typeof m.roles] : role)}
                    />
                  ))}
                  <tr className="border-t-2 border-[#dfe5e8] bg-[#f8fafb] font-bold text-[#1c2831]">
                    <td className="py-2.5 pe-3">{t.team.total}</td>
                    {personCells(totals).map((cell, index) => (
                      <td key={index} className={`py-2.5 text-end ${index === 7 ? 'ps-3' : 'px-3'}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title={t.trend.title}
          hint={t.trend.hint}
          exportLabel={t.exportCsv}
          onExport={() =>
            downloadCsv(fileName('months'), [
              [t.trend.month, t.trend.newLeads, t.trend.wins, t.trend.wonValue],
              ...report.months.map((month) => [month.month, month.newLeads, month.wins, month.wonValue]),
            ])
          }
        >
          <div className="overflow-x-auto">
            <div className="flex min-w-[640px] items-end gap-2">
              {report.months.map((month) => (
                <div
                  key={month.month}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${monthLabel(month.month)} · ${format.currency(month.wonValue)} · ${t.trend.wins}: ${month.wins} · ${t.trend.newLeads}: ${month.newLeads}`}
                >
                  <span className="text-[9px] font-semibold text-[#53616b]">{month.wins > 0 ? format.number(month.wins) : ''}</span>
                  <div className="flex h-36 w-full items-end">
                    <div
                      className="w-full rounded-t-md bg-[#18b6a4]"
                      style={{ height: `${Math.max(month.wonValue > 0 ? 4 : 1, (month.wonValue / maxMonthValue) * 100)}%`, opacity: month.wonValue > 0 ? 1 : 0.25 }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-[9px] font-semibold text-[#53616b]">{monthLabel(month.month)}</span>
                  <span className="whitespace-nowrap text-[9px] text-[#929da4]">{format.number(month.newLeads)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-[#8a959d]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[#18b6a4]" />
              {t.trend.wonValue}
            </span>
            <span>{t.trend.legendWins}</span>
            <span>{t.trend.legendLeads}</span>
          </p>
        </Section>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section
            title={t.categories.title}
            hint={t.categories.hint}
            exportLabel={t.exportCsv}
            onExport={() => exportBreakdown('products', t.categories.name, report.categories, categoryLabel)}
          >
            {breakdownTable(report.categories, t.categories.name, categoryLabel)}
          </Section>
          <Section
            title={t.sources.title}
            hint={t.sources.hint}
            exportLabel={t.exportCsv}
            onExport={() => exportBreakdown('sources', t.sources.name, report.sources, sourceLabel)}
          >
            {breakdownTable(report.sources, t.sources.name, sourceLabel)}
          </Section>
        </div>

        <Section
          title={t.outcomes.title}
          hint={t.outcomes.hint}
          exportLabel={t.exportCsv}
          onExport={() =>
            downloadCsv(fileName('calls'), [
              [t.outcomes.result, t.outcomes.count],
              ...report.outcomes.map((row) => [m.followUpOutcomes[row.outcome], row.count]),
            ])
          }
        >
          {report.outcomes.length === 0 ? (
            <p className="text-[11px] text-[#89949c]">{t.outcomes.empty}</p>
          ) : (
            <ul className="space-y-2">
              {report.outcomes.map((row) => (
                <li key={row.outcome} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-[11px]">
                  <span className="truncate text-[#33414a]">{m.followUpOutcomes[row.outcome]}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-[#eef2f3]">
                    <span className="block h-full rounded-full bg-[#18b6a4]" style={{ width: `${(row.count / maxOutcome) * 100}%` }} />
                  </span>
                  <span className="whitespace-nowrap font-semibold text-[#1c2831]">
                    {format.number(row.count)} <span className="font-normal text-[#929da4]">({percent(row.count, totalCalls)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid gap-5 xl:grid-cols-2">
          <Section title={t.lostReasons.title} exportLabel={t.exportCsv}>
            {reasonList(report.lostReasons, m.catalog.lostReasons, t.lostReasons.empty)}
          </Section>
          <Section title={t.disqualifyReasons.title} exportLabel={t.exportCsv}>
            {reasonList(report.disqualifyReasons, m.catalog.disqualifyReasons, t.disqualifyReasons.empty)}
          </Section>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-[#98a2a9]">{t.valueNote}</p>
    </>
  );
}

function TeamRows({
  title,
  people,
  totalLabel,
  personCells,
  groupTotal,
  roleLabel,
}: {
  title: string;
  people: ReportPersonRow[];
  totalLabel: string | null;
  personCells: (row: Pick<ReportPersonRow, 'newLeads' | 'qualified' | 'quotationsSent' | 'wins' | 'wonValue' | 'losses' | 'callsLogged' | 'callsReached'>) => string[];
  groupTotal: (people: ReportPersonRow[], key: keyof ReportPersonRow) => number;
  roleLabel: (role: string) => string;
}) {
  const subtotal = {
    newLeads: groupTotal(people, 'newLeads'),
    qualified: groupTotal(people, 'qualified'),
    quotationsSent: groupTotal(people, 'quotationsSent'),
    wins: groupTotal(people, 'wins'),
    wonValue: groupTotal(people, 'wonValue'),
    losses: groupTotal(people, 'losses'),
    callsLogged: groupTotal(people, 'callsLogged'),
    callsReached: groupTotal(people, 'callsReached'),
  };
  return (
    <>
      <tr className="border-t border-[#e5eaec] bg-[#f8fafb]">
        <td colSpan={9} className="py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#128d81]">
          {title}
        </td>
      </tr>
      {people.map((person) => (
        <tr key={person.userId} className="border-t border-[#edf0f1]">
          <td className="py-2.5 pe-3">
            <p className="font-semibold text-[#1c2831]">{person.displayName}</p>
            <p className="text-[9px] text-[#929da4]">{roleLabel(person.role)}</p>
          </td>
          {personCells(person).map((cell, index) => (
            <td key={index} className={`py-2.5 text-end ${index === 7 ? 'ps-3' : 'px-3'}`}>
              {cell}
            </td>
          ))}
        </tr>
      ))}
      {totalLabel ? (
        <tr className="border-t border-[#e5eaec] font-semibold text-[#1c2831]">
          <td className="py-2.5 pe-3 text-[10px]">{totalLabel}</td>
          {personCells(subtotal).map((cell, index) => (
            <td key={index} className={`py-2.5 text-end ${index === 7 ? 'ps-3' : 'px-3'}`}>
              {cell}
            </td>
          ))}
        </tr>
      ) : null}
    </>
  );
}
