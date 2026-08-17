# B1-a / B1-b / B2 · apply 前置清單(**單一正本**)

> 🔴 **這份在 repo,不在信裡。** 先前它只活在 `B-554-STOP` 與幾封訊息中,
> 而今晚已經有一次「取代宣告只活在訊息裡 ⇒ 變成無頭公案」的實例(`Q-A7`)。
> **引用 apply 前置一律以本檔為準;信裡的版本一律視為過期。**

- 建檔:2026-08-17(B 窗)
- 對象:`docs/specs/2026-08-16-m4b-e8b-b1{a,b}-migration-draft.sql` + `…-b2-seed-migration-draft.sql`
- ⛔ **apply 本身歸 Sean**(報價單 repo 明文禁 `supabase db push`,唯一管道 MCP `apply_migration`,需他在場)。

---

## 🔴 不要寫「只剩 Sean 在場」

那句話今晚已經害過一次:它把一個**有範圍的結論**(V 窗只 PASS 了某一顆的 2 條折)
平移成**沒有範圍的結論**,主視窗自陳差 30 秒就拿它去跟 Sean 說可以動資料庫。
⇒ **要講狀態,逐條講。**

## 前置逐條

| # | 前置 | 狀態(2026-08-17 04:xx) |
|---|---|---|
| 1 | `8fb1efb9` 欄級補丁 V 窗複查 | ✅ 已回 `V-020` FAIL 2 條 → 已折 → `V-023` 再 FAIL 2 條 → **已折,待 V 窗窄確認** |
| 2 | pg_cron 殘留處置 | ✅ **完成** — 判不建 + 立案 `#554`(`fba62d35`) |
| 3 | 關卡2 獨立模型背書(codex) | 🔴 **未過** — R1 FAIL(9 must-fix + 2 nit)→ 已折 → R2 FAIL(8)→ 已折;**2026-08-17 04:0x B 窗再跑兩輪,兩輪都【零 findings】**:R1 12 分全花在反覆讀檔被 watchdog 砍、R2(明文禁開檔)連一個 assistant turn 都沒有,兩輪都伴隨 `codex_models_manager::cache: missing field base_instructions`。⇒ **認列缺口,不是 PASS。** 替代=`adversarial-reviewer` + `code-reviewer` 兩條 fresh context |
| 4 | 報價單 **production schema 與 repo 一致性** | 🟡 **部分完成**(~~未關,且做不完~~ 已作廢:repo 側一直都在,原判是 `find -maxdepth 3` 掃不到造成的)— repo 側 ✅ / schema shape ✅ / **migration ledger 讀不到 ⇒ 需 Sean** — 見下方專段 |
| 5 | `B1-a` 的 `select distinct actor` 重跑 | 可選(已跑過一次:`sean` 48 / `staff_1` 17) |
| 6 | 🔴 **`MAINTAIN` 補進權限清單** | ✅ **完成** — 見下方專段 |
| 7 | 🔴 **RLS preflight**(主視窗 2026-08-17 裁定新增) | 🟡 **部分完成** — 本表已守且已具名(**限 B2 apply 當下**);**整庫 10 關聯盤點未做,需正式庫** — 見下方專段 |
| 8 | 🔴 **正式庫 `service_role` 可 `SET ROLE` 到哪些角色**(B 窗 2026-08-17 新增) | ✅ **已量 = 0 列**(2026-08-17 05:12 UTC,E 窗)—— 🔴 **但 0 不是「安全」**:它代表第 2 層在正式庫上**判別力為零**;且**apply 當天必須當場重跑**。見下方專段 |

---

## `#4` production 與 repo 一致性 —— **原本被寫成一個缺口,其實是兩個**

> 🔴🔴 **2026-08-17 下午重寫**:本節原本的結論是「repo 那一半不在這台機器上 ⇒ 做不完」。
> **那句已作廢**,而作廢的方式很值得記:**它是量錯造成的,不是狀況變了。**

### (a) repo 側 —— ✅ **已解,而且它一直都在**

主視窗 2026-08-17 實查:
```bash
D=~/API大量上架/PCM報價單-V2
test -d "$D"                                                     ⇒ EXISTS
git -C "$D" fetch origin                                         ⇒ rc=0
git -C "$D" rev-parse --short origin/main                        ⇒ 482bec5   (fetch 前後相同)
git -C "$D" ls-tree -r --name-only origin/main -- supabase/migrations | wc -l ⇒ 16
```
mac mini 上同一個 repo 的 `origin/main` **也是 `482bec5`** ⇒ 兩邊同版、零漂移。

🔴 **原本判「不在這台機器上」的成因**:`E-696` 用 `find ~ -maxdepth 3` 找,
而真實路徑在**第 4 層** ⇒ 掃不到。**那次還配了正向對照,而對照目標剛好在深度 3 之內**
⇒ **對照過了、結論還是錯的。** 📎 正向對照只證「工具會動」,不證「掃描範圍涵蓋目標」。

🔴 **紀律(仍然適用)**:用前必 `fetch`、**只讀 `origin/main`**
(checked-out 工作樹 HEAD 落後 16 顆)、**絕不 `db push`**。
> E 窗原話逐字留:不要拿本機任何東西湊那一半;**否則會比出一堆假差異,而假差異看起來跟真的一模一樣。**

### (b) production 側 —— ✅ schema shape 已有,🔴 **ledger 讀不到**

✅ **schema shape**:`docs/security/2026-08-17-quote-db-production-schema-inventory.md`(`dfed7286`)
—— `public` schema **98 個關聯**(表 78 / view 18 / matview 2),來源 `pg_catalog`。
2026-08-17 05:06 UTC E 窗補充:函式 **123**(secdef 57)、policy **11**(public 內 **9**)。

🔴 **而「production 已套了哪些版本」讀不到**(E 窗 2026-08-17 實測):
```
SELECT … FROM supabase_migrations.schema_migrations
  ⇒ permission denied for schema supabase_migrations
     (pcm_audit_ro 的 has_schema_privilege USAGE = f)
```
⇒ **ledger 比對這條路對「E 窗的唯讀憑證」是關著的**,而本窗**完全沒有**正式庫連線
⇒ **要嘛 Sean 跑、要嘛靠 schema shape 反推。**

### ⇒ 現在的狀態:**部分完成**,而剩下的那一半需要 Sean

| 子項 | 狀態 |
|---|---|
| repo 側(`origin/main` 可讀、與 mac mini 同版) | ✅ 已解 |
| production schema shape | ✅ 已有(98 關聯 + 函式 123 / policy 11) |
| production **migration ledger** | 🔴 **讀不到,需要 Sean**(E 窗憑證對該 schema `permission denied`) |
| 本片 7 個物件在 production 的存在性 | ✅ **已量:全部不存在**(2026-08-17 05:10 UTC,見下) |
| `service_role` 的 `BYPASSRLS` | ✅ **已量 = t** ⇒ 該斷言以現況會過 |
| `auth.users.id`(FK 目標欄)的 shape | ✅ **已量**(2026-08-17 05:12 UTC)—— 明細見下方 shape 表 |

### 7 個物件的存在性 —— ✅ **已量(E 窗供事實,本窗持 verdict)**

本檔**禁用 `IF NOT EXISTS`** ⇒ 任一個已存在,apply 當場紅。
**事實來源**:E 窗,報價單庫 `pcm-quote-v2`,憑證 `pcm_audit_ro`(唯讀 `pg_catalog`),
**時點 2026-08-17 05:10 UTC**。

| 物件 | 結果 | 量法 / 分母 / 正向對照 |
|---|---|---|
| 表 `public.admin_user_staff_map` | **不存在** | `to_regclass` = NULL;對照 `to_regclass('public.products')` 非空 ⇒ 判定式是活的 |
| 函式 `…_no_delete()` `…_no_truncate()` `…_no_rebind()` | **零命中** | `pg_proc⋈pg_namespace`,`nspname='public' AND proname LIKE 'admin_user_staff_map%'` ⇒ 0 rows;精確 `IN` 三名 ⇒ 0。**分母:public 函式 123**;對照 `LIKE '%'` 取一 ⇒ `_assert_reparse_token` |
| trigger `…_no_delete_trg` `…_no_truncate_trg` `…_no_rebind_trg` | **零命中** | `pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'admin_user_staff_map%'` ⇒ 0 rows;精確 `IN` ⇒ 0。**分母:非內部 trigger 26** |

🔴 **verdict(本窗)**:**以 2026-08-17 05:10 UTC 為準,這 7 個物件都不會撞名。**
⚠️ **這句帶時點,不是無時效的**:apply 不在現在,中間任何人建了同名物件它就過期
⇒ **apply 當天要重量一次**,不要引用這一格當「已經確認過了」。

### shape:五件全部已量(2026-08-17 05:10 / 05:12 UTC 兩批)

| 項目 | 結果 | 備註 |
|---|---|---|
| `auth.users` 表存在 | **是**(count=1) | 🔴 走 `pg_class⋈pg_namespace` 讀 catalog,**不是 `to_regclass`** —— `pcm_audit_ro` 對 `auth` schema **無 USAGE**(`to_regclass('auth.users')` 直接 `permission denied for schema auth`)。對照:同法 `public.products`=1、`auth` schema 存在=1 |
| `service_role` 的 `rolbypassrls` | **t** | 對照:`postgres`=t / `anon`=f / `authenticated`=f ⇒ 本檔那道「沒 BYPASSRLS 就當場紅」的斷言**以現況會過**(⚠️ 不等於「已驗證」,只是現況) |
| `auth.users.id`(FK 目標欄)型別 | **`uuid`** | `format_type` 字面;對照 `public.products.id` 同法 = `uuid` ⇒ `pg_attribute` 查詢是活的 |
| 同上 `attnotnull` | **t** | NOT NULL |
| 同上 是否被 PK / unique 覆蓋 | **是,PK `users_pkey`** | `pg_constraint` `contype='p'` 且該欄在 `conkey`;對照 `products_pkey` ⇒ 查詢是活的。`auth.users` 全約束數 3 |

⚠️🔴 **E 窗的量具邊界要跟著事實一起走,不要讀成「那些東西不存在」**:
`pcm_audit_ro` 對 `auth` schema 無 USAGE、對 `supabase_migrations` schema `permission denied`
⇒ **那兩塊是「讀不到」,不是「沒有」。**

⚠️ **風險沒有消除,只是被轉成「apply 當場紅」**(靠禁 `IF NOT EXISTS` + 前提斷言)。**這句不准拿掉。**

## `#6` `MAINTAIN` —— 已補,附官方來源與實測

**病**:斷言宣稱 `service_role` 權限「恰好 `{SELECT, INSERT}`」,而它列舉的清單只有 **7** 項,
漏了 PG 17 新增的 `MAINTAIN` ⇒ **直接授 `service_role MAINTAIN` 會通過斷言**(codex `b1b:343`)。

**官方來源**(2026-08-17 當場查,非記憶):<https://www.postgresql.org/docs/17/ddl-priv.html>
Table 5.2 表物件權限字串 = **`arwdDxtm`**,共 **8** 項,`m` = `MAINTAIN`
(逐字:「Allows VACUUM, ANALYZE, CLUSTER, REFRESH MATERIALIZED VIEW, REINDEX, and LOCK TABLE on a relation.」)

**已做**:
1. 兩處清單補上 `MAINTAIN`(數法 `grep -c "'TRIGGER','MAINTAIN'"` ⇒ **2**;
   舊 7 項清單殘留 `grep -c "'REFERENCES','TRIGGER'\]"` ⇒ **0**)
2. **新增 PG 版本前提斷言**(`server_version_num < 170000` 就 RAISE)——
   因為加了 `MAINTAIN` 之後這支**硬性要求 PG ≥ 17**,而檔裡原本沒有任何東西說這件事;
   不加的話會炸在 `has_table_privilege(…,'MAINTAIN')` 這種看不出所以然的地方。
3. **harness `A15` 專測**,並**突變驗過**:清單拿掉 `MAINTAIN` ⇒ **只有 A15 翻綠**(30/1)。

📎 **通則(主視窗要求一併記下)**:**「恰好等於某個清單」的斷言,清單漏一項就整條失效,而漏的方式是靜默的。**

## `#7` RLS preflight —— **部分完成**(本表已守;整庫盤點未做)

> 🔴🔴 **這一條有【兩個範圍】,不要拿其中一個去結另一個的案**(主視窗 2026-08-17 明令):
>
> | 範圍 | 狀態 | 誰做的 |
> |---|---|---|
> | `admin_user_staff_map` **這一張表** | 🟡 **已守且已具名 —— 但【限 B2 apply 當下】** | B 窗 2026-08-17 |
> | 正式庫**整庫** 10 個疑似含祕密的關聯(RLS 開 6 **關 4**) | 🔴 **未做**,需要正式庫 ⇒ **要 Sean 在場** | E 窗盤點、未動工 |
>
> ⇒ 下面那一段(E 窗原話)講的是**整庫**那一半,**它仍然成立、仍然未做**。

### 本表這一半:做了什麼(2026-08-17 B 窗)

**先量,再決定要不要動**:把 B1-b 的 `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` 註解掉重跑
⇒ **零格翻綠**,但 `S2` 由 green 變 red、`S4` 抓不到列。
⇒ **它其實一直是被守住的** —— 守它的是 `B2-seed` 自己的前提斷言
(`2026-08-16-m4b-e8b-b2-seed-migration-draft.sql`:`IF NOT (SELECT relrowsecurity …) THEN RAISE '…RLS 沒開。表被改過,拒繼續。'`)。

⚠️ **問題不是沒保護,是那個紅【說不出自己是誰】**:讀的人看到「B2 seeding 壞了」,
要翻三層才知道真因是 RLS 被關掉 —— 而最可能的錯修是**跑去把 B2 的前提斷言放寬**。

⇒ **處置:不新增保護,只把既有保護具名。** 新增 `A20` 兩格:
- `A20 RLS 被關掉時 B2 必須拒絕 seeding`(預期紅)
- `A20 紅對地方`(錯誤訊息必須指名「RLS 沒開」—— 否則與「B2 因別的原因壞掉」分不出來)

**判別力實測**:把 B2 的 RLS 前提斷言停用 ⇒ **只有 A20 那兩格翻綠**(基線 41 格 ⇒ 39/2)。

📌 **本表這一半【不需要正式庫】** —— 它是 migration 自帶的斷言,apply 當下就會紅。
   整庫那一半需要連 production ⇒ 不在本窗權限內,見上表。

### 🔴 而「已守」只到 apply 那一刻為止 —— **這個限定不能拿掉**

adversarial-reviewer 2026-08-17 `F2`,**雙突變實測**(同時拿掉 B1-b 的 `ENABLE ROW LEVEL SECURITY`
**和** B2 的 RLS 前提斷言)⇒ 全 harness **只有 A20 的錨點自檢會叫**,**沒有第二道在守**。

⇒ 精確的狀態是:
- ✅ **apply 當下**:RLS 沒開 ⇒ B2 拒絕 seeding(A20 兩格證明它會紅、且紅得指名)
- 🔴 **apply 之後**:有人下 `ALTER TABLE … DISABLE ROW LEVEL SECURITY;`
  ⇒ **沒有任何東西會發現**。B2 的前提斷言是**一次性**的;B1-b 自己**沒有**對它建的
  `ENABLE RLS` 下落地斷言(`b1b` 那道 DO 只斷言 `service_role` 有 `BYPASSRLS`)。

⚠️🔴 **而 `#7` 的原始關切問的正是【常態狀態】不是 apply 那一刻**(E 窗原話見下方整庫那一段:
「你日後任何一支 migration 只要給其中一張表一個 SELECT,RLS 不會接住」)
⇒ **所以本表這一半也只是【部分】,不要因為 A20 綠了就當本表結案。**

📌 **最便宜的補法(建議、非本片必做)**:B1-b 既有的 DO 區塊加一行
`IF NOT relrowsecurity THEN RAISE`,讓保護與它的斷言**放在同一層**。
本片刻意不做:它會動到 migration 本體 ⇒ 命中鐵則 12②③ ⇒ 該走完整審查流程,不夾帶。

---

### 整庫那一半(E 窗盤點)—— **未做**

來源:E 窗 production 側盤點 —— 欄位名疑似含祕密的 **10** 個關聯裡,**RLS 只開了 6 個、4 個關著**。
今天沒事是因為**授權在單獨擋、沒有第二道**。

🔴 **對本線的意義(E 窗原話)**:
> 你日後任何一支 migration 只要給其中一張表一個 `SELECT`,**RLS 不會接住,
> 而且三綠不紅、grep 數不變、沒有東西會提醒你。**

📎 同型 = A 庫 `#550`(全樹唯一一支底表 RLS 對它無效的 view)。
⇒ **主視窗裁定:「這張表 RLS 開了沒」要加進 apply preflight。**

⚠️🔴 **這一句原本接「本窗尚未實作,不要讀成已加」,已作廢**(code-reviewer 2026-08-17 抓:
它與本節上半、以及檔頭 `#7` 那格**正面矛盾**,而它的主詞讀起來就是 `admin_user_staff_map`)。
**現況分兩半,不要混**:
- `admin_user_staff_map` **這一張表** ⇒ ✅ **已實作且已具名**(`A20` 兩格,見本節上半)
- **整庫 10 個關聯的盤點** ⇒ 🔴 **尚未實作,不要讀成已加** —— 那需要正式庫,**要 Sean 在場**

## `#8` 正式庫 `service_role` 可 `SET ROLE` 到哪些角色 —— ✅ **已量 = 0 列**(而結論不是「安全」)

**為什麼是擋板不是資訊**:B1-b 的「新物件收權斷言」第 2 層會對**每一個** `service_role`
可 `SET ROLE` 到的角色逐一問權限。2026-08-17 B 窗在本機 PG 17.10 實測到的形狀:

```
零可達角色            ⇒ rc=0
一個【零權限】可達角色 ⇒ rc=3
```
⇒ **可達角色的存在本身**就會讓那段跑起來。修 Critical 之前它會 `ERROR: unrecognized privilege type`
當場炸;修完之後不會炸了,但**只要那些角色裡有任何一個對本表持有任何權限,apply 就會紅**
(那正是它該做的事)。⇒ **apply 當天才第一次知道有幾個角色 = 把一個可預先量測的東西留到最貴的時刻。**

**查法(唯讀,Sean 在場時對正式庫跑)**:
```sql
select rolname
  from pg_roles r
 where pg_has_role('service_role', r.oid, 'SET')
   and rolname <> 'service_role'
 order by rolname;
```
🔴 **這道查詢要雙向讀,不要只看「有幾個」**:
- 回**零列** ⇒ 第 2 層在正式庫上**整段不會被求值** ⇒ 它 apply 當天**一格判別力都沒有**
  (⚠️ 那不是「安全」,是「這道守門今天沒有意義」—— 別把零列讀成通過)。
- 回**非零** ⇒ 逐一確認每個角色對 `public.admin_user_staff_map` 的權限,
  預期**全部為零**;有任何一項 ⇒ apply 會紅,而且 `REVOKE` 收不掉(要拆 role membership)。

---

### ✅ 已量(E 窗執行、B 窗持 verdict)—— 而答案是**零列**

**事實**:報價單庫 `pcm-quote-v2`,E 窗自己的 `pcm_audit_ro` 唯讀憑證,純 `pg_catalog`,
**零 `.env`、零實際 `SET ROLE`、零業務列**。**時點 2026-08-17 05:12 UTC**。

```
上面那支查詢 ⇒ 0 列

正向對照(同形、已知非零):
  authenticator 可 SET 到 ⇒ anon / authenticated / service_role   (非零)
⇒ pg_has_role 機制是活的。那個 0 是【量出來的】,不是憑證被鎖。
```

### 🔴 verdict(本窗)—— 照上面那個雙向讀法,零列走的是**下面這條**

**以 2026-08-17 05:12 UTC 為準,第 2 層 `v_reach` 那一段在報價單庫上【判別力為零】。**
它的 `WHERE` 一列都不會求值 ⇒ apply 當天它**不會擋住任何東西**。

⚠️🔴 **三個必須跟著寫下來的推論,否則這份檔會給出假的安全感:**

1. **那一層在 apply 當天給的安全感是假的。**
   本檔任何地方**不得**出現「第 2 層會擋住 X」這類在正式庫上不成立的宣稱。
2. 🔴 **連我修掉的那個 Critical,在正式庫上也【不會發作】** ——
   它的觸發條件逐字是「**只要存在任何一個可 SET ROLE 的角色**」,而現在量到的是 **0**。
   ⇒ commit `c8a7ad91` 的 body 寫的是**條件句**(「只要存在…就當場死」)、字面沒有錯,
     但讀的人**很容易讀成「它本來會炸」**。**實際上以此時點,它不會。**
   ⇒ 修它仍然值得(見下),**但不要拿「避免了一次正式庫事故」當它的功勞。**
3. **harness 裡守第 2 層的那幾格(`MA-2b` / `MA-2c` / `A19m`)在樁上是綠的,
   而它們的世界(存在可達角色)在正式庫上【今天不存在】。**
   ⇒ 這是「**綠在一個不會發生的世界**」的實體樣本。那幾格**不是壞的**
     —— 它們證的是「這段 code 的邏輯對」,**不是**「這段 code 今天在正式庫有作用」。
     兩件事分開講。

**那為什麼還要修、還要留?** 因為角色是**後台點一下就能加**的東西,而
**這支 migration 只跑一次、不會重跑** ⇒ 危險窗口正好落在 **apply 的那一刻**。
今天的 0 只保證今天。

### 🔴🔴 apply 當天的執行步驟(**這是步驟,不是註腳**)

> **在 apply 之前、當場重跑一次上面那支查詢。**
> 今天的 `0` **不能**當那天的 `0` —— 角色可以在中間任何時刻被加進來,
> 而它一旦存在,第 2 層就會開始求值。
> 回非零 ⇒ 照上面「雙向讀」的第二條逐一確認,**不要直接 apply**。

📎 來源:`B-579-STOP` §4-5 提出 → 本檔 2026-08-17 由 B 窗落為正式前置項 → 同日 E 窗量出事實。
📌 分工:**事實 = E 窗(它自己的憑證、它自己判斷接不接)/ verdict = 本窗**。
   本窗**全程沒有**、也**不會**連正式庫。

---

## 現況驗收(可重跑;會過期,引用前重跑)

```
sh /Users/sean_1/pcm-website-v2/scripts/run-rc.sh 3 -- bash scripts/b1b-acceptance-harness.sh
  ⇒ 通過 41 格 / 失敗 0 格 / rc=0     ← 2026-08-17 B 窗
     (~~32 格~~ ~~37 格~~ ~~39 格~~ 均已過期:本輪共新增 8 格 ——
      A19 / A19m / A19m紅對地方 / MA-2a / MA-2b / MA-2c / A20 / A20紅對地方)
```
⚠️ **這個全綠【不代表可以 apply】** —— 上表 `#3`(codex 未過)、
`#4`(**部分完成**:ledger 讀不到)、`#7`(**部分完成**:本表已守、整庫未做)、
`#8`(**已量 = 0 列,而 0 不是「安全」** —— 它代表第 2 層在正式庫上**判別力為零**,
且 **apply 當天必須當場重跑**,見 §`#8` 的執行步驟)
都在它看不到的地方。
⚠️ 41 格全在**拋棄式 PG 樁**(本機 PG 17.10)上,不是 Supabase;樁沒有真 `auth` schema 的角色/權限/trigger。
🔴 **格數會隨新增格漂;引用前重跑,不要抄這個數字。** 真正的結論是下面那張突變覆蓋表的【集合】。

### 突變覆蓋(2026-08-17 B 窗**六發**,每發錨點唯一性當場 assert)

⚠️ **兩個基線**:第 1-5 發量於**基線 39 格**(A20 尚未加入),第 6 發量於**基線 41 格**。

**怎麼重跑(不要相信下表,自己跑一次)**:逐一套下列**唯一錨點**替換,每套一發就跑
`bash scripts/b1b-acceptance-harness.sh <port>` 並記錄翻綠的格,跑完還原。
**替換前先 assert 錨點在該檔恰好命中 1 次**(命中數 ≠ 1 ⇒ 那一發的結論不可信)。
🔴 **第 1-5 發改的是 `…b1b-migration-draft.sql`,第 6 發改的是 `…b2-seed-migration-draft.sql`** ——
兩支不同的檔,別套錯:

| # | 錨點(`grep -c` 應回 1) | 改成 |
|---|---|---|
| 1 | `AND attacl IS NOT NULL AND cardinality(attacl) > 0` | 後面接一行 `AND false` |
| 2 | `pg_has_role('service_role', r.oid, 'SET')` | `false` |
| 3 | `AND has_table_privilege(r.oid, oc.oid, d.privilege_type)` | 前面插 `AND false` |
| 4 | `FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS c(privilege_type)` | 陣列換成 `ARRAY[]::text[]` |
| 5 | `IF has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), v_priv)` | `IF` 後插 `false AND` |
| 6 | (在 **B2** 檔)`IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.admin_user_staff_map')) THEN` | `IF` 後插 `false AND` |

**集合才是結論,計數只是量測現場的隨身標籤。**

| # | 停用哪一段 | 翻綠的格 | 計數(pass/fail) |
|---|---|---|---|
| 1 | 第 1 層 `attacl` sweep | `A17` + `A3` | 37/2 |
| 2 | 第 2 層 `v_reach` 整段 | `A19m`(兩格)+ `MA-2b` + `MA-2c` | 35/4 |
| 3 | └ `v_reach` **表級臂** | **只有 `MA-2c`** | 38/1 |
| 4 | └ `v_reach` **欄級臂** | **零行為格**(構造不出來,理由在 harness) | 37/1 ⚠️ |
| 5 | service_role 表級有效權限迴圈 | `A15` + `MA-2a` | 37/2 |
| 6 | B2 的 RLS 前提斷言(**在 B2 檔**) | **只有 `A20` 那兩格** | 39/2 |

⚠️ **第 4 列的 `37/1` 加起來是 38、不是基線 39 —— 那不是筆誤**(adversarial-reviewer `N1` 點出,已查明):
該發突變把 `A19m` 的 **sed 錨點字串本身**拿掉了 ⇒ 錨點自檢先叫「突變沒生效」並記一次 FAIL,
而 `A19m` 那一格**根本沒跑** ⇒ 少一格。**是 fail-closed 的正確行為,不是掉了一格沒人發現。**
🔴 **這個數字是 B 窗單方面的量測,無人復現** —— 引用時要帶這個限定。
