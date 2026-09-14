/**
 * The only shape of a user that may leave the server.
 *
 * `password_hash` exists on the row type and is absent from the DTO by
 * construction - there is no code path that can accidentally serialise it.
 */
import type { Role } from '@/server/authz/permissions';

/**
 * Raw `crm_user` row. Never leaves `src/server`.
 * Declared as a type alias (not an interface) so it satisfies pg's
 * `QueryResultRow` index-signature constraint.
 */
export type UserRow = {
  id: string;
  display_name: string;
  email: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Safe to pass to Client Components and to serialise into a response. */
export interface PublicUser {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
