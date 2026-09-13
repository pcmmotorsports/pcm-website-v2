# plan:發票抬頭 / 統編可改 + `admin_audit_log` 留痕(鐵則 8;零實作)

> **狀態**:待 Sean 批。本檔只有 .md,零碼、零 migration。
> **上游**:`~/pcm-mailbox/0912-後台UX/規格-發票登記統編抬頭可改-v2.md` §2。
> **它擋著什麼**:發票小抄的最後一塊 —— 抬頭 / 統編可改、查抬頭鈕、fail-open 驗收
> (`0b0b97cee` 的彈窗本體刻意把那兩格做成 `readOnly`、不掛鈕,理由寫在那支檔頭)。
> **現況以 `origin/dev` = `c97d77a50` 為準**,行號都對過。

---

## 0. 🔴 先答主視窗的第一題:「是不是走既有那條路就好, 根本不用新 RPC?」

**答:是, 走既有那支 `admin_update_order_workflow` —— 但它【不是】「既有 action 多兩欄」那麼小。**

| 主視窗問的 | 實查 |
|---|---|
| 既有 action 今天寫哪三格 | `updateOrderWorkflowAction` → RPC `admin_update_order_workflow`,白名單逐字 `['shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status']`(`20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:231-233`) |
| 抬頭 / 統編是不是同型的欄 | 🔴 **不是。** 那四個都是 `orders` 的**標量欄**;抬頭 / 統編是 **`orders.invoice` 這一欄 jsonb 裡的兩個 key**(`invoice->>'title'` / `invoice->>'taxId'`) |
| RPC 有沒有碰過 `invoice` 那一欄 | 🔴 **沒有。** SET 清單「字面恰 4 業務欄+version+updated_at」(同檔 `:334` 逐字),`invoice` 從來不在裡面 |

⇒ 📌 **形狀是「既有 RPC 出新一代、多一條 SET 與兩個白名單 key」**,不是新 RPC、也不是只改 TS。
⇒ 而**它仍然是一支 migration**:改 `SECURITY DEFINER` 函式、碰 `orders` 寫入、碰 audit ⇒ 鐵則 8 + 鐵則 12 都成立。

🔵 **不另開 RPC 的理由**(不是省事):
- 樂觀鎖 `version`、鎖列讀 before、同交易 audit、NOOP 拒、白名單 —— **五件事那支已經做對了**(檔頭 `:29-32` 列的設計,orders 那支的實作在 `:327-348`),另開一支 = 五件事再寫一遍 = 第二份實作。
- 彈窗下塊那張 `<form>` 已經在送這支(`invoice-cheatsheet-panel.tsx`);抬頭 / 統編搬進同一張 form ⇒ **一次送、一個 version、一列 audit**。分兩支 RPC 就是兩個 version 比對、兩列 audit、一個「先改抬頭再改號碼, 第二發 CONFLICT」的坑。

---

## 1. 改什麼

### 1.1 DB:`admin_update_order_workflow` 第 3 代(新 migration)

| 項 | 改法 | 依據 |
|---|---|---|
| 白名單 | `v_allowed_keys` 加 `'invoice_title'`、`'invoice_tax_id'`(**patch key 用底線名**,與 TS 常數 `MANUAL_ORDER_INVOICE_TITLE_FIELD = 'invoice_title'` / `..._TAX_ID_FIELD = 'invoice_tax_id'` 同字面,`manual-order-form.ts:121-122`) | 規格 §2「兩格直接用同一組 name」 |
| 讀 before | `v_invoice := v_cur.invoice`(整包 jsonb) | 規格 §2「before 要存**完整 jsonb**」 |
| 套 patch | `v_invoice := jsonb_set(...)` 兩個 key;**空字串 ⇒ 移除該 key**(不是存 `""`),見 §3-Q1 | CHECK `orders_invoice_whitelist` 要求值皆 string;空字串合法但語意是「沒填」 |
| `type` 推導 | 🔴 **待 Sean 答 §3-Q1** —— 規格說「兩格都有值 ⇒ company」,**反向與 donate 那一格規格沒寫** | — |
| 驗證 | `taxId` 8 碼數字(既有 `manual-order-form.ts` 對統編的規則,抄同一條);`title` 非空時 ≤ 100 碼位、無控制字元(抄 `invoice_number` 那段 `:296-298` 的形狀) | 同檔既有慣例 |
| SET | 多一行 `invoice = v_invoice`;**其餘凍結欄一個字不動**(那條紀律 `:334`) | — |
| NOOP | `v_invoice IS NOT DISTINCT FROM v_cur.invoice` 併進既有的 no-op 判斷(`:327-330`) | 既有 |
| audit | `before` / `after` 各多一個 key `'invoice'`,值是**整包 jsonb**(不是只放 title / taxId) | 規格 §2「客人原本填的永遠還原得出來(不加欄、不加表)」 |
| 🔴 `search_path` | 新一代**必須寫 `SET search_path = ''`**,並把函式體裡所有物件加 `public.` / `pg_catalog.` 前綴 | `scripts/definer-search-path-gate.py` 對**新檔**判紅;而 **`CREATE OR REPLACE` 會把 SET 子句整組換掉**(memory `reference_create-or-replace-resets-set-clause`)⇒ 第 2 代的 `public, pg_temp` 不會自己留下來 |

🔴 **`search_path` 那一格的射程要講清楚**:第 2 代是 `public, pg_temp`(`:227`),全樹還有 67 支同樣形狀(閘的檔頭 `:18`),閘**只擋新檔**。本片出第 3 代 = 新檔 ⇒ 會被擋 ⇒ **必須**改成 `''`。
⇒ 改了之後函式體裡任何**沒加 schema 前綴**的引用都會在執行期找不到 —— 第 2 代裡 `public.orders%ROWTYPE` 有前綴、`pg_catalog.jsonb_*` 有前綴,**要逐行核一次**,不是「應該都有」。
⇒ 📌 這是本片**最容易全綠而線上炸**的一格:typecheck / lint / 測試都不跑 plpgsql。**唯一的守門是拋棄式 PG 上真的呼叫一次。**

### 1.2 TS(四處,少一處就「送了而沒寫進去」)

| # | 檔 | 改法 |
|---|---|---|
| ① | `apps/admin/src/lib/orders/workflow-form.ts:164-171` `WORKFLOW_SINGLE_FIELDS` | 加 `MANUAL_ORDER_INVOICE_TITLE_FIELD`、`..._TAX_ID_FIELD`(**引常數**,不打字串) |
| ② | 同檔 `parseWorkflowPatchForm` | 兩欄:「未提供 = 不放進 patch」照既有語意(`:181`);提供則 trim 後放進 patch(空字串 ⇒ 送 `null` = 清空,對齊 `invoice_number` 那條) |
| ③ | `packages/domain/src/order/types.ts:829` `AdminOrderWorkflowPatch` | 加 `invoiceTitle?: string \| null`、`invoiceTaxId?: string \| null` |
| ④ | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:1795` 組 `p_patch` | 兩個 key 對到 `invoice_title` / `invoice_tax_id` |
| ⑤ | `apps/admin/src/lib/audit/audit-field-label.ts:122-124` 附近 | 加 `invoice: '發票抬頭與統編'`(見 §2) |
| ⑥ | `invoice-cheatsheet-panel.tsx` | 抬頭 / 統編兩格**搬進下塊 `<form>`**、拿掉 `readOnly`、掛 `<InvoiceTitleLookupButton />`(那顆鈕靠 `closest('form')` 找輸入框,**在 form 外掛了也找不到** —— 這正是 `0b0b97cee` 沒掛的理由之一) |

⚠️ ⑥ 的版面要回頭對稿:稿上抬頭 / 統編在**上塊**(`cheatTi`),而鈕要在 form 內 ⇒ **要嘛整個上塊包進 form、要嘛把兩格移到下塊**。前者讓「唯讀區」變成表單的一部分(三個數仍是 `<dl>` 不會被送),後者違稿。**推前者**,而那是設計窗要看一眼的事 —— 列進 §3-Q3。

### 1.3 測試(先紅後綠那幾格)

- `audit-field-label.test.ts` 集合比對:**加了 key 沒加中文會紅**(主視窗說我在備註那片踩過同一道)⇒ 先跑一次確認它紅在 `invoice`。
- `workflow-form.test.ts:319` 那組欄名 ↔ patch 鍵的表:加兩列。
- RPC 側:拋棄式 PG(`scripts/admin-probe/up.sh` 並行埠)上跑
  ① 只改抬頭 ⇒ `UPDATED`、`invoice.title` 變、**其餘四欄 byte 不變**、audit 一列且 `before.invoice` 是**整包**
  ② version 錯 ⇒ `CONFLICT`、零寫入
  ③ patch 與 before 相等 ⇒ `NOOP`、不 bump、不 audit
  ④ `taxId` 7 碼 ⇒ RAISE、零寫入
  ⑤ `type='donate'` 的單改統編 ⇒ 依 §3-Q1 的答案(RAISE 或允許)
  ⑥ 🔴 **`search_path = ''` 之後函式**真的跑得完**(不是「看起來都有前綴」)
- 🔴 **查抬頭鈕的 fail-open**(主視窗硬線 3,逐字寫死):
  把 `invoice-title-source-gcis.ts` 的來源指到一個**一定失敗**的網址 ⇒ 按鈕 ⇒ 得到「查不到,請自己打」⇒ **自己打抬頭 ⇒ 送出 ⇒ `UPDATED`、`invoice.title` = 他打的字**。
  🛑 **這一格要先紅過一次再接線** —— 它若沒紅過,表示沒真的驗過。

---

## 2. 🔴 主視窗硬線 4:「不儲存查詢結果」與「儲存員工填的」是兩件事

Sean 2026-09-10 拍(memory `project_0910-tax-id-lookup-no-attribution`):**查完即用、不落我們的資料庫、顯名標示不加。**

那一拍的受詞是 **API 的回應**(GCIS 回來的那串字)。本片存的是 **`orders.invoice.title` —— 員工按下「確認」時輸入框裡的字**。兩者的關係:

```
API 回應 ──(鈕寫進 input.value)──▶ 輸入框 ──(員工可改 / 可整個重打)──▶ 送出 ──▶ orders.invoice.title
          ↑ 不落庫的是這一段                                             ↑ 存的是這一格
```

⇒ 📌 **存 `invoice.title` 不違反那一拍**:存的是「員工確認要開在發票上的抬頭」,而那本來就是這張單的資料(客人結帳時就填了,`orders.invoice` 一直有它)。API 只是幫他少打幾個字。
⇒ 🛑 **而不可以做的是**:把 GCIS 的原始回應另外存一欄、或存「這個抬頭是查來的」這種來源標記。本片**都不做**。
⇒ audit 的 `before` / `after` 存的也是 `orders.invoice` 的值,不是 API 回應 —— 同一條線。

**中文字典**(硬線 2,只套後台文案原則第 ③ 條 —— 短名詞,不辯解):
- `invoice` ⇒ **「發票抬頭與統編」**
  🔵 為什麼是一個 key 不是兩個:audit 存的是整包 jsonb(§1.1),diff 那一層看到的 key 是 `invoice`。拆成 `invoice.title` / `invoice.taxId` 兩個 label 要改 `audit-diff` 走進 jsonb —— 那是另一件事,本片不做。
  ⚠️ 代價:稽核頁上會看到「發票抬頭與統編:{整包} → {整包}」,而不是「抬頭:A → B」。**這一格要問 Sean 接不接受**(§3-Q4)。

---

## 3. 要 Sean 答的(答完才動)

```
Q1: 抬頭 / 統編改了之後, orders.invoice.type 要不要跟著變?
A1: 甲|乙|丙
    甲 = 跟著推:兩格都有值 ⇒ company;兩格都清空 ⇒ personal;donate 的單不准改這兩格(RAISE)。
    乙 = 不動 type:只改 title / taxId, type 是客人結帳時的決定。
    丙 = 只做規格寫的那一半:兩格都有值 ⇒ company;其他情形 type 不動。
    🔵 推甲 —— 乙會出現「type=personal 而有統編」這種自相矛盾的資料(CHECK 擋不住, 它只管鍵名);
       丙是甲的一半, 而少的那一半正是會留矛盾的那一半。
```
```
Q2: 統編查到抬頭之後, 員工改了幾個字再送 —— 存哪一個?
A2: 甲
    甲 = 存輸入框裡的字(員工最後看到並確認的那一版)。
    🔵 這題其實只有一個答案, 列出來是讓「API 回應不落庫」那一拍有一句白紙黑字的邊界(§2)。
```
```
Q3: 抬頭 / 統編兩格要能改 ⇒ 要進 <form>。稿上它們在上塊(唯讀區)。怎麼擺?
A3: 甲|乙
    甲 = 整個上塊包進 form(三個數仍是 <dl>, 不會被送), 版面照稿。
    乙 = 兩格搬到下塊「登記」那一區, 上塊只剩三個數。
    🔵 推甲 —— 照稿;而這是品味題, 設計窗出一版實體看。
```
```
Q4: 稽核頁上這一改會顯示成「發票抬頭與統編:{整包 json} → {整包 json}」, 不是「抬頭:A → B」。接受嗎?
A4: 甲|乙
    甲 = 接受(這一版)。
    乙 = 要拆成兩行 ⇒ audit-diff 要走進 jsonb, 另開一片。
    🔵 推甲 —— 稽核頁是查證用, 整包看得到就查得到;拆行是體驗, 不是正確性。
```

---

## 4. 影響

| 面 | 影響 | 證據 |
|---|---|---|
| 顧客站 | **零** —— `MEMBER_ORDER_DETAIL_SELECT` 刻意不帶 `invoice`(`SupabaseOrderAdapter.ts:165-169` 逐字列在「少掉三類」的 ②) | 讀過 |
| 後台列表 | 零 —— 列表不讀 `invoice` 的 title / taxId | `admin_order_list_v` 第 44 欄是 `price_tax_mode`,無 invoice 子欄 |
| 既有改單表單 `order-edit-form.tsx` | 零 —— 它不送這兩個 key ⇒「未提供 = 不放進 patch」 | `workflow-form.ts:181` |
| 手動建單 | 零 —— 它走 `admin_create_manual_order`,不走這支 | — |
| 稽核頁 | 多一種 key `invoice`;字典不加會**顯示原代碼且 `known=false`**(`audit-field-label.test.ts:155`) | 讀過 |
| RLS / GRANT | 不變 —— `EXECUTE` 僅 `service_role`,ACL 由第 1 代 `20260714130000` 設定、`CREATE OR REPLACE` **保留 ACL**(它換掉的是 SET 子句,不是 GRANT);第 2 代自己**沒有**重宣告 REVOKE/GRANT,只用事後閘斷言(`:378-390` `has_function_privilege`)⇒ 第 3 代照同一個形狀:**不重宣告、事後閘斷言** | 讀過,`grep REVOKE` 在 `:217` 之後零命中 |

🔴 **搜尋 / 快取**:`orders.invoice` 沒有任何索引或 view 依賴(grep `invoice->>` 在 migrations 裡只有 CHECK 本身)⇒ 改值不觸發別的東西。**這句是 grep 出來的,不是推的;而 grep 只看得到 repo,看不到正式庫上手建的東西。**

---

## 5. Rollback

🔴 **runbook §0-b ②:repo 裡沒有現成的反向 SQL,人現場寫。** 本片的反向是:

```
把 admin_update_order_workflow 用【第 2 代】的定義 CREATE OR REPLACE 回去
(第 2 代全文 = 20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:217-371,
 含它的 SET search_path = public, pg_temp;ACL 不用動 —— CREATE OR REPLACE 保留)。
```
- **資料不用回**:第 3 代寫進 `orders.invoice` 的值是合法的(CHECK 過),回到第 2 代只是**不能再改**,已改的留著。
- **audit 不用回**:多出來的 `invoice` key 在舊 diff 頁會顯示原代碼(`known=false`),不炸。
- ⚠️ 回退之後**彈窗那兩格要一起回 `readOnly`**,否則變成「按了什麼都沒發生」的鈕 —— 那是 `0b0b97cee` 刻意避開的形狀。

---

## 6. 驗收(yes/no)

1. 拋棄式 PG:§1.3 ①–⑥ 六格,**每格一行 SQL 一個讀數**。
2. `audit-field-label.test.ts` 先紅在 `invoice` 再綠。
3. 🔴 fail-open:來源指到一定失敗的網址 ⇒ 自己打 ⇒ 存得進去。**先紅過一次。**
4. 統編 7 碼 ⇒ 表單擋、**不打 API**(規格 §6-4)。
5. 手動建單那頁的查抬頭**行為不變**(規格 §6-8;同一顆鈕、同一組 name)。
6. `exclusive` 真單 —— **Sean 2026-09-13 裁:等全部新版上線後他自己在正式後台試。合成資料不替代。**
7. 🔴 codex 一輪(鐵則 12:碰 `orders` 寫入 + audit + SECURITY DEFINER)。切入角:「哪一條輸入會讓 `orders.invoice` 存進一個 CHECK 過而語意矛盾的值」+「`search_path=''` 之後哪一個引用會找不到」。

---

## 7. 不做(這一版)

載具 / 愛心碼可改 · 畫面並列「客人原本填的」· 更正鏈 · 從客戶資料簿帶入 · audit-diff 走進 jsonb(§3-Q4 乙) · 存 API 回應或來源標記(§2)。

— END —
