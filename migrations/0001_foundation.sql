-- Dental Hub CRM - Foundation v0
-- Identity and session tables only. No sales-domain tables.

CREATE TABLE crm_user (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  text        NOT NULL,
    email         text        NOT NULL,
    password_hash text        NOT NULL,
    role          text        NOT NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    -- Email uniqueness is only meaningful because storage is normalised.
    CONSTRAINT crm_user_email_unique     UNIQUE (email),
    CONSTRAINT crm_user_email_normalised CHECK (email = lower(btrim(email))),

    -- Deliberately structural only. Real validation lives in the Zod schema;
    -- SQL is the wrong place to attempt RFC 5322.
    CONSTRAINT crm_user_email_structure  CHECK (
        position('@' IN email) > 1
        AND position('@' IN email) < length(email)
        AND length(email) - length(replace(email, '@', '')) = 1
    ),

    CONSTRAINT crm_user_display_name_len CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
    CONSTRAINT crm_user_role_known       CHECK (role IN ('ADMIN', 'SALES_MANAGER', 'SALES_REP')),

    -- Makes "passwords are never stored in plaintext" a database fact.
    CONSTRAINT crm_user_password_hashed  CHECK (password_hash LIKE '$argon2%')
);

CREATE TABLE crm_session (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES crm_user (id) ON DELETE CASCADE,
    -- SHA-256 of the opaque token. The token itself is never persisted.
    token_hash bytea       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,

    CONSTRAINT crm_session_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT crm_session_token_hash_len    CHECK (octet_length(token_hash) = 32),

    -- A session must have had a non-empty lifetime. Immediate invalidation is
    -- revoked_at's job, not a zero-or-negative TTL.
    CONSTRAINT crm_session_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX crm_session_user_id_idx ON crm_session (user_id);

-- Supports the single hot-path lookup: resolve a live session by token hash.
CREATE INDEX crm_session_live_idx ON crm_session (token_hash) WHERE revoked_at IS NULL;
