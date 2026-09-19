import { requirePermission } from '@/server/auth/dal';
import { getSourceCampaignsAction } from '@/server/crm/leads/actions';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    await requirePermission('leads:write');

    const searchParams = request.nextUrl.searchParams;
    const sourceCode = searchParams.get('sourceCode');

    if (!sourceCode) {
      return Response.json({ campaigns: [] });
    }

    const campaigns = await getSourceCampaignsAction(sourceCode);
    return Response.json({ campaigns });
  } catch {
    return Response.json({ campaigns: [] }, { status: 401 });
  }
}