import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  type DisposableDatabase,
} from '../../scripts/test-db';
import { runMigrations } from '../../src/server/db/migrator';
import { createUser, setUserTeamLeader } from '../../src/server/users/repository';
import { qualifyLeadUseCase, type Actor } from '../../src/server/crm/opportunities/service';
import { markAllNotificationsReadUseCase } from '../../src/server/crm/notifications/service';
import { parseWhatsAppWebhook, type WhatsAppInboundMessage } from '../../src/server/crm/intake/whatsapp-payload';
import { isValidMetaSignature, sameSecret } from '../../src/server/crm/intake/meta-signature';
import {
  handleWhatsAppWebhook,
  NoWhatsAppOwnerError,
  receiveWhatsAppMessage,
  whatsAppConfig,
  type WhatsAppConfig,
} from '../../src/server/crm/intake/whatsapp';
import { listWhatsAppMessages } from '../../src/server/crm/intake/repository';
import { uniqueToken } from './setup/db';

const now = new Date('2026-10-27T09:00:00Z');

/** A delivery as Meta sends it: one change on our number, with its messages. */
function delivery(messages: unknown[], contacts: unknown[] = [], phoneNumberId = 'PNID-1') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '201000000000', phone_number_id: phoneNumberId },
              contacts,
              messages,
            },
          },
        ],
      },
    ],
  };
}

describe('reading a WhatsApp delivery', () => {
  it('returns each customer message with the sender, the text and the ad they came from', () => {
    const payload = delivery(
      [
        {
          from: '201001234567',
          id: 'wamid.A',
          timestamp: '1793091600',
          type: 'text',
          text: { body: '  عايز سعر الكرسي  ' },
          referral: { headline: 'Roson R2 Pro', source_url: 'https://fb.me/ad', source_type: 'ad' },
        },
        { from: '201001234567', id: 'wamid.B', timestamp: '1793091660', type: 'image', image: { caption: 'زي ده' } },
        { from: '201001234567', id: 'wamid.C', timestamp: '1793091720', type: 'audio', audio: { id: 'media-1' } },
        { from: '201001234567', id: 'wamid.D', timestamp: '1793091780', type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Yes' } } },
      ],
      [{ profile: { name: 'Dr. Mona' }, wa_id: '201001234567' }],
    );

    expect(parseWhatsAppWebhook(payload, now)).toEqual([
      {
        phoneNumberId: 'PNID-1',
        waMessageId: 'wamid.A',
        fromPhone: '+201001234567',
        profileName: 'Dr. Mona',
        type: 'text',
        body: 'عايز سعر الكرسي',
        adHeadline: 'Roson R2 Pro',
        adSourceUrl: 'https://fb.me/ad',
        sentAt: new Date(1793091600 * 1000),
      },
      expect.objectContaining({ waMessageId: 'wamid.B', type: 'image', body: 'زي ده', adHeadline: null }),
      expect.objectContaining({ waMessageId: 'wamid.C', type: 'audio', body: null }),
      expect.objectContaining({ waMessageId: 'wamid.D', type: 'interactive', body: 'Yes' }),
    ]);
  });

  it('leaves out receipts, reactions and anything it cannot tell who sent', () => {
    const receipts = delivery([]);
    (receipts.entry[0].changes[0].value as Record<string, unknown>).statuses = [{ id: 'wamid.X', status: 'read' }];
    expect(parseWhatsAppWebhook(receipts, now)).toEqual([]);

    expect(
      parseWhatsAppWebhook(
        delivery([
          { from: '201001234567', id: 'wamid.R', timestamp: '1', type: 'reaction', reaction: { emoji: '👍' } },
          { from: 'not-a-number', id: 'wamid.S', timestamp: '1', type: 'text', text: { body: 'hi' } },
          { from: '201001234567', timestamp: '1', type: 'text', text: { body: 'no id' } },
          'garbage',
        ]),
        now,
      ),
    ).toEqual([]);
    expect(parseWhatsAppWebhook({ object: 'page', entry: [] }, now)).toEqual([]);
    expect(parseWhatsAppWebhook(null, now)).toEqual([]);
  });

  it('falls back to the time it arrived when the timestamp is unreadable', () => {
    const [message] = parseWhatsAppWebhook(
      delivery([{ from: '201001234567', id: 'wamid.T', timestamp: 'soon', type: 'text', text: { body: 'hi' } }]),
      now,
    );
    expect(message.sentAt).toEqual(now);
    expect(message.profileName).toBeNull();
  });
});

describe('checking a delivery came from Meta', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts only an HMAC of the exact bytes with the app secret', () => {
    expect(isValidMetaSignature(body, sign('app-secret'), 'app-secret')).toBe(true);
    expect(isValidMetaSignature(body, sign('another-secret'), 'app-secret')).toBe(false);
    expect(isValidMetaSignature(Buffer.concat([body, Buffer.from(' ')]), sign('app-secret'), 'app-secret')).toBe(false);
    expect(isValidMetaSignature(body, null, 'app-secret')).toBe(false);
    expect(isValidMetaSignature(body, 'sha256=zz', 'app-secret')).toBe(false);
    expect(isValidMetaSignature(body, sign('app-secret').replace('sha256=', 'sha1='), 'app-secret')).toBe(false);
  });

  it('compares the verify token exactly', () => {
    expect(sameSecret('token', 'token')).toBe(true);
    expect(sameSecret('token ', 'token')).toBe(false);
    expect(sameSecret(null, 'token')).toBe(false);
  });

  it('is switched on only by all three settings', () => {
    const env = { WHATSAPP_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: ' 123 ' };
    expect(whatsAppConfig(env)).toEqual({ appSecret: 's', verifyToken: 't', phoneNumberId: '123' });
    expect(whatsAppConfig({ ...env, WHATSAPP_PHONE_NUMBER_ID: '' })).toBeNull();
    expect(whatsAppConfig({})).toBeNull();
  });
});

describe('WhatsApp intake', () => {
  let database: DisposableDatabase;
  let client: Client;
  const manager: Actor = { userId: '', role: 'SALES_MANAGER' };
  const leader: Actor = { userId: '', role: 'SALES_TEAM_LEADER' };
  const repA: Actor = { userId: '', role: 'SALES_REP' };
  const repB: Actor = { userId: '', role: 'SALES_REP' };
  let sequence = 0;

  function message(phone: string, overrides: Partial<WhatsAppInboundMessage> = {}): WhatsAppInboundMessage {
    sequence += 1;
    return {
      phoneNumberId: 'PNID-1',
      waMessageId: `wamid.${uniqueToken('m')}`,
      fromPhone: phone,
      profileName: 'Dr. Customer',
      type: 'text',
      body: `message ${sequence}`,
      adHeadline: null,
      adSourceUrl: null,
      sentAt: new Date(now.getTime() + sequence * 60_000),
      ...overrides,
    };
  }

  /** A new Egyptian mobile number for each customer. */
  let phoneCounter = 0;
  function newPhone(): string {
    phoneCounter += 1;
    return `+2010${String(10_000_000 + phoneCounter).slice(-8)}`;
  }

  async function noticesFor(leadId: string, opportunityId: string | null = null) {
    const { rows } = await client.query<{ kind: string; recipient_user_id: string; read_at: Date | null }>(
      `SELECT kind, recipient_user_id, read_at FROM crm_notification
        WHERE lead_id = $1 OR opportunity_id = $2 ORDER BY created_at, recipient_user_id`,
      [leadId, opportunityId],
    );
    return rows;
  }

  beforeAll(async () => {
    database = await createDisposableDatabase();
    client = new Client({ connectionString: database.url });
    await client.connect();
    await runMigrations(client);

    const mkUser = async (name: string, role: Actor['role']) =>
      (await createUser(client, { displayName: name, email: `${uniqueToken(role)}@test.com`, password: 'Password123!', role })).id;
    manager.userId = await mkUser('Mona Manager', 'SALES_MANAGER');
    leader.userId = await mkUser('Lina Leader', 'SALES_TEAM_LEADER');
    repA.userId = await mkUser('Rep A', 'SALES_REP');
    repB.userId = await mkUser('Rep B', 'SALES_REP');
    await setUserTeamLeader(client, repA.userId, leader.userId);
  });

  afterAll(async () => {
    await client?.end();
    if (database) await dropDisposableDatabase(database);
  });

  it('makes a new customer a WhatsApp lead and tells its owner, the managers and the team leader', async () => {
    const phone = newPhone();
    const first = message(phone, { adHeadline: 'Roson R2 Pro' });
    const result = await receiveWhatsAppMessage(client, first);
    if (result.outcome !== 'NEW_LEAD') throw new Error(`expected a new lead, got ${result.outcome}`);

    // Rep A was created first and has had no WhatsApp lead yet.
    expect(result.ownerUserId).toBe(repA.userId);
    const { rows } = await client.query(
      `SELECT l.status, l.owner_user_id, l.received_at, l.note, s.code AS source, c.full_name, ch.value, ch.is_whatsapp
         FROM crm_lead l
         JOIN crm_source s ON s.id = l.source_id
         JOIN crm_contact c ON c.id = l.contact_id
         JOIN crm_contact_channel ch ON ch.contact_id = c.id
        WHERE l.id = $1`,
      [result.leadId],
    );
    expect(rows).toEqual([
      {
        status: 'NEW',
        owner_user_id: repA.userId,
        received_at: first.sentAt,
        note: null,
        source: 'whatsapp',
        full_name: 'Dr. Customer',
        value: phone,
        is_whatsapp: true,
      },
    ]);

    const notices = await noticesFor(result.leadId);
    expect(notices.map((n) => `${n.kind} ${n.recipient_user_id}`).sort()).toEqual(
      [`WHATSAPP_LEAD ${repA.userId}`, `WHATSAPP_LEAD ${manager.userId}`, `WHATSAPP_LEAD ${leader.userId}`].sort(),
    );

    expect(await listWhatsAppMessages(client, repA, { leadId: result.leadId })).toEqual([
      expect.objectContaining({ type: 'text', body: first.body, adHeadline: 'Roson R2 Pro', sentAt: first.sentAt }),
    ]);
  });

  it('takes turns between the reps, and leaves team leaders and managers out while there are reps', async () => {
    const owners: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await receiveWhatsAppMessage(client, message(newPhone()));
      if (result.outcome !== 'NEW_LEAD') throw new Error('expected a new lead');
      owners.push(result.ownerUserId);
    }
    // Rep A had the first test's lead, so Rep B is next.
    expect(owners).toEqual([repB.userId, repA.userId, repB.userId]);
  });

  it('adds a further message to the open lead and tells the owner once until they look', async () => {
    const phone = newPhone();
    const opened = await receiveWhatsAppMessage(client, message(phone));
    if (opened.outcome !== 'NEW_LEAD') throw new Error('expected a new lead');
    const owner: Actor = opened.ownerUserId === repA.userId ? repA : repB;
    await markAllNotificationsReadUseCase(owner.userId, client);

    expect(await receiveWhatsAppMessage(client, message(phone))).toEqual({ outcome: 'ADDED_TO_LEAD', leadId: opened.leadId });
    expect(await receiveWhatsAppMessage(client, message(phone, { type: 'audio', body: null }))).toEqual({
      outcome: 'ADDED_TO_LEAD',
      leadId: opened.leadId,
    });

    const unread = (await noticesFor(opened.leadId)).filter((n) => n.kind === 'WHATSAPP_MESSAGE');
    expect(unread.map((n) => n.recipient_user_id)).toEqual([owner.userId]);

    // Once read, the next message is news again.
    await markAllNotificationsReadUseCase(owner.userId, client);
    await receiveWhatsAppMessage(client, message(phone));
    expect((await noticesFor(opened.leadId)).filter((n) => n.kind === 'WHATSAPP_MESSAGE')).toHaveLength(2);

    const messages = await listWhatsAppMessages(client, owner, { leadId: opened.leadId });
    expect(messages.map((m) => m.type)).toEqual(['text', 'text', 'audio', 'text']);
    // Still one lead for the customer.
    const { rows } = await client.query(
      `SELECT count(*)::int AS leads FROM crm_lead l JOIN crm_contact_channel ch ON ch.contact_id = l.contact_id WHERE ch.value = $1`,
      [phone],
    );
    expect(rows[0].leads).toBe(1);
  });

  it('changes nothing when Meta delivers the same message again', async () => {
    const repeat = message(newPhone());
    const first = await receiveWhatsAppMessage(client, repeat);
    expect(first.outcome).toBe('NEW_LEAD');
    expect(await receiveWhatsAppMessage(client, repeat)).toEqual({ outcome: 'DUPLICATE' });

    const { rows } = await client.query(`SELECT count(*)::int AS n FROM crm_whatsapp_message WHERE wa_message_id = $1`, [
      repeat.waMessageId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('puts a message about a deal in progress on that deal, for its owner, and opens a new lead once it is closed', async () => {
    const phone = newPhone();
    const opened = await receiveWhatsAppMessage(client, message(phone));
    if (opened.outcome !== 'NEW_LEAD') throw new Error('expected a new lead');
    const qualified = await qualifyLeadUseCase(manager, opened.leadId, { ownerUserId: repB.userId }, client);
    if (!qualified.ok) throw new Error(`qualify failed: ${qualified.error}`);
    const dealId = qualified.opportunity.id;
    const dealOwner = qualified.opportunity.ownerUserId;

    expect(await receiveWhatsAppMessage(client, message(phone))).toEqual({
      outcome: 'ADDED_TO_OPPORTUNITY',
      leadId: opened.leadId,
      opportunityId: dealId,
    });
    const dealNotices = (await noticesFor(opened.leadId, dealId)).filter((n) => n.kind === 'WHATSAPP_MESSAGE');
    expect(dealNotices.map((n) => n.recipient_user_id)).toEqual([dealOwner]);

    // The deal's page shows the whole conversation, to the deal's owner.
    const dealActor: Actor = dealOwner === repA.userId ? repA : dealOwner === repB.userId ? repB : manager;
    expect(await listWhatsAppMessages(client, dealActor, { opportunityId: dealId })).toHaveLength(2);

    await client.query(`UPDATE crm_opportunity SET stage = 'WON', won_at = now() WHERE id = $1`, [dealId]);
    const after = await receiveWhatsAppMessage(client, message(phone));
    expect(after.outcome).toBe('NEW_LEAD');
  });

  it('shows the conversation only to people who may see the lead', async () => {
    const opened = await receiveWhatsAppMessage(client, message(newPhone()));
    if (opened.outcome !== 'NEW_LEAD') throw new Error('expected a new lead');
    const [owner, other] = opened.ownerUserId === repA.userId ? [repA, repB] : [repB, repA];

    expect(await listWhatsAppMessages(client, owner, { leadId: opened.leadId })).toHaveLength(1);
    expect(await listWhatsAppMessages(client, other, { leadId: opened.leadId })).toEqual([]);
    expect(await listWhatsAppMessages(client, manager, { leadId: opened.leadId })).toHaveLength(1);
    // Lina leads Rep A's team only.
    expect(await listWhatsAppMessages(client, leader, { leadId: opened.leadId })).toHaveLength(owner === repA ? 1 : 0);
  });

  it('goes to team leaders, then managers, when there are no reps, and refuses when nobody sells', async () => {
    try {
      await client.query(`UPDATE crm_user SET is_active = false WHERE role = 'SALES_REP'`);
      const toLeader = await receiveWhatsAppMessage(client, message(newPhone()));
      expect(toLeader).toMatchObject({ outcome: 'NEW_LEAD', ownerUserId: leader.userId });

      await client.query(`UPDATE crm_user SET is_active = false WHERE role IN ('SALES_TEAM_LEADER', 'SALES_MANAGER')`);
      const phone = newPhone();
      await expect(receiveWhatsAppMessage(client, message(phone))).rejects.toBeInstanceOf(NoWhatsAppOwnerError);
      // Nothing half-written: Meta's retry will find the message new.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM crm_whatsapp_message WHERE from_phone = $1`,
        [phone],
      );
      expect(rows[0].n).toBe(0);
    } finally {
      await client.query(`UPDATE crm_user SET is_active = true WHERE role <> 'ADMIN'`);
    }
  });

  describe('the webhook', () => {
    const config: WhatsAppConfig = { appSecret: 'app-secret', verifyToken: 'verify', phoneNumberId: 'PNID-1' };
    const signed = (payload: unknown, secret = config.appSecret) => {
      const rawBody = Buffer.from(JSON.stringify(payload));
      return { rawBody, signature: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` };
    };
    const countFrom = async (phone: string) =>
      (await client.query(`SELECT count(*)::int AS n FROM crm_whatsapp_message WHERE from_phone = $1`, [phone])).rows[0].n;

    it('stores the messages sent to our number from a signed delivery', async () => {
      const phone = newPhone();
      const digits = phone.slice(1);
      const payload = delivery(
        [
          { from: digits, id: `wamid.${uniqueToken('w')}`, timestamp: '1793091600', type: 'text', text: { body: 'hello' } },
          { from: digits, id: `wamid.${uniqueToken('w')}`, timestamp: '1793091660', type: 'text', text: { body: 'again' } },
        ],
        [{ profile: { name: 'Webhook Doctor' }, wa_id: digits }],
      );
      expect(await handleWhatsAppWebhook(signed(payload), config, client, now)).toBe(200);
      expect(await countFrom(phone)).toBe(2);
      // Meta retrying the same delivery adds nothing.
      expect(await handleWhatsAppWebhook(signed(payload), config, client, now)).toBe(200);
      expect(await countFrom(phone)).toBe(2);
    });

    it('ignores messages to another number on the same Meta app', async () => {
      const phone = newPhone();
      const payload = delivery(
        [{ from: phone.slice(1), id: `wamid.${uniqueToken('w')}`, timestamp: '1793091600', type: 'text', text: { body: 'hi' } }],
        [],
        'SOMEONE-ELSES-NUMBER',
      );
      expect(await handleWhatsAppWebhook(signed(payload), config, client, now)).toBe(200);
      expect(await countFrom(phone)).toBe(0);
    });

    it('refuses an unsigned or wrongly signed delivery, and one that is not JSON', async () => {
      const phone = newPhone();
      const payload = delivery([
        { from: phone.slice(1), id: `wamid.${uniqueToken('w')}`, timestamp: '1793091600', type: 'text', text: { body: 'hi' } },
      ]);
      expect(await handleWhatsAppWebhook(signed(payload, 'forged'), config, client, now)).toBe(401);
      expect(await handleWhatsAppWebhook({ ...signed(payload), signature: null }, config, client, now)).toBe(401);
      expect(await countFrom(phone)).toBe(0);

      const rawBody = Buffer.from('not json');
      const signature = `sha256=${createHmac('sha256', config.appSecret).update(rawBody).digest('hex')}`;
      expect(await handleWhatsAppWebhook({ rawBody, signature }, config, client, now)).toBe(400);
    });
  });
});
