-- Dental Hub CRM - Product catalogue V1
--
-- Turns crm_product into a price list: every model carries its brand and an
-- optional list price, and a quotation line can point at the model it sells.
--
-- The list price is a starting point, not a rule. A quotation line copies it
-- at the moment it is written, so a later price change never alters a
-- quotation that was already sent. A null list price means the price is
-- quoted case by case.
--
-- Product rows themselves stay operational data (see 0002): they are loaded
-- with `npm run catalog:import` and maintained from Settings -> Products.

ALTER TABLE crm_product
    ADD COLUMN brand      text,
    ADD COLUMN list_price numeric(14, 2),
    ADD CONSTRAINT crm_product_brand_len CHECK (brand IS NULL OR char_length(btrim(brand)) BETWEEN 1 AND 60),
    ADD CONSTRAINT crm_product_list_price_non_negative CHECK (list_price IS NULL OR list_price >= 0);

-- One row per model: the same name under the same brand is the same product,
-- whatever the casing or surrounding spaces. This is also what lets the
-- import run more than once without creating duplicates.
CREATE UNIQUE INDEX crm_product_brand_name_unique
    ON crm_product (lower(btrim(COALESCE(brand, ''))), lower(btrim(name)));

-- The groupings the Dental Hub catalogue actually sells in, beyond 0002's.
INSERT INTO crm_product_category (code, name) VALUES
    ('sterilization',     'Sterilization equipment'),
    ('intraoral_cameras', 'Intraoral cameras'),
    ('curing_lights',     'Curing lights'),
    ('endodontics',       'Endodontics'),
    ('whitening',         'Teeth whitening');

-- A quotation line may name the catalogue model it sells. Free-text lines
-- (delivery, installation, a one-off item) keep this null. A product that
-- has been quoted cannot be deleted; it is retired by deactivating it.
ALTER TABLE crm_quotation_item
    ADD COLUMN product_id uuid REFERENCES crm_product (id) ON DELETE RESTRICT;

CREATE INDEX crm_quotation_item_product_id_idx ON crm_quotation_item (product_id)
    WHERE product_id IS NOT NULL;
