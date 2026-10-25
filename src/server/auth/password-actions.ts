'use server';

import 'server-only';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { changeUserPassword, findUserById } from '@/server/users/repository';
import { assertPermission } from './dal';
import { verifyPassword } from './password';
import { MIN_PASSWORD_LENGTH, type PasswordFormState } from './form-state';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(512),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      .max(512),
    confirmPassword: z.string().max(512),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The new passwords do not match.',
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'The new password must be different from the current one.',
  });

export async function changePasswordAction(
  _prevState: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  // Server Actions are public endpoints: re-authorise on every call. Every
  // signed-in user may change their own password, and only their own.
  const session = await assertPermission('crm:access');

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'That input is not valid.' };
  }

  // Re-proving the old password means a session left open on a shared machine
  // cannot be used to take the account over.
  const user = await findUserById(db(), session.user.id);
  if (!user || !(await verifyPassword(user.password_hash, parsed.data.currentPassword))) {
    return { error: 'Your current password is incorrect.' };
  }

  await changeUserPassword(db(), user.id, parsed.data.newPassword, session.sessionId);
  return { success: 'Password changed. You have been signed out everywhere else.' };
}
