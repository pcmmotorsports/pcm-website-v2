/**
 * @module @pcm/adapters/supabase/mappers/created-at-order — 內嵌列的 `created_at` 全序比較
 *
 * 🔴 **為什麼需要這支**:PostgREST **不保證**內嵌列的順序。任何把內嵌列當時間軸顯示的讀模型
 * 都必須在 mapper 自己排。A9a-1(`order-notes.ts`)先寫了一份,A9a-2(`order-procurement.ts`)
 * 需要一模一樣的三層邏輯 —— 抄第二份 = 兩份會各自漂移,而漂移的症狀(次毫秒排錯)
 * 不會有任何測試轉紅。⇒ 抽成單一實作。
 */

/** 具備 `created_at` + `id` 的內嵌投影列(兩張表的投影都取這兩欄)。 */
export type CreatedAtOrderedRow = { id: string; created_at: string };

/**
 * 全序比較:`created_at` 由舊到新;同時間依序以「時間字面」→「id」tie-break。
 *
 * 🔴 三層都有各自的理由,少一層就有真的排錯:
 * ① `Date.parse` 而非字串比較 —— timestamptz 字面帶時區偏移,字典序在跨偏移時排錯。
 * ② 同毫秒再比字面 —— **`Date.parse` 只解析到毫秒,而 `created_at` 是微秒精度**(實測
 *    `.123456` 與 `.123999` 解析結果相同)⇒ 少了這層,同毫秒的兩列會落到 id(uuid)亂序,
 *    在備註時間軸上會讓更正列排在被更正列**前面**。
 *    ⚠️ **這層成立的前提 = 同一回應內所有列的時區偏移一致**(PostgREST 對同一次請求的同一張表
 *    回同一個偏移);偏移若混用,字典序會排錯 —— 實測反例 `18:00:00.123456+08:00` 與
 *    `10:00:00.123999+00:00` 同毫秒,字典序把後者排前面而它其實較晚。
 *    **毫秒層(①)不受此限**,錯的上限是次毫秒排序。
 * ③ 最後才 id —— 解析不出來的值(DB 腐壞)排在最後、彼此再以 id 定序。
 * **不回 NaN**,否則 `Array.sort` 的結果由實作決定 = 前面宣稱的「全序」不成立。
 */
export function compareByCreatedAtThenId(a: CreatedAtOrderedRow, b: CreatedAtOrderedRow): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  const aBad = Number.isNaN(ta);
  const bBad = Number.isNaN(tb);
  if (aBad !== bBad) return aBad ? 1 : -1;
  if (!aBad && ta !== tb) return ta - tb;
  if (!aBad && a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
