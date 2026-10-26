-- Dental Hub CRM - Sales teams V1
--
-- The sales floor is Admin -> Sales Manager -> Team Leaders -> Sales Reps. A
-- team leader sells too, and also reaches the work of the reps on their team;
-- the manager reaches everything.
--
-- A rep belongs to at most one team, recorded on the rep's own row. Only a rep
-- carries a team leader: a leader or manager reaches their rows by role, not
-- by membership. That the referenced user really is a SALES_TEAM_LEADER is a
-- cross-row fact the users repository keeps (it clears a team when its leader
-- changes role); row scope never relies on it, because a rep is scoped to
-- their own rows whatever their team says.

ALTER TABLE crm_user
    DROP CONSTRAINT crm_user_role_known,
    ADD CONSTRAINT crm_user_role_known CHECK (
        role IN ('ADMIN', 'SALES_MANAGER', 'SALES_TEAM_LEADER', 'SALES_REP')
    ),
    ADD COLUMN team_leader_id uuid REFERENCES crm_user (id) ON DELETE SET NULL,
    ADD CONSTRAINT crm_user_team_leader_only_for_reps CHECK (
        team_leader_id IS NULL OR role = 'SALES_REP'
    ),
    ADD CONSTRAINT crm_user_team_leader_not_self CHECK (team_leader_id <> id);

CREATE INDEX crm_user_team_leader_idx ON crm_user (team_leader_id) WHERE team_leader_id IS NOT NULL;
