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

### ③ **我不知道還有誰在用它**

- 憑證住在哪:`~/pcm-mailbox/E-675-帳號體檢與重建.md` 等 E 系列檔提到過, **我沒有開**(那些檔可能含連線資訊)。
- 有沒有外部工具 / 排程 / 別人的機器拿它連線 ⇒ **從 repo 看不出來**。
- ⇒ 🛑 **這一格是本方案最大的風險, 而它擋在 §3-B 前面。**

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
