import 'server-only';
import type { PartialCancelReconciliationCounts } from '@pcm/use-cases';

// 部分取消對帳表(OP7 ④ `pcm_partial_cancel_refund_reconciliation_v`)給每日告警的計數。
// 🔴 那支 view 只 GRANT SELECT 給 service_role(20260914070000)⇒ client 由 composition 給;
//    告警自己那條 payment_confirmer 連線讀不到它(正式庫 2026-09-15 has_table_privilege 實查 = f)。
// 🔴 只讀 missing_row / rail_mismatch 兩種(Sean 2026-09-15 Q5 甲):has_card / tax_uncomputable 只留在後台頁。
//    篩在 DB 端而不是抓回來再數 —— 那兩種只增不減, 抓回來再數的話它們會把真的漏開擠出 LIMIT 之外
//    ⇒ 那一行不出聲(adversarial-reviewer R2 must-fix)。⇒ `count: 'exact'` 本身就是要報的張數, LIMIT 只影響細分。
//    ⚠️ 取捨:view 以後多出不認得的 kind 不會被抓回來(不進信, 只在後台頁)。

const REPORTED_KINDS = ['missing_row', 'rail_mismatch'];
const LIMIT = 1000;

/** 只要這一條查詢鏈 —— client 由 `payment/composition.ts` 的 `getPartialCancelReconciliationClient` 給(storefront 只准 composition 碰 service key)。 */
export type ReconClient = {
  from(table: never): {
    select(columns: never, options: { count: 'exact' }): {
      in(column: never, values: never): {
        limit(n: number): PromiseLike<{ data: unknown; error: unknown; count: number | null }>;
      };
    };
  };
};

/** 讀失敗 ⇒ throw(route 接成「查不到」)。 */
export async function readPartialCancelReconciliationCounts(
  client: ReconClient,
): Promise<PartialCancelReconciliationCounts> {
  const { data, error, count } = await client
    .from('pcm_partial_cancel_refund_reconciliation_v' as never)
    .select('kind' as never, { count: 'exact' })
    .in('kind' as never, REPORTED_KINDS as never)
    .limit(LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { kind: string }[];
  const out = { total: count ?? rows.length, missingRow: 0, railMismatch: 0 };
  for (const r of rows) {
    if (r.kind === 'missing_row') out.missingRow += 1;
    else if (r.kind === 'rail_mismatch') out.railMismatch += 1;
  }
  return out satisfies PartialCancelReconciliationCounts;
}
