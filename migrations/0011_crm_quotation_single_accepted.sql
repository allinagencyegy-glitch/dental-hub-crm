-- Dental Hub CRM - Quotations: at most one ACCEPTED quotation per opportunity.
--
-- An accepted quotation is the customer's commitment on a deal. Two accepted
-- quotations on the same opportunity leave nobody able to say which price was
-- agreed, so the database refuses the second one. The application checks the
-- same rule first (with the opportunity row locked) to give a readable error;
-- this index is the backstop that no writer can get around.
--
-- If a database already holds more than one ACCEPTED quotation on an
-- opportunity, creating the index would fail with a bare duplicate-key error.
-- The DO block below fails first, naming the opportunities involved, so the
-- data can be resolved deliberately. Nothing is changed or deleted silently.

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(opportunity_id::text, ', ' ORDER BY opportunity_id)
      INTO offenders
      FROM (
            SELECT opportunity_id
              FROM crm_quotation
             WHERE status = 'ACCEPTED'
             GROUP BY opportunity_id
            HAVING count(*) > 1
           ) AS duplicates;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot enforce one accepted quotation per opportunity. These opportunities already have more than one ACCEPTED quotation: %',
            offenders
            USING HINT = 'Resolve the duplicate accepted quotations (or recreate a development database) and run the migrations again.';
    END IF;
END
$$;

CREATE UNIQUE INDEX crm_quotation_one_accepted_per_opportunity
    ON crm_quotation (opportunity_id)
    WHERE status = 'ACCEPTED';
