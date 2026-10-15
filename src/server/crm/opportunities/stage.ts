/**
 * Opportunity stage vocabulary and the legal transitions between stages.
 *
 * This is the one place the pipeline shape is defined. Both the repository
 * (which refuses to write an illegal transition) and the UI (which greys out
 * buttons the user may not press) read it, so the two can never disagree.
 *
 * Mirrored by crm_opportunity_stage_known in migration 0006: SQL guarantees the
 * value is a known stage, this module guarantees the move is a legal one.
 */

export const OPPORTUNITY_STAGES = [
  'QUALIFIED',
  'NEEDS_ANALYSIS',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
  'ON_HOLD',
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  QUALIFIED: 'Qualified',
  NEEDS_ANALYSIS: 'Needs analysis',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  ON_HOLD: 'On hold',
};

/** Stages that represent a deal still in play. Used by "my open work" filters. */
export const OPEN_STAGES: readonly OpportunityStage[] = [
  'QUALIFIED',
  'NEEDS_ANALYSIS',
  'PROPOSAL',
  'NEGOTIATION',
  'ON_HOLD',
];

/** Stages a lead is qualified into. A deal can be lost or parked from here. */
const QUALIFIED_TRANSITIONS: readonly OpportunityStage[] = [
  'NEEDS_ANALYSIS',
  'PROPOSAL',
  'ON_HOLD',
  'LOST',
];

const NEEDS_ANALYSIS_TRANSITIONS: readonly OpportunityStage[] = ['PROPOSAL', 'ON_HOLD', 'LOST'];
const PROPOSAL_TRANSITIONS: readonly OpportunityStage[] = ['NEGOTIATION', 'ON_HOLD', 'LOST'];
const NEGOTIATION_TRANSITIONS: readonly OpportunityStage[] = ['WON', 'ON_HOLD', 'LOST'];

/**
 * ON_HOLD can resume into whichever live stage it was parked from. The domain
 * does not remember the prior stage, so every open stage is offered - the
 * salesperson knows what the deal actually is.
 */
const ON_HOLD_TRANSITIONS: readonly OpportunityStage[] = [
  'QUALIFIED',
  'NEEDS_ANALYSIS',
  'PROPOSAL',
  'NEGOTIATION',
  'LOST',
];

/**
 * WON and LOST are terminal. A deal that closed stays closed: reopening would
 * rewrite won_at / lost_at, and the commercial history of the outcome is meant
 * to be permanent. A genuine new commercial attempt is a new lead, and
 * therefore a new opportunity.
 */
export const STAGE_TRANSITIONS: Record<OpportunityStage, readonly OpportunityStage[]> = {
  QUALIFIED: QUALIFIED_TRANSITIONS,
  NEEDS_ANALYSIS: NEEDS_ANALYSIS_TRANSITIONS,
  PROPOSAL: PROPOSAL_TRANSITIONS,
  NEGOTIATION: NEGOTIATION_TRANSITIONS,
  ON_HOLD: ON_HOLD_TRANSITIONS,
  WON: [],
  LOST: [],
};

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === 'string' && (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

export function isOpenStage(stage: OpportunityStage): boolean {
  return OPEN_STAGES.includes(stage);
}

export function isTerminalStage(stage: OpportunityStage): boolean {
  return stage === 'WON' || stage === 'LOST';
}

export function canTransition(from: OpportunityStage, to: OpportunityStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

/** Stages the given stage may move to right now. Empty for a closed deal. */
export function allowedTransitions(from: OpportunityStage): readonly OpportunityStage[] {
  return STAGE_TRANSITIONS[from];
}
