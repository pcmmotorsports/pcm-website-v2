import type { AdminOrderNote, AdminOrderNoteChannel, AdminOrderNoteType } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * @module @pcm/adapters/supabase/mappers/order-notes — `order_notes` 內嵌列 → domain 備註時間軸
 *   + U6 告知義務(M-4b E10 A9a-1;plan `docs/specs/2026-08-02-e10-notes-line-plan.md` v4 §5)
 *
 * 🔴 **為什麼 U6 在 mapper 算、不在 PostgREST 投影算**(plan v4 §5 [50]):建表檔
 * `supabase/migrations/20260729030000_m4b_e10_a3_order_notes.sql:164-169` 給的合約形狀是 `NOT EXISTS`
 * 子查詢,而 **PostgREST 投影不支援子查詢** —— 2026-08-02 對 production 實跑,把該子查詢塞進
 * `select=` 回 **HTTP 400 `PGRST100` failed to parse select parameter**(不是猜的);本片零 migration
 * ⇒ 不開 view / RPC。此處集合運算與該 SQL **語意等價,前提 = `rows` 是該單的全部 notes**
 * (截斷時兩者會分岔:被截掉的更正列會讓已作廢的告知看起來仍有效 ⇒ 見 `notesTruncated`)。
 * 複合 FK `:79-81` 強制更正列與被更正列同單 ⇒ 未截斷時「同單全部 notes」就足夠,不需掃全表。
 *
 * 🔴 **排序自己做**(plan v4 §5 [51]):PostgREST **不保證**內嵌列順序 ⇒ 這裡釘死
 * `createdAt` ASC + 全序 tie-break(見 `compareNotes`)。
 */

/**
 * 內嵌 notes 的請求上限(**我們自己指定**,adapter 以 `.limit(n, { referencedTable: 'order_notes' })` 送出)。
 *
 * 🔴 **為什麼要自己指定、而不是沿用伺服器的 `max-rows`**:PostgREST 的 `max-rows` **對內嵌列同樣生效**
 * (2026-08-02 對 production 實測 = **1000**:`GET /rest/v1/brands?select=id,products(id)
 * &id=eq.05be10ec-1581-4ff8-b01f-a437eefcf35b`,該 brand 有 4566 個 products 卻只回 1000;
 * 顯式 `products.limit=2000` 一樣被夾成 1000、`products.limit=5` 則照給 5 ⇒ 是上限不是預設)。
 * 那個值是**專案設定的複本**,程式裡釘不住它;改小了 `rows.length >= 1000` 會恆 false = 截斷靜默失效。
 * ⇒ 改成請求端自己夾一個**嚴格低於實測上限**的值,邊界就由本常數擁有、與伺服器設定脫鉤。
 *
 * ⚠️ **殘餘風險(不宣稱涵蓋)**:若日後把專案 `max-rows` 設到**低於本值**,截斷會發生在那個更低的數字上
 * 而本判定看不見。本片不處理(要處理得改成第二支帶 `count: 'exact'` 的查詢 = 每次明細多一次往返)。
 * 🔴 觸及本值時無法分辨「剛好這麼多筆」與「被截斷」⇒ 一律當**可能被截斷**(fail-closed)。
 */
export const ORDER_NOTES_EMBED_LIMIT = 200;

/**
 * `order_notes` 內嵌投影列型別 —— derive 自生成 Database Row(對齊 SupabaseAdminOrderDetailRow 慣例)。
 * 🔴 投影**不取** `order_id`(父列即該單)。
 */
export type SupabaseOrderNoteRow = Pick<
  Database['public']['Tables']['order_notes']['Row'],
  'id' | 'note_type' | 'body' | 'channel' | 'occurred_at' | 'author' | 'corrects_note_id' | 'created_at'
>;

/** 備註時間軸 + U6 判定(mapper 產物;三者一起回,避免呼叫端各自重算集合)。 */
export type AdminOrderNotesProjection = {
  notes: AdminOrderNote[];
  /** `null` = 無法判定(時間軸被截斷);見 domain `AdminOrderDetail.customerNotified` */
  customerNotified: boolean | null;
  notesTruncated: boolean;
};

/**
 * 全序比較:`created_at` 由舊到新;同時間依序以「時間字面」→「id」tie-break。
 *
 * 🔴 三層都有各自的理由,少一層就有真的排錯:
 * ① `Date.parse` 而非字串比較 —— timestamptz 字面帶時區偏移,字典序在跨偏移時排錯。
 * ② 同毫秒再比字面 —— **`Date.parse` 只解析到毫秒,而 `created_at` 是微秒精度**(實測
 *    `.123456` 與 `.123999` 解析結果相同)⇒ 少了這層,同毫秒的兩列會落到 id(uuid)亂序,
 *    更正列可能排在被更正列**前面**。
 *    ⚠️ **這層成立的前提 = 同一回應內所有列的時區偏移一致**(PostgREST 對同一次請求的同一張表
 *    回同一個偏移);偏移若混用,字典序會排錯 —— 實測反例 `18:00:00.123456+08:00` 與
 *    `10:00:00.123999+00:00` 同毫秒,字典序把後者排前面而它其實較晚。~~原本寫「同毫秒代表偏移相同」
 *    是錯的~~(審查 R2 nit2 抓到、已實跑證偽)。**毫秒層(①)不受此限**,錯的上限是次毫秒排序。
 * ③ 最後才 id —— 解析不出來的值(DB 腐壞)排在最後、彼此再以 id 定序。
 * **不回 NaN**,否則 `Array.sort` 的結果由實作決定 = 前面宣稱的「全序」不成立。
 */
function compareNotes(a: SupabaseOrderNoteRow, b: SupabaseOrderNoteRow): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  const aBad = Number.isNaN(ta);
  const bBad = Number.isNaN(tb);
  if (aBad !== bBad) return aBad ? 1 : -1;
  if (!aBad && ta !== tb) return ta - tb;
  if (!aBad && a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * `order_notes` 內嵌列 → 時間軸 + U6 告知義務。
 *
 * `corrected` / `customerNotified` 共用同一個 `correctedIds` 集合(= 建表檔 `:164-169` 的
 * `NOT EXISTS` 語意);**只看直接指向** ⇒ `A ← B ← C` 裡 A 仍算已更正(更正不可撤回,`:179-184`)。
 */
export function mapSupabaseOrderNoteRowsToProjection(
  rows: SupabaseOrderNoteRow[],
): AdminOrderNotesProjection {
  const correctedIds = new Set(
    rows.map((row) => row.corrects_note_id).filter((id): id is string => id !== null),
  );
  const notes = [...rows].sort(compareNotes).map(
    (row): AdminOrderNote => ({
      id: row.id,
      // 🔴 `as` 的依據 = DB CHECK 值域(`:87-88` 三值 / `:129-130` 五值),同 orderSource 慣例。
      //    ⚠️ 代價:CHECK 日後加第四個值時型別會說謊,而**沒有任何測試會轉紅** ——
      //    改那條 CHECK 的人必須同步改 domain union(建表檔 CHECK 是唯一權威)。
      noteType: row.note_type as AdminOrderNoteType,
      channel: row.channel as AdminOrderNoteChannel | null,
      body: row.body,
      occurredAt: row.occurred_at,
      author: row.author,
      correctsNoteId: row.corrects_note_id,
      createdAt: row.created_at,
      corrected: correctedIds.has(row.id),
    }),
  );
  const notesTruncated = rows.length >= ORDER_NOTES_EMBED_LIMIT;
  return {
    notes,
    // 🔴 截斷時回 null 而非 false:被截掉的更正列會讓已作廢的告知看起來仍有效,
    //    反過來被截掉的告知列會讓已履行看起來沒履行 ⇒ 兩個方向都可能錯 ⇒ 只能說「無法判定」。
    customerNotified: notesTruncated
      ? null
      : notes.some((note) => note.noteType === 'customer_notified' && !note.corrected),
    notesTruncated,
  };
}
