/**
 * The reserved Dental Hub CRM navigation.
 *
 * Foundation v0 implements Home and Settings -> Users. Every other destination
 * is reserved visually and rendered as disabled: no href, no fake page, no dead
 * link. Implementing a module means flipping `status` to 'available'.
 */
import type { Permission } from '@/server/authz/permissions';

export interface NavItem {
  label: string;
  href?: string;
  status: 'available' | 'planned';
  permission?: Permission;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Home', href: '/crm', status: 'available' },
  { label: 'Leads', status: 'planned' },
  { label: 'Customers', status: 'planned' },
  { label: 'Pipeline', status: 'planned' },
  { label: 'Follow-ups', status: 'planned' },
  { label: 'Quotations', status: 'planned' },
  { label: 'Reports', status: 'planned' },
  { label: 'Team', status: 'planned' },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: 'Users', href: '/crm/settings/users', status: 'available', permission: 'users:read' },
];
