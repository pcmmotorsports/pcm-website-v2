# A9b2-A — 依供應商單號跨單搜尋(domain 正規化 + adapter 兩段式查詢)plan v1

> **狀態:自寫 plan、不回核。片界與路線 = 主視窗 `E-142-A` 裁定(**B 兩段式查詢**)+ Sean `E-141-A` Q1=A(非 ASCII 明示提示)。**
> **真權威 = 母 plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:431`(row 39)逐字:**
>
> > **A9b2** | A | 跨單搜尋合約:依**供應商單號**命中(讀 `order_item_procurement`)。走 adapter 投影、不開 DB RPC
>
> **上游 = A9b2-M**(`20260807130000`,產生欄 `supplier_order_no_upper` + 索引;**未 apply**)。
> **下游 = A10c2**(UI 片):URL 參數解析、flag 接線、兩種明示態的畫面,**都不在本片**。

---

## §1 為什麼是「兩段式」而不是內嵌 filter(裁定的依據)

我原本在 `E-234` 寫「走兩層深內嵌 filter + `!inner`,**明細投影已證兩層深路徑可行**」——
**那個依據是錯的**(`E-238-STOP` §1 已自首):

| 投影 | 有 `order_item_procurement` 內嵌? | 出處 |
|---|---|---|
| 明細 `ADMIN_ORDER_DETAIL_SELECT` | ✅ 有 | `SupabaseOrderAdapter.ts:169` |
| **列表** `ADMIN_ORDER_LIST_SELECT` | ❌ **完全沒有** | `SupabaseOrderAdapter.ts:82` |

搜尋跑在**列表**查詢上 ⇒ 內嵌 filter 這條路要先復活 `!inner` 版投影,而那是:
① A9w3 `SupabaseOrderAdapter.ts:84-86` **刻意刪掉**的雙白名單債;
② 動到鐵則 12 的 byte-equal 守門(`SupabaseOrderAdapter.test.ts:260-261`);
③ 🔴 **押在我證不了的 PostgREST 行為**上(不加 `!inner` 時內嵌欄 filter 是否影響最上層;
   本機拋棄式叢集是裸 PG、無 PostgREST)。

⇒ **B 案**:先對 `order_item_procurement` **自己那張表**做 top-level 查詢拿 `order_id` 集合,
再對列表查詢 `.in('id', ids)`。**列表投影一個字都不動**,且每一步語意無歧義。

## §2 🔴 安全論證(實查 supabase-js 原始碼,非印象)

A9b1 的安全論證是「只放行 `[A-Z0-9-]` ⇒ `.or()` 字串內插的注入面為零」
(`order-number-search.ts:8-12`)。**那套在這裡不成立** —— 供應商單號**無格式限制**
(A2 CHECK `20260729020000:95-102` 只擋前後空白與四個零寬字元,不限字元集)。

實查 `node_modules/.pnpm/@supabase+postgrest-js@2.105.3/…/src/PostgrestFilterBuilder.ts`:

| 事實 | 行號 |
|---|---|
| `PostgrestReservedCharsRegexp = /[,()]/` | `:36` |
| **`.eq()` = `searchParams.append(column, \`eq.${value}\`)` —— 不做保留字元引號** | `:172` |
| `.in()` = 對命中保留字元的值**加雙引號**再 `in.(…)` | `:815` |
| `.filter(col, op, value)` = 同 `.eq()`,但值由呼叫端全權決定 | (檔內 `filter` 本體) |

⇒ 兩點結論:
1. **`.in('id', orderIds)` 安全**:值是 UUID、不含保留字元,且 `.in()` 本身就有引號機制;
   `URLSearchParams` 另做百分號編碼 ⇒ 值跑不出 query param 結構。
2. 🔴 **`.eq(supplier_order_no_upper, 使用者輸入)` 不安全**:輸入可含 `,` `(` `)`,
   而 `.eq()` **不加引號** ⇒ PostgREST 端的解析變成歧義。
   **修法不是自己加引號** —— 那要押在「PostgREST 雙引號值裡用 `\` 逃脫」這個我**同樣證不了**的行為上
   (與 §1 選 B 的理由自相矛盾)。⇒ **改成在正規化層擋掉 `,` `(` `)` `"` `\` 五個字元**,
   回具名理由讓 A10c2 明示。**代價誠實列出**:含這五個字元的供應商單號**搜不到**
   (真實單號極少含它們:`SO-123` / `PO/2026/0042` / `ABC_12345` / `#4471` 都不含)。
   日後若有人能在真 PostgREST 上實測引號逃脫,這條可以放寬 —— 屬 backlog、不在本片。

## §3 要做什麼(**只有 domain + adapter + 測試**)

| # | 檔 | 內容 |
|---|---|---|
| **A1** | `packages/domain/src/order/supplier-order-no-search.ts`(新)| `normalizeSupplierOrderNoSearch()` 單一來源 |
| **A2** | `packages/domain/src/index.ts` | 具名匯出 |
| **A3** | `packages/domain/src/order/types.ts` | `AdminOrderFilter` += `supplierOrderNo?: string` |
| **A4** | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` | 兩段式查詢 |
| **A5** | 測試 | domain 新檔 + adapter 既有測試檔補格 |

**不做**(在 A10c2):URL 參數解析、`ADMIN_E10_*` flag 接線、page.tsx、兩種明示態的畫面。
**不做**(刻意):不動 `ADMIN_ORDER_LIST_SELECT` 一個字、不復活 `!inner` 投影、不開 DB RPC。

### 3.1 回傳型別(比 A9b1 多一格 —— Sean Q1=A 要求 UI 分辨得出)

```
empty                                   // 沒輸入 = 不篩選
ok(value)                               // 已 trim + 轉大寫、只含安全 ASCII
invalid('non_ascii' | 'reserved_char' | 'too_long')
```
🔴 `invalid` **一律回零筆、不得退化成不篩選**(照抄 A9b1 `order-number-search.ts:33-35` 的理由)。
`reason` 存在的唯一目的 = 讓 A10c2 渲染不同訊息;**adapter 對三種 reason 一視同仁**(都回零筆)。

### 3.2 大寫化與上限

- **先擋非 ASCII、再 `toUpperCase()`**(照 A9b1 `:72-77`;`'ß'.toUpperCase()` = `'SS'` 會改寫成別人的單號)。
  🔴 這也正是 A9b2-M COLUMN COMMENT 交辦的硬前置(JS 與 PG 的大寫化不保證等價)。
- 長度上限 **32**(與 A9b1 `MAX_ORDER_NUMBER_SEARCH_LENGTH` 同值同理由:值會進 URL query)。
  A2 的 CHECK 對 `supplier_order_no` 無長度上限 ⇒ 上限是**搜尋端**的守門,不是欄的鏡像。

### 3.3 兩段式查詢與「結果過多」

1. 第一段:`from('order_item_procurement').select('order_items!inner(order_id)')
   .eq('supplier_order_no_upper', value).limit(CAP + 1)`
2. 去重出 `orderIds`。
3. 🔴 **`> CAP` ⇒ 回具名「結果過多」,不截斷假裝那就是全部**
   (`E-142-A:1` 批准;Q1=A「不默默降級」的同一精神)。
4. 空集合 ⇒ **直接回零筆、不打第二段**(`.in('id', [])` 的行為不押;省一次往返)。
5. 第二段:既有列表查詢 + `.in('id', orderIds)`,投影/排序/分頁**完全不動**。

**上限選型(v1 寫錯,已依階段 C must-fix 重做)**:

🔴 **v1 只有一道 `.limit(CAP+1)` + `ids.length > CAP`,而那兩邊量的不是同一件事** ——
`.limit()` 限的是**採購列數**、判斷比的是**去重後訂單數**。⇒「列被截斷、但去重後 ≤ CAP」時
**不擲錯、靜默少回訂單**,正是這個上限本來要防的病。(一張 PO 覆蓋 80 張訂單共 250 列很正常:
A2 `:70` 的業務鍵是 `(order_item_id, supplier_canonical_key)`,一單多品項就是多列。)

⇒ 改成**兩道界**:

| 常數 | 值 | 守什麼 | 推導 |
|---|---|---|---|
| `SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT` | **500** | **集合完整性** —— 列數觸頂 = 不知道真集合 ⇒ 擲錯 | 🔴 必須**嚴格低於伺服器 `max-rows`**(2026-08-02 production 實測 **1000**,`mappers/order-cancellations.ts:31`),否則截斷發生在伺服器側、`rows.length` 永遠碰不到我的上限 ⇒ **這道偵測恆假** |
| `SUPPLIER_ORDER_NO_MATCH_CAP` | **100** | **第二段的 URL 長度** | 當場量:`select` 編碼後 550 + `id=in.(…)` 100 筆 = 合計 **4,461** bytes |

🔴 **v1 的 CAP=200 與它的推導是不實字面**:我只算了 `in` 這一項、**漏算整條 `select` 投影**。
當場重量:200 筆時 query string = **8,361 bytes**,**已越過我自己引用的 8KB 線**,
而註解還寫著「低於 8KB 且留兩倍餘裕」。改成 100 才真的留兩倍餘裕。

⚠️ 誠實邊界:8KB 是常見伺服器預設,**未在正式站 PostgREST 前緣實測真實上限**。

**第一段必須帶 `.order('id')`**:沒有排序時 PostgREST 在 `limit` 下回**哪些**列未定義,
而分頁每翻一頁都會重跑第一段 ⇒ 不同頁可能拿到不同 id 集合(同本檔既有次鍵排序的理由,Fable D-2 n1)。

## §4 驗收

1. domain 新檔單元測試:空/正常/大小寫/非 ASCII/五個保留字元逐一/超長/前後空白;
   **每個 `invalid` 都斷言 `reason`**(不是只斷言 kind)。
2. adapter 測試:①命中 → 第二段有 `.in('id', […])` 且**投影未變**(byte-equal 仍是主常數)
   ②零命中 → 回零筆且**第二段完全沒被呼叫** ③`invalid` → 回零筆且**兩段都沒被呼叫**
   ④超過 CAP → 回「結果過多」且不截斷 ⑤`supplierOrderNo` 與其他篩選併用 → 同一 query。
3. 🔴 **既有 byte-equal 守門(`SupabaseOrderAdapter.test.ts:260-261`)必須原封不動仍綠** —— 本片零投影改動。
4. 突變證:每條新斷言配自己的突變(例:把 `invalid` 改成不篩選 ⇒ 該格紅;把 CAP 改成截斷 ⇒ 該格紅)。
5. 三綠 `TURBO_FORCE=true` + 全套 Δ 實數對帳(基準 **357 檔 / 5416 passed** @ `a6cdf9e6`)。
6. 階段 C `code-reviewer`;**鐵則 12 不觸發**(零 schema、零權限、零平台設定、非 packages/ui)
   ⇒ 關卡2 codex 不強制,自評無高風險則不跑。
7. 不 push;commit 押 `nine-code-retire`。

## §5 鐵則與誠實邊界

- **鐵則 8**:跨 4 檔 + 動共用 package(`@pcm/domain` / `@pcm/adapters`)契約 ⇒ 命中。
  代償 = 範圍與路線由 `E-142-A` 明文裁定、Q1 由 **Sean 本人**拍板、且**零 apply / 零 push**。
  ⚠️ 主視窗是 AI、不等於 Sean 批准;**本片的 Sean 拍板只涵蓋「非 ASCII 要明示」那一題**,
  其餘是我依既有拍板的推論 —— 誠實列此,不讓「主視窗明示」單獨扛(同 A9b2-M §6)。
- **鐵則 9**:L 分級不觸發(本片零使用者可見文案;明示訊息的文案在 A10c2)。
- 🔴 **本片產出在 A9b2-M apply 之前不可啟用**:`supplier_order_no_upper` 欄未 apply 時
  PostgREST 回 42703 ⇒ 裸 throw ⇒ 整個列表進錯誤態(D0/A10c1 同族)。
  flag 掛在 A10c2、**本片不自行接線**;在那之前 `AdminOrderFilter.supplierOrderNo` 零 producer。
- 🔴 **`,` `(` `)` `"` `\` 五字元的單號搜不到**(§2 結論 2),是知情取捨、已寫進 domain docstring。

## §6 🔴 交給 A10c2 的清單(本片刻意不做,但下一片不做就會有洞)

1. **兩種明示態的畫面**(Sean Q1=A 的落點):
   `invalid('non_ascii'|'reserved_char')` → 「此單號含特殊字元,請改用其他方式查」;
   `invalid('too_long')` → 長度提示;`SupplierOrderNoSearchTooManyError` → 「符合的訂單太多,請縮小範圍」。
   ⚠️ `apps/admin/src/app/orders/page.tsx` 目前把**所有**例外吞成同一句「訂單列表載入失敗」——
   `TooManyError` 的「明示」承諾 **100% 押在 A10c2 去分流**,本片沒有、也不該去改那支。
2. 🔴 **結果列必須顯示供應商**(§5 的 must-fix):本搜尋沒有供應商維度,
   兩家供應商用同一組單號會一起回來,畫面不顯示供應商就分不出來 ⇒ 可能把貨登記到別家的訂單上。
   同時把「加供應商 filter」列進 backlog。
3. **「輸入了但 trim 成空」與「根本沒輸入」在 UI 上要分開**:兩者在 domain 都回 `empty` = 不篩選 = 列出全部
   (與 A9b1 一致)。UI 不分開的話,使用者打了一串空白會看到全部訂單、以為那就是搜尋結果。
4. **flag 接線**:照 A10c1 前例掛 env flag 預設 off;**A9b2-M apply 之前不得開**。
5. 🔴 **URL 參數要照 A10c1 的 `firstValue` 收斂 `string[]`**(Fable F6):
   `?supplierOrderNo=a&supplierOrderNo=b` 解析出來是陣列,而 `normalizeSupplierOrderNoSearch`
   對非字串回 `empty` = **不篩選 = 列出全部訂單**(fail-open)。
   既有 pattern 就在 `apps/admin/src/lib/orders/order-list-view.ts:234`,照抄即可。
6. ⚠️ **apply 後首次實跑必看第一段的回傳形狀**:本片的 mock 餵的是 `order_items` **物件**
   (many-to-one embed,FK 方向 A2 `:43` 支持這個判斷),但**本地沒有 PostgREST 可以證**。
   若實際回的是陣列,`ids` 會恆空 ⇒ **測試九格全綠、搜尋卻恆零筆**。這是本片最需要真環境確認的一點。

— E 窗,2026-08-07
