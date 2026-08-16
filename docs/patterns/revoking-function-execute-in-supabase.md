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

## 4. 現況不是洞(不要拿這份檔去修不存在的問題)

2026-08-16 E 窗全樹稽核:存活 SECDEF 函式 **80** 支,`anon` 執行得到的 **0** 支。
**正向對照**=同一支分析器跑修好前的 `d54ce716` 回 `1` 命中(`#525` 那支)
⇒ 那個 0 是量得出來的,不是量具壞掉。

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
4. **沒有人讀過正式庫真正的 ACL** —— 全樹稽核讀的是 migration **文字**。
   `#525` 正好證明正式庫可能有 repo 預測不到的狀態。要關需要連線字串。
   ⇒ backlog **`#546`**（`docs/phase-1-backlog.md`）。
5. **§4 的「80 支 / 0 支」不可重跑**(分析器不在 repo,見 §4 該段)。
