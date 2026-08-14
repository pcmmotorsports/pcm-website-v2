# #25 片 C3(地址 CRUD)前置調查(C 窗 2026-08-14 夜;**零 code、Sean 尚未批 plan**)

> 讀過的檔(6 支):`_address-default.ts` `delete-address.ts` `update-address.ts` `app/account/address/actions.ts`(前 70 行)`lib/orders/procurement-action-state.ts`(前 40 行)`packages/schemas/src/index.ts`(§invoice 段)。
> **未讀**:`add-address.ts` `set-default-address.ts` `InlineAddressForm.tsx`(337 行)`SupabaseAddressAdapter` mapper 內部。

## 1. 🔴 先更正我自己(C-003 信裡的一句話是錯的)

C-003 信我寫 admin 房規是「**零 client JS**、零 zod」。**「零 zod」成立,「零 client JS」是錯的。**
- admin 有 **44 個** client component(數法 `grep -rln "'use client'" apps/admin/src/components apps/admin/src/lib | wc -l`)。
- 且有 `useActionState` 互動表單先例:`components/orders/item-procurement-form.tsx:95`、`refund-exception-resolve.tsx:45,49`、`payment-record-form.tsx`。

病灶:`components/shared/admin-form.tsx:8` 的原句是「**目前零 client JS 的表單**」—— 那句的作用域是 **`<AdminForm>` 的三個消費端**,我把它讀成了整個 admin app。
**這正是「拿一個相鄰的東西當成要問的那個東西」**;信已投遞不回改,以本檔為準。
⇒ **好消息:C3 要的逐欄錯誤不是新 pattern,有先例。**

## 2. 現成的路(C3 幾乎不用自己寫邏輯)

| 要的東西 | 現成在哪 |
|---|---|
| CRUD | `SupabaseAddressAdapter.ts:42/55/70/84`(list/create/update/delete) |
| 新增(含設預設) | `add-address.ts` + `_address-default.ts:13` `unsetCurrentDefaultExcept` |
| 編輯 | `update-address.ts:32-44`(`AddressPatch` 白名單含 `email`,`:14-16`) |
| 刪除(含遞補) | `delete-address.ts:16-31` —— 刪掉後若已無預設,**最舊那筆自動遞補** |
| 設預設 | `set-default-address.ts` + `verifyOwnedThenUnsetOthers`(`_address-default.ts:51`) |
| 驗證 | `AddressInput`(`schemas/src/index.ts:116-127`);發票跨欄位規則住在共用的 `CheckoutInvoiceInput`(`:190-191` 註解:「改發票規則只需改那一處」) |
| 最後防線 | DB CHECK `addresses_invoice_company_has_data`(`20260523034911:54`)/ `addresses_invoice_donate_has_code`(`:57`) |

## 3. 🔴🔴 兩個「use-case 自己寫的前提,在 admin 不成立」

這兩條是本次調查最重要的產出。**不是 bug,是前提換了場景。**

**① best-effort 兩步的理由是「單人自管」——admin 是兩個人。**
`_address-default.ts:11` 逐字:「best-effort 兩步(Sean Q2=A):兩次 repo 呼叫非單一 DB transaction、**單一使用者管自己資料風險可忽略**」。
`delete-address.ts:14` 同款:「best-effort(Sean Q2=A):delete 與遞補 update 非單一 transaction」。
⇒ 在 storefront 這成立(客人自己改自己的)。**在 admin 不成立:員工在後台改的同時,客人可能正在前台改同一批地址。**
具體壞法:員工按「設為預設」→ unset 舊的成功 → set 新的失敗 ⇒ **該客人零預設地址**;或兩邊同時設不同筆為預設 ⇒ 撞 partial unique index。
⚠️ **我沒有量過這個機率**,也**沒有實測構造過**。但「風險可忽略」那句的依據已經不在了 ⇒ **要嘛接受並寫進 plan 當已知債,要嘛改走 RPC 單交易**。這是 Sean 的題,不是我的(見 §6)。

**② 「跨會員另由 RLS 守」在 admin 路徑是空的。**
三支 use-case 都寫「RLS 是 ownership 邊界(Sean Q2=A),本層檢查為其上 **defense-in-depth**」(`_address-default.ts:27-29`、`delete-address.ts:11-13`)。
admin 注 **service_role = BYPASSRLS** ⇒ **RLS 那層不存在,app 層的 `verifyAddressOwned` 從「第二道」變成「唯一一道」**。
⇒ C3 的負測必須直接打它:**A 客的 addressId 送到 B 客的頁面 → 必須被拒且 DB 零變更**。不能照抄 storefront 的安全論述。
⚠️ 誠實邊界:這**不是權限外洩** —— 員工本來就能編輯任何客人。真正的風險是**打錯客人**(員工手滑 / 表單 hidden 欄殘留),後果是改到別人的資料。

## 4. 表單形狀:**不要照 tier 那套 PRG 單一錯誤碼**

tier/wallet 是 2-3 個簡單欄 ⇒ `?r=invalid` 夠用。地址是 **8 個欄**(name/phone/line/email + 發票 4 欄跨 3 個 tab),而且發票規則是跨欄位的。
admin 已經為這件事拍過板:`procurement-action-state.ts:16-17` 逐字「**失敗回 state、成功才 redirect**(沿用 Sean 2026-08-02 對備註線拍的 Q1=A 形狀):本表單有 7 個輸入欄…**redirect 會把員工打的整份清掉**」。
⇒ **C3 照這條**:`useActionState` + 失敗回 `{fieldErrors, formError}` 保留輸入、成功才 PRG。
逐欄錯誤要含**巢狀 invoice 路徑**(`['invoice','taxId']`),並照 storefront `address/actions.ts:17` 那條硬規則:**逐欄建 map、不得用 `issues[0]`**(zod issue 順序不保證)。

## 5. Q-C-2 的連帶(Sean 08-14 已拍 A)

`AddressInput.email` 必填(`schemas/src/index.ts:125`,TapPay ≤40 字)⇒ 員工編輯存量無 Email 的舊地址會被擋下來。
UI 要求:欄位標必填 + 一行說明「**沒有 Email 的地址,客人結帳會被擋**」。
⚠️ 但 `CustomerAddress.email` 型別是 `string | null`(`domain/identity/address.ts:44`),且該欄註解 `:39-42` 逐字承認**目前沒有任何程式分支真的區分 null 與 ''**。⇒ 後台列表要顯示「這筆缺 Email」的話,判準只能是 `!address.email`(兩者都算缺),**不能宣稱分得出「從未填過」**。

## 6. ✅ Q-C-3 已拍板 = **B**(Sean 2026-08-14,逐字「Q-C-3:B」)

**後台改地址/愛車的「設預設 / 刪除」要走單交易、保證原子性,不接受 best-effort 兩步。**
(主視窗補正的範圍句 Sean 已收到 ⇒ **本拍板同時管地址與愛車**。)

**推翻了我與主視窗共同推薦的 A。** 記錄過程,不抹平:
> 我提 A 時附了一句誠實話,原文是「A 的理由是推論不是量測」。
> Sean 選 B 之後,那句話的意義變了 —— 它不再是「為 A 辯護」,而是:
> **「當初判這個競態窄的依據沒有被量測過,而拍板往安全側走。」**
> 這兩件事不一樣,結論變了不代表過程要被改寫成好看的樣子。

**表單形狀**不另問:§4 有 Sean 2026-08-02 的既有拍板可沿用,照做。

## 7. C3 檔案清單(暫估,待 plan 批准後定稿)

`address-form.ts`(新,解析 + `ADDRESS_SINGLE_FIELDS`)· `address-actions.ts`(新,三個 action + state 型別)· `address-action-state.ts`(新,client 可 import、零 server import —— 照 `procurement-action-state.ts:3-4` 那條硬規則)· `address-edit-form.tsx`(新,client)· `customer-detail-sections.tsx`(接 `readOnly` + 掛表單)· `customer-detail.tsx`(傳 `readOnly`)· `apps/admin/package.json`(`@pcm/schemas` 若 C1 已加則免)· `address-form.test.ts`(新)= **7-8 檔**。
🔴 **Q-C-3=B 之後,上面這張清單少了一支 migration**:「設預設 / 刪除」要走 **SECURITY DEFINER RPC 單交易**
⇒ 多一支 `supabase/migrations/<版本號>` (**版本號跟主視窗要,不自己編** —— 全域唯一資源)。

⇒ **片型改判**:原本標「標準片」,**Q-C-3=B 之後 C3b 命中鐵則 12③(schema / migration)⇒ 高風險片,對抗審查不降級、不得降級**。
⇒ **多一個 Sean 手動 apply 的停點**,且**應用層不得先於 migration apply 上線**(跨 apply 停點紀律)。
⇒ 拆片方式不變但性質變了:**C3a(新增+編輯)= 標準片、不需 RPC、可先動**;**C3b(刪除+設預設)= 高風險片、卡 migration + apply**。
(**C1 不受影響** —— 它沒有一對多、沒有 unset/set 兩步 ⇒ 仍是這條線第一個能動手的片,順序不變。)

## 8. 誠實缺口

- 全部來自讀 repo,**零執行**:沒跑測試、沒開瀏覽器、**沒對正式庫查過任何一筆地址資料**。
- §3① 的競態**沒有實測構造過**,當初判「風險窄」是推論、不是量測。**Sean 已拍 B 往安全側走**(§6),這條缺口因此不再影響決策,但保留記錄。
- **沒讀** `InlineAddressForm.tsx`(337 行)⇒ 我對「發票三 tab 的實際互動」只有 schema 層的理解,UI 細節可能有我沒看到的坑。C3 開工前要補讀。
- §7 檔數標「暫估」不是「數過」—— 因為新檔的切法還沒定(`address-action-state.ts` 要不要獨立成檔取決於表單是不是 client component,而那取決於 §4 照做與否)。
