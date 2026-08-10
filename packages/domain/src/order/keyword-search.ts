/**
 * 後台訂單「關鍵字」搜尋的正規化與形狀守門(M-4b #347-2a)。
 *
 * 背景:#347-1 建了 `public.admin_search_orders` —— 一支八維度子字串搜尋
 * (訂單編號 / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 品牌 / 供應商單號),
 * 回 `{"ids": uuid[], "truncated": bool}`。本模組是**送進那支 RPC 的搜尋詞的唯一來源**。
 * 合約全文在 `supabase/migrations/20260810120000_m4b_347_3a_admin_search_orders_date_range.sql` 檔頭
 * (apply 之後真正的權威是 catalog 上的 `COMMENT ON FUNCTION`)。
 * ⚠️ **不要再指向 `20260809180000`**(#347-3c-3 更正):那支建的**兩參數版已被 3a `DROP`**,
 *    指過去等於把讀者送到一個不存在的簽章上。
 *
 * ── 🔴🔴 與另外兩個搜尋維度最重要的差異:**本模組沒有字元集守門** ──────────
 * A9b1 的 `normalizeOrderNumberSearch` 只放行 `[A-Z0-9-]`、
 * A9b2 的 `normalizeSupplierOrderNoSearch` 擋掉 `,` `(` `)` `"` `\` ——
 * 兩者的理由**完全相同且只有一個**:那兩個值會被**內插進 PostgREST 的 GET query string**
 * (`.or()` 是字串內插、`.eq()` 對保留字元不加引號)⇒ 值裡的字元會改變 filter 的結構。
 *
 * 本維度走 `.rpc()` = **POST + JSON body**
 * (`@supabase/postgrest-js@2.105.3/src/PostgrestClient.ts:425-427` 的 else 分支:`method='POST'; body=args`)
 * ⇒ 搜尋詞不進 URL、不進 filter 語法、不參與任何字串拼接。
 * ⇒ **中文、`%`、`_`、`,`、`(`、空白全都是合法搜尋詞**。RPC 端用 `strpos()` 而不是 `ILIKE`
 * (理由見 migration `:76-86`、實作 `:208-250`),所以 `%` 與 `_` 也**沒有**萬用字元語意。
 *
 * 🔴 **照抄另外兩支的字元集守門 = 把功能廢掉一半** —— 員工要搜的正是客人姓名(中文)、
 * 品名(含各種標點)。下一個人維護本檔時請先讀完這一段再決定要不要「補強」。
 *
 * ── 這裡真正要守的四件事 ──────────────────────────────────────────────
 * 全部只有兩種來源:**鏡射 RPC 的行為**(讓兩邊定義域重合),或**擋住會讓呼叫端自己爆掉的輸入**。
 * 逐條理由寫在 {@link normalizeOrderKeywordSearch} 的實作旁。
 */

/**
 * RPC 回傳形狀與程式的假設不符時擲出(#347-2a)。
 *
 * 🔴 **為什麼是擲、不是把壞掉的部分濾掉**(照抄 `supplier-order-no-search.ts:74` 的既有判準):
 * 濾掉 = 悄悄回零筆 = 員工看到「查無此單」,而**測試會全綠**(mock 餵的一定是符合假設的形狀)。
 * 這支 RPC 的回傳是 `jsonb`,PostgREST 原封轉成 JSON ⇒ 型別系統一個字都保證不了,
 * 唯一的防線就是執行期把它**當外部輸入驗**。fail-closed 且**吵**。
 *
 * 🔴 `detail` 刻意只放**非 PII 的結構描述**(哪一項不合、拿到什麼型別)——
 * 本錯誤會進 server log,而搜尋詞是 PII(migration `:50-74` 明令不得落 log)。
 * ⇒ **不得**把 `p_query` 或由它衍生的值(長度、前綴)放進訊息。
 */
export class OrderKeywordSearchShapeError extends Error {
  readonly code = 'order_keyword_search_bad_shape' as const;
  constructor(readonly detail: string) {
    super(`訂單關鍵字搜尋:RPC 回傳形狀與假設不符(${detail})`);
    this.name = 'OrderKeywordSearchShapeError';
  }
}

/**
 * 搜尋詞正規化失敗的原因。
 *
 * - `too_long` — 超過 {@link MAX_ORDER_KEYWORD_LENGTH};UI 要說「搜尋詞太長」。
 * - `bad_char` — 含 PG / JSON 層根本收不下的字元(NUL、落單代理);UI 要說「含有無法處理的字元」。
 *
 * 🔴 **存在的唯一目的是讓 UI(2b)渲染不同訊息** —— 同 A9b2 的既有判準:
 * adapter 對兩種 reason 一視同仁(都回零筆),分辨是**顯示層**的事,不是查詢層的事。
 */
export type OrderKeywordSearchInvalidReason = 'too_long' | 'bad_char';

/**
 * 搜尋詞正規化結果。
 *
 * 🔴 `empty` 與 `invalid` **刻意分開**(照抄 A9b1/A9b2 的理由):兩者的正確行為相反 ——
 * 「沒有輸入」= 不篩選(列出全部);「輸入了但不合法」= **必須回零筆**。
 * 混成同一個值會讓不合法的搜尋靜默退化成「列出全部訂單」,那是 fail-open。
 */
export type OrderKeywordSearch =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: OrderKeywordSearchInvalidReason; input: string }
  | { kind: 'ok'; value: string };

/**
 * 搜尋詞長度上限,單位 = **Unicode code point**(不是 UTF-16 code unit,見下)。
 *
 * 🔴 **120 不是自己挑的,是鏡射 RPC 的長度閘**(migration `:189` 的 `length(v_needle) > 120`)——
 * 那一側對超長輸入是**靜默回空清單**;在這裡轉成 `invalid` 才能讓 2b 明示「搜尋詞太長」,
 * 而不是讓員工看到「查無此單」(Sean 2026-08-07 Q1=A:不默默降級)。
 */
export const MAX_ORDER_KEYWORD_LENGTH = 120;

/**
 * RPC 端 `btrim()` 的修剪字元集,**逐字對齊** migration `:179`
 * (半形空格 / tab / CR / LF / 全形空白 U+3000 / 不斷行空格 U+00A0 / 窄不斷行空格 U+202F /
 *  零寬空格 U+200B / BOM U+FEFF,共 9 顆 —— 與 migration 那一行逐顆對得起來)。
 *
 * 🔴 **不能只用 `String.prototype.trim()`**:JS 的 trim 清得掉 U+3000 / U+00A0 / U+202F / U+FEFF,
 * 但**清不掉 U+200B 零寬空格**(它不在 JS 的 WhiteSpace 定義裡)。
 * 少了這一顆,「貼上一顆零寬空格」在前端算**有輸入**、在 RPC 算**空**
 * ⇒ RPC 回空清單 ⇒ 畫面顯示「查無此單」,而正確答案是「沒有搜尋 = 列出全部」。
 * 兩邊的定義域必須重合,所以這裡顯式列出同一組字元、不依賴任一語言的預設。
 *
 * 🔴 **一律用 `\u` 逃脫寫、不在字面量裡放真的看不見的字元**(本 repo 既有慣例,
 * `order-number-search.ts:82` 逐字寫下同一條)。這一組**整組都是隱形字元** ——
 * 放真值進去,diff、審查、終端機裡全部看不到,下一個人無法核對它到底列了哪幾顆。
 */
const TRIM_CHARS = '\\u0020\\u0009\\u000d\\u000a\\u3000\\u00a0\\u202f\\u200b\\ufeff';
const TRIM_CHARS_RE = new RegExp(`^[${TRIM_CHARS}]+|[${TRIM_CHARS}]+$`, 'gu');

/**
 * PG 的 `text` **不能存 NUL**(U+0000),送進去是 22021;
 * **落單代理字元**(不成對的 U+D800-U+DFFF)則會在 PG 解 JSON 時被拒
 * (`unsupported Unicode escape sequence`)——
 * ⚠️ 注意失敗點的精確位置:`JSON.stringify` 會把它逃脫成合法 ASCII 的 `"\ud800"`、**fetch 送得出去**,
 * 炸的是資料庫那一端。兩者的後果都是**整個訂單列表進錯誤態**,而不是老實顯示「查無此單」。
 * ⇒ 擋在這裡,讓它變成一句使用者看得懂的話。
 *
 * 🔴🔴 **`u` 旗標是這條規則的全部行為,不是排版**(突變實測發現):
 * 有 `u` 時,regex 以 **code point** 比對 ⇒ 一顆成對的 emoji 是 U+1F605、**不在** D800-DFFF 區間
 * ⇒ `[\ud800-\udfff]` 只咬得到**落單**的代理,正是我們要的。
 * 沒有 `u` 時,它以 UTF-16 code unit 比對 ⇒ **每一顆 emoji 都會被誤殺**(它的兩半都落在區間內)。
 * ⚠️ 第一版寫成 `[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]`
 *    的前後看守 —— 在 `u` 之下那是**多餘的**(突變成簡單區間後 31 格全綠 = 兩者行為相同)。
 *    留著只會讓人以為那個複雜度在擋什麼東西。⇒ 簡化,並把判別力交給「拿掉 `u`」那個突變。
 */
// ⚠️ 這裡**不需要** `eslint-disable no-control-regex`：寫成 `\\u0000` 逃脫之後，eslint 不再視為
//    「原始碼裡的控制字元」。第一版留著那行 disable ⇒ lint 反過來報「Unused eslint-disable directive」。
//    ⇒ 不留沒有作用的抑制註解：它會讓下一個人以為這條 regex 有個需要被壓下去的問題。
const BAD_CHAR_RE = /[\u0000]|[\ud800-\udfff]/u;

/**
 * 正規化使用者輸入的訂單關鍵字搜尋詞。
 *
 * - 非字串 → `empty`(不篩選)
 * - 修剪 {@link TRIM_CHARS_RE} 那組字元後為空 → `empty`(不篩選)
 * - 含 NUL 或落單代理 → `invalid('bad_char')`
 * - code point 數超過 {@link MAX_ORDER_KEYWORD_LENGTH} → `invalid('too_long')`
 * - 其餘 → `ok`(值原樣送進 RPC 的 `p_query`;**不轉大小寫** —— RPC 自己 `lower()`,
 *   在這裡先折一次只會製造第二個真相源,且 JS 與 PG 的折法不保證等價)
 *
 * ── 🔴 長度必須數 code point、不能用 `String.length` ──────────────────
 * PG 的 `length()` 數**字元**,JS 的 `.length` 數 **UTF-16 code unit**
 * ⇒ 61 顆 emoji 在 JS 是 122、在 PG 是 61。用 `.length` 會把合法輸入誤判成太長
 * (關卡1 R1-M3 抓到)。`Array.from()` 依 code point 切,兩邊才對得起來。
 *
 * ── ⚠️ 殘餘不重合(誠實邊界,無法消除,不要假裝對齊)──────────────────
 * RPC 量的是 `length(lower(btrim(x)))`,這裡量的是 `length(btrim(x))` —— **中間差一個 `lower()`**。
 * 極少數字元的大小寫折疊會改變長度(`'İ'.toLowerCase()` 是 2 個 code point)
 * ⇒ 存在「這裡判 ok、PG 判太長」的縫。**那個縫的後果是回零筆,不是回錯的資料**
 * (RPC 的超長分支回空清單)⇒ **fail-closed、可接受**。
 * 要完全對齊得在 JS 裡重實作 PG 的 collation 折疊,那是拿一個真問題換一個更大的。
 */
export function normalizeOrderKeywordSearch(raw: string | null | undefined): OrderKeywordSearch {
  if (typeof raw !== 'string') return { kind: 'empty' };
  const trimmed = raw.replace(TRIM_CHARS_RE, '');
  if (trimmed === '') return { kind: 'empty' };

  // 🔴 壞字元擋在長度之前:超長**又**含 NUL 的輸入,回 `bad_char` 比回 `too_long` 有用
  //    (使用者砍短之後還是會失敗,訊息會變成在騙他)。
  if (BAD_CHAR_RE.test(trimmed)) {
    return { kind: 'invalid', reason: 'bad_char', input: truncateForEcho(trimmed) };
  }

  if (Array.from(trimmed).length > MAX_ORDER_KEYWORD_LENGTH) {
    return { kind: 'invalid', reason: 'too_long', input: truncateForEcho(trimmed) };
  }

  return { kind: 'ok', value: trimmed };
}

/**
 * `invalid` 回傳的 `input` 截斷。
 *
 * 🔴 **截到 MAX + 1、不是 MAX**(A9b1 `:69-75` / A9b2 `:157-163` 同一個坑,根因一致):
 * 截到剛好 MAX 的話,這個值**自己會通過下一次正規化** —— 而呼叫鏈真的會再跑一次
 * (2b 把 `input` 放回 filter → adapter 收到後重跑本函式)
 * ⇒ 橫幅說「太長」、列表卻老實顯示「前 120 字」的**真實命中**,
 * 而使用者以為那就是他搜的東西。多留一個 code point ⇒ 再正規化必然仍是 `too_long`,長度依然有界。
 *
 * ⚠️ 用 `Array.from().slice()` 而不是 `String.slice()`:後者會**切在代理對中間**、
 * 產生落單代理 —— 那正是上面 `bad_char` 要擋的東西,等於自己製造一顆毒值再送回去。
 */
function truncateForEcho(value: string): string {
  return Array.from(value).slice(0, MAX_ORDER_KEYWORD_LENGTH + 1).join('');
}
