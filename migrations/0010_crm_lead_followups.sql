-- Dental Hub CRM - Daily Sales Reliability V1
--
-- Follow-ups gain a lead parent.
--
-- Before a lead is qualified there is no opportunity to hang a next action on,
-- so a call centre promise ("call the patient back on Tuesday") had nowhere
-- durable to live. crm_followup now points at exactly one parent: an
-- opportunity (the existing case) or a lead (the new case).
--
-- Forward-only. Existing opportunity follow-ups keep their opportunity_id and
-- are not rewritten; the table gains a nullable lead_id, the opportunity
-- parent becomes optional, and a CHECK pins a row to exactly one parent so a
-- follow-up can never drift to both or neither.

ALTER TABLE crm_followup
    ADD COLUMN lead_id uuid NULL REFERENCES crm_lead (id) ON DELETE RESTRICT;

-- The opportunity parent is optional now: a follow-up may belong to a lead
-- instead. The FK itself is unchanged, so deleting a parent is still RESTRICTed.
ALTER TABLE crm_followup
    ALTER COLUMN opportunity_id DROP NOT NULL;

ALTER TABLE crm_followup
    ADD CONSTRAINT crm_followup_exactly_one_parent CHECK (
        (lead_id IS NOT NULL AND opportunity_id IS NULL)
        OR (lead_id IS NULL AND opportunity_id IS NOT NULL)
    );

-- "All follow-ups for this lead", newest due first (mirrors the opportunity
-- index). Partial on non-null parents, so opportunity rows stay out of it.
CREATE INDEX crm_followup_lead_id_idx ON crm_followup (lead_id, due_at DESC)
    WHERE lead_id IS NOT NULL;

-- The activity vocabulary gains the qualification hand-off: when a lead with a
-- pending next action is qualified, that action moves onto the new opportunity
-- and the move is recorded there. Without this the move would be silent.
ALTER TABLE crm_opportunity_activity
    DROP CONSTRAINT crm_opportunity_activity_type_known;

ALTER TABLE crm_opportunity_activity
    ADD CONSTRAINT crm_opportunity_activity_type_known CHECK (activity_type IN (
        'STAGE_CHANGE', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_COMPLETED', 'FOLLOW_UP_RESCHEDULED',
        'FOLLOW_UP_MOVED',
        'QUOTATION_CREATED', 'QUOTATION_SENT', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED',
        'QUOTATION_EXPIRED', 'QUOTATION_REVISED', 'NOTE_ADDED', 'OWNER_CHANGED'
    ));
