-- Dental Hub CRM - Quotations V1
--
-- Forward-only fix for crm_quotation_item.line_total rounding.
--
-- 0007 declared `line_total = quantity * unit_price`, but line_total is
-- numeric(14,2) while the product can carry up to four decimal places
-- (numeric(10,2) * numeric(14,2)). PostgreSQL rounds the stored value BEFORE
-- evaluating the CHECK, so any item whose product needs rounding (for example
-- 1.11 x 1.11 = 1.2321) was rejected. Line totals are now defined as the
-- product rounded to two decimals, which is what the column actually stores.

ALTER TABLE crm_quotation_item
    DROP CONSTRAINT crm_quotation_item_line_total_correct;

ALTER TABLE crm_quotation_item
    ADD CONSTRAINT crm_quotation_item_line_total_correct
    CHECK (line_total = round(quantity * unit_price, 2));
