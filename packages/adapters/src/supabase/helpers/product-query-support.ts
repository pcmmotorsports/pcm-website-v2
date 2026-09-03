/**
 * SupabaseProductAdapter 共用查詢基元(鐵則 6 自 adapter 抽出、行為 byte 等價)。
 *
 * 內容:PostgREST `.single()` not-found 統一處理(findSingle)+ searchByKeyword 的
 * ILIKE filter 組裝(SEARCHABLE_COLUMNS / buildIlikeOrFilter)。
 * 跨 read method 共用、無狀態純函式 / 常數;client 由呼叫端注入。
 */

/** PostgREST not-found error code(`.single()` 找不到 row)。 */
export const PGRST_NOT_FOUND = 'PGRST116';

/**
 * `poolLimit` 入口驗證(fail-closed,對齊同 adapter `listAllProducts` 既有的 limit 驗證形狀)。
 *
 * 🔴 **為什麼 throw 而不是靜靜代入一個預設值**:這一族方法要解的病就是「靜默」——
 * 呼叫端傳了壞值卻拿到一個看起來正常的結果,正是本片在修的那個形狀的翻版。
 */
export function assertPositiveIntegerPoolLimit(
  method: string,
  poolLimit: number,
): void {
  if (!Number.isInteger(poolLimit) || poolLimit <= 0) {
    throw new Error(
      `SupabaseProductAdapter.${method}: poolLimit 須為正整數、收到 ${poolLimit}`,
    );
  }
}

/**
 * searchByKeyword 的 ILIKE 欄位(原三欄 + `external_id`;⟦搜尋-多詞與料號⟧ 2026-09-03)。
 *
 * 🔴 **`external_id` 就是客人在商品頁上看到的那個料號** —— 加它是因為 Sean 線上逐字回報
 *    「輸入料號會找不到東西, 我要找料號」(線上實測 `CARK9650` ⇒ 0 件,而那個碼就印在
 *    `/products/lightech-cark9650` 的主標上方「LIGHTECH · CARK9650」)。
 *    來源對應:`mappers/product.ts` 錨 `productCode: row.external_id`;
 *    畫面端 `apps/storefront/src/components/ProductTabs.tsx` 錨「顯真主碼 productCode」。
 *
 * 🔴🔴 **不要改成 `sku` —— 那一欄【不在被搜的那張 view 上】。**
 *    被搜的是 `products_public`(見 `SupabaseProductAdapter` 錨 `searchByKeyword`),
 *    而 `sku` 住在 `product_variants`、`variant_sku` 住在 `product_variants_public`
 *    ⇒ **兩者都要 join 才到得了**。2026-09-03 逐欄看過 `database.types.ts` 的
 *    `products_public` Row:20 欄裡沒有 `sku` 也沒有 `variant_sku`。
 *
 * 🛑 **加欄位只准加【那張 view 上已經有的欄】** —— `products_public` 物理上就沒有
 *    `price_store` / 經銷價那些欄,那是一道**實體隔離**而不是一個 WHERE
 *    (PCM Server 端鐵則:經銷價絕不傳到一般會員瀏覽器)。
 *    ⇒ **改成別的投影表 / materialized view = 把實體隔離換成條件式**,那要另案並過對抗審查。
 */
export const SEARCHABLE_COLUMNS = [
  'title',
  'subtitle',
  'description',
  'external_id',
] as const;

/**
 * 詞數上限:每多一個詞就多疊一組 `.or()` ⇒ URL 變長。
 *
 * 🔴 PostgREST 走 GET ⇒ URL 過長會 **HTTP 414 或被 proxy 砍**,
 *    而**那個失敗長得像「搜不到」** ⇒ 截斷要有上限,不能讓輸入決定 URL 長度。
 * ⚠️ **`8` 這個數字沒有量過**(plan §4 第 10 格自標未確認)——
 *    它是「比任何真實查詢都寬、又遠小於任何 URL 上限」的保守值,不是量出來的門檻。
 *    要動它:先實測 URL 長度上限,不要憑感覺調。
 */
export const MAX_SEARCH_TERMS = 8;

/**
 * 把使用者輸入切成「每個都要中」的詞(⟦搜尋-多詞與料號⟧ 2026-09-03)。
 *
 * 🔴 **為什麼要切** —— 不切的話整串被包成**一個連續**的 `%...%`,
 *    `%rpm rsv4%` 要求那八個字**照這個順序連在一起**出現在**同一欄**裡
 *    ⇒ 沒有商品長那樣 ⇒ 線上實測 `rpm rsv4` / `rsv4 油箱貼` **一律 0 件**。
 *
 * 🔴🔴 **順序是【先 sanitize 再切】,而它【不可以】倒過來**(codex 2026-09-03 對抗審查 MF2/MF4)。
 *    `normalizeSearchInput` 會把 `,` `(` `)` `.` `"` **換成空白** ⇒
 *    ```
 *    先切後 sanitize(錯):`AP.123` ⇒ 一個詞 ⇒ 之後變 `%AP 123%` ⇒ 仍要求同欄連續 ⇒ 找不到
 *    先 sanitize 後切(對):`AP.123` ⇒ `AP 123` ⇒ 切成 ['AP','123'] ⇒ AND ⇒ 命中
 *    ```
 *    ⚠️ **我第一版就是寫反的**,而 plan §7-a 那句「修病①會順手吃掉病③」**在寫反的版本下是假的**。
 *    ⇒ 📌 那句話的真假**取決於這兩行的順序**,而順序在 diff 上看不出語意 ⇒ 這段註解就是它的守門。
 *
 * 🔴 **分隔字元集顯式列舉** —— ⛔ ~~原註解寫「`\s` 在 JS 不含全形空格 `U+3000`」~~ **那句是錯的**
 *    (codex nit;我用 node 實測 `/\s/.test('\u3000')` ⇒ **true**)。
 *    ✅ 正確的理由是 **`\s` 不含 `U+200B`(零寬空格)與 `U+FEFF`**(實測 `/\s/.test('\u200B')` ⇒ **false**)
 *    ⇒ 所以仍然要顯式列舉,只是理由換一個。
 *
 * ⚠️ **中文不含空白時這裡回一個詞** —— `油箱貼` 切完仍是 `['油箱貼']`,
 *    與今天的行為相同(那一格今天是綠的,不得回歸)。**本函式不做中文斷詞。**
 *
 * 🛑 **回空陣列是一個【要呼叫端 fail-closed 的訊號】,不是「沒有條件」** ——
 *    輸入只有 `U+200B` 時 `trim()` **不會**把它清掉(實測:`'\u200B'.trim()` 仍是 `'\u200B'`)
 *    ⇒ 呼叫端的「空字串就短路」擋不住它 ⇒ 切完是零詞
 *    ⇒ **若呼叫端照樣送查詢, 那是一個【完全沒有條件】的查詢 = 整張 view 撈回來**(codex MF1)。
 */
const TERM_SEPARATORS = /[\s\u3000\u00A0\u202F\u200B\uFEFF]+/;

export function splitSearchTerms(q: string): string[] {
  const all = normalizeSearchInput(q)
    .split(TERM_SEPARATORS)
    .filter((t) => t !== '');
  if (all.length > MAX_SEARCH_TERMS) {
    // 🔴 **不靜默截斷**(codex MF3;形狀對齊同檔 `fetchAllPaginated` 的 MAX_PAGES 警告)。
    //    截掉的是 AND 的條件 ⇒ 結果會**變寬**不會變窄 ⇒ 客人看到的是「多出來的東西」,
    //    而**那長得像搜尋很爛,不像被截斷**。⚠️ 讓客人在畫面上看到這件事屬於片 B(要改回傳型別)。
    console.warn(
      `[searchByKeyword] 詞數 ${all.length} 超過上限 ${MAX_SEARCH_TERMS}、只用前 ${MAX_SEARCH_TERMS} 個詞;` +
        `結果會比使用者打的條件寬`,
    );
  }
  // 🔴 **取【前】N 個,不是後 N 個或任選** —— 使用者先打的詞通常是主詞(品牌/品名)。
  return all.slice(0, MAX_SEARCH_TERMS);
}

/**
 * 為 PostgREST `.or()` 跨欄 ILIKE filter 組裝 sanitized pattern + filter string。
 *
 * 兩階段 sanitize:
 * 1. 剝除 PostgREST `.or()` filter 語法保留字元(`,` `(` `)` `.` `"`)、避免 user
 *    輸入破壞 filter 解析(例 `Yamaha,price.gte.999` 會被當兩個 filter clause)。
 *    Phase 1 trade-off:這些字元在 ILIKE substring 失準、M-6 切 tsvector + textSearch
 *    時可用真 escape(對齊 backlog #110)。
 * 2. 轉義 ILIKE wildcards(`\` `%` `_`)、`\` 先(否則 `\%` 會被當已轉義)。
 *
 * regex / strip 字元集合為 Code 設計選擇、不歸 PRD 字面源(對齊 lessons §12-3 維度 A)。
 */
/**
 * 🔴🔴 **這支被拆成兩件事了(2026-09-03 code-reviewer must-fix)** ——
 *    原本它**同時**做兩件事:①把 PostgREST filter 的保留字元換成空白 ②轉義 ILIKE 萬用字元。
 *    而**②屬於【組 pattern】那一步,不屬於【切詞】那一步**。
 *
 * **不拆會怎樣(實測)**:切詞回的是**已經轉義過**的詞(`AP_123` ⇒ `AP\_123`),
 * 而那些詞被送進 RPC 之後,**SQL 那邊又轉義一次** ⇒ pattern 變成字面
 * 「`AP` + 反斜線 + `_` + `123`」⇒ 🛑 **含 `_` / `%` / `\` 的查詢在 RPC 那條路【恆 0 筆】,
 * 而舊路是對的** ⇒ 📌 **兩條路對同一個輸入給不同答案,而畫面上完全正常。**
 *
 * ⇒ ✅ 所以本支只做 ①(切詞要用的正規化);**萬用字元的轉義搬到 `buildIlikeOrFilter`。**
 */
export function normalizeSearchInput(q: string): string {
  return q.replace(/[,()."]/g, ' ');
}

/** ILIKE 萬用字元轉義。🔴 `\` 要先轉,否則 `\%` 會被當成已經轉義過的。 */
export function escapeIlikeWildcards(term: string): string {
  return term.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * 🔴 **`term` 是【切好詞、正規化過】的一個詞**;而**萬用字元的轉義由本函式自己做**
 *    (2026-09-03 code-reviewer must-fix 之後的分工:切詞不轉義、組 pattern 才轉義)。
 *
 * **為什麼改**:sanitize 現在住在 `splitSearchTerms`(它必須先跑,見該函式的順序說明)。
 * 若這裡再 sanitize 一次 ⇒ **雙重轉義**:`50%` 第一次變 `50\%`、第二次那個 `\` 又被轉義
 * 成 `50\\\%` ⇒ **搜尋 `50%` 從此找不到東西,而它不會報錯、只會回 0 件**。
 * (2026-09-03 我改順序時自己製造的,當場用 node 印出來才看見。)
 *
 * ⇒ **唯一的 sanitize 落點 = `splitSearchTerms`。** 要繞過切詞直接呼叫本函式的人,
 *   自己先呼叫 `normalizeSearchInput`(而萬用字元的轉義本支已經自己做了)。
 */
export function buildIlikeOrFilter(columns: readonly string[], term: string): string {
  // 🔴 轉義在**這裡**做(而不是在切詞那一步)—— 見 `normalizeSearchInput` 的說明。
  const pattern = `%${escapeIlikeWildcards(term)}%`;
  const clauses = columns.map((col) => `${col}.ilike.${pattern}`);
  // ⟦搜尋-料號正規化⟧ 2026-09-03:料號那一發**只加在 `external_id` 上**(理由見 `partNumberPattern`)。
  const pn = partNumberPattern(term);
  if (pn !== null && columns.includes(PART_NUMBER_COLUMN)) {
    clauses.push(`${PART_NUMBER_COLUMN}.ilike.${pn}`);
  }
  return clauses.join(',');
}

/**
 * 料號那一欄。🔴 **只有它吃 `partNumberPattern`** —— 見該函式「為什麼不是每一欄」。
 * (值與 `SEARCHABLE_COLUMNS` 裡那格是同一個字面;抽成常數是為了讓兩處一起改。)
 */
export const PART_NUMBER_COLUMN = 'external_id';

/**
 * 把「看起來像料號」的一個詞,變成一個**跨分隔號**的 ILIKE pattern
 * (⟦搜尋-料號正規化⟧ 2026-09-03)。
 *
 * 🔴🔴 **Sean 逐字,而他的語氣把這一格與旁邊那格分成兩級**:
 * ```
 * 料號 ⇒「但是打料號【一定要有】,而且要有- 無- 有空格無空格等等方式料號都要能帶出來建議的商品」
 * 膠囊 ⇒「盡量就好,字詞、詞彙我們慢慢追加」
 * ```
 * ⇒ 📌 **一個可以做不到,一個不行。不可以合成一句「搜尋要更聰明」。**
 *
 * 🔴 **而正確的機制是【正規化】不是【字典】**(主視窗 2026-09-03 判):
 *    字典解的是「俗稱 ⇒ 正式名」(`油箱貼` ⇒ `油箱止滑貼`)= **語意**;
 *    料號解的是「同一串字的不同打法」= **格式**。
 *    ⇒ 用字典做料號 = 要人**手動維護無限多種打法** ⇒ 那是設計錯。
 *
 * ## 🔴 缺口只有一種形狀 —— 我量過四種才知道(不要憑「四種都壞」動手)
 * 資料是 `AB-123` 時,今天(本函式之前)的行為:
 * ```
 * `AB-123` ⇒ 一個詞 ⇒ `%AB-123%`            ⇒ ✅ 中(字面就在那裡)
 * `AB 123` ⇒ 切兩詞 ⇒ `%AB%` AND `%123%`     ⇒ ✅ 中(兩個子字串都在)
 * `ab-123` ⇒ 一個詞 ⇒ `%ab-123%`            ⇒ ✅ 中(**ILIKE 本來就大小寫無關**)
 * `ab123`  ⇒ 一個詞 ⇒ `%ab123%`             ⇒ 🛑 **不中** —— 資料裡那個 `-` 卡在中間
 * ```
 * ⇒ 🎯 **真正缺的只有「使用者不打分隔號,而資料裡有」那一種。**
 *    ⚠️ 而它的反向也缺:資料 `AB123`、使用者打 `AB-123` ⇒ `%AB-123%` 不中。
 * ⇒ ✅ 兩個方向用**同一個修法**解:把兩邊都切成段、段與段之間放 `%`。
 *
 * ## 切在哪
 * 分隔號(`- _ . / 空白`)**與字母↔數字的交界**都切:
 * ```
 * `AB-123` `AB 123` `ab123` `AB_123`  ⇒ 全部 ⇒ `%AB%123%`
 * ```
 * 🔴 **字母↔數字交界那一刀是必要的** —— 少了它,`ab123` 切不出段(它沒有分隔號)
 *    ⇒ 那正是唯一真的缺口 ⇒ **只切分隔號的版本會通過所有直覺測試而修不到病。**
 *
 * ## 🛑 為什麼**不是每一欄**都吃這個 pattern
 * `%AB%123%` 比 `%AB123%` **寬**。掛在 `description` 上時,
 * 「…AB 車系適用,長度 123mm…」這種句子會中 ⇒ **關鍵字搜尋會開始噴無關的東西**。
 * ⇒ ✅ 只掛 `external_id`:那一欄的內容**就是料號**,寬一點正好是 Sean 要的
 *    「打差不多的料號可以顯示類似的商品」的**第一步**。
 * ⚠️ 而那句話的完整版(**第三層:模糊比對**)本片**不做** —— 見檔尾「未涵蓋」。
 *
 * ## 🛑 誰不吃這一發(fail-closed,回 `null`)
 * ```
 * · 不含字母 或 不含數字 ⇒ `排氣管` / `9650` / `akrapovic`
 *   ⇒ 🔴 純數字若也吃, `123` 會變 `%123%`(切不出段)= 沒差, 但純字母 `abc` 也一樣沒差
 *   ⇒ ✅ 真正的理由:**切不出兩段以上的東西, 加了等於多送一個一模一樣的條件**
 * · 含非 ASCII(中文)⇒ 中文沒有「字母/數字交界」這種結構, 切法對它無意義
 * · 切完只有一段 ⇒ 與原本那個 pattern 完全相同 ⇒ 不重複送
 * ```
 * 📌 **回 `null` 是「這個詞不適用」,不是「出錯了」** —— 呼叫端照原樣只送原本那一發。
 *
 * @returns 已轉義、含頭尾 `%` 的 pattern;不適用時 `null`。
 */
export function partNumberPattern(term: string): string | null {
  // 🔴 非 ASCII 直接出局(中文/日文)—— 見上面「誰不吃這一發」。
  //    ⚠️ 我原本在這裡掛了一行 `eslint-disable-next-line no-control-regex`,
  //       而 lint 說**那一行沒有用**(本 repo 的設定不報這條)⇒ 拿掉。
  //       📌 一個沒有在擋任何東西的 disable,下一個人會以為這裡有一條規則要繞。
  if (/[^\x00-\x7F]/.test(term)) return null;
  if (!/[A-Za-z]/.test(term) || !/[0-9]/.test(term)) return null;
  const segments = term
    // ① 分隔號 ⇒ 切點
    .split(/[-_./\s]+/)
    // ② 字母↔數字交界 ⇒ 切點(這一刀才修得到 `ab123`)
    .flatMap((chunk) => chunk.split(/(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/))
    .filter((seg) => seg !== '');
  // 🔴🔴 **這一行的歷史值得整段留著 —— 它是【一個數學證明錯了兩次】的紀錄。**
  //
  // ⛔ ~~R1 說它是死碼, 而我照著拿掉了, 並在 commit body 寫「行為零改變」~~
  // 🔴 **R2 用反例推翻了那個證明, 而我自己用 node 複驗確認 R2 對:**
  //    ```
  //    'A#1'  ⇒ segments = ['A#1']  len 1     'A+1' ⇒ ['A+1'] len 1
  //    'A(1'  ⇒ ['A(1']  len 1                'x$9' ⇒ ['x$9'] len 1
  //    🟢 對照:'ab123' ⇒ ['ab','123'] len 2 · 'A#B1' ⇒ ['A#B','1'] len 2
  //    ```
  // 🛑 **那個證明漏掉的是:ASCII 裡有一堆【既不是我切的分隔號、也不是英數】的字元**
  //    (`# + ( $ % ...`)⇒ 它們卡在字母與數字之間 ⇒ **兩者不相鄰 ⇒ 那一刀切不下去。**
  // ⇒ 📌 所以這一行**不是死碼**, 而我那句「行為零改變」**是假的**(鐵則 11 字面 vs 事實)。
  //    拿掉它, `A#1` 會**多送一發** `external_id.ilike.A#1%` —— 那是一個**新行為**,
  //    而它沒有任何測試蓋到(負對照清單裡當時沒有這種形狀)。
  //
  // 🔴🔴 **而我要記的教訓不是「R1 講錯了」, 是【我沒有驗它就照做】:**
  //    R1 給的是一個**看起來很嚴謹的數學論證**, 而我把它當成來源。
  //    ⇒ **審查者的處方也需要一個來源。** 一發 node 就推翻得了它, 而我沒跑那一發。
  //
  // ✅ 所以它留著。而下面那格測試現在餵的是**真的反例** `A#1`(原本餵 `'a1'.slice(0,1)`
  //    = `'a'`, 被上面「沒有數字」那道守門攔掉 ⇒ **從來沒到過這一行** ⇒ 那才是真的假綠)。
  //
  // 🔵 它在做什麼:一段 = 與原 pattern 等價的更窄形狀 ⇒ 不送第二發
  //    (多送不會給錯答案, 只會讓 URL 更長 —— 而 URL 長度在本檔是有上限的東西, 見 MAX_SEARCH_TERMS)。
  if (segments.length < 2) return null;
  // 🔴🔴 **開頭【沒有】`%` —— 錨定在字首。而這一格是量出來的, 不是想出來的。**
  //
  // ⛔ ~~前面也放一個 `%`(未錨定)~~ ⇒ 主視窗 2026-09-03 擋下來要我先量。**他是對的。**
  //    語料 31 筆(形狀取自本 repo grep 到的真料號 + 主視窗點名的碰撞候選), 打 `ab123`:
  //    ```
  //    甲  未錨定 %ab%123%  ⇒ 10 件 —— 🔴 多出 CRAB-99123 · LAB-X-40123
  //                                        GRAB-123MM · SLAB123 · FAB-1230
  //    甲' 錨定   ab%123%   ⇒  5 件 —— ✅ 上面那五顆雜訊【全部消失】
  //    乙  兩端正規化        ⇒  6 件 —— 🔴 仍含 GRAB-123MM · SLAB123 · FAB-1230
  //    ```
  // 🎯 **⇒ 錨定比「兩端正規化」更準(5 < 6), 而且不必動 SQL。**
  //    📌 乙 的雜訊來自它仍然是**子字串**比對 —— 正規化解決的是分隔號, 不是位置。
  //    ⇒ 🔴 **而乙還要 `replace(external_id,'-','')` ⇒ 用不到索引 ⇒ 全表掃。**
  //      錨定版的字首是常數 ⇒ **索引還用得到**。⇒ 更準、更快、改動更小。
  //
  // 🟢 兩個對照都過:完整料號 `AB-123` 與真實料號 `cark9650` 兩種形狀都中(後者 1 件);
  //    🔵 負對照不存在的 `ZZ-999` ⇒ 三種形狀都 0 件。
  //
  // ⚠️ **射程**:這是對【字串比對語意】的量測, 語料是**構造的 31 筆**,
  //    **不是對正式庫 22804 筆量的**。它答得了「哪一種形狀比較不會撈雜訊」,
  //    **答不了**「正式庫實際會多撈幾件」。要那個數字得對正式庫跑, 而我沒有跑。
  //
  // 🔴 **逐段轉義再用 `%` 串** —— ⛔ 不可以先串再整串轉義:
  //    那樣我自己放進去的 `%` 會被 `escapeIlikeWildcards` 轉成字面百分號
  //    ⇒ pattern 變成在找一個**真的含 `%` 字元**的料號 ⇒ **恆 0 筆, 而它不會報錯**。
  return `${segments.map(escapeIlikeWildcards).join('%')}%`;
}

/**
 * 全量分頁上限(繞 PostgREST/Supabase `db-max-rows` 硬上限)。
 * MAX_PAGES 防呆:50 × 1000 = 5 萬件上限(遠超現況、防迴圈失控)。
 *
 * 🔴 `db-max-rows` = **2000**(~~2026-08-02 起記載的 1000 已過期~~)。
 * V 窗 2026-08-18 對正式站實測:`products?select=id&limit=5000`
 * ⇒ HTTP 206、`content-range 0-1999/19777`(分母 19,777 > 2000 ⇒ 量到的是天花板本人)。
 * **本檔改動者未自驗,轉錄 V 窗量測。**
 * ⇒ `PAGE_SIZE = 1000` 目前 **嚴格小於** 上限,~~零餘裕~~ 已解除。
 * 🔴 **但餘裕是【設定給的】、不是這支程式保證的** —— 那個值在 Supabase Dashboard 上
 * 被改回 1000(或更低),本檔的「`batch.length < PAGE_SIZE` 即停」就**再次零判別力**:
 * 伺服器砍出來的頁與真正的末頁**回傳同樣的筆數**,迴圈靜默提早收工,
 * 而**檔沒改、測試沒紅、`grep` 數不變**。判準正本 `docs/patterns/pagination-loop-review.md` §1。
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/**
 * 全量分頁撈取:以連續 `.range(from,to)` 視窗撈到底、繞 PostgREST/Supabase「Max rows = 1000」硬上限。
 * listAllByCategory / listAllProducts 共用(鐵則 6 抽出、兩處分頁迴圈不重複)。
 *
 * `runPage(from, to)` 由呼叫端提供:在 base query 疊自己的過濾與**穩定排序**(`.order('id')`,PK uuid)
 * 後回 PostgREST 結果;listAllByCategory 疊 `.eq('category_id')`、listAllProducts 不疊。
 *
 * 分頁正確性(審查點):
 * - 呼叫端 `.order('id')`(PK uuid 唯一、穩定)+ 連續非重疊 `.range` 視窗 → 無重複 / 無漏行。
 * - 末頁 `batch.length < PAGE_SIZE` 即停(含「恰為 PAGE_SIZE 整數倍」時多撈一次空頁正常停)。
 * - `MAX_PAGES` 防呆上限:命中則 `console.warn`(不靜默截斷、no silent caps)、回已撈部分。
 * - error → throw(fail-closed、對齊各 read method)。
 *
 * 回傳 `unknown[]`:products_public view + embed 投射的 rich-Json wire shape 由呼叫端
 * `as SupabaseProductRow[]` narrow(對齊 findSingle JSDoc 的 rich-Json 邊界說明)。
 */
export async function fetchAllPaginated(
  runPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await runPage(from, from + PAGE_SIZE - 1);
    if (error) {
      throw error;
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return rows; // 末頁、撈完
    }
  }
  console.warn(
    `[${label}] 達 MAX_PAGES=${MAX_PAGES}(${MAX_PAGES * PAGE_SIZE} 件)上限、結果可能截斷;需改 server-side 分頁(#51)`,
  );
  return rows;
}

/**
 * `.single()` 結果統一處理(PGRST_NOT_FOUND → null、其他 error → throw、
 * data null fallthrough → null)。對齊 sub-slice 4 audit 第 3 處撞 Defer trigger
 * (findById + resolveCategoryId + save、雙 audit R1/R2/Q6 共識)。
 *
 * #106:client 已 `SupabaseClient<Database>` generic(.from/.select/.eq 欄名查詢 compile 期檢)。
 * 呼叫端 `as T` + read 路徑 `as unknown as SupabaseProductRow[]` **保留**:products_public view
 * + embeds 投射的 wire shape 把 jsonb 欄(fitments→FitmentSpec[] / images→string[] / segments→string[])
 * narrow 成 domain 形,生成型別僅給 `Json`、無法 derive → 此 cast 為 rich-Json 投射的正當邊界
 * (非 type-safety 漏洞;對比簡單 adapter〔customer/address/vehicle/wallet〕已全消 cast)。
 */
export async function findSingle<T>(
  promise: PromiseLike<{
    data: unknown;
    error: { code: string; message: string } | null;
  }>,
): Promise<T | null> {
  const { data, error } = await promise;
  if (error) {
    if (error.code === PGRST_NOT_FOUND) {
      return null;
    }
    throw error;
  }
  return (data ?? null) as T | null;
}
