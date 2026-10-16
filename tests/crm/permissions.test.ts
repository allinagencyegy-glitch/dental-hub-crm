import { describe, expect, it } from 'vitest';
import { PERMISSIONS, can, permissionsFor } from '../../src/server/authz/permissions';

describe('Slice 2A/2B and Quotations V1 permissions', () => {
  it('defines exactly the foundation plus Slice 1, Slice 2A, Slice 2B and Quotations vocabulary', () => {
    expect([...PERMISSIONS].sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  it('grants ADMIN the full set', () => {
    for (const permission of PERMISSIONS) {
      expect(can('ADMIN', permission)).toBe(true);
    }
  });

  it('grants SALES_MANAGER the full CRM set without user administration', () => {
    expect(can('SALES_MANAGER', 'crm:access')).toBe(true);
    expect(can('SALES_MANAGER', 'contacts:read')).toBe(true);
    expect(can('SALES_MANAGER', 'contacts:write')).toBe(true);
    expect(can('SALES_MANAGER', 'contacts:merge')).toBe(true);
    expect(can('SALES_MANAGER', 'catalog:manage')).toBe(true);
    expect(can('SALES_MANAGER', 'leads:read')).toBe(true);
    expect(can('SALES_MANAGER', 'leads:write')).toBe(true);
    expect(can('SALES_MANAGER', 'leads:disqualify')).toBe(true);
    expect(can('SALES_MANAGER', 'opportunities:read')).toBe(true);
    expect(can('SALES_MANAGER', 'opportunities:write')).toBe(true);
    expect(can('SALES_MANAGER', 'opportunities:advance')).toBe(true);
    expect(can('SALES_MANAGER', 'opportunities:close')).toBe(true);
    expect(can('SALES_MANAGER', 'followups:read')).toBe(true);
    expect(can('SALES_MANAGER', 'followups:write')).toBe(true);
    expect(can('SALES_MANAGER', 'quotations:read')).toBe(true);
    expect(can('SALES_MANAGER', 'quotations:write')).toBe(true);
    expect(can('SALES_MANAGER', 'quotations:close')).toBe(true);
    expect(can('SALES_MANAGER', 'dashboard:read')).toBe(true);

    expect(can('SALES_MANAGER', 'users:read')).toBe(false);
    expect(can('SALES_MANAGER', 'users:manage')).toBe(false);
  });

  it('grants SALES_REP contact and lead read/write/disqualify', () => {
    expect(can('SALES_REP', 'crm:access')).toBe(true);
    expect(can('SALES_REP', 'contacts:read')).toBe(true);
    expect(can('SALES_REP', 'contacts:write')).toBe(true);
    expect(can('SALES_REP', 'leads:read')).toBe(true);
    expect(can('SALES_REP', 'leads:write')).toBe(true);
    expect(can('SALES_REP', 'leads:disqualify')).toBe(true);

    // A rep works deals but may not reassign ownership: the capability exists,
    // and the repository is what refuses a rep's reassignment attempt.
    expect(can('SALES_REP', 'opportunities:read')).toBe(true);
    expect(can('SALES_REP', 'opportunities:write')).toBe(true);
    expect(can('SALES_REP', 'opportunities:advance')).toBe(true);
    expect(can('SALES_REP', 'opportunities:close')).toBe(true);
    expect(can('SALES_REP', 'followups:read')).toBe(true);
    expect(can('SALES_REP', 'followups:write')).toBe(true);
    expect(can('SALES_REP', 'quotations:read')).toBe(true);
    expect(can('SALES_REP', 'quotations:write')).toBe(true);
    expect(can('SALES_REP', 'quotations:close')).toBe(true);
    expect(can('SALES_REP', 'dashboard:read')).toBe(true);

    // No destructive merge, no catalog management, no user administration.
    expect(can('SALES_REP', 'contacts:merge')).toBe(false);
    expect(can('SALES_REP', 'catalog:manage')).toBe(false);
    expect(can('SALES_REP', 'users:read')).toBe(false);
    expect(can('SALES_REP', 'users:manage')).toBe(false);
  });

  it('keeps capability and row scope in separate vocabularies', () => {
    // Permissions are pure capabilities: no ownership or assignment qualifier
    // ever appears in a permission string. Row scope is enforced where data is
    // queried, not here.
    for (const permission of PERMISSIONS) {
      for (const scopeTerm of ['own', 'assigned', 'scope', 'team']) {
        expect(permission).not.toContain(scopeTerm);
      }
    }
  });

  it('encodes no permissions for deferred CRM slices', () => {
    const deferred = ['pipeline', 'task', 'activity', 'won', 'lost'];
    for (const permission of PERMISSIONS) {
      for (const term of deferred) {
        expect(permission.toLowerCase()).not.toContain(term);
      }
    }
  });

  it('gives every role a defined permission set', () => {
    for (const role of ['ADMIN', 'SALES_MANAGER', 'SALES_REP'] as const) {
      expect(permissionsFor(role).length).toBeGreaterThan(0);
    }
  });
});
