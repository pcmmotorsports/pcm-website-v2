# #27 稽核 UI — 施工 plan(C 窗 2026-08-14 夜;**2026-08-15 Sean 拍 `Q-D1 = A` + `Q-D1b = A` 後更新**)

> §1-A 現況 ❌「有寫入介面、連讀取 API 都沒有」。**複驗成立,而且比條目寫的更硬:不是沒人寫讀取 code,是 DB 端連 SELECT 權限都沒給。**
> 本檔零 code、不碰正式庫。

## 0. 🏁 拍板與狀態(2026-08-15)

**Sean 拍板 `Q-D1 = A`(逐字「a」,經主視窗轉達)⇒ 這片要做,開 `GRANT SELECT`。**

⚠️ **本檔原本就把權限這件事判對了,沒有「不需要 migration」那種字面要修。**
主視窗的指示假設本檔寫過那句;**實查沒有**(數法:`grep -nE 'migration|GRANT|鐵則 12|鐵則 8|授權|輕量片|標準片|高風險'` 逐行看過,
**§4 標題**、**§4 末的「雙中標」句**、**§5 表格 D0 那列**三處從第一版起就寫 **鐵則 12②③ 雙中標 / 高風險片 / 要 Sean 批**)。
**這裡明講,免得下一個人以為修過。**

**真正過期的只有時間字面**:§4 標題與 §4 末句原本寫「今晚不動」/「今晚一行都不動」—— 那是**還沒拍板時**寫的。
拍板後 D0 **可以寫**(寫檔 ≠ apply,見下)。已在該兩處就地改掉。
⚠️ **這裡刻意用章節名而不用行號**:本次插入 §0 讓全檔行號位移,寫死行號當場就會過期
(這正是我自己在 `#1` plan `§9-7` 抓到的同一種病)。

🔴 **apply 是 Sean 的獨立停點,拍板沒有涵蓋它。**
Sean 批的是「做這件事」;`~/pcm-mailbox/C-HANDOFF.md` 的授權邊界逐字:「**任何 apply 正式庫**」始終要 Sean 本人。
⇒ **我寫 migration 檔、commit、不執行、不 push。** apply 由 Sean 自己跑,那是第二個獨立停點。

### 🔴🔴 開放 SELECT 的正當性 = **一個有到期日的前提**(`Q-D1b = A`,Sean 2026-08-15 **知情後**拍板)

第一版我把這顆掛著不當它被涵蓋(理由:Sean 拍 `Q-D1 = A` 時字面只有「a」,我不知道他被告知了什麼)。
主視窗已補問,**這三件逐字送到他面前**:①開 SELECT 後威脅模型從「無人能讀」變成「**靠登入閘**」
②`#26` 說登入身分**仍是自選、系統不驗證** ③這張表的 `before`/`after` **合法可含經銷價 / 成本 / PII**。
**他知情後仍拍 A**,理由:**後台目前只有他本人在測、員工還沒上工。**

> **本片開放 SELECT 的正當性建立在「後台目前只有 Sean 一人測試、員工未上工」(Sean 2026-08-15 知情後拍板)。**
> **員工真正上工之前,`#26` 真認證必須先落地** —— 否則自選身分的人讀得到經銷價 / 成本 / PII。

🔴 **這段要逐字複製進 D0 migration 的檔頭 COMMENT**,不只留在 plan。
🔴 **字面紀律**:**不得寫成「已評估安全」** —— 它**不是安全**,它是**現在還沒有人會受害**。
⇒ 掛成 **`#26` 的下游相依**:`#26` 落地前員工上工 = 這個前提失效 ⇒ **回頭重估本片,不是「寫完就算」。**

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

## 4. 🔴 權限:這是本片真正的門檻(鐵則 12②;**2026-08-15 已拍板要做,見 §0**)

**現在沒有任何角色讀得到這張表。** `20260712210000:85` 先 `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`,`:89` 只補回 `GRANT INSERT TO service_role`。`:88` 逐字:「**不給 SELECT(最小權限;稽核 viewer slice 才顯式 GRANT SELECT TO service_role)**」—— **這片就是那個 viewer slice,建表當天就預告了。**
`:113-117` 還有 fail-closed 斷言:service_role 有 SELECT 就 `RAISE EXCEPTION`;`:127-133` 另斷言 service_role 的 grant 列數**恰為 1**。
⇒ 必須新開一支 migration:`GRANT SELECT ON public.admin_audit_log TO service_role`。

> 🔴 **2026-08-14 夜自我更正(本段第一版寫錯了機制)**:第一版寫「**同時把上面兩條斷言的終態改寫**,否則新舊斷言互相矛盾」。
> **「矛盾」不成立、「改寫」更是錯的做法。** migration **forward-only、只跑一次**(`20260712210000:140` 逐字),
> 那兩個 `DO $$` 是 **apply 那一刻**的檢查、**不會再跑** ⇒ 執行期沒有矛盾;
> 而編輯一支**已 apply 的** migration = **改歷史**,明文禁止。**照第一版那句做,下一個人會去動已上庫的檔。**
> **正解**:D0 寫**自己的**新斷言陳述**新終態**,檔頭寫明取代 `20260712210000` §4 的最小權限意圖。
> 先例 `20260807120000`(A9v):`:10`「REVOKE 不是 DROP、可逆」/`:118` 斷言**攤平後完整授權字串**而非只數筆數/`:106` **誤殺正控**/`:77-80` 自己標註某條恆真。
> **D0 四條斷言**:①`service_role` 終態恰 `INSERT`+`SELECT`、其餘 5 權限零 ②`anon`/`authenticated` 7 權限仍全零
> ③**誤殺正控:`INSERT` 仍在**(19 支 writer 的命脈,誤殺=後台所有寫入連帶死)④欄級 ACL 零殘留。
> ⚠️ 誠實界:**forward-only 我沒實測**,依據是 migration 檔字面 + 「不得編輯已 apply migration」既有紀律。詳見 `2026-08-14-27-d1-prep-notes.md` §1。
⇒ **鐵則 12②(權限/GRANT)+ ③(schema)雙中標 ⇒ 獨立成片 D0。**
**2026-08-15 更新**:Sean 已批(`Q-D1 = A`)⇒ D0 **可以寫**;
🔴 但 **apply 仍是 Sean 本人的獨立停點**(§0),寫檔 ≠ 上庫。
⚠️ 順帶一提:migration `:27` 說「安全來自**無人能 SELECT**」。開了 SELECT 之後那句話就不再成立,威脅模型變成「靠 admin 登入閘」—— 而 `#26` 說登入身分**目前仍是自選**(`session/actor.ts:6-7` 自陳非授權邊界)。~~這是要送給 Sean 的那顆決策,不是我能拍的。~~
   🏁 **已拍(`Q-D1b = A`,2026-08-15,Sean 知情後)** —— 但**正當性有到期日**,逐字條件見 §0。
   ⚠️ 這一行留著不刪,是因為它記著「威脅模型真的變了」這個事實;變的只是「誰來承擔」。

## 5. 片型 · 鐵則 · 驗收 · 誠實缺口

| 片 | 內容 | 檔數 | 片型 | 鐵則 |
|---|---|---|---|---|
| **D0** | migration:`GRANT SELECT` + **本支自己的**四條新斷言(**不碰已 apply 的 `20260712210000`**) | 1(新 migration) | **高風險片** | **8 + 12②③**,要 Sean 批 + apply |
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

## 6. 🔴🔴 D0 的承重約束:這張表的 append-only **是 ACL 撐的,沒有 trigger 兜底**

主視窗 2026-08-15 指出的約束,**我自己複跑過才寫進來**(不轉抄):

**事實 A — 這張表零 trigger(repo 字面)**
```
grep -rniE 'CREATE (OR REPLACE )?TRIGGER[^;]*' supabase/migrations/*.sql | grep -i audit_log   ⇒ 零命中
正向對照:同 pattern 不加 audit_log 過濾                                                        ⇒ 65 命中
```
⇒ pattern 有效,**零是真的零**。與 `20260812150000:489` COMMENT 逐字對上:
「該表現行 trigger 數=0、append-only **只靠 GRANT**」。
⚠️ **誠實界:這是 repo 字面,不是正式庫事實。** 我沒查過正式庫有沒有人手動加過 trigger。

**事實 B — `:132` 那顆「恰 1 筆」斷言不會回頭炸(我自己掃的)**
```
grep -rn "role_table_grants" supabase/migrations/*.sql | grep -i audit
```
⇒ 對 `admin_audit_log` 的筆數斷言**只存在於 `20260712210000` 自己**(`:128-134`),forward-only、已跑過。
唯一另一處 `20260717020000:445` 是 **`email_outbox`** 的、期望 **3 筆**、且訊息裡逐字寫「偏離 audit_log 的 1 筆 = CAS 認領所需」
⇒ **不同表,不受影響。** 順帶:那正是「期望值不是 1 也可以,但要在訊息裡說明為什麼」的**現成先例**。

**事實 C — 另外兩處引用是正向檢查,開 SELECT 不會讓它們變 false**
`20260803160000:630` / `20260806200000:681`,形狀都是 `IF NOT has_table_privilege(v_owner, …, 'INSERT')`
⇒ 檢查的是「**至少有 INSERT**」,多一個 SELECT 不影響。

### ⇒ D0 必須遵守的三條(寫進 migration,不是寫在信裡)

1. **只開 `SELECT`,一個字都不多。**
   不得順手開 `UPDATE` / `DELETE` / `TRUNCATE` / `REFERENCES` / `TRIGGER`。
   🔴 理由不是潔癖:**這張表的「不能改、不能刪」沒有第二道防線** ⇒ ACL 在這裡是**承重牆**,不是配置。

2. **自帶 fail-closed 斷言,終態恰 `{INSERT, SELECT}` 兩筆、不多不少。**
   形狀抄 `20260712210000:93-134`(那是原作者自己釘 ACL 的手法),四條:
   - ①`service_role` **有** `INSERT`(誤殺正控 —— 19 支 writer 的命脈,誤殺=後台所有寫入連帶死)
   - ②`service_role` **有** `SELECT`(本片的目的)
   - ③`service_role` 其餘 **5** 權限(`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`)**全零**
   - ④`role_table_grants` 對 `service_role` **恰 2 筆**,`anon`/`authenticated`/`PUBLIC` **仍零**
   🔴 **訊息裡要寫明「為什麼是 2」** —— 抄 `20260717020000:445` 的寫法(它把偏離的理由寫進 RAISE 訊息裡)。
   否則下一個人看到 2 只會知道「期望是 2」,不知道**哪兩個、為什麼**。

3. **plan 與 migration 檔頭都要明寫這句事實,而且字面要準**:
   > `admin_audit_log` 的 append-only **由 GRANT 撐,表上零 trigger**;本片**只加 SELECT、不改變這件事**。
   🔴 **不得寫成「append-only 有保障」** —— 它有的是**一道 GRANT**,不是一道 trigger。
   ⚠️ 這不是措辭潔癖:寫成「有保障」會讓下一個人以為改 ACL 是安全的(反正還有 trigger 兜著),而**沒有**。

### 🏁 那顆疑慮已結案(2026-08-15 `Q-D1b = A`,Sean **知情後**拍板)

原文留在 §0。結論:**他知道了才拍的**,理由是「後台目前只有他本人在測、員工還沒上工」。
⇒ **那不是「安全」,是「現在還沒有人會受害」** —— 前提有到期日,`#26` 是它的下游相依。
🔴 **§0 那段引文要逐字複製進 D0 migration 的檔頭 COMMENT。**

### D0 的版本號 = `20260815020000`(主視窗發,**我自己複驗過**)

檔名:`20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql`
🔴 **`20260815010000` 是 A 窗的,不得使用。**

我複驗的量法與結果:
```
ls supabase/migrations/ | grep -c "^20260815"
  · pcm-customers ⇒ 0    · pcm-website-v2 ⇒ 0
  · pcm-void-readers ⇒ 0 · pcm-products ⇒ 0   · pcm-print ⇒ 0
四樹最新皆 20260814190000_m4b_e10_473b1_refund_manual_corrections.sql
信箱佔位掃描 grep -rn "20260815[0-9]{6}" ~/pcm-mailbox/*.md ⇒ 零命中
  正向對照同 pattern 換 20260814 ⇒ 26 命中(pattern 有效,零是真的零)
```
⚠️ **與主視窗給的數字對不上,而我照實記**:它說「該是 1 —— A 窗的 `010000`」,
**實測五棵樹都是 0**,信箱也零佔位 ⇒ **A 窗那支還沒落檔**(或只在它的 plan 裡)。
結論不變(`020000` 仍空),但**「該是 1」這個期望值不成立,別拿它當守門**。
⚠️ **掃描限度**:只掃本機五棵樹 + 信箱;**remote 上、本機無對應 branch 的號掃不到** ⇒ 下限不是保證。

### D0 的誠實缺口(補在原 §5 之上)

- ❌ **`has_table_privilege('service_role','public.admin_audit_log','SELECT')` 我沒實查正式庫** ——
  原 plan 已寫「D0 開工前必須實查」,**這條到現在仍未做,而且我做不到**(不碰正式庫)。
  ⇒ **這是 apply 前 Sean 或主視窗要跑的一道,不是我能勾掉的。**
- ❌ **零 trigger 是 repo 字面,不是正式庫事實**(事實 A 的誠實界)。
