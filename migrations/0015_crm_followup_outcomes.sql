-- Dental Hub CRM - Call results V1
--
-- A completed follow-up records what happened, picked from a fixed list: the
-- sales team logs every call with a result ("no answer", "asking about
-- prices", ...) and the free-text note alone could not be counted, filtered
-- or reported on.
--
-- The outcome is optional at the database level so the rows completed before
-- this migration stay valid; the product requires it from now on. A pending
-- follow-up never has one.

ALTER TABLE crm_followup
    ADD COLUMN outcome text,
    ADD CONSTRAINT crm_followup_outcome_known CHECK (outcome IS NULL OR outcome IN (
        'NO_ANSWER', 'BUSY', 'UNREACHABLE', 'MESSAGED_ON_WHATSAPP',
        'ASKING_PRICES', 'STILL_DECIDING', 'CALL_BACK_LATER', 'VISIT_PLANNED',
        'DEMO_REQUESTED', 'QUOTATION_REQUESTED', 'READY_TO_BUY',
        'NOT_INTERESTED', 'BOUGHT_ELSEWHERE', 'WRONG_NUMBER'
    )),
    ADD CONSTRAINT crm_followup_outcome_only_when_completed CHECK (
        outcome IS NULL OR completed_at IS NOT NULL
    );
