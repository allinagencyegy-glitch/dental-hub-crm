import { describe, expect, it } from 'vitest';
import { PERMISSIONS, can, permissionsFor } from '../../src/server/authz/permissions';

describe('Slice 1 permissions', () => {
  it('defines exactly the foundation plus Slice 1 vocabulary', () => {
    expect([...PERMISSIONS].sort()).toEqual(
      [
        'crm:access',
        'users:read',
        'users:manage',
        'contacts:read',
        'contacts:write',
        'contacts:merge',
        'catalog:manage',
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

    expect(can('SALES_MANAGER', 'users:read')).toBe(false);
    expect(can('SALES_MANAGER', 'users:manage')).toBe(false);
  });

  it('grants SALES_REP contact read/write only', () => {
    expect(can('SALES_REP', 'crm:access')).toBe(true);
    expect(can('SALES_REP', 'contacts:read')).toBe(true);
    expect(can('SALES_REP', 'contacts:write')).toBe(true);

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
    const deferred = ['lead', 'pipeline', 'opportunity', 'quotation', 'task', 'activity', 'won', 'lost'];
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
