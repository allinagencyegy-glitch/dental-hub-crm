'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { assertPermission } from '@/server/auth/dal';
import { ROLES } from '@/server/authz/permissions';
import { MIN_PASSWORD_LENGTH, type AdminFormState } from '@/server/auth/form-state';
import {
  DuplicateEmailError,
  LastActiveAdminError,
  createUser,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from './repository';

const USERS_PATH = '/crm/settings/users';

const createUserSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required.').max(120),
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(512),
  role: z.enum(ROLES),
});

const roleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(ROLES),
});

const activeSchema = z.object({
  userId: z.uuid(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

const resetPasswordSchema = z.object({
  userId: z.uuid(),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(512),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'That input is not valid.';
}

function toFormError(error: unknown): AdminFormState {
  if (error instanceof LastActiveAdminError || error instanceof DuplicateEmailError) {
    return { error: error.message };
  }
  throw error;
}

export async function createUserAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  // Server Actions are public endpoints: re-authorise on every call.
  await assertPermission('users:manage');

  const parsed = createUserSchema.safeParse({
    displayName: formData.get('displayName'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    const user = await createUser(db(), parsed.data);
    revalidatePath(USERS_PATH);
    return { success: `Created ${user.displayName}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function changeUserRoleAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await assertPermission('users:manage');

  const parsed = roleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    const user = await setUserRole(db(), parsed.data.userId, parsed.data.role);
    revalidatePath(USERS_PATH);
    return { success: `Updated the role for ${user.displayName}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function setUserActiveAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await assertPermission('users:manage');

  const parsed = activeSchema.safeParse({
    userId: formData.get('userId'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    const user = await setUserActive(db(), parsed.data.userId, parsed.data.isActive);
    revalidatePath(USERS_PATH);
    return { success: `${user.isActive ? 'Activated' : 'Deactivated'} ${user.displayName}.` };
  } catch (error) {
    return toFormError(error);
  }
}

export async function resetUserPasswordAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const session = await assertPermission('users:manage');

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get('userId'),
    newPassword: formData.get('newPassword'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // Your own password goes through Settings → Password, which asks for the current one.
  if (parsed.data.userId === session.user.id) {
    return { error: 'Change your own password from Settings → Password.' };
  }

  const user = await resetUserPassword(db(), parsed.data.userId, parsed.data.newPassword);
  return {
    success: `New password set for ${user.displayName}. They have been signed out everywhere.`,
  };
}
