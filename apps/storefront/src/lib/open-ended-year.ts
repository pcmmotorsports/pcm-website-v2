// open-ended-year.ts — 「開放式年份」(供應商寫 "2018 onwards")在顧客站的單一判準 + 單一文案。
//
// 背景(Sean 2026-09-17 拍):供應商把「2018 年起、到現在都還適用」寫成 year_str = "2018-",
// 結束年留空。DB 那側 `product_groups_v.f_year_end` 遇到這個形狀回 NULL,篩選就不設上限
// (baseline_schema.sql:1342 `group_year_end IS NULL OR group_year_end >= p_year`)。
//   - 甲(資料面)**維持現況**:開放年跟著供應商走,不自己補結束年、不寫死當年。
//   - 乙(顧客站)**只改文案**:把「2018+」這種看起來像我們掛保證的寫法,改成轉述供應商的說法。
// 🔴 本檔只做乙。**篩選邏輯一個字都不動。**
//
// 🔴 判準只有一條:`yearEnd === null` 而 `yearStart` 有值。
//    **不要回頭去解析 `year_str` 字串自己判一次** —— DB 那側已經解好了,再解一次就是第二份判準,會漂。
//
// 為什麼要有這顆(而不是三處各寫一份):開放年在顧客站有三個出口 ——
//   ① PDP 適用車款表年式 chip(ProductFitments) ② 目錄卡片「適用 …」(product-card-fits)
//   ③ PDP §7「是否適用我的車」(ProductFitmentCheck)
// 三處要說同一句話;文案分三份寫 = 改一處忘兩處。

/** 開放式年份:供應商只寫了起始年、沒寫結束年(`yearEnd === null`)。 */
export function isOpenEndedYear(f: { yearStart?: number; yearEnd?: number | null }): boolean {
  return f.yearStart != null && f.yearEnd === null;
}

/** 開放年的年份字面 —— 轉述供應商的說法,不是我們掛保證(取代原本的「2018+」)。 */
export function openEndedYearLabel(yearStart: number): string {
  return `${yearStart} 年起`;
}

/** 開放年的責任邊界一句話(全形標點,對齊商品頁散文家族;Sean 2026-06-10 Q2=B)。 */
export const OPEN_ENDED_YEAR_NOTE =
  '標示「年起」的車款，供應商只寫了起始年、沒有寫到哪一年為止；新年式改款是否仍相容，請以實車確認。';
