-- Dental Hub CRM - CRM Domain Slice 1 (identity)
-- Accounts, contacts, their many-to-many relationship, and contact channels
-- carrying the canonical phone identity.
--
-- Locked identity rules implemented here:
--   * crm_contact has NO account_id. Contacts relate to accounts only through
--     crm_account_contact, so one contact can belong to many accounts.
--   * PHONE is the canonical telephone identity. Values are stored as E.164
--     (Egyptian local numbers are normalised with default country EG by the
--     repository before insert; the CHECK below makes a non-E.164 value
--     unrepresentable).
--   * A canonical phone value is globally unique: it can never belong to two
--     contacts.
--   * WHATSAPP is not an identity namespace. is_whatsapp is only a capability
--     flag on a PHONE channel.
--   * Email is stored lowercased and trimmed.

-- ---------------------------------------------------------------------------
-- crm_account: an organisation Dental Hub sells to (clinic, lab, office...).
--
-- The account name is deliberately NOT unique: two unrelated accounts can
-- legitimately share a trading name. Identity is the uuid, not the name.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_account (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text        NOT NULL,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_account_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200)
);

-- ---------------------------------------------------------------------------
-- crm_contact: a person. No account_id column - see crm_account_contact.
--
-- Nullable-UNIQUE audit (PostgreSQL 17 supports UNIQUE NULLS NOT DISTINCT):
-- email is UNIQUE with the default NULLS DISTINCT semantics. That is the
-- deliberate choice: many contacts may have no email recorded at all, while a
-- recorded email identifies exactly one contact. NULLS NOT DISTINCT would have
-- allowed only one email-less contact in the whole CRM, which is wrong here.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_contact (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name  text        NOT NULL,
    email      text,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_contact_email_unique     UNIQUE (email),
    CONSTRAINT crm_contact_email_normalised CHECK (email = lower(btrim(email))),

    -- Structural only, mirroring crm_user: real validation is the
    -- repository's job, SQL is the wrong place to attempt RFC 5322.
    CONSTRAINT crm_contact_email_structure  CHECK (
        email IS NULL OR (
            position('@' IN email) > 1
            AND position('@' IN email) < length(email)
            AND length(email) - length(replace(email, '@', '')) = 1
        )
    ),

    CONSTRAINT crm_contact_full_name_len CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200)
);

-- ---------------------------------------------------------------------------
-- crm_account_contact: the only place accounts and contacts meet.
-- Surrogate id primary key, following the locked table convention; the
-- (account_id, contact_id) pair unique constraint makes the same relationship
-- twice unrepresentable, while leaving a contact free to relate to many
-- accounts.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_account_contact (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid        NOT NULL REFERENCES crm_account (id) ON DELETE RESTRICT,
    contact_id uuid        NOT NULL REFERENCES crm_contact (id) ON DELETE RESTRICT,
    is_primary boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_account_contact_pair_unique UNIQUE (account_id, contact_id)
);

-- Reverse lookup: every account a contact belongs to.
CREATE INDEX crm_account_contact_contact_id_idx ON crm_account_contact (contact_id);

-- At most one primary contact per account. Not the inverse: a contact may
-- legitimately be the primary contact of several accounts.
CREATE UNIQUE INDEX crm_account_contact_one_primary_idx
    ON crm_account_contact (account_id) WHERE is_primary;

-- ---------------------------------------------------------------------------
-- crm_contact_channel: a reachable endpoint of a contact. PHONE is the only
-- channel type in Slice 1; new types arrive via new migrations, at which
-- point the value format CHECK is re-scoped per type.
--
-- Delete policy: RESTRICT, like every CRM FK. Rows are retired with
-- is_active, never silently removed - a channel is identity history.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_contact_channel (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id   uuid        NOT NULL REFERENCES crm_contact (id) ON DELETE RESTRICT,
    channel_type text        NOT NULL,
    value        text        NOT NULL,
    is_whatsapp  boolean     NOT NULL DEFAULT false,
    is_active    boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_contact_channel_type_known CHECK (channel_type IN ('PHONE')),

    -- E.164: '+', a non-zero country-code digit, then 6-14 further digits.
    -- Applies while PHONE is the only channel type.
    CONSTRAINT crm_contact_channel_value_e164 CHECK (value ~ '^\+[1-9][0-9]{6,14}$'),

    -- WhatsApp is a capability of a phone number, never its own identity.
    CONSTRAINT crm_contact_channel_whatsapp_phone_only CHECK (
        channel_type = 'PHONE' OR is_whatsapp = false
    )
);

CREATE INDEX crm_contact_channel_contact_id_idx ON crm_contact_channel (contact_id);

-- The canonical phone identity is global: one E.164 value, one contact,
-- regardless of lifecycle state. Applies to PHONE rows only, so future
-- channel types are not drawn into the phone namespace.
CREATE UNIQUE INDEX crm_contact_channel_phone_value_unique
    ON crm_contact_channel (value) WHERE channel_type = 'PHONE';
