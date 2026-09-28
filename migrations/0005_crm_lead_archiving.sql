-- Dental Hub CRM - CRM Lead Archiving (Slice 2A.1)
-- Adds organizational archiving separate from commercial lead status.

ALTER TABLE crm_lead
  ADD COLUMN archived_at timestamptz NULL,
  ADD COLUMN archived_by_user_id uuid NULL REFERENCES crm_user(id) ON DELETE SET NULL;

-- Both archive fields must be either both NULL or both populated.
-- Prevents half-populated archive metadata.
ALTER TABLE crm_lead
  ADD CONSTRAINT crm_lead_archive_together CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
  );

-- Index for archive filtering (active/archived)
CREATE INDEX crm_lead_archived_at_idx ON crm_lead (archived_at);