# 客戶列表排序(A 案:基本欄) — slice plan

> **日期** 2026-08-16 · **窗** C(客人線)· **派工** 主視窗 `Q1=A / Q2=A`
> **片型** 標準片(不碰 schema、不碰 `packages/ui`、不碰金流權限)
> **內容分級** L1(排序規則是程式行為,不是內容;年 0-1 次變動)

---

## 0. 🔴 先講三件會讓讀者誤判範圍的事

### 0.1 這不是「補齊」,是**新建一套** —— 全 admin 目前零排序
```
apps/admin/src/components/orders/orders-table.tsx:501-520   <th> 全純文字，零可點元素
apps/admin/src/components/settings/supplier-table.tsx        「sort/排序」零命中
products 列表                                                 同上
```
全樹 `.order()` 只有兩種寫死形狀:
```
SupabaseCustomerAdapter.ts:253   .order('created_at', { ascending: false })
SupabaseOrderAdapter.ts:736-737  .order('created_at', desc).order('id', desc)
```
⇒ **沒有可抄的既有形狀。** 派工原本寫「照抄訂單頁」,**開檔後不成立**,已回報並改派。

### 0.2 🔴 A 窗那三欄(訂單數 / 消費金額 / 最後下單)**這一片不做,而且理由不是排程**
`3b415ae4`(branch `void-readers`,**尚未 merge、尚未 apply**)建的
`admin_customer_list_v`,三個新欄一律是**純量子查詢**,而它自己的契約逐字寫著:
> 「**不得 `GROUP BY`、不得 `DISTINCT`、不得 join 到 `orders`** —— 三個新欄一律純量子查詢。」

🔴 **後果:那三欄【排不動】。** 純量子查詢是**每一列現算**的
⇒ **沒有任何索引幫得上排序** ⇒ 要排就得先替**全部**客戶算完三個子查詢、再排、再取 20 筆。
**11 位無感;3000 位時每次翻頁把 `orders` 掃三遍。**

⚠️ **這不是類比,是同一個庫量過的形狀**:memory
`reference_supabase-anon-rpc-verify-generic-plan-timeout` 實測
**同表同 149k 列,窄索引 22.9ms vs 寬索引 + merge join 2,995ms = 130 倍**
⇒ 「反正有快取」不成立。

⇒ **三欄排序另開一片,而且它的第一題是「要不要把那三欄落成實體欄 + trigger」(動 schema,鐵則 12③),
不是「加一個 `.order()`」。**

### 0.3 🔴🔴 本片最大的坑:**排序會弄壞分頁,而它在現有資料量上【測不出來】**
`SupabaseOrderAdapter.ts:737` 有一條用血換來的註解:
```
.order('id', { ascending: false })   // 次鍵防同秒單分頁跨頁重複/漏單(Fable D-2 verdict n1)
```
**排序鍵若不唯一,`range(offset, offset+n-1)` 的分頁會【跨頁重複或漏資料】** ——
因為 PostgreSQL 對「排序鍵相同的列之間的順序」**不做保證**,兩次查詢可以給出不同順序。

🔴 **而排序一旦交給員工選,最糟的情況正好是他會選的那些**:
```
會員等級  只有 3 個值（general / store / premiumStore）
3000 位客人 ⇒ 平均每個值 1000 列全部同鍵 ⇒ 【每一頁的內容都可能在翻頁時洗牌】
```
⚠️⚠️ **這一段是寫給下一個人的,不是寫給我們的**:
**本專案現在只有 11 位客戶 ⇒ 一頁裝得下 ⇒ 這個病【現在不會發作,也測不出來】。**
**不要因為「上線後沒人回報」就以為它不存在。**

---

## 1. 目標(可 yes/no 驗收)

1. 客戶列表的**姓名 / 註冊日期 / 會員等級**三個表頭可點,點了會依該欄排序、再點反向。
2. 排序狀態走 **URL query**(可分享、可重整、可回上一頁)。
3. 🔴 **任何排序都強制附唯一次鍵**,由**機制**保證,不是靠人記得。
4. 目前排序在表頭上**看得出來**(不是只有網址知道)。
5. 排序與**會員等級篩選、關鍵字搜尋、分頁**三者共存,互不洗掉。

---

## 2. 🔴 為什麼排序走 URL、而搜尋詞走 cookie(**刻意不同,理由要寫進 code**)

| | 搜尋詞 | 排序 |
|---|---|---|
| 是不是 PII | 🔴 **是**(客人姓名/Email/電話) | ❌ 否(`name` / `created_at` / `tier` 這種欄名) |
| 進不進 URL | **絕對不進**(會落 access log / CDN log / 歷史 / Referer) | **進**,而且是優點 |
| 載體 | httpOnly cookie + POST + PRG | URL query,一般 `<Link>` |

⚠️ **這個不一致【必須】寫進 code 註解** —— 否則下一個人會看到「同一頁兩種做法」而去「統一」它,
而**統一的方向若是「排序也走 cookie」會失去可分享性;若是「搜尋也走 URL」會洩 PII。**
🔴 **後者是紅線。**

---

## 3. 要改什麼(座標皆開檔驗過)

### 3.1 `apps/admin/src/lib/customers/customer-list-view.ts`
- 新增 `SORT_PARAM = 'sort'`、`DIR_PARAM = 'dir'`
- 新增 `CUSTOMER_SORT_KEYS`(白名單,**只有三個**)與 `AdminCustomerSort` 型別
- `parseCustomerListSearchParams`(`:85`)多回一個 `sort`
  —— 用既有的 `pickEnum`(`shared/list-params.ts:15`)做白名單,**不認得的值退回預設,不擲錯**
- `buildCustomerListHref`(`:96`)把 `sort`/`dir` 一起帶上
  —— 🔴 **它是 PRG 的 `return_to` 來源** ⇒ 排序狀態才不會被「搜尋一次」洗掉
- ⚠️ **同步**:`keyword-search-action.ts` 的 `safeListReturnTo` 白名單目前是
  `{TIER_PARAM, 'page', 'r'}` ⇒ **要加 `sort` / `dir`,否則帶排序時搜尋會被打回 `/customers`**
  (那個白名單是 `#525` codex must-fix 加的,**不能為了方便就放寬成「只驗前綴」**)

### 3.2 `packages/domain/src/identity/types.ts`
- `AdminCustomerFilter` 旁新增 `AdminCustomerSort = { key: …; ascending: boolean }`
- 🔴 **排序不放進 `AdminCustomerFilter`** —— 篩選是「要哪些列」,排序是「怎麼排」,兩件事;
  混在一起會讓「換排序」看起來像「換篩選」而觸發不必要的重新計數。

### 3.3 `packages/ports/src/ICustomerRepository.ts`
- `listCustomerSummariesForAdmin(filter, pagination)` → 多一個 `sort?: AdminCustomerSort`
- ⚠️ **B 案(共用元件)的擴充點就留在這裡**:型別定義成
  **「一組排序鍵 + 方向」而不是「客戶專用的三個字串」** ⇒ 訂單頁/商品頁日後可以套同一個形狀。

### 3.4 🔴🔴 `packages/adapters/src/supabase/SupabaseCustomerAdapter.ts:253` — **守門在這裡**
```
現況   .order('created_at', { ascending: false })
改成   buildOrderChain(query, sort)   ← 一支【會硬失敗】的建構函式
```
**那支函式的契約**:
- 把使用者選的鍵放第一位
- 🔴 **一律再附 `.order('user_id', …)` 當唯一次鍵**
- 🔴🔴 **若排序鍵集合裡沒有唯一欄 ⇒ `throw`,不是靜默補上**
  —— **靜默補上就沒有人會知道這條規則存在,下一個 adapter 照樣漏。**

---

## 4. 🔴 守門(每格先寫「它紅的時候是因為什麼」)

| 格 | 紅的原因 | 為什麼不能用別的方式驗 |
|---|---|---|
| 排序鍵集合**沒有唯一欄 ⇒ 擲錯** | 有人加了新排序鍵卻忘了次鍵 | 🔴 **這格在 11 筆資料上會紅** —— 它斷言的是**排序鍵集合的組成**,不是「翻頁有沒有洗牌」。塞 3000 筆才驗得到的東西,我們塞不出來也不該塞 |
| 三個鍵各自**真的下推到 `.order()`** | 有人把排序做在 JS 端 | JS 端排序**只排得到當頁 20 筆** ⇒ 3000 位時「排序」只是把當頁洗一洗,而**畫面看起來完全正常**(又一個「假裝成功」) |
| 不認得的 `sort` 值 ⇒ **退回預設、不擲錯** | 有人把白名單改成黑名單 | 使用者手改網址不該看到錯誤頁 |
| `buildCustomerListHref` 帶 `sort` 時,**搜尋的 `return_to` 不被打回** | `safeListReturnTo` 白名單漏加 | 🔴 這條**跨兩個檔**,而症狀是「排序中搜尋 ⇒ 排序不見了」——**很容易被當成「本來就這樣」** |
| 表頭**看得出目前排序** | 只改了網址沒改畫面 | 看不出來的話,員工不知道自己在看什麼順序 |

⚠️ **每格都要跑突變、事前指名預期紅哪一格。**

---

## 5. 不做什麼(明寫,免得被讀成漏做)

- ❌ **不做共用元件**(B 案)—— 跨 3 檔 + 動共用元件 = **鐵則 8,要 Sean 批**,而他手上已有未回的題。
  ✅ **但 API 形狀留給它**(見 3.3)。
- ❌ **不碰 A 窗的 `admin_customer_list_v`** —— 在別的 branch、且**未 apply**,拿它當基礎是空中樓閣。
- ❌ **不做商品頁的「跳頁」**(1017 頁只能一頁一頁按)—— 那是另一條,順手做會讓本片跨檔。
- ❌ **不動 schema、不加索引** —— 三個基本欄的排序成本在現有量級下不需要;
  🔴 **而「需不需要索引」要等有真實量體才量,不憑感覺先加**。

---

## 6. 預期影響面與 rollback

- **影響面**:客戶列表頁 + 其 lib + 客戶 port/adapter/domain 型別。**不影響訂單、商品、storefront。**
- **rollback**:單顆 commit revert 即可 —— **沒有 migration、沒有資料變更、沒有 cookie 變更。**
  ⚠️ **唯一的外部痕跡是網址多了 `?sort=…&dir=…`** ⇒ revert 後舊網址會被白名單擋回預設,**不會壞頁**。

---

## 7. 相關既有紀錄與連動面

- `#525` 客戶搜尋(`docs/specs/2026-08-16-525-customer-search-plan.md`)—— **本片會動到它的 `safeListReturnTo` 白名單**
- `#535` cookie `delete` 未帶 `Path`(已修未 push)—— 無直接連動,但**同一頁**
- `#534` 沒選具名身分 ⇒ 所有寫入靜默失效 —— **排序走 URL 用 `<Link>`(GET)⇒ 不經授權閘 ⇒ 不受 `#534` 影響**
  🔴 **這是走 URL 的一個沒被列進 §2 的附帶好處,值得記下來。**
- `#520` / 商品頁 1017 頁缺跳頁 —— 留給 B 案

---

## 8. 🔴🔴 自我複核:**這片命中鐵則 8,plan 寫完【不能直接開工】**

派工的主視窗判「標準片、不是鐵則 8」。**我照 house 規矩自己再過一次硬清單,結論不同。**

### 8.1 鐵則 8 的「重大」逐字 = **跨 3+ 檔 / 動 schema・API・共用元件**
本片實際要動的檔(§3 逐一開檔驗過):
```
1 apps/admin/src/lib/customers/customer-list-view.ts
2 apps/admin/src/lib/customers/keyword-search-action.ts     ← safeListReturnTo 白名單
3 apps/admin/src/app/customers/page.tsx
4 apps/admin/src/components/customers/customers-table.tsx
5 packages/domain/src/identity/types.ts
6 packages/ports/src/ICustomerRepository.ts                  ← 🔴 port 介面 = 「動 API」
7 packages/adapters/src/supabase/SupabaseCustomerAdapter.ts
```
⇒ **7 檔(≥3)且動 port 介面** ⇒ **兩個獨立條件各自命中。**

### 8.2 🔴 而還有第三個,是我寫 plan 到一半才發現的
客戶表走**共用**的 `components/shared/admin-data-table.tsx`,而它的
`AdminColumn.header` 型別是 **`string`**(`:29`)——
**可點的表頭放不進去。**

**六個表在用它**:customers / staff / supplier / products / audit-log / (元件本體)。

⇒ 兩條路,**都要拍板**:
```
甲  把 header 放寬成 string | ReactNode
    ⚠️ 純加寬、其餘五表照傳字串 ⇒ 行為零變更、風險低
    🔴 但它【就是共用元件】⇒ 鐵則 8 第三次命中

乙  排序控制不放表頭，改成表格上方一個「排序：▾」下拉
    ✅ 完全不碰共用元件
    🔴 但那不是員工預期的排序 UI（大家會去點表頭），
       而「點了沒反應」正是本 session 剛學到的最難察覺的一種故障
```
**我推甲**,理由是**乙會做出一個看起來有排序、而表頭點了沒反應的頁面**。
⚠️ **但我不自己選** —— 甲碰共用元件。

### 8.3 ⇒ **狀態:等 Sean 批,不是等主視窗批**
🔴 **同儕窗的「你現在做」不等於 Sean 批准**(memory `feedback_peer-window-cannot-grant-sean-approval`)。
主視窗判「標準片」我不反對**片型**這個軸 —— **但片型與鐵則 8 是兩個軸**,
CLAUDE.md 逐字:「**僅命中鐵則 8 = 照常提 plan 等批、片型另按前兩級判**」。

**⇒ 本 plan 寫完即停。code 一行都不動,等 Sean 拍甲/乙 + 批准範圍。**
📎 若 Sean 要縮範圍:**§5「不做什麼」已經先把 B 案、A 窗三欄、商品頁跳頁排除**,
這已經是我能給的最小版本;再小就只剩乙案(不碰共用元件)。
