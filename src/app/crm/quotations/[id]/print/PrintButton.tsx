'use client';

import { useMessages } from '@/i18n/I18nProvider';

/** Browser Print / Save-as-PDF trigger; hidden in the printed output itself. */
export function PrintButton() {
  const m = useMessages();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#1b3944] print:hidden"
    >
      {m.quotations.print.printButton}
    </button>
  );
}
