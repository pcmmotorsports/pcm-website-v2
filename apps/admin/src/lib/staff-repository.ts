import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

export interface StaffRow {
  readonly id: string;
  readonly label: string;
  readonly is_manager: boolean;
  readonly is_active: boolean;
}

export interface StaffInsert {
  readonly id: string;
  readonly label: string;
  readonly is_manager: boolean;
}

export interface StaffProfileUpdate {
  readonly label: string;
  readonly is_manager: boolean;
}

const STAFF_COLUMNS = 'id, label, is_manager, is_active' as const;

/** 讀取 staff 原始列;啟用狀態的篩選由 staff.ts 統一處理。 */
export async function listStaffRows(): Promise<StaffRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .select(STAFF_COLUMNS)
    .order('id', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * 依 id 取**單列** staff。
 *
 * 🔴 **新增函式,既有的一個字都沒動**(B5-b codex 關卡2 MF-2;主視窗 2026-08-25 裁「只准新增」)。
 * **為什麼要它**:讀取閘跑在**路由之前** ⇒ 連 `/does-not-exist`、HEAD、`/print/*.png` 都會經過。
 * 若那裡走 `listStaffRows()`(**select 整張表**),一張還沒過期的停用票就能把任意 404
 * 放大成一次全表查詢 —— codex 逐字:「不存在路徑與 public asset 也能放大 DB」。
 * ⇒ 改成 PK 精準查一列。
 *
 * ⚠️ **它與 `listStaffRows()` 的差別只有【範圍】,沒有【語意】**:
 *    `is_active` 的過濾仍然在上層(`staff.ts`)做,本函式照舊回原始列 —— 對齊本檔既有分工。
 */
export async function getStaffRowById(
  id: string,
  signal?: AbortSignal,
): Promise<StaffRow | null> {
  // 🔴 **`abortSignal` 不是可有可無**(codex R2 must-fix)。
  //    上一版只用 `Promise.race` 做逾時 ⇒ **我們不等了,而【查詢還在跑】** ——
  //    codex 逐字「輸掉的 Supabase promise 仍執行／重試;連續重登可堆積未取消請求」。
  //    ⇒ 📌 **「不再等待」與「已經停止」是兩件事**,而只有前者是 `race` 給得起的。
  //    ⇒ 那正是 DB 已經在掙扎的那一刻,我們**還在往它身上疊請求**。
  const q = createSupabaseServiceClient().from('staff').select(STAFF_COLUMNS).eq('id', id);
  const { data, error } = await (signal ? q.abortSignal(signal) : q).maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/** 新增 staff;PK 重複轉成可預期結果,其餘 DB error 交 action 安全記錄。 */
export async function insertStaffRow(
  input: StaffInsert,
): Promise<StaffRow | 'DUPLICATE'> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .insert(input)
    .select(STAFF_COLUMNS)
    .single();

  if (error) {
    if ((error as { code?: unknown }).code === '23505') return 'DUPLICATE';
    throw error;
  }
  if (!data) throw new Error('staff INSERT 未回傳新增列');
  return data;
}

/**
 * 更新 staff 顯示資料。
 * 🔴 SET 只含 label/is_manager,不得夾帶 is_active 造成 stale write 自行復活。
 */
export async function updateStaffProfileRow(
  id: string,
  update: StaffProfileUpdate,
): Promise<StaffRow | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .update({
      label: update.label,
      is_manager: update.is_manager,
    })
    .eq('id', id)
    .select(STAFF_COLUMNS);

  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * 切換 staff 啟用狀態。
 * 🔴 SET 只含 is_active,不得用舊表單值覆蓋 label/is_manager。
 */
export async function setStaffActiveRow(
  id: string,
  isActive: boolean,
): Promise<StaffRow | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .update({ is_active: isActive })
    .eq('id', id)
    .select(STAFF_COLUMNS);

  if (error) throw error;
  return data?.[0] ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ⟦b4-MGR0-RPC⟧ 改走 SECURITY DEFINER RPC —— **查核、寫入、稽核同一筆交易**
// (migration `20260912050000`, 貼板 136, 2026-09-12 已貼正式庫)
//
// 🔴 **為什麼不是改上面那三支**:上面那三支是【先查核、後寫入】那條舊路的寫入端,
//    而本片要換掉的正是那個【兩段】。⇒ 新增四支、舊的三支原封不動等退場(步驟 3),
//    這樣這一顆 commit 若要回捲, 只要把 action 那邊的呼叫換回去。
//
// 🛑 **呼叫端鐵律(我自己量出來的上界, 不是推的)**:
//    RPC 裡的全域升冪鎖序**只在一個 statement 之內**成立。
//    實測把兩發 RPC 包進同一筆交易(`BEGIN; 改自己; 改對方; COMMIT;`)⇒ **照樣死結**。
//    ⇒ 📌 **一次動作只打一發 RPC, 不得把兩發包進同一交易或同一個 batch。**
//    (supabase-js 的 `.rpc()` 每發各自一個交易 ⇒ 照這個用法就是安全的。)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 三支 staff 寫入 RPC 的結果。
 *
 * 🔴 `denied` 是**可預期結果**不是例外:RPC 的管理者閘在寫入**同一筆交易裡**重查一次
 *    (舊路是先查核、後寫入兩段 ⇒ 中間那個人可能已被停用)。
 * 🔴 **沒有 `audit_failed` 這一格, 而那是本片的重點**:稽核與寫入同生共死
 *    (Sean 2026-09-12 Q2 甲)⇒ 拿到 `ok` 就代表稽核也寫進去了。
 */
export type StaffWriteOutcome =
  | { readonly kind: 'ok'; readonly row: StaffRow }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'denied' };

/**
 * RPC 的管理者閘逐字訊息(migration `20260912050000` 三支都用同一句)。
 *
 * ⚠️ **比對訊息字面是【今天唯一可行的】辨識法, 而我誠實記下它的代價**:
 *    那三支用的是 `RAISE EXCEPTION`(預設 SQLSTATE `P0001`), 沒有自訂 ERRCODE
 *    ⇒ 要分辨「被閘擋下」與「其他 P0001」只剩訊息。
 *    🔵 而**認不出來的方向是安全的**:落到 `throw` ⇒ action 回 `error`
 *    ⇒ 畫面給一般錯誤而不是「已儲存」。**不會**把被拒當成成功。
 *    ✅ 要做對的話是在 migration 裡給一個自訂 ERRCODE —— 那支已貼正式庫,
 *       改它要再排一號貼板;今天不值得為一句錯誤訊息動正式庫。
 */
const MANAGER_GATE_MESSAGE = '無權執行此操作';

function isManagerGateRejection(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return (
    e.code === 'P0001' &&
    typeof e.message === 'string' &&
    e.message.includes(MANAGER_GATE_MESSAGE)
  );
}

/**
 * RPC 回的 `row` 是 `jsonb` ⇒ 過線之後型別上是 `unknown`。
 *
 * 🔴 **逐欄量一次, 不信型別** —— 同族理由與 `SupabaseOrderAdapter` 那幾處 runtime guard 相同:
 *    回的東西經過 PostgREST 與一個 `jsonb`, 少一欄或型別跑掉都不會有任何一格叫。
 *    ⇒ 形狀不對就 **throw**(= `error`), **不回一個半截的列**:
 *      那會被當成「已儲存」而畫面印出一個空白的顯示名。
 */
function parseStaffRow(value: unknown): StaffRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.label !== 'string') return null;
  if (typeof r.is_manager !== 'boolean') return null;
  if (typeof r.is_active !== 'boolean') return null;
  return { id: r.id, label: r.label, is_manager: r.is_manager, is_active: r.is_active };
}

async function callStaffWriteRpc(
  fn: string,
  args: Readonly<Record<string, unknown>>,
): Promise<StaffWriteOutcome> {
  // ⚠️ **`as unknown as` 是一筆要還的帳, 不是風格**:`packages/adapters` 產的 `Database` 型別
  //    是在 `20260912050000` 之前產的 ⇒ 那三支函式名不在它的 RPC 聯集裡, 直接呼叫會型別紅。
  //    ✅ 還法:那支 migration 已貼正式庫(貼板 136)⇒ **重新產一次型別, 再把這個 cast 拿掉**。
  //    🔴 在那之前, 守著「函式名 / 參數名 / 回傳形狀」的是下面那幾支測試與上面那道
  //       `parseStaffRow` runtime guard, **不是型別**。
  const { data, error } = await (
    createSupabaseServiceClient() as unknown as {
      rpc(
        name: string,
        params: Readonly<Record<string, unknown>>,
      ): Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc(fn, args);

  if (error) {
    if (isManagerGateRejection(error)) return { kind: 'denied' };
    throw error;
  }

  const envelope =
    typeof data === 'object' && data !== null
      ? (data as { result?: unknown; row?: unknown })
      : null;

  switch (envelope?.result) {
    case 'duplicate':
      return { kind: 'duplicate' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'ok': {
      const row = parseStaffRow(envelope.row);
      // 🔴 `ok` 而 row 壞掉 ⇒ throw。DB 那一側**已經寫成功了**(含稽核),
      //    而我們讀不回來 ⇒ 誠實報錯誤, 不宣稱已儲存。
      if (!row) throw new Error(`${fn}: result=ok 但 row 形狀不對`);
      return { kind: 'ok', row };
    }
    default:
      // 🔴 fail-closed:沒見過的 result 不猜。舊版函式 / 被人手改過都會落在這裡。
      throw new Error(`${fn}: 預期外的 result`);
  }
}

/** 新增員工(查核 + 寫入 + 稽核同一交易)。代號重複 ⇒ `duplicate`。 */
export function createStaffViaRpc(
  actorId: string,
  input: StaffInsert,
  requestId: string,
): Promise<StaffWriteOutcome> {
  return callStaffWriteRpc('admin_staff_create', {
    p_actor: actorId,
    p_id: input.id,
    p_label: input.label,
    p_is_manager: input.is_manager,
    p_request_id: requestId,
  });
}

/** 改顯示資料(只碰 label / is_manager;**不碰 is_active**)。 */
export function updateStaffProfileViaRpc(
  actorId: string,
  id: string,
  update: StaffProfileUpdate,
  requestId: string,
): Promise<StaffWriteOutcome> {
  return callStaffWriteRpc('admin_staff_update_profile', {
    p_actor: actorId,
    p_id: id,
    p_label: update.label,
    p_is_manager: update.is_manager,
    p_request_id: requestId,
  });
}

/** 切換啟用狀態(只碰 is_active;**不碰顯示名與管理者權限**)。 */
export function setStaffActiveViaRpc(
  actorId: string,
  id: string,
  isActive: boolean,
  requestId: string,
): Promise<StaffWriteOutcome> {
  return callStaffWriteRpc('admin_staff_set_active', {
    p_actor: actorId,
    p_id: id,
    p_is_active: isActive,
    p_request_id: requestId,
  });
}
