/**
 * The single authorization vocabulary.
 *
 * Foundation v0 encoded "can you be in the CRM at all" and "can you administer
 * users". CRM Domain Slice 1 adds contact and catalog capabilities. Slice 2A
 * adds lead capabilities. Slice 2B adds opportunity and follow-up capabilities.
 * Quotations V1 adds quotation capabilities. Pipeline & Management Dashboard
 * V1 adds the dashboard capability. Sales teams V1 adds the team leader role.
 * Reports and after-sales permissions are
 * NOT modelled yet - but new permissions slot into PERMISSIONS and
 * ROLE_PERMISSIONS without touching any call site.
 *
 * Everything here is a CAPABILITY check: does this role have this ability at
 * all. Row scope - WHICH records a user may touch - is a separate concern,
 * enforced where data is queried, never folded into this table.
 */

export const ROLES = ['ADMIN', 'SALES_MANAGER', 'SALES_TEAM_LEADER', 'SALES_REP'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales Manager',
  SALES_TEAM_LEADER: 'Team Leader',
  SALES_REP: 'Sales Rep',
};

export const PERMISSIONS = [
  'crm:access',
  'users:read',
  'users:manage',
  'contacts:read',
  'contacts:write',
  'contacts:merge',
  'catalog:manage',
  'leads:read',
  'leads:write',
  'leads:disqualify',
  'opportunities:read',
  'opportunities:write',
  'opportunities:advance',
  'opportunities:close',
  'followups:read',
  'followups:write',
  'quotations:read',
  'quotations:write',
  'quotations:close',
  'dashboard:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: [
    'crm:access',
    'users:read',
    'users:manage',
    'contacts:read',
    'contacts:write',
    'contacts:merge',
    'catalog:manage',
    'leads:read',
    'leads:write',
    'leads:disqualify',
    'opportunities:read',
    'opportunities:write',
    'opportunities:advance',
    'opportunities:close',
    'followups:read',
    'followups:write',
    'quotations:read',
    'quotations:write',
    'quotations:close',
    'dashboard:read',
  ],
  SALES_MANAGER: [
    'crm:access',
    'contacts:read',
    'contacts:write',
    'contacts:merge',
    'catalog:manage',
    'leads:read',
    'leads:write',
    'leads:disqualify',
    'opportunities:read',
    'opportunities:write',
    'opportunities:advance',
    'opportunities:close',
    'followups:read',
    'followups:write',
    'quotations:read',
    'quotations:write',
    'quotations:close',
    'dashboard:read',
  ],
  // A team leader sells like a rep. What sets them apart is row scope (they
  // also reach their team's records) and who they may assign work to - both
  // decided where the data is queried, not by this table.
  SALES_TEAM_LEADER: [
    'crm:access',
    'contacts:read',
    'contacts:write',
    'leads:read',
    'leads:write',
    'leads:disqualify',
    'opportunities:read',
    'opportunities:write',
    'opportunities:advance',
    'opportunities:close',
    'followups:read',
    'followups:write',
    'quotations:read',
    'quotations:write',
    'quotations:close',
    'dashboard:read',
  ],
  // A rep works contacts but cannot merge them (a destructive, history-altering
  // operation) and cannot manage the catalog. They advance and close their own
  // opportunities; ownership stays with the lead's owner unless a manager moves
  // it, which the row scope enforces rather than this table.
  SALES_REP: [
    'crm:access',
    'contacts:read',
    'contacts:write',
    'leads:read',
    'leads:write',
    'leads:disqualify',
    'opportunities:read',
    'opportunities:write',
    'opportunities:advance',
    'opportunities:close',
    'followups:read',
    'followups:write',
    'quotations:read',
    'quotations:write',
    'quotations:close',
    'dashboard:read',
  ],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Roles that may own leads, opportunities and follow-ups. */
export const OWNER_ROLES: readonly Role[] = ['SALES_MANAGER', 'SALES_TEAM_LEADER', 'SALES_REP'];

export function canOwnWork(role: string): boolean {
  return (OWNER_ROLES as readonly string[]).includes(role);
}

/**
 * Whether the role may hand work to someone else. A team leader may, but only
 * within their team - the repository checks who.
 */
export function canAssignOwner(role: Role): boolean {
  return role !== 'SALES_REP';
}
