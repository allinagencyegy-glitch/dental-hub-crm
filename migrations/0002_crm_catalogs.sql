-- Dental Hub CRM - CRM Domain Slice 1 (catalogs)
-- Lead sources and campaigns, product catalog, and outcome reasons.
-- No lead, opportunity, follow-up or activity tables yet.

-- ---------------------------------------------------------------------------
-- crm_source: where inbound interest originates. Codes are the stable,
-- normalised reference key; names are display text.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_source (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text        NOT NULL,
    name       text        NOT NULL,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_source_code_unique      UNIQUE (code),
    -- Uniqueness is only meaningful because storage is normalised.
    CONSTRAINT crm_source_code_normalised  CHECK (code = lower(btrim(code))),
    CONSTRAINT crm_source_name_len         CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

-- ---------------------------------------------------------------------------
-- crm_source_campaign: a named marketing effort attributed to exactly one
-- source. The source cannot be deleted while campaigns reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_source_campaign (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id  uuid        NOT NULL REFERENCES crm_source (id) ON DELETE RESTRICT,
    code       text        NOT NULL,
    name       text        NOT NULL,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- A campaign code is unique within its source, not globally.
    CONSTRAINT crm_source_campaign_source_code_unique UNIQUE (source_id, code),
    CONSTRAINT crm_source_campaign_code_normalised    CHECK (code = lower(btrim(code))),
    CONSTRAINT crm_source_campaign_name_len           CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE INDEX crm_source_campaign_source_id_idx ON crm_source_campaign (source_id);

-- ---------------------------------------------------------------------------
-- crm_product_category: stable grouping for the product catalog.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_product_category (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text        NOT NULL,
    name       text        NOT NULL,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_product_category_code_unique      UNIQUE (code),
    CONSTRAINT crm_product_category_code_normalised  CHECK (code = lower(btrim(code))),
    CONSTRAINT crm_product_category_name_len         CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

-- ---------------------------------------------------------------------------
-- crm_product: a sellable item in exactly one category. The category cannot
-- be deleted while products reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_product (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid        NOT NULL REFERENCES crm_product_category (id) ON DELETE RESTRICT,
    name        text        NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_product_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200)
);

CREATE INDEX crm_product_category_id_idx ON crm_product (category_id);

-- ---------------------------------------------------------------------------
-- crm_outcome_reason: stable reference vocabulary for recording WHY a future
-- transactional record (lead, opportunity, follow-up) ended the way it did.
--
-- requires_note is evaluated at write time by the repository that records an
-- outcome. The flag is deliberately NOT copied onto transactional rows: the
-- reason row is the single source of truth for its own policy.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_outcome_reason (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          text        NOT NULL,
    code          text        NOT NULL,
    label         text        NOT NULL,
    requires_note boolean     NOT NULL DEFAULT false,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    -- A reason code is unique within its kind, not globally.
    CONSTRAINT crm_outcome_reason_kind_code_unique UNIQUE (kind, code),
    CONSTRAINT crm_outcome_reason_kind_normalised  CHECK (kind = lower(btrim(kind))),
    CONSTRAINT crm_outcome_reason_code_normalised  CHECK (code = lower(btrim(code))),
    CONSTRAINT crm_outcome_reason_label_len        CHECK (char_length(btrim(label)) BETWEEN 1 AND 200)
);

-- ---------------------------------------------------------------------------
-- Stable production reference data. This is configuration-as-data: the codes
-- are part of the application vocabulary and are seeded by the migration so
-- every environment carries the same rows.
--
-- whatsapp is seeded as a SOURCE on purpose: PHONE is the canonical contact
-- identity (a WhatsApp number is a phone number with a capability flag), but
-- WhatsApp is a fully valid lead source and communication medium. Real Dental
-- Hub product models are deliberately NOT seeded here - product rows are
-- operational data, not reference data.
-- ---------------------------------------------------------------------------
INSERT INTO crm_source (code, name) VALUES
    ('whatsapp',         'WhatsApp'),
    ('facebook',         'Facebook'),
    ('instagram',        'Instagram'),
    ('phone',            'Phone'),
    ('website',          'Website'),
    ('exhibition',       'Exhibition'),
    ('referral',         'Referral'),
    ('walk_in',          'Walk-in'),
    ('existing_customer', 'Existing customer'),
    ('outbound',         'Outbound');

-- Approved Dental Hub product model groupings.
INSERT INTO crm_product_category (code, name) VALUES
    ('dental_units',     'Dental units'),
    ('autoclaves',       'Autoclaves'),
    ('compressors',      'Compressors'),
    ('scalers',          'Scalers'),
    ('clinic_packages',  'Clinic packages'),
    ('accessories',      'Accessories'),
    ('other_equipment',  'Other equipment');

-- Outcome reasons by kind. A callback is future work (a follow-up), not a
-- terminal outcome, so there is no callback_requested reason. 'other' exists
-- per kind and always requires a free-text note; the requires-note policy is
-- evaluated at write time by repositories, never mirrored onto transactional
-- rows.
INSERT INTO crm_outcome_reason (kind, code, label, requires_note) VALUES
    ('disqualify', 'spam',               'Spam',                 false),
    ('disqualify', 'wrong_number',       'Wrong number',         false),
    ('disqualify', 'job_applicant',      'Job applicant',        false),
    ('disqualify', 'student_research',   'Student research',     false),
    ('disqualify', 'out_of_scope',       'Out of scope',         false),
    ('disqualify', 'other',              'Other',                true),
    ('lost',       'price_too_high',     'Price too high',       false),
    ('lost',       'bought_competitor',  'Bought from competitor', false),
    ('lost',       'no_budget',          'No budget',            false),
    ('lost',       'timing_postponed',   'Timing postponed',     false),
    ('lost',       'no_response',        'No response',          false),
    ('lost',       'wrong_fit',          'Wrong fit',            false),
    ('lost',       'clinic_closed',      'Clinic closed',        false),
    ('lost',       'other',              'Other',                true),
    ('hold',       'awaiting_clinic_readiness', 'Awaiting clinic readiness', false),
    ('hold',       'awaiting_finance',   'Awaiting finance',     false),
    ('hold',       'awaiting_stock',     'Awaiting stock',       false),
    ('hold',       'ramadan_seasonal',   'Ramadan / seasonal',   false),
    ('hold',       'customer_travelling', 'Customer travelling', false),
    ('hold',       'other',              'Other',                true);
