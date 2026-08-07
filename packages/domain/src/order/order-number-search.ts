/**
 * 訂單編號搜尋的正規化與形狀守門(M-4b E10 · A9b1)。
 *
 * 背景:E10 把訂單編號從 `PCM-YYYY-NNNN` 改成 6 碼亂碼(v2 §5.4a)。改號後客人手上、
 * 信件裡、對話紀錄裡的**舊號永遠不會消失**,所以舊號被寫進 `orders.legacy_display_id`
 * 當永久 alias,搜尋必須**同時比對兩欄**,否則客服拿舊號查不到單(v2 §5.1 A9b1)。
 *
 * 🔴 為什麼這裡要有形狀守門,而不是把使用者輸入直接丟給查詢:
 * adapter 端用 PostgREST 的 `.or()` 表達「兩欄任一命中」,而 `.or()` 收的是
 * **字串內插、不是參數化查詢** —— 值裡的 `,` 或 `)` 會改變 filter 結構。
 * 本模組是那個內插值的唯一來源,只放行 `[A-Z0-9-]` 形狀,注入面因此為零。
 * (同一套路先前也用在九碼篩選的 `WORKFLOW_STATUS_CODE_RE`;該 `.or` 段落已於 A9w3 移除。)
 *
 * 🔴 本模組必須**永久同時接受新舊兩種格式**,不隨 N2 的 domain 換格式而改 ——
 * N2 換的是「產生」新單號的格式,本模組管的是「查詢」既有單號,舊號永遠查得到。
 */

/**
 * 舊格式:`PCM-YYYY-NNNN`(年份 4 碼 + 流水號至少 4 碼)。
 * 與 D0 migration 的 `orders_legacy_display_id_format` CHECK 同一形狀。
 */
export const LEGACY_ORDER_NUMBER_RE = /^PCM-\d{4}-\d{4,}$/;

/**
 * 新格式:固定 6 碼、28 字元字母表(去 `0O1IL` 易混淆、去 `AEU` 母音;v2 §5.4a)。
 * 與 D0 migration 放寬後的 `orders_display_id_format` CHECK 新格式分支同一形狀。
 */
export const ORDER_NUMBER_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/;

/**
 * 搜尋詞正規化結果。
 *
 * 🔴 刻意分出 `invalid` 而不是統一回 `undefined`:兩者的正確行為相反 ——
 * 「沒有輸入」= 不篩選(列出全部);「輸入了但格式不符」= **必須回零筆**。
 * 混成同一個值會讓打錯字的搜尋靜默退化成「列出全部訂單」,那是 fail-open。
 */
export type OrderNumberSearch =
  | { kind: 'empty' }
  | { kind: 'invalid'; input: string }
  | { kind: 'ok'; value: string };

/**
 * 搜尋詞長度上限(trim 後)。
 *
 * 🔴 為什麼需要:舊格式的流水號是 `\d{4,}`(**無上界**,與 D0 CHECK 同形狀、刻意不收窄),
 * 而 adapter 端的 `.or()` 值是 append 進 GET query string 的。沒有上限時
 * `PCM-2026-<一萬位數字>` 會通過形狀守門、內插兩次 ⇒ URL 爆掉 ⇒ PostgREST 414/431 ⇒
 * adapter 裸 throw ⇒ **整個後台訂單列表進錯誤態**,而不是老實顯示「查無此單」。
 * 上限擋在 regex 之前 ⇒ 不動 regex 形狀、不與 D0 CHECK 產生不對稱。
 * (同款守門先例:`order-list-view.ts` 的 workflow_status 多勾選上限 64 值。)
 */
export const MAX_ORDER_NUMBER_SEARCH_LENGTH = 32;

/**
 * 正規化使用者輸入的訂單編號搜尋詞。
 *
 * - 去頭尾空白 + 轉大寫(客服常從信件貼上、手機鍵盤常給小寫;兩種格式本身都是大寫)
 * - 空字串 / 非字串 → `empty`(不篩選)
 * - 不符新舊任一格式 → `invalid`(呼叫端必須回零筆,不得當成不篩選)
 * - 符合 → `ok`,`value` 保證只含 `[A-Z0-9-]`,可安全內插進 PostgREST filter
 */
export function normalizeOrderNumberSearch(raw: string | null | undefined): OrderNumberSearch {
  if (typeof raw !== 'string') return { kind: 'empty' };
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'empty' };

  // 長度上限先於一切(理由見 MAX_ORDER_NUMBER_SEARCH_LENGTH)
  if (trimmed.length > MAX_ORDER_NUMBER_SEARCH_LENGTH) {
    // 🔴 **截到 MAX + 1、不是 MAX**(A9b2-A 階段 C 在 A9b2 那支抓到同形狀 bug,根因一致 ⇒ 一起修)。
    //    截到剛好 MAX 的話這個值自己會通過下一次正規化,而呼叫鏈真的會再跑一次
    //    (`order-list-view.ts` 把 `input` 放進 filter → adapter 重跑 `normalizeOrderNumberSearch`)
    //    ⇒ 「太長」的輸入會被靜默改寫成「前 32 字」去查,而使用者以為那就是他搜的東西。
    //    實測(修前):`'PCM-2026-' + '1'.repeat(40)` → invalid → 再正規化 → `kind:'ok'`。
    //    多留一個字 ⇒ 再正規化必然仍 invalid,長度依然有界。
    return { kind: 'invalid', input: trimmed.slice(0, MAX_ORDER_NUMBER_SEARCH_LENGTH + 1) };
  }

  // 🔴 非 ASCII 一律先擋,再 toUpperCase。
  //    理由:`toUpperCase()` 對某些字元會**膨脹**成合法 ASCII —— 'ß' → 'SS'、'ﬀ' → 'FF'。
  //    那不會製造注入(產物仍只含 [A-Z0-9-]),但會把搜尋詞靜默改寫成**另一張真實訂單的單號**,
  //    客服因此看到別人的訂單。兩種格式本來就只含 ASCII,擋掉零損失。
  //    用 \u 逃脫寫可列印 ASCII 範圍(0x20 空白 ~ 0x7E 波浪號),避免在字面量裡放控制字元。
  if (/[^\u0020-\u007E]/.test(trimmed)) return { kind: 'invalid', input: trimmed };

  const value = trimmed.toUpperCase();
  if (LEGACY_ORDER_NUMBER_RE.test(value) || ORDER_NUMBER_RE.test(value)) {
    return { kind: 'ok', value };
  }
  return { kind: 'invalid', input: value };
}
