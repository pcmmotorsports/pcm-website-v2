# plan · 給 `pcm_readonly` 讀 `home_banners`(Sean 2026-09-17 Q8 甲)

> 鐵則 8(碰 GRANT ⇒ 先 plan 等批)+ 鐵則 12(權限類 ⇒ commit 前對抗審一輪)。
> **這份寫完停,等 Sean 批。migration 還沒寫。**
> 提案人:設計窗 `11` · 轉達:主視窗 `a5`

---

## 一、為什麼要動

**「首頁現在掛的是哪一張」目前沒有唯讀稽核路徑。**

2026-09-17 我要驗一張大圖的文案,`scripts/readonly-prod-sql.sh` 直接 `permission denied`,
只好改走 Supabase MCP 的 SELECT(管理 API,權限比唯讀角色大很多)才拿得到那一列。
📌 **一件「只是要看一眼」的事,逼人去用一把更大的鑰匙。** 那個習慣本身是風險。

---

## 二、🔴 先查清楚它【為什麼】讀不到 —— 是缺 GRANT,不是 RLS

⚠️ a5 轉達時寫「多半是沒 GRANT,而那句話我沒查過」。**我查了,結論相同,而證據在這裡。**

```sql
-- ① 這個角色繞得過 RLS ⇒ RLS 不可能是原因
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname='pcm_readonly';
-- ⇒ pcm_readonly | true | false
```

```sql
-- ② 跟一張讀得到的表(products)並排看 relacl
SELECT c.relname, c.relrowsecurity, array_to_string(c.relacl, E'\n')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('home_banners','products');
```
| 表 | RLS | relacl |
|---|---|---|
| `products`(讀得到) | on | `postgres=arwdDxtm/postgres` · `service_role=arwdDxtm/postgres` · **`pcm_readonly=r/postgres`** |
| `home_banners`(讀不到) | on | `postgres=arwdDxtm/postgres` · `service_role=r/postgres` · **(沒有 pcm_readonly)** |

✅ **結論:單純少一條 `GRANT SELECT`。** `rolbypassrls=true` ⇒ RLS 擋不住它,兩者不是同一個原因。

---

## 三、改什麼(**只有一行**)

```sql
GRANT SELECT ON TABLE public.home_banners TO pcm_readonly;
```

🛑 **不做的事,逐條寫下來:**
- ⛔ 不給 `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `REFERENCES` / `TRIGGER`。
- ⛔ 不順手給別的表(第五節那 10 張**不在本片射程**)。
- ⛔ **不加 `ALTER DEFAULT PRIVILEGES`** —— 它會讓**以後每一張新表**自動給這個角色,那是另一個決定(見第五節),要 Sean 另外拍。
- ⛔ 不動 `anon` / `authenticated` / `service_role` 的任何權限。
- ⛔ 不動 RLS、不加 policy。**這張表的防線正是「RLS on + 0 policy」**,本片不碰。

---

## 四、影響 / 風險

| | |
|---|---|
| 誰的權限變大 | 只有 `pcm_readonly`,只有 `SELECT`,只有這一張表 |
| 資料敏感度 | `home_banners` 的欄位是**給客人看的文案與圖網址** —— 零 PII、零金額、零金流。⚠️ 例外:`updated_by`(員工代號,如 `sean`)與 `source_email_id`。**推論,未核**:`source_email_id` 指向 `supplier_inbound_emails`,而那張表 `pcm_readonly` **也讀不到** ⇒ 它在這裡只是一個 UUID |
| 顧客看得到嗎 | ❌ 不會。`anon` / `authenticated` 零權限,前台走 `home_banners_live_v`,本片不動 |
| 寫入路徑 | ❌ 完全不變。寫入只走三支 `SECURITY DEFINER` RPC,`EXECUTE` 只給 `service_role` |
| 誰拿得到這把鑰匙 | `PCM_READONLY_DATABASE_URL` 在 `.env.local` ⇒ **已經能讀 61 張表的人,多讀這一張** |
| 要不要停機 / 鎖表 | ❌ 不用。`GRANT` 只改 catalog、不掃資料;**但仍照房規帶 `SET LOCAL lock_timeout`** |

---

## 五、⚠️ 我查到的比題目大 —— 這一段是給 Sean 的另一題,**本片不做**

```sql
SELECT count(*) FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
  AND NOT has_table_privilege('pcm_readonly', format('public.%I', t.table_name), 'SELECT');
```
🔴 **`public` 有 72 張表,`pcm_readonly` 讀得到 61 張 —— 讀不到的有 11 張,`home_banners` 只是其中一張。**

```sql
SELECT count(*) FROM pg_default_acl d WHERE array_to_string(d.defaclacl,',') LIKE '%pcm_readonly%';
-- ⇒ 0
```
📌 **根因**:`pcm_readonly` 身上**沒有任何一條預設權限** ⇒ **每一張表都是有人記得的時候手動 GRANT 的**
⇒ 🔴 **每開一張新表,這個唯讀角色就多一個盲點,而不會有任何東西叫。**

那 11 張分兩類:

| 類 | 表 | 這一片要不要管 |
|---|---|---|
| **回滾快照 / 已排退場**(4) | `dbk_external_id_rename_20260904` · `pcm_definer_searchpath_rollback_20260905100000` · `…110000` · `pcm_rls_rollback_20260904270000` | ⛔ 不用。它們的註解自己寫著「滿一週就 DROP」 |
| **活的、正在被寫**(7) | **`home_banners`** · `supplier_inbound_emails` · `pcm_incident` · `pcm_net_exposure_snapshot` · `pcm_settle_retry_attempts` · `shipment_order_ship_clearances` · `supplier_sync_runs` | 🔴 本片**只做 `home_banners`**(Sean 批的是這一張)。其餘 6 張端給他 |

🔴 **其中兩張特別值得他知道**(出處是**那兩張表自己的註解**):
- `pcm_net_exposure_snapshot` 的註解逐字寫著:*「施工窗的唯讀角色(`pcm_readonly`)是否讀得到**未確認**」*
  ⇒ **我這次量出來了:讀不到。** 那是一個掛了很久的未確認,今天有答案了。
- `pcm_incident` 的註解逐字寫著:*「它不是稽核表,也不是佇列 —— 沒有人重試它,**只有人【看】它**」*
  ⇒ 🔴 **而唯讀角色看不到它。** 一張「只有人看」的表,少了唯讀這條看的路。

🎯 **給 Sean 的題(不是本片):**
```
Q: 唯讀角色的盲點要怎麼收?
A: 甲|一次補那 6 張活的(一支 migration, 逐張列名)——【推薦】
     理由:射程明確、看得完;而且它不會自動涵蓋未來的新表 ⇒ 下次還是會漏
   乙|加 ALTER DEFAULT PRIVILEGES, 以後新表自動給
     ⚠️ 它會把【未來每一張表】都給進去, 包含還沒設計、可能裝 PII 的那些
     ⇒ 這是把「預設不給」翻成「預設給」, 方向相反, 要他知道自己在拍什麼
   丙|只做 home_banners, 其餘留著(= 不收)
```

---

## 六、rollback

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE SELECT ON TABLE public.home_banners FROM pcm_readonly;
COMMIT;
```
🟢 **可逆、零資料風險**:`GRANT` / `REVOKE` 只改 catalog,不動任何一列資料。
⚠️ 回滾後 `readonly-prod-sql.sh` 會回到今天的狀態(`permission denied`),**不會壞掉任何在跑的東西** ——
目前**沒有任何程式**用 `pcm_readonly` 讀 `home_banners`(它今天根本讀不到)。

---

## 七、🔬 事後閘 —— 要同時證明「讀得到這張」與「**沒有多讀到別的**」

🔴 **只證第一件是不夠的**:一支寫錯成 `GRANT SELECT ON ALL TABLES IN SCHEMA public` 的 migration,
**第一格照樣綠**。⇒ 第二格才是真正的守門。

```sql
-- 閘 A(正對照):讀得到了
SELECT has_table_privilege('pcm_readonly','public.home_banners','SELECT') AS 應為 true;

-- 閘 B(負對照, 🔴 這一格才是重點):讀不到的張數要【從 11 恰好變成 10】
SELECT count(*) AS 應為 10
FROM information_schema.tables t
WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
  AND NOT has_table_privilege('pcm_readonly', format('public.%I', t.table_name), 'SELECT');

-- 閘 C:給的只有 SELECT, 沒有別的
SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS 應為 SELECT
FROM information_schema.role_table_grants
WHERE grantee='pcm_readonly' AND table_schema='public' AND table_name='home_banners';
```
⚠️ **閘 B 的 `11` 是 2026-09-17 的實測值** —— 貼板前要**先重跑一次**確認分母還是 11。
📌 別的窗如果在這中間也補了 GRANT,分母會變,而**那時 `10` 就是一個假的期望值**。
### 🔬 ④-a:三道閘我**在貼板前先餵過一次**(2026-09-17,正式庫唯讀)

| 閘 | 貼板前實測 | 貼板後應為 |
|---|---|---|
| A 讀得到 | **`false`** | `true` |
| B 讀不到的張數 | **`11`** | `10` |
| C 給了哪些權限 | **`NULL`**(一條都沒有) | `SELECT` |

🟢 **三格都有非平凡的貼板前值 ⇒ 它們量得到東西,不是恆綠。**
⚠️ 而 **B 的 `11` 要在貼板當天重跑確認** —— 別的窗中間也補了 GRANT 的話分母會變,
那時 `10` 就是一個假的期望值。📌 **一個寫死的期望值,它的前提會過期。**

---

## 八、還要做的事

- [ ] **Sean 批**(碰 GRANT,鐵則 8)
- [ ] 批了之後才寫 migration;**貼板的人是 Sean 或他明文授權的那一次**
- [ ] commit 前 codex / adversarial-reviewer 唯讀審一輪(鐵則 12:權限類)
- [ ] 貼完跑 `pcm_acl_approve_latest`(0914 拍甲),理由寫版本號
- [ ] 貼完把 `~/pcm-mailbox/進度-設計窗-0917.md` §6 那一格從「讀不到」改成實測值
