/**
 * The reserved Dental Hub CRM navigation.
 *
 * Foundation v0 implements Home and Settings -> Users. Slice 2A implements
 * Leads. Slice 2B implements Opportunities and Follow-ups. Quotations V1 keeps
 * quotations inside the opportunity workspace; the Quotations entry lists them
 * all. Customers lists everyone with a won deal, Reports the sales analysis
 * over a period. Pipeline & Management Dashboard V1 enables the Pipeline
 * entry. Every other destination is reserved visually and rendered as
 * disabled: no href, no fake page, no dead link. Implementing a module means
 * flipping `status` to 'available'.
 */
import type { Permission } from '@/server/authz/permissions';
import type { Messages } from '@/i18n/messages';

export interface NavItem {
  /** Picks its label from `messages.nav` and its icon. */
  key: NavKey;
  href?: string;
  status: 'available' | 'planned';
  permission?: Permission;
}

export type NavKey = Extract<
  keyof Messages['nav'],
  | 'home' | 'leads' | 'opportunities' | 'customers' | 'followUps' | 'pipeline'
  | 'quotations' | 'reports' | 'team' | 'users' | 'products' | 'password'
>;

export const PRIMARY_NAV: NavItem[] = [
  { key: 'home', href: '/crm', status: 'available' },
  { key: 'leads', href: '/crm/leads', status: 'available', permission: 'leads:read' },
  { key: 'opportunities', href: '/crm/opportunities', status: 'available', permission: 'opportunities:read' },
  { key: 'customers', href: '/crm/customers', status: 'available', permission: 'opportunities:read' },
  { key: 'followUps', href: '/crm/followups', status: 'available', permission: 'followups:read' },
  { key: 'pipeline', href: '/crm/pipeline', status: 'available', permission: 'opportunities:read' },
  { key: 'quotations', href: '/crm/quotations', status: 'available', permission: 'quotations:read' },
  { key: 'reports', href: '/crm/reports', status: 'available', permission: 'dashboard:read' },
  { key: 'team', status: 'planned' },
];

export const SETTINGS_NAV: NavItem[] = [
  { key: 'users', href: '/crm/settings/users', status: 'available', permission: 'users:read' },
  { key: 'products', href: '/crm/settings/products', status: 'available', permission: 'catalog:manage' },
  // Every signed-in user manages their own password.
  { key: 'password', href: '/crm/settings/password', status: 'available' },
];
