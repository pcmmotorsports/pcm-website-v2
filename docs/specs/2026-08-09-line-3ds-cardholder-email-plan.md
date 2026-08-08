# LINE 身分 3DS 啟動被拒 — cardholder email 修復 plan **v2.1(兩窗合併版)**

> 狀態:**v2.1 待主視窗終核 → 實作未開工、零 code 改動**。
> 片型:**高風險片**(鐵則 12① 錢 + ③ schema/migration)。鐵則 8:**是**。
> 內容分級:不適用(改的是付款資料來源,非可編輯內容)。
> 指派:`P-211-A`(v1)→ `P-213-A`(v2 方向拍板)→ `P-217-A`(v2.1 合併令)。前情:`P-208-STOP` / `P-209-STOP` / `P-212-STOP`。
> **v2 → v2.1(P-217-A §3 四件合併,兩窗互證)**:①寫入路徑盤點補全(§2.2)②cardholder 出口不變量閘=執行期防線(§2.3、測試 3.1-⑥)③`database.types.ts` 重 gen 硬步驟+重貼陷阱(§2.1、§4.1)④`isSyntheticEmailDomain` export(v2 §2.3 原有,確認不變)。
>
> **v1 → v2 的變化**:v1 列四案請 Sean 選;Sean 拍 **Q1=A 的變體**——
> **email 落在收件地址上、應用層必填、cardholder 從選中的收件地址取 email**。
> v1 §3 的四案選擇節**已作廢**,本版直接進定案設計。v1 的根因鏈(§1)與驗證方法(§4)**原樣保留、仍有效**。

---

## §0 施工序與前置(先讀這節)

| # | 項目 | 誰做 | 狀態 |
|---|---|---|---|
| 0-1 | ✅ **TapPay 真實錯誤碼已取得** | P 窗 sandbox 對照 probe(`P-220-A` ③ 授權) | **已清**:`521 Out of range : cardholder > email`,根因=**email 總長 >40 被拒**(見 §1) |
| 0-2 | ⛔ **D 窗兩片收割**(發票隱藏 `D-309-A` + 手機三 bug;`P-217-A` §3 明定兩片都要) | D 窗 | 未收割 |
| 0-3 | plan v2.1 過主視窗終核 | 主視窗 | 本檔 |
| 0-4 | 實作 | P 窗 | 未開工 |

🔴 **兩條與 0-2 綁死的紀律**:
1. 本 plan 對 `InlineAddressForm.tsx` **一律以符號/區塊指稱、不落行號**——D 窗正在改同一支檔,行號寫下即過期。
2. 實作以 **D 片收割後的樹**為基底;開工第一動是 `git pull` 後重新確認該檔現況,不憑本 plan 的描述動手。

🔴 **0-1 未回來前不動 code**:若 status code 指向的不是 email 欄位,本 plan 的整個前提倒掉,退回重估(v1 §4.3 判定標準原樣有效)。

---

## §1 根因鏈(v1 原樣保留,已逐條親驗)

| # | 事實 | 證據 |
|---|---|---|
| 1 | TapPay 3DS body 帶 `cardholder.email` | `packages/adapters/src/tappay/TapPayChargeAdapter.ts:182-186` |
| 2 | 該 email 取自 **auth session email** | `apps/storefront/src/lib/payment/cardholder.ts:49`(`input.user.email`) |
| 3 | 呼叫端餵 `supabase.auth.getUser()` 的 user | `apps/storefront/src/app/checkout/charge-actions.ts:177-180` |
| 4 | LINE 身分的 auth email = 合成、網域 `.local` | `apps/storefront/src/lib/auth/line.ts:38` / `:48-50` |
| 5 | 啟動成功當下才寫 `rec_trade_id`;pending+NULL ⇒ 啟動呼叫被拒 | `packages/use-cases/src/initiate-payment.ts:112-115`;拒絕條件 `TapPayChargeAdapter.ts:214-217` |
| 6 | `customers.email` 也是合成值(trigger 抄 `NEW.email`),且 `NOT NULL UNIQUE` | `supabase/migrations/20260523034911_init_customers_and_subtables.sql:281-284`、`:16` |
| 7 | LINE scope 只開 `openid + profile` ⇒ 真實 email 多數為 null | `apps/storefront/src/lib/auth/line.ts:24`、`:104`、`:162` |

⇒ ~~工作假設「TapPay 拒 `.local`」~~ **已被 sandbox 對照實測部分推翻並收斂為真根因(2026-08-09 00:1x,P-220-A ③ 授權)**:

| 組 | email(唯一變因) | 總長 | 結果 |
|---|---|---|---|
| A/C | `line_U<16/32hex>@line.pcmmotorsports.local` | 48/64 | **521 `Out of range : cardholder > email`** |
| B | 真網域一般信箱 | 36 | **0 Success**(payment_url+rec_trade_id 全綠) |
| D | `probe@line.pcmmotorsports.local`(**同 `.local` 網域**) | 31 | **0 Success** |
| E/F/G | 真網域,長度 40 / 41 / 48 | 40/41/48 | **40=0 Success;41、48=521** |

🔴 **真根因:TapPay 對 `cardholder.email` 有總長 ≤40 字元的驗證,超過即拒(status 521);`.local` 網域本身不被拒**(D 組證)。
LINE 合成信箱=`line_U<32hex>@<25 字元網域>`=**64 字元恆超標** ⇒ 啟動必拒,與 prod 指紋(pending+NULL、TapPay Record 零筆)完全吻合。
連帶暴露既有潛在 bug:**email 登入用戶真實信箱 >40 字元者,現況同樣付不了款**(修法一併涵蓋,§2.3)。
⚠️ 限制:40 上限為 **sandbox 實測值**(probe 腳本在 P 窗 scratchpad,7 發完整輸出);正式站驗證行為假定同款(平台層參數驗證、非銀行端),官方文件未載明此限、標「sandbox 實測」。

---

## §2 定案設計

### 2.1 Schema:`customer_addresses` 加 `email` 欄

**表**:`customer_addresses`(`20260523034911_init_customers_and_subtables.sql:40-61`)。

**形狀(採主視窗建議,並補理由)**:

```sql
ALTER TABLE public.customer_addresses ADD COLUMN email text;
```

- **DB 層 nullable、應用層必填**。理由:既有列無值,`NOT NULL` 上不去;而 backfill 一個假值等於製造第二種髒資料。
- 🔴 **刻意不採本表既有的 `text DEFAULT ''` 慣例**(phone / invoice_* 都是空字串當「沒填」)。
  理由:本片需要區分「**從來沒被要求填過**」(舊地址 → NULL)與「**填了又清空**」(不該發生,應用層必填會擋)。
  空字串慣例會讓這兩者長得一樣,而 §2.4 的舊地址升級動線**正是靠這個區分**決定要不要攔人。
  ⇒ 這是刻意的慣例分歧,commit body 要寫明(鐵則 10 可追蹤性)。
- **不加 UNIQUE**:Sean 拍板「可以接受客人用不同 email」,且同一人多個地址可共用同一 email。
- **不加 CHECK 驗格式**:格式驗證留在應用層 zod(單一真相,見 §2.2);DB 端加正規式 CHECK 會變成第二處要同步的規則。

**GRANT / RLS**:`customer_addresses` 是**表級** `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated`(同檔 `:236`),
policy 為 own-only 四條(`:166-179`)⇒ **新欄自動涵蓋,不需另外授權**。
🔴 但要在 migration 後**實跑驗證**新欄真的讀寫得到(不靠推論;既有教訓:表級 ACL 攤平看不到欄級差異)。

**adapter 同步**:`packages/adapters/src/supabase/SupabaseAddressAdapter.ts:12-13` 的 `ADDRESS_SELECT` 常數要加 `email`,
否則查回來的 row 沒有該欄(三個 `.select(ADDRESS_SELECT)` 呼叫點 `:39` / `:55` / `:69` 共用它)。
domain 型別 `CustomerAddress`(`packages/domain/src/identity/address.ts:24-40`)加 `email: string | null`。

🔴 **`database.types.ts` 重 gen = 硬步驟(v2.1 合併件③,兩窗原先都漏)**:
`mappers/address.ts:12` 的 row 型別 **derive 自生成檔**(檔頭註解逐字「schema 改 → 重新 gen → 此型別自動跟著變」;
`database.types.ts:243` 為 `customer_addresses` 生成型別)⇒ 只加 migration + 改 `ADDRESS_SELECT` 不重 gen,型別層讀不到新欄。
🔴 **重 gen 的已知陷阱**(`database.types.ts:1-8` 檔頭明寫,計數以檔頭為唯一權威):重 gen 會沖掉中文檔頭
**與七個函式、共二十一處手動校正**,重 gen 後必須逐項重貼再 typecheck。順序:migration 寫檔 → (apply 後)重 gen → 重貼校正 → 改 adapter/domain。

**migration + rollback**:
- forward:`ADD COLUMN email text;`(純加欄、不重寫既有列 ⇒ 無鎖表風險)。
- rollback:`ALTER TABLE public.customer_addresses DROP COLUMN email;`
  🔴 **回滾會丟掉客人已填的 email**(不可逆資料損失)。⇒ 回滾前必須先確認應用層已退版、不再依賴該欄。
- 🔴 **鐵則 12③ + 跨 apply 停點**:應用層不得先於 migration apply 上線。順序必須是 **migration apply → 驗證新欄可讀寫 → 應用層部署**。

### 2.2 表單:`InlineAddressForm` 加 email 欄(必填)

- **共用一次生效**:該元件同時服務會員中心與結帳(D 窗正在做結帳就地編輯),加一次兩邊都有。
- **驗證沿用既有 schema、不新寫**:`AddressInput`(`packages/schemas/src/index.ts:94-103`)加一欄,
  值用 **`NotificationEmailInput`**(`packages/schemas/src/notification-email.ts:26-44`)。
  🔴 選它的關鍵理由:**它已經明文排斥 LINE 合成網域**(`:39` 的 `!isSyntheticEmailDomain(value)`,判斷式 `:21-24`)
  ⇒ 客人不可能把合成信箱手動填進地址、繞過本次修復。這條是白撿的縱深防線。
- 🔴 **地址 email 加總長 ≤40 上限(§1 實測後新增)**:`NotificationEmailInput` 允許 254 octets,但 TapPay
  對 `cardholder.email` 實測 >40 即拒(521)⇒ 地址 email 在 compose 時**疊加 `≤40` refine**
  (例 `AddressEmailInput`;錯誤文案講白「付款驗證限 40 字元內」)。不改 `NotificationEmailInput` 本體
  (它另有訂單通知用途,不受 TapPay 限制)。在填寫當下就擋,不讓客人存一個之後付款必炸的 email。
- **寫入路徑自動涵蓋**:`addAddressAction` / `updateAddressAction` 兩支都是 `AddressInput.safeParse`
  (`apps/storefront/src/app/account/address/actions.ts:80`、`:138`),schema 加欄即兩支同時生效、
  且既有 `fieldErrors` 逐欄機制會自動吐出 email 的錯誤訊息。
- **寫入路徑盤點=全覆蓋證明(v2.1 合併件①)**:`customer_addresses` 的 DB 存取**全部集中在**
  `SupabaseAddressAdapter.ts` 四處(`:38` list / `:53` insert / `:66` update / `:79` delete),insert/update 皆經
  mapper ← 上述兩支 action ← `AddressInput`;admin 端 `customer-detail-view.ts:41` **僅註解引用、非查詢**;
  DB trigger 只建 `customers` 不建 addresses ⇒ **「應用層必填」的執法面 = 全部寫入路徑,無旁路**。
  ⚠️ 此為本樹 grep 結果,實作日以當日樹複掃一次。
- ⚠️ **必然的連帶效果(要讓 Sean 知道、不是 bug)**:`AddressInput` 是 add / update **共用**的 schema
  ⇒ 加必填後,**舊地址只要被編輯就必須補 email 才存得起來**。這正是 Sean 要的「強制」,但它會讓
  email 登入的老客人在編輯舊地址時也被要求補一次。**這是刻意的,不是 §2.4 要豁免的對象**
  (§2.4 豁免的是「結帳當下不擋人」,不是「編輯時不用填」)。

### 2.3 cardholder 接線:email 來源與 fallback 順序

`buildCardholder`(`apps/storefront/src/lib/payment/cardholder.ts:45-76`)目前用 `input.user.email`(`:49`)。
它已經有 `deps.addresses.listByCustomer` 並挑出選中的地址(`:59-63`)⇒ **選中地址的物件本來就在手上**,不需新增查詢。

**新的 email 決議順序(寫死,不得靠「看起來對」)**:

| 順位 | 來源 | 適用 |
|---|---|---|
| 1 | **選中收件地址的 `email`**(非空) | 所有人(新地址一律有值,schema 已保證 ≤40+非合成) |
| 2 | session email **且非合成網域且總長 ≤40**(§1 實測後補的第二條件) | email 登入用戶 + 舊地址(§2.4 的豁免路徑) |
| 3 | 🔴 **擋下,回明確錯誤** | LINE 用戶 + 舊地址;**或 email 用戶 + 舊地址 + session email >40**(後者=既有潛在 bug,本片一併收,引導補地址 email) |

**第 3 順位的擋法(plan 寫死三件事)**:

- **擋在哪層**:`buildCardholder` 回新的 fail reason(例 `email_unusable`)。
  🔴 選這層的理由:它在 `charge-actions.ts:177` 被呼叫,**早於 `placeOrder`(:250)與任何 TapPay 呼叫**
  ⇒ 擋下時**零扣款、零垃圾單**,與既有 `mapCardholderFail`(`:181-183`)同一條既有路徑,不新增分支。
- **客人看到什麼**:不是 generic 錯誤,要能自救。文案方向:
  「這筆訂單需要您的 Email 才能完成付款驗證,請在收件地址補上 Email」+ 指向該地址的編輯入口。
  🔴 **與 D 窗的結帳就地編輯地址片天然互補**——客人可以當場補完不用離開結帳。實作時確認該入口已可用。
- **絕不做的事**:🔴 **任何情況都不得把合成信箱送進 cardholder**。第 3 順位不是「碰運氣送出去」,是明確擋下。

🔴 **出口不變量閘=執行期防線(v2.1 合併件②,舊窗背書採納)**:`buildCardholder` 成功回傳前,
對**最終選定的 email(不論來自順位 1 或 2)**再過一次 `isSyntheticEmailDomain` **與總長 ≤40** 兩項檢查,任一不過 ⇒ 走順位 3 擋下。
理由:順位 1 的值「寫入時驗過」是**上游假設**——舊資料、未來新寫入路徑、DB 手動操作都可能繞過它;
不變量「送 TapPay 的 email 永不為合成域」的執法點必須畫在不變量成立的**最窄面**=cardholder 出口
(同族教訓 `feedback_guard-drawn-at-narrowest-surface`)。測試層全域斷言(3.1-⑤)保留當第二腿,
**執行期閘的判別力由 3.1-⑥ 毒地址負測單獨證明**(拿掉此閘只有它紅)。

**合成網域的判斷要用單一真相,不得第三次抄字串**:
現況該常數已在兩處各自 hardcode(`apps/storefront/src/lib/auth/line.ts:38`、`packages/schemas/src/notification-email.ts:5`,同值)。
本片**不新增第三處**:把 `notification-email.ts` 的 `isSyntheticEmailDomain`(現為私有 `:21-24`)export 出來給 cardholder 用。
（把兩處既有重複收斂成一個常數是更乾淨的解,但那擴大了本片範圍 ⇒ **列 backlog、不在本片做**;
不修未來會痛在哪:改網域時「產生規則」與「排斥規則」會分岔,產生的新網域不再被排斥、修復當場失效。）

### 2.4 舊地址優雅升級(不擋 email 登入用戶)

| 用戶 × 地址 | 結帳當下 | 理由 |
|---|---|---|
| email 登入 × 新地址(有 email) | 順位 1,照走 | — |
| email 登入 × 舊地址(email 為 NULL) | **順位 2 回落 session email,不擋** | 他的 session email 是真值,可直接用 ⇒ 零摩擦。滿足 `P-213-A` ④「不擋 email 登入用戶」 |
| LINE 登入 × 新地址(有 email) | 順位 1,照走 | 修復生效 |
| LINE 登入 × 舊地址(email 為 NULL) | **順位 3 擋下 + 引導就地補填** | 唯一被擋的組合;他本來就付不成功(現況是卡在 processing),改成**明確告知可自救**是嚴格改善 |

🔴 **這個矩陣就是 §2.1 選 nullable 而非空字串的原因**:區分不出「沒填過」就畫不出這張表。

**不做主動 backfill**:不寫腳本去猜舊地址的 email(猜錯=把錯誤 email 送進金流)。改為**用到時才補**。

### 2.5 獨立通知 Email 欄怎麼辦(`P-213-A` ② 要我給結論)

**結論:本片不開 `CHECKOUT_NOTIFICATION_EMAIL_ENABLED`,獨立通知欄不需要,但也不刪。**

理由:

1. email 落地址後,**結帳頁再放一個獨立 email 欄 = 同一件事問客人兩次**,是 UX 退步。
2. `orders.notification_email` 欄與 `create_order` 的 `p_notification_email` 參數**早就存在**
   (`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql`),
   現況由 `charge-actions.ts:247` 餵 `null`(註解:「B-3 只切到 9-param RPC 形狀;canonical 真值持久化刻意留 B-4」)。
   ⇒ **地址 email 可以直接餵進這個既有參數**,不需要新欄位、不需要開 flag。
3. flag 本身另有一個未解的疑點:它**不在 `turbo.json` 的 build env allowlist**
   (`TAPPAY_3DS_ENABLED` 在 `:32`,`CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 不在)——刻意或漏,未確認。

🔴 **但這是「要不要開一個 Sean 已經拍過 A 的 flag」,`P-213-A` 明令「勿當殭屍拍板直接執行」**
⇒ **本片不碰該 flag,把上面的理由送回 Sean 確認**。他若仍要開,那是獨立一片。

**附帶決策題(需要拍,列進 §5)**:地址 email 要不要進 `shipping_address_snapshot`?
現況快照是**逐欄手寫**的 `jsonb_build_object('name', …, 'phone', …, 'line', …)`
(`20260730120100_m4b_e10_n3b_create_order_new_display_id.sql:258-260`)⇒ **加欄不會自動流進去**,要改 RPC。
我的看法:**應該進**(客服/對帳要知道當時送出去的是哪個 email),但它是另一支 migration + 動 `create_order` 這條主幹 ⇒ 風險與範圍都升一級,建議**獨立一片**、本片先不做。

---

## §3 測試設計

### 3.1 補上 LINE × 結帳零交會缺口(`P-209-STOP` 查出)

現況:LINE 四支測試 grep `checkout|charge` 全 0;結帳兩支 grep LINE auth 全 0。本片讓兩條線交會。

新增(暫定 `apps/storefront/src/lib/payment/cardholder.line-identity.test.ts` + charge-actions 層整合):

1. **LINE × 有 email 的地址** → 送進 TapPay 的 `cardholder.email` **等於地址的 email**(斷言字面值)。
2. **LINE × 舊地址(email NULL)** → 回 `email_unusable`、**零 placeOrder 呼叫、零 TapPay 呼叫**(斷言「沒被呼叫」)。
3. **email 登入 × 舊地址** → 回落 session email、**照常成交**(零回歸,證明豁免生效)。
4. **email 登入 × 有 email 的地址** → 用地址 email(順位 1 優先於 2)。
5. **合成信箱不可能出現在出口**:任何情境下送進 TapPay 的 email 都不得匹配合成網域(全域斷言)。
6. **毒地址負測(v2.1 新增,證出口閘判別力)**:fixture 直接構造一筆 `email` 為合成域字面的地址 row
   (模擬繞過寫入層驗證的舊/髒資料)→ `buildCardholder` 擋下、零 TapPay 呼叫。
   🔴 這條的存在理由:①-⑤ 全綠**證不了**出口閘活著(順位 1/2 來源乾淨時它永不觸發)——
   沒有這條,出口閘就是「構造不出負測的守門」,依 repo 教訓應先懷疑它是 no-op。
7. **長度邊界(§1 實測後新增)**:地址 email 總長 40 → 通過;41 → 擋下(schema 層與出口閘各一條,兩層分別測)。
   🔴 邊界值取自 sandbox 實測(40 過 / 41 拒),不是猜的;實測輸出見 P 窗 scratchpad probe。
8. **email 登入 × 舊地址 × session email 41 字元** → 順位 2 不採用、走順位 3 引導(收既有潛在 bug)。

### 3.2 突變表(每條只紅一個)

| 突變 | 應該紅 |
|---|---|
| email 來源改回 `input.user.email` | 3.1-① |
| 拿掉第 3 順位的擋門(讓它回落 session email) | 3.1-②(且 3.1-⑤ 同時紅) |
| 把順位 1、2 對調 | 3.1-④ |
| 拿掉 `notification-email.ts:39` 的 `!isSyntheticEmailDomain` | schema 既有測試 + 3.1-⑤ |
| 把 `ADDRESS_SELECT` 的 email 拿掉 | 3.1-①(讀不到值 → 退到順位 2/3) |
| **拿掉 §2.3 出口不變量閘** | **只有 3.1-⑥**(①-⑤ 全綠;紅的唯一性=閘的判別力證明) |
| 把 ≤40 長度閘改成 ≤254(等於拿掉) | 3.1-⑦、3.1-⑧ |
| 長度閘寫成 `<40`(差一錯) | 3.1-⑦ 的 40 那格 |

### 3.3 🔴 反恆真紀律(本 repo 反覆踩過,寫死)

1. **斷言 email 的字面值**,不是「有沒有呼叫 TapPay」——後者對「送錯 email」全盲。
2. **fixture 的 LINE session email 必須真的是 `line_<sub>@line.pcmmotorsports.local` 格式**;
   圖方便寫成真實信箱 ⇒ 第 3 順位的負測**構造不出來**,整組守門變恆真。
3. **3.1-② 要斷言「沒被呼叫」**(placeOrder / TapPay 各一),不能只斷言回傳值——
   回傳值對「擋下了但已經先建了單」全盲,而零垃圾單正是選這一層擋的理由。
4. 每條新斷言配 §3.2 的突變**實跑一次確認會紅**,不靠推論。

### 3.4 三綠 + 對抗審查

- 鐵則 11:typecheck + lint + build(動 .ts/.tsx)。動 .sql 另有語法守門。
- 🔴 鐵則 12①③:diff 完成後 **commit 前**跑 codex 對抗審查,findings 修完才 commit,**不 push、不 apply**。

---

## §4 影響面與 rollback

### 4.1 影響面

| 層 | 檔 | 性質 |
|---|---|---|
| DB | `customer_addresses` 加欄(新 migration) | 🔴 不可逆(rollback 會丟客人資料) |
| domain | `packages/domain/src/identity/address.ts:24-40` | 型別加欄 |
| schema | `packages/schemas/src/index.ts:94-103`(`AddressInput`)、`notification-email.ts`(export 判斷式) | 🔴 **共用 schema**,add/update 兩路徑同時生效 |
| adapter | `SupabaseAddressAdapter.ts:12-13`(+ 三個 select 呼叫點共用) | 讀取面 |
| types | `database.types.ts` 重 gen(v2.1 合併件③;`:243` 生成型別、mapper derive 自它) | 🔴 重 gen 沖掉檔頭+二十一處手動校正,需重貼(§2.1) |
| 元件 | `InlineAddressForm.tsx`(**不落行號**,D 窗施工中) | 會員中心 + 結帳共用 |
| 付款 | `cardholder.ts:45-76`、`charge-actions.ts:177-183` | 🔴 **錢的主幹** |

**跨窗協調**:`InlineAddressForm` 與 D 窗 `D-309-A` 同檔 ⇒ 依 §0-2 等收割後為基底。

### 4.2 rollback

| 項 | 難度 | 做法 |
|---|---|---|
| 應用層(schema / cardholder / 元件) | 易 | 單一 commit `git revert`,無資料面殘留 |
| migration | 🔴 難 | `DROP COLUMN email` **會丟掉已填資料**;必須先退應用層、確認不再依賴,才准 drop |

🔴 **部署時序(既有教訓,不得違反)**:migration apply → 實跑驗證新欄可讀寫 → 應用層才上線。
反過來 = 應用層先於 migration 上線,正式站會壞(08-07 A9h 已有前科)。

---

## §5 待拍板的題(不自己決定)

1. **地址 email 要不要進 `shipping_address_snapshot`**(§2.5 附帶):我建議**要**、但**獨立一片**做(動 `create_order` 主幹)。
2. ~~**`CHECKOUT_NOTIFICATION_EMAIL_ENABLED` 是否仍要開**~~ **已結案**:Sean 逐字答 `A`=**不開**,訂單通知走地址 email(`P-220-A` ②)。
3. ~~**長度上限 40 的文案與 UX**~~ **已結案**:Sean 2026-08-09 00:2x 逐字答 `A`(`P-222-A` ②)=
   **欄位下常駐灰字提示「40 字元內」+ 超長即時紅字報錯,兩者都要**。實作照此、不再問。

## §6 我沒做的 / 未確認

- 零 code 改動、零 commit、零 push、未 apply 任何 migration。
- ✅ TapPay 真實錯誤碼**已取得**(§1;sandbox 對照 probe 7 發)——前提已證,根因由「拒 `.local`」更正為「email 總長 >40 被拒」。
- ⚠️ **40 上限只在 sandbox 實測**;正式站未打(紀律禁止),假定同款平台層驗證。官方文件未載明此限。
- `InlineAddressForm` 的當下內容(D 窗施工中,刻意不讀不落行號)。

## §7 附:sandbox probe 實測全紀錄(2026-08-09 00:1x)

腳本 `tappay-3ds-email-probe.py`(**P 窗 scratchpad,不進 repo**;金鑰讀 `.env.tappay-sandbox`、只進 header/body、不輸出);
host 硬編 `sandbox.tappaysdk.com`,**正式站零觸碰**;payload 形狀照抄 `TapPayChargeAdapter.ts:175-195`(含 `three_domain_secure:true`)。

| 發 | email | 長 | status | msg |
|---|---|---|---|---|
| A | `line_U<16hex>@line.pcmmotorsports.local` | 48 | 521 | `Out of range : cardholder > email` |
| B | `sandbox-3ds-probe@pcmmotorsports.com` | 36 | **0** | Success(payment_url+rec_trade_id) |
| C | `line_U<32hex>@line.pcmmotorsports.local`(**prod 真實形狀**) | 64 | 521 | 同上 |
| D | `probe@line.pcmmotorsports.local`(**同 `.local` 網域、短**) | 31 | **0** | Success ⇒ **網域無罪** |
| E | 真網域 40 字元 | 40 | **0** | Success |
| F | 真網域 41 字元 | 41 | 521 | 同上 ⇒ **上限=40** |
| G | 真網域 48 字元 | 48 | 521 | 同上 |

🔴 第一輪 B 組曾回 `10014 Invalid bank transaction id`(我的 `bank_transaction_id` 過長),修短後重打才拿到 Success
——**若沒重打就會誤判「真信箱也被拒」**,記此以免後人照抄第一輪輸出。

— P 窗,2026-08-09
