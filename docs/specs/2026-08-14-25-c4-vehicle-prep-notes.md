# #25 片 C4(愛車 CRUD)前置調查(C 窗 2026-08-14 夜;**零 code、Sean 尚未批 plan**)

> 讀過的檔(7 支):`schemas/src/index.ts`(§VehicleInput `:135-160`)`mappers/vehicle.ts:70-87` `SupabaseVehicleAdapter.ts:60-82` `_vehicle-primary.ts` `delete-vehicle.ts` `app/account/vehicle/actions.ts:37-48,93-95,144-147` `20260716150000`(dict 欄 migration)`storefront/src/lib/products.ts:695-739`。
> **未讀**:`add-vehicle.ts` `update-vehicle.ts` 全文、`InlineVehicleForm.tsx`(364 行)。

## 1. 🔴🔴 本片最重要的一條:照抄 storefront 會**靜默清掉客人的字典鍵**

三個事實疊起來變成一個無症狀的資料損壞:

1. `VehicleInput` 的 dict 兩欄是 **`.default(null)`**(`schemas/src/index.ts:153-154`),註解 `:150-151` 逐字說明這是**故意的**:「舊 caller 不帶也恆出現在 `parsed.data` → update patch **恆寫兩欄**」。
2. `mapVehiclePatchToRow`(`mappers/vehicle.ts:85-86`)對 dict 兩欄的判準是 **`!== undefined` 就寫**,註解 `:83-84` 逐字:「schema default 保證 delivery 層**恆帶**、含雙 null」。
3. storefront 就是這樣用的(`vehicle/actions.ts:144-147`)—— 對它是**正確的**,因為客人在表單上真的能把 dict 車改成自由輸入,那時**必須**用雙 null 覆蓋、不能殘留舊對。

⇒ **後台表單不會有 dict 欄位**(員工編的是車型/年份/引擎號/里程/改裝/保養)。
若 C4 照抄 storefront 的 `patch = parsed.data`,**每一次員工存檔都會把 `dict_brand_name` / `dict_model_name` 寫成 null**。
**症狀:沒有症狀。** 三綠會綠、DB CHECK 會過(雙 null 成對合法)、schema `.refine` 會過(成對)。
壞的地方在別處:那對鍵是**首頁愛車 chips 走「精確 lookup 直套」用的**(`20260716150000:31` COMMENT 逐字)⇒ 客人的愛車從此改走字面比對流,**而沒有人會收到通知**。

**修法(一行,而且 mapper 明文支援)**:admin 的 patch **不要帶** dict 兩欄 ——
`mappers/vehicle.ts:86` 註解逐字留了這條路:「**`undefined`(非表單路徑)才略過**」。
⇒ `const { dictBrandName, dictModelName, ...patch } = parsed.data;` 丟掉那兩顆即可,dict 對原樣保留。

**⚠️ C1 的裁定不能盲目套過來**:C1 裁「reuse `ProfileInput`」是因為它帶著兩條被審過的 regex。
`VehicleInput` 的價值主要是 `.default('')` 這種瑣碎規則,**而它的 `.default(null)` 在後台情境是個陷阱**。
仍建議 reuse(丟兩顆鍵比手抄整份便宜),但**理由不同、而且必須配一格測試**(見 §4)。

## 2. 字典鍵的「存在性」驗證:admin 拿不到,也不該做

- DB CHECK 只管**成對**:`customer_vehicles_dict_pair_chk` = `(dict_brand_name IS NULL) = (dict_model_name IS NULL)`(`20260716150000:25-26`)。**不驗存不存在於 taxonomy。**
- 「存在於 taxonomy」的 fail-closed 驗證**只在 storefront server action**:`validateDictPair`(`vehicle/actions.ts:41-48`),而它依賴 `fetchVehicleTaxonomy`。
- 🔴 `fetchVehicleTaxonomy` 住在 **`apps/storefront/src/lib/products.ts:732`**(數法 `grep -rln "export async function fetchVehicleTaxonomy" apps packages` = 1 檔)⇒ **admin 跨 app 匯入不到**;而它是分頁查 view + `unstable_cache` 900s + `MAX_PAGES` 截斷保護的一大坨,**搬過去不便宜**。

⇒ **結論:C4 不提供 dict 編輯功能。** 這不是偷懶,是 §1 的修法本身就把 dict 對變成「後台只讀不寫」⇒ **admin 路徑永遠不會寫入未經驗證的 dict 對**,存在性驗證的需求從源頭消失。
⚠️ 代價寫清楚:**後台無法修正一筆「dict 對已失效」的舊資料**(例如 taxonomy 改名後)。這是既有債、不是本片引入的,列進誠實缺口、不擴張。

## 3. 與 C3 同族的兩個前提(同樣不成立)—— 且我的 Q-C-3 問窄了

`_vehicle-primary.ts:12` 逐字「best-effort 兩步(Sean Q2=A):兩次 repo 呼叫非單一 DB transaction、**單人風險可忽略**」;`:28`「RLS 是 ownership 邊界,本 app 層檢查為其上 **defense-in-depth**」;`delete-vehicle.ts:13` 同款。
⇒ **與地址逐字同構**,§C3 前置調查 §3 那兩條原封適用(admin 是兩個人 / admin 注 service_role ⇒ RLS 那層不存在)。

🔴 **我自己的錯要標出來**:C-004 信裡送出的 **Q-C-3 只寫了「地址」**,但同一份 code 形狀在**愛車**上一模一樣。
⇒ **Q-C-3 的答案必須同時涵蓋愛車**,否則會出現「地址拍了、愛車沒拍」的縫。已在 C-005 信裡請主視窗補正,**不重開一題**(同一件事拆兩題只會讓 Sean 多答一次)。

## 4. 驗收要多的三格(C3 沒有、C4 才有)

1. 🔴 **dict 對保留**:拿一筆 `dict_brand_name` 有值的愛車,從後台改「里程」存檔 → 重讀 DB,**兩欄仍是原值**。
   這格**必須打 DB 或打 mapper 的實際輸出**,不能只斷言表單送了什麼 —— 病灶在 mapper 那層。
2. **負測**:故意把 dict 兩欄放進 patch(模擬照抄 storefront 的寫法)→ 該格**必須紅**。
   (這是 §1 那條的守門;沒有這格,未來有人「順手對齊 storefront」就會把 bug 裝回來、而且照樣全綠。)
3. **A 客的 vehicleId 送 B 客的頁面 → 被拒且 DB 零變更**(同 C3,理由見 §3)。

## 5. 片型 · 檔數 · 誠實缺口

**片型 = 標準片**(不碰 packages/ui、不碰錢/schema/auth)。**鐵則 8 命中**。
檔數與 C3 同構、**暫估** 7-8 檔;建議同樣拆兩片(C4a 新增+編輯 / C4b 刪除+設主要)。
⚠️ 「暫估」不是「數過」:新檔切法取決於表單是不是 client component(照 C3 §4 的既有拍板走 `useActionState` ⇒ 需要獨立的 action-state 檔)。

**誠實缺口**
- 全部來自讀 repo,**零執行**:沒跑測試、沒開瀏覽器、**沒對正式庫查過任何一筆愛車資料**。
- §1 的「靜默清空」我**沒有實跑構造過**,是從三處字面(schema `.default(null)` / mapper `!== undefined` / storefront 的用法)推出來的。**推論鏈每一環都有 `檔案:行號`,但推論不等於量測** ⇒ C4 開工第一件事就是把它變成 §4 那兩格測試,**先讓它紅一次**再修。
- **沒讀** `InlineVehicleForm.tsx`(364 行)與 `add/update-vehicle.ts` 全文 ⇒ 可能有我沒看到的 dict 相關分支。
- **沒查**:正式庫現在有幾筆愛車帶著非空 dict 對(= §1 這條的實際影響面)。要數得對 DB 跑,今晚不做。
