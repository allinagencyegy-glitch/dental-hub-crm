/**
 * Customers: the people Dental Hub has sold to.
 *
 * A customer is a contact with at least one WON opportunity. There is no
 * customer table - the list is read from the won deals, so it can never drift
 * from the pipeline, and a lead converted and won today is a customer at once.
 *
 * Row scope follows the deals: a rep sees the customers of the deals they won,
 * a team leader those of their team's deals, a manager or admin everyone.
 * Counts and values only ever include deals inside that scope.
 */
import type { Db } from '@/server/db/types';
import { ownerScopeSql, type Actor } from '@/server/crm/scope';
import { likePattern } from '@/server/db/like';

export interface CustomerListRow {
  contactId: string;
  name: string;
  phone: string | null;
  accountName: string | null;
  /** Owner of the most recent won deal. */
  ownerName: string;
  /** The most recent won deal, which the row links to. */
  lastOpportunityId: string;
  lastPurchaseAt: Date;
  purchases: number;
  /** Sum of the won deals whose value is known; null when none is. */
  totalValue: number | null;
  /** Won deals with no accepted quotation and no estimated value. */
  purchasesWithoutValue: number;
  /** Deals still open with this customer, inside the actor's scope. */
  openDeals: number;
  categories: { code: string; name: string }[];
}

export interface CustomerListSummary {
  customers: number;
  purchases: number;
  totalValue: number;
  purchasesWithoutValue: number;
}

/**
 * The customers page, most recent purchase first. The summary covers the
 * whole scope (and the search and owner filter), not just the page.
 */
export async function listCustomers(
  db: Db,
  actor: Actor,
  options: { ownerUserId?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<{ customers: CustomerListRow[]; summary: CustomerListSummary }> {
  const { ownerUserId, search, limit = 25, offset = 0 } = options;
  const params: unknown[] = [];

  const wonClauses = [`o.stage = 'WON'`];
  const wonScope = ownerScopeSql(actor, params, ['o.owner_user_id']);
  if (wonScope) wonClauses.push(wonScope);
  if (ownerUserId) {
    params.push(ownerUserId);
    wonClauses.push(`o.owner_user_id = $${params.length}`);
  }

  const customerClauses: string[] = [];
  if (search !== undefined && search.trim() !== '') {
    params.push(likePattern(search.trim()));
    const placeholder = `$${params.length}`;
    customerClauses.push(`(
      c.full_name ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(a.name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR owner.display_name ILIKE ${placeholder} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM crm_contact_channel ch
         WHERE ch.contact_id = c.id AND ch.value ILIKE ${placeholder} ESCAPE '\\'
      )
    )`);
  }

  // A won deal is worth its accepted quotation (an opportunity holds at most
  // one) or, failing that, the estimate its owner recorded.
  const customersCte = `
    WITH won AS (
      SELECT o.id, o.contact_id, o.account_id, o.owner_user_id, o.product_category_id, o.won_at,
             COALESCE(accepted.total_amount, o.estimated_value) AS value
        FROM crm_opportunity o
        LEFT JOIN crm_quotation accepted
          ON accepted.opportunity_id = o.id AND accepted.status = 'ACCEPTED'
       WHERE ${wonClauses.join(' AND ')}
    ),
    customer AS (
      SELECT w.contact_id,
             count(*)::int AS purchases,
             sum(w.value) AS total_value,
             (count(*) - count(w.value))::int AS purchases_without_value,
             max(w.won_at) AS last_purchase_at,
             (array_agg(w.id ORDER BY w.won_at DESC, w.id DESC))[1] AS last_opportunity_id,
             (array_agg(w.owner_user_id ORDER BY w.won_at DESC, w.id DESC))[1] AS owner_user_id,
             (array_agg(w.account_id ORDER BY w.won_at DESC, w.id DESC)
                FILTER (WHERE w.account_id IS NOT NULL))[1] AS account_id,
             array_agg(DISTINCT w.product_category_id)
                FILTER (WHERE w.product_category_id IS NOT NULL) AS category_ids
        FROM won w
       GROUP BY w.contact_id
    ),
    listed AS (
      SELECT cu.*, c.full_name, a.name AS account_name, owner.display_name AS owner_name
        FROM customer cu
        JOIN crm_contact c     ON c.id = cu.contact_id
        JOIN crm_user owner    ON owner.id = cu.owner_user_id
        LEFT JOIN crm_account a ON a.id = cu.account_id
       ${customerClauses.length > 0 ? `WHERE ${customerClauses.join(' AND ')}` : ''}
    )`;

  const { rows: summaryRows } = await db.query<{
    customers: number;
    purchases: number;
    total_value: string;
    purchases_without_value: number;
  }>(
    `${customersCte}
     SELECT count(*)::int AS customers,
            COALESCE(sum(purchases), 0)::int AS purchases,
            COALESCE(sum(total_value), 0)::text AS total_value,
            COALESCE(sum(purchases_without_value), 0)::int AS purchases_without_value
       FROM listed`,
    params,
  );
  const summary: CustomerListSummary = {
    customers: summaryRows[0].customers,
    purchases: summaryRows[0].purchases,
    totalValue: Number(summaryRows[0].total_value),
    purchasesWithoutValue: summaryRows[0].purchases_without_value,
  };

  // The open-deal count has its own scope parameter, so the summary query
  // above never carries a parameter it does not use.
  const pageParams = [...params];
  const openClauses = [`od.contact_id = cu.contact_id`, `od.stage NOT IN ('WON', 'LOST')`];
  const openScope = ownerScopeSql(actor, pageParams, ['od.owner_user_id']);
  if (openScope) openClauses.push(openScope);
  pageParams.push(limit, offset);
  const { rows } = await db.query<{
    contact_id: string;
    full_name: string;
    phone: string | null;
    account_name: string | null;
    owner_name: string;
    last_opportunity_id: string;
    last_purchase_at: Date;
    purchases: number;
    total_value: string | null;
    purchases_without_value: number;
    open_deals: number;
    categories: { code: string; name: string }[] | null;
  }>(
    `${customersCte}
     SELECT cu.contact_id, cu.full_name, cu.account_name, cu.owner_name, cu.last_opportunity_id,
            cu.last_purchase_at, cu.purchases, cu.total_value::text AS total_value,
            cu.purchases_without_value,
            phone.value AS phone,
            (SELECT count(*)::int FROM crm_opportunity od WHERE ${openClauses.join(' AND ')}) AS open_deals,
            (SELECT json_agg(json_build_object('code', pc.code, 'name', pc.name) ORDER BY pc.name)
               FROM crm_product_category pc
              WHERE pc.id = ANY(cu.category_ids)) AS categories
       FROM listed cu
       LEFT JOIN LATERAL (
         SELECT ch.value
           FROM crm_contact_channel ch
          WHERE ch.contact_id = cu.contact_id AND ch.channel_type = 'PHONE' AND ch.is_active = true
          ORDER BY ch.created_at ASC, ch.id ASC
          LIMIT 1
       ) phone ON true
      ORDER BY cu.last_purchase_at DESC, cu.contact_id DESC
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
  );

  return {
    customers: rows.map((row) => ({
      contactId: row.contact_id,
      name: row.full_name,
      phone: row.phone,
      accountName: row.account_name,
      ownerName: row.owner_name,
      lastOpportunityId: row.last_opportunity_id,
      lastPurchaseAt: row.last_purchase_at,
      purchases: row.purchases,
      totalValue: row.total_value === null ? null : Number(row.total_value),
      purchasesWithoutValue: row.purchases_without_value,
      openDeals: row.open_deals,
      categories: row.categories ?? [],
    })),
    summary,
  };
}
