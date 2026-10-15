-- Dental Hub CRM - Quotations V1
--
-- Forward-only history protection.
--
-- crm_quotation_revision holds the immutable snapshots of a quotation's
-- commercial content. 0007 declared its quotation FK with ON DELETE CASCADE,
-- so a direct DELETE of a quotation row would silently destroy the revision
-- history - violating "deleting a quotation must not destroy commercial
-- history". The domain never offers deletion, but the guarantee must hold at
-- the database level too: the FK now RESTRICTs deletion.
--
-- The constraint name is the one PostgreSQL generated for the inline
-- REFERENCES in 0007; it is dropped and re-added with the same name so the
-- schema shape is unchanged and only the delete rule differs.

ALTER TABLE crm_quotation_revision
    DROP CONSTRAINT crm_quotation_revision_quotation_id_fkey;

ALTER TABLE crm_quotation_revision
    ADD CONSTRAINT crm_quotation_revision_quotation_id_fkey
    FOREIGN KEY (quotation_id) REFERENCES crm_quotation (id) ON DELETE RESTRICT;
