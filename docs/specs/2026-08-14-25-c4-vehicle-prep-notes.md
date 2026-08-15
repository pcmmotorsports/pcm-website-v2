# #25 片 C4(愛車 CRUD)前置調查(C 窗 2026-08-14 夜;**零 code、Sean 尚未批 plan**)

> 讀過的檔(7 支):`schemas/src/index.ts`(§VehicleInput `:135-160`)`mappers/vehicle.ts:70-87` `SupabaseVehicleAdapter.ts:60-82` `_vehicle-primary.ts` `delete-vehicle.ts` `app/account/vehicle/actions.ts:37-48,93-95,144-147` `20260716150000`(dict 欄 migration)`storefront/src/lib/products.ts:695-739`。
> **未讀**:`add-vehicle.ts` `update-vehicle.ts` 全文、`InlineVehicleForm.tsx`(364 行)。

## 1. 🔴🔴 本片最重要的一條:照抄 storefront 會**靜默清掉客人的資料**

> 🔴 **2026-08-14 夜第二版(A 窗 fresh-context 複驗 M1/M2,我逐項自己開檔驗過才折)**:
> **本節第一版把病灶框窄了兩層。** ①漏了同一條鏈上的第二顆欄位 `isPrimary` ②修法寫成**黑名單**(只剔掉我剛好發現的那兩顆)。
> 我在 `C-004` 信裡親手寫過「**折 finding 的預設動作 = 只處理被指名那一處**」,然後**犯在自己身上**。標題從「字典鍵」改成「資料」就是因為受害欄位不只 dict。

三個事實疊起來變成一個無症狀的資料損壞:

1. `VehicleInput` 的 dict 兩欄是 **`.default(null)`**(`schemas/src/index.ts:153-154`),註解 `:150-151` 逐字說明這是**故意的**:「舊 caller 不帶也恆出現在 `parsed.data` → update patch **恆寫兩欄**」。
2. `mapVehiclePatchToRow`(`mappers/vehicle.ts:85-86`)對 dict 兩欄的判準是 **`!== undefined` 就寫**,註解 `:83-84` 逐字:「schema default 保證 delivery 層**恆帶**、含雙 null」。
3. storefront 就是這樣用的(`vehicle/actions.ts:144-147`)—— 對它是**正確的**,因為客人在表單上真的能把 dict 車改成自由輸入,那時**必須**用雙 null 覆蓋、不能殘留舊對。

⇒ **C4a 的表單只有六個欄**(車型/年份/引擎號/里程/改裝/保養)。若照抄 storefront 的 `patch = parsed.data`,
**每一個「表單沒有、但 schema 有 `.default()`」的欄,都會在每次存檔被寫成那個 default。**
**症狀:沒有症狀。** 三綠會綠、DB CHECK 會過、schema `.refine` 會過。

**受害欄位不只 dict —— 這是完整清單(逐欄開檔驗過,不是推的)**:

| 欄 | schema 預設 | 存檔後被寫成 | 壞在哪 |
|---|---|---|---|
| `dictBrandName` / `dictModelName` | `.default(null)`(`schemas/src/index.ts:153-154`) | `null` / `null` | 首頁愛車 chips 的「精確 lookup 直套」失效(`20260716150000:31` COMMENT)⇒ 改走字面比對流 |
| 🔴 **`isPrimary`** | **`.default(false)`**(`:137`) | **`false`** | **員工只是改個里程,那台車就不再是主車 ⇒ 客人從此零主車** |

🔴 **`isPrimary` 這顆比 dict 更毒,而且三層守門全部擋不住**(A 窗 M1,我逐項開檔驗):
- mapper 判準是 `!== undefined`(`mappers/vehicle.ts:76` 逐字 `if (patch.isPrimary !== undefined) row.is_primary = patch.isPrimary;`)⇒ **`false !== undefined` ⇒ 照寫**;
- partial unique index 是 `WHERE is_primary = true`(`20260523034911:88-89`)⇒ 只擋「**至多**一筆」、**不擋零筆**;
- `updateVehicle` 的補償分支是 `if (patch.isPrimary)`(`update-vehicle.ts:32`)⇒ `false` 走 else、**不跑補償**。

### 🔴 修法 = **白名單,不是剔掉那幾顆**(A 窗 M2;第一版寫的黑名單是錯的)

第一版寫 `const { dictBrandName, dictModelName, ...patch } = parsed.data;` —— **那是黑名單**:
只剔掉我剛好發現的兩顆,`isPrimary` 還在 `...patch` 裡,而 `year`/`engine`/`km`/`mods`/`service` 全是 `.default('')`(`schemas/src/index.ts:141-149`)
⇒ **將來任何一欄從表單拿掉,同一個 bug 原樣回來。**

**正確修法**:patch **只由表單真有的欄組成**,其餘一律不出現(留 `undefined`,mapper `:76-86` 的 `!== undefined` 判準會整批略過 —— 這條路是它明文留的:「`undefined`(非表單路徑)才略過」)。

```ts
// 形狀示意(非最終 code):白名單常數 = 表單欄位的單一真相,parse 與 patch 都讀它
const C4A_FORM_FIELDS = ['name', 'year', 'engine', 'km', 'mods', 'service'] as const;
const patch = Object.fromEntries(C4A_FORM_FIELDS.map((k) => [k, parsed.data[k]]));
```
⇒ 加欄位時只改那個常數一處;**沒被加進去的欄永遠不會被寫**。

### ✅ 已裁定(主視窗 2026-08-14 夜):reuse `VehicleInput`,但**理由換掉、且附條件**

**C1 的裁定不能盲目套過來。** C1 裁「reuse `ProfileInput`」的理由是**它帶著兩條被審過的 regex**;
`VehicleInput` 沒有那種東西,它的價值只是 `.default('')` 這類瑣碎規則,**而 `.default(null)` 在後台情境是個陷阱**。

⇒ **C4 仍 reuse,但理由改成「省掉手抄整份形狀」** —— 這是個弱得多的理由,所以配了硬條件:

> 🔴 **§4-2 那格負測(不在 `C4A_FORM_FIELDS` 裡的欄出現在 patch → 必須紅)是 reuse 的「條件」,不是附加項。**
> **沒有那格負測,就不准 reuse `VehicleInput`** —— 因為 reuse 帶進來的正是那個陷阱,
> 而唯一擋住它的東西就是那格測試。拿掉測試留下 reuse = 把陷阱裝上、把守門拆掉。

### 🔴 開工紀律(主視窗裁定,寫死):**先讓它紅一次,紅了才修**

C4 開工第一件事**不是**寫修法,是把 §4-0/§4-1/§4-2 三格(雙向對照 + 不變式 + 負測)做出來、**跑到紅**。
理由(逐字帶過來):如果 §1 那條推論其實不成立(例如 admin 表單根本走另一條路),
**你會在寫完修法之後才發現,而那時測試是綠的、你會以為修好了**。
⇒ **紅過一次是這條推論成立的唯一證據。** 不是「寫測試順便驗」,是**先重現、再修**。

## 2. 字典鍵的「存在性」驗證:admin 拿不到,也不該做

- DB CHECK 只管**成對**:`customer_vehicles_dict_pair_chk` = `(dict_brand_name IS NULL) = (dict_model_name IS NULL)`(`20260716150000:25-26`)。**不驗存不存在於 taxonomy。**
- 「存在於 taxonomy」的 fail-closed 驗證**只在 storefront server action**:`validateDictPair`(`vehicle/actions.ts:41-48`),而它依賴 `fetchVehicleTaxonomy`。
- 🔴 `fetchVehicleTaxonomy` 住在 **`apps/storefront/src/lib/products.ts:732`**(數法 `grep -rln "export async function fetchVehicleTaxonomy" apps packages` = 1 檔)⇒ **admin 跨 app 匯入不到**;而它是分頁查 view + `unstable_cache` 900s + `MAX_PAGES` 截斷保護的一大坨,**搬過去不便宜**。

⇒ **本片決定不做 dict 編輯**(理由 = 上面三條:admin 匯入不到 taxonomy、搬過去不便宜、而 §1 的白名單本來就不會帶那兩欄)。
⚠️ **這是設計選擇,不是事實**(A 窗 N2;第一版把「後台表單不會有 dict 欄位」當事實寫,那是還不存在的表單)。
分清楚很重要:**若 Sean 之後要「後台能修正失效的 dict 對」,§1 的白名單與 §4-2 的負測方向會相反**(那時要的是「能寫」不是「不能寫」)⇒ 那是**改設計**,不是修 bug,要重開一片並回頭改這兩處。
⚠️ 現行代價:**後台無法修正一筆「dict 對已失效」的舊資料**(例如 taxonomy 改名後)。既有債、非本片引入,列進誠實缺口、不擴張。

## 3. 與 C3 同族的兩個前提(同樣不成立)—— 且我的 Q-C-3 問窄了

`_vehicle-primary.ts:12` 逐字「best-effort 兩步(Sean Q2=A):兩次 repo 呼叫非單一 DB transaction、**單人風險可忽略**」;`:28`「RLS 是 ownership 邊界,本 app 層檢查為其上 **defense-in-depth**」;`delete-vehicle.ts:13` 同款。
⇒ **與地址逐字同構**,§C3 前置調查 §3 那兩條原封適用(admin 是兩個人 / admin 注 service_role ⇒ RLS 那層不存在)。

🔴 **我自己的錯要標出來**:C-004 信裡送出的 **Q-C-3 只寫了「地址」**,但同一份 code 形狀在**愛車**上一模一樣。
⇒ 已在 C-005 請主視窗補正範圍,**不重開一題**;主視窗以補充信送達,Sean 收到了。

### ✅ Q-C-3 已拍板 = **B**(Sean 2026-08-14),**本拍板同時管愛車**

「設主要 / 刪除」要走 **SECURITY DEFINER RPC 單交易**,不接受 best-effort 兩步。
⇒ 多一支 migration(**版本號跟主視窗要,不自己編**)、**片型升級為高風險片**(鐵則 12③)、**多一個 Sean 手動 apply 停點**、應用層不得先於 apply 上線。
⇒ 拆片性質改變:**C4a(新增+編輯)= 標準片、可先動;C4b(刪除+設主要)= 高風險片、卡 migration + apply**。
過程記錄(不抹平):我當初推薦 A 並附「這是推論不是量測」——Sean 選 B 後,那句的意義是**「判競態窄的依據沒被量測過,而拍板往安全側走」**,不是為 A 辯護。

## 4. 驗收要多的五格(C3 沒有、C4 才有)

> 🔴 **這幾格改寫過兩輪(三格 → 四格 → 五格;A 窗 M2 與其確認輪 F1/F2)**:第一版的守門**釘的是 dict 兩欄**,
> 也就是說 —— **病灶改成白名單了,守門卻還是黑名單形狀**。那等於修了病、守門還在守症狀,
> **下一個人加/減欄位時它照樣綠**。守門必須跟病灶同形狀。

> 🔴 **第三版(A 窗確認輪 F1/F2,我開檔驗過 `schemas/src/index.ts:144` 與 `mappers/vehicle.ts:81` 才折)**:
> 第二版的白名單**只綁住一個方向** —— 擋住了「常數以外的欄」,卻**沒有任何東西綁住「常數 = 表單真正有的欄」**。
> **原病可以從另一側原樣復發**:有人把「改裝」輸入框從 JSX 拿掉、**忘了從常數移除 `'mods'`**
> ⇒ `mods: z.string().default('')`(`:144`)⇒ `parsed.data.mods` = `''` ⇒ 白名單照樣挑進 patch
> ⇒ `mappers/vehicle.ts:81` 逐字 `if (patch.mods !== undefined) row.mods = patch.mods;` ⇒ `'' !== undefined` ⇒ **照寫,每次存檔靜默清空客人的改裝欄**,而下面四格全綠。
> 🔴 **解藥是我自己寫在隔壁檔的那條**:`c1-prep-notes.md` §4-2 逐字「只用 `it.each` 走訪**同一顆常數** = 清單少一欄時測項也跟著少一條、全綠,**是循環論證**」。**C1 套了、C4 沒套。** ⇒ 補格 0。

0. 🔴 **雙向對照格(F1;沒有這格,白名單只擋得住一半)**:把 `C4A_FORM_FIELDS` 與**表單元件實際渲染的欄位**對照,兩側**互為子集**。
   來源必須是**另一側**(從表單元件那邊取欄名,或退而求其次寫一份**手寫陣列**)——
   **不得只 `it.each` 走訪 `C4A_FORM_FIELDS` 自己**,那是循環論證(`c1-prep-notes.md` §4-2 同一條理由)。
   失敗情境:JSX 拿掉輸入框但常數沒改 ⇒ **這格必須紅**。
1. 🔴 **不變式格**:斷言 **patch 的 key 集合 `⊆` `C4A_FORM_FIELDS`**。
   ⚠️ **F2:斷言吃的 patch 必須是「生產路徑實際吐出的那個」,不得由測試自己組。**
   理由:若 patch 由 `Object.fromEntries(C4A_FORM_FIELDS.map(...))` 建構,`Object.keys(patch)` **由建構方式保證恆等於常數** ⇒ 測試自己組一個來斷言 = **恆綠格**。
   吃生產輸出才有力(它守的回歸是「未來有人把建構方式改回 `patch = parsed.data`」)。**這格不拿掉**,只是把輸入來源釘死。
2. 🔴 **負測(取代原本的「把 dict 兩欄放回去」)**:**任何一個不在 `C4A_FORM_FIELDS` 裡的欄出現在 patch → 必須紅。**
   實作上至少涵蓋兩顆**不同成因**的:`dictBrandName`(`.default(null)`)與 **`isPrimary`(`.default(false)`)** ——
   後者是第一版整個漏掉的那顆,**只測 dict 這格會綠得毫無意義**。
3. **端到端保值格**:拿一筆 `dict_brand_name` 有值**且** `is_primary=true` 的愛車,從後台只改「里程」存檔 → 重讀 DB,
   **dict 兩欄與 `is_primary` 皆為原值**。這格**必須打 DB 或 mapper 的實際輸出**,不能只斷言表單送了什麼(病灶在 mapper 那層)。
4. **A 客的 vehicleId 送 B 客的頁面 → 被拒且 DB 零變更**(同 C3,理由見 §3)。

## 5. 片型 · 檔數 · 誠實缺口

**片型(Q-C-3=B 後改判)**:**C4a 新增+編輯 = 標準片**;**C4b 刪除+設主要 = 高風險片**(鐵則 12③,多一支 migration + apply 停點)。兩者都命中鐵則 8。
檔數與 C3 同構、**暫估** 7-8 檔,C4b 另加 1 支 migration(**版本號跟主視窗要**)。
⚠️ 「暫估」不是「數過」:新檔切法取決於表單是不是 client component(照 C3 §4 的既有拍板走 `useActionState` ⇒ 需要獨立的 action-state 檔)。

**誠實缺口**
- 全部來自讀 repo,**零執行**:沒跑測試、沒開瀏覽器、**沒對正式庫查過任何一筆愛車資料**。
- §1 的「靜默清空」我**沒有實跑構造過**,是從三處字面(schema 的 `.default(…)` / mapper `!== undefined` / storefront 的用法)推出來的;`isPrimary` 那顆是 **A 窗複驗才補上的**,我第一版漏了。**推論鏈每一環都有 `檔案:行號`,但推論不等於量測** ⇒ C4 開工第一件事就是把它變成 §4 那兩格測試,**先讓它紅一次**再修。
- **沒讀** `InlineVehicleForm.tsx`(364 行)與 `add/update-vehicle.ts` 全文 ⇒ 可能有我沒看到的 dict 相關分支。
- **沒查**:正式庫現在有幾筆愛車帶著非空 dict 對(= §1 這條的實際影響面)。要數得對 DB 跑,今晚不做。
