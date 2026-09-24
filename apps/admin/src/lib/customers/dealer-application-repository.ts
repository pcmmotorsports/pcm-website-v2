// 後台讀經銷商申請(片 D1)。service_role 對 dealer_applications 只有 SELECT(20260925010000);
// 決定(核准 / 婉拒)走 admin_dealer_application_decide(片 D2), 這裡不寫。
import 'server-only';
import { createSupabaseServiceClient, SupabaseDealerApplicationAdapter } from '@pcm/adapters/server';
import type { DealerApplicationRow, DealerAppStatusFilter } from './dealer-application-view';

/** 列表上限;審核中的申請不會多到超過這個數, 真的超過畫面會寫「只顯示最新的 200 筆」。 */
export const DEALER_APP_LIST_LIMIT = 200;

function adapter() {
  return new SupabaseDealerApplicationAdapter(createSupabaseServiceClient());
}

export async function loadDealerApplications(
  filter: DealerAppStatusFilter,
): Promise<{ ok: true; rows: DealerApplicationRow[] } | { ok: false }> {
  let r: Awaited<ReturnType<SupabaseDealerApplicationAdapter['list']>>;
  try {
    r = await adapter().list(filter, DEALER_APP_LIST_LIMIT);
  } catch (error) {
    // 建 client 失敗(缺 env)也要落到「載入失敗」畫面, 不讓整頁 500(Fable R1)
    r = { ok: false, error };
  }
  if (!r.ok) {
    console.error('[dealer-applications] 列表讀取失敗', r.error);
    return { ok: false };
  }
  return { ok: true, rows: r.rows };
}

export type DealerApplicationDetail = {
  app: DealerApplicationRow;
  customer: { tier: string; created_at: string; email: string; name: string | null } | null;
};

export async function loadDealerApplication(
  id: string,
): Promise<{ ok: true; detail: DealerApplicationDetail | null } | { ok: false }> {
  try {
    const client = createSupabaseServiceClient();
    const r = await new SupabaseDealerApplicationAdapter(client).get(id);
    if (!r.ok) {
      console.error('[dealer-applications] 明細讀取失敗', r.error);
      return { ok: false };
    }
    if (!r.row) return { ok: true, detail: null };
    const c = await client.from('customers').select('tier, created_at, email, name').eq('user_id', r.row.user_id).maybeSingle();
    if (c.error) {
      console.error('[dealer-applications] 客戶資料讀取失敗', c.error);
      return { ok: false };
    }
    return { ok: true, detail: { app: r.row, customer: c.data ?? null } };
  } catch (error) {
    console.error('[dealer-applications] 明細讀取失敗', error);
    return { ok: false };
  }
}

/** 客戶頁那一行「經銷商申請：N 件待審核」用。讀不到回 null(不是 0)。 */
export async function countPendingDealerApplications(): Promise<number | null> {
  let r: Awaited<ReturnType<SupabaseDealerApplicationAdapter['countPending']>>;
  try {
    r = await adapter().countPending();
  } catch (error) {
    // 客戶頁不能因為這一行而整頁壞掉(Fable R1)
    r = { ok: false, error };
  }
  if (!r.ok) {
    console.error('[dealer-applications] 待審核件數讀取失敗', r.error);
    return null;
  }
  return r.count;
}
