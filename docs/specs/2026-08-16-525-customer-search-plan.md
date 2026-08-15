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

---

## 9. 🔴 已知守門缺口(D 窗突變輪 18/26 發,2026-08-16)

> **這一節不是待辦清單,是【本片的守門【不】保證什麼】的宣告。**
> `scripts/525-verify.sh` 目前 `PASS=33 FAIL=0`,而**下面三格【永遠不會紅】** ——
> 它們在畫面上與其他 30 格長得一模一樣。

### 🔴🔴 D03 `排序穩定(兩次相同)` —— **它比的是自己**
```sql
-- scripts/525-verify.sh 目前的寫法（同一句 SQL 裡，函式與自己比）
select (admin_search_customers('example',3)->'ids') = (admin_search_customers('example',3)->'ids')
```
**同 args、同交易、同計畫 ⇒ 必然相同 ⇒ `f(x) = f(x)` 恆真。**

🔴🔴 **而那格的註解逐字宣稱「`array_agg` 沒有 `ORDER BY` 時這格會飄」——
D 窗用突變證偽了:拿掉 `array_agg` 的 `ORDER BY`,那格照樣綠。**

⚠️ **而那個 `ORDER BY` 是 codex R2 must-fix 6 逼出來的修法。**
⇒ **一個【被審查逼出來的修法】,配了一個【證明不了它的守門】,而兩者緊鄰、看起來相互印證。**

**病根(D 窗逐字)**:**驗的是【穩定性】不是【正確性】—— 順序錯了,兩次也會一樣錯。**
**修法**:比**實際序列**對上一個**獨立算出的期望序列**,不要比「兩次呼叫相不相等」。

🔴 **這是本片「註解宣稱強度 > 實際斷言強度」的第五個實例**
(前四:E 的逐筆相等 / H 的表達式逐字 / D·F 的 `{ids,truncated}` / 裸 `✅` 那個符號)。
📎 memory `feedback_comment-states-intent-assertion-states-capability`。

### 🔴 D04 `硬夾 100` —— fixture 撐不起來
`migration` 明文「`p_limit` 硬夾 100」。D 窗突變成夾 999 ⇒ **零格紅**:
`p_limit=200` 時 baseline 與 mutated **都是 `truncated=false`**,因為 **fixture 只有 6 筆,分不出來**。
**修法**:fixture 要能撐過 100 筆(**不用真的 100 位客人,塞 101 筆假資料即可**)。

### 🔴 B03 電話軸正規化零覆蓋
`migration` 明文「去掉非數字後比對 ⇒ `0912-345-678` 與 `0912345678` 互相搜得到」。
突變 `v_num_like := v_txt` ⇒ **零格紅**。
**為什麼**:電話軸的 chk **只餵純數字 `0912345678`** ⇒ 該輸入下 `v_num == v_txt` **恆等,突變無差別**;
而「搜 `-`」那格的整體結果由姓名/Email 軸決定,也分不出來。
**修法**:加一格餵**帶連字號**的輸入 —— `chk "電話軸正規化:0912-345 命中" "1" …`

### 三格的**共同形狀**:都是**測資問題**,不是邏輯問題
```
B03  chk 只用純數字        ⇒ 兩條路徑在該輸入下恆等
D03  檢查形狀 f(x) = f(x)  ⇒ 恆真
D04  fixture 只有 6 筆     ⇒ 撐不起 >100 的斷言
```
🔴 **共同判別句(D 窗給的)**:**這一格能不能構造出一個讓它紅的【輸入】?**
**三格答案都是「用現有 fixture 不能」** —— 而**它們看起來與其他 30 格一模一樣。**

### ✅ 而 fail-open 那條防線,D 窗證實是紮實的
```
C01/C02/C03 逐軸打掉 ⇒ 各紅對應那格（C03 只紅它自己一格 ⇒ 判別力最乾淨）
C04 拿掉數字軸的 WHERE v_num <> '' ⇒ 9 格紅，含兩格【專守 fail-open】的
```
⇒ **R2 折的那些不是白折的。**

### ⚠️ 為什麼現在不修
**D 窗仍在跑(G 組 3 + A 組 5 未跑),那兩支檔【凍結中】。**
🔴 **中途改會讓它後面每一發都在測一個與前面不同的東西,報告會混著兩個版本。**
⇒ **等它整輪跑完、通知解凍,三格一起補。**
