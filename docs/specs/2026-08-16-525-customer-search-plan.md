# `#525` 後台客戶搜尋 — plan(C 窗,2026-08-16)

> **狀態:未批准、零 code。** 中鐵則 8(跨 `domain` / `adapters` / `apps/admin`,7+ 支檔)。
> Sean 2026-08-16 已明示**搜尋屬「基本功能、不用問要不要做」** ⇒ **本檔要批的是【做法】,不是【要不要做】。**
> 🔴 §2 有一個**會改變整個做法**的發現,先讀那節。

## 0. 這不是漏做,是知情留下的 follow-up

`packages/domain/src/identity/types.ts:40` 逐字:
> 「v1 只 `tier` 軸(依會員等級找經銷 / 一般客);**free-text 姓名 / email 搜尋留 follow-up**。」

⇒ **本片就是那個 follow-up。** ⚠️ **實作時要把那行註解一起更新** —— 前件改了,後件不會自己翻。

## 1. 要做什麼

客戶列表加關鍵字搜尋:**姓名 / 電話 / Email**。
🔴 **必須走 `customers` 表,不得走 `orders` join** —— `#525` 的尖角正是「零訂單的客人在 orders join 上完全不存在」。

## 2. 🔴🔴 核心發現:照抄訂單側會**重建一個被刻意刪掉的威脅面**

訂單搜尋沒有字元集守門,而 `packages/domain/src/order/keyword-search.ts:20-28` 逐字寫明**那不是疏漏**:

> 本維度走 `.rpc()` = **POST + JSON body** ⇒ 搜尋詞**不進 URL、不進 filter 語法、不參與任何字串拼接**。
> …原本另有兩個維度各自有字元集守門,**兩者的理由完全相同且只有一個**:那兩個值會被
> **內插進 PostgREST 的 GET query string**(`.or()` 是字串內插)⇒ **值裡的字元會改變 filter 的結構**。
> 那兩支模組已隨 `Q-347-B1=B` 整支刪除 —— **守門與它守的威脅面一起消失。**

🔴 **而客戶搜尋若用 `.or('name.ilike.*X*,phone.ilike.*X*,email.ilike.*X*')`,X 就回到 GET query string 裡**
⇒ **那個被刪掉的威脅面會被我親手裝回來,而守門已經不在了。**
⚠️ **這是同一個檔案在事前寫給我看的警告**,不是我推的。

**⇒ 三條路,代價不同:**

| | 做法 | 威脅面 | migration | 中文/標點可搜 |
|---|---|---|---|---|
| **甲** | 建 `admin_search_customers` RPC(POST body) | ✅ 無(同訂單側) | 🔴 **要** ⇒ 中鐵則 12③ | ✅ 全可搜 |
| **乙** | `.or()` + **重寫字元集守門** | ⚠️ 有,靠守門擋 | ✅ 不用 | 🔴 **中文姓名會被守門擋掉 = 功能廢一半** |
| **丙** | `.or()` + 對值做 PostgREST 逃逸 | ⚠️ 有,靠逃逸正確性 | ✅ 不用 | ⚠️ 未查逃逸規則是否完備 |

🔴 **乙直接出局**:員工要搜的正是**中文姓名** —— 那個檔逐字寫著「照抄字元集守門 = 把功能廢掉一半」。
🔴 **甲乙丙我不挑** —— 甲要 migration(中鐵則 12③、要 Sean 批),丙的安全性我**沒查證**。**這是決策題,見 §5。**

## 3. 要改幾層(以甲案計)

```
packages/domain/src/identity/types.ts       AdminCustomerFilter +keyword、且更新 :40 那行過期註解
packages/domain/src/…/keyword-search.ts     正規化：可否直接共用 normalizeOrderKeywordSearch？
                                            ⚠️ 名字綁 Order、docstring 綁 RPC 合約 ⇒ 共用會讓那份 docstring 對客戶側說謊
packages/adapters/src/supabase/SupabaseCustomerAdapter.ts   查詢（143 行）
apps/admin/src/lib/customers/customer-keyword-cookie.ts     🆕 抄 lib/orders/order-keyword-cookie.ts（87 行）
apps/admin/src/lib/customers/keyword-search-action.ts       🆕 抄 lib/orders/keyword-search-action.ts
apps/admin/src/components/customers/customer-filter-bar.tsx 加搜尋框
apps/admin/src/app/customers/page.tsx                       讀 cookie
+ 測試（單元 / 頁級 / 接線）
```
⇒ **7+ 支、跨三個 package ⇒ 鐵則 8 中標**,故本檔存在。

## 4. PII 紅線:**不得自己發明,照抄訂單側**

`lib/orders/order-keyword-cookie.ts:8-11` 逐字:
> 「搜尋詞是 PII…**『搜尋詞不進 URL』是 347-1 與 A13b 兩線立起來的全站紅線**;
> 把它放回 query string = 親手推翻一小時前才上線的防護。」

**必抄的四件**(每件都有現成實作與理由,不重新設計):
1. **cookie 當載體**(不是 URL)—— 否則翻頁時搜尋詞消失、列表**靜默變回全部**(fail-open)
2. **fail-closed 三道閘**:解碼失敗 / 超長 / 正規化不 ok ⇒ 一律當沒搜尋(cookie 是使用者可竄改的輸入)
3. **POST + PRG**:搜尋詞不進 URL ⇒ 表單必須 POST;POST 後必 redirect(否則 F5 重送)
4. **清除搜尋走同一支 action**(送空字串),不做前端捷徑 —— 否則生出第二條沒人守的路徑
⚠️ **一併繼承已認列的缺陷**:cookie 跨分頁共用 ⇒ 兩個分頁各搜各的會互相蓋掉;
緩解 = 列表**常駐顯示「目前搜尋:XXX ✕」**。**這條要照抄,不是可選的美化。**
🔴 **搜尋詞絕不落 log**(那兩支檔連 `console.error` 都沒有,是刻意的)。

## 5. 🔴 決策題

```
Q-525-1  客戶搜尋走哪條路？（§2 的威脅面決定，不是效能）
A: 甲|丙|丁

甲　建 admin_search_customers RPC（POST body，同訂單側）
　　✅ 零威脅面、中文全可搜、與訂單側同形狀
　　🔴 要 migration ⇒ 中鐵則 12③ ⇒ 這一步要 Sean 批
丙　.or() + 對搜尋詞做 PostgREST 逃逸
　　✅ 不用 migration，今晚就能做完
　　⚠️ 逃逸規則是否完備我【沒查證】；且與訂單側形狀分岔（兩套搜尋兩種寫法）
丁　我沒想到的
```
⚠️ **乙(重寫字元集守門)已由 §2 排除,不列入選項** —— 它會擋掉中文姓名。

## 6. 我的判斷(要 Sean/主視窗核,不是我拍)

**搜「@line.pcmmotorsports.local」應該搜得到。** 理由三條:
1. 那串仍然是那位客人的**登入帳號**;藏起來是為了**畫面不要顯示雜訊**,不是為了讓紀錄找不到
2. 員工手上會有那串的唯一來源是**後台以外**(Supabase 後台、錯誤紀錄、LINE 客服)——
   而那種時候他**正需要**用它反查是誰
3. 走 `customers.email` 的子字串比對**天然就會命中**,**擋掉反而要多寫程式**
⚠️ **代價照實寫**:搜到之後 Email 欄顯示的是「LINE 帳號登入,無 Email」
⇒ **搜 X 卻看不到 X**,員工可能懷疑搜錯。**這條要不要在 UI 講,是文案題。**

## 7. 驗收(量法先寫死)

1. **零訂單的客人搜得到** —— 🔴 本片存在的理由,**必須有一格拿零訂單 fixture 釘死**
2. **三軸各一格**:姓名 / 電話 / Email 各自能命中(**正向對照**:不相關的詞搜不到)
3. **PII 紅線四格**:搜尋詞不出現在 URL / cookie fail-closed 三道閘各一格
4. **翻頁不掉搜尋詞** —— 那是 cookie 當載體的**唯一理由**,沒這格等於沒驗到動機
5. **突變三發、事前指名預期紅格**:①拿掉 cookie 讀取 ②把載體改回 URL ③把查詢改回只有 tier
6. 🔴 **禁用「mock adapter 回固定結果」當唯一證據** —— 那只證明 UI 會畫,不證明查詢條件對

## 8. 我沒查的

- **丙案的 PostgREST 逃逸規則是否完備** —— 未查。**這是選丙之前必須先關的缺口。**
- **`normalizeOrderKeywordSearch` 可否直接共用** —— 函式本體看起來通用(長度 / NUL / 落單代理),
  但**名字與 docstring 綁死訂單 RPC 合約** ⇒ 共用會讓那份 docstring 對客戶側說謊。**未定。**
- **效能**:`customers` 表三欄子字串比對,現有 11 列量不出東西;**索引要不要建,未查。**
- **搜尋結果的分頁與 `count: 'exact'` 如何與搜尋條件共存** —— 未查。
