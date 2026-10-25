'use server';

import 'server-only';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { changeUserPassword, findUserById } from '@/server/users/repository';
import { assertPermission } from './dal';
import { verifyPassword } from './password';
import { getMessages } from '@/i18n/server';
import type { Messages } from '@/i18n/messages';
import { MIN_PASSWORD_LENGTH, type PasswordFormState } from './form-state';

function changePasswordSchema(m: Messages) {
  return z
    .object({
      currentPassword: z.string().min(1, m.password.enterCurrent).max(512),
      newPassword: z
        .string()
        .min(MIN_PASSWORD_LENGTH, m.password.newTooShort(MIN_PASSWORD_LENGTH))
        .max(512),
      confirmPassword: z.string().max(512),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: m.password.mismatch,
    })
    .refine((data) => data.newPassword !== data.currentPassword, {
      message: m.password.sameAsCurrent,
    });
}

export async function changePasswordAction(
  _prevState: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  // Server Actions are public endpoints: re-authorise on every call. Every
  // signed-in user may change their own password, and only their own.
  const session = await assertPermission('crm:access');
  const m = await getMessages();

  const parsed = changePasswordSchema(m).safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? m.common.invalidInput };
  }

  // Re-proving the old password means a session left open on a shared machine
  // cannot be used to take the account over.
  const user = await findUserById(db(), session.user.id);
  if (!user || !(await verifyPassword(user.password_hash, parsed.data.currentPassword))) {
    return { error: m.password.currentIncorrect };
  }

  await changeUserPassword(db(), user.id, parsed.data.newPassword, session.sessionId);
  return { success: m.password.changed };
}
