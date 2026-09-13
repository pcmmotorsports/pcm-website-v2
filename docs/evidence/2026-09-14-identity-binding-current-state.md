# 盤查 · 「身份認證綁定到登入 quote 帳號」現況(2026-09-14, A 窗唯讀)

> 主視窗派工, 為 Sean 09-13 排在整包之後的下一件(memory `project_0913-next-bind-identity-to-quote-login`)。
> **只讀檔, 沒碰任何庫**;標 📏 = 檔:行親讀, 標 🧮 = 推的, 標 ❓ = 要有庫連線才答得出。
> 報價單 repo = `~/API大量上架/PCM報價單-V2`(main cda1ff3d);後台 = `~/pcm-shop`(agent/shop-6)。

## ① 員工今天怎麼登入 / 兩條路各自怎麼對到 staff.id

**只有一條真的路:quote 站帳密 → 映射表 → SSO 票(v:2)→ 後台 `staff` 表。**

```
quote  app/api/admin/login/route.ts            帳號欄有值 ⇒ namedLogin
quote  lib/identity.ts:342-351   📏             verifyPassword(Supabase Auth) → lookupStaffRow(uuid)
quote  lib/identity.ts:232-239   📏             .from('admin_user_staff_map') 用 auth_user_id 查 staff_id;查無 ⇒ deny(:345)
                                                ⇒ sub = { kind:'user', staff_id }(:351)
admin  app/api/sso/callback/route.ts:129  📏    exchangeCode 拿 {amr, auth_time, sub?}
admin  app/api/sso/callback/route.ts:192-201 📏 planStaffGate(sub) ⇒ user ⇒ resolveActiveStaffById(staff_id)
                                                查 A 庫 public.staff, 非 is_active / 查無 / DB 錯 ⇒ 同一個 null ⇒ 拒登入
admin  app/api/sso/callback/route.ts:217  📏    buildAdminSession(amr, auth_time, sub) ⇒ 簽 v:2 票(15 分鐘, 靜默續期)
admin  lib/session/actor.ts:134-138  📏         第 1 層:票 v:2 且 sub.kind='user' ⇒ resolveStaff(staff_id) ⇒ source='ticket'
```
- 第 2 層 `actor.ts:160`:`ADMIN_REQUIRE_REAL_IDENTITY=1` ⇒ 票上沒身分一律 `stale-ticket`(actor null)。
  📏 `docs/launch-todo.md:569` 記「**已上線 =1**」⇒ 🧮 正式站第 3 層(自選 cookie `pcm_admin_actor`, `actor.ts:163-166`)**已經走不到**;它只剩本機 probe / 旗標沒開的環境。
- 另兩種票沒有 staff_id:`fallback`(quote 共用密碼 / 備用碼 / TOTP 第二段, `login/route.ts:393-441` 📏)與 `bootstrap`。
  後台對它們:`read-gate.ts:46-49` 📏 **唯讀放行、不查名單**;`actor.ts:139-144` actor=null ⇒ 寫入一律擋(`authorize.ts`)。
  ⚠️ 已登記的洞(`read-gate.ts:48` 逐字):停用的員工若知道共用密碼, 走 fallback 照樣**讀得到**(`#935` / `#645`)。
- 🧮 結論:今天能以具名身分進後台的人 = 映射表有列的 Auth 帳號 = **sean、shopee1(staff_2)兩個**;其餘沒有路。

## ② A 庫 `public.staff` 那幾列是誰

| id | 來源(檔:行)📏 | 真人? | is_active |
|---|---|---|---|
| sean | `20260726120000_m4b_e8a1_staff_table.sql:34` | 真人(老闆, is_manager) | t |
| staff_1 | 同檔 :35「員工 1(占位)」 | 占位;映射表**刻意空著**(Sean 08-21 拍「先不加」, quote `lib/identity.ts:88-93`) | t |
| staff_2 | 同檔 :36「員工 2(占位)」 | 真人 = shopee1(映射表已綁) | t |
| payment_confirmer | `20260810160000_m4b_e10_op3_confirm_card_leg.sql:329-330` | 系統(TapPay 付款確認) | **f** |
| op4_backfill | `20260811050000_m4b_e10_op4_backfill_card_ledger.sql:75-76` | 系統(歷史回填) | **f** |
| ❓ 第 6 列 | migrations 零命中;🧮 唯一長得出來的路 = 設定›員工 的 RPC `admin_staff_create`(`20260912050000:115`, 09-12 起) | ❓ | ❓ |

⇒ 真人 2 + 占位 1 + 系統 2 + ❓1。系統帳號不進映射表(它們只是 `admin_audit_log.actor` 字串, 不經登入)。
❓ 第 6 列要一發 `select id,label,is_manager,is_active,created_at from public.staff` 才知道 —— 本盤查沒連庫。

## ③ 映射表加一列要動哪裡

- 表在 **報價單庫**(不是 A 庫), 名 `public.admin_user_staff_map`;**建表 SQL 不在任何 migrations 目錄**:
  唯一全文 = 網站 repo `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql`(779 行草稿;E3 09-08 登記
  `PCM報價單-V2/docs/decisions/2026-09-08-admin_user_staff_map-登記給網站側.md`, 線上 2 列、RLS 開、policy 0)。
- 白名單 = CHECK `admin_user_staff_map_staff_whitelist` `staff_id IN ('sean','staff_1','staff_2')`(草稿 :145-146 📏)。
- 寫入:`service_role` **沒有 INSERT**(quote `lib/identity.ts:96-99` 📏, 刻意)⇒ 加一列只能 **postgres 角色貼 migration**;
  三個 trigger 擋 DELETE / UPDATE 改綁 / TRUNCATE(草稿 :173-228)⇒ 綁錯了不能改, 只能加新 staff_id(永不重用, Sean 08-16)。
- 🧮 加第四個人今天 = ① Supabase Auth 開帳號(Sean 有介面)② 一支報價單庫 migration:`ALTER TABLE … DROP CONSTRAINT`
  + 重加含新值的 CHECK + `INSERT (auth_user_id, staff_id)`;③ A 庫 `staff` 也要有同 id 的 active 列(設定›員工 建得出來)。
  ⚠️ 兩庫各一步, 今天沒有任何介面把它們串起來;跨 repo ⇒ 報價單窗要一起。

## ④ 「綁定」最省的兩案

| | 甲 改 CHECK 白名單(每加一人一支 migration) | 乙 表驅動(拿掉 CHECK, 改由 A 庫 staff 當來源) |
|---|---|---|
| 改什麼 | 報價單庫:DROP + 重加 CHECK + INSERT 一列;A 庫:`admin_staff_create`(已有)。碼零改 | 報價單庫:DROP CHECK;quote `lookupStaffRow` 之後多一道「staff_id 要在 A 庫 active」—— 而 quote 連不到 A 庫 ⇒ 實際只能靠後台 callback `resolveActiveStaffById`(:194)那道既有閘當唯一參照;另要一支【有 GRANT 的寫入 RPC】或仍由 postgres INSERT |
| 影響 | 零程式風險;每次加人要 Sean 貼一支 SQL(常設代貼授權 09-08 可代)。staff_id 永不重用照舊 | 白名單消失 ⇒ 「打錯 staff_id」只剩後台那道 active 閘擋(查無 ⇒ 拒登入, 錯不會靜默);若開寫入 RPC = 多一條「程式路徑長出管理員」, 正是當初刻意封掉的 |
| rollback | 再貼一支把 CHECK 換回原三值(表裡若已有第四值 ⇒ 要先刪列, 而 DELETE 有 trigger 擋 ⇒ **不可逆**, 要先 DROP trigger) | 重加 CHECK(同上, 表裡有新值就加不回) |
| 推薦 | ✅ 人少(今天 2 人、可見未來個位數), 一人一支 migration 是可接受的成本, 而且**零碼改、零新權限** | 只有在「加人變成常態」才值得;今天不值 |

## 先要 Sean 答的三題(memory 那三題, 盤查後收窄成兩選項)
見主視窗回報;本檔只放事實。
