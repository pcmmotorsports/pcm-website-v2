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
| 4 | 報價單 **production schema 與 repo 一致性** | 🔴 **未關,且做不完** — 見下方專段 |
| 5 | `B1-a` 的 `select distinct actor` 重跑 | 可選(已跑過一次:`sean` 48 / `staff_1` 17) |
| 6 | 🔴 **`MAINTAIN` 補進權限清單** | ✅ **完成** — 見下方專段 |
| 7 | 🔴 **RLS preflight**(主視窗 2026-08-17 裁定新增) | ⏳ **未做** — 見下方專段 |
| 8 | 🔴 **正式庫 `service_role` 可 `SET ROLE` 到哪些角色**(B 窗 2026-08-17 新增) | ⏳ **未做** — 見下方專段。**這一項擋 apply**,不是資訊性欄位 |

---

## `#4` 為什麼**做不完**(不是還沒做)

E 窗實查(`E-696`):
```
find /Users/sean_1 -maxdepth 3 -type d -name migrations -path '*supabase*'
  ⇒ 10 個命中,全部是 pcm-website-v2 的工作樹,零個是報價單 repo
正向對照 test -d /Users/sean_1/pcm-website-v2/supabase/migrations ⇒ 有 ⇒ find 是活的
```
⇒ **對帳需要的「repo 那一半」不在這台機器上**(真身在 mac mini,memory
`reference_quote-repo-truth-moved-to-mac-mini`;本窗今天也獨立撞到一次:本機 clone 落後 `origin/main` **16** 顆)。

🔴 **E 窗特別交代、本檔逐字留**:
> 不要拿本機任何東西湊那一半;若找到 clone,**先 `git fetch` 對 `origin/main` 驗新舊再比**,
> 否則會比出一堆**假差異,而假差異看起來跟真的一模一樣**。

✅ **production 那一側 E 窗已交**:`docs/security/2026-08-17-quote-db-production-schema-inventory.md`(`dfed7286`)
—— `public` schema **98 個關聯**(表 78 / view 18 / matview 2),來源 `pg_catalog`。
⇒ **缺的是 repo 側,需要 Sean 從 mac mini 提供。已在早上清單。**

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

## `#7` RLS preflight —— **未做**

來源:E 窗 production 側盤點 —— 欄位名疑似含祕密的 **10** 個關聯裡,**RLS 只開了 6 個、4 個關著**。
今天沒事是因為**授權在單獨擋、沒有第二道**。

🔴 **對本線的意義(E 窗原話)**:
> 你日後任何一支 migration 只要給其中一張表一個 `SELECT`,**RLS 不會接住,
> 而且三綠不紅、grep 數不變、沒有東西會提醒你。**

📎 同型 = A 庫 `#550`(全樹唯一一支底表 RLS 對它無效的 view)。
⇒ **主視窗裁定:「這張表 RLS 開了沒」要加進 apply preflight。** 本窗尚未實作,**不要讀成已加**。

## `#8` 正式庫 `service_role` 可 `SET ROLE` 到哪些角色 —— **未做,而它擋 apply**

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

📎 來源:`B-579-STOP` §4-5 提出、本檔 2026-08-17 由 B 窗落為正式前置項。
⚠️ **本項狀態是「未做」** —— 本機拋棄式樁上量的東西**不能**當正式庫的答案。

---

## 現況驗收(可重跑;會過期,引用前重跑)

```
sh /Users/sean_1/pcm-website-v2/scripts/run-rc.sh 3 -- bash scripts/b1b-acceptance-harness.sh
  ⇒ 通過 39 格 / 失敗 0 格 / rc=0     ← 2026-08-17 B 窗
     (~~32 格~~ ~~37 格~~ 均已過期:本輪新增 A19 / A19m / A19m紅對地方 / MA-2a / MA-2b / MA-2c 六格)
```
⚠️ **這個全綠【不代表可以 apply】** —— 上表 `#3`(codex 未過)、`#4`(做不完)、`#7`(未做)、
`#8`(未做)都在它看不到的地方。
⚠️ 39 格全在**拋棄式 PG 樁**(本機 PG 17.10)上,不是 Supabase;樁沒有真 `auth` schema 的角色/權限/trigger。
🔴 **格數會隨新增格漂;引用前重跑,不要抄這個數字。** 真正的結論是下面那張突變覆蓋表的【集合】。

### 突變覆蓋(2026-08-17 B 窗五發,每發錨點唯一性當場 assert;基線 39 格 / 失敗 0)

**怎麼重跑(不要相信下表,自己跑一次)**:對 `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql`
逐一套下列**唯一錨點**替換,每套一發就跑 `bash scripts/b1b-acceptance-harness.sh <port>` 並記錄翻綠的格,
跑完還原。**替換前先 assert 錨點在全檔恰好命中 1 次**(命中數 ≠ 1 ⇒ 那一發的結論不可信):

| # | 錨點(`grep -c` 應回 1) | 改成 |
|---|---|---|
| 1 | `AND attacl IS NOT NULL AND cardinality(attacl) > 0` | 後面接一行 `AND false` |
| 2 | `pg_has_role('service_role', r.oid, 'SET')` | `false` |
| 3 | `AND has_table_privilege(r.oid, oc.oid, d.privilege_type)` | 前面插 `AND false` |
| 4 | `FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS c(privilege_type)` | 陣列換成 `ARRAY[]::text[]` |
| 5 | `IF has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), v_priv)` | `IF` 後插 `false AND` |

| 停用哪一段 | 翻綠的格 | 計數 |
|---|---|---|
| 第 1 層 `attacl` sweep | `A17` + `A3` | 37/2 |
| 第 2 層 `v_reach` 整段 | `A19m`(兩格)+ `MA-2b` + `MA-2c` | 35/4 |
| └ `v_reach` **表級臂** | **只有 `MA-2c`** | 38/1 |
| └ `v_reach` **欄級臂** | **零行為格**(構造不出來,理由在 harness) | 37/1 |
| service_role 表級有效權限迴圈 | `A15` + `MA-2a` | 37/2 |
🔴 **這個數字是 B 窗單方面的量測,無人復現** —— 引用時要帶這個限定。
