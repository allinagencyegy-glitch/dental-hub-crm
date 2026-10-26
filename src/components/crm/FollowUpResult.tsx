'use client';

import {
  FOLLOW_UP_OUTCOMES,
  NOT_REACHED_OUTCOMES,
  isNotReached,
  type FollowUpOutcome,
} from '@/server/crm/opportunities/followup-actions';
import { useMessages } from '@/i18n/I18nProvider';

const REACHED_OUTCOMES = FOLLOW_UP_OUTCOMES.filter((outcome) => !NOT_REACHED_OUTCOMES.includes(outcome));

/** Results that close the door on this customer for now. */
const NEGATIVE_OUTCOMES: readonly FollowUpOutcome[] = ['NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'WRONG_NUMBER'];

/**
 * The result picker and optional notes every "complete follow-up" dialog
 * shares, so a call is logged the same way from the lead, the deal and the
 * follow-ups queue.
 */
export function FollowUpResultFields({
  outcome,
  onOutcomeChange,
  note,
  onNoteChange,
}: {
  outcome: FollowUpOutcome | null;
  onOutcomeChange: (outcome: FollowUpOutcome | null) => void;
  note: string;
  onNoteChange: (note: string) => void;
}) {
  const m = useMessages();
  const t = m.followUp;
  return (
    <>
      <label className="mt-4 block">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{t.resultLabel}</span>
        <select
          value={outcome ?? ''}
          required
          autoFocus
          onChange={(event) => {
            const value = event.target.value;
            onOutcomeChange(value === '' ? null : (value as FollowUpOutcome));
          }}
          className="mt-1.5 h-9 w-full rounded-lg border border-[#dce2e5] bg-white px-2.5 text-[11px] text-[#33414a] outline-none focus:border-[#18b6a4]"
        >
          <option value="" disabled>
            {t.resultPlaceholder}
          </option>
          <optgroup label={t.notReachedGroup}>
            {NOT_REACHED_OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {m.followUpOutcomes[value]}
              </option>
            ))}
          </optgroup>
          <optgroup label={t.reachedGroup}>
            {REACHED_OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {m.followUpOutcomes[value]}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label className="mt-3 block">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9aa3aa]">{t.notesOptional}</span>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          placeholder={t.notesPlaceholder}
          className="mt-1.5 w-full rounded-lg border border-[#dce2e5] bg-white px-3 py-2 text-[11px] text-[#33414a] outline-none focus:border-[#18b6a4]"
        />
      </label>
    </>
  );
}

/** A completed follow-up's result, with the try number when nobody answered. */
export function FollowUpResultBadge({ outcome, attempt }: { outcome: FollowUpOutcome; attempt?: number }) {
  const m = useMessages();
  const tone = isNotReached(outcome)
    ? 'bg-[#fff6e8] text-[#a8620f]'
    : NEGATIVE_OUTCOMES.includes(outcome)
      ? 'bg-[#f3f4f5] text-[#6c7a83]'
      : 'bg-[#e8f8f1] text-[#14815f]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold ${tone}`}>
      {m.followUpOutcomes[outcome]}
      {attempt !== undefined && attempt > 1 ? ` · ${m.followUp.attempt(attempt)}` : null}
    </span>
  );
}
