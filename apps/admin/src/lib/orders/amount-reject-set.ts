// amount-reject-set.ts — 🔴 「哪些 `P2C13` 是【業務拒絕】」的權威清單(M-4b E10 `#518`)。
//
// ══ 為什麼需要這一支 ═════════════════════════════════════════════════════════
//
// `code === 'P2C13'` **不等於**「員工做錯了什麼」。同一個 errcode 底下有兩類:
//   · 業務拒絕(下面 7 條)—— 員工看得懂,也可能自己處理。
//   · **不是**業務拒絕 —— `pcm_e13_subtotal_matches_lines`(跨列不變式違反 ⇒ 資料損壞)、
//     `pcm_e13_guard_unknown_table`(trigger 掛到未登記的表 ⇒ 設定錯誤)。
//     它們住在**別的函式**(commit 時才跑的 constraint trigger),執行期照樣回 `P2C13` 給客戶端。
// ⇒ 只看 `code` 的話,**資料損壞會被講成「請確認你的輸入」**。
//
// ══ 🔴 為什麼分得開靠 `details` 而不是 `constraint` ═══════════════════════════
//
// **實測(拋棄式 PG 17.10 + 真 PostgREST,帶/不帶 DETAIL 兩支並排當正反對照;2026-08-16)**:
//   帶 DETAIL   → `{"code":"P2C13","details":"pcm_e13_zero_price_needs_reason","hint":null,"message":"…"}`
//   不帶 DETAIL → `{"code":"P2C13","details":null,                            "hint":null,"message":"…"}`
// 🔴🔴 **`constraint` 這個欄位在 JSON 裡【根本不存在】** —— PostgREST 只吐
//      `code` / `details` / `hint` / `message` 四顆。
//      ⇒ RPC 一直有寫 `CONSTRAINT = '…'`,而**那個值從來沒送出去過**。
//      這就是 `#518` 的病根:不是應用層沒去讀,是它讀不到。
//
// ══ ⚠️ 這支依賴 migration 已 apply ═══════════════════════════════════════════
//
// `DETAIL` 是 `20260816040000_m4b_e10_13_518_p2c13_detail.sql` 加上去的。
// **apply 之前**,所有 `P2C13` 的 `details` 都是 `null` ⇒ 一律落到「通用錯誤 + 找系統維護」,
// 零元忘填原因的員工會看到通用訊息而不是那句有用的話。
// 🔴 **這個順序是刻意選的,不是沒想到**:
//   · 反過來(details 為 null 就沿用舊的「一律當業務拒絕」)會讓 F1 那兩條**永遠**修不掉,
//     因為它們拿不到 DETAIL —— 那等於這一片白做。
//   · 而降級的代價目前是零:**後台尚未啟用、只有 Sean 在測**
//     (memory `project_admin-preprod-planning-posture.md`,2026-08-11 Sean 逐字)。
//   ⚠️ **如果那個前提變了(員工已上工),這一片與 migration apply 的先後順序就會咬人** ——
//      屆時要嘛先 apply 再上這支,要嘛加旗標。**發現前提變了請回來看這段。**

/**
 * 🔴 **業務拒絕的 constraint 名字**(= RPC 送出的 `DETAIL` 值)。
 *
 * 權威在 `supabase/migrations/20260815040000_…_admin_update_order_item_amount.sql`;
 * `amount-p2c13-set.test.ts` 拿這顆常數與那支 migration 逐字比對 —— **改一邊就會紅**。
 * ⚠️ 新增成員之前先回答:**它是「員工做錯了什麼」還是「系統壞了」?**
 *    答不出來就不要加進來(fail-closed 到通用錯誤,比誤導員工安全)。
 */
export const ORDER_AMOUNT_BUSINESS_CONSTRAINTS = [
  'pcm_e13_zero_price_needs_reason',
  'pcm_e13_reason_only_for_zero',
  'pcm_e13_no_edit_after_payment',
  'pcm_e13_discount_not_supported',
  'pcm_e13_line_total_overflow',
  'pcm_e13_total_negative',
  'pcm_e13_order_amount_overflow',
] as const;

const BUSINESS_SET: ReadonlySet<string> = new Set(ORDER_AMOUNT_BUSINESS_CONSTRAINTS);

/**
 * 這個錯誤是不是「員工看得懂、也可能自己處理」的業務拒絕?
 *
 * **fail-closed**:認不出來一律回 `false` ⇒ 走通用錯誤 + 「找系統維護」。
 * 🔴 兩個方向的代價不對稱 ——
 *   把系統故障講成「請確認你的輸入」⇒ 員工往錯方向查、而且會一直重試;
 *   把業務拒絕講成「找系統維護」⇒ 多一通電話,資料沒事。
 */
export function isOrderAmountBusinessRejection(err: unknown): boolean {
  return readBusinessConstraint(err) !== undefined;
}

/**
 * 🔴 **`details` 只讀一次**,判斷與回傳用的是**同一次讀到的值**(codex 關卡2 R1 must-fix 2)。
 *
 * 初版是兩支各自讀:`isOrderAmountBusinessRejection` 讀一次驗過,
 * `orderAmountRejectCodeForLog` **再讀一次**才回傳 ——
 * 而 `details` 若是個 getter(或 Proxy),**第一次回白名單值、第二次回敏感字串**,
 * 那道白名單就形同不存在。
 * ⚠️ 這不是理論潔癖:錯誤物件是從 supabase-js 手上拿到的,
 * **本檔的前提是「不信任這個物件的內容」** —— 那就不能給它兩次機會。
 */
function readBusinessConstraint(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: unknown; details?: unknown };
  if (e.code !== 'P2C13') return undefined;
  const details = e.details; // ← 讀一次,之後只用這個區域變數
  if (typeof details !== 'string' || !BUSINESS_SET.has(details)) return undefined;
  return details;
}

/**
 * 可以安全寫進 log 的拒絕代號。
 *
 * 🔴 **只回清單內的值,不回原始 `details`** —— 這一支的回傳值會進 `console.error`,
 * 而「進 log 的東西必須是我這邊控制的固定字串」是本檔的前提。
 * 現在 `details` 確實只放常數,但**這個保證住在 migration 裡、不住在這裡** ——
 * 哪天有人在 SQL 那邊把員工輸入內插進 `DETAIL`,這道過濾就是唯一還站著的東西。
 */
export function orderAmountRejectCodeForLog(err: unknown): string | undefined {
  return readBusinessConstraint(err);
}
