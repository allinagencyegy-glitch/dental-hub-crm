-- Dental Hub CRM - CRM Slice 2B: Opportunities + Follow-ups
-- Extends lead management into the first real commercial workflow:
--   Lead → Qualification → Opportunity → Owner → Stage → Next Action / Follow-up
--
-- Deliberate modelling choices:
--   * crm_opportunity.lead_id is UNIQUE: one lead converts to at most one
--     opportunity. Duplicate qualification is unrepresentable at the database
--     level, not merely rejected by application code.
--   * There is NO crm_lead.opportunity_id back-reference. A single-direction FK
--     avoids a crm_lead <-> crm_opportunity reference cycle; the reverse lookup
--     is served by the index on lead_id.
--   * lost reason reuses the existing crm_outcome_reason vocabulary with
--     kind = 'lost' (already seeded in 0002) instead of a new free-text
--     namespace. The spec's "lost_reason" is therefore lost_reason_id, a FK.
--     This mirrors how lead disqualification reuses kind = 'disqualify'.
--   * Follow-ups are never deleted. Completing one stamps completed_at, so the
--     commercial history of an opportunity survives WON / LOST / ON_HOLD.

-- ---------------------------------------------------------------------------
-- crm_opportunity: a qualified commercial opportunity.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_opportunity (
    id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id             uuid           NOT NULL UNIQUE REFERENCES crm_lead (id) ON DELETE RESTRICT,
    contact_id          uuid           NOT NULL REFERENCES crm_contact (id) ON DELETE RESTRICT,
    account_id          uuid           REFERENCES crm_account (id) ON DELETE SET NULL,
    owner_user_id       uuid           NOT NULL REFERENCES crm_user (id) ON DELETE RESTRICT,
    product_category_id uuid           REFERENCES crm_product_category (id) ON DELETE SET NULL,
    stage               text           NOT NULL DEFAULT 'QUALIFIED',
    estimated_value     numeric(14, 2),
    notes               text,
    created_at          timestamptz    NOT NULL DEFAULT now(),
    updated_at          timestamptz    NOT NULL DEFAULT now(),
    won_at              timestamptz,
    lost_at             timestamptz,
    lost_reason_id      uuid           REFERENCES crm_outcome_reason (id) ON DELETE RESTRICT,

    CONSTRAINT crm_opportunity_stage_known CHECK (stage IN (
        'QUALIFIED', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION',
        'WON', 'LOST', 'ON_HOLD'
    )),

    -- Outcome timestamps are facts about the current stage, not free text: they
    -- must be present exactly when the stage says the deal closed, and absent
    -- otherwise. This makes "won without a date" unrepresentable.
    CONSTRAINT crm_opportunity_won_at_agrees CHECK (
        (won_at IS NULL AND stage <> 'WON') OR (won_at IS NOT NULL AND stage = 'WON')
    ),
    CONSTRAINT crm_opportunity_lost_at_agrees CHECK (
        (lost_at IS NULL AND stage <> 'LOST') OR (lost_at IS NOT NULL AND stage = 'LOST')
    ),
    CONSTRAINT crm_opportunity_lost_reason_agrees CHECK (
        (lost_reason_id IS NULL AND stage <> 'LOST') OR (lost_reason_id IS NOT NULL AND stage = 'LOST')
    ),

    -- A deal that is not lost cannot carry a lost reason.
    CONSTRAINT crm_opportunity_lost_requires_reason CHECK (
        stage <> 'LOST' OR lost_reason_id IS NOT NULL
    ),

    CONSTRAINT crm_opportunity_estimated_value_non_negative CHECK (
        estimated_value IS NULL OR estimated_value >= 0
    ),
    CONSTRAINT crm_opportunity_notes_len CHECK (
        notes IS NULL OR char_length(btrim(notes)) BETWEEN 1 AND 5000
    )
);

-- "My opportunities" / owner row-scope predicate.
CREATE INDEX crm_opportunity_owner_user_id_idx ON crm_opportunity (owner_user_id);

-- Pipeline grouping by stage.
CREATE INDEX crm_opportunity_stage_idx ON crm_opportunity (stage);

-- Reverse lookup: the opportunity created from a given lead.
CREATE INDEX crm_opportunity_lead_id_idx ON crm_opportunity (lead_id);

-- Roll-ups: "all opportunities for this contact / account / category".
CREATE INDEX crm_opportunity_contact_id_idx ON crm_opportunity (contact_id);
CREATE INDEX crm_opportunity_account_id_idx ON crm_opportunity (account_id);

-- Open-workload ordering: the next action due soonest across live opportunities.
CREATE INDEX crm_opportunity_live_stage_idx ON crm_opportunity (stage)
    WHERE stage NOT IN ('WON', 'LOST');

-- ---------------------------------------------------------------------------
-- crm_opportunity_stage_history: an append-only audit of commercial stage moves.
--
-- crm_opportunity only holds the CURRENT stage, so a WON row cannot explain how
-- it got there or who moved it. This table answers "what happened to this deal,
-- and in what order" without mutating history: rows are inserted, never updated
-- or deleted, and the terminal stamps in crm_opportunity remain the source of
-- truth for the current outcome.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_opportunity_stage_history (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id  uuid        NOT NULL REFERENCES crm_opportunity (id) ON DELETE RESTRICT,
    from_stage      text,
    to_stage        text        NOT NULL,
    changed_by      uuid        REFERENCES crm_user (id) ON DELETE SET NULL,
    changed_at      timestamptz NOT NULL DEFAULT now(),
    note            text,

    -- The opening move has no prior stage; every later move must name one.
    CONSTRAINT crm_opportunity_stage_history_from_known CHECK (
        from_stage IS NULL OR from_stage IN (
            'QUALIFIED', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION',
            'WON', 'LOST', 'ON_HOLD'
        )
    ),
    CONSTRAINT crm_opportunity_stage_history_to_known CHECK (
        to_stage IN (
            'QUALIFIED', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION',
            'WON', 'LOST', 'ON_HOLD'
        )
    ),
    -- A row that changes nothing is noise, not history.
    CONSTRAINT crm_opportunity_stage_history_actually_changed CHECK (
        from_stage IS DISTINCT FROM to_stage
    ),
    CONSTRAINT crm_opportunity_stage_history_note_len CHECK (
        note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 5000
    )
);

-- "What happened to this deal", in order.
CREATE INDEX crm_opportunity_stage_history_opportunity_idx
    ON crm_opportunity_stage_history (opportunity_id, changed_at ASC, id ASC);

-- Audits of one salesperson's work on a given day.
CREATE INDEX crm_opportunity_stage_history_changed_by_idx
    ON crm_opportunity_stage_history (changed_by, changed_at DESC)
    WHERE changed_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- crm_followup: a durable next action on an opportunity.
--
-- Lifecycle: created with completed_at NULL, later stamped with completed_at.
-- Never deleted - see the header note.
-- ---------------------------------------------------------------------------
CREATE TABLE crm_followup (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id uuid       NOT NULL REFERENCES crm_opportunity (id) ON DELETE RESTRICT,
    owner_user_id  uuid       NOT NULL REFERENCES crm_user (id) ON DELETE RESTRICT,
    action_type    text       NOT NULL,
    note           text,
    due_at         timestamptz NOT NULL,
    completed_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT crm_followup_action_type_known CHECK (action_type IN (
        'CALL', 'WHATSAPP', 'MEETING', 'SEND_QUOTATION', 'FOLLOW_UP', 'OTHER'
    )),

    -- A completed follow-up cannot be completed again: the stamp is written once
    -- and the repository refuses a second write, so a double-click cannot
    -- silently overwrite the real completion time.
    CONSTRAINT crm_followup_completed_at_not_future CHECK (
        completed_at IS NULL OR completed_at >= created_at
    ),

    CONSTRAINT crm_followup_note_len CHECK (
        note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 5000
    )
);

-- "All activity for this opportunity", newest due first.
CREATE INDEX crm_followup_opportunity_id_idx ON crm_followup (opportunity_id, due_at DESC);

-- "My follow-ups" row-scope predicate.
CREATE INDEX crm_followup_owner_user_id_idx ON crm_followup (owner_user_id);

-- The hot path: the single pending next action per opportunity. Partial index
-- over pending rows only, so the lookup stays small as history grows.
CREATE INDEX crm_followup_pending_due_at_idx ON crm_followup (due_at)
    WHERE completed_at IS NULL;

-- Completed history reads (audit / timeline).
CREATE INDEX crm_followup_completed_at_idx ON crm_followup (opportunity_id, completed_at DESC)
    WHERE completed_at IS NOT NULL;
