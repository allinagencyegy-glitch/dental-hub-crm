'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { assertPermission } from '@/server/auth/dal';
import { ROLES } from '@/server/authz/permissions';
import { MIN_PASSWORD_LENGTH, type AdminFormState } from '@/server/auth/form-state';
import { getMessages } from '@/i18n/server';
import type { Messages } from '@/i18n/messages';
import {
  DuplicateEmailError,
  LastActiveAdminError,
  TeamAssignmentError,
  createUser,
  resetUserPassword,
  setUserActive,
  setUserRole,
  setUserTeamLeader,
} from './repository';

const USERS_PATH = '/crm/settings/users';

function createUserSchema(m: Messages) {
  return z.object({
    displayName: z.string().trim().min(1, m.users.displayNameRequired).max(120),
    email: z.email(m.users.invalidEmail).max(254),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, m.users.passwordTooShort(MIN_PASSWORD_LENGTH))
      .max(512),
    role: z.enum(ROLES, m.common.invalidInput),
  });
}

function roleSchema(m: Messages) {
  return z.object({
    userId: z.uuid(m.common.invalidInput),
    role: z.enum(ROLES, m.common.invalidInput),
  });
}

function teamSchema(m: Messages) {
  return z.object({
    userId: z.uuid(m.common.invalidInput),
    // An empty choice takes the rep off any team.
    teamLeaderId: z.union([z.literal('').transform(() => null), z.uuid(m.common.invalidInput)]),
  });
}

function activeSchema(m: Messages) {
  return z.object({
    userId: z.uuid(m.common.invalidInput),
    isActive: z.enum(['true', 'false'], m.common.invalidInput).transform((value) => value === 'true'),
  });
}

function resetPasswordSchema(m: Messages) {
  return z.object({
    userId: z.uuid(m.common.invalidInput),
    newPassword: z
      .string(m.common.invalidInput)
      .min(MIN_PASSWORD_LENGTH, m.users.passwordTooShort(MIN_PASSWORD_LENGTH))
      .max(512),
  });
}

function firstIssue(error: z.ZodError, m: Messages): string {
  return error.issues[0]?.message ?? m.common.invalidInput;
}

function toFormError(error: unknown, m: Messages): AdminFormState {
  if (error instanceof LastActiveAdminError) return { error: m.users.lastActiveAdmin };
  if (error instanceof DuplicateEmailError) return { error: m.users.duplicateEmail };
  if (error instanceof TeamAssignmentError) {
    return { error: error.reason === 'NOT_A_REP' ? m.users.teamOnlyForReps : m.users.teamLeaderInvalid };
  }
  throw error;
}

export async function createUserAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  // Server Actions are public endpoints: re-authorise on every call.
  await assertPermission('users:manage');
  const m = await getMessages();

  const parsed = createUserSchema(m).safeParse({
    displayName: formData.get('displayName'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error, m) };

  try {
    const user = await createUser(db(), parsed.data);
    revalidatePath(USERS_PATH);
    return { success: m.users.created(user.displayName) };
  } catch (error) {
    return toFormError(error, m);
  }
}

export async function changeUserRoleAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await assertPermission('users:manage');
  const m = await getMessages();

  const parsed = roleSchema(m).safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error, m) };

  try {
    const user = await setUserRole(db(), parsed.data.userId, parsed.data.role);
    revalidatePath(USERS_PATH);
    return { success: m.users.roleUpdated(user.displayName) };
  } catch (error) {
    return toFormError(error, m);
  }
}

export async function setUserTeamLeaderAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await assertPermission('users:manage');
  const m = await getMessages();

  const parsed = teamSchema(m).safeParse({
    userId: formData.get('userId'),
    teamLeaderId: formData.get('teamLeaderId'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error, m) };

  try {
    const user = await setUserTeamLeader(db(), parsed.data.userId, parsed.data.teamLeaderId);
    revalidatePath(USERS_PATH);
    return { success: m.users.teamUpdated(user.displayName) };
  } catch (error) {
    return toFormError(error, m);
  }
}

export async function setUserActiveAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await assertPermission('users:manage');
  const m = await getMessages();

  const parsed = activeSchema(m).safeParse({
    userId: formData.get('userId'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error, m) };

  try {
    const user = await setUserActive(db(), parsed.data.userId, parsed.data.isActive);
    revalidatePath(USERS_PATH);
    return {
      success: user.isActive ? m.users.activated(user.displayName) : m.users.deactivated(user.displayName),
    };
  } catch (error) {
    return toFormError(error, m);
  }
}

export async function resetUserPasswordAction(
  _prevState: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const session = await assertPermission('users:manage');
  const m = await getMessages();

  const parsed = resetPasswordSchema(m).safeParse({
    userId: formData.get('userId'),
    newPassword: formData.get('newPassword'),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error, m) };

  // Your own password goes through Settings → Password, which asks for the current one.
  if (parsed.data.userId === session.user.id) {
    return { error: m.users.ownPassword };
  }

  const user = await resetUserPassword(db(), parsed.data.userId, parsed.data.newPassword);
  return { success: m.users.passwordReset(user.displayName) };
}
