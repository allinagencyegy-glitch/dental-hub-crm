'use client';

import type { WhatsAppMessageEntry } from '@/server/crm/intake/repository';
import type { Messages } from '@/i18n/messages';
import { useFormatters, useMessages } from '@/i18n/I18nProvider';
import { isolate } from '@/i18n/notification';

function noTextLabel(type: string, t: Messages['whatsApp']['noText']): string {
  return type in t ? t[type as keyof typeof t] : t.other;
}

/**
 * What the customer wrote on WhatsApp, oldest first. Read-only: the reply is
 * sent from WhatsApp itself, so the link opens the chat there. Draws nothing
 * when the customer never wrote.
 */
export function WhatsAppMessages({ messages, phone }: { messages: WhatsAppMessageEntry[]; phone: string | null }) {
  const m = useMessages();
  const format = useFormatters();
  const t = m.whatsApp;
  if (messages.length === 0) return null;

  return (
    <section className="rounded-xl bg-white border border-[#dfe5e8] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1c2831]">{t.title}</h2>
          <p className="mt-0.5 text-[10px] text-[#8a959d]">{t.hint}</p>
        </div>
        {phone ? (
          <a
            href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[#cfe9dc] bg-[#e6f8ee] px-3 py-1.5 text-[10px] font-bold text-[#168254] transition hover:bg-[#d8f2e4]"
          >
            {t.openChat}
          </a>
        ) : null}
      </div>
      <ol className="mt-4 space-y-2.5 border-t border-[#e5eaec] pt-4">
        {messages.map((message) => (
          <li key={message.id} className="max-w-[85%] rounded-xl rounded-ss-sm bg-[#f2f7f5] px-3.5 py-2.5">
            {message.adHeadline ? (
              <p className="mb-1 text-[9px] font-bold text-[#168254]">
                {t.fromAd(isolate(message.adHeadline))}
              </p>
            ) : null}
            {message.body ? (
              <p className="whitespace-pre-line break-words text-[11px] leading-5 text-[#26333c]" dir="auto">
                {message.body}
              </p>
            ) : (
              <p className="text-[11px] italic text-[#6c7881]">{noTextLabel(message.type, t.noText)}</p>
            )}
            {message.body && message.type in t.noText ? (
              <p className="mt-0.5 text-[9px] text-[#6c7881]">{noTextLabel(message.type, t.noText)}</p>
            ) : null}
            <p className="mt-1 text-[9px] text-[#8b969e]">
              {format.date(message.sentAt)} · {format.time(message.sentAt)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
