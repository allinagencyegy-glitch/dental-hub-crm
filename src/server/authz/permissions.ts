/**
 * The single authorization vocabulary.
 *
 * Foundation v0 encoded "can you be in the CRM at all" and "can you administer
 * users". CRM Domain Slice 1 adds contact and catalog capabilities. Slice 2A
 * adds lead capabilities. Slice 2B adds opportunity and follow-up capabilities.
 * Quotations V1 adds quotation capabilities. Pipeline & Management Dashboard
 * V1 adds the dashboard capability. Reports and after-sales permissions are
 * NOT modelled yet - but new permissions slot into PERMISSIONS and
 * ROLE_PERMISSIONS without touching any call site.
 *
 * Everything here is a CAPABILITY check: does this role have this ability at
 * all. Row scope - WHICH records a user may touch - is a separate concern,
 * enforced where data is queried, never folded into this table.
 */

export const ROLES = ['ADMIN', 'SALES_MANAGER', 'SALES_REP'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales Manager',
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
