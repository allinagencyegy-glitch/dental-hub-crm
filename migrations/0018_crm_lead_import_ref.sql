-- Dental Hub CRM - Lead import reference
--
-- A lead brought over from another system remembers where it came from
-- ("spider:1234" is client 1234 in the old Spider CRM). That makes an import
-- safe to run again - a lead already imported is skipped, never duplicated -
-- and lets anyone trace an imported lead back to the old record.

ALTER TABLE crm_lead
    ADD COLUMN import_ref text,
    ADD CONSTRAINT crm_lead_import_ref_unique UNIQUE (import_ref),
    ADD CONSTRAINT crm_lead_import_ref_len CHECK (
        import_ref IS NULL OR char_length(btrim(import_ref)) BETWEEN 1 AND 100
    );
