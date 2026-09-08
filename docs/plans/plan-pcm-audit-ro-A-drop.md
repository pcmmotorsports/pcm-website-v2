# Plan ① · **刪掉** `pcm_audit_ro`

> 線【帳號】`account` 2026-09-08 · **plan 而已, 沒有動任何碼、沒有碰資料庫**
> 🔬 座標:`dev = 0a530379f` · 分支 `agent/line-account-cardcancel`
> 🔴 **鐵則 12 命中:權限 / 角色 / 不可逆 ⇒ codex 對抗審查不降級, 且必須 Sean 拍板。**
> 📎 對照方案:`docs/plans/plan-pcm-audit-ro-B-adopt.md`(補一支 migration 進版控)

---

## 1. 現況(每一格標**我量的** vs **別人交來的**)

### 🔬 我量的(版控, 當場跑, 帶正負對照)

```
pcm_audit_ro  在 supabase/ 底下 ⇒ 命中 1 支檔
  🔴 而那一次是【註解】不是 DDL:
     supabase/migrations/20260817060000_e683_1_public_default_privileges_revoke.sql:10
     -- 現況(E 窗 2026-08-17 以 `pcm_audit_ro` 唯讀實測
  ⇒ 📌 版控裡【零 DDL】—— 沒有任何一支 migration 建它、給它權限、或收它權限。

pcm_readonly  在 supabase/ 底下 ⇒ 33 支檔, 而其中有【真的 DDL】:
     supabase/migrations/20260902210000_m4b_pfeddl2_staging_and_sync_log.sql:306
     CREATE ROLE pcm_readonly NOLOGIN;
     (前面帶一個 DO 區塊:已存在就先驗 rolsuper / rolbypassrls, 是才 RAISE EXCEPTION)

🟢 正對照  同一把尺找 payment_confirmer  ⇒ supabase/ 99 支檔 · CREATE ROLE 1 處
⚪ 負對照  zzq_no_such_role_20260908      ⇒ 0
```

### 📨 別人交來的(**我沒有複量, 因為我沒有 DB 連線**)

```
線 tidy · ~/pcm-mailbox/handoff-tidy-20260908.md:183-185
  pcm_audit_ro ⇒ permission denied for schema cron
  pcm_readonly ⇒ 讀得到(2026-09-07 18:23:02 UTC, rc=0):9 支 job, active 全 t
                 🟢 正對照 orders 有列 ⇒ t   ⚪ 負對照 現造 jobname ⇒ 0 列
```

### 🔵 2026-09-08 補:**正式庫這一側已經有人量了**(`-db` 交來, 🛑 我沒有複量)

> **來源屬性**:`-db`(`pcm-website-v2-20`)在被喊停前跑的唯讀查詢, 主動寄給我。
> 🔴 **我沒有 DB 連線 ⇒ 下面每一格都是【別人交來的】, 不是我量到的。**
> 而它**帶了正負對照**, 所以我照 §6 收下, 而不是當成待驗。

```
pcm_audit_ro 存在:
  rolcanlogin  = t     🔴 它【登得進來】
  rolbypassrls = f
  rolsuper     = f
  rolinherit   = f     ⇒ 它不自動繼承所屬角色的權限
  rolvaliduntil = 空 · rolconnlimit = -1

成員關係:🔴 **postgres 是 pcm_audit_ro 的成員**(方向是這樣, 不是反過來)

schema USAGE 逐個問:
  public = t   🔵 net = t   cron = f   auth = f
  storage = f  extensions = f   pcm_cron = f   vault = f

🔴 public 底下 92 張表/view/matview ⇒ 它 SELECT 得到 **0** 張
⚪ 正對照 同一句對 pcm_readonly 跑 ⇒ **69** ⇒ 兩者印【不同的數】
   ⇒ 📌 那個 0 不是尺壞了
⚪ 負對照 現造角色名 ⇒ 0 列
```

#### 這批讀數改變了本 plan 的三件事

| # | 原本 | 改成 |
|---|---|---|
| ① | §3-B「**若** 它能登入 ⇒ 先 NOLOGIN 觀察」是一個分支 | 🔴 **那個分支成立了**(`rolcanlogin = t`)⇒ **不是選項, 是必經步驟** |
| ② | 「今天什麼都讀不到」是 tidy 一句對 `cron` 的觀察 | ✅ **升級成量到的**:public 92 張 ⇒ **0 張**, 而正對照 69 證明尺會分辨 |
| ③ | 「它有哪些權限」未知 ⇒ rollback 依據缺 | 🔵 **大半有了**;而**仍缺** owner 那一問(`pg_class.relowner`)—— `DROP ROLE` 會被它擋住 |

#### 🔴 而這批讀數翻出一格**兩案都要回答**的新東西

```
🔵 net = t —— 那是唯一一個【非 public】的 schema, 而它有 USAGE。
```
- `net` = `pg_net`(發 HTTP 的那個擴充)。
- ⚠️ **而 schema 的 `USAGE` ≠ 對裡面的函式有 `EXECUTE`** —— 我**沒有**量它對 `net.http_post` /
  `net.http_get` 有沒有 EXECUTE, 也沒有量它讀不讀得到 `net._http_response`。
  🛑 **所以這一格現在只能寫成「它站在那扇門前面」, 不能寫成「它推得開」。**
### ⛔ 2026-09-08 **本格已被推翻** —— `net = t` 是 **PUBLIC** 給的, 不是給這個帳號的

> 🔴 **推翻者 `-tidy`(`pcm-website-v2-20`), 它推翻的是它自己交給我的那一句。**
> 它讀了 `net` 的 `nspacl` 原文:
> ```
> {supabase_admin=UC/supabase_admin, =U/supabase_admin, supabase_functions_admin=U/…,
>  postgres=U/…, anon=U/…, authenticated=U/…, service_role=U/…}
> ```
> 🎯 第二條 `=U/supabase_admin` —— **grantee 欄是空的 = `PUBLIC`**。
> ⇒ 📌 **`pcm_audit_ro` 在那一串裡一個字都沒有。** 它的 `net USAGE` 是 PUBLIC 給的, 每個角色都有。
> 橫向:`pcm_audit_ro` / `anon` / `authenticated` / `pcm_readonly` / `service_role` **五個都是 t**。
> ⚪ 正對照 `vault` ⇒ 兩個都 `f`(尺印得出 f, 不是恆真)
> ⚪ 負對照 現造 schema 名 ⇒ **raise**(不是 false)⇒ 打錯字與真的沒權限**分得開**

⇒ 🛑 **所以「刪掉它, 下次重跑那份稽核就沒有那個視角」這個成本【不成立】** ——
   那個視角是 PUBLIC 的, **任何角色都站得到**。
⇒ 🔵 而 spec `:36` 那句逐字**仍然成立** —— 只是那次跑得動靠的**不是它被特別授權, 是 PUBLIC**
   ⇒ 那份稽核**換任何角色都跑得出同一個結果**。

### 🔴 而這一格錯在哪 —— 它是本 plan 自己在講的那一族

```
讀數:has_schema_privilege('pcm_audit_ro', 'net', 'USAGE') ⇒ t
兩個世界:甲 那是【專門授給這個帳號】的  ·  乙 那是【PUBLIC 順便】的
🔴 而 has_*_privilege 對這兩個世界【印同一個 t】。
```
📌 **⇒ 這次印同一個東西的不是 `0`, 是 `t`** —— 我今天一整天在掃「兩個世界印同一個 0」,
   而**同一族換一個值就從我眼皮底下過去了**。
🛑 **⇒ 要答「誰給的」只能讀 ACL 原文**(`aclexplode(n.nspacl)`, grantee = 0 就是 PUBLIC)。
   ⇒ 已補進 `scripts/pcm-audit-ro-snapshot.sql` §③-b。

### 🔵 而真正該留在檔上的, 是隔壁那一格

```
cron 的 nspacl:{supabase_admin=UC/…, postgres=U*/…, pcm_readonly=U/postgres}
🎯 pcm_readonly=U/postgres —— 那是 postgres 【明確授】的, 不是 PUBLIC。
```
⇒ 📌 而 `pcm_readonly` 本身也是**版控之外**建的
   ⇒ 🔴 **同一族的第二個實例:一個版控外的角色 + 一道版控外的 GRANT。**
⇒ 那與 `pcm_audit_ro` 的 `net` 是**不同的形狀**:那個是 PUBLIC 順便, 這個是專門給的。

### ⛔ 以下為**已被推翻的舊字面**, 留著(零刪除)—— 不要拿它當依據

⛔ ~~🔴🔴 **而那句安全 spec 的逐字, 把這一格的意思整個翻過來了:**~~
  `docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md:36` 逐字:
  > **實測輸出(2026-08-17, `pcm_audit_ro`)**:4 列, `sel/ins/upd/del/trunc` **全部 `t`**。
  ⇒ 🎯 **那次 `net` 曝露稽核, 就是用 `pcm_audit_ro` 自己跑的。**
  ⇒ 📌 **所以 `net = t` 很可能【不是殘留, 是刻意給的】** —— 它是那個帳號的**任務**。
  ⛔ ~~那就變成刪掉那一案的一個真成本:刪了它, 下一次要重跑那份 net 曝露稽核就沒有那個視角了。~~
  🔴 **⇒ 而我那句「我沒有量現在還有沒有別的角色站得到同一個位置」, 正好標中了它自己的缺口** ——
     我寫下了缺哪一道檢查, **而我沒有去做那道檢查就往下推了一個成本。**
     📌 **標「未確認」不會讓一個可執行的結論變安全。**
- ⇒ 若走**刪掉** ⇒ 那格順帶消失。
  若走**補版控** ⇒ 🛑 **必須明寫那格是不是故意的**, 不能默默抄進去。

## 2. 這個方案主張什麼

**`pcm_audit_ro` 是一把被取代掉的舊鑰匙:**
- 它在**版控之外**被建出來(2026-08-17 那一輪安全稽核)
- 它**今天讀不到**要讀的東西(`schema cron` 被拒)
- 而**接替它的 `pcm_readonly` 在版控裡、而且讀得到**

⇒ 📌 **一把還在的舊鑰匙, 而沒有人記得它開得了哪幾扇門** —— 那正是本方案要消掉的東西。

## 3. 怎麼做

| 步 | 動作 |
|---|---|
| A | **先量它現在有什麼**(見 §5 那段唯讀 SQL)—— 🛑 **沒量到之前不准 DROP** |
| B | 若 A 顯示它**能登入**(`rolcanlogin = t`)⇒ 先 `ALTER ROLE pcm_audit_ro NOLOGIN`,**觀察一段時間**再 DROP |
| C | 寫一支 migration:`REVOKE` 掉 A 量到的每一格, 再 `DROP ROLE pcm_audit_ro` |
| D | 該支進 `supabase/APPLIED.tsv`, 走 Sean 貼板流程 |

🔴 **為什麼 B 那一步不能省**:`DROP ROLE` 對「還有東西在用它」會直接失敗(它是 owner 或有 grant 的話),
但**對「有排程/腳本拿它連線」不會失敗** —— 那些東西會在**下一次執行時**才壞,
而那時候沒有人會把它連到今天這個動作上。

## 4. 影響面 / rollback

- **🔴 `DROP ROLE` 不可逆。** rollback = 重建一個同名角色, 而**它的權限要靠 §5 那份快照才補得回來**
  ⇒ 📌 **那份快照不是「順手做的紀錄」, 它是這個方案唯一的 rollback 依據。**
- 不動 schema、不動任何表、不動應用程式碼。

---

## 5. 🔴 本 plan 【證不到】什麼

### ① **`pcm_audit_ro` 現在到底有什麼, 我證不到**

我沒有 DB 連線。**下面這段是給有唯讀連線的人跑的(唯讀, 一個字都不改)**:

```sql
-- 它是什麼
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolvaliduntil
  FROM pg_catalog.pg_roles WHERE rolname IN ('pcm_audit_ro','pcm_readonly');
-- 🟢 正對照:同一發要看得到 payment_confirmer 才算尺有動
--    (把上面的 IN 換成含 'payment_confirmer' 再跑一次)

-- 它是誰的成員 / 誰是它的成員
SELECT r.rolname AS role, m.rolname AS member
  FROM pg_auth_members am
  JOIN pg_roles r ON r.oid = am.roleid
  JOIN pg_roles m ON m.oid = am.member
 WHERE r.rolname = 'pcm_audit_ro' OR m.rolname = 'pcm_audit_ro';

-- 它握著哪些表權限
SELECT table_schema, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'pcm_audit_ro' ORDER BY 1,2,3;
-- ⚠️ information_schema 是【權限過濾】的 ⇒ 跑的人權限不夠會少報
--    (逐字出處:docs/security/2026-08-17-sweeper-health-endpoint-spec.md:95)

-- 它是不是任何東西的 owner(DROP 會被它擋住)
SELECT n.nspname, c.relname, c.relkind FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname='pcm_audit_ro');
```

### ② **「今天什麼都讀不到」不是我量的**

那是 `tidy` 交來的一句(`permission denied for schema cron`)。
🔴 **而它只證明「讀不到 `cron` 這個 schema」, 證明不了「什麼都讀不到」** ——
那兩句話在報告上長得很像, 而它們的分母差很多。
⇒ 📌 **本方案的第一步(§3-A)正是把那個分母補起來, 不要拿一句話當結論。**

### 🔵 2026-09-08 二補:`DROP ROLE` 這一側**乾淨**, 而缺口關掉了一個

> **來源屬性**:`-tidy`(`pcm-website-v2-20`)第二批唯讀讀數。🛑 我沒有複量。

```
relowner 六格(relation / schema / function / type / default acl / relacl)  ⇒ 全 0
nspacl 裡出現                                                              ⇒ 0 列
pg_shdepend                                                                ⇒ 0 列
🟢 正對照 postgres 在 pg_shdepend ⇒ 517 列 · 擁有 relation ⇒ 460
⚪ 負對照 現造角色名              ⇒ 0
🔵 對照組 pcm_readonly 在 pg_shdepend ⇒ **82 列**
```

🎯 **那 82 是這一批最好的一格** —— 同樣是版控之外建的兩個角色:
`pcm_readonly` **82** 列依賴(它被 GRANT 了 `cron` USAGE、69 張表…), `pcm_audit_ro` **0**。
⇒ 📌 **所以那個 0 不是「這張表對誰都印 0」, 是這個角色真的什麼都沒被掛上。**
⇒ 🔑 **它是一把【沒有插進任何鎖】的鑰匙。**

#### ✅ 關掉的缺口:~~「別的 database 沒查」~~

⛔ ~~我原本寫「它在別的 database 裡有沒有東西, 未查」~~
🔵 **`pg_shdepend` 是【共用目錄】(shared catalog), 不是每個 db 一份**
⇒ 一發 `WHERE refobjid = …` **一次就掃過所有 database**。
叢集裡的 db:`postgres`(可連)· `template0`(`datallowconn = f`, 本來就連不進去)· `template1`(可連)。
⇒ 📌 **不是「又跑了一遍」, 是【那張表的性質讓一發就夠】。**

#### 🔴 而這批讓丙(先關登入)更硬, 不是更弱

`DROP ROLE` 的每一條技術阻擋都量過了、都是 0 ⇒
🛑 **擋著它的只剩【還有誰拿它連線】, 而那件事沒有任何一份 catalog 讀數答得出來。**
⇒ 📌 **關登入是唯一會讓它出聲的動作。**

### ③ **我不知道還有誰在用它**

- 憑證住在哪:`~/pcm-mailbox/E-675-帳號體檢與重建.md` 等 E 系列檔提到過, **我沒有開**(那些檔可能含連線資訊)。
- 有沒有外部工具 / 排程 / 別人的機器拿它連線 ⇒ **從 repo 看不出來**,
  🔴 **而 2026-09-08 那三批 catalog 讀數也答不出來**(它們答的是「誰掛在它身上」,
  不是「誰拿它撥號」)⇒ 📌 **那兩件事沒有任何一張目錄表分得開。**
- ⇒ 🛑 **這一格是本方案唯一還站著的風險, 而它擋在 §3-B 前面。**

### ④ 我沒有量的
- `pcm_readonly` 是 `NOLOGIN` ⇒ 那 `tidy` 是**怎麼用它連上的**, 我不知道(某個 login 角色是它的成員?)。
  這格不影響本 plan 的結論, 但**它說明「哪一把鑰匙能用」這件事本身沒有寫在版控裡**。

---

## 6. 驗收條件(每條可 yes/no)

- [ ] §5-① 那份快照**已經跑過, 而且結果存進檔案**(不是貼在對話裡)
- [ ] 快照顯示它**不是任何東西的 owner**(否則 DROP 會失敗, 要先轉移)
- [ ] 若 `rolcanlogin = t` ⇒ **先 NOLOGIN 觀察過**, 而觀察期是寫下來的不是感覺的
- [ ] migration 走 `is-migration-applied.sh` 產的正負對照 SQL 驗過
- [ ] codex 對抗審查跑過(鐵則 12 權限 + 不可逆, **不降級**)
- [ ] 🔴 **Sean 拍板**(不可逆 + 角色憑證, 命中 R3 兩格)
