// 後台經銷商申請與經銷帳號(片 D1 / D2 / D4a)。service_role 對 dealer_applications 只有 SELECT(20260925010000);
// 寫入一律走資料庫函式(核准 / 婉拒、後台建經銷帳號)。
import 'server-only';
import { isEmailExistsError } from '@pcm/adapters';
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

/** 核准 / 婉拒(片 D2)。失敗直接丟出去, 由 action 當成「結果無法確認」。 */
export async function decideDealerApplication(p: Parameters<SupabaseDealerApplicationAdapter['decide']>[0]): Promise<string> {
  return adapter().decide(p);
}

/**
 * 邀請信寄完之後, 客人點信裡的連結落到顧客站 /auth/confirm 設定密碼(B2B 計畫 §9.9)。
 * 🔴 固定網址, 不收參數;也要列進 Supabase 的 Redirect URLs。
 */
export const DEALER_INVITE_REDIRECT_TO = 'https://www.pcmmotorsports.com/auth/confirm';

export type InviteOutcome = { kind: 'ok'; userId: string } | { kind: 'exists' } | { kind: 'failed' } | { kind: 'unknown' };

/**
 * 建帳號並寄邀請信(片 D4a 第 1 步)。員工看不到、也設不了密碼。
 * unknown = 呼叫整段拋出或回應認不得:帳號可能已經建好, 呼叫端不能說「失敗」。
 */
export async function inviteDealerUser(email: string, name: string): Promise<InviteOutcome> {
  try {
    const client = createSupabaseServiceClient();
    const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
      redirectTo: DEALER_INVITE_REDIRECT_TO,
      data: { name },
    });
    if (error) {
      const e = error as { code?: string; message?: string; status?: number; name?: string };
      if (isEmailExistsError(e)) return { kind: 'exists' };
      // 🔴 只記錯誤碼與狀態碼, 不記 message(Codex R1:部分錯誤的訊息會帶收件 Email)
      console.error('[dealer-account] 邀請沒有成功', { code: e.code, status: e.status, name: e.name });
      // 🔴 網路斷線 / 閘道逾時 / 5xx:Supabase 可能已經建好帳號、寄出信, 只是回應沒回來(Codex R1)⇒ 結果不明。
      //    只有明確的 4xx 才能說「沒有建立」。
      const status = typeof e.status === 'number' ? e.status : 0;
      return status >= 400 && status < 500 ? { kind: 'failed' } : { kind: 'unknown' };
    }
    const userId = data.user?.id;
    if (!userId) {
      console.error('[dealer-account] 邀請回應沒有 user id(結果不明)');
      return { kind: 'unknown' };
    }
    return { kind: 'ok', userId };
  } catch (err) {
    console.error('[dealer-account] 邀請整段拋出(結果不明)', { name: (err as Error)?.name });
    return { kind: 'unknown' };
  }
}

/** 片 D4a 第 3 步。失敗直接丟出去, 由 action 顯示「重新完成設定」。 */
export async function createStaffDealer(p: Parameters<SupabaseDealerApplicationAdapter['createStaffDealer']>[0]): Promise<string> {
  return adapter().createStaffDealer(p);
}

/**
 * 用登入 Email 找帳號(片 D4a「用這個帳號完成經銷設定」)。由 server 查, 不收表單傳來的 user ID。
 * 🔴 兩道(Codex D4a R2):
 *   ① 不分大小寫的【完整】比對:ilike 先撈候選(Email 裡的 _ % * 會變成萬用字元 ⇒ 候選只會多不會少),
 *      再在這裡逐字比小寫;對到兩筆以上 ⇒ 不自動挑。
 *   ② 對到的那個帳號, 登入系統(Auth)裡現在的 Email 也要是這一個:customers 的 Email 可能沒跟上
 *      (改信箱半套那條路, email-change-action.ts)⇒ 不一致就停, 不把別人的帳號升成車行。
 */
export type CustomerLookup =
  | { kind: 'found'; userId: string }
  | { kind: 'none' }
  | { kind: 'ambiguous' | 'mismatch' | 'failed' };

const LOOKUP_CANDIDATES = 50;

export async function findCustomerIdByEmail(email: string): Promise<CustomerLookup> {
  const want = email.toLowerCase();
  try {
    const client = createSupabaseServiceClient();
    const { data, error } = await client.from('customers').select('user_id, email').ilike('email', email).limit(LOOKUP_CANDIDATES);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length >= LOOKUP_CANDIDATES) return { kind: 'ambiguous' };
    const hits = rows.filter((r) => typeof r.email === 'string' && r.email.toLowerCase() === want);
    if (hits.length === 0) return { kind: 'none' };
    if (hits.length > 1) {
      console.error('[dealer-account] 同一個 Email(不分大小寫)對到多個帳號, 不自動挑', { count: hits.length });
      return { kind: 'ambiguous' };
    }
    const userId = hits[0]!.user_id;
    const auth = await client.auth.admin.getUserById(userId);
    if (auth.error) throw auth.error;
    if ((auth.data.user?.email ?? '').toLowerCase() !== want) {
      console.error('[dealer-account] 客戶資料與登入系統的 Email 不一致, 停止');
      return { kind: 'mismatch' };
    }
    return { kind: 'found', userId };
  } catch (err) {
    console.error('[dealer-account] 用 Email 查帳號失敗', { code: (err as { code?: unknown })?.code, status: (err as { status?: unknown })?.status });
    return { kind: 'failed' };
  }
}
