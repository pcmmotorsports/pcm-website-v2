# E 批 apply 停點包(2026-08-07)—— `20260807120000` A9v + `20260807130000` A9b2-M

> **狀態:唯讀預備。本文件不 apply 任何東西**;apply 是 Sean 的手動停點。
> 形狀照 B 線前例 `docs/reviews/2026-08-07-s2b-apply-runbook.md`。
> 所有字面均取自 repo 檔案(附 `檔案:行號`)或當場實跑,**沒有憑記憶寫的值**。

---

## §0 🔴 先讀:本批**只有兩支**,不是四支

交接檔 `docs/handoff/CURRENT.md:9` 寫「E 線批**四支**」,那份字面已過期。實查:

| migration | 內容 | 現況 |
|---|---|---|
| `20260806200000_..._a9h_m_a5a_preserve_optional_fields` | A5a 加 `p_preserve_optional_fields`(12 參)**+ channel 閘(步 5p)** | ✅ **已 apply** —— Sean 2026-08-07 09:45 親跑(`STATUS.md:13`)|
| `20260807120000_..._a9v_nine_code_writer_revoke` | 撤九碼 writer 的 EXECUTE + 詞彙表寫權 | ⏳ **本批** |
| `20260807130000_..._a9b2_m_supplier_order_no_upper` | 產生欄 `supplier_order_no_upper` + 索引 | ⏳ **本批** |

🔴 **「channel 閘」不是獨立的一支** —— 它是 `20260806200000` 檔內的**步 5p**
(該檔 `:38` 逐字:「preserve=true 而 channel 正規化後為 NULL 亦 RAISE(Sean 2026-08-06 拍板 —— 見步 5p)」)
⇒ 隨 a9h-M 一起上線了,本批不含它。

⚠️ **a9h-M 是事故修復、不是正常停點**:`STATUS.md:13` 記載 A9h-1 的**應用層 12 參昨夜先上線、
migration 未 apply** ⇒ 正式站採購 upsert 回 PGRST202、壞約 8 小時。
⇒ **本批的兩支同樣有「應用層已在 dev、DB 未 apply」的落差**,但方向相反(見 §4 的 flag 順序):
本批的應用層產出**全部掛在預設 off 的 flag 後面**,不 apply 也不會壞 —— 這是刻意的。

---

## §1 apply 前 preflight(逐條可執行;在 Supabase SQL editor 跑)

> 每條格式 = **指令 → 預期輸出 → 紅了怎麼辦**。
> 🔴 **P1/P2 是本批最可能擋住 apply 的兩條** —— 兩支 migration 的檔內驗收都是**嚴格等值**,
> 正式站只要有一筆手動下過的 grant,apply 就會整支 abort(fail-closed、安全,但會擋住)。

### P0 · 確認兩支都還沒 apply(避免重跑)

```sql
select version from supabase_migrations.schema_migrations
 where version in ('20260807120000','20260807130000');
```

- **預期**:**零列**。
- **紅了**(有列)⇒ 已經 apply 過,**停下來問**,不要重跑(A9v 可重入,但 A9b2-M 的 `ADD COLUMN` 會直接報錯)。
- 順帶確認 a9h-M 在:`select version from supabase_migrations.schema_migrations where version='20260806200000';` → **應有一列**。

### P1 🔴 A9v 的兩條嚴格等值斷言:先量正式站基線

A9v 的檔內驗收要求 apply 後 `order_status_options` 的**表級非 owner 授權恰為
`service_role:SELECT:false`**、且**欄級 ACL 數 = 0**(`20260807120000...a9v...sql:109-130`)。
先量現況,判斷 apply 後會不會落在那個終態:

```sql
-- 1a 表級 ACL(非 owner)
select pg_catalog.pg_get_userbyid(a.grantee) as grantee, a.privilege_type, a.is_grantable
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(c.relacl) a
 where c.oid = 'public.order_status_options'::regclass and a.grantee <> c.relowner
 order by 1,2;

-- 1b 欄級 ACL(A9v 的核心觀察面;表級查不到)
select attname, attacl
  from pg_catalog.pg_attribute
 where attrelid = 'public.order_status_options'::regclass
   and not attisdropped and attacl is not null
 order by attnum;
```

- **預期**:1a = `service_role` 的 `INSERT` 與 `SELECT`(各一列);
  1b = **5 列**(`label` / `color` / `text_color` / `sort_order` / `is_active`,各帶 service_role 的 UPDATE)。
  這是 A9v plan §1 在拋棄式叢集量到的形狀(`docs/specs/2026-08-07-e10-a9v-nine-code-writer-revoke-plan.md`)。
- **紅了**(1a 多出別的 grantee/權限,或 1b 多出第六個欄)⇒ **正式站被手動下過 grant**。
  A9v 會 abort。⇒ 停下來回報,由主視窗判斷是「補一句 REVOKE 進 migration」還是「先手動收斂」。
  🔴 **不要為了讓它過去就放寬那兩條斷言** —— 它們是本片唯一擋得住「欄級後門」的東西。

### P2 🔴 A9b2-M 的兩條權限斷言:先量 `order_item_procurement`

A9b2-M 要求 apply 後 **service_role 對新欄有 SELECT**、**anon/authenticated 零 SELECT**
(`20260807130000...a9b2_m...sql` 的 4e/4f)。新欄的權限來自**表級** grant,先確認表級是乾淨的:

```sql
select pg_catalog.pg_get_userbyid(a.grantee) as grantee, a.privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(c.relacl) a
 where c.oid = 'public.order_item_procurement'::regclass and a.grantee <> c.relowner
 order by 1,2;

select count(*) as 欄級acl數
  from pg_catalog.pg_attribute
 where attrelid = 'public.order_item_procurement'::regclass
   and not attisdropped and attacl is not null;
```

- **預期**:第一段 = **只有** `service_role` / `SELECT`(對齊建表檔
  `supabase/migrations/20260729020000_m4b_e10_a2_order_item_procurement.sql:167-168`
  的 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` + `GRANT SELECT … TO service_role`);
  第二段 = **0**。
- **紅了**(anon/authenticated 有任何權限)⇒ 🔴 **供應商單號的洩漏面已經破了**(A2 表 COMMENT `:113-114`
  逐字:「service_role only:供應商名稱與單號絕不進 orders / order_items…洩漏上游等於讓客人繞過 PCM」)。
  A9b2-M 的 4f 會 abort。⇒ **這種情況不是「調整 migration」,是先查為什麼會有那個 grant**。
- **紅了**(欄級 ACL 非 0)⇒ 新欄可能繼承不到預期權限。停下來回報。

### P3 · A9b2-M 的舊索引前置

A9b2-M 會 `DROP INDEX public.order_item_procurement_supplier_order_no_upper_idx`(該檔 `:95`)。

```sql
select indexname, indexdef from pg_indexes
 where schemaname='public' and tablename='order_item_procurement'
 order by indexname;
```

- **預期**:清單中**有** `order_item_procurement_supplier_order_no_upper_idx`
  (建於 A2 `:154-156`),且**沒有** `..._upper_col_idx`(本片才建)。
- **紅了**(舊索引不存在)⇒ `DROP INDEX` 會報錯、整支 abort。停下來回報。

### P4 · A9b2-M 的表重寫成本

`ADD COLUMN … STORED` 會**整表重寫**並取 ACCESS EXCLUSIVE 鎖;該檔夾了 `lock_timeout = '5s'`。

```sql
select count(*) as 列數, pg_size_pretty(pg_total_relation_size('public.order_item_procurement')) as 大小
  from public.order_item_procurement;
```

- **預期**:列數以千計、大小 < 幾十 MB ⇒ 重寫時間可忽略。
- **紅了**(列數上百萬)⇒ 重寫時間與鎖窗變得不可忽略,**改排離峰**並回報。

### P5 · A9v 的誤殺防護前置

A9v 有一條「`admin_update_order_workflow` 必須**仍然**叫得動」的斷言(該檔 3d)。先確認它現在是好的:

```sql
select pg_catalog.has_function_privilege(
         'service_role',
         'public.admin_update_order_workflow(uuid,integer,jsonb,text,text)'::regprocedure,
         'EXECUTE') as 保留支仍可執行,
       pg_catalog.has_function_privilege(
         'service_role',
         'public.admin_update_order_item_workflow(uuid,integer,jsonb,text,text)'::regprocedure,
         'EXECUTE') as 待撤支目前可執行;
```

- **預期**:`保留支仍可執行 = t`、`待撤支目前可執行 = t`(apply 後第二欄要變 `f`)。
- **紅了**(第一欄已是 `f`)⇒ 誤殺防護會 abort;**那代表更早就有東西撤錯了**,停下來查。
- **紅了**(第二欄已是 `f`)⇒ A9v 的目的已被別的東西達成;仍可 apply(它是等冪的 REVOKE),但**回報**。

### P6 · PostgREST 具名參數 smoke(a9h-M 的既有待補,順帶在本批一起清)

`STATUS.md:39` 列的 apply 前 gate 之一:「harness 只證 plpgsql 直呼」⇒ 需要一次**經 PostgREST** 的呼叫。
a9h-M 已 apply,這道**現在就能跑**(唯讀不寫入:故意送會被守門擋下的參數組合,看它回 RAISE 而不是 PGRST202):

```
POST {SUPABASE_URL}/rest/v1/rpc/admin_upsert_item_procurement
Header: apikey / Authorization: Bearer <service secret>
Body(刻意觸發步 1n 的 NULL 旗標守門):
{"p_order_item_id":"<任一存在的 order_item id>","p_supplier_id":"<任一 supplier id>",
 "p_allocated_quantity":1,"p_reply_status":"no_reply","p_contact_channel":null,
 "p_submitted_at":null,"p_supplier_order_no":null,"p_exception_reason":null,
 "p_expected_arrival_date":null,"p_actor":"preflight","p_request_id":"preflight-smoke",
 "p_preserve_optional_fields":null}
```

- **預期**:回 **PG 的 RAISE 錯誤**(步 1n 擋 NULL 旗標),**不是** `PGRST202`(找不到函式)。
- 🔴 **`PGRST202` = 具名參數對不上** ⇒ 正是 09:45 那場事故的症狀,**立刻停下回報**。
- **紅了**(回成功)⇒ 步 1n 沒生效,停下回報。
- ⚠️ **這一步會寫入嗎?** 不會 —— 守門在任何寫入之前 RAISE。但**它需要真實的 id**;
  取 id 用唯讀查詢即可(`select id from public.order_items limit 1;`)。

---

## §2 apply 序

🔴 **照時間戳序、一次一支、每支跑完看 NOTICE 再跑下一支。**

1. `20260807120000_m4b_e10_a9v_nine_code_writer_revoke.sql`
   - **成功訊號**:`NOTICE: A9v 結構驗收全數通過(…)`
2. `20260807130000_m4b_e10_a9b2_m_supplier_order_no_upper.sql`
   - **成功訊號**:`NOTICE: A9b2-M 結構驗收全數通過(…)`

**兩支都是單一交易**(檔內 `BEGIN;` … `COMMIT;`),檔內 DO 任一條不符 ⇒ **整支自動回滾**,
不會留下半套狀態。⇒ **不需要**在中間手動下 ROLLBACK。

**順序不可顛倒的理由**:兩支互不相干(A9v 動權限、A9b2-M 動 `order_item_procurement` 結構),
技術上可對調;**照時間戳序是為了讓 ledger 的 version 單調遞增**,與 B 線同紀律。

---

## §3 apply 後動作清單(有順序)

| # | 動作 | 為什麼有順序 |
|---|---|---|
| 1 | **重生 `database.types.ts`** | `supplier_order_no_upper` 目前不在生成型別裡。A9b2-A 因此用 `.filter()` 而非 `.eq()`(`SupabaseOrderAdapter.ts` 內註解);重生後可考慮改回,**但那是另一片、不在本批** |
| 2 | 🔴 **回傳形狀實跑**(A9b2-A plan §6-6)| 見下方 §3.1。**必須在開 flag 之前** |
| 3 | 開 `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH=1` | 本批 apply 之後才可以開;開之前搜尋會 42703 ⇒ **整個訂單列表**進錯誤態 |
| 4 | (獨立)`ADMIN_E10_ORDER_NUMBER_SEARCH` | 🔴 **它的前置是 D0 `legacy_display_id`、不是本批**;本批 apply **不解鎖它**。兩個 flag 互不相干,別順手一起開 |

### 3.1 🔴 回傳形狀實跑(本批最需要真環境的一步)

A9b2-A 的第一段查詢假設 `order_items` embed 回**物件**;本地沒有 PostgREST 可以證。
若實際回**陣列**,程式會擲 `SupplierOrderNoSearchShapeError`(**不會**靜默回零筆 —— 這是刻意的)。

```
GET {SUPABASE_URL}/rest/v1/order_item_procurement?select=order_items!inner(order_id)&limit=1
Header: apikey / Authorization: Bearer <service secret>
```

- **預期**:`[{"order_items":{"order_id":"…"}}]` —— `order_items` 是**物件**。
- **紅了**(是陣列 `[{...}]`)⇒ A9b2-A 的 cast 要改(`SupplierOrderNoProbeRow`),**在改好之前不要開 flag**。
- 這一步**唯讀**,零副作用。

### 3.2 apply 後 read-back(對齊 a9h-M 那次的紀律)

```sql
-- A9v:三個 role 都不該叫得動 item 支;保留支仍要活
select pg_catalog.has_function_privilege(r, 'public.admin_update_order_item_workflow(uuid,integer,jsonb,text,text)'::regprocedure,'EXECUTE') as 應為f
  from unnest(array['service_role','anon','authenticated']) r;
select pg_catalog.has_function_privilege('service_role','public.admin_update_order_workflow(uuid,integer,jsonb,text,text)'::regprocedure,'EXECUTE') as 應為t;
-- A9v:詞彙表欄級 ACL 應歸零、SELECT 應保留
select count(*) as 應為0 from pg_catalog.pg_attribute
 where attrelid='public.order_status_options'::regclass and not attisdropped and attacl is not null;
select pg_catalog.has_table_privilege('service_role','public.order_status_options','SELECT') as 應為t;
-- A9b2-M:產生欄形狀 + 新舊索引
select a.attgenerated as 應為s, pg_catalog.pg_get_expr(d.adbin,d.adrelid) as 應為upper表達式
  from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid='public.order_item_procurement'::regclass and a.attname='supplier_order_no_upper';
select indexname from pg_indexes where schemaname='public' and tablename='order_item_procurement'
   and indexname like '%supplier_order_no_upper%';
-- A9b2-M:新欄的洩漏面
select pg_catalog.has_column_privilege('anon','public.order_item_procurement'::regclass,'supplier_order_no_upper','SELECT') as 應為f;
```

- **預期**:三個 `f` / `t` / `0` / `t` / `s` + `upper(supplier_order_no)` / 只剩 `..._upper_col_idx` / `f`。
- **紅了任一條** ⇒ apply 沒有達到宣稱的終態,回報。
  (理論上不可能 —— 檔內 DO 已經驗過同樣的事、不符會自動回滾。這一步是**獨立複驗**,
  防的是「migration 自己驗自己」那層盲點。)

### 3.3 ⚪ 順帶:`EXPLAIN` 實看(A9b2-M 誠實邊界的補洞)

A9b2-M 只證了索引**存在**、沒證 planner 會用它。apply 後可順手看一次:

```sql
explain (analyze, buffers)
select 1 from public.order_item_procurement where supplier_order_no_upper = 'SO-NOTEXIST';
```

- **小表上走 Seq Scan 是可接受的**、不算缺陷 —— **記錄下來即可**,不要因此改設計。

---

## §4 rollback

**兩支都可逆、且都零資料寫入。** 但 Supabase 是 forward-only ⇒ 回滾要另立版本號更大的 migration。

- **A9v 的回滾配方**:見該檔檔尾註解(`20260807120000...:169-181`)。
  🔴 其中 `UPDATE` 那句**必須用欄級語法** —— 原始授權就是欄級的,寫成表級會**多給**(全欄可寫),不是還原。
- **A9b2-M 的回滾配方**:見該檔檔尾。🔴 **序不可顛倒**:先把舊函式索引種回去、再撤新的,
  中間不留「一支索引都沒有」的窗口;且 **`DROP COLUMN` 之前要先關 flag**,否則 A9b2-A 的查詢會 42703。

---

## §5 這份文件**沒有**做到的事(誠實邊界)

1. 🔴 **本文件的所有 SQL 都沒有在正式站跑過** —— 我沒有正式站的連線。
   §1 的「預期輸出」全部來自**拋棄式 PG17 叢集重播**(A9v/A9b2-M 兩份 plan 記錄的量測)
   與 repo 內的建表/授權字面。**正式站可能不同,那正是 preflight 存在的理由。**
2. 🔴 **P6 的 PostgREST smoke 我沒跑過**(需要 service secret,那是 Sean 的東西)。
   它的「預期回 RAISE 而非 PGRST202」是依 a9h-M 檔內步 1n 的邏輯推導,不是實測。
3. **§3.1 的回傳形狀是本批唯一需要真環境才能定案的技術假設**;在它綠之前,
   A9b2-A 的搜尋路徑**沒有被端到端驗證過**(雖然它 fail-closed、壞了會擲具名錯誤而不是靜默)。
4. `docs/handoff/CURRENT.md:9` 的「E 線批四支」字面**與本文件不一致**;
   本文件依 `STATUS.md:13` 的 apply 紀錄判定為兩支。**兩份文件的差異請主視窗一併收斂。**
5. 本文件**不含** B 線 S2b 批的任何內容;兩批**各自成批、不混**。

— E 窗,2026-08-07
