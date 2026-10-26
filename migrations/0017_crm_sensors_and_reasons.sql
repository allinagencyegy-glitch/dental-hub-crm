-- Dental Hub CRM - X-ray sensors and two disqualification reasons
--
-- Intraoral X-ray sensors are one of the most asked-about products in the
-- sales team's WhatsApp campaigns, so they get their own category.
--
-- "Not interested" and "bought elsewhere" are the two most common reasons the
-- team closes a lead without a deal. Until now they could only be recorded as
-- "Other" with a note, which cannot be counted.

INSERT INTO crm_product_category (code, name) VALUES
    ('xray_sensors', 'X-ray sensors');

INSERT INTO crm_outcome_reason (kind, code, label, requires_note) VALUES
    ('disqualify', 'not_interested',   'Not interested',   false),
    ('disqualify', 'bought_elsewhere', 'Bought elsewhere', false);
