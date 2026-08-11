import type { AdminOrderNote, AdminOrderNoteChannel, AdminOrderNoteType } from '@pcm/domain';
import type { Database } from '../database.types';
import { compareByCreatedAtThenId } from './created-at-order';

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
 * `createdAt` ASC + 全序 tie-break(實作 = `created-at-order.ts` 的 `compareByCreatedAtThenId`,A9a-2 起共用)。
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
  /**
   * `null` = **無法判定**;見 domain `AdminOrderDetail.customerNotified`。
   * 🔴 `null` 有**兩個成因**,靠 `notesTruncated` 分辨(#328):
   *   ①`notesTruncated === true` → 時間軸被截斷,更早的紀錄沒載入;
   *   ②`notesTruncated === false` → **整段 notes 根本沒讀到**(投影退版/缺鍵)= 讀取失敗。
   *   兩者對員工的處置不同(①看更早紀錄 ②重新整理 / 通知維護)⇒ 文案**不可**共用一句。
   */
  customerNotified: boolean | null;
  notesTruncated: boolean;
};

/**
 * 全序比較 —— 🔴 **實作已於 A9a-2 抽到 `created-at-order.ts`**:A9a-2 的採購時間軸需要
 * 一模一樣的三層邏輯,而抄第二份會各自漂移、且漂移的症狀(次毫秒排錯)不會有任何測試轉紅。
 * 三層的理由、以及「同毫秒比字面」那層的前提(同一回應偏移一致)全部搬到該檔 docstring;
 * 行為一字未改(本檔既有排序測試即回歸證據)。
 */
const compareNotes = compareByCreatedAtThenId;

/**
 * `order_notes` 內嵌列 → 時間軸 + U6 告知義務。
 *
 * `corrected` / `customerNotified` 共用同一個 `correctedIds` 集合(= 建表檔 `:164-169` 的
 * `NOT EXISTS` 語意);**只看直接指向** ⇒ `A ← B ← C` 裡 A 仍算已更正(更正不可撤回,`:179-184`)。
 */
export function mapSupabaseOrderNoteRowsToProjection(
  rows: SupabaseOrderNoteRow[] | null | undefined,
): AdminOrderNotesProjection {
  // 🔴🔴 #328:**缺鍵(投影退版)/ null = 沒讀到,不是「真的零筆」**。
  //    舊寫法在呼叫端補 `?? []`,「沒讀到」就被翻成「讀到了、零筆」⇒ `customerNotified: false`
  //    ⇒ 畫面斬釘截鐵說「尚未告知客人」,而事實是我們**根本沒看到那些列** ——
  //    U6 告知義務(該補告知的不會補)會建立在假資料上,而且沒有任何測試或錯誤會轉紅。
  //    ⇒ 改 fail-closed 回「無法判定」。方向與呼叫端 `cancellations`(缺鍵→null)一致。
  // 🔴 **不新增欄位**,因為這三個欄位合起來已經是「讀取失敗」的唯一簽章:
  //    `customerNotified === null` 且 `notesTruncated === false`
  //    (被截斷那條路 `notesTruncated` 必為 true)⇒ 呼叫端分辨得出兩種 null。
  //    判別式**具名一次**在 `apps/admin/src/lib/orders/note-timeline.ts` 的 `isNotesUnreadable`,
  //    不要在各處重寫這個比較式(重寫第二份就會漂)。
  if (rows === null || rows === undefined) {
    return { notes: [], customerNotified: null, notesTruncated: false };
  }
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
