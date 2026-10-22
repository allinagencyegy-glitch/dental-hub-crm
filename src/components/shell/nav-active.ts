/**
 * The rule that decides which navigation entry is the current page.
 *
 * An entry is current when the path is exactly its href. A section entry also
 * stays current for the pages inside it, so /crm/leads/123 keeps "Leads"
 * highlighted while the user works inside a lead.
 *
 * The CRM root is the exception: its children are other modules, not pages of
 * Home, so only /crm itself highlights Home.
 */
const CRM_ROOT = '/crm';

export function isNavItemActive(pathname: string, href: string | undefined): boolean {
  if (!href) return false;
  if (pathname === href) return true;
  if (href === CRM_ROOT) return false;
  return pathname.startsWith(`${href}/`);
}
