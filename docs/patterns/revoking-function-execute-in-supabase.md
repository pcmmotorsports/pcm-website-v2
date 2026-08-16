# 在 Supabase 上收掉一支函式的 EXECUTE:**兩道 REVOKE,少一道都是開的**

> **這份檔的存在理由**:同一件事已經被寫過兩次(見 §5),兩次都寫在
> **「只有當事人會回去讀」的載體**裡 —— 而寫新 `SECURITY DEFINER` 函式的那一刻,
> 沒有任何東西會叫。所以第三次寫在這裡,**並且在 `CLAUDE.md` 路由表留了一行指向它**。
> 沒有那一行,這份檔只是換個資料夾寫第四次。
>
> 立檔:2026-08-16 B 窗,來源 = E 窗 SECDEF 全樹稽核(`~/pcm-mailbox/E-670-SECDEF全樹稽核.md`)。

---

## 1. 規則(一句)

在 `public` schema 建的函式,要讓 `anon` **執行不到**,
必須**同時**收掉 **PUBLIC 那份**與 **`anon`/`authenticated` 具名那份**。

```sql
REVOKE ALL ON FUNCTION public.<fn>(<argtypes>) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.<fn>(<argtypes>) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.<fn>(<argtypes>) TO service_role;
```

（house 現行寫法。上面是**佔位版**;帶真實函式名的原文在
`supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql:192` 與同檔 `:212-213`。）

📎 也可以寫成一行 —— **`PUBLIC` 與具名角色允許列在同一個 grantee 清單裡**:
`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;`
（同檔 `:205-206` 已記下這點。**「不能寫在一起」是假的。**)

🔴 **這兩道是【必要基線】,不是「已經關上」的證明。** 驗收要問的是
`has_function_privilege(<角色>, <具名 regprocedure>, 'EXECUTE')` 為 false,
**外加**排除 owner 與 `SET ROLE` 兩條繞路 —— **見 §3.5,那一節有實測反例。**

---

## 2. 為什麼一道不夠(四臂實測,不是推論)

兩個方向的漏法**互為鏡像**,而大多數人只知道其中一個:

- **方向甲｜只 `FROM PUBLIC` ⇒ 收不到具名授權**（Supabase 對 `public` schema 掛了
  `ALTER DEFAULT PRIVILEGES`,新函式**直接授權給 `anon` / `authenticated` 兩個具名角色**）
- **方向乙｜只 `FROM anon, authenticated` ⇒ 收不到 PUBLIC 那份**（Postgres 對新函式授 `EXECUTE`
  給 `PUBLIC`,而 **`PUBLIC` 是「所有角色」、不是一個你去繼承的角色** ⇒ `anon` 照樣執行得到）

### 🔴🔴 方向乙**與 `rolinherit` 無關** —— 本檔前一版寫錯,2026-08-16 實測更正

前一版寫「方向乙靠 `anon.rolinherit = t`,而正式庫的 `rolinherit` 未確認」。
**那句話是錯的,而且錯的方向很危險** —— 它會讓人以為「我們的 `anon` 如果是 `NOINHERIT`,
那 `FROM PUBLIC` 那道就可以省」。**不可以。**

🔴 **下面三節的 SQL 都是【節錄】,不是整段貼上去就會動。** 要重跑請先跑這個 setup
(拋棄式叢集照 `docs/runbooks/throwaway-postgres-for-migration-verification.md`;
macOS 上 `pg_ctl start` 前要 `LC_ALL=C`,否則報 `postmaster became multithreaded`):

```sql
-- setup:三個角色一次建好,後面各節都靠它
create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit;
```

```sql
-- 拋棄式 PG 17.10 實跑(B 窗 2026-08-16),anon 刻意建成 NOINHERIT:
create function public.f_arm(a text) returns int language sql security definer as $$ select 1 $$;
revoke all on function public.f_arm(text) from anon, authenticated;   -- 只下具名那道
select has_function_privilege('anon','public.f_arm(text)','EXECUTE'); -- => t  ← 洞還在
select rolinherit from pg_roles where rolname='anon';                 -- => f  ← 而且它是 NOINHERIT
revoke all on function public.f_arm(text) from public;                -- 補上 PUBLIC 那道
select has_function_privilege('anon','public.f_arm(text)','EXECUTE'); -- => f  ← 這時才關上
```

**依據**:PostgreSQL `GRANT` 文件逐字 ——
> Any particular role will have the sum of privileges granted directly to it,
> privileges granted to any role it is presently a member of, and privileges granted to `PUBLIC`.

**`PUBLIC` 是那個總和裡【獨立的第三項】,不經過角色成員身分** ⇒ `INHERIT` / `NOINHERIT` 管不到它。
(`INHERIT` 屬性管的是**成員身分**的繼承,官方文件同頁。)

⇒ **兩個方向現在都有直接證據,不再是一強一弱:**

| 方向 | 證據 |
|---|---|
| **甲** | **正式庫實錘** —— `#525` 那支 migration apply 當場被自己的守門擋下,ACL 形狀 `[anon:EXECUTE,authenticated:EXECUTE,service_role:EXECUTE]`(`supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql:167-172`) |
| **乙** | **本機實測 + 官方文件語意**(上面那段 SQL 可逐行重跑);且**不依賴任何未確認前提** |

| REVOKE 寫法 | `anon` 執行得到嗎（PG 17.10 實測） |
|---|---|
| 完全不 REVOKE | ✅ 可以 |
| 只 `FROM anon, authenticated` | ✅ **可以 ← 洞還在**（**與 `rolinherit` 無關,NOINHERIT 也一樣**） |
| 只 `FROM PUBLIC` | ✅ 可以 |
| **`FROM PUBLIC` + `FROM anon, authenticated`** | ❌ 直接路徑關上（**但這不等於「一定執行不到」,見 §3.5**） |

**量法（E 窗 2026-08-16 實跑）**:拋棄式 Postgres **17.10**,四支只差 REVOKE 寫法的
同名 SECDEF 函式,判準欄位 = `has_function_privilege('anon', …, 'EXECUTE')`。
起叢集照 `docs/runbooks/throwaway-postgres-for-migration-verification.md`,
再依序 `psql -f acl_probe.sql`、`psql -f acl_probe_p2.sql`。
⚠️ **那兩支 `.sql` 探針不在本 repo**（`find . -name 'acl_probe*'` 零命中),原始檔在 E 窗的
scratchpad、隨 session 消失 ⇒ **本表要重跑必須先重寫探針**,不是「照著跑」。

🔴 **判準要用 `has_function_privilege`,不要用 `proacl` 字面。**
前者算的是**有效權限**（含繼承路徑),後者只是 ACL 字串 —— 兩者會不一致,
而會咬人的是有效權限。

---

## 3. 判別句(寫或審一支 SECDEF 函式時,當場問這一句)

> **我這支函式收了幾道 REVOKE?**
> **答案是 1 ⇒ 不管收的是哪一道,`anon` 都還執行得到。**

配套(順手撿):

| 動作 | 對既有 ACL 的影響 |
|---|---|
| `CREATE OR REPLACE`,**參數型別沒變** | **保留舊 ACL** ⇒ 之前的 REVOKE 仍有效 |
| `CREATE OR REPLACE`,**參數型別變了** | 🔴 **不是取代,是【多一支】** ⇒ 舊簽名與它的 ACL **原封不動留著**,新簽名是全新物件、重新拿到 anon/authenticated 授權 |
| `DROP` + `CREATE` | 舊的真的沒了;新的是新物件 ⇒ 重新拿到授權 |

🔴🔴 **「參數型別變了」那一列前一版寫成「算新物件」,漏掉最重要的一半:舊的不會消失。**
2026-08-16 拋棄式 PG 17.10 實跑:

```sql
-- 接 §2 的 setup(三個角色已建)
create function public.f_ovl(a text) returns int language sql security definer as $$ select 1 $$;
revoke all on function public.f_ovl(text) from public;
revoke all on function public.f_ovl(text) from anon, authenticated;  -- 舊簽名鎖好
create or replace function public.f_ovl(a int) returns int language sql security definer as $$ select 2 $$;  -- 只改了參數型別

select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='f_ovl';          -- => 2   ← 兩支都在
select has_function_privilege('anon','public.f_ovl(int)','EXECUTE');   -- => t  ← 新的是開的
select has_function_privilege('anon','public.f_ovl(text)','EXECUTE');  -- => f  ← 舊的仍鎖著
```

⇒ **改參數型別之後你有【兩支】SECDEF 函式,而你的 migration 只寫了其中一支的 REVOKE。**

**正確做法(四件,缺一都會留東西):**
1. 對**新簽名**下兩道 REVOKE。
2. 決定舊簽名去留。要刪 ⇒ **用精確簽名** `DROP FUNCTION public.f(text) RESTRICT;`
   **`RESTRICT` 因相依而失敗是它的用途,不是障礙。不要為了讓它過去就改 `CASCADE`**
   (會連相依物件一起刪)。先把相依遷走,再刪。

   🔴🔴 **但 `RESTRICT` 看得到的相依【比你以為的少】** —— 2026-08-16 拋棄式 PG 17.10 實測:

   | 呼叫端形式 | `DROP … RESTRICT` 會被擋嗎 |
   |---|---|
   | `view` 用到它 | ✅ 擋住(`cannot drop … view v_x depends on function`) |
   | 另一支函式,本體寫成 **`BEGIN ATOMIC`** | ✅ 擋住(`function caller depends on function`) |
   | 另一支函式,本體寫成 **`$$ … $$` 字串** | ❌ **不擋,DROP 直接成功** |

   **`$$` 字串本體不進 `pg_depend`** —— Postgres 沒有解析字串裡在叫誰。
   ⇒ 🔴 **`RESTRICT` 過了【不等於】沒有呼叫端。** 你會在 prod 執行期才炸。
   ⇒ **刪之前另外 grep 一次函式名**(`git grep -n '<函式名>' -- supabase/ apps/`),
   **不要拿 `RESTRICT` 成功當「查過了」。**
   📎 這條與 §3.5 相扣:§3.5 列的「另一支 SECDEF wrapper 在裡面呼叫它」
   **恰好就是 `RESTRICT` 看不到的那一種**(house 的 SECDEF 函式幾乎都是 `$$` 本體)。
3. 不刪 ⇒ **在 migration 裡明寫為什麼留著**,並對**兩支**都下斷言。
4. 🔴 **兩支並存時另有一個坑:呼叫解析**。
   若新舊簽名有**預設參數**或**可隱式轉型**的型別(`text`/`varchar`、`int`/`bigint`…),
   同一句呼叫可能**選到你以為已經淘汰的那一支**。⇒ 並存前先確認呼叫端解析到哪一支,
   `\df public.f` 逐支看簽名與預設值。**「舊的沒人叫」是需要證明的,不是預設。**

---

## 3.5 🔴 兩道 REVOKE 是**必要基線,不是「已經關上」的證明**

兩道 REVOKE 只移除 **PUBLIC / `anon` / `authenticated` 的直接路徑**。以下路徑它管不到:

- `anon` 是該函式的 **owner**。⚠️ 精確說法:**owner 撤得掉自己當下的 `EXECUTE`**,
  但**撤不掉「可以隨時再 `GRANT` 回來 / `ALTER` 這支函式」的控制權** ⇒ owner 這條路
  **不是靠 REVOKE 能關的**,要靠「這支函式不歸那個角色」。
- `anon` 是某個仍持 EXECUTE 的角色的成員,**且能 `SET ROLE` 過去**
- 其他角色被授了 EXECUTE 而 `anon` 繞得到

2026-08-16 拋棄式 PG 17.10 實跑,**兩道 REVOKE 都下了、`anon` 還是 `NOINHERIT`**:

```sql
-- 接 §2 的 setup(三個角色已建)
create function public.f_sr(a text) returns int language sql security definer as $$ select 1 $$;
revoke all on function public.f_sr(text) from public;
revoke all on function public.f_sr(text) from anon, authenticated;   -- 兩道都下了
grant execute on function public.f_sr(text) to service_role;
grant service_role to anon;
select has_function_privilege('anon','public.f_sr(text)','EXECUTE');  -- => f  ← 看起來安全
select pg_has_role('anon','service_role','SET');                      -- => t  ← 但 SET ROLE 過得去
```

🔴 **`has_function_privilege` 回 `f` 的同時,那條路仍然開著。**

⇒ **驗收判準(涵蓋【直接呼叫 + 角色切換】兩條,不是「一定執行不到」的證明):**

```sql
-- 🔴 這是【範本】。把 f_arm(text) 換成你自己的函式,兩處都要換。
-- 直接照貼可跑:接 §2 的 setup + §2 那段(它建了 f_arm)。
-- 對具名 regprocedure 問, 且【枚舉所有角色】——只查 service_role 一個不夠
select r.rolname,
       pg_has_role('anon', r.oid, 'SET') as anon切得過去,
       has_function_privilege(r.oid, 'public.f_arm(text)'::regprocedure, 'EXECUTE') as 該角色可執行
  from pg_roles r
 where pg_has_role('anon', r.oid, 'SET')
   and has_function_privilege(r.oid, 'public.f_arm(text)'::regprocedure, 'EXECUTE');
-- 要求:回【零列】。任一列 = anon 有一條 SET ROLE 繞路。
-- 📎 anon 自己也是 pg_roles 的一列,且 pg_has_role('anon','anon','SET') => t
--    ⇒ 直接授權給 anon 的情況這條查詢也抓得到,不用另外寫一條。
```

🔴 **零列 ≠ owner 那條路已排除。** 若 `anon` 切得到**函式 owner**、而 owner 已自撤 `EXECUTE`,
這條查詢**回零列** —— 但 owner **可以隨時自我 re-GRANT**(見上方 owner 那條,已實測重現)。
⇒ **owner 是誰要另外看,不在這條查詢的涵蓋範圍內。**

🔴🔴 **這個判準只涵蓋「anon 自己去呼叫」與「anon 切角色去呼叫」。它【不】證明那支函式不可觸發。**
仍然開著的間接入口(本檔**未逐一驗證**,列出來免得被讀成已涵蓋):
**另一支 anon 叫得到的 SECDEF wrapper 在裡面呼叫它** / **trigger** / **view 的相依呼叫鏈**。
⚠️ **而 §3 已實測:`$$` 本體的那種 wrapper,連 `DROP … RESTRICT` 都看不到它** ——
所以這條缺口比它看起來更難用機械方法關掉。
⇒ 要宣稱「完全不可觸發」,得另外把**間接入口與相依呼叫鏈**查一遍 —— **本檔沒做這件事。**

⇒ **不要把「我下了兩道 REVOKE」當成驗收通過。那是動作,不是結果。**

---

## 3.6 🔴🔴 驗的時候最容易踩的那一腳:**ACL 欄是 `NULL` 時,PUBLIC 那份看不見**

前面講的是**怎麼關**。這一節是**怎麼確認它關上了** —— 而這裡有一個
**會回「零命中」、而零命中正好是你希望看到的結果**的陷阱。

**全新建的函式,`pg_proc.proacl` 是 `NULL`。** `NULL` 不代表「沒有人有權限」,
它代表**「沿用預設」,而預設裡就有 PUBLIC 的 `EXECUTE`。**
⇒ 直接 `aclexplode(proacl)` 去找 PUBLIC ⇒ **回零列,而 `anon` 其實執行得到。**

2026-08-16 拋棄式 PG 17.10 實測(同一支全新函式,三種問法):

```sql
-- 接 §2 的 setup
create function public.f_null(a text) returns int language sql security definer as $$ select 1 $$;

-- A：proacl 是不是 NULL
select (proacl is null) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='f_null';                                   -- => true

-- B：天真查法 —— 直接展開 proacl 找 PUBLIC
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
       lateral aclexplode(p.proacl) a
 where n.nspname='public' and p.proname='f_null'
   and a.grantee=0 and a.privilege_type='EXECUTE';                                  -- => 0   ← 看起來乾淨

-- C：正確查法 —— NULL 時要展開 acldefault
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
       lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where n.nspname='public' and p.proname='f_null'
   and a.grantee=0 and a.privilege_type='EXECUTE';                                  -- => 1   ← PUBLIC 有 EXECUTE

-- D：事實 —— anon 到底執行得到嗎
select has_function_privilege('anon','public.f_null(text)','EXECUTE');              -- => true
```

🔴 **B 回 `0` 而 D 回 `true`。** 那個 `0` 不是「沒有 PUBLIC 授權」,是「我沒問對地方」——
**而它長得跟「乾淨」一模一樣。**

⇒ **兩條硬規則:**
1. **判準用 `has_function_privilege`(有效權限),不要用 ACL 欄的字面。** ACL 只有在你
   已經知道自己在看什麼的時候才有用。(這條 §2 講過,這裡是它的實測反例。)
2. **非要讀 ACL 欄不可 ⇒ 一律 `coalesce(<acl 欄>, acldefault(<類型碼>, <owner>))`。**
   類型碼:函式 `'f'`、表/view `'r'`。

### ⚠️ 但規則 1 在**表**上有一個洞:`has_table_privilege` **看不到欄級授權**

規則 1 對**函式**成立(`EXECUTE` 沒有欄級這回事)。**對表不成立** ——
2026-08-16 拋棄式 PG 17.10 實測(只給兩欄的 `SELECT`):

```sql
-- 接 §2 的 setup
create table public.t_col (id int, secret text, name text);
revoke all on table public.t_col from public;
grant select (id, name) on table public.t_col to anon;   -- 只給兩欄

select has_table_privilege ('anon','public.t_col','SELECT');            -- => false  ← 表級說沒有
select has_column_privilege('anon','public.t_col','id','SELECT');       -- => true   ← 欄級說有
select has_column_privilege('anon','public.t_col','secret','SELECT');   -- => false
```
**而事實是 `anon` 讀得到**:`set role anon; select id, name from public.t_col;` 成功;
`select secret` 才被擋(`permission denied for table t_col`)。

🔴 **表級判準回 `false`,而那個角色實際讀得到資料。** 方向是**少報**,
而**少報比多報危險:多報會有人來查,少報聽起來像已經收斂了。**
⇒ **稽核表的可讀性時,`has_table_privilege` 要配 `has_column_privilege` 一起問**,不能只問表級。

### 🔴🔴 這一類錯誤**只有【對照】看得見** —— 單邊再仔細也查不出來

同一天,兩個窗**獨立**撞到同一件事的兩面:

| | 它看到的 | 它的結論 |
|---|---|---|
| repo 側分析(E 窗) | `GRANT SELECT (col,…)` 存在 | 「anon 有授權」 |
| production 表級檢查 | `has_table_privilege(…,'SELECT')` = `false` | 「anon 沒授權」 |

**兩邊都對,數的是不同東西。** 而**任何一邊單獨看,都看不出自己漏了什麼** ——
它的查詢成功了、回了一個合理的數字、沒有任何異常長相。

⇒ **判別句:我這個數字,有沒有第二個【用不同方法量的】數字可以對?**
沒有 ⇒ **那不是「已驗證」,是「只有一個來源」。**
⇒ 而對照對出**差異**時,第一個動作**不是挑一邊相信** ——
是問**「這兩個各自在數什麼」**。今天這兩邊的答案是「欄級」與「表級」,**兩個都要留**。

📎 這與本檔其他坑的差別:前面那些(ACL 是 `NULL`、`RESTRICT` 看不到 `$$` 呼叫端)
**單邊就查得出來,只要你知道要問**。這一條**單邊查不出來**,
因為錯的不是查法、是**你以為那個數字在數的東西**。

### 同一腳在**表**上也踩得到(2026-08-16 E 窗實例)

本檔講函式,而**完全相同的機制在表上成立**:
`REVOKE ... FROM <某角色>` **收不掉授權給 `PUBLIC` 的那份**,
而查的時候 `relacl` 一樣可能是 `NULL`、一樣要 `coalesce(c.relacl, acldefault('r', c.relowner))`。

E 窗建唯讀稽核帳號時就中了:體檢報「這帳號讀得到 6 張表 ⇒ 不安全」,
**而那 6 張是平台授權給 `PUBLIC` 的,重建帳號一百次也一樣。**
🔴 **它的判準錯在方向**:「讀得到任何一張 = 不安全」把
**「這個角色被授權了」**與**「所有人都被授權了」**混成一件事。
⇒ 正確判準是「讀得到**不是**對 PUBLIC 開放的東西 = 不安全」。
⚠️ **而豁免 PUBLIC 那份 ≠ 它無害** —— 「PUBLIC 讀得到什麼」是**另一個獨立問題**
(`PUBLIC` 包含 `anon`),要另案查,不能用「反正是平台裝的」帶過。

📎 收斂句:**懂得怎麼關,不代表懂得怎麼確認它關上了。**

---

## 4. 現況不是洞(不要拿這份檔去修不存在的問題)

2026-08-16 E 窗全樹稽核:存活 SECDEF 函式 **80** 支,`anon` 執行得到的 **0** 支。
**正向對照**=同一支分析器跑修好前的 `d54ce716` 回 `1` 命中(`#525` 那支)
⇒ 那個 0 是量得出來的,不是量具壞掉。

🔴🔴 **範圍限定 —— 不是「可能偏低」,是【必然偏低】,而且原因已知:**
那 `80 / 0` 的分母是 `supabase/migrations` 的**文字**,而
**Supabase 對 `public` schema 掛的 `ALTER DEFAULT PRIVILEGES` 給出的授權,
在 repo 裡【沒有任何 `GRANT` 語句可以被掃到】。**
⇒ **任何 grep 型 / 讀 migration 型的盤點,對這一類授權的涵蓋率是零** ——
不是漏掉幾個,是**這條路上的東西一個都數不到**。
⇒ **「anon 執行得到 0 支」要讀成「在我們自己【寫得出 GRANT 語句】的範圍內,0 支」。**

⚠️ **引用本檔或任何 anon 物件數時,必須註明是 repo 側還是 production 側。**
(E 窗 `E-683` 查出機制本體;那個 ADP 的**表**那半給的是整套寫權限含 `TRUNCATE`,
函式那半給的是 `EXECUTE` —— 後者正是 `#525` 的來源。**本檔未自行複驗那份 ADP 設定,照引。**)

🔴 **對新建物件的實務後果**:新表 / 新函式**出生那一刻就自帶 `anon` 權限**,
而 `TRUNCATE` **不受 RLS 管**(逐字寫在
`supabase/migrations/20260605120000_audit_revoke_overgrant_brands_categories.sql:22`)
⇒ **RLS 開了也擋不住它**,且 repo 內零 `GRANT` 字面 ⇒ **grep 型守門看不到、三綠不紅。**
⇒ 新建表/函式的 migration **必須自己帶 fail-closed 斷言**,不能靠掃描。

**這不是理論上的謹慎,是已經被 production 打過臉的**(E 窗 `E-682`,2026-08-16 正式庫唯讀實測):

| | repo 側分析說 | 正式庫說 |
|---|---|---|
| `public` schema 裡 `anon` 可 SELECT 的關聯 | **9** | **11** |
| 跨所有 schema | (沒數過) | **26**(public 11 / storage 7 / cron 2 / extensions 2 / net 2 / realtime 2) |

**正式庫多出來、而 repo 掃描沒列出的四個**:
`brands` / `categories`(repo 側判定「policy 在但無授權 ⇒ 不可達」)、
`product_fitments_effective`、`customer_wallet_balance_check`(**repo 清單裡完全沒有這兩個名字**)。

🔴 **方向是【少報】** —— 而少報比多報危險:**多報會有人來查,少報聽起來像已經收斂了。**
📎 那個儲值金 view 後續查過**沒有外洩**(`security_invoker=true`、`anon` 對底表無 SELECT、底表 RLS 開、零 anon policy,
且有控制組證明探針不是恆假)—— **但那是「查完才知道」,不是「掃描時就知道」。**

⇒ **本檔任何「全樹 / 全部 / 零」的數字,分母都是 `supabase/migrations`。要真相去問正式庫。**

🔴 **這兩個數字【不可重跑】** ——分析器 `audit2.py` 在 E 窗的 scratchpad、**不在本 repo**
(`find . -name 'audit2*'` 零命中,分母=整棵樹)。
⇒ **引用「80 / 0」時要連這句一起引:它是 2026-08-16 的一次性量測,不是一條你跑得出來的數。**
要重新確認全樹現況,得先重寫分析器 —— **或直接改用 `#546` 那條路(對正式庫實查 ACL),那才是真相。**

⇒ **風險不是現在,是下一支新函式。**

⚠️ **不要把「有 fail-closed 斷言擋著」當安全網** —— 那個涵蓋率是有洞的:

```bash
grep -rl 'SECURITY DEFINER' supabase/migrations/     | wc -l   # 2026-08-16 實跑 = 113
grep -rl 'has_function_privilege' supabase/migrations/ | wc -l   # 2026-08-16 實跑 =  79
```
**113 vs 79 ⇒ 至少 34 支檔沒有那道斷言**（粗量:以檔為單位、未去重函式身分,
但落差大到足以推翻「每一支都有守門」)。⇒ **守門救得了一部分人,不是所有人。**

---

## 5. 這件事之前寫在哪、為什麼沒有用

| 載體 | 寫了什麼 | 為什麼沒接住下一個人 |
|---|---|---|
| `supabase/migrations/20260816010000_m4b_525_...sql:172` 與同檔 `:205-206`、`:208-210` | **只寫了方向甲**(`:172`「`FROM PUBLIC` 收不到具名」)+ 一條寫法備註(`:205-206`「可以合併成一行」)。**方向乙最接近的是 `:208-210`,但仍未寫「只收具名會漏掉 PUBLIC」** | **註解在一支特定 migration 裡** —— 寫新函式的人不會回去讀別支 migration |
| `docs/handoff/2026-08-16-collection-and-migration-handover.md:121` | 只寫了「`REVOKE ... FROM PUBLIC` 收不到具名授權」 | handoff 是一次性載體;**而且它只寫了一半** |

🔴 **關於那半句的精確說法（B 窗 2026-08-16 複驗,修正上游轉述）**:
handoff 全檔 `REVOKE` 只出現 **1 次**（量法 `grep -c -i REVOKE <該檔>` ⇒ `1`），
那一句是**診斷**、不是藥方 —— 它**沒有**開「改用 `FROM anon, authenticated`」這個處方。
**危險的不是它寫錯,是它寫對了一半而那一半的自然推論剛好是不完整的修法。**
⇒ 引用時不要說「handoff 開錯藥」,要說「**handoff 只講了一個方向,反方向同樣成立**」。

### 🔴 第三個載體,而且它是本檔最好的反面教材

`supabase/migrations/20260605120000_audit_revoke_overgrant_brands_categories.sql:14-22`
把**這整個機制**寫得比前兩個載體都完整 —— 逐字寫著
「Supabase 預設 grant 全開 footgun」、四個物件各持 `{INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER}` 全套寫權限、
以及 **`TRUNCATE` 不受 RLS 管**、目前只靠「PostgREST 不暴露 + 無 anon 直連 + FK」擋著。

🔴 **而它住在一支【檔名看起來只處理 brands / categories】的 migration 裡。**
下一個要建新表的人,沒有任何理由去讀那支檔。

⇒ **可複用的判別句:我現在寫下的這段,是【這支檔特有的事】還是【全域機制】?**
**是全域機制 ⇒ 它不屬於這支檔的註解,不管你在這支檔裡發現它。**
📎 這正是本檔開頭那句「同一件事已經被寫過兩次」的**第三次**,
而這一次的載體比前兩次更誤導 —— **因為它看起來已經被完整記錄了。**

---

## 6. 誠實缺口(不要當成已驗)

1. **四臂實測跑在原廠 PG 17.10,不是 Supabase。** `ALTER DEFAULT PRIVILEGES` 是**模擬**的,
   沒有讀到 Supabase 真實的預設權限設定。
2. ~~正式庫的 `anon.rolinherit` 未確認 —— 而整個「方向乙」靠它。~~
   **✅ 2026-08-16 關掉,而且是【因為前提本身寫錯】才關掉的**:方向乙**與 `rolinherit` 無關**
   (見 §2 的更正段與實測 SQL)。`rolinherit` 的真值現在對本檔的結論**不再有影響**。
   ⚠️ 但 `supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql:299`
   那句「`anon.rolinherit` 未確認」**仍然成立、也仍然值得查** —— 它影響的是**別的**判斷
   (角色成員身分那條路),不是方向乙。**兩件事不要混。**
3. ~~`NOINHERIT` 角色 `SET ROLE service_role` 那條路徑未測。~~
   **✅ 2026-08-16 已測,而且它是通的**:`has_function_privilege` 回 `f` 的同時
   `pg_has_role(...,'SET')` 回 `t`(見 §3.5 實測)。⇒ **這不是缺口,是已證實的繞路路徑**,
   已寫進 §3.5 當驗收條款。**正式庫上 `anon` 到底是不是 `service_role` 的成員,仍未查** ⇒ 併入 `#546`。
4. ~~沒有人讀過正式庫真正的 ACL~~ **⇒ 2026-08-16 起【只關掉 A 庫那一半】,不要整條關掉。**
   E 窗以唯讀帳號 `pcm_audit_ro` 實查 **A 庫**(`pcm-website-v2`)production(`E-682`):
   - ✅ `#525` 那個洞**在正式庫確認是關的** —— `admin_search_customers` 存在、`anon` EXECUTE **0**。
     **這是 production 回答的,不是 repo 推的。**
   - ✅ 六張客戶資料表對 `anon` 零外露(逐項 + 控制組,控制組會回 true ⇒ 探針不是恆假)。
   - 🔴 **而同一次實測打了 repo 側分析的臉**(見 §4 那張表):repo 說 9、正式庫說 11,方向是**少報**。
   🔴 **仍然開著的兩半,不要用上面那半去蓋掉:**
   - **報價單庫**完全沒查(唯讀帳號還沒建)⇒ 該庫的所有權限結論**仍只證到 repo 文字**。
   - A 庫也只查了**被問到的那些維度**;沒問到的(例如平台擴充的完整 ACL)仍未知。
   ⇒ backlog **`#546`** 相應縮小範圍、**不關閉**（`docs/phase-1-backlog.md`）。
5. **§4 的「80 支 / 0 支」不可重跑**(分析器不在 repo,見 §4 該段)。
