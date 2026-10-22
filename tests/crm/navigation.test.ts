import { describe, expect, it } from 'vitest';
import { isNavItemActive } from '../../src/components/shell/nav-active';

/**
 * The rule behind the "current page" highlight in the CRM navigation.
 *
 * The navigation is rendered on the desktop sidebar and in the mobile drawer,
 * so the highlight has to be right wherever the navigation appears.
 */
describe('navigation active state', () => {
  it('highlights the entry whose destination is the current path', () => {
    expect(isNavItemActive('/crm', '/crm')).toBe(true);
    expect(isNavItemActive('/crm/leads', '/crm/leads')).toBe(true);
    expect(isNavItemActive('/crm/settings/users', '/crm/settings/users')).toBe(true);
  });

  it('keeps a section highlighted for the pages inside it', () => {
    expect(isNavItemActive('/crm/leads/123', '/crm/leads')).toBe(true);
    expect(isNavItemActive('/crm/leads/123/edit', '/crm/leads')).toBe(true);
    expect(isNavItemActive('/crm/opportunities/abc/notes', '/crm/opportunities')).toBe(true);
    expect(isNavItemActive('/crm/settings/users/42', '/crm/settings/users')).toBe(true);
  });

  it('does not highlight a section for a path that merely shares its prefix', () => {
    expect(isNavItemActive('/crm/leadss', '/crm/leads')).toBe(false);
    expect(isNavItemActive('/crm/quotations', '/crm/quote')).toBe(false);
    expect(isNavItemActive('/crm/pipelines', '/crm/pipeline')).toBe(false);
  });

  it('highlights Home only on the CRM root', () => {
    expect(isNavItemActive('/crm', '/crm')).toBe(true);
    expect(isNavItemActive('/crm/leads', '/crm')).toBe(false);
    expect(isNavItemActive('/crm/pipeline', '/crm')).toBe(false);
    expect(isNavItemActive('/crm/quotations/abc', '/crm')).toBe(false);
  });

  it('never highlights an entry that has no destination', () => {
    expect(isNavItemActive('/crm/reports', undefined)).toBe(false);
    expect(isNavItemActive('/crm', undefined)).toBe(false);
  });
});
