# 稽核列凍結當時身分(actor 快照)· plan(鐵則 8;等 Sean 批)

主視窗 2026-09-14 派施工窗第 2 件。板列 `launch-todo:897`(⟦b4-MGR0-RPC⟧)。

## 0. 先講清楚:這片不是 897 那支 RPC
- `launch-todo:897` 本體 = 管理者查核與寫入不同交易(TOCTOU),現行 plan `docs/plans/2026-09-07-mgr0-rpc-toctou-plan.md`(514 行)等 Sean 鐵則 8;09-08 A 裁「沒貼的授權不開」。**本片不碰它。**
- 本片只做主視窗要的那一半:**稽核列自己記「當時是誰、當時什麼角色」**,顯示端不再靠現在的 staff 表。
- 兩片互補:本片做完之後,TOCTOU 被搶到那一筆會自己寫出「actor_is_manager=false」⇒ 紀錄不再「看起來正常」。

## 1. 現況(量到的)
- `admin_audit_log.actor` = staff id slug(`20260712210000:45`),沒存名字、沒存角色。
- 顯示:`apps/admin/src/app/settings/audit/page.tsx:94-106` 用 `listActiveStaff()`(`lib/staff.ts:53-57` 濾 `is_active`)⇒ `formatAuditActor`(`audit-list-view.ts:135`)查不到就印 slug。
  ⇒ **停用一個員工,他過去每一列都變成機器字串**;改 label 過去每一列跟著變;角色從來沒顯示。
- 寫入端:migration 內 RPC 直寫本表 **82 支** + app 端 ~50 檔。改寫入端 = 全部要動 ⇒ 不走這條。
- staff 只能停用不能刪(`staff-repository.ts` 無 `.delete()`;GRANT 只有 UPDATE 三欄)。

## 2. 改什麼(最短路:DB 端一支 trigger,寫入端零改動)
migration `20260914110000_m4b_audit_actor_snapshot.sql`(版本號已掃、已佔 stub):
1. `ALTER TABLE admin_audit_log ADD COLUMN actor_label text, ADD COLUMN actor_is_manager boolean;`(可 NULL,舊列先 NULL)
2. `BEFORE INSERT` trigger `admin_audit_log_actor_snapshot_bi`:`NEW.actor_label / actor_is_manager` 為 NULL 時從 `public.staff` 依 `NEW.actor` 補;staff 查無 ⇒ 留 NULL(不擋寫入,稽核不能因為快照失敗而少一筆)。函式 `SECURITY INVOKER`、`SET search_path = pg_catalog, public`。
3. 一次回填:`UPDATE admin_audit_log SET actor_label = s.label, actor_is_manager = s.is_manager FROM staff s WHERE actor = s.id AND actor_label IS NULL;`
   ⚠️ 本表約定 append-only(service_role 只 INSERT)。回填是 migration 以 owner 跑的一次性動作,**不加 UPDATE GRANT**。回填的是「現在的」label/角色,不是當時的 —— 舊列本來就沒那個資訊,plan 明寫,顯示端不假裝。
4. rollback `supabase/rollbacks/20260914110000_down.sql`:DROP trigger + function + 兩欄。**順序:先回滾 app(投影 select 有那兩欄, 刪欄後整頁 42703)再跑 down.sql**(codex R1 nit)。
- app 端 2 檔:`audit/types.ts` `AdminAuditLogRow` 加兩個可選欄;`audit-list-view.ts` `toAuditListRow` 先用 `row.actor_label`、退回現行查表;role 顯示成「(管理者)」尾綴。`page.tsx` 的 `listActiveStaff()` 換 `listStaffRows()`(含停用)當第二層退路。
- **不動**:82 支 RPC、任何 app 寫入端、staff 表、RLS(本表 client 零權限不變)。

## 3. 影響 / 風險
- 新欄可 NULL + trigger 只補 NULL ⇒ 82 支 RPC 的 INSERT 一字不改也不會 23502。
- trigger 多一次 staff PK 查詢(6 列表)⇒ 可忽略。
- 若 staff 查無(理論上 buildAuditContext 已 fail-closed)⇒ NULL,顯示退回 slug,與今天一樣。

## 4. 驗收(yes/no)
1. 探針庫停用一個員工 ⇒ 他舊列仍顯示原名 + 角色。
2. 新寫一筆稽核 ⇒ `actor_label / actor_is_manager` 自帶。
3. 三綠 + `audit-list-view.test.ts` 加「有快照用快照、沒快照退回查表」。
- codex 兩輪(鐵則 12:schema + 稽核)。

## 5. 施工紀錄(2026-09-14, 主視窗 ef 批後)
- 拋棄式 PG(探針庫 55554, 已套到 080000)真跑:
  - 貼前先塞兩列(`probe_staff` 在 staff / `ghost_gone` 不在)⇒ 貼後回填:`probe_staff|探針員工|t`、`ghost_gone|NULL|NULL`。
  - `SET ROLE service_role` 直 INSERT ⇒ `探針員工|t`;把 probe_staff 降級 + 停用 + 改名之後再 INSERT ⇒ 新列 `探針員工(改名)|f`、**舊列一字不動**;ghost 再 INSERT ⇒ NULL 不擋。
  - down.sql 跑完兩欄 = 0 ⇒ 重貼成功 ⇒ 第二次貼 RAISE `前置閘③:actor_label 已存在`。
- 後置閘⑤ 原本斷言「service_role 沒 UPDATE/DELETE」⇒ 在探針庫紅(那台 service_role 有 ALL, 與正式庫不同, 不是本支的事)⇒ 改成 relacl 貼前貼後逐字相同(本支一個 GRANT 都沒動)。
- 沒證到的:正式庫(未貼);頁面沒親點(探針 dev server 沒起, 單測 123 綠含停用員工 / 快照優先兩格)。
- 未親自反證:`page.test.tsx` 那格「改回 listActiveStaff 會紅」是推論(反證那一發被拒)。
