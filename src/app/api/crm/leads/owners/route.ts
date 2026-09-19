import { requirePermission } from '@/server/auth/dal';
import { getAssignableOwnersAction } from '@/server/crm/leads/actions';

export async function GET() {
  try {
    await requirePermission('leads:write');
    const owners = await getAssignableOwnersAction();
    return Response.json({ owners });
  } catch {
    return Response.json({ owners: [] }, { status: 401 });
  }
}