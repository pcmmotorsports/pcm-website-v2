# 2026-08-16 · 外部曝險稽核（E 窗）—— 現況版

> **這份取代信箱裡的 `E-670` ~ `E-684` 十五封信作為【引用來源】。**
> 那些信是過程紀錄（含互相推翻的中間版本），**這份是現在成立的那一版**。
> 🔴 **只讀其中一封信會拿到錯的東西** —— 那天的結論被自己修正過至少四次，逐條列在 §6。

- **執行**：E 窗（安全稽核），2026-08-16
- **威脅模型（Sean 逐字，這是整份的北極星）**：
  > 「所有員工都可以看到客戶資料**沒有分權限**，我唯一擔心就是**資料被駭客攻擊**而已。」
  ⇒ **內部不分權是【刻意的】。防的是外部。** 本稽核只問「外面的人讀得到什麼」。
- **權限**：全程唯讀。零寫入、零 DDL、零 RPC、**零業務資料列讀取**（只做 `count(*)` 與 catalog 查詢）。
- **前一次同類**：`supabase/migrations/20260605120000_audit_revoke_overgrant_brands_categories.sql`（2026-06-05，finding M-1）

---

## 1. 結論（每條標明 repo 側 / production 側）

🔴 **口徑規則：`repo 側` = 只讀 `supabase/migrations` 推出來的；`production 側` = 用唯讀帳號實查的。
兩者不一樣，而且 repo 側【必然偏低】（理由見 §2.1）。引用時必須標。**

| # | 結論 | 側 | 數字 |
|---|---|---|---|
| 1 | `public` schema 的 SECURITY DEFINER 函式，**`anon` 可執行 = 0** | **production** | 80 支中 0 |
| 2 | `#525`（`admin_search_customers`）的洞**已關** | **production** | 存在 1、anon EXECUTE 0 |
| 3 | 六張客戶資料表 **`anon` 皆不可 SELECT** | **production** | 0 / 控制：六張都在 |
| 4 | `public` 真實表 46 張，**`anon` 的 INSERT/UPDATE/DELETE/TRUNCATE 全為 0** | **production** | 4 項皆 0 |
| 5 | `anon` 可 SELECT 的關聯：`public` **11 個**、跨所有 schema **26 個** | **production** | 見 §3 分佈 |
| 6 | RLS policy：`public` **36 條**，其中指名 `anon` 的 **1 條**（`legal_terms_versions`，公開條款） | **production** | 1 |
| 7 | 六張客戶表的 policy **全部用 `auth.uid()` 綁本人**（非 `USING (true)`），且**無任何 `anon` policy** | **production**（16 條逐條讀）+ 拋棄式 PG 實跑攻擊驗證 | 0 例外 |
| 8 | storefront 只有 **3 處** `service_role` 受控小門，皆 `server-only` + eslint 擋 | repo 側 | 3 |
| 9 | **沒有** service/secret key 掛在 `NEXT_PUBLIC_*` 前綴下 | repo 側 | 6 個 `NEXT_PUBLIC_*`，0 個敏感 |
| 10 | `public` 的 9 支 view，**8 支** `security_invoker=true`、**1 支 `false`** | **production**（全查，非抽驗） | **8/9** ⚠️ 見 `E685-1` |

**⇒ 一句話：截至 2026-08-16，沒有找到外部可讀取客戶資料的路徑。**

> 🔴 **第 7 條 2026-08-17 由 production 覆核（原為 repo 側推論）**：
> 六張表共 **16 條 policy** 逐條讀出，面向客人的**全部**是 `authenticated` + `auth.uid()` 綁本人；
> 唯二 `USING (true)` 的是 `customers_delete_service_role` 與 `wallet_insert_service_role`
> —— **`service_role` 專用（伺服器端），不是對外**。**六張表零 `anon` policy。**
> `UPDATE` 類三條**都同時有 `USING` 與 `WITH CHECK`**（少了後者可把自己的列改成別人的）。
> ⇒ **與 repo 側結論完全吻合** —— 這是 `E-683` 證明「repo ≠ production」之後，
> **特地回頭覆核的最重要那一條**。

---

## 2. 🔴 已知的系統性盲點（**這節比結論重要**）

### 2.1 repo 側稽核【必然】低估 —— 授權可以不經過任何 `GRANT` 語句

Supabase 的 `ALTER DEFAULT PRIVILEGES` 在**建立物件的那一刻**自動授權給 `anon` / `authenticated`：

```
public 的【表】  → SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
public 的【函式】→ EXECUTE                                    ← 這就是 #525 的成因
set_by = supabase_admin 一筆 + postgres 一筆                  ← 🔴 收掉一筆，另一筆還在
```

**那個授權沒有 `GRANT` 語句** ⇒ code review 看不到、repo grep 找不到。

**實測落差**：11 個 `anon` 可讀物件中，**4 個（36%）在 repo 裡沒有任何 `GRANT` 語句**
（`brands`、`categories`、`customer_wallet_balance_check`、`product_fitments_effective`）。

⇒ **引用「anon 只碰得到 N 個物件」時，N 是 repo 側就必定偏低。**

### 2.2 production 有 migration 沒建過的物件

`public` 關聯：production **55** vs repo CREATE 得到 **54**，
**3 張表沒有任何 migration 建過**：`product_fitments_effective` 及其 `_staging` / `_sync_log`。
（查證後**無 PII**，且 `_staging`/`_sync_log` **anon 讀不到**。）

⇒ **`supabase/migrations` 不是 production 的完整描述。**

### 2.3 🔴 `has_table_privilege` 看不到欄級授權 —— 方向也是少報

`GRANT SELECT (col1, col2) ON t TO anon` 之後，`has_table_privilege('anon', t, 'SELECT')` 仍回 **false**。
**事實在 `has_column_privilege` 裡。**

**當天被這件事咬過兩次，兩次都是少報：**
1. `E-682` 的「repo 側 9 vs production 11」有一部分來自它（`products` / `product_variants` 沒被算進去）
2. `E-684` 的斷言樣板第一版整個建在它上面 ⇒ **留著欄級授權也判綠**（B 窗實跑打穿）

⇒ **任何建在 `has_table_privilege` 上的盤點，都要另外問一圈 `has_column_privilege`。**
⚠️ 而 house **刻意**對型錄表下欄級授權（`products` / `product_variants`）
⇒ 盤點時**不能把欄級授權一律當成問題**，要分「刻意的」與「殘留的」。

### 2.4 🔴 `has_table_privilege` 也不管 schema USAGE —— 而這個方向是【多報】

要真的讀得到一張表，**表授權與 schema `USAGE` 兩層都要有**。
`has_table_privilege` 只回答第一層 ⇒ **它會把「有表授權但進不去 schema」算成可讀。**

**實測（2026-08-17，`E-687`）**：
- `anon` **有** USAGE：`public` / `storage` / `net` / `extensions` / `realtime`
- `anon` **沒有** USAGE：🟢 `cron`、🟢 `vault`（**secrets 存這裡**）、`pcm_cron`、`supabase_migrations`
- `auth`：有 USAGE 但**零表授權** ⇒ 讀不到任何列

⇒ **`cron.job` 那條擔心可以劃掉**（anon 進不去 `cron`）。
⇒ 「anon 跨 schema 可讀 26 個」修正為 **24 個兩層都通**，其中 `storage` 那 7 張被 RLS deny-all。

🔴 **三個盲點方向不同，不要當成「都偏保守」：**

| 盲點 | 方向 |
|---|---|
| ADP 不經 `GRANT` 授權（§2.1） | **少報** |
| `has_table_privilege` 看不到欄級授權（§2.3） | **少報** |
| `has_table_privilege` 不管 schema USAGE（本節） | **多報** |

### 2.5 只查了被問到的維度

本次查的是：DB 授權 / RLS / SECDEF 函式 / view / storefront 與 admin 的 `service_role` 與路由。
**已補查（`E-687`）**：Storage —— anon 有授權的 7 張**全部 RLS on + 0 policy = deny-all** ✅；
Realtime —— `realtime.messages` deny-all ✅，**但 `realtime.subscription` 的 RLS 是【關的】**
且 anon 有 USAGE + SELECT ⇒ **唯一一張兩層都通又沒 RLS 的表**；
⚠️ **它的內容與列數我沒量到**（稽核帳號無 `realtime` USAGE，那是設計）⇒ **標未確認，不要引用通則描述當本庫事實**。

**仍沒查**：Edge Functions、第三方整合、前端 XSS/CSRF、依賴鏈漏洞。

### 2.6 🔴 引用鏈放大效應（當天真的發生了）

`E-683` 一個**錯的行號** → 主視窗照抄轉述兩次 → 兩個窗都拿到同一個錯座標。
**是 B 窗去開原始檔才擋住。**

> **錯的 `檔案:行號` 比沒有出處更糟：下一個人在那裡找不到，會推翻一條【正確的】結論。**

⇒ 轉述座標要標「未自核」；**下斷言前先開原始檔**。

🔴 **而我在寫這一節的同一小時內，又犯了同一類錯一次：**
本檔 §5 原本把 `cron.job` 守門寫成 `20260605120000...:193-197`，
**而那支檔只有 83 行 —— `:193` 不可能存在。**（正確是 `20260723120000_m3_s2_settle_sweep_pgcron.sql:193-197`。）
成因：從 `E-677` 搬結論時，原文寫的是「**同檔** `:193-197`」，**搬過來時「同檔」指向的檔名變了。**

> **判別句：座標裡的「同檔／同上／該檔」在被搬走的那一刻就失效了。**
> **引用要寫完整檔名，不寫相對指涉。**

⚠️ **這條是我自己逐行複核時抓到的，不是別人抓的** ——
**但那也代表：如果我沒複核，這份「取代十五封信」的檔就會帶著一個假座標流通出去。**
⇒ **`檔案:行號` 一律逐條開檔驗，不能只驗「看起來像的」那幾條。**

---

## 3. 量法（可重跑，不是只有結論）

**憑證**：`~/.pcm-readonly-db`（`chmod 600`，唯讀帳號 `pcm_audit_ro`）。
🔴 **`grep` 取單顆，絕不 `source`**。此檔不進 git。

```bash
URL=$(grep -m1 '^PCM_AUDIT_RO_URL=' ~/.pcm-readonly-db | cut -d= -f2-)
```

🔴 **每次連上先跑這兩個正向對照**，否則後面每一個「查無」都不算數：

```sql
SELECT current_user, session_user;                                    -- 兩者相同 = 真登入
SELECT count(*) FROM pg_catalog.pg_attribute WHERE attnum > 0;        -- 必須非 0
```

⚠️ **一律用 `pg_catalog`，絕不用 `information_schema`** ——
後者只回「你自己有權限的東西」，而稽核帳號**故意沒有權限**
⇒ **它會對稽核帳號系統性回 0**（實測：同一張表欄位數 `information_schema` = 0、`pg_catalog` = 4）。

**核心查詢**：

```sql
-- anon 可執行的 SECDEF 函式（期望 0）
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.prosecdef AND n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- anon 可讀的關聯（跨所有非系統 schema）
SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT LIKE 'pg\_%'
   AND n.nspname <> 'information_schema' AND has_table_privilege('anon', c.oid,'SELECT');

-- 該授權是「平台預設給的」還是「我們明文給的」
SELECT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE a.grantee = 0 AND a.privilege_type='SELECT')   -- true = PUBLIC 授權
  FROM pg_class c WHERE c.oid = 'public.<物件>'::regclass;

-- 預設權限那把槍現在是不是還 armed
SELECT n.nspname, d.defaclrole::regrole, a.grantee::regrole, a.privilege_type
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace,
       LATERAL aclexplode(d.defaclacl) a WHERE d.defaclobjtype='r';
```

**`anon` 有表授權的 26 個分佈**：`public` 11、`storage` 7、`cron` 2、`extensions` 2、`net` 2、`realtime` 2。
⚠️ **但要加 schema USAGE 那一層才是「真的讀得到」**（§2.4）：
`cron` 那 2 個 **anon 無 USAGE ⇒ 不可達** ⇒ **兩層都通的是 24 個**，
其中 `storage` 7 張 RLS on + 0 policy ⇒ **實際讀得到列的更少**。

```sql
-- schema USAGE 那一層（缺了它，上面的數字會多報）
SELECT n.nspname, has_schema_privilege('anon', n.nspname, 'USAGE') AS anon_usage
  FROM pg_namespace n
 WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema' ORDER BY 1;
```

---

## 4. 開著的 finding

| ID | 嚴重度 | 內容 | 卡在誰 |
|---|---|---|---|
| **`net` 曝露** | **未知（可能最高）** | `net.http_request_queue` 會裝 `Authorization: Bearer <CRON_SECRET>`，且對 PUBLIC 可讀。**若 `net` 有列入 Data API 曝露 schema ⇒ 任何訪客拿得到那把 token。** DB 裡查不到該設定（`pg_db_role_setting` 有 `authenticator` 列但無 `pgrst.db_schemas`）⇒ **要看 Dashboard。**<br>🔴 **「查不到」不得讀成「未曝露」。** | **Sean（Dashboard）** |
| `E683-1` | 常設風險 | 新物件出生自帶 `anon` 權限（表含 RLS 管不到的 `TRUNCATE`；函式含 `EXECUTE`）。**現況 46 張全乾淨，但靠的是每個人都記得。** | 部分已解：`E-684` 斷言樣板已交 B 窗，**新 migration 起用** |
| `E682-1` | 低（只靠一個屬性） | `customer_wallet_balance_check`（客戶儲值金餘額 view）授了 `anon` SELECT。**今天不外洩**（`security_invoker=true` + 底表無 anon 授權 + RLS + 零 anon policy 四層），**但那個授權沒有任何用途**。拿掉 `security_invoker` 即成真洞。**建議 REVOKE。** | **Sean（鐵則 12 ②）** |
| `E680-1` | 低（未守路徑） | `settle-sweep` route 用 blind spread `...result` 回應，而回應會落進 PUBLIC 可讀、保留 6h 的 `net._http_response`。**今天不洩**（`SweepSettlementsResult` 全是計數），但**姊妹片 email-sweep 用顯式 allowlist 且寫明理由**。 | 待派 |
| **`E685-1`** | **低（但這是全樹唯一一個真的 RLS 繞過）** | `vehicle_taxonomy_public` 是 **`security_invoker=false`**（其餘 8 支 view 都是 `true`），view owner = `postgres`，而 `product_fitments` / `product_fitments_effective` 的 `relforcerowsecurity = false` ⇒ **owner 繞過 RLS** ⇒ 這支 view **看得到已下架商品的車型資料**，而 `anon` 讀得到它。<br>**曝露內容只有 `moto_brand / model_code / year_start / year_end`（零 PII、零價格）**，故嚴重度低。<br>🔴 **但它是唯一一支「底表 RLS 對它無效」的 view** ⇒ 日後 `product_fitments*` 若加上任何敏感欄或更嚴的 policy，**這支會直接漏過去，而且不會有任何東西紅。** | 待派 |
| `rls_auto_enable` fail-open | 低-中 | `20260531142534_govern_rls_auto_enable.sql:59-63` 用 `EXCEPTION WHEN OTHERS THEN RAISE LOG` **吞掉自己的失敗** ⇒ 開 RLS 失敗時無聲。 | 待派 |
| `E679-1` | 設計債 | 建立唯讀帳號連線字串的那段指令，**整條唯讀鏈可以被一個沒對上的 `sed` 靜默繞過**（身分沒被換掉 ⇒ 用超級使用者連線）。**所有守門守的是「帳號建得對不對」，沒有一個守「最後用哪個身分連」。** 唯一會叫的是那行只印身分的自檢，**而使用者可以不看它**。<br>🔴 **收斂：一道防線如果使用者可以略過它，它就不算防線。** 正解＝身分不對就**不寫檔**。 | 待派 |
| 稽核帳號體檢缺口 | 流程 | `E-675` 體檢驗 `rolcanlogin` 但**不驗密碼存在** ⇒ 「體檢通過」不蘊含「連得上」。**當天真的發生了。** | 待補 |

---

## 5. 已驗證有效的既有防護（不要動它們）

- **`admin` 後台讀路徑**：`apps/admin/src/proxy.ts:39-50` 預設擋、dev bypass 雙重閘（`NODE_ENV` + 顯式 flag）、SSO 白名單**精確兩條**。
- **`payment-status` route**：IDOR 雙軸（RLS + 應用層 `.eq('customer_user_id', userId)`），`getUser()` 向 auth server 驗 JWT，回應只有 `{status}`。
- **三支 cron route**：`CRON_SECRET` + `timingSafeEqual` 常數時間比對 + 最小長度 32。
- **`line-admin.ts`**：身分鍵存 `app_metadata`（service_role-only）而非 `user_metadata`（公開 signUp 可偽造）⇒ 擋冒登入。
- **`customers` 欄級授權**：`GRANT UPDATE (name, phone, birthday, updated_at)` ⇒ **會員改不了自己的 `tier`**（拋棄式 PG 實測「自我升級成經銷商」被拒）⇒ 經銷價那條路在 DB 層是關的。
- **`cron.job` 內容守門**：`supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:193-197`
  斷言 `cron.job.command` 不得含 `Bearer|Authorization|decrypted_secret`
  ⇒ token 由 wrapper 執行期從 vault 取，不寫死在 job command 裡。

---

## 6. 🔴 當天被推翻／改過口徑的（分辨「當初就錯」與「當初對、現在過期」）

| 原始 | 現在的版本 | 哪一種 |
|---|---|---|
| `E-670`/`E-672`：「anon 只碰得到 **9** 個型錄物件」 | **production 是 11 個**；差額成因見 §2.1 | **當初就低估**（方法盲點，非筆誤） |
| `E-675`：體檢判準「讀得到任何一張表 = 不安全」 | **改成**「讀得到**非 PUBLIC 授權**的表 = 不安全」（`E-676`） | **當初判準就錯**（平台物件對 PUBLIC 開，不是我們給的） |
| `E-675` §4 的「重建帳號」指示 | **作廢**：重建救不了，問題在判準（`E-676`） | 當初就錯 |
| `E-674` | **作廢** → `E-674a` / `E-674b`（缺「貼哪個專案」） | 當初就漏 |
| `E-683`：`TRUNCATE 不受 RLS` 出處 `:24-26` | **正確是 `20260605120000...:22`**，且另有 2 個獨立出處 | 行號當初就錯、結論一直對 |
| 四封信的「沒有人讀過正式庫真實狀態」 | **A 庫已作廢**（本次已讀）；**報價單庫仍成立** | 當初對、**現在過期一半** |

---

## 7. 下一步（未做，非承諾）

1. **`net` / `cron` / `extensions` 是否列入 Data API 曝露 schema** ← 決定上表第一列的嚴重度，**最優先**
2. `E682-1` 的 `REVOKE` 提案（要 Sean 批）
3. 報價單庫（`pcm-quote-v2`）整個沒查 —— 唯讀帳號尚未建立（`E-674b`）
4. §2.3 那些沒查的維度

---

## 8. 🔴 本檔【不】包含什麼（涵蓋範圍，不是完備感）

> **這一節存在的理由**：一份讀起來完備的檔，它的完備感會掩蓋它的涵蓋範圍。
> 本檔取代十五封信作為**結論**的引用來源，**但下面這些【只在信裡】，本檔沒有搬進來**：

| 只在信裡的東西 | 在哪封 | 什麼時候會需要它 |
|---|---|---|
| **唯讀稽核帳號的建立 SQL**（含貼錯專案守門、內建驗收） | `E-674a`（A 庫）/ `E-674b`（報價單） | 要建**報價單庫**那組帳號時 |
| **帳號體檢 SQL** + **安全重建 SQL**（`DROP OWNED BY` 先於 `DROP ROLE`、擁有物件時拒刪） | `E-675` + `E-676`（判準已更正版） | 帳號行為不對時 |
| **密碼重設 SQL**（性質閘、不動權限） | `E-681` | 忘記密碼時 |
| **新物件收權斷言樣板全文**（七情境驗過，含欄級授權那格） | `E-684` | 寫**任何新 migration** 時 ← 最常用 |
| 面 3（拿 anon key 實打 PostgREST）的端點清單 | `E-673` | **從未執行**；後來改用 DB 帳號直查 |
| 各封的完整量法輸出與中間推理 | 各封 | 要複查某一條結論怎麼來的 |

⚠️ **也就是說：本檔回答「現在的結論是什麼」，不回答「怎麼重建那些工具」。**
**兩者都需要的人，要同時看本檔與對應的信。**

---

## 附：原始信件對照（過程紀錄，非引用來源）

`E-670` SECDEF 全樹 · `E-671` 應用層 service_role · `E-672` RLS policy 條件 ·
`E-673` 面3 端點清單 · `E-674a/b` 唯讀帳號 SQL · `E-675` 體檢 · `E-676` 判準更正 ·
`E-677` 那 6 張嚴重度 · `E-678` 預測封存 · `E-679` 連線 · `E-680` pg_net repo 盤點 ·
`E-681` 密碼 · `E-682` 正式庫實測 · `E-683` 低估成因 · `E-684` 斷言樣板
（皆在 `~/pcm-mailbox/`，**不進 git**）
