/**
 * The single authorization vocabulary for Foundation v0.
 *
 * Foundation v0 deliberately encodes only "can you be in the CRM at all" and
 * "can you administer users". Lead ownership, pipeline movement, quotations,
 * won/lost and task permissions are NOT modelled yet - but new permissions slot
 * into PERMISSIONS and ROLE_PERMISSIONS without touching any call site.
 */

export const ROLES = ['ADMIN', 'SALES_MANAGER', 'SALES_REP'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales Manager',
  SALES_REP: 'Sales Rep',
};

export const PERMISSIONS = ['crm:access', 'users:read', 'users:manage'] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ['crm:access', 'users:read', 'users:manage'],
  SALES_MANAGER: ['crm:access'],
  SALES_REP: ['crm:access'],
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
