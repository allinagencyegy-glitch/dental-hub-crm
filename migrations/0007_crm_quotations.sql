-- Dental Hub CRM - CRM V1: Quotations
-- Adds quotation management linked to opportunities.

CREATE SEQUENCE IF NOT EXISTS crm_quotation_number_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TYPE crm_quotation_status AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

CREATE TABLE crm_quotation (
    id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id      uuid                        NOT NULL REFERENCES crm_opportunity (id) ON DELETE RESTRICT,
    contact_id          uuid                        NOT NULL REFERENCES crm_contact (id) ON DELETE RESTRICT,
    account_id          uuid                        REFERENCES crm_account (id) ON DELETE SET NULL,
    quote_number        text                        NOT NULL UNIQUE,
    version             integer                     NOT NULL DEFAULT 1,
    status              crm_quotation_status        NOT NULL DEFAULT 'DRAFT',
    currency            text                        NOT NULL DEFAULT 'EGP',
    subtotal            numeric(14, 2)              NOT NULL DEFAULT 0,
    discount_amount     numeric(14, 2)              NOT NULL DEFAULT 0,
    tax_amount          numeric(14, 2)              NOT NULL DEFAULT 0,
    total_amount        numeric(14, 2)              NOT NULL DEFAULT 0,
    notes               text,
    terms_conditions    text,
    valid_until         timestamptz,
    sent_at             timestamptz,
    accepted_at         timestamptz,
    rejected_at         timestamptz,
    expired_at          timestamptz,
    created_by          uuid                        NOT NULL REFERENCES crm_user (id) ON DELETE RESTRICT,
    created_at          timestamptz                 NOT NULL DEFAULT now(),
    updated_at          timestamptz                 NOT NULL DEFAULT now(),
    previous_quote_id   uuid                        REFERENCES crm_quotation (id) ON DELETE RESTRICT,

    CONSTRAINT crm_quotation_status_timestamps CHECK (
        (status = 'DRAFT' AND sent_at IS NULL AND accepted_at IS NULL AND rejected_at IS NULL AND expired_at IS NULL) OR
        (status = 'SENT' AND sent_at IS NOT NULL AND accepted_at IS NULL AND rejected_at IS NULL AND expired_at IS NULL) OR
        (status = 'ACCEPTED' AND accepted_at IS NOT NULL) OR
        (status = 'REJECTED' AND rejected_at IS NOT NULL) OR
        (status = 'EXPIRED' AND expired_at IS NOT NULL)
    ),
    CONSTRAINT crm_quotation_amounts_non_negative CHECK (
        subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0
    ),
    CONSTRAINT crm_quotation_total_consistent CHECK (
        total_amount = subtotal - discount_amount + tax_amount
    ),
    CONSTRAINT crm_quotation_version_positive CHECK (version >= 1)
);

CREATE INDEX crm_quotation_opportunity_id_idx ON crm_quotation (opportunity_id, created_at DESC);
CREATE INDEX crm_quotation_status_idx ON crm_quotation (status);
CREATE INDEX crm_quotation_quote_number_idx ON crm_quotation (quote_number);

CREATE TABLE crm_quotation_item (
    id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id        uuid                        NOT NULL REFERENCES crm_quotation (id) ON DELETE CASCADE,
    sequence            integer                     NOT NULL,
    description         text                        NOT NULL,
    quantity            numeric(10, 2)              NOT NULL,
    unit_price          numeric(14, 2)              NOT NULL,
    line_total          numeric(14, 2)              NOT NULL,
    CONSTRAINT crm_quotation_item_sequence_positive CHECK (sequence >= 1),
    CONSTRAINT crm_quotation_item_quantity_positive CHECK (quantity > 0),
    CONSTRAINT crm_quotation_item_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT crm_quotation_item_line_total_correct CHECK (line_total = quantity * unit_price)
);

CREATE INDEX crm_quotation_item_quotation_id_idx ON crm_quotation_item (quotation_id, sequence ASC);

CREATE TABLE crm_quotation_revision (
    id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id        uuid                        NOT NULL REFERENCES crm_quotation (id) ON DELETE CASCADE,
    version             integer                     NOT NULL,
    status              crm_quotation_status        NOT NULL,
    subtotal            numeric(14, 2)              NOT NULL,
    discount_amount     numeric(14, 2)              NOT NULL,
    tax_amount          numeric(14, 2)              NOT NULL,
    total_amount        numeric(14, 2)              NOT NULL,
    notes               text,
    terms_conditions    text,
    valid_until         timestamptz,
    changed_by          uuid                        NOT NULL REFERENCES crm_user (id) ON DELETE RESTRICT,
    changed_at          timestamptz                 NOT NULL DEFAULT now(),
    change_reason       text
);

CREATE INDEX crm_quotation_revision_quotation_id_idx ON crm_quotation_revision (quotation_id, version DESC);

CREATE TABLE crm_opportunity_activity (
    id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id      uuid                        NOT NULL REFERENCES crm_opportunity (id) ON DELETE RESTRICT,
    activity_type       text                        NOT NULL,
    description         text                        NOT NULL,
    metadata            jsonb,
    actor_user_id       uuid                        REFERENCES crm_user (id) ON DELETE RESTRICT,
    created_at          timestamptz                 NOT NULL DEFAULT now(),
    CONSTRAINT crm_opportunity_activity_type_known CHECK (activity_type IN (
        'STAGE_CHANGE', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_COMPLETED', 'FOLLOW_UP_RESCHEDULED',
        'QUOTATION_CREATED', 'QUOTATION_SENT', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED',
        'QUOTATION_EXPIRED', 'QUOTATION_REVISED', 'NOTE_ADDED', 'OWNER_CHANGED'
    ))
);

CREATE INDEX crm_opportunity_activity_opportunity_id_idx ON crm_opportunity_activity (opportunity_id, created_at DESC);
