-- Dental Hub CRM - Sign-in throttling.
--
-- One row per normalised email that has failed to sign in recently. Each
-- attempt is counted BEFORE the password is checked, in a single atomic
-- upsert, so a burst of parallel guesses cannot slip past the limit while the
-- first ones are still being verified. A successful sign-in deletes the row.
--
-- Keyed by the email as typed, not by user id: unknown emails are throttled
-- exactly like real ones, so a lockout never reveals whether an account exists.
-- No foreign key to crm_user for the same reason.

CREATE TABLE crm_login_throttle (
    email             text        PRIMARY KEY,
    attempts          integer     NOT NULL,
    window_started_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_login_throttle_email_normalised CHECK (email = lower(btrim(email))),
    CONSTRAINT crm_login_throttle_attempts_positive CHECK (attempts > 0)
);

-- Supports the housekeeping sweep of windows that have long expired.
CREATE INDEX crm_login_throttle_window_idx ON crm_login_throttle (window_started_at);
