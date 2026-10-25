/**
 * Shared between Client Components and `'use server'` modules. Kept in its own
 * file because a `'use server'` module may only export async functions.
 */
export interface LoginFormState {
  error?: string;
}

export interface AdminFormState {
  error?: string;
  success?: string;
}

/** The same minimum an admin must meet when creating a user. */
export const MIN_PASSWORD_LENGTH = 12;

export interface PasswordFormState {
  error?: string;
  success?: string;
}

export const EMPTY_LOGIN_STATE: LoginFormState = {};
export const EMPTY_ADMIN_STATE: AdminFormState = {};
export const EMPTY_PASSWORD_STATE: PasswordFormState = {};
