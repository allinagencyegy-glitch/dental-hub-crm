import type { Role } from '@/server/authz/permissions';

/**
 * The English text of the CRM. `ar.ts` has the same shape, which the compiler
 * enforces: a key missing from either language is a type error.
 *
 * Text that takes values is a function, so each language can order the words
 * (and, in Arabic, pick the plural) itself.
 */
export const en = {
  app: {
    name: 'Dental Hub CRM',
    brand: 'Dental Hub',
    tagline: 'Sales CRM',
    title: (page: string) => `${page} | Dental Hub CRM`,
  },
  common: {
    saving: 'Saving...',
    invalidInput: 'That input is not valid.',
    minCharacters: (count: number) => `Minimum ${count} characters.`,
  },
  language: {
    /** The other language, named in itself: the switch's label. */
    switchTo: 'العربية',
    switchToLabel: 'Switch to Arabic',
  },
  roles: {
    ADMIN: 'Admin',
    SALES_MANAGER: 'Sales Manager',
    SALES_REP: 'Sales Rep',
  } satisfies Record<Role, string>,
  nav: {
    workspace: 'Workspace',
    settings: 'Settings',
    crmNavigation: 'CRM navigation',
    settingsNavigation: 'CRM settings navigation',
    comingSoon: 'Coming soon',
    soon: 'Soon',
    home: 'Home',
    leads: 'Leads',
    opportunities: 'Opportunities',
    customers: 'Customers',
    followUps: 'Follow-ups',
    pipeline: 'Pipeline',
    quotations: 'Quotations',
    reports: 'Reports',
    team: 'Team',
    users: 'Users',
    password: 'Password',
    openMenu: 'Open navigation menu',
    closeMenu: 'Close navigation menu',
    navigation: 'Navigation',
    signOut: 'Sign out',
    signingOut: 'Signing out...',
  },
  login: {
    pageTitle: 'Sign in',
    subtitle: 'Sign in to continue',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in...',
    invalidCredentials: 'Invalid email or password.',
    tooManyAttempts: (minutes: number) =>
      `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  },
  forbidden: {
    pageTitle: 'Not authorised',
    heading: 'You do not have access to that page',
    body: (role: string) =>
      `Your role (${role}) is not permitted to view it. Ask an admin if you believe this is wrong.`,
    backHome: 'Back to home',
  },
  password: {
    pageTitle: 'Password',
    eyebrow: 'Settings',
    heading: 'Change password',
    description: (email: string) =>
      `Signed in as ${email}. Changing your password signs you out on every other device.`,
    current: 'Current password',
    new: 'New password',
    confirm: 'Confirm new password',
    submit: 'Change password',
    enterCurrent: 'Enter your current password.',
    newTooShort: (count: number) => `New password must be at least ${count} characters.`,
    mismatch: 'The new passwords do not match.',
    sameAsCurrent: 'The new password must be different from the current one.',
    currentIncorrect: 'Your current password is incorrect.',
    changed: 'Password changed. You have been signed out everywhere else.',
  },
  users: {
    pageTitle: 'Users',
    eyebrow: 'Settings',
    heading: 'Users',
    description:
      'Dental Hub staff accounts. Add people, change their role, reset a forgotten password, and deactivate anyone who leaves.',
    you: 'You',
    inactive: 'Inactive',
    addTitle: 'Add a user',
    displayName: 'Display name',
    email: 'Email',
    initialPassword: 'Initial password',
    role: 'Role',
    create: 'Create user',
    creating: 'Creating...',
    roleFor: (name: string) => `Role for ${name}`,
    saveRole: 'Save role',
    activate: 'Activate',
    deactivate: 'Deactivate',
    resetPassword: 'Reset password',
    newPasswordFor: (name: string) => `New password for ${name}`,
    newPasswordPlaceholder: (count: number) => `New password (${count}+ characters)`,
    setPassword: 'Set password',
    created: (name: string) => `Created ${name}.`,
    roleUpdated: (name: string) => `Updated the role for ${name}.`,
    activated: (name: string) => `Activated ${name}.`,
    deactivated: (name: string) => `Deactivated ${name}.`,
    passwordReset: (name: string) =>
      `New password set for ${name}. They have been signed out everywhere.`,
    ownPassword: 'Change your own password from Settings → Password.',
    displayNameRequired: 'Display name is required.',
    invalidEmail: 'Enter a valid email address.',
    passwordTooShort: (count: number) => `Password must be at least ${count} characters.`,
    lastActiveAdmin: 'This is the last active admin. Promote or activate another admin first.',
    duplicateEmail: 'That email address is already in use.',
  },
};

export type Messages = typeof en;
