# #347-2a 訂單關鍵字搜尋 — domain + port + adapter 接線(plan v4)

> 母片 = #347-2「訂單搜尋呼叫端接線」。真權威 = `supabase/migrations/20260809180000_m4b_347_1_admin_search_orders.sql`
> 檔頭合約 + 信箱 `D-381-STOP` §3 開工包。片型 = **高風險**(鐵則 12 ②:service_role RPC + 全表 PII 比對面)。
> **內容分級(鐵則 9)= N/A** —— 本片零使用者可見文案(提示字串全在 2b,屆時隨那片標 L2)。
>
> **v4 = 關卡1 三輪全數折入**(§5 逐條對帳):
> R1 codex 9 must-fix + 3 nit / R2 codex 6 + 3 / **R3 換模型換角度(Fable)3 + 3,與前兩輪零重疊**。
> 每一條事實主張都由主對話**親自開檔複驗**過(行號、postgrest-js 原始碼、既有測試行號),
> 不照單全收。⚠️ 唯一的例外是「既有測試要改幾處」那個數字:我 v1 說 6、v3 說 8 **兩次都錯**,
> R2 說的 **7** 才對,最後由**實跑**定案(§1-7)。⇒ 這類數字不寫在檔頭、只留 §1-7 一處。

> ⚠️ **本檔內所有 `檔案:行號` 都是「實作之前」量的**,實作把 adapter 推移了 200 多行 ⇒ 對不上是預期的。
> plan 是歷史文件、不隨程式碼維護;**要查現行位置一律以程式碼裡的註解為準**(那些已在收工前重量過)。
> 這條寫在這裡,是因為同一顆 commit 的 body 裡有「同一個數字只寫一處」的自述 —— 不寫明就自相矛盾。

## 0. 片界:為什麼拆成 2a / 2b

母片跨四層(domain 正規化 / adapter 兩段查詢 / 列表頁 searchParams+旗標 / UI 搜尋框),
超過鐵則 4 的 15-45 分鐘。拆法**沿用本線既有先例**(A9b2-A adapter 片 → A10c2 UI 片):

| 片 | 範圍 | 對外可見? |
|---|---|---|
| **2a(本片)** | domain normalize + `AdminOrderFilter.keyword` + port 回傳型別 + adapter RPC 接線 + POST-only 守門 | **零** —— `filter.keyword` 零 producer,`page.tsx` 一個字不動 |
| 2b | 搜尋詞的**傳輸方式(🔴 未定,見下)** + env flag + 搜尋框 UI + **truncated 提示文案(硬前置,§1-2)** + **零結果提示(硬前置,§1-5 ⑥)** | 是(flag 開才可見) |

🔴🔴 **2b 的搜尋詞傳輸方式是未決的決策題,本片不預設答案(R2-M1)**:
v1/v2 順著 A10c1/A10c2 的形狀寫「加一個 `q` query param」——**那會直接推翻 #347-1 的主要設計理由**。
migration `:50-74` 逐字:搜尋詞是 PII(姓名/電話/地址),所以 RPC 走 POST、「一個字都不進 URL」。
把它放進 `?q=王小明` 之後,它會落進**瀏覽器歷史、Referer、Vercel access log** —— POST 那半的防護當場歸零。
⚠️ 既有兩維度放進 URL 是**可辯護的**(訂單編號/供應商單號不是個資);關鍵字**不是同一類東西**。
⇒ 這是產品/架構決策(server component + searchParams 是現行列表的整個骨架,改成 POST/server action
   是真的架構改動)⇒ **交主視窗/Sean 裁,不由本片自己選**。**2a 完全不受影響**(零 producer)。

## 0-1 三張決策題 —— **主視窗 `D-385-A` 已全裁**(2a 不擋、2b 擋)

| # | 題 | 裁決 |
|---|---|---|
| Q-a | 搜尋詞怎麼傳 | ✅ **B = POST server action + PRG**。理由=**紅線一致性、不是新決策**:「搜尋詞 PII 不進 URL」今晚已由 347-1(POST-only)與 A13b(URL 只帶碼)兩線立成全站紅線;A 案 = 親手推翻自己一小時前上線的防護。⚠️ 誠實邊界:**失去「可分享的搜尋網址」**,內部後台可接受 |
| Q-b | L6「刷卡未付款隱藏」對關鍵字搜尋要不要豁免。⚠️ **含一個併用分支(R3-n2)**:adapter `:526-529` 的既有條件是 `supplierSearch.kind !== 'ok'` ⇒ 同一張 tappay×unpaid 單,**只搜關鍵字 = 被藏、關鍵字 + 供應商單號 = 出現**。這個不一致要跟主題一起裁,免得 2b 寫零結果提示時漏掉「併用時其實沒藏」那條分支 | **不豁免 + 零結果時給提示**(§1-5 ⑥) |
| Q-c | 正式站 service_role 的 `statement_timeout` 未量 ⇒ 要不要當 2b 開 flag 的硬閘 | **要**(§3) |

🔴 **這個拆法不違反「接一半比沒接更危險」**(D-381-STOP §2):2a 完工時
**沒有任何路徑能餵出 `filter.keyword`** ⇒ 執行期行為與現在相同。危險的是「UI 接上了但 adapter 半殘」,
順序相反就沒有那個狀態。

## 1. 要改什麼

### 1-1 `packages/domain/src/order/keyword-search.ts`(新)

`normalizeOrderKeywordSearch(raw)` → `{kind:'empty'} | {kind:'invalid'; reason; input} | {kind:'ok'; value}`,
形狀照抄 `order-number-search.ts` / `supplier-order-no-search.ts`(`empty` 與 `invalid` 分立,
因為兩者的正確行為相反:沒輸入=不篩選、輸入了但不合法=**必回零筆**)。

🔴 **與另外兩支的關鍵差異,必須寫進 docstring 免得下一個人照抄錯的那半**:
本維度**沒有字元集守門**。A9b1 擋 `[^A-Z0-9-]`、A9b2 擋 `,()"\` ——
兩者的理由都是**值會被內插進 PostgREST 的 GET query string**(`.or()` 字串內插 / `.eq()` 不加引號)。
本片走 `.rpc()` = **POST + JSON body**(postgrest-js `PostgrestClient.ts:425-427` 的 else 分支),
值不進 URL、不進 filter 語法 ⇒ 中文、`%`、`_`、`,`、`(` 全部是合法搜尋詞,擋掉它們等於把功能廢掉一半
(RPC 用 `strpos()` 不是 `ILIKE`,`%`/`_` 沒有萬用字元語意 —— 理由在 migration `:76-86`、實作在 `:208-250`)。

本檔同時定義並匯出 **`OrderKeywordSearchShapeError`**(R2-M4:v2 在 §1-5 用了它卻沒定義過)——
放這裡而不是 adapter,是照 `supplier-order-no-search.ts:74` 的既有先例(搜尋維度的錯誤型別與它的
正規化住同一支)。

守門四條,**每條都標明「鏡射 RPC」或「防呼叫端自己爆掉」**:

| 規則 | reason | 對應字面 | 為什麼 |
|---|---|---|---|
| 修剪字元集 = `空格 \t \r \n U+3000 U+00A0 U+202F U+200B U+FEFF`,修完為空 → `empty` | — | migration **`:179`** 的 `btrim(..., E' \t\r\n　  ​﻿')` | JS `String.trim()` **不清 U+200B**(零寬空格不在 JS 的 WhiteSpace)⇒ 只靠 trim 的話「貼上一顆零寬空格」前端算有輸入、RPC 算空 ⇒ 回零筆而不是不篩選 |
| 含 `U+0000` → `invalid('bad_char')` | `bad_char` | — | PG `text` **不能存 NUL**;送進去是 22021、整頁錯誤態,不是「查無此單」 |
| 含**落單代理字元**(`\p{Surrogate}` 且不成對)→ `invalid('bad_char')` | `bad_char` | — | ⚠️ **失敗點的精確位置(R2-n1 更正)**:`JSON.stringify` 會把它逃脫成 `"\ud800"`(合法 ASCII、fetch 送得出去),真正炸的是 **PG 解 JSON 時拒絕落單代理**(`unsupported Unicode escape sequence`)⇒ 仍是整頁錯誤態而不是「查無此單」。守門位置不變,理由改寫成事實 |
| **code point** 數 > **120** → `invalid('too_long')` | `too_long` | migration **`:189`** 的 `length(v_needle) > 120` | RPC 對超長輸入**靜默回空清單**;轉成 `invalid` 才能讓 2b 明示「搜尋詞太長」(Q1=A 不默默降級) |

🔴 **長度必須數 code point、不能用 `String.length`**(R1 M3,實錘):PG 的 `length()` 數**字元**,
JS `.length` 數 **UTF-16 code unit** ⇒ 61 顆 emoji 在 JS 是 122、在 PG 是 61。
用 `.length` 會把合法輸入誤判成太長。⇒ 一律 `Array.from(trimmed).length`。

⚠️ **殘餘不重合(誠實邊界,寫進 docstring;無法消除)**:RPC 是 `length(lower(btrim(x)))`,
我們量的是 `length(btrim(x))` —— **中間差一個 `lower()`**。極少數字元大寫化/小寫化會改變長度
(`'İ'.toLowerCase()` = 2 個 code point),⇒ 存在「JS 判 ok、PG 判太長」的縫。
**那個縫的後果是回零筆、不是回錯的資料**(RPC 超長分支回空清單)⇒ **fail-closed,可接受**。
🔴 反方向的縫**不存在**:`lower()` 不會讓字串變短到跨過門檻的機率不是零,但那只會讓 PG 比我們寬鬆
—— 我們已經擋掉了,不會有資料外流。**不假裝這條完全對齊。**

截斷值取 `MAX + 1` 不是 `MAX` —— 截到剛好 MAX 會讓這個值自己通過下一次正規化
(A9b1 `:69-75` 同一個坑,呼叫鏈真的會再正規化一次)。

### 1-2 `packages/domain/src/order/types.ts`

- `AdminOrderFilter` 加 `keyword?: string`,docstring 寫死「不合法 → adapter 回零筆、**不得退化成不篩選**」。
- 新增 `AdminOrderListResult = Paginated<AdminOrderSummary> & { keywordTruncated: boolean; keywordMatchCount: number | null }`。

🔴🔴 **`keywordMatchCount` 是「災難當天查得出來」那一格(R3-F3)**:三個月後員工說「搜料號 X 查無此單」,
照 v3 之前的設計,**三種完全不同的成因回傳形狀一模一樣**(都是 `{items:[], total:0}`):
① RPC 零命中 ② RPC 有命中但與供應商 ids 交集砍光 ③ 交集非空但第二段被 L6/付款狀態篩掉。
而搜尋詞**禁止落 log**(migration `:50-74`,那是 PII)⇒ 唯一合法的觀測物就是**非 PII 的計數**。
`ids.length` adapter 當下手上就有、白白丟掉;等 347-3 再補要重攪 port + §1-7 那批斷言 + mock。
⇒ **現在放進去**:`keywordMatchCount` = RPC 回的 `ids` 筆數(未做關鍵字搜尋 = `null`,與「命中 0 筆」區分)。
2b 可以據此對員工說人話(「找到 3 筆,但都被目前的篩選條件排除了」),而**一個字的搜尋詞都不必記錄**。

🔴 **為什麼不塞進 `Paginated<T>` 本身**:`supplier-order-no-search.ts:48` 已就同一問題寫下判準
——「不為一個少數分支去加寬所有消費端都看得到的共用型別」。這裡改的是**這一支方法的回傳**,
會員側 / 客戶列表的 `Paginated` 一個字不動。
🔴 **為什麼不學供應商單號用「擲錯」**:語意不同。供應商單號超限 = **不知道真集合**,只能擲;
關鍵字截斷 = 前 100 筆是**真的、可用的**結果,合約明寫「回前 N 筆 + `truncated=true` + UI 顯示提示」
(migration `:130-136`)。擲錯會讓員工連那 100 筆都看不到。

🔴🔴 **必填欄不等於「呼叫端一定會處理」(R1 M8;我 v1 的宣稱說太滿)**:
TypeScript 的必填只約束**產出者**;`page.tsx` 照樣可以把結果當 `Paginated` 用、合法忽略這個欄位。
🔴🔴 **2b 的第三條硬前置:分頁 / 回跳必須保留搜尋詞**(關卡2 R3 consider ③)——
Q-a=B 拍板「搜尋詞不進 URL」之後,`buildOrderListHref`(`order-list-view.ts:288-306`)**結構上就帶不走它**:
它是把 filter 逐欄拼成 query string 的,而搜尋詞刻意不在 query string 裡。
⇒ 員工搜完按「下一頁」= 搜尋詞消失 = **列表靜默變成全部訂單**,
正是該檔 `:296` 註解親自警告過的那個 fail-open 形狀(當初是對 `orderNumber` 說的)。
⚠️ 這條**不是 2a 的洞**(零 producer、沒有分頁鈕帶得動它),但它是 Q-a=B 的**直接後果**,
必須跟 truncated 提示同級地寫進 2b 驗收,不能等 2b 自己發現。

⇒ **真正防靜默截斷的守門在 2b**:一條「`keywordTruncated=true` 時畫面必須渲染提示字串」的元件測試,
且要有突變(拿掉提示 → 該格轉紅)。本片把這條寫成 **2b 的硬前置**,不是留給下一個人自由心證。
必填欄在這裡的作用只有一個且僅此一個:**adapter 每條 return 路徑都必須明確表態**
(實作後實查 = 7 條:3 條正規化早退 `matchCount` 恆 `null` + 3 條查過了的零筆早退 + 1 條正常;
⚠️ 我 plan 階段寫「四條」是憑想像數的,關卡2 R1 抓到 —— **路徑數這種東西要等實作完再數**)。

🔴 **`keywordTruncated` 的精確語意(R1 M1;不寫清楚就會被誤讀成「總筆數超過 100」)**:
它的意思是 **「關鍵字**自己**命中的訂單超過 100 筆,RPC 只回了最新的 100 筆」**,
**不是**「畫面上這個結果集被截斷」。因為 RPC 先取全域前 100,才在第二段與其他篩選條件取交集 ⇒

- `truncated = false` ⇒ 關鍵字命中集合**完整** ⇒ 交集與 `total` **精確**,無歧義。
- `truncated = true` ⇒ **第 101 筆之後的命中看不到**。此時若同時套了其他篩選(付款狀態、供應商單號…),
  真正符合的單可能**整張落在那 100 筆之外** ⇒ 畫面可能顯示 0 筆。
  **這正是提示存在的理由**:提示必須在 `truncated=true` 時**一律顯示,包含 0 筆的情況**
  —— 0 筆 + 沒有提示 = 員工得到「查無此單」的錯誤結論,那是本合約最主要要禁的形狀。
  ⚠️ 同理,`truncated=true` 時的 `total` 只代表「前 100 筆再套其他篩選後的數量」,**不是完整命中數**。
- 🔴 **不能靠把其他篩選下推進 RPC 解決** —— 那要動 RPC 簽章,而 Q14 已拍板日期參數隨 **347-3**。
  ⇒ 本片的正確作法是**把語意寫死 + 讓提示無條件出現**,不是假裝沒這件事。

### 1-3 `packages/ports/src/IOrderRepository.ts`

`listOrderSummariesForAdmin` 回傳改 `Promise<AdminOrderListResult>`。
全 repo 只有一個 production 呼叫端(`apps/admin/src/app/orders/page.tsx:84`,實查)+
一個實作(`SupabaseOrderAdapter`,實查)⇒ 交集型別對現有 `result.items` / `result.total` 零影響。

### 1-4 `packages/domain/src/index.ts`

補 barrel export(R1 M6 + R2-M4):`normalizeOrderKeywordSearch` / `OrderKeywordSearch` /
`OrderKeywordSearchInvalidReason` / **`OrderKeywordSearchShapeError`** /
`MAX_ORDER_KEYWORD_LENGTH` / `AdminOrderListResult`。
adapter 從 `@pcm/domain` 匯入是既有慣例(`:32-51` 兩支搜尋 helper 都在),漏了直接 build 紅。

### 1-5 `packages/adapters/src/supabase/SupabaseOrderAdapter.ts`

**上限常數對齊(不新增第三個數字)**:抽 `ADMIN_ORDER_ID_IN_CAP = 100`,
`SUPPLIER_ORDER_NO_MATCH_CAP` 改為由它導出。理由同一條:`.in('id', ids)` 的 **PostgREST query string 長度**
(本檔 `:100-121` 已量:100 筆 = 4,461 bytes、200 筆 = 8,361 bytes 越線)。
RPC 的 `p_limit` 送 `ADMIN_ORDER_ID_IN_CAP` ⇒ **兩邊同源**。

🔴 **抽共用常數會製造一個新的漂綠面(R2-M5),所以要配一道釘值**:既有供應商邊界測試是**拿這個常數**
產測資料的 ⇒ 有人把它改成 200,production 與測試會**一起漂**、8KB URL 的病無聲復活,而全綠。
⇒ 同片加一格 `expect(ADMIN_ORDER_ID_IN_CAP).toBe(100)`,錯誤訊息寫明它的來源是本檔 `:100-121`
量出來的 byte 表(100 筆 = 4,461 / 200 筆 = 8,361 越 8KB 線)與 RPC 的硬夾值,
**要改必須先重量 URL 預算**。釘值格與衍生常數分開,才擋得住「同源 ⇒ 一起漂」。

🔴 **執行順序(R1 M2:所有輸入先驗完,才准發任何 I/O)**:
v1 把關鍵字正規化排在供應商查詢**之後** ⇒「關鍵字非法 + 供應商命中過多」時會先擲
`SupplierOrderNoSearchTooManyError`,而正確答案是**零筆**;而且白打一次 DB。
⇒ 三個搜尋維度(orderNumber / supplierOrderNo / keyword)的 `normalize` **全部提到方法最前面**,
任一 `invalid` → 立刻 `{items:[], total:0, keywordTruncated:false}`,**零 I/O**。

🔴🔴 **I/O 的先後順序是語意的一部分,必須釘死(R3-F1;兩種合法讀法會給出可觀測不同的行為)**:
「關鍵字命中 150 筆(truncated)+ 供應商單號命中 0 筆」這個輸入下 ——
供應商 probe 先跑 ⇒ 本檔 `:477` 早退、RPC 根本沒打 ⇒ 回 `keywordTruncated:false`、**畫面無提示**;
關鍵字 RPC 先跑 ⇒ 回 `truncated:true`、**畫面有提示**。兩種實作各自寫測試都會全綠。
而 §1-2 明令「`truncated=true` 時含 0 筆一律顯示提示」⇒ **順序載重,不能留給施工者臨場決定**。
⇒ **釘死:關鍵字 RPC 排在供應商 probe _之前_**,且**任何早退路徑都必須把已經知道的 `truncated` 帶出去**
(不得因為「反正是零筆」就回 `false` —— 那正是靜默降級)。
同理「供應商命中 > 500 + 關鍵字命中 0」也只有一種正確答案:**零筆、不擲 `TooManyError`**
(關鍵字已經證明交集必為空,擲錯會讓員工看到一句與事實無關的「資料太多」)。

驗證通過後才進 I/O,關鍵字段(**排在供應商段之前**):

1. `.rpc('admin_search_orders', { p_query, p_limit })`。
   - **參數名逐字對 migration 簽章**(`p_query` / `p_limit`;`:155-157`)—— GRANT 綁精確簽章,漂一個字 = 42501/404。
   - 型別:`admin_search_orders` **不在** `database.types.ts`(實查 grep 零命中,函式建立於型別生成之後)
     ⇒ 走既有先例的 cast(`apps/admin/src/lib/customers/customer-repository.ts:135` 的 `as unknown as TierRpcClient`),
     cast 成**只含這一支簽章的窄介面**、不是 `any`。
2. **`error` 先處理**(R1 M5):`if (error) throw error;` 在讀 `data` 之前,同本檔既有慣例。
3. **回傳形狀 fail-closed 驗證**(不硬轉),四道,任一不符 → 擲具名 `OrderKeywordSearchShapeError`:
   - `data` 是非陣列物件;
   - `ids` 是陣列、且每個元素都是 **UUID 形狀字串**(R1 M5:非 UUID 進 `.in()` 會讓 PostgREST 400 = 整頁錯誤態);
   - `truncated` 是 boolean(不是 truthy 判斷 —— 缺鍵時 `undefined` 會靜默變成「沒截斷」);
   - **`ids.length <= ADMIN_ORDER_ID_IN_CAP`**(R1 M5:RPC 哪天被改成回 101 筆,`.in()` 的 URL 就爆,
     而那個失敗會長得像「列表整個壞了」而不是「搜尋回太多」)。
   理由同 `SupplierOrderNoSearchShapeError`:硬轉 = 把「DB 回了什麼」變成沒人驗的假設,
   而 mock 餵的一定是對的形狀 ⇒ **測試全綠、功能壞掉**。
4. `ids.length === 0` → 回零筆、**不打第二段**(不押 `.in('id', [])` 的行為;同供應商那段既有處置),
   但 **`keywordTruncated` 照實回傳**(零命中 + truncated 的組合不可能發生,但不靠「不可能」寫死 false)。
5. 與供應商單號的 ids **在 JS 內取交集後只送一次 `.in('id', …)`**。
   🔴 **不得送兩次 `.in('id', …)`**:那會產生兩個同名 query param,而「重複的同欄 filter 怎麼合併」
   屬本檔 `:508-513` 明文拒絕押的那類未文件化 PostgREST 行為(押錯 = 其中一半靜默失效 = fail-open)。
   交集為空 → 回零筆、不打第二段。
6. **L6「刷卡未付款」隱藏規則:關鍵字搜尋 _不_ 豁免**(R1 M9 折入,**與 v1 相反**)。
   v1 說「機械沿用既有兩個豁免」是錯的:既有豁免的理由逐字是「客服拿著單號查**特定一張單**」
   (本檔 `:505-507`),而關鍵字是**八維度子字串**搜尋 —— 搜「王」或一個品牌名會一次撈回大量
   tappay×unpaid 單,正是 Sean 逐字要求隱藏的那批(「刷卡單失敗直接不顯示在後台就好」,`types.ts:236`)。
   ⇒ **豁免關鍵字 = 新的業務規則,不是既有拍板的延伸,本片無權自己決定。**
   本片採**保守側 = 不豁免**(零 code 變更、L6 條件一個字不動);
   員工要看那批單,既有的「連未付款一起顯示」勾選框就是逃生口。
   🔴🔴 **但「不豁免」本身也會靜默漏單(R2-M2,實錘且必須配套)**:精準搜一個料號,
   若命中的單剛好是 tappay×unpaid ⇒ RPC 回 1 筆、`truncated=false`、第二段被 L6 濾成 **0 筆**
   ⇒ 畫面吐「共 0 筆 / 目前沒有符合條件的訂單」而**沒有任何提示** —— 與被豁免的那條路一樣是降級,
   只是換一個方向。**勾選框不是解答:員工不知道自己需要去勾它。**
   ⇒ **2b 硬前置**(與 truncated 提示同級):關鍵字搜尋 + L6 隱藏生效 + 結果 0 筆時,
   畫面**必須**出現「可能有刷卡未付款的單被隱藏,勾選『連未付款一起顯示』再查一次」。
   ⚠️ 刻意**不**多打一次「沒有 L6 條件的 count」去確認真的有被藏——那是為了一句提示多掃一次全表;
   提示寫成**條件式措辭**(「可能有」)就不需要那個查詢,也不會說謊。
   ✅ **主視窗 `D-385-A` 已裁 = 採本推薦**,並給出**統一敘述**(逐字寫進 adapter 註解):
   > **豁免綁精準鍵**:查詢含訂單編號 / 供應商單號等**精準識別鍵** = 豁免隱藏(既有核准);
   > **純關鍵字不豁免**;關鍵字與精準鍵**並用**時,豁免由精準鍵帶入 ——
   > 現行 `:526-529` 的行為**是一致的、不改**。
   🔴 ⇒ R3-n2 指出的那個分支(只搜關鍵字被藏、關鍵字+供應商單號出現)**不是 bug,是規則的正確結果**。
   本片**一行都不改** L6 條件,只把上面這段敘述寫進註解,讓下一個人不會把它當成遺漏「修好」。
7. 每條 return 路徑都帶 `keywordTruncated`(未搜尋 = `false`)。

### 1-6 POST-only 守門(N8 機制化,**不是註解**)

新檔 `packages/adapters/src/supabase/admin-search-orders-post-only.test.ts`,
掃描面與剝註解手法照抄 `apps/admin/src/lib/orders/nine-code-rpc-retired.test.ts`(六根、剝行註解)。

| 斷言 | 擋什麼 |
|---|---|
| 呼叫面(`.rpc('admin_search_orders'`)在**六個掃描根之內**恰一處 | 有人複製一份繞過其他斷言;**同時涵蓋「零處」**(改名 → 這格就紅)⇒ 不另立冗餘的前提格(R1 nit)。🔴 措辭是「六根之內」不是「全樹」(R2-n3):`apps/api`、`packages/schemas`、`packages/ui` 等不在掃描面,寫「全樹」就是宣稱大於事實 |
| 該呼叫的第三參數不得出現 `get` | `.rpc(fn, args, { get: true })` ⇒ `method='GET'` + 引數 `url.searchParams.append` |
| 🔴 該呼叫的第三參數不得出現 `head` | **R1 M4(實錘)**:`PostgrestClient.ts:413-422` 是 `head \|\| get` **同一個分支** ⇒ `head:true` 一樣把 `p_query` 塞進 URL。v1 只擋 `get` = 守門漏掉它宣稱擋住的面的一半 |
| **六根之內**不得出現 `p_query` 與 `URLSearchParams` / `searchParams.append` 同檔共現 | 有人手搓 URL 打這支 RPC。🔴 措辭同上不得寫「全樹」(R3-n1:R2-n3 只修了第一格,這格漏改 —— 又一次「只補被點名的那一行」)。⚠️ 施工提醒:adapter `:101` `:103` `:419` 的 `URLSearchParams` 字面**都在註解裡**,所以**必須照抄 `nine-code-rpc-retired.test.ts` 的剝行註解那一半**(含剝 JSDoc 的 `* ` 行),否則對正確實作假紅 |
| 引數不得用 spread / `as any` 餵 | 那會讓型別與本檔的字面守門同時失效(`shipment-repository.test.ts:84` 同款) |

🔴 **這條守門擋得住什麼、擋不住什麼**(不讓名字大於實力):
擋的是**無意的回歸**(複製貼上、為了 debug 順手改 GET/HEAD)。擋不住刻意規避
(字串拼接函式名、computed property、把呼叫搬進本檔沒掃的 package)。
真正保證 POST 的是 postgrest-js 的預設分支 —— 本檔釘的是「沒有人把那個預設改掉」。

**每條斷言配自己的突變、且只紅它那一條**(memory `feedback_negative-test-harness-self-false-green`),
突變證據寫進 commit body。

### 1-7 測試(R1 M7:v1 沒列,補齊)

- **既有測試要改**:`SupabaseOrderAdapter.test.ts` 對 `listOrderSummariesForAdmin` 的**完整回傳物件**
  做精確 `toEqual` 的是 **7 處**(= 實跑後轉紅的 7 格,已全部改完、74 格全綠)。
  加必填欄後會全紅 ⇒ 同片更新,**不是**把欄位改成選填來閃避。
  🔴 **這個數字我連錯兩次,最後是實跑定案的**:
  ① v1 寫 6(`grep -c "toEqual({ items"`,漏掉換行寫法);
  ② v3 改寫 8 並列了行號 —— 但 **`:970` 是 `findAdminOrderDetail` 的回傳、不是本方法**,列錯了;
  ③ 實跑 `vitest` ⇒ **恰好 7 格轉紅**,與 R2 給的數字一致 —— **審查者是對的,我兩次都錯**。
  ⚠️ 教訓不是「要更小心數」,是**這種數字不該用讀的**:`grep` 與肉眼都會把「同名但不同方法」
  算進去。可執行的裁判(讓它紅一次)才是來源。
- ⚠️ **typecheck 掃不到的兩個 double(R3-n3)**:`apps/admin/src/app/orders/page.test.tsx:17` 的 repository mock 是
  裸 `vi.fn()`、`place-order.test.ts:15` 走 `as unknown as` 雙重 cast ⇒ **兩個都不會因為新必填欄轉紅**,
  靜默違反新合約。2a 執行期無害(它們不走這條路),但**寫下來**免得施工者以為 typecheck 會替他掃到 mock。
- **新增**:
  - domain — 修剪字元集逐顆(含 U+200B)、NUL、落單代理、120 code point 邊界(emoji 對照 `.length` 會誤判的那組)、截斷值 `MAX+1`;
  - adapter — 空/invalid 零 I/O(斷言 `.rpc` 與 `.from` 都沒被呼叫)、happy path 參數名逐字、
    `truncated` 直通、四道形狀守門各自 fail-closed、與供應商 ids 取交集、交集為空不打第二段、
    **L6 對關鍵字仍生效**(§1-5 ⑥ 的保守側,寫成斷言才不會被下一個人默默翻掉)。

## 2. 不做什麼(明確排除)

- **RPC 簽章不動** —— 日期範圍參數隨 347-3(Sean Q14=A 已拍)。
- **不改 `ADMIN_ORDER_LIST_SELECT`** —— 本片零投影變更,鐵則 12 的 forbidden 守門一個字不碰。
- **不動 `page.tsx` / 篩選列 / URL 參數** —— 那是 2b。
- **不做 `pg_trgm` 索引**(migration 檔頭已寫明重估觸發 = orders 破約 5 萬列)。

## 3. 預期影響面 / rollback

- 影響面:`filter.keyword` 零 producer ⇒ **執行期行為零變更**。實際變的只有回傳多兩個欄位
  (未搜尋時恆為 `false` / `null`)與 **§1-7 列出的那批**測試斷言(**數字只寫在 §1-7 一處**)。
  ⚠️ **這句先後寫過「6 處」與「8 處」兩個錯數字**(R3-F2 抓第一次、關卡2 R1 抓第二次)——
  同一個病復發兩輪,根治法就是**這裡不寫數字、只指過去**。
  正是 memory `feedback_claimed-sync-but-only-patched-touched-lines` 記的那個形狀 —— 改 spec 時
  只補了「被 finding 點名的那一行」。⇒ **數字只寫在 §1-7 一處,其他地方一律指過去、不複製。**
- rollback:單一 commit revert;無 migration、無 schema 變更、無資料寫入。
- 🔴 **DB 前置已滿足 —— 但只滿足「函式存在」這一項,不等於「可以開給員工用」(R2-M6 收窄宣稱)**:
  `20260809180000` 已 apply 正式站(STATUS 2026-08-09 21:0x 逐字)⇒ 與 A9b1/A9b2 不同,
  本片**不需要**「apply 前 flag 一律 off」那道防 42703 的閘。
  ⚠️ **但另有一道尚未關的閘**:這支是**逐列全表掃描、且執行時間沒有被任何一層限住**
  (migration `:122-141`:函式層 `SET statement_timeout` 實測為 no-op、`ALTER ROLE` 路線已被裁決不走)。
  正式站 service_role 的實際 `statement_timeout` **至今沒量到**(§4)⇒ 若是 `0`(無上限),
  開 flag 等於把一支無時限的全表 PII 掃描開給員工重複觸發。
  ⇒ **列為 2b 開 flag 的硬閘(決策題 Q-c,推薦「要」)**:量到值、或另立小片綁上限,才准開。
  🔴 **本片(2a)不受這道閘影響** —— 零 producer,沒有任何人叫得到它。

## 4. 未結帳單(本片解不掉、帶進 STOP)

- 🔴 `SHOW statement_timeout` **本窗量不到**:repo 根 `.env.local` 實查只有 PostgREST 金鑰
  (`SUPABASE_SECRET_KEY` / `NEXT_PUBLIC_SUPABASE_URL`),**沒有 DB 連線字串或密碼**;
  `supabase/.temp/pooler-url` 只有帳號主機、無密碼。PostgREST 打不出 `SHOW`。
  ⇒ 需有 Studio / DB 密碼的一方跑唯讀 SQL,詳 STOP 信。**不拿本機裸 PG 的預設值充數。**
- 品牌維度對 `variant_id = NULL` 的歷史單搜不到(migration 檔頭 ⑦,harness B19 測著)—— 屬另一片。
- ✅ ~~L6 對關鍵字要不要豁免~~ **已由主視窗 `D-385-A` 裁決**(不豁免;豁免綁精準鍵)——
  裁決字面在 §0-1 Q-b 與 adapter 註解。**這不是待決策項,下一片不要重問**(關卡2 R2-n2)。
  仍是 2b 待辦的只有它的**配套**:零結果時的條件式提示。

## 5. R1 findings 對帳(9 must-fix + 3 nit)

| # | finding | 處置 |
|---|---|---|
| M1 | 先截全域 100 再取交集 ⇒ 漏單、`total` 語意不明 | **接受**。無法在不動簽章下消除 ⇒ §1-2 寫死語意 + 提示 `truncated=true` 時**含 0 筆一律顯示** |
| M2 | 正規化排在供應商查詢後 ⇒ 錯誤優先序錯 + 白打 DB | **接受**,三維度正規化全提到最前(§1-5) |
| M3 | JS `.length` ≠ PG `length` | **接受**,改數 code point;並補 NUL / 落單代理;殘餘 `lower()` 縫誠實寫下(fail-closed) |
| M4 | 守門漏擋 `head:true` | **接受**,已開 `PostgrestClient.ts:409-422` 複驗屬實 ⇒ 加一格 |
| M5 | 形狀守門太弱(UUID / ≤cap / error 先處理) | **接受**,四道(§1-5 ③) |
| M6 | 漏 barrel export | **接受**,§1-4 |
| M7 | 既有 `toEqual` 會紅 + 沒列新測試 | **接受**,§1-7(筆數與行號**只在 §1-7 一處**,此處不複製 —— R3-F2) |
| M8 | 必填欄不強迫 consumer 讀 ⇒ v1 宣稱說太滿 | **接受**,改寫宣稱;真守門移交 2b 硬前置(§1-2) |
| M9 | L6 豁免是新業務規則、非機械沿用 | **接受且反轉 v1**:改成**不豁免**(保守側、零 code),標為 2b 決策題 |
| n1 | 前提格被「恰一處」涵蓋、與「一突變只紅一格」矛盾 | **接受**,拿掉前提格 |
| n2 | migration 行號錯 | **接受**,實查更正為 `:179` / `:189` |
| n3 | adapter 行號錯 | **接受**,實查更正為 `:505-507`(產品理由)/ `:508-513`(`or=` 技術理由)/ `:514-518`(供應商豁免) |

### R2 findings 對帳(6 must-fix + 3 nit;R1 那 12 條 R2 未再提 = 確認關閉)

| # | finding | 處置 |
|---|---|---|
| R2-M1 | 2b 用 `?q=` 會把 PII 放進 URL,推翻 #347-1 的主要設計理由 | **接受,且是本輪最重的一條**。v2 那句「加一個 `q` param」直接刪掉、改列成決策題 **Q-a**(§0-1,推薦 B=POST/server action)。2a 零影響 |
| R2-M2 | 「不豁免 L6」也會靜默漏單(精準命中的單剛好是 tappay×unpaid → 0 筆無提示) | **接受**。保守側維持,但補上 **2b 硬前置的零結果提示**(§1-5 ⑥);用條件式措辭避免為一句提示多掃一次全表 |
| R2-M3 | `toEqual` 不是 6 處 | **接受**。最終由**實跑**定案為 **7 處**(我 v1 說 6、v3 說 8 都錯,R2 說的 7 才對)⇒ 見 §1-7,其他地方一律不複製這個數字 |
| R2-M4 | `OrderKeywordSearchShapeError` 用了卻沒定義/匯出 | **接受**,§1-1 定義 + §1-4 匯出 |
| R2-M5 | 抽共用 cap ⇒ 未來改值時 production 與測試一起漂綠 | **接受**,加獨立釘值格 `toBe(100)` + 錯誤訊息指回 URL byte 預算(§1-5) |
| R2-M6 | 「DB 前置已滿足」宣稱過大;未量的 `statement_timeout` 該當 2b 開 flag 硬閘 | **接受**,§3 收窄宣稱 + 列為決策題 **Q-c** |
| R2-n1 | 落單代理的真正失敗點是 PG 解 JSON,不是 fetch 送無效 UTF-8 | **接受**,守門不變、理由改寫成事實 |
| R2-n2 | `strpos` 行號錯 | **接受**,更正為理由 `:76-86` / 實作 `:208-250` |
| R2-n3 | 「全樹恰一處」與「六根掃描」自相矛盾 | **接受**,措辭改「六個掃描根之內」 |

### R3 findings 對帳(換模型換角度 = Fable;3 must-fix + 3 nit,與 R1/R2 零重疊)

> 🔴 R3 換模型第 4 次證明必要:前兩輪(同一模型)共 15 條 must-fix,**沒有一條**碰到下面這三個面。

| # | finding | 處置 |
|---|---|---|
| R3-F1 | I/O 先後順序沒釘死 ⇒ 兩種合法實作在「關鍵字 truncated + 供應商零命中」下行為不同,且各自的測試都全綠 | **接受**。§1-5 釘死「關鍵字 RPC 排在供應商 probe 之前」+「早退也要帶出已知的 truncated」+ 明寫「供應商超限但關鍵字零命中 ⇒ 回零筆不擲錯」 |
| R3-F2 | §3 與 §5 仍寫「6 處」= stale 字面(在修 R2-M3 的同一版裡復發) | **接受**。數字**只留 §1-7 一處**,其餘指過去。這條抓的是我自己的老病(memory `feedback_claimed-sync-but-only-patched-touched-lines`) |
| R3-F3 | 零筆的三種成因回傳同形 ⇒ 災難當天不可診斷,而唯一合法觀測物(非 PII 計數)adapter 手上就有卻丟掉 | **接受**,加 `keywordMatchCount: number \| null`(§1-2)。現在放比 347-3 再放便宜一整輪 |
| R3-n1 | POST-only 守門第 4 格仍寫「全樹」(R2-n3 只修了第 1 格)+ 剝註解那半是正確性前提 | **接受**,措辭改齊 + 把「必須照抄剝行註解」寫成施工提醒 |
| R3-n2 | 關鍵字 + 供應商單號**併用**時,關鍵字搭上既有豁免的便車 ⇒ 同一張單「單搜被藏、併搜出現」 | **接受**,併進決策題 Q-b(§0-1),不由本片默默決定 |
| R3-n3 | 兩個測試 double(裸 `vi.fn()` / 雙重 cast)不會因新必填欄轉紅 | **接受**,寫進 §1-7 的施工提醒 |
