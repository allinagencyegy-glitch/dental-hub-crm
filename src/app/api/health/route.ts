import { NextResponse } from 'next/server';
import { db } from '@/server/db/client';

/** Never prerendered: readiness must reflect the moment it is asked. */
export const dynamic = 'force-dynamic';

interface HealthPayload {
  status: 'ok' | 'degraded';
  service: 'dental-hub-crm';
  checks: {
    database: { connected: boolean; migrationsApplied: number | null };
  };
}

export async function GET(): Promise<NextResponse<HealthPayload>> {
  let connected = false;
  let migrationsApplied: number | null = null;

  try {
    const { rows } = await db().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM crm_schema_migration',
    );
    connected = true;
    migrationsApplied = Number(rows[0].count);
  } catch {
    // Deliberately swallowed: connection strings and driver errors must never
    // reach an unauthenticated caller.
    connected = false;
  }

  const ready = connected && (migrationsApplied ?? 0) > 0;

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'degraded',
      service: 'dental-hub-crm',
      checks: { database: { connected, migrationsApplied } },
    },
    { status: ready ? 200 : 503 },
  );
}
