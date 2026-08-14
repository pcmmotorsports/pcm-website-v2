# #27 稽核 UI — 施工 plan(C 窗 2026-08-14 夜;**待 Sean 批**)

> §1-A 現況 ❌「有寫入介面、連讀取 API 都沒有」。**複驗成立,而且比條目寫的更硬:不是沒人寫讀取 code,是 DB 端連 SELECT 權限都沒給。**
> 本檔零 code、不碰正式庫。

## 1. `admin_audit_log` 欄位與寫入點(逐項從 migration 讀;建表檔數法 `grep -rln "CREATE TABLE public.admin_audit_log" supabase/migrations/` = 1 檔)

建表 = `supabase/migrations/20260712210000_m4a_admin_audit_log.sql`。10 欄(`:43-59`):
`id` uuid PK · `actor` text NOT NULL(具名 staff slug)· `action` text NOT NULL · `target` text(格式約定 `<entity>:<uuid>`,`:65-66` COMMENT)· `before` jsonb · `after` jsonb · `reason` text · `request_id` text NOT NULL(correlation id)· `source_app` text CHECK IN('admin','quote')· `created_at` timestamptz DEFAULT now()(DB 權威、server 不回填以防竄改,`:53`)。
四個索引已經是為了這頁建的(`:72` created_at DESC / `:74` actor+created_at / `:76` target partial / `:78` request_id)——**列表、依人查、依單查、依 request 追蹤四條路都有索引,這頁不必自己加。**

**寫入點兩類,共 19 支**(數法 `grep -rl "INSERT INTO public.admin_audit_log" supabase/migrations/` = 18 檔 + app 層 1 處):

| 類 | 誰 | 形狀 |
|---|---|---|
| **DB 層(主流)** | 18 支 SECURITY DEFINER RPC(`20260714130000` 起算到 `20260814190000`) | 與主操作**同交易**寫,主操作 rollback 稽核也不留 |
| **app 層(唯一一處)** | `staff-actions.ts:61` → `getAdminAuditLogRepository().record()`(`orders/order-repository.ts:39-51`) | **非交易性**;`payment-actions.ts:47` 註解已標明這條路存在 |

**已在用的 action 代碼 19 個**(數法 `grep -rhoE "'[a-z][a-z_]+\.[a-z_]+(\.[a-z_]+)?'" $(grep -rl "INSERT INTO public.admin_audit_log" supabase/migrations/) | sort -u`,濾掉 `public.*` 表名與 `v_before.*` 變數後):
`customer.tier.change` `customer.wallet.adjust` `order.cancel` `order.workflow.update` `order_item.workflow.update` `order_note.append` `order_refund.correct_verdict` `order_refund.finalize` `order_refund.initiate` `payment.record` `payment.record.replay` `payment.reverse` `procurement.create` `procurement.update` `procurement.void` `procurement_receipt.create` `procurement_receipt.delete` `supplier.create` `supplier.update`;app 層另有 `settings.staff.create` / `settings.staff.update`(`staff-actions.ts:124,189`)。
⚠️ `AdminAuditAction = string`(`lib/audit/types.ts:8`)—— **型別層不列舉**,所以上面這張表是「今天數到的」、不是「不會再多」。UI 的動作篩選必須能吃到未知代碼、不能寫死 enum。

## 2. 讀取面現況 = 零(附 pattern 與分母)

- `.from('admin_audit_log')` 全樹**只有 2 處**(數法 `grep -rn "from('admin_audit_log')" apps packages`):`lib/audit/supabase-repository.ts:10`(註解裡的示範)與 `lib/orders/order-repository.ts:46`(**insert 路徑**)。⇒ **零 SELECT**。
- `apps/` 全樹 `admin_audit_log` 共 43 行命中(分母 = 823 個 `.ts`/`.tsx`,數法 `grep -rl "" --include='*.ts' --include='*.tsx' apps | wc -l`),**逐行看過:全部是註解或寫入路徑,沒有一行在讀。**
- 路由層零頁面:`ls apps/admin/src/app/` = `@panel api customers orders settings page.tsx layout.tsx globals.css`,**無 audit 目錄**。

## 3. 這頁要給員工看什麼

員工的問題是「**誰、什麼時候、對哪張單、做了什麼**」。四欄就答得完:
`created_at`(轉 Asia/Taipei,PRD §6.5 明定在 app 層轉)· `actor`(slug → 中文姓名,`lib/staff.ts` 已有 label)· `action`(代碼 → 中文字典)· `target`。

🟢 **不需要 join**:`target` 是 `<entity>:<uuid>`,而 `/orders/<uuid>` 與 `/customers/<uuid>` 兩條 admin 路由**都吃 uuid**(現有 `customer-detail.tsx:55` 的 `orderHref` 就是這樣組的)⇒ 直接把 target 切成連結即可,零 join、零額外查詢。
⚠️ 代價:員工看不到單號(`display_id`),只看得到「查看訂單」四個字。要顯示單號才需要 join `orders` —— **v1 建議不做**,等 Sean 看過畫面說不夠再加。
🔴 **`before`/`after` 預設不展開**:建表 `:26-28` 逐字寫明這兩欄「**可合法含經銷價 / 成本 / PII**」。v1 只在點開單列時才顯示,且**成本欄不進列表**。

## 4. 🔴 權限:這是本片真正的門檻(鐵則 12②,今晚不動)

**現在沒有任何角色讀得到這張表。** `20260712210000:85` 先 `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`,`:89` 只補回 `GRANT INSERT TO service_role`。`:88` 逐字:「**不給 SELECT(最小權限;稽核 viewer slice 才顯式 GRANT SELECT TO service_role)**」—— **這片就是那個 viewer slice,建表當天就預告了。**
`:113-117` 還有 fail-closed 斷言:service_role 有 SELECT 就 `RAISE EXCEPTION`;`:127-133` 另斷言 service_role 的 grant 列數**恰為 1**。
⇒ 必須新開一支 migration:`GRANT SELECT ON public.admin_audit_log TO service_role`,並**同時把上面兩條斷言的終態改寫**(1 筆 → 2 筆、SELECT 從禁改成必須),否則新舊斷言互相矛盾。
⇒ **鐵則 12②(權限/GRANT)+ ③(schema)雙中標 ⇒ 獨立成片 D0、要 Sean 批、要 apply,今晚一行都不動。**
⚠️ 順帶一提:migration `:27` 說「安全來自**無人能 SELECT**」。開了 SELECT 之後那句話就不再成立,威脅模型變成「靠 admin 登入閘」—— 而 `#26` 說登入身分**目前仍是自選**(`session/actor.ts:6-7` 自陳非授權邊界)。**這是要送給 Sean 的那顆決策,不是我能拍的。**

## 5. 片型 · 鐵則 · 驗收 · 誠實缺口

| 片 | 內容 | 檔數 | 片型 | 鐵則 |
|---|---|---|---|---|
| **D0** | migration:GRANT SELECT + 改寫兩條斷言 | 1(新 migration) | **高風險片** | **8 + 12②③**,要 Sean 批 + apply |
| **D1** | 讀取 API + 頁面 + 篩選 | 8 = `lib/audit/repository.ts` + `lib/audit/supabase-repository.ts` + `lib/audit/audit-list-view.ts`(新) + `lib/orders/order-repository.ts`(getter) + `app/settings/audit/page.tsx`(新) + `components/audit/audit-table.tsx`(新) + `components/layout/app-sidebar.tsx`(加一列,現有 `:30-31` 慣例) + `audit-list-view.test.ts`(新) | 標準片 | **鐵則 8 命中**;D0 未 apply 前**不得上線**(跨 apply 停點) |

**驗收條件(每條 yes/no)**
1. `/settings/audit` 列得出最近 N 筆,預設 `created_at DESC`。
2. 時間顯示為台北時間(拿一筆已知 UTC 值對照,不是「看起來對」)。
3. `actor` 顯示中文姓名而非 slug;`action` 顯示中文而非代碼。
4. `target` 為 `order:<uuid>` 時點得進該訂單頁;為 `customer:<uuid>` 時點得進客人頁。
5. **未知 action 代碼不會讓頁面炸**(塞一個字典沒有的代碼,應原樣顯示代碼本身)。
6. 列表**不含** `before`/`after` 的內容(DOM 斷言:列表 HTML 查無成本欄字面)。
7. 三綠 + `vitest` 全綠。
8. D0 未 apply 時,頁面顯示誠實錯誤態、**不顯示空清單假象**(鏡像 `customer-detail.tsx:120` 既有的 `loadFailed` 慣例)。

**誠實缺口(我沒驗的)**
- ❌ **沒對正式庫跑過任何查詢**。§4 全部權限結論來自 migration 檔字面 —— 而 migration 內有 fail-closed 斷言(`:109-117`)代表 apply 當下確實成立,但**「repo 裡的註解不是正式庫事實」照樣適用**;D0 開工前必須實查 `has_table_privilege('service_role','public.admin_audit_log','SELECT')`。
- ❌ **19 個 action 代碼是「今天數到的」不是「全部」**:型別層是 `string`(`types.ts:8`)、不列舉;而且我只掃了 `supabase/migrations/` 與 `apps/admin/src`,**沒掃報價單專案**(`source_app` CHECK 允許 `'quote'`,`20260712210000:58`)⇒ 正式庫裡可能已有本 repo 掃不到的代碼。字典必須 fallback 顯示原代碼(已寫成驗收 5)。
- ❌ 沒量過筆數:不知道正式庫現在有幾列 ⇒ **分頁要不要做、N 該設多少,我沒有數字支撐**,v1 先寫死取最近 100 筆並在片尾標為待調。
- ⚠️ 未擴張:`lib/sso/security-log.ts:3` 自陳「**這不是 admin_audit_log 正式接線**」、登入稽核走 stdout 且已被 Sean Q2=A 延後(S3b)⇒ **登入事件不在本頁**,本 plan 不動它。
