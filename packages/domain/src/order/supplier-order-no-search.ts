/**
 * 供應商單號搜尋的正規化與形狀守門(M-4b E10 · A9b2-A)。
 *
 * 背景:到貨登錄時員工手上只有供應商給的單號,要靠它跨單找到是哪幾張訂單
 * (UX §2 #7)。搜尋語意由 A2 migration `20260729020000:150-155` 釘死 =
 * **對 upper(trim(輸入)) 做等值比對**;DB 側的鍵是 A9b2-M 建的 STORED 產生欄
 * `order_item_procurement.supplier_order_no_upper`(`20260807130000`)。
 *
 * 🔴 **本模組是那個比對值的唯一來源。** 與 A9b1 的 `normalizeOrderNumberSearch` 分立
 * (兩者的合法形狀完全不同,合成一支會讓其中一邊的守門變成裝飾)。
 *
 * ── 🔴 為什麼這裡的安全論證與 A9b1 不同 ────────────────────────────
 * A9b1 靠「只放行 `[A-Z0-9-]`」把注入面壓成零(`order-number-search.ts:8-12`)。
 * **那套在這裡不成立**:供應商單號**沒有格式**可言 —— A2 的 CHECK(`:95-102`)只擋前後
 * 空白與四個零寬字元,**不限字元集**,所以 `PO/2026/0042`、`#4471`、`ABC_12345` 都是合法值。
 *
 * 改押在呼叫端的序列化行為上,而那是**實查 supabase-js 原始碼**得到的
 * (`@supabase/postgrest-js@2.105.3/src/PostgrestFilterBuilder.ts`):
 *   · `:36`  `PostgrestReservedCharsRegexp = /[,()]/`
 *   · `:172` **`.eq()` 直接 `eq.${value}` —— 不對保留字元加引號**
 *   · `:815` `.in()` 才會對命中保留字元的值加雙引號
 * ⇒ `.eq()` 收到含 `,` `(` `)` 的值時,PostgREST 端的解析是**歧義**的。
 *
 * 🔴 **修法刻意不是「自己補雙引號」** —— 那要押在「PostgREST 雙引號值裡用 `\` 逃脫」這個
 * 本專案**無法實測**的行為上(本機拋棄式叢集是裸 PG、沒有 PostgREST),而「不押沒驗過的
 * PostgREST 行為」正是這條線選兩段式查詢而非內嵌 filter 的理由(片級 plan §1)。
 * ⇒ 改成**在這裡擋掉**,回具名 reason 讓 UI 明示。
 *
 * ⚠️ **知情取捨(誠實邊界)**:含 `,` `(` `)` `"` `\` 的供應商單號**搜不到**,
 * 使用者會看到「這個單號含特殊字元、請改用其他方式查」而不是靜默零筆。
 * 日後若有人能在**真 PostgREST** 上實測引號逃脫,這條可放寬 —— 屬 backlog、不在本片。
 *
 * ── 🔴🔴 誠實邊界:**這個搜尋沒有供應商 filter 軸**(#338 起:結果集層看得到是哪幾家)──
 * `supplier_order_no` 在 DB 層**沒有任何跨供應商的唯一性**:A2 的業務唯一鍵是
 * `(order_item_id, supplier_canonical_key)`(`20260729020000:70`),A9b2-M 的索引也只有單號本身。
 * ⇒ **兩家供應商各自用了同一組單號時,搜尋會把兩家的訂單一起回來**,而畫面上分不出來。
 * 失敗情境:員工照搜尋結果把 A 供應商的貨,登記到其實屬於 B 供應商的那張訂單上。
 * 🔴 **#338 已於 2026-08-11 交付結果集層的消歧**(本段隨之更新 —— 這個 docstring 自述
 * 「plan 會過期、而它就在呼叫端手邊」,那就得自己不過期):adapter 在**同一次探測往返**裡
 * 多取 `supplier_id, suppliers(label)`,畫面分三態 —— 一家具名 / 多家示警並列名 /
 * **認不出來就退回警語、不假裝知道**(語意在 admin `lib/orders/supplier-match-notice.ts`)。
 * ⇒ 消歧發生在**結果集層**(告訴你這批命中屬於哪幾家),**不是逐列**。
 * 🔴 **仍然沒有的**:`AdminOrderFilter` 沒有供應商軸(主視窗 2026-08-11 裁定**不做**——
 * 員工正是因為不知道是哪一家才來搜,先選一家的下拉在會出事的那一刻幫不上忙)。
 * ⇒ 兩家共用單號時結果**照樣會一起列出**,只是現在畫面會明說「有 N 家」。
 */

/**
 * 供應商單號命中的訂單數超過 adapter 上限時擲出。
 *
 * 🔴 **為什麼是「擲出」而不是「截斷後回前 N 筆」**:截斷的話使用者看到 N 筆就以為只有 N 筆,
 * 與「靜默回零筆」是同一種病 —— 而 Sean 2026-08-07 Q1=A 才剛就同一個形狀拍板「要明示、不默默降級」。
 * 🔴 **為什麼不塞進 `Paginated<T>`**:那會為了一個極少發生的分支去加寬所有消費端都看得到的共用型別。
 * 🔴 **為什麼不併進 `OrderError`**:那一族的 code 全是「建構/驗證 Order entity」的失敗
 * (`errors.ts:14-27`),塞一個查詢結果狀態進去是分類錯置。
 *
 * 消費端(A10c2)`catch` 到本錯誤 ⇒ 顯示「符合的訂單太多,請縮小範圍」之類的明示訊息;
 * 其餘錯誤照舊走一般錯誤態。
 */
export class SupplierOrderNoSearchTooManyError extends Error {
  readonly code = 'supplier_order_no_search_too_many' as const;
  constructor(readonly cap: number) {
    super(`供應商單號命中的訂單數超過上限 ${cap} 筆`);
    this.name = 'SupplierOrderNoSearchTooManyError';
  }
}

/**
 * 第一段查詢回來的列**萃不出訂單 id** 時擲出。
 *
 * 🔴 **為什麼是擲、不是把那列濾掉**(Fable 對抗審查 F1):DB 的約束保證這件事**不可能發生** ——
 * `order_item_procurement.order_item_id` NOT NULL(`20260729020000:43`)、
 * `order_items.order_id` NOT NULL(`20260604120000:142`)、且查詢用 `!inner`。
 * ⇒ 萃不出來只有一個解釋:**回傳形狀與程式的假設不符**(例如 embed 回的是陣列而不是物件、
 * 或型別重生後有人動了 cast)。那時把該列濾掉 = 悄悄回零筆 =「查無此單」,
 * 員工會以為真的沒有這張單 —— 正是 Q1=A「不默默降級」要禁的形狀,而且**測試會全綠**
 * (mock 餵的是符合假設的形狀)。⇒ fail-closed 且**吵**。
 */
export class SupplierOrderNoSearchShapeError extends Error {
  readonly code = 'supplier_order_no_search_bad_shape' as const;
  constructor(readonly rowCount: number) {
    super(
      `供應商單號搜尋:第一段回傳 ${rowCount} 列但萃不出訂單 id —— 回傳形狀與假設不符(FK 保證這不該發生)`,
    );
    this.name = 'SupplierOrderNoSearchShapeError';
  }
}

/**
 * 搜尋詞長度上限(trim 後)。
 *
 * 🔴 這是**搜尋端**的守門、不是欄的鏡像 —— A2 對 `supplier_order_no` **沒有**長度上限。
 * 需要它的理由同 A9b1 `MAX_ORDER_NUMBER_SEARCH_LENGTH`:值會被 append 進 GET query string,
 * 沒有上限時超長輸入會讓 URL 爆掉 ⇒ PostgREST 414/431 ⇒ adapter 裸 throw ⇒
 * **整個後台訂單列表進錯誤態**,而不是老實顯示「查無此單」。
 */
export const MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH = 32;

/**
 * PostgREST 的 `.eq()` 不會替這些字元加引號(見檔頭實查),因此一律擋在正規化層。
 *
 * `,` `(` `)` = PostgREST 保留字元;`"` `\` = 若日後改走「自己加引號」那條路時的逃脫字元,
 * 現在一併擋掉,讓「本模組的產物永遠不需要引號」這個不變量成立、不隨修法漂移。
 */
const RESERVED_CHARS_RE = /[,()"\\]/;

/**
 * 非 ASCII 偵測:可列印 ASCII 範圍以外一律視為非法(0x20 空白 ~ 0x7E 波浪號)。
 * 用 `\u` 逃脫寫,避免在字面量裡放控制字元。
 */
const NON_ASCII_RE = /[^\u0020-\u007E]/;

/**
 * 搜尋詞正規化失敗的原因。
 *
 * 🔴 **存在的唯一目的是讓 UI(A10c2)渲染不同訊息** —— Sean 2026-08-07 Q1=A:
 * 非 ASCII 搜尋詞要**明示**「此單號含特殊字元,請改用其他方式查」,**不默默回零筆**。
 * 🔴 **adapter 對三種 reason 一視同仁**(都回零筆);分辨是顯示層的事,不是查詢層的事。
 */
export type SupplierOrderNoSearchInvalidReason = 'non_ascii' | 'reserved_char' | 'too_long';

/**
 * 搜尋詞正規化結果。
 *
 * 🔴 `empty` 與 `invalid` **刻意分開**(照抄 A9b1 的理由):兩者的正確行為相反 ——
 * 「沒有輸入」= 不篩選(列出全部);「輸入了但不合法」= **必須回零筆**。
 * 混成同一個值會讓打錯字的搜尋靜默退化成「列出全部訂單」,那是 fail-open。
 */
export type SupplierOrderNoSearch =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: SupplierOrderNoSearchInvalidReason; input: string }
  | { kind: 'ok'; value: string };

/**
 * 正規化使用者輸入的供應商單號搜尋詞。
 *
 * - 去頭尾空白;空字串 / 非字串 → `empty`(不篩選)
 * - 超過 {@link MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH} → `invalid('too_long')`
 * - 含非可列印 ASCII → `invalid('non_ascii')`
 * - 含 `,` `(` `)` `"` `\` → `invalid('reserved_char')`
 * - 其餘 → `ok`,`value` = **大寫形**,可安全交給 `.eq()` 比對 `supplier_order_no_upper`
 *
 * 🔴 **順序是規格的一部分**:非 ASCII 必須擋在 `toUpperCase()` **之前**。
 * `'ß'.toUpperCase()` = `'SS'`、`'ﬁ'` → `'FI'` —— 大寫化會讓輸入**膨脹**成另一個合法字串,
 * 把搜尋詞靜默改寫成**另一張真實訂單的單號**(A9b1 `order-number-search.ts:72-77` 同一個坑)。
 * 🔴 這同時是 A9b2-M 那支 migration 在 COLUMN COMMENT 裡交辦給本片的硬前置:
 * 欄的大寫化是 **PG `upper()`**、這裡是 **JS `toUpperCase()`**,兩者不保證等價
 * (PG 隨 collation provider 而異),先擋非 ASCII 才讓兩邊的定義域重合。
 */
export function normalizeSupplierOrderNoSearch(
  raw: string | null | undefined,
): SupplierOrderNoSearch {
  if (typeof raw !== 'string') return { kind: 'empty' };
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'empty' };

  // 長度上限先於一切(理由見 MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH)
  if (trimmed.length > MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH) {
    return {
      kind: 'invalid',
      reason: 'too_long',
      // 🔴 **截到 MAX + 1、不是 MAX**(階段 C must-fix 1)。
      //    截到剛好 MAX 的話,這個值**自己會通過下一次正規化** —— 而呼叫鏈真的會再正規化一次
      //    (parse 層把 `input` 放進 filter、adapter 收到後重跑 `normalizeSupplierOrderNoSearch`)
      //    ⇒ 橫幅說「太長」、列表卻老老實實顯示「前 32 字」的**真實命中**,
      //    翻頁後 URL 只剩截斷值、警告消失,只留一份看起來完全正常但不是使用者搜的結果。
      //    多留一個字 ⇒ 再正規化必然仍是 `too_long`,長度依然有界(不會把上萬字帶進 URL)。
      input: trimmed.slice(0, MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH + 1),
    };
  }

  // 🔴 非 ASCII 擋在 toUpperCase() 之前(理由見上方 docstring)
  if (NON_ASCII_RE.test(trimmed)) return { kind: 'invalid', reason: 'non_ascii', input: trimmed };

  // 🔴 PostgREST 保留字元:`.eq()` 不加引號 ⇒ 讓它進去會產生歧義的 filter
  if (RESERVED_CHARS_RE.test(trimmed)) {
    return { kind: 'invalid', reason: 'reserved_char', input: trimmed };
  }

  return { kind: 'ok', value: trimmed.toUpperCase() };
}
