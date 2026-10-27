import type { NextRequest } from 'next/server';
import { sameSecret } from '@/server/crm/intake/meta-signature';
import { handleWhatsAppWebhook, MAX_WEBHOOK_BYTES, whatsAppConfig } from '@/server/crm/intake/whatsapp';

/**
 * Meta's WhatsApp webhook. Public on purpose - Meta calls it, nobody signs in -
 * so every POST is checked against the app secret before anything is read
 * (see src/server/crm/intake/whatsapp.ts). Off, and a plain 404, until the
 * three WHATSAPP_* settings are in the server's .env.
 */
export const dynamic = 'force-dynamic';

/** The one-time check Meta makes when the webhook URL is saved. */
export async function GET(request: NextRequest): Promise<Response> {
  const config = whatsAppConfig();
  if (!config) return new Response(null, { status: 404 });

  const params = request.nextUrl.searchParams;
  if (params.get('hub.mode') !== 'subscribe' || !sameSecret(params.get('hub.verify_token'), config.verifyToken)) {
    return new Response(null, { status: 403 });
  }
  return new Response(params.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
}

export async function POST(request: NextRequest): Promise<Response> {
  const config = whatsAppConfig();
  if (!config) return new Response(null, { status: 404 });

  if (Number(request.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BYTES) {
    return new Response(null, { status: 413 });
  }
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > MAX_WEBHOOK_BYTES) return new Response(null, { status: 413 });

  try {
    const status = await handleWhatsAppWebhook(
      { rawBody, signature: request.headers.get('x-hub-signature-256') },
      config,
    );
    return new Response(null, { status });
  } catch (error) {
    // Meta retries a failed delivery, and stored messages are skipped on the
    // retry. The log keeps the reason, never the delivery itself (a database
    // error's message names the constraint; its detail, with values, is left out).
    console.error('WhatsApp webhook failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
    return new Response(null, { status: 500 });
  }
}
