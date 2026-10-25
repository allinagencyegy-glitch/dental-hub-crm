-- Dental Hub CRM - In-app notifications V1
--
-- One row per thing a person should hear about: work handed to them by
-- someone else, a new lead arriving (for managers), and the customer's answer
-- on a quotation for a deal they own. Overdue follow-ups are NOT stored here:
-- they are counted live from crm_followup, so they disappear the moment the
-- work is done and never go stale.
--
-- A row records facts, not text. The reader's language and the customer's
-- current name are applied when the bell is opened, by joining to the record
-- the row points at.

CREATE TABLE crm_notification (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id  uuid        NOT NULL REFERENCES crm_user (id) ON DELETE RESTRICT,
    kind               text        NOT NULL,
    -- Who caused it. Null only for writes with no signed-in person behind them.
    actor_user_id      uuid        REFERENCES crm_user (id) ON DELETE RESTRICT,
    -- A notice is about its record and nothing else: if the record is ever
    -- deleted, its notices go with it rather than blocking the delete.
    lead_id            uuid        REFERENCES crm_lead (id) ON DELETE CASCADE,
    opportunity_id     uuid        REFERENCES crm_opportunity (id) ON DELETE CASCADE,
    followup_id        uuid        REFERENCES crm_followup (id) ON DELETE CASCADE,
    quotation_id       uuid        REFERENCES crm_quotation (id) ON DELETE CASCADE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    read_at            timestamptz,

    CONSTRAINT crm_notification_kind_known CHECK (kind IN (
        'LEAD_RECEIVED', 'LEAD_ASSIGNED', 'OPPORTUNITY_ASSIGNED', 'FOLLOW_UP_ASSIGNED',
        'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED'
    )),
    -- Each kind points at the record its link opens.
    CONSTRAINT crm_notification_subject_present CHECK (
        CASE kind
            WHEN 'LEAD_RECEIVED' THEN lead_id IS NOT NULL
            WHEN 'LEAD_ASSIGNED' THEN lead_id IS NOT NULL
            WHEN 'OPPORTUNITY_ASSIGNED' THEN opportunity_id IS NOT NULL
            WHEN 'FOLLOW_UP_ASSIGNED' THEN followup_id IS NOT NULL
            ELSE quotation_id IS NOT NULL
        END
    ),
    -- Nobody is told about their own action.
    CONSTRAINT crm_notification_not_self CHECK (actor_user_id IS DISTINCT FROM recipient_user_id)
);

-- The bell: a person's latest notifications, newest first.
CREATE INDEX crm_notification_recipient_idx ON crm_notification (recipient_user_id, created_at DESC);

-- The badge: how many a person has not read yet.
CREATE INDEX crm_notification_unread_idx ON crm_notification (recipient_user_id) WHERE read_at IS NULL;
