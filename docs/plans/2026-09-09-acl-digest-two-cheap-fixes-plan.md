# plan · ⟦b9-ACLDRIFT5⟧ 補便宜的兩個 —— 同日重錄清批准 · REL 族加 `pcm_readonly`

> 線【權限/信件】窗 C · 2026-09-09 · **窗 C 沒有寫 migration 檔、沒 apply、沒 push。本檔只是 plan,等 Sean 批,SQL 由主視窗代貼。**
> **授權鏈逐字**:Sean 2026-09-09 對「偵測器要不要補」拍 **乙**,原話「**只補便宜的兩個**」(主視窗 2026-09-09 轉)。
> 基底 = **2026-09-09 11:5x UTC 從正式庫唯讀取出的 `pg_get_functiondef`**,原樣存在 `docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql`。

---

## 0. 為什麼基底一定要從線上取

🔴 **兩支都是 `SECURITY DEFINER` 且帶 `SET search_path TO ''`**(線上實測 `proconfig = {"search_path=\"\""}`)。
🛑 而 **`CREATE OR REPLACE` 會把 `SET` 子句整組換掉** —— 少寫那一行,`search_path` 的強化就被打回去,而**函式本體 md5 一模一樣、每一道尺照樣綠**。
⇒ 📌 **所以基底取線上的、而且改完的 SQL 必須逐字帶回 `SET search_path TO ''`。**
⇒ 🛑 **不要拿 `supabase/migrations/20260905140000_…` 那份當基底** —— 那是「當初貼的那一版」,不是「線上現在跑的那一版」。

---

## 1. 改什麼(逐行,對照線上現行定義)

### 改動 A · `public.pcm_acl_digest_record()` —— 同日重錄要清掉舊的批准
**線上現行**(`LIVE-pcm_acl_digest_record` 第 40-46 行,逐字):
```sql
  INSERT INTO public.pcm_acl_snapshot_digest AS t (digest, row_count, families)
  SELECT d.digest, d.row_count, d.families FROM public.pcm_acl_digest() d
  ON CONFLICT (((taken_at AT TIME ZONE 'UTC')::date)) DO UPDATE
     SET digest = EXCLUDED.digest,
         row_count = EXCLUDED.row_count,
         families = EXCLUDED.families,
         taken_at = now();
```
**改成**(只加兩行,其餘一字不動):
```sql
  ON CONFLICT (((taken_at AT TIME ZONE 'UTC')::date)) DO UPDATE
     SET digest = EXCLUDED.digest,
         row_count = EXCLUDED.row_count,
         families = EXCLUDED.families,
         taken_at = now(),
         -- 🔴 內容換掉了, 舊的那個章就不再對應這一列(⟦b9-ACLDRIFT5⟧, Sean 2026-09-09 拍乙)
         approved_at   = NULL,
         approved_note = NULL;
```
**它修的是**:今天「批准了 A → 權限被改成 B → 同一個 UTC 日再跑一次」⇒ **B 帶著 A 的章**,而 `最新這列已被批准 = t` ⇒ **不告警**。

### 改動 B · `public.pcm_acl_digest()` 的 **REL 族** —— 加 `pcm_readonly`
**線上現行**(`LIVE-pcm_acl_digest` 第 26 行,逐字):
```sql
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
     WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
```
**改成**(**只改這一處**,`:26`):
```sql
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer'),
                         ('pcm_readonly')) AS g(rol)
     WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
```
🛑 **同一支檔裡還有兩處一模一樣的 `CROSS JOIN (VALUES …)`** —— `:34`(**FN** 族)與 `:66`(**STORAGEACL** 族)。
⇒ 🔴 **這兩處【不改】**(Sean 只拍了 REL)⇒ **貼的人要確認改到的是 `WHERE n.nspname = 'public' AND c.relkind IN (...)` 那一段的上一行**,不是另外兩處。

🔴🔴 **而改動 B 有一個【貼前必須先問的閘】**(codex R1 must-fix,我核過 PostgreSQL 語意):
**`has_table_privilege('<不存在的角色>', …)` 會【拋錯】,不是回 `false`。**
⇒ 📌 **若 `pcm_readonly` 不在,整支 `pcm_acl_digest()` 與 `pcm_acl_digest_record()` 會失敗 ⇒ 快照停止更新** ——
⇒ 🛑 **而保留中的舊快照【不會立即顯示這次失敗】** ⇒ 那正是本專案一再撞到的形狀:壞掉與沒事印同一個畫面。
**⇒ 貼板前置閘(不成立就停,不要繼續)**:
```sql
SELECT pg_catalog.to_regrole('pcm_readonly') IS NOT NULL AS role_exists;
-- 期望 t;回 f ⇒ 🛑 停,不要貼
```
⚠️ **拋棄式庫驗證時也要明確把這個角色建出來** —— 否則「缺角色」會被誤讀成「jsonb 組法壞了」。

**它修的是**:`pcm_readonly` 今天**不在偵測射程裡** ⇒ 一個 `GRANT … TO pcm_readonly` 的手動改動,**即使永久留著也不會叫**。
🎯 **而那不是假設** —— 2026-09-08 真的發生過:`GRANT SELECT ON public.pcm_acl_drift_status TO pcm_readonly` 與 `… pcm_acl_snapshot_digest …`(`supabase/migrations/20260908110000_m4b_aclro1_grant_readonly_acl_tables.sql:141-142`)**就在這支的盲區裡**。

---

## 2. 影響(有一格是必然的,要先講)

### 🔴 改動 B 會讓 REL 族 +96 —— **而「隔天必然有漂移」要帶時序前提**

```
今天  REL 族 = 384 列 = 96 個 relation × 4 個角色
當場量 public 的 r/v/m/p 個數 ⇒ 96      (384 ÷ 4 = 96 ✅ 兩個數對得上)
貼完後 REL 族 = 96 × 5 = 480 列  ⇒  +96
```
✅ **`+96` 這個算法 codex 複核過**:那段的 `WHERE` 只有 `public` 與 `relkind IN ('r','v','m','p')`,**沒有按「有沒有權限」過濾** ⇒ 96 個 relation 各多一列,**沒有 SELECT 的那 24 個也照算**。

🛑 **而「隔天必然有漂移」我上一稿寫漏了前提**(codex R1 must-fix):
- **只替換函式、不重錄** ⇒ 下一次 00:00 那發用**新版**取樣、比的是**舊版**那張 ⇒ ✅ **`有漂移 = t`,這是預期的。**
- **貼完立刻手動 `record()` 一次** ⇒ 今天那列就已經是新版 ⇒ 明天再記一次相同的新版 ⇒ 🔴 **`有漂移 = f`** ⇒ **那個「預期中的一次性變動」會【看不到】。**
⇒ 📌 **兩條路的差別不是理論** —— 貼的人選哪一條,決定了那 +96 會不會留下痕跡。

🔴🔴 **而我上一稿寫「貼完要順手蓋一次基線章」—— 那句刪了,它是危險的**(codex R1 must-fix,理由我核過):
- **替換函式本身【不會產生新快照】** ⇒ 貼完立刻 `approve` ⇒ 📌 **蓋到的是【今天原本那張未批准的舊列】**,而那張有 `FN,FNCFG,POL,REL,VIEWOPT` **五族**的差異(見 `docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md`)。
- **而 Sean 2026-09-09 已經拍【不蓋章】** —— 我上一稿等於在同一份文件裡自打嘴巴。
⇒ ✅ **正確做法:不蓋章。那 +96 留在紀錄裡,由下一個看的人用本 plan 解釋它。**

### 改動 A 的影響
- **對今天在跑的路零行為改變**:只有在「同一個 UTC 日重錄」時才走到那兩行。
- ⚠️ **而它會讓一個既有的操作習慣失效**:今天若有人早上蓋章、下午補跑一次,**那個章會被清掉**。⇒ 📌 **那正是它要的效果**(章對應的是內容,不是日期),但**補跑的人要知道**。

### 兩者共同
- 🛑 **`SECURITY DEFINER` 不變、`search_path TO ''` 不變、owner 不變、`provolatile = v` 不變。**
- 不新增任何 DB 物件;不動表結構;不動 cron;不動權限。

---

## 3. 反向 SQL —— **可執行,而它原本是壞的**

完整兩段逐字存在:
```
docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql   (213 行)
```
它是 `pg_get_functiondef` 的原始輸出,開頭就是 `CREATE OR REPLACE FUNCTION …` 且含 `SET search_path TO ''`。

🔴🔴 **而我上一稿寫「直接貼進 SQL Editor 跑就退回去了」—— 那是錯的,而錯法很機械**(codex R1 must-fix,我開檔核過):
`pg_get_functiondef` 的輸出**結尾沒有分號** ⇒ `:126` 的 `$function$` 後面直接接第二個 `CREATE OR REPLACE` ⇒ **語法錯誤**。
(`FROM lines;` 那個分號在 dollar-quoted 字串裡,結束不了外層;換行也不是 statement 分隔。)
✅ **已修**:兩處收尾都補成 `$function$;`(`:126` 與 `:201`),並在檔頭寫明**那兩個分號是我補的、不是原始輸出**。

**跑法**:
```sql
BEGIN;
--  … 貼入 docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql 的兩段 …
COMMIT;
```
🛑 **兩支要一起退,不要拆兩次提交** —— 只退一支會退成一個沒人驗過的組合。

🛑 **而補完分號之後,我【沒有實跑驗過語法】** —— 對正式庫跑就是寫入,不做。
⇒ ✅ **貼之前請先在拋棄式 PG 跑一次(`BEGIN … ROLLBACK`),確認兩段都建得起來。**

### 🛑 這份 rollback 的邊界(上一稿沒寫)
它**只還原函式定義**。它**不會**:
- 把同日重錄覆蓋掉的那張快照還原回來
- 把改動 A 清掉的 `approved_at` / `approved_note` 補回來
⇒ 📌 **那兩樣一旦動了就沒有退路,這是本改動的真實邊界。**

## 4. 🛑 本片不涵蓋(逐條,連後果一起寫)

1. 🔴 **第三個洞:未批准的漂移訊號【第三天會自己消失】—— Sean 沒選補,所以不做。**
   機制:`20260905170000_…:69` 那支 view 只取 `rn = 1` 與 `rn = 2` ⇒ 三天 `A → B → B`,第三天 `有漂移 = f`,**即使 B 從未批准**。
   ⇒ 📌 **後果照舊**:一筆沒人看的漂移,兩天後就沒有任何地方會提到它。
   ⇒ 🎯 **而那不是假設** —— `RECORD 2`(**2026-09-06**)就是這樣過去的,`approved_at` 空白,而它的訊號 9/8 就消失了。
   ⇒ ✅ **今天唯一的緩解是那份保全抄本**:`docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md`(它把 9/9 那筆抄下來了,而 9/6 那筆也記在裡面)。
2. **`FN` 族與 `STORAGEACL` 族一樣只有那四個角色** —— 同一支檔的 `:34` 與 `:66`。**本片不改**(Sean 只拍 REL)⇒ 那兩族對 `pcm_readonly` 的改動一樣不會叫。
3. **欄級授權(`attacl`)仍不在射程** —— `REL` 族走的是 `has_table_privilege`(表級)。加角色補不了這一層。
4. **蓋章函式綁不住受審快照** —— `pcm_acl_approve_latest` 只吃 `p_note`、取 `max(taken_at)`。Sean 2026-09-09 已拍**不蓋章**,而**那支函式的毛病本片沒修**。

---

## 5. 🛑 已識別而【不修】—— 部署時序閘的兩格

(主視窗 2026-09-09 要求寫進來,理由是 **Sean 09-09 拍的減法逐字含「不加閘」**;而 CLAUDE.md 的判別句是「這件做完,客人的體驗或 Sean 的操作會不一樣嗎?不會 ⇒ 不做」。)

1. 🔴 **欄級 GRANT 被偵測到了,而它只警告不擋。**
   ```
   scripts/deploy-order-gate.sh:1069  # 🟡 進 `COL_WARN` 不進 `BLOCKED` —— 這一族只警告不擋
   scripts/deploy-order-gate.sh:1097  [ -z "$BLOCKED" ] && { summary 0; exit 0; }
   ```
   ⇒ **一支帶欄級 GRANT 的 pending migration,被抽到了、比中了 app 碼,照樣放行。**
   🛑 **把警告升成擋 = 加閘 ⇒ 不做。**
2. 🔴 **而 `0 blocked` 這個輸出,承載不了「已檢查」這個意思** —— 它有四個成因:
   ```
   ① 整表級 GRANT 進不了比對面
   ①' 欄級 GRANT 進得了, 而只警告不擋
   ②  餵反 stdin
   ③  apps/packages 差異為空 ⇒ 整段跳過(scripts/deploy-order-gate.sh:810)
   ```
   ⇒ 📌 **修好其中一條,那句話仍然印得出來。**
⇒ ✅ **這兩格的產出就是這一段文字** —— 它讓下一個看到 `0 blocked` 的人不會把它讀成「檢查過而乾淨」。

---

## 6. 🛑 我證不到什麼

1. **我沒有跑過改後的版本,也沒有跑過 rollback。** 兩處改法與那兩個補上的分號,都是**讀出來寫的**,沒有在拋棄式 PG 跑過。⇒ §7 把該跑的三個世界寫出來了。
   🔵 **而 `families` 的 jsonb 組法 codex 幫我核了**:`:117` 是按**八個族名**組裝,新增角色**不會**造成重複 key 或純量子查詢回多列 ⇒ 那一格不是風險。
2. **`+96` 是算出來的,不是跑出來的** —— `96 relations × 1 個新角色`。**若 `pcm_acl_digest()` 的 REL 族有我沒看到的過濾**(例如跳過某些 relkind),實際會少於 96。
3. **`pcm_readonly` 沒有 `pcm_acl_digest()` 的 `EXECUTE`** ⇒ §3 那條事後斷言**我跑不了**,要貼的人跑。
5. **`CREATE OR REPLACE` 換掉 `SET` 子句**這個坑,我是**照 memory 與線上 `proconfig` 讀數寫的,沒有實測重現**。
6. 🔴 **改動 A 有一個【我接受但要寫出來】的副作用**(codex 指出):**即使 `digest` 完全沒變**,同日重錄照樣清章 ⇒ 一個**已經被批准過的差異**可能重新觸發告警。⇒ 📌 這是「章對應內容而不是日期」的代價,**不是 bug**,而值班的人要知道。(`approved_note` 那一欄那支 adapter 沒有在讀。)
7. **總 `digest` 的算法我一開始沒寫清楚** —— codex 核出來是「**所有族的原始摘要列排序串接後做【一次】md5**」,不是各族 md5 再合;`row_count = count(*)` = 各族 `n` 加總。⇒ 這與我在保全抄本裡驗過的「八族 n 加總 = row_count」一致。
8. **我只讀了要改的那兩段**,沒有逐行讀完 3,185 + 7,159 字元的全文 —— 改動之外的部分,我不宣稱理解。
6. 讀數是 2026-09-09 11:4x–11:5x UTC 那幾發的。

---

## 7. 貼板程序(codex R1 must-fix ⑤:上一稿的事後斷言擋不住「只退一支」)

🛑 **上一稿的斷言只查 security 設定與 REL 列數 ⇒ 「只退 B、A 完全沒退」時那些查詢【仍然全部符合期望】。** 而 `SELECT` 加註解**不會在不符時自動中止交易**。以下是補齊後的最小程序。

### 貼前(不成立就停)
```sql
-- ① 角色在不在(§1 那個閘)
SELECT pg_catalog.to_regrole('pcm_readonly') IS NOT NULL AS role_exists;   -- 期望 t

-- ② 兩支的現行定義仍與受審基底相符(別窗改過就停,免得舊基底蓋掉新修正)
SELECT p.oid::regprocedure::text AS sig, pg_get_userbyid(p.proowner) AS owner,
       p.proacl::text, p.proconfig::text, p.prosecdef, p.provolatile,
       pg_catalog.md5(pg_get_functiondef(p.oid)) AS def_md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('pcm_acl_digest','pcm_acl_digest_record');
-- 🔴 把 def_md5 與貼板當下重新從 baseline 檔算的 md5 比 —— 不同 ⇒ 停
```
🛑 **避開排程正在跑的時候** —— `pcm-acl-digest` 是 `0 0 * * *`(呼叫點 `20260905140000:314`),而 `record()` 內部會呼叫 `digest()` 兩次並寫心跳。**已經開始的那一次呼叫不能拿來當新版的驗證。**

### 貼(正向與反向各自**同一交易**,不拆兩次提交)
```sql
BEGIN;
--  改動 A + 改動 B 兩段 CREATE OR REPLACE
COMMIT;
```

### 貼後(問狀態,不問 `rc`)
```sql
-- ③ 改動 A 真的進去了(而不是只進了 B)
SELECT (pg_get_functiondef(p.oid) ILIKE '%approved_at   = NULL%') AS a_landed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='pcm_acl_digest_record';   -- 期望 t

-- ④ 改動 B 真的進去了
SELECT (pg_get_functiondef(p.oid) ILIKE '%pcm_readonly%') AS b_landed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='pcm_acl_digest';          -- 期望 t

-- ⑤ SET 子句沒被吃掉(這是 CREATE OR REPLACE 最會出事的一格)
SELECT proname, proconfig::text, prosecdef FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN ('pcm_acl_digest','pcm_acl_digest_record');
-- 期望:兩列, proconfig 皆 {"search_path=\"\""}, prosecdef 皆 t

-- ⑥ REL 族真的變成五個角色份
SELECT (public.pcm_acl_digest()).families -> 'REL' ->> 'n' AS rel_n;
-- 期望 = 當場的 public relation 數 × 5(今天是 96 × 5 = 480)
-- ⚠️ 這一發需要 EXECUTE 權(pcm_readonly 沒有)
```

### 🔴 拋棄式庫要先跑的三個世界
1. **正向** ⇒ 八族齊全 · `REL` = 當場 relation 數 **× 5** · **其餘七族一格不變** · 總列數增加當場 relation 數
2. **同日衝突分支** ⇒ 先寫一列並蓋章,再重錄一次 ⇒ **`approved_at` / `approved_note` 兩欄都清空,而一天仍只有一列**
3. **rollback** ⇒ 跑完 baseline 那兩段 ⇒ **兩支的完整定義都與基底逐字相符**

### ⚠️ 一個【不能拿來當證據】的綠燈
`scripts/acl-digest-parity.sh` 過了**不算驗到本次改動** —— 它抽的是**舊 migration 的本體**,不呼叫線上新版;而對照那支快照腳本**也還是四個角色**。
⇒ 📌 **兩個舊演算法可以一起通過,而完全沒驗到改動 B。**(codex R1 指出,`scripts/acl-digest-parity.sh:61`)
🛑 **本片不擴修那兩支腳本**(Sean 09-09 拍的減法含「不加閘、不加腳本」)—— 只把這個「不能當證據」寫下來。

---

## 8. 接下來
- **等 Sean 批這份 plan。** 批了之後 **SQL 由主視窗代貼**(窗 C 不 apply)。
- 貼的人請帶走四件:①先過 §7 的貼前兩個閘 ②基底用 `docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql`,不用 migration 檔 ③`SET search_path TO ''` 逐字帶回 ④**不要蓋章**(Sean 09-09 已拍)。

---

## 9. codex R1 —— 4 個 must-fix,逐條怎麼修

| codex 意見 | 怎麼修 |
|---|---|
| ①**無問題** · 改動 A 的語法與名稱解析正確(`search_path=''` 仍隱含搜尋 `pg_catalog`;`SET` 左側欄名不靠 search_path 查找,**不可以為求完全限定改成 `SET t.approved_at`**) | 照原樣保留;把它指出的副作用(digest 沒變也照樣清章)寫進 §6 第 6 條 |
| ②**must-fix** · `has_table_privilege('不存在的角色', …)` **會拋錯不是回 false** | §1 加**貼板前置閘** `to_regrole('pcm_readonly') IS NOT NULL`;並寫明失敗後果是「快照停止更新,而舊快照不會顯示這次失敗」 |
| ③**must-fix** · rollback 原樣整份**跑不起來**(`:126` 的 `$function$` 後沒分號) | 🔴 **我核了,是真的。** baseline 檔兩處補成 `$function$;`,檔頭寫明**那兩個分號是我補的**;§3 整節重寫,加上「兩支一起退、包同一交易、我沒實跑驗過語法」以及 rollback 的**真實邊界**(還原不了被覆蓋的快照與被清掉的章) |
| ④**must-fix** · 「隔天必然漂移」缺時序前提;「順手蓋章」會錯誤批准 | 🔴 **「順手蓋一次基線章」那句刪了** —— 替換函式不產生新快照,立刻 approve 會蓋到今天那張有五族差異的舊列,**而 Sean 已拍不蓋章**。§2 改寫成兩條路(只替換 / 貼完立刻重錄)各自的後果 |
| ⑤**must-fix** · 事後斷言擋不住「只退一支」;缺貼前定義比對、交易邊界、避開 cron、拋棄式驗證 | §7 整節新寫:貼前兩閘(角色存在 · 定義 md5 與基底相符)· 同一交易 · 避開 `0 0 * * *` · 貼後五發斷言(其中 ③④ 分別驗 A 與 B **各自**進去了)· 拋棄式三個世界 · 並寫明 `acl-digest-parity.sh` 綠燈**不能當本次證據** |

🛑 **codex 結論是「不可 —— rollback 目前無法整份執行,且順手蓋章會錯誤批准尚未釐清的漂移」。兩項本稿都修了**(分號補上、蓋章那句刪掉),而 §7 補上了它列的驗證缺口。
🛑 **仍未做的**:拋棄式庫實跑(§6 第 1 條)—— **那是貼板前的事,不是本 plan 的事。**
🛑 主視窗 2026-09-09 定:**純 .md 只跑 R1,不跑 R2。**
