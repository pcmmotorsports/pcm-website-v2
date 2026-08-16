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

---

## 2. 為什麼一道不夠(四臂實測,不是推論)

兩個方向的漏法**互為鏡像**,而大多數人只知道其中一個:

- **方向甲｜只 `FROM PUBLIC` ⇒ 收不到具名授權**（Supabase 對 `public` schema 掛了
  `ALTER DEFAULT PRIVILEGES`,新函式**直接授權給 `anon` / `authenticated` 兩個具名角色**）
- **方向乙｜只 `FROM anon, authenticated` ⇒ 收不到 PUBLIC 那份**（Postgres 對新函式授 `EXECUTE`
  給 `PUBLIC`,若 `anon` 的 `rolinherit = t` 則它透過 PUBLIC 照樣執行得到）

### 🔴 兩個方向的證據強度**不一樣,不要當等重**

| 方向 | 證據 | 強度 |
|---|---|---|
| **甲** | **正式庫實錘** —— `#525` 那支 migration apply 當場被自己的守門擋下,ACL 形狀 `[anon:EXECUTE,authenticated:EXECUTE,service_role:EXECUTE]`(`supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql:167-172`) | **production 證實** |
| **乙** | 原廠 PG **17.10** 拋棄式叢集 + **模擬**的 `ALTER DEFAULT PRIVILEGES`;且它靠 `anon.rolinherit = t`,**而正式庫的 `anon.rolinherit` 未確認**(同上 migration `:299` 逐字標未確認) | **僅本機、前提未證** |

⇒ **「兩道都要下」這個結論仍然成立**(甲已足以要求下 PUBLIC 那道,乙足以要求下具名那道作為保險),
**但如果有人問「乙在我們正式庫上真的會漏嗎」,正確答案是「未確認」,不是「是」。**

| REVOKE 寫法 | `anon` 執行得到嗎（PG 17.10 實測） |
|---|---|
| 完全不 REVOKE | ✅ 可以 |
| 只 `FROM anon, authenticated` | ✅ **可以 ← 洞還在**（⚠️ 這一格靠 `rolinherit=t`,正式庫未確認） |
| 只 `FROM PUBLIC` | ✅ 可以 |
| **`FROM PUBLIC` + `FROM anon, authenticated`** | ❌ **關上** |

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
| `CREATE OR REPLACE`,**參數型別變了** | **算新物件** ⇒ 重新拿到 anon/authenticated 授權 |
| `DROP` + `CREATE` | **算新物件** ⇒ 同上 |

⇒ **改一支既有 SECDEF 函式的參數型別 = 它的 REVOKE 全部失效,而 diff 看起來只是改了個型別。**

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
2. 🔴 **正式庫的 `anon.rolinherit` 未確認 —— 而整個「方向乙」靠它。**
   本 repo 自己的 `supabase/migrations/20260816010000_m4b_525_admin_search_customers.sql:299`
   逐字標它未確認。**§2 表格第二列已就地標了這個限定,不要在轉述時把它磨掉。**
3. **`NOINHERIT` 角色 `SET ROLE service_role` 那條路徑未測。**
4. **沒有人讀過正式庫真正的 ACL** —— 全樹稽核讀的是 migration **文字**。
   `#525` 正好證明正式庫可能有 repo 預測不到的狀態。要關需要連線字串。
   ⇒ backlog **`#546`**（`docs/phase-1-backlog.md`）。
5. **§4 的「80 支 / 0 支」不可重跑**(分析器不在 repo,見 §4 該段)。
