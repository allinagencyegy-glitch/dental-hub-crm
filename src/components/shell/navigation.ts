/**
 * The reserved Dental Hub CRM navigation.
 *
 * Foundation v0 implements Home and Settings -> Users. Slice 2A implements
 * Leads. Slice 2B implements Opportunities and Follow-ups. Quotations V1 keeps
 * quotations inside the opportunity workspace. Pipeline & Management Dashboard
 * V1 enables the Pipeline entry. Every other destination is reserved visually
 * and rendered as disabled: no href, no fake page, no dead link. Implementing
 * a module means flipping `status` to 'available'.
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
  { label: 'Leads', href: '/crm/leads', status: 'available', permission: 'leads:read' },
  { label: 'Opportunities', href: '/crm/opportunities', status: 'available', permission: 'opportunities:read' },
  { label: 'Customers', status: 'planned' },
  { label: 'Follow-ups', href: '/crm/followups', status: 'available', permission: 'followups:read' },
  { label: 'Pipeline', href: '/crm/pipeline', status: 'available', permission: 'opportunities:read' },
  { label: 'Quotations', status: 'planned' },
  { label: 'Reports', status: 'planned' },
  { label: 'Team', status: 'planned' },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: 'Users', href: '/crm/settings/users', status: 'available', permission: 'users:read' },
];
