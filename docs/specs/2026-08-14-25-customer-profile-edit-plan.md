# #25 改客人資料 — 施工 plan(C 窗 2026-08-14 夜;**待 Sean 批**)

> 目標 = Sean 2026-07-25 逐字「可以所有會員資料」。現況 🟡 只能改 tier + 儲值金。
> **本檔零 code。四片全部 ≥3 檔 ⇒ 全部命中鐵則 8,一片都不准先動。**
> 條目引用複驗:`customer-detail.tsx:161-166` ✅ 逐字符合;`customer-detail-sections.tsx:94-138` ✅ 但**那是地址**,愛車在 `:140-185`(條目行號少寫一段,本檔更正)。

## 1. 逐欄盤點(每格都開過檔)

| 欄 | 存哪 | 可不可寫 | 現成的路 |
|---|---|---|---|
| 姓名/電話/生日 | `customers.name/phone/birthday` | ✅ service_role 有欄級 GRANT(`20260717010000:175`) | `ICustomerRepository.update`(`ICustomerRepository.ts:26-29`)→ `SupabaseCustomerAdapter.ts:95-109`;schema `ProfileInput`(`packages/schemas/src/index.ts:166-183`);use-case `update-profile.ts:16-22`;admin repo getter 已在 `customer-repository.ts:23-25` |
| **Email** | `customers.email` + **`auth.users.email`(登入帳號真身)** | ❌ **兩邊都沒有路** | 見 §2 |
| 會員等級 | `customers.tier` | ✅ 已可改 | `admin_set_customer_tier` RPC |
| 地址(0..n) | `customer_addresses` | ✅ 表級 GRANT 全開(`20260523034911:236`) | adapter CRUD 齊(`SupabaseAddressAdapter.ts:42/55/70/84`);use-case `add/update/delete-address.ts` + `set-default-address.ts`;schema `AddressInput`(`index.ts:116-127`);admin getter `customer-repository.ts:151-153` |
| 愛車(0..n) | `customer_vehicles` | ✅ 表級 GRANT 全開(`:240`) | adapter CRUD 齊(`SupabaseVehicleAdapter.ts:36/49/64/78`);use-case `add/update/delete-vehicle.ts` + `set-primary-vehicle.ts`;schema `VehicleInput`(`index.ts:135-160`);admin getter `:155-157` |

**結論:除了 Email,零新 DB 面、零新 adapter、零新 schema。缺的只有 admin 端的「表單 + server action」兩層。**
(數法 = 上表每一格的 `檔案:行號` 逐格開檔確認;「零新 adapter」的反面數法 = `grep -n "async create\|async update\|async delete" packages/adapters/src/supabase/SupabaseAddressAdapter.ts packages/adapters/src/supabase/SupabaseVehicleAdapter.ts` 回 6 行,即兩支 CRUD 都齊。)
⚠️ 但 `apps/admin/package.json` 的 deps 只有 `@pcm/adapters` / `@pcm/domain`(數法 = `grep -A12 '"dependencies"' apps/admin/package.json`,`@pcm` 開頭只兩行)⇒ 要 reuse schema 與 use-case,得**加 `@pcm/schemas`、`@pcm/ports`、`@pcm/use-cases` 三個 workspace dep**(片 C1 一次加完)。

## 2. 🔴 Email = 獨立一片、鐵則 12②+③ 雙中標、**不排進本批**

實查三件事,三件都擋:
1. **DB 端根本沒開**:`20260717010000:174-175` 把 service_role 的表級 UPDATE 撤掉、只回 `(name, phone, birthday, updated_at)`;`:193-198` 還有 fail-closed 斷言釘死。`authenticated` 同樣不含 email(`20260523034911:227,231`)。⇒ **service key 直接 update email 會被 DB 擋**,不是「沒人寫」而是「寫了會炸」。
2. **登入帳號在 Supabase Auth**:`customers.email` 只在 `handle_new_auth_user`(`20260523034911:281-284`)建列時抄一次,**全 repo 沒有 UPDATE 方向的同步 trigger**(grep `auth.users` 全 migrations 只命中 INSERT trigger)。
3. **Auth 端沒有這支方法,但管道是通的(2026-08-14 夜自我更正)**:`SupabaseAuthAdapter.ts` 只有 signUp(:41)/signIn(:63)/`sendPasswordResetEmail`(:88-90)/`updateUser({password})`(:99)。改**別人**的 email 要走 Admin API `auth.admin.updateUserById` —— 該字面在 1083 個 `.ts`/`.tsx` 檔中零命中(數法 `grep -rn "updateUserById" --include='*.ts' --include='*.tsx' apps packages scripts`,分母 `grep -rl "" --include='*.ts' --include='*.tsx' apps packages scripts | wc -l` = 1083)。
   ⚠️ **但「零命中」不等於「做不到」**:同一個 Admin API 在 `apps/storefront/src/lib/auth/line-admin.ts:38`(`generateLink`)與 `:65`(`createUser`)**已經在用**,client 由 `createSupabaseServiceClient()` 建(`:21`)—— 那正是 admin 端 `customer-repository.ts:24` 用的同一支 factory。⇒ **管道現成,缺的只是沒人呼叫 `updateUserById`**,C2 的成本比本檔第一版寫的低。真正的擋點是上面第 1、2 條(DB 欄級 GRANT + 無同步 trigger),不是第 3 條。

⇒ 要做就得同時開:新 migration(欄級 GRANT 或 SECURITY DEFINER RPC)+ 接 Auth Admin API + 處理「auth 改了 / customers 沒改」的半套失敗(客人用新信箱登入但後台顯示舊的,或客人直接登不進去)。
**建議:本批不做,`customers.email` 該欄維持唯讀並加一行說明「Email = 登入帳號,要另開片」。**

## 3. 地址 / 愛車 一對多的三種操作形狀

| 操作 | 走哪 | 形狀 |
|---|---|---|
| 新增 | `addAddress` / `addVehicle` | 清單尾端一顆「新增」鈕 → 展開 inline 表單 → submit → PRG `?r=saved`(鏡像 `tier-actions.ts:26-29,74-77`) |
| 編輯 | `updateAddress` / `updateVehicle` | 每一列一顆「編輯」鈕 → 同一支表單帶 defaultValue |
| 刪除 | `deleteAddress` / `deleteVehicle` | 每列一顆「刪除」,**要二次確認**(不可逆) |
| 設預設/主要 | `setDefaultAddress` / `setPrimaryVehicle` | 每列一顆 radio;DB partial unique index 守「至多一筆」(`20260523034911:64` 地址 / `:88` 愛車) |

🔴 **承重點**:use-case 的 ownership 靠 `verifyAddressOwned`(`update-address.ts:38-43`)這層 app 檢查;admin 走 service_role = **RLS 被 bypass、app 層是唯一那道門**。⇒ 驗收必含「拿 A 客的 addressId 送到 B 客的頁面會被擋」這格負測。
🔴 **`readOnly` 必須接**:`customer-detail.tsx` 同一支被整頁版(`app/customers/[id]/page.tsx:54`)與訂單面板唯讀版(`customer-panel.tsx:73`)共用,新表單一律包在 `!readOnly` 裡(鏡像 `:166`、`:173`);兩個 section 目前沒收 `readOnly` prop,要補傳。

## 4. 片型 / 鐵則 / 驗收

| 片 | 內容 | 檔數(數過,不是估) | 片型 | 鐵則 |
|---|---|---|---|---|
| **C1** | 姓名/電話/生日 | 7 = `package.json` + `profile-form.ts`(新) + `profile-actions.ts`(新) + `profile-edit-form.tsx`(新) + `customer-detail.tsx` + `profile-form.test.ts`(新) + `customer-detail` smoke test | 標準片 | **鐵則 8 命中** |
| **C2** | Email | 未估(要先開 migration + Auth Admin API) | **高風險片** | **鐵則 8 + 12②auth + 12③schema/GRANT** |
| **C3** | 地址 CRUD | 6 = `address-form.ts` + `address-actions.ts` + `address-edit-form.tsx`(皆新) + `customer-detail-sections.tsx` + `customer-detail.tsx` + `address-form.test.ts`(新) | 標準片 | **鐵則 8 命中** |
| **C4** | 愛車 CRUD | 6(同 C3 形狀) | 標準片 | **鐵則 8 命中** |

**驗收條件(每條 yes/no)**
1. 整頁版可改姓名/電話/生日並存檔成功,重整後值還在。
2. 訂單面板(`readOnly`)**看不到任何新表單**(截圖或 DOM 斷言)。
3. 地址/愛車:新增 → 編輯 → 設預設 → 刪除四動作各跑一次都成功。
4. 負測:A 客的 addressId 送 B 客的 action → 被拒、DB 零變更。
5. 負測:表單送 `tier` / `wallet_balance` / `email` 欄 → 被 strip、DB 對應欄零變更。
6. 三綠(typecheck+lint+build)+ `vitest` 全綠,新增測試至少涵蓋 4 與 5。
7. `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1-A `#25` 那列由 🟡 改標,且**明寫 Email 仍不可改**。

**誠實缺口(我沒驗的)**
- ❌ **沒對正式庫跑過任何查詢** —— §1/§2 的 GRANT 結論全部來自 migration 檔字面。migration 有 fail-closed 斷言(`20260717010000:193-198`)所以可信度高,但**「repo 裡的註解不是正式庫事實」這條教訓照樣適用**;C2 開工前要對正式庫實查 `has_column_privilege`。
- ❌ 沒量過改完之後的視覺(表單塞進兩張卡會不會擠爆);C1 交件時要附真瀏覽器截圖。
- ⚠️ `AddressInput.email` 現在是**必填**(`index.ts:125`,TapPay ≤40 字限制)⇒ 員工去編輯一筆**存量沒有 Email 的舊地址**時會被逼著填一個。這是既有規則的連帶效果、不是本片引入的,但員工會撞到 ⇒ 已寫成 Q-C-2 問 Sean。
- ⚠️ 未擴張:`#28` 會員密碼重設(機制在 `SupabaseAuthAdapter.ts:87-90`、admin 端零觸發入口)與 `#26` 員工帳號,**兩項都不在本 plan 內**。
