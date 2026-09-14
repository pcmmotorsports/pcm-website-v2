# Runbook · 新員工:後台建 staff 列 + 綁 quote 登入帳號(2026-09-14)

> Sean 2026-09-14 拍:Q6 甲(現況機制就是「綁定」, 不重做)/ Q7 甲(每加一人貼一支**報價單庫** migration, 主視窗貼)/ Q8 甲(staff_1 留占位;第 6 列 test_01「TEST」= 已停用的測試帳號)。
> 背景與檔:行在 `docs/evidence/2026-09-14-identity-binding-current-state.md`。本檔給**主視窗照做**, 一次加一個人。
> 🛑 **綁錯不可逆**(§5)⇒ 每一步的 id 都要**兩個人各自唸一遍**再貼。

## 0. 先決
- 兩個庫、兩個 repo:A 庫 = 網站 repo(`~/pcm-website-v2`, `supabase/migrations/`);**報價單庫** = `~/API大量上架/PCM報價單-V2`(`supabase/migrations/`, 版本檔名 `YYYYMMDDHHMMSS_*.sql`;那邊 DDL 慣例走 MCP `apply_migration`, 套完 `list_migrations` 拿 version 當檔名 —— `docs/decisions/2026-09-08-migration漂移盤點.md:298`)。
- 映射表 `public.admin_user_staff_map`(報價單庫)的建表 SQL **只在**網站 repo `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql`(草稿, 已登記);線上是 2 列(sean / staff_2)。
- 代號規則:`^[a-z0-9_]{1,64}$`、**永不重用**(Sean 08-16)、建後不可改。新人拿新代號 `staff_3`、`staff_4`…;不撿 `staff_1`(占位, 08-21 拍「先不加」)。

## ① A 庫:後台建 staff 列(管理者做, 有介面)
1. 管理者登入後台 → 設定 › 員工管理 → 右上「＋ 新增員工」(`/settings/staff?new=1`;非管理者那顆鈕是灰的)。
2. 填 代碼(= `staff_id`, 例 `staff_3`)/ 顯示名 / 是否管理者 → 送出(RPC `admin_staff_create`, 每筆進稽核)。
3. 核:員工表多一列、`is_active = true`。**這一步之後他還不能登入** —— 登入走報價單庫, 見 ②。

## ② quote 站帳號 + 報價單庫 migration(主視窗貼)
1. **開 Auth 帳號**:報價單庫的 Supabase Dashboard → Authentication → Users → Add user(email + 初始密碼;Sean 開得到)。
   拿 **auth user id(uuid)**:同一頁點那位 → User UID;或 SQL Editor `select id, email from auth.users where email = '<他的 email>';`。
2. 寫 migration `supabase/migrations/<version>_admin_user_staff_map_add_<staff_id>.sql`(樣板, 三個 `<…>` 都要換):
   ```sql
   BEGIN;
   SET LOCAL lock_timeout = '5s';
   -- ① 白名單多一個代號(只增不減;現名單抄線上的:sean / staff_1 / staff_2 + 之前加過的)
   ALTER TABLE public.admin_user_staff_map DROP CONSTRAINT admin_user_staff_map_staff_whitelist;
   ALTER TABLE public.admin_user_staff_map ADD CONSTRAINT admin_user_staff_map_staff_whitelist
     CHECK (staff_id IN ('sean', 'staff_1', 'staff_2', '<staff_id>'));
   -- ② 綁定(auth_user_id 必須已存在於 auth.users;must_change_password_at 走 DEFAULT now() ⇒ 首次登入強制改密碼)
   INSERT INTO public.admin_user_staff_map (auth_user_id, staff_id)
   VALUES ('<auth_user_uuid>', '<staff_id>');
   -- ③ 事後閘:那一列在、而且只有一列
   DO $$ BEGIN
     IF (SELECT count(*) FROM public.admin_user_staff_map WHERE staff_id = '<staff_id>' AND auth_user_id = '<auth_user_uuid>') <> 1
       THEN RAISE EXCEPTION 'admin_user_staff_map: <staff_id> 沒綁上'; END IF;
   END $$;
   COMMIT;
   ```
   🔴 `service_role` 對這張表**沒有 INSERT 權**(刻意)⇒ 只能以 postgres 角色貼(MCP `apply_migration` / SQL Editor), 沒有程式路徑。
3. 貼之前:`<staff_id>` 要與 ① 建的**逐字相同**;`<auth_user_uuid>` 對 Dashboard 那頁**兩人各唸一遍**。

## ③ 驗
1. 新員工用 quote 站帳號登入(第一次會被要求改密碼 —— `must_change_password_at` 那欄;改完再登一次)。
2. 進後台 `/`(總覽)→「具名身分」卡 →「目前身分:**<他的顯示名>**」。印「尚未選擇」= 票沒帶身分(映射沒對上或 A 庫 staff 不是 active), 回 ①② 核 id。
3. 做一個會寫稽核的動作(例如改一則備註)→ 設定 › 操作紀錄 那一列的「誰」= 他。

## ④ rollback(綁錯了 / 人走了)
- **人走了** ⇒ 不刪列:後台 員工管理 把他 `停用`(`admin_staff_set_active`);後台 callback 查 A 庫 `is_active` ⇒ 15 分鐘內下一次換票被擋。Auth 帳號在 Dashboard 停用(Ban)。
- **綁錯 id** ⇒ 🛑 三個 trigger 擋 DELETE / UPDATE 改綁 / TRUNCATE(`admin_user_staff_map_no_delete_trg` / `_no_rebind_trg` / `_no_truncate_trg`, 草稿 `:185/:204/:236`)⇒ **那一列改不了也刪不掉**。
  唯一出路 = 新開一個 Auth 帳號 + 新代號(`staff_4`)重綁一次;錯的那列留著, 把錯的那個 Auth 帳號 Ban 掉、A 庫那個代號停用。**不要 DROP trigger 去硬刪** —— 那三支是身分映射唯一的保護。
- CHECK 白名單**不改回**(只增不減);要退整支 migration 只在「INSERT 沒進去」的世界才做得到。

## ⑤ 為什麼要雙人核對(寫給下一個貼的人)
- 這張表一列 = 「哪個登入帳號 = 哪個員工」。綁錯 = 某個人登入後以另一個人的名義寫稽核, 而 ④ 說了它不可逆。
- 貼之前把三樣東西並排唸:Dashboard 的 User UID / migration 裡的 uuid / ① 建的代號。三個都對才貼。
