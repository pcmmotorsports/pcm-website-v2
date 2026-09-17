# 🛑🛑 本片停工中 —— 下面的「七張」是錯的,不要照著做(2026-09-17 自撞)

> **開工前我去讀範本,撞到一支審過三輪、Sean 拍過的板 ⇒ 這一版有三張不能給。**
> 詳情在最下面的〈🔴 自撞更正〉那一節。**在 Sean 重新拍之前,不要照本檔寫 migration。**
>
> | | 本檔原本寫的 | 更正後 |
> |---|---|---|
> | 讀不到的表 | ⛔ 11 張 | ✅ **9 張真的讀不到 + 2 張「表級說不行而其實讀得到部分欄」** |
> | 要給的 | ⛔ 7 張 | ✅ **4 張**(另 3 張牴觸貼板 51) |
> | 我用的尺 | ⛔ `has_table_privilege` | ✅ 要用 `has_column_privilege` 逐欄問 |

---

# plan · 給 `pcm_readonly` 讀那 7 張活的表(Sean 2026-09-17 Q8 甲 → 追加拍甲)

> 鐵則 8(碰 GRANT ⇒ 先 plan 等批)+ 鐵則 12(權限類 ⇒ commit 前對抗審一輪)。
> **這份寫完停,等 Sean 批。migration 還沒寫。**
> 提案人:設計窗 `11` · 轉達:主視窗 `a5`
>
> 🔵 **射程變更史**:第一版只做 `home_banners`(1 張)。我在查根因時量到**還有 10 張讀不到**,
> 出成三選一端給 Sean ⇒ **他拍「甲 = 一次補那 6 張活的」** ⇒ **本版射程 = 7 張。**

---

## 一、為什麼要動

**「首頁現在掛的是哪一張」目前沒有唯讀稽核路徑。**

2026-09-17 我要驗一張大圖的文案,`scripts/readonly-prod-sql.sh` 直接 `permission denied`,
只好改走 Supabase MCP 的 SELECT(管理 API,權限比唯讀角色大很多)才拿得到那一列。
📌 **一件「只是要看一眼」的事,逼人去用一把更大的鑰匙。** 那個習慣本身是風險。

---

## 二、🔴 根因:是缺 GRANT,不是 RLS —— 而且不只一張

```sql
-- ① 這個角色繞得過 RLS ⇒ RLS 不可能是原因
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname='pcm_readonly';
-- ⇒ pcm_readonly | true | false
```
```sql
-- ② 跟一張讀得到的表(products)並排看 relacl
SELECT c.relname, array_to_string(c.relacl, E'\n')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('home_banners','products');
```
| 表 | relacl |
|---|---|
| `products`(讀得到) | `postgres=arwdDxtm/postgres` · `service_role=arwdDxtm/postgres` · **`pcm_readonly=r/postgres`** |
| `home_banners`(讀不到) | `postgres=arwdDxtm/postgres` · `service_role=r/postgres` · **(沒有 pcm_readonly)** |

```sql
-- ③ 分母:public 72 張表, 讀得到 61, 讀不到 11
SELECT count(*) FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
  AND NOT has_table_privilege('pcm_readonly', format('public.%I', t.table_name), 'SELECT');
-- ⇒ 11
-- ④ 而它身上一條預設權限都沒有
SELECT count(*) FROM pg_default_acl d WHERE array_to_string(d.defaclacl,',') LIKE '%pcm_readonly%';
-- ⇒ 0
```
📌 **根因不是「有人忘了 `home_banners`」,是【每一張都要有人記得】。**

---

## 三、改什麼 —— **七張,逐張列名**

```sql
GRANT SELECT ON TABLE public.home_banners                   TO pcm_readonly;
GRANT SELECT ON TABLE public.supplier_inbound_emails        TO pcm_readonly;
GRANT SELECT ON TABLE public.pcm_incident                   TO pcm_readonly;
GRANT SELECT ON TABLE public.pcm_net_exposure_snapshot      TO pcm_readonly;
GRANT SELECT ON TABLE public.pcm_settle_retry_attempts      TO pcm_readonly;
GRANT SELECT ON TABLE public.shipment_order_ship_clearances TO pcm_readonly;
GRANT SELECT ON TABLE public.supplier_sync_runs             TO pcm_readonly;
```
🔴 **逐張列名,不用 `ON ALL TABLES`** —— `ALL TABLES` 會把那 4 張排了退場的回滾快照也給進去,
而且它**沒有射程**:下次有人加表就自動擴權,那正是 Sean 否掉的乙。

🛑 **不做的事:**
- ⛔ 不給 `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `REFERENCES` / `TRIGGER`。
- ⛔ **不加 `ALTER DEFAULT PRIVILEGES`** —— 見第六節,那是**已拍板的取捨**,不是待補的缺口。
- ⛔ 不碰那 4 張回滾快照(`dbk_external_id_rename_20260904` / `pcm_definer_searchpath_rollback_20260905100000` / `…110000` / `pcm_rls_rollback_20260904270000`)—— 它們的註解自己寫著「滿一週就 DROP」。
- ⛔ 不動 `anon` / `authenticated` / `service_role`、不動 RLS、不加 policy。

### 🔴 順手做的一件:把兩處註解裡的「未確認」改成答案

那兩張表的 `COMMENT` **自己就在問這件事**,而今天有答案了。**註解是下一個人會讀到的地方,不能只寫在 plan 裡。**

| 表 | 註解裡逐字寫著 | 要改成 |
|---|---|---|
| `pcm_net_exposure_snapshot` | 「施工窗的唯讀角色(`pcm_readonly`)是否讀得到**未確認**」 | 2026-09-17 實測**讀不到**;本片補上 `SELECT`(版本號 `<本片>`) |
| `pcm_incident` | 「沒有人重試它,只有人**【看】**它」 | 同上,並補一句:唯讀角色在 `<本片>` 之前**看不到它** |

---

## 四、⚠️ 影響 —— **射程從 1 張變 7 張,風險要逐張看**

```sql
-- 列數(2026-09-17 實測)
SELECT 'supplier_sync_runs', count(*) FROM public.supplier_sync_runs UNION ALL …
```
| 表 | 列數 | 自由文字欄 | 我怎麼看 |
|---|---:|---|---|
| `supplier_sync_runs` | 280 | `note` | 🟢 供應商 slug + 時間戳 |
| `pcm_net_exposure_snapshot` | 10 | `details` / `peak_details` jsonb | 🟡 **不是 PII,是我們自己的資安曝露面讀數**。給唯讀角色看是它的本職 |
| `shipment_order_ship_clearances` | 4 | — | 🟢 全是 UUID 與時間戳 |
| `home_banners` | 1 | `rights_note` | 🟢 給客人看的文案與圖網址;`updated_by` 是員工代號 |
| `pcm_incident` | **0** | 🔴 `detail` · `resolution_note` | 見下面那格 |
| `pcm_settle_retry_attempts` | **0** | 🔴 `last_error` | 見下面那格 |
| `supplier_inbound_emails` | **0** | 🔴 `extracted` jsonb · `sender` | 見下面那格 |

### 🔴🔴 我跑了個資檢查,而**那個結果證明不了任何事** —— 要寫在最前面

```sql
SELECT count(*) AS 列數,
       count(*) FILTER (WHERE detail ~ '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}') AS 像email的,
       count(*) FILTER (WHERE detail ~ '09[0-9]{8}') AS 像手機的
FROM public.pcm_incident;
-- ⇒ 0 | 0 | 0     (另兩張同樣的查法, 同樣三個 0)
```
📌 **那三張表現在是空的 ⇒ 分母是 0 ⇒ 「零個資」自動成立。**
⇒ 🔴 **那不是「安全」,那是「還沒開始」。**
(同一個形狀在 `docs/patterns/guard-and-instrument-traps.md` 與
 `reference_storefront-catalog-invisible-to-curl` 都記過:**分母 0 時任何「0 件」都自動成立。**)

**⇒ 真正的風險是【未來式】的,而 GRANT 是永久的:**
| 欄 | 以後會裝什麼 | 為什麼可能有客人資料 |
|---|---|---|
| `pcm_incident.detail` | 被吞掉的例外訊息 | 🔴 例外訊息**沒有 schema** —— 誰都不保證它不會把一列資料整個 dump 進去 |
| `pcm_settle_retry_attempts.last_error` | 結算重試的錯誤字串 | 🔴 同上,而且它**掛在金流路徑上** |
| `supplier_inbound_emails.sender` / `extracted` | 廠商信寄件者與解析結果 | 🟡 `sender` 是**廠商的**商務信箱(例 `marketing@bonamiciracing.it`),不是客人的;`extracted` 是解析出來的料號等,**推論,未核** —— 今天 0 列,驗不了 |

🔵 **而這件事不必然要擋下本片**:
- `pcm_readonly` 已經讀得到 `products`、`orders` 那一族 —— **真正的客人資料它本來就看得到**。
- 這把鑰匙在 `.env.local`,拿得到的人是同一批。
- ⇒ **本片沒有把「誰拿得到」變大,只是把「同一批人看得到哪幾張」變大。**
🔴 **而我仍然把它寫出來,因為那三張是【錯誤訊息表】** —— 錯誤訊息是全庫最容易夾帶意外資料的地方,
而它**今天空著**這件事,讓任何檢查都看起來很乾淨。**下一個人不該從這份 plan 讀到「驗過了,沒問題」。**

| 其他 | |
|---|---|
| 顧客看得到嗎 | ❌ 不會。七張的 `anon` / `authenticated` 權限本片完全不動 |
| 寫入路徑 | ❌ 完全不變 |
| 要不要停機 / 鎖表 | ❌ 不用。`GRANT` 只改 catalog、不掃資料;仍照房規帶 `SET LOCAL lock_timeout` |

---

## 五、rollback

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE SELECT ON TABLE public.home_banners                   FROM pcm_readonly;
REVOKE SELECT ON TABLE public.supplier_inbound_emails        FROM pcm_readonly;
REVOKE SELECT ON TABLE public.pcm_incident                   FROM pcm_readonly;
REVOKE SELECT ON TABLE public.pcm_net_exposure_snapshot      FROM pcm_readonly;
REVOKE SELECT ON TABLE public.pcm_settle_retry_attempts      FROM pcm_readonly;
REVOKE SELECT ON TABLE public.shipment_order_ship_clearances FROM pcm_readonly;
REVOKE SELECT ON TABLE public.supplier_sync_runs             FROM pcm_readonly;
COMMIT;
```
🟢 **可逆、零資料風險**:只改 catalog,不動任何一列。
⚠️ 回滾後會回到今天的狀態,**不會壞掉任何在跑的東西** —— 目前沒有任何程式用 `pcm_readonly` 讀這七張(它今天根本讀不到)。
⚠️ **註解那兩處是資訊性的,回滾不用改回去**(改回去等於把一個已經有答案的問題重新標成「未確認」)。

---

## 六、🔴 已知限制 —— 這是**已拍板的取捨**,不是待補的缺口

**本片不涵蓋未來新增的表。** 每開一張新表,`pcm_readonly` 仍然預設看不到,要有人決定要不要給。

📌 **那是 Sean 2026-09-17 明確否掉乙(`ALTER DEFAULT PRIVILEGES`)的結果,不是漏掉:**
```
乙會把【未來每一張表】都自動給進去, 包含還沒設計、可能裝 PII 的那些
⇒ 那是把「預設不給」翻成「預設給」, 方向相反
⇒ Sean 拍甲 = 維持【預設不給, 每張新表要有人決定】
```
🛑 **下一任讀到這裡不要再問一次,也不要「順手補上」** —— 那會推翻一個拍過的板。

---

## 七、🔬 閘

### 前置閘(貼板前,🔴 名字打錯 = 靜默漏一張,而不會有東西叫)

```sql
WITH want(t) AS (VALUES
  ('home_banners'),('supplier_inbound_emails'),('pcm_incident'),('pcm_net_exposure_snapshot'),
  ('pcm_settle_retry_attempts'),('shipment_order_ship_clearances'),('supplier_sync_runs'))
SELECT count(*) FILTER (WHERE to_regclass('public.'||t) IS NULL) AS 不存在的表_應為0,
       count(*) FILTER (WHERE has_table_privilege('pcm_readonly','public.'||t,'SELECT')) AS 已經讀得到的_應為0
FROM want;
```
🟢 **2026-09-17 實跑:`0` / `0`** —— 七個名字都存在、七張都還讀不到。
📌 **這一格是因為我昨晚被「六個分類名有一個打錯就靜默少排除一個」教過才加的。**

### 🔴 事後閘 —— **不寫死 11,量差集**

⚠️ 我第一版寫「11 ⇒ 10」,而我自己在同一份檔裡寫過「**一個寫死的期望值,它的前提會過期**」。
⇒ 別的窗中間也補了 GRANT,分母就變,那時期望值是假的。**改成量【差集】:**

```sql
-- 貼板【前】先跑這一發, 把結果存下來當基準
CREATE TEMP TABLE before_blind AS
SELECT t.table_name FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
  AND NOT has_table_privilege('pcm_readonly', format('public.%I', t.table_name), 'SELECT');

-- …貼板…

-- 貼板【後】:少掉的必須【正好是】那七張, 不多不少
WITH after_blind AS (
  SELECT t.table_name FROM information_schema.tables t
  WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
    AND NOT has_table_privilege('pcm_readonly', format('public.%I', t.table_name), 'SELECT')
), 差 AS (SELECT table_name FROM before_blind EXCEPT SELECT table_name FROM after_blind)
SELECT count(*) AS 應為7,
       count(*) FILTER (WHERE table_name NOT IN
         ('home_banners','supplier_inbound_emails','pcm_incident','pcm_net_exposure_snapshot',
          'pcm_settle_retry_attempts','shipment_order_ship_clearances','supplier_sync_runs')) AS 不該少的也少了_應為0
FROM 差;
```
🟢 **這個形狀不會因為別的窗中間補 GRANT 而變假** —— 它問的是「**我這一發動了哪幾張**」,不是「現在總共剩幾張」。
🔴 而第二欄才是真正的守門:一支寫成 `GRANT … ON ALL TABLES` 的 migration,**第一欄照樣是 7 以上,第二欄會炸。**

```sql
-- 閘 C:給的只有 SELECT, 七張都是
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS 應為 SELECT
FROM information_schema.role_table_grants
WHERE grantee='pcm_readonly' AND table_schema='public'
  AND table_name IN ('home_banners','supplier_inbound_emails','pcm_incident','pcm_net_exposure_snapshot',
                     'pcm_settle_retry_attempts','shipment_order_ship_clearances','supplier_sync_runs')
GROUP BY 1 ORDER BY 1;
-- 應為 7 列, 每一列都只有 SELECT
```

### ④-a:餵一個【已知該紅】的進去,證明閘真的會咬

⚠️ **先講一個我差點交出去的假驗證**:我本來想寫「貼板前跑一次,差集 = 0 ⇒ 閘是好的」——
🔴 **那一格是恆真的**(貼板前 `before` 與 `after` 是同一份資料,自己減自己當然是 0)。
**它證明 SQL 跑得動,不證明它量得到東西。**

✅ 改成餵一個**已知該被抓到**的:把 `products`(它其實**讀得到**)混進 `before` 清單。

```sql
WITH before_blind(table_name) AS (VALUES
  ('home_banners'), …那七張…, ('products'))   -- 🔬 products 是故意混進去的
-- …上面同一段差集…
```
| | 實跑(2026-09-17) |
|---|---|
| 差集抓到幾張 | **1** |
| 不該少的也少了 | **1** ← 🟢 **第二欄咬住了** |
| 是哪幾張 | `products` |

🟢 **⇒ 第二欄不是恆 0,它抓得到「動到不該動的表」。** 那正是它要守的事。

| 其他閘 | 貼板前實測 | 貼板後應為 |
|---|---|---|
| 前置閘 | `0` / `0` | — |
| 閘 C | **0 列** | 7 列,每列只有 `SELECT` |

---

## 八、還要做的事

- [ ] **Sean 批這一版 plan**(射程從 1 張變 7 張,要他重新看過)
- [ ] 批了之後才寫 migration(含第三節那兩處 `COMMENT` 更新);**貼板的人是 Sean 或他明文授權的那一次**
- [ ] commit 前 codex / adversarial-reviewer 唯讀審一輪(鐵則 12:權限類)
- [ ] 貼完跑 `pcm_acl_approve_latest`(0914 拍甲),理由寫版本號
- [ ] 貼完把 `~/pcm-mailbox/進度-設計窗-0917.md` §6 那一格從「讀不到」改成實測值


---

# 🔴 自撞更正(2026-09-17,寫 migration 之前)

## 怎麼撞到的

我去找範本,讀到 `supabase/migrations/20260906380000_m4b_pcm_readonly_column_grants.sql`
(⟦貼板 51⟧,**codex R1 FAIL 8 → R2 FAIL 6+3 → opus adversarial R3 FAIL 4+5+3**,Sean 回 `甲` 才貼)。

## 🔴 更正一:我用的尺,那支板【明文記載它會少報】

該檔 `:40-43` 逐字:
> 🛑 **`has_table_privilege` 對欄級授權【少報】** —— 表級問它會回 `f`,
> 而那個 `f` **不代表它讀不到任何東西**。
> ⇒ 📌 **所以本片的驗收一律用 `has_column_privilege` 逐欄問**,不用表級那把尺。

📌 **而我整份 plan 的「11 張讀不到」就是用表級那把尺量出來的。**
✅ 用對的尺重量(2026-09-17):
```
public 72 張表 · 表級讀得到 61 · 🟢 真的一欄都讀不到 9 · 🔴 表級說不行而其實讀得到部分欄 2
```

## 🔴 更正二:那 2 張,正是我要動的其中 2 張 —— 而它們是【刻意】開一半的

```
pcm_settle_retry_attempts  給了 order_id · attempts · last_attempt_at · gave_up_at
                           ⛔ 刻意不給 last_error —— 錯誤原文
supplier_sync_runs         給了 id · supplier_slug · started_at · completed_at · outcome
                           ⛔ 刻意不給 note · run_ref —— 自由文字, 誰都可以往裡面寫任何東西
```
🔴 **我原本要下的 `GRANT SELECT ON TABLE` 會把那三個欄位一起給出去** ——
**那正是別人審了三輪、專門留下來不給的三欄。**
📌 **而我 §4 擔心的「自由文字欄會夾帶客人資料」,不是未來式 —— 有人早就處理過了,而我差點把它拆掉。**

## 🔴 更正三:`pcm_incident` 明文【對每一個角色都隱形】,而且有閘在管

`20260905290000_m4b_pending_refund_open_failure_incident.sql:146` 逐字:
> `static-checks:no-grant-needed public.pcm_incident -- 本表刻意對每一個角色都隱形。`
> `⇒ 明寫一行 GRANT 給任何角色 = 開一條本設計不要的直讀路, 而 detail 是 SQLERRM。`

🔬 那個標記由 `scripts/migration-static-checks.sh:757-777` 管。
⇒ 要它的健康數字**走既有的 definer 函式 `get_pcm_incident_health()`**,不是直讀。

## ✅ 更正後的射程:4 張(其餘 3 張要 Sean 重新拍)

| 表 | 判定 | 依據 |
|---|---|---|
| `home_banners` | 🟢 可給 | 無「刻意不給」紀錄;限制講的是 `anon` / `authenticated`,不是 `pcm_readonly` |
| `supplier_inbound_emails` | 🟢 可給 | 同上。⚠️ `sender` / `extracted` 仍是自由欄,見 §4 |
| `pcm_net_exposure_snapshot` | 🟢 可給 | 無紀錄;它的註解**自己在問**唯讀角色讀不讀得到 |
| `shipment_order_ship_clearances` | 🟢 可給 | 無紀錄;全是 UUID 與時間戳 |
| `pcm_settle_retry_attempts` | 🔴 **不給表級** | 給了會連 `last_error` 一起給 ⇒ 牴觸貼板 51 |
| `supplier_sync_runs` | 🔴 **不給表級** | 給了會連 `note` / `run_ref` 一起給 ⇒ 牴觸貼板 51 |
| `pcm_incident` | 🔴 **不給** | 明文對每一個角色隱形 + 閘在管 |

🎯 **那三張要的話,正確的形狀是【欄級 GRANT】照貼板 51 的做法,而那是另一題,要 Sean 拍。**

## 📌 要留下來的那一句

**我 §4 寫「下一個人不該從這份 plan 讀到『驗過了,沒問題』」—— 而第一個該這樣讀它的人是我自己。**
我那份 plan 通篇的分母,是用一把**別人早就寫下「它會少報」的尺**量出來的。
⇒ 🔴 **抄範本之前先把範本讀完** —— 我原本只打算抄它的閘,而救了我的是它檔頭那段講「為什麼不能用表級」的字。
