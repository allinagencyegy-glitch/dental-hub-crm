-- Dental Hub CRM - WhatsApp intake
--
-- A customer who writes to the company's WhatsApp number becomes a lead by
-- themselves. Every message they send is kept against the lead it belongs to,
-- so whoever picks the lead up reads what the customer actually asked.
--
-- The WhatsApp message id is unique: Meta delivers a message at least once
-- and retries for days, so a repeat delivery must change nothing.

CREATE TABLE crm_whatsapp_message (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    wa_message_id   text        NOT NULL,
    lead_id         uuid        NOT NULL REFERENCES crm_lead (id) ON DELETE CASCADE,
    from_phone      text        NOT NULL,
    -- The name the customer set on their own WhatsApp profile, if any.
    profile_name    text,
    -- text, image, audio, document, ... as WhatsApp names it.
    message_type    text        NOT NULL,
    -- The text, or the caption of a picture or file. Null for a voice note.
    body            text,
    -- A click-to-WhatsApp ad the customer came from.
    ad_headline     text,
    ad_source_url   text,
    -- True for the message that opened the lead; the round-robin reads it.
    started_lead    boolean     NOT NULL DEFAULT false,
    -- When the customer sent it, by WhatsApp's clock.
    sent_at         timestamptz NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_whatsapp_message_wa_id_unique  UNIQUE (wa_message_id),
    CONSTRAINT crm_whatsapp_message_wa_id_len     CHECK (char_length(wa_message_id) BETWEEN 1 AND 200),
    CONSTRAINT crm_whatsapp_message_phone_e164    CHECK (from_phone ~ '^\+[1-9][0-9]{6,14}$'),
    CONSTRAINT crm_whatsapp_message_type_len      CHECK (char_length(message_type) BETWEEN 1 AND 40),
    CONSTRAINT crm_whatsapp_message_profile_len   CHECK (profile_name IS NULL OR char_length(profile_name) <= 200),
    CONSTRAINT crm_whatsapp_message_body_len      CHECK (body IS NULL OR char_length(body) <= 5000),
    CONSTRAINT crm_whatsapp_message_ad_len        CHECK (
        (ad_headline IS NULL OR char_length(ad_headline) <= 500)
        AND (ad_source_url IS NULL OR char_length(ad_source_url) <= 2000)
    )
);

-- A lead's conversation, oldest first.
CREATE INDEX crm_whatsapp_message_lead_idx ON crm_whatsapp_message (lead_id, sent_at);

-- Who has had a WhatsApp lead most recently.
CREATE INDEX crm_whatsapp_message_started_idx ON crm_whatsapp_message (lead_id) WHERE started_lead;

-- Two new notices: a lead that arrived on WhatsApp (to its owner, the managers
-- and the owner's team leader), and a further message from a customer whose
-- lead or deal is already being worked (to its owner).
ALTER TABLE crm_notification
    DROP CONSTRAINT crm_notification_kind_known,
    DROP CONSTRAINT crm_notification_subject_present,
    ADD CONSTRAINT crm_notification_kind_known CHECK (kind IN (
        'LEAD_RECEIVED', 'LEAD_ASSIGNED', 'OPPORTUNITY_ASSIGNED', 'FOLLOW_UP_ASSIGNED',
        'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED', 'WHATSAPP_LEAD', 'WHATSAPP_MESSAGE'
    )),
    ADD CONSTRAINT crm_notification_subject_present CHECK (
        CASE kind
            WHEN 'LEAD_RECEIVED' THEN lead_id IS NOT NULL
            WHEN 'LEAD_ASSIGNED' THEN lead_id IS NOT NULL
            WHEN 'WHATSAPP_LEAD' THEN lead_id IS NOT NULL
            WHEN 'WHATSAPP_MESSAGE' THEN lead_id IS NOT NULL OR opportunity_id IS NOT NULL
            WHEN 'OPPORTUNITY_ASSIGNED' THEN opportunity_id IS NOT NULL
            WHEN 'FOLLOW_UP_ASSIGNED' THEN followup_id IS NOT NULL
            ELSE quotation_id IS NOT NULL
        END
    );
