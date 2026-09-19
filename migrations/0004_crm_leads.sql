-- Dental Hub CRM - CRM Domain Slice 2A (leads)
-- Real lead capture, ownership, and initial lifecycle (NEW → CONTACTED → DISQUALIFIED).
-- No opportunity conversion yet; that is the next slice.

-- ---------------------------------------------------------------------------
-- crm_lead: an inbound sales inquiry.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_lead (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id               uuid        NOT NULL REFERENCES crm_source (id) ON DELETE RESTRICT,
    campaign_id             uuid        REFERENCES crm_source_campaign (id) ON DELETE SET NULL,
    contact_id              uuid        NOT NULL REFERENCES crm_contact (id) ON DELETE RESTRICT,
    account_id              uuid        REFERENCES crm_account (id) ON DELETE SET NULL,
    product_category_id     uuid        REFERENCES crm_product_category (id) ON DELETE SET NULL,
    status                  text        NOT NULL DEFAULT 'NEW',
    note                    text,
    owner_user_id           uuid        NOT NULL REFERENCES crm_user (id) ON DELETE RESTRICT,
    received_at             timestamptz NOT NULL DEFAULT now(),
    disqualified_at         timestamptz,
    disqualify_reason_id    uuid        REFERENCES crm_outcome_reason (id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_lead_status_known CHECK (status IN ('NEW', 'CONTACTED', 'DISQUALIFIED')),
    CONSTRAINT crm_lead_note_len       CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 5000),
    -- Disqualification fields must appear together.
    CONSTRAINT crm_lead_disqualified_together CHECK (
        (disqualified_at IS NULL AND disqualify_reason_id IS NULL)
        OR (disqualified_at IS NOT NULL AND disqualify_reason_id IS NOT NULL)
    )
);

-- Owner queries: "my leads"
CREATE INDEX crm_lead_owner_user_id_idx ON crm_lead (owner_user_id);

-- Status queries: "all new leads", "all disqualified leads"
CREATE INDEX crm_lead_status_idx ON crm_lead (status);

-- Contact lookup: "leads for this contact"
CREATE INDEX crm_lead_contact_id_idx ON crm_lead (contact_id);

-- Account lookup: "leads for this account"
CREATE INDEX crm_lead_account_id_idx ON crm_lead (account_id);

-- Received-at ordering: default list sort, pagination
CREATE INDEX crm_lead_received_at_idx ON crm_lead (received_at DESC);