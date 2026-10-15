'use client';

/** Browser Print / Save-as-PDF trigger; hidden in the printed output itself. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#1b3944] print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
