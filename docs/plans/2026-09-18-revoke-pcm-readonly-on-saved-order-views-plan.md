# plan:收掉 `pcm_readonly` 在 `admin_saved_order_views` 上的 SELECT

窗 B(後台,worktree `/Users/sean_1/pcm-ops`,分支 `agent/ops-17-receipt`)· 2026-09-18
**鐵則 8 —— 動正式庫權限,先寫 plan 等 Sean 批。本檔寫完時【沒有】任何 SQL 貼過正式庫。**

---

## 一句話

一張**今天是空的**表,上面有一條**沒人決定過、查不到誰加的** `pcm_readonly` SELECT。
收掉它,把 2026-08-28 那份設計(「本表刻意零 GRANT」)修回來一半 —— **另一半不修,因為那一半有拍板。**

---

## 1. 改什麼

```sql
REVOKE SELECT ON TABLE public.admin_saved_order_views FROM pcm_readonly;
```

**就這一句。**

🛑 **`service_role` 那條【不碰】。** 它不是漂移:
- `20260904270000_m4b_rls_service_role_select_36.sql:231` 把本表列進那份 40 張名單
- `:350` 逐字 `EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', r.relname)`
- 帳本 `supabase/APPLIED.tsv:515` ⇒ 已貼(2026-09-05 記帳)
- 該檔檔頭 `:7-9` 引 **Sean 2026-09-04 `Q-RLS` 拍甲**逐字:
  「甲 = 收 (推薦) —— 先把 43 張表的後台讀取政策補完,補完才收;現在開工」
- `:9` 逐字:「⇒「收」= 拿掉 `service_role` 的 `BYPASSRLS`。**那是【另一支】migration,不在本支。**」

⇒ 📌 **那條 GRANT 的用途,白紙黑字就是「為了之後收掉特權」。收掉它 = 把 09-04 拍甲做到一半的事推倒。**

**Sean 2026-09-18 拍甲逐字**:
> 甲 = 只收 pcm_readonly(孤兒);service_role 留著,改掉 08-28 檔案裡那句已經被你自己推翻的話

---

## 2. 為什麼

`20260828080000_m4b_b4views1_saved_order_views.sql:189-197` 逐字:

> 「本表**刻意零 GRANT**」
> 「這裡【**不 GRANT 任何表權限給任何角色**】,連 service_role 的 SELECT 都不給」
> 「**私有性是 trust boundary,不簡化**」

而 2026-09-18 唯讀實查,那張表今天的 `relacl` 逐字:

```
{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}
```

⇒ 設計破了。而**兩條破法不一樣**:一條有拍板,一條沒人決定過。

### 🔴 `pcm_readonly` 那條查不到出處 —— 而「查不到」不等於「沒有」

- repo 全庫 **零** `GRANT … admin_saved_order_views … TO pcm_readonly`
- 2026-09-18 實查 `pg_default_acl`:**`pcm_readonly` 不在任何一筆預設權限裡**
  (`public` schema 的 `r` 型只有 `postgres` 與 `supabase_admin` 那兩列)
  ⇒ **不是自動發的,是有人手動下的。**
- ⇒ 🛑 **查不到是誰、什麼時候。本 plan 照實寫「查不到」,不寫「沒有」。**

---

## 3. 影響

### 3-1. 誰在讀那張表 —— 🔬 實查

| 尺 | 讀數 | 判別力對照 |
|---|---|---|
| repo 全庫 `.from('admin_saved_order_views')` | **0 處**(只有 `database.types.ts` 型別宣告 + 一行不相干的索引名註解) | ⚪ 同一把尺問 `orders` ⇒ **26 處** |
| `pg_stat_user_tables`(**全角色合計**) | `seq_scan=4` · `idx_scan=2` · `n_live_tup=0`<br>`last_seq_scan=2026-09-18 02:40` | ⚪ `orders` ⇒ `seq_scan=97,869`<br>⚪ `admin_audit_log` ⇒ `96 / 201` |

🎯 **那張表今天是空的**(`n_live_tup = 0`,⚠️ 這是估計值不是 `count(*)`)。
⇒ 所有員工的「已存檢視」目前一筆都沒有 ⇒ **任何讀它的查詢今天回的都是 0 列。**

### 3-2. 🛑 而我【量不到】的那一格,要寫清楚

「有沒有稽核 / 報表在用 `pcm_readonly` 讀它」—— **我用唯讀角色量不到**:
```
extensions.pg_stat_statements  ⇒ ERROR: permission denied for schema extensions
```
唯讀角色沒有 `extensions` 的 `USAGE`。
📌 **這正是 09-18 那個 storage 坑的同一族:「permission denied」不是「沒有」,是「我問不到」。**

✅ **Sean 在 SQL Editor(`postgres` 身分)可以量,SQL 如下** —— 建議**貼 REVOKE 之前先跑這一發**:
```sql
-- 這個統計窗多久
SELECT stats_reset, now() - stats_reset AS window_len FROM extensions.pg_stat_statements_info;

-- ② 有沒有人讀過那張表
SELECT pg_get_userbyid(userid) AS role, calls, rows
  FROM extensions.pg_stat_statements
 WHERE query ILIKE '%admin_saved_order_views%' ORDER BY calls DESC LIMIT 10;

-- ③ 🔴 正對照(沒有這格,②的 0 沒有判別力 —— 分母可能是 0)
SELECT pg_get_userbyid(userid) AS role, count(*) AS stmt_kinds, sum(calls) AS calls
  FROM extensions.pg_stat_statements
 WHERE userid = (SELECT oid FROM pg_roles WHERE rolname='pcm_readonly') GROUP BY 1;
```
**判準**:③ 有數字,而 ② **扣掉我們自己的探測之後**是 0 ⇒ 沒人用 `pcm_readonly` 讀它。
🛑 **而這還不夠 —— 還要 `dealloc = 0` 且窗夠久。** 三個條件全中才可以貼,見 3-2a 與 3-2b。

---

### 🔴🔴 3-2a. **量測者自己會污染那把尺** —— 2026-09-18 實際發生,差點誤判

🔬 **Sean 實跑的讀數**:

**③ 對照組(分母)—— 活的:**
```
pcm_readonly   stmt_kinds = 2,723   calls = 8,607
⇒ 這把尺【有在記】這個角色 ⇒ 甲 / 丙 兩條路不用走了。
```

**② 那張表 —— 不是 0,是【3 筆】:**
```
SELECT $1 AS t, count(*) FROM public.admin_saved_order_views
  UNION ALL SELECT $2, count(*) FROM public.orders   UNION ALL …      1 次 / 3 列
SELECT count(*) AS 列數 FROM public.admin_saved_order_views            1 次 / 1 列
SELECT $1 AS t, count(*) FROM public.admin_saved_order_views
  UNION ALL SELECT $2, count(*) FROM public.brands   UNION ALL …      1 次 / 3 列
```

🛑 **照本 plan 原本寫的判準(「② 是 0」),這裡就是「有人在用 ⇒ 不能貼」—— 而那是【錯的】。**

**分開它們的不是筆數,是【查詢字面】:**
- 三句**全部是 `count(*)`,沒有一句在讀內容**(沒有 `SELECT *`、沒有取欄位)。
- 那個 `UNION ALL` 接 `orders` / `brands` / `coupons` 的形狀,**就是本線做判別力對照的招牌動作**。
- 🔬 **而且可以再驗一格**:`userid` 是 `pcm_readonly`,
  而 `scripts/readonly-prod-sql.sh` 正是以這個角色連線 ⇒ **這三句走的就是我們的探測路徑**。
  ⚠️ 射程:`pg_stat_statements` **不記錄執行者是誰**,只記角色
  ⇒ 「是我們下的」是**字面 + 路徑**兩條證據合起來的判斷,不是它自己講的。

#### 📌 這一格要記的形狀

> **我們為了驗證而下的查詢,污染了我們用來驗證的那把尺。**

- 它**兇在方向**:污染讓讀數**從 0 變成非 0** ⇒ 它造出的是**假陽性**
  ⇒ 📌 **它不會讓你誤貼,它會讓你【誤停】** —— 而誤停的那一端**沒有任何東西會叫**,
    只會有一份寫著「有人在用、不能動」的報告,而那句話是假的。
- ✅ **改後的判準**:② 的每一筆都要**看字面**,判它是不是我們自己的探測;
  **扣掉之後**還有沒有剩。剩 0 ⇒ 沒人在用。
- 🛑 **判不出某一筆是誰下的 ⇒ 算「有人在用」,不貼。** 存疑時往保守那一邊倒。
- 🔵 **下次要避開它**:量之前先記下 `②` 的當下筆數當基準,或**換一個不碰那張表的角色**去量
  —— 而本次已經污染了,只能靠字面扣。

---

### 🔴 3-2b. **② 是 0(或扣完是 0)仍然不夠** —— `dealloc` 那一格現在就要看

我在 3-2 下面寫過:
> `pcm_readonly` 用得少 ⇒ 它正是最先被擠掉的那一種。而汰換掉的東西**不會留下它曾經存在的痕跡**。

🛑 **那句話對 ② 這個 0 同樣成立** —— 一個**上週**跑過的稽核查詢,今天可能已經被擠出表了,
而表看起來**完全正常**。

⇒ ✅ **可以貼的完整條件(三個全中)**:
```
① ③ 有數字（尺有在記這個角色）                     ✅ 2026-09-18 已滿足：2,723 / 8,607
② ② 扣掉我們自己的探測之後 = 0                      ✅ 2026-09-18 已滿足：3 筆全是 count(*) 探測
③ dealloc = 0  且  window_len ≥ 30 天               ⏳ 待 Sean 回數字
```
🔵 **`track` 與 `dealloc` 的差別,是這一片最硬的一格**:
- `track = 'none'` ⇒ **整張表是空的** ⇒ 好發現。
- `dealloc > 0` ⇒ **部分消失,而表看起來正常** ⇒ 🔴 **不好發現,而它正是我們要的那一筆會先走的那一種。**

### 🔴 而 ③ 也是 0 的話,【然後呢】—— 先判好,不要當場現想

🔵 **2026-09-18 實跑:③ = 2,723 種 / 8,607 次 ⇒ 本次【不走這一節】。**
下面留著,是給**下一個抄這片的人**用的 —— 他的 ③ 可能是 0。

🛑 **③ 是 0 不是一個答案,是三個** —— 而它們在畫面上長得一模一樣:

| | 情況 | 可不可以貼 |
|---|---|---|
| **甲** | 統計窗剛被重置過 | 🛑 **不可以** ⇒ 再等幾天重量 |
| **乙** | 窗夠久,而 `pcm_readonly` 真的一次都沒跑 | ✅ **可以** —— 這才是「沒人在用」的證據 |
| **丙** | 這把尺根本沒記到那個角色 | 🛑 **不可以** ⇒ 尺不適用,換別的路 |

**⇒ 分甲乙的尺,就是上面第一發**(`stats_reset` / `window_len`)。
📌 **那一發不是背景資料,它是判準的一部分** ——
沒有它,一個「剛重置完五分鐘」的 0 與一個「跑了三十天」的 0 會被讀成同一件事。
🔵 判線:`window_len` 短於 `pcm_readonly` 的**使用週期**(查帳是偶爾做的,不是每天)
⇒ **保守取 30 天**;不足 30 天 ⇒ 算甲,不算乙。

**⇒ 分乙丙的尺,要多問兩格**(Sean 同一發一起跑):
```sql
-- 丙-1：這把尺有沒有開著
SHOW pg_stat_statements.track;     -- 'none' ⇒ 它根本沒在記 ⇒ 丙，尺不適用

-- 丙-2：🔴 有沒有在【汰換】條目（這一格才是真正的盲區）
SELECT dealloc, stats_reset FROM extensions.pg_stat_statements_info;
```
- `dealloc = 0` ⇒ **從來沒有條目被擠掉** ⇒ 那個 0 是真的缺席 ⇒ **乙**。
- 🔴 `dealloc > 0` ⇒ 條目會被擠掉,而 **`pcm_readonly` 用得少 ⇒ 它正是最先被擠掉的那一種**
  ⇒ 📌 **這時候乙與丙【分不出來】。照實寫「分不出來」,不要猜,不要貼。**

🛑 **甲、丙、以及「分不出來」這三種,一律【不貼】。** 只有乙可以往下走。
📌 判別句:**一個 0,要先問它的分母** —— 本 plan 已經在 `pg_default_acl` 與這一格各問過一次。

### 3-3. 🔴 風險不是零

我量不到唯讀角色那一側 ⇒ **有可能某個稽核查詢明天開始壞,而沒有東西會叫。**
⇒ 所以下面第 5 節寫的是「**怎麼發現它壞了**」,不只是 rollback。

---

## 4. Rollback

```sql
GRANT SELECT ON TABLE public.admin_saved_order_views TO pcm_readonly;
```

🔬 **這一句是真 no-op 級的還原**:2026-09-18 在拋棄式 PG 17.10 實測過 ——
**把已經有的權限再 GRANT 一次,`relacl` 逐字相同**(板 20260918050000 的第 1、2 發)。
⇒ 還原之後的 acl 會與貼之前**逐字相同**,不是「差不多」。

⚠️ 而**還原檔本身要有一道斷言**(照板 050000 的規格):還原完必須用
`aclexplode(relacl)` 確認那一列**真的回來了**,不是印一句「已還原」就走掉。
🛑 **不要用 `has_table_privilege`** —— 那張表對 PUBLIC 沒開,今天它會答對,
而 **`pcm_readonly` 有 `rolbypassrls = t` 且是可登入角色**,尺一旦換人問就會失真。
(板 050000 的 R2 MF1 就是栽在這把尺上。)

---

## 5. 🔴 怎麼發現它壞了(主視窗指定要有這一節)

REVOKE 之後,壞掉的樣子是「**某個唯讀查詢開始回 permission denied**」——
而那是**在我們看不到的地方**發生的。三道,由淺到深:

1. **貼完當下**(Sean 一發):
   ```sql
   SELECT has_table_privilege('pcm_readonly','public.admin_saved_order_views','SELECT'); -- 應為 f
   SELECT has_table_privilege('service_role','public.admin_saved_order_views','SELECT'); -- 應為 t（沒被誤傷）
   ```
2. **貼完 7 天內**,重跑 3-2 那三發 `pg_stat_statements` ——
   若 ② 出現新的 `pcm_readonly` 列 ⇒ **有人正在用它,而現在會失敗** ⇒ 走第 4 節還原。
3. **兜底**:`pcm_readonly` 是給人手動查帳用的角色 ⇒ **壞掉的人會開口**。
   📌 而這一條**不是閘,是希望** —— 寫出來是為了讓人知道 1 與 2 之外沒有別的。

---

## 6. 順帶要改的兩處(併進同一片的檔頭,不另開)

### 6-1. `20260828080000:194-197`
> 「這裡【不 GRANT 任何表權限給任何角色】,連 `service_role` 的 SELECT 都不給」

⇒ **這句已被 Sean 2026-09-04 `Q-RLS` 拍甲推翻**,出處 `20260904270000:350`,
而那條 GRANT 是「收掉 `service_role` 的 `BYPASSRLS`」的**前置工程**。
🛑 **舊字面留刪除線,不覆蓋。**

### 6-2. `20260828080000:155-156`
> 「(拿掉 BYPASSRLS ⇒ 讀到空的)在本表【構造不出來】—— 因為**今天就沒有任何一條路是靠 BYPASSRLS 讀它的**」

**主視窗要我自己判這句在甲做完之後會不會變回真。判得出來,判準如下。**

🔬 2026-09-18 實查:

| 角色 | `rolbypassrls` | 表級 SELECT | 表上有沒有它的 policy |
|---|---|---|---|
| `pcm_readonly` | **t** | **有**(本片要收的那條) | ❌ 無 |
| `service_role` | **t** | 有(09-04 給的) | ✅ `admin_saved_order_views_select_service_role`(`SELECT`,`TO service_role`) |

那張表 `relrowsecurity = t` · policy 共 **1** 條。
⚪ 判別力對照:同一把尺問 `orders` ⇒ 2 條、`admin_audit_log` ⇒ 2 條 ⇒ 尺印得出不同的數。

**✅ 判:甲做完之後,那句話【會變回真】,而且理由變了。**
- `pcm_readonly`:收掉 GRANT 之後**沒有表權限** ⇒ 有 BYPASSRLS 也讀不到 ⇒ 那條路關了。
  📌 **BYPASSRLS 繞的是 RLS,不是 GRANT。** 兩道是串聯的,收任何一道都讀不到。
- `service_role`:它**不靠** BYPASSRLS —— 09-04 給了它一條 `TO service_role` 的 SELECT policy
  ⇒ 就算拿掉 BYPASSRLS,它照樣讀得到 ⇒ **「拿掉 BYPASSRLS ⇒ 讀到空的」在本表仍然構造不出來。**

**⇒ 而這個判斷【可以當場驗】,不必相信我**:repo 裡已經有那把尺 ——
`scripts/rls-service-role-select-verify.sh`,它用 `pcm_verify_norls`
(**NOBYPASSRLS**,而是 `service_role` 的成員)去讀,並帶兩發突變
(`USING(false)` / `RESTRICTIVE`)證明它會翻面。
🛑 **REVOKE 貼完之後跑一次那支** —— 它若仍讀得到本表 ⇒ 上面那句判斷成立。
⚠️ **在那一發跑完之前,6-2 的更正文字寫「待驗」,不要先寫成結論。**

---

## 7. 貼板順序與時機

- 本片**與任何程式碼無關** ⇒ 照 CLAUDE.md〈貼板與推的順序〉第二條:
  **等推 main 那一發跑完再貼**(帳本閘只在推 main 時跑,途中貼的版本會被判「平台孤兒」擋下)。
- 鎖:`REVOKE` 只碰 `pg_class` 的 `relacl` 那一列,**對目標表零筆鎖**
  (2026-09-18 拋棄式 PG 實測,板 050000 那一輪量的)⇒ **不必避開客人多的時段。**
- 🔴 **而它會連帶收掉欄級** —— 2026-09-18 實測:表級 `REVOKE` **會**把該角色的欄級一起收掉
  (連該角色從未有表級權限時也照收)。
  ✅ 本表 `attacl` 實查 = **0 列**(沒有任何欄級授權)⇒ **這一片沒有這個風險**。
  📌 寫出來是因為**下一個抄這一片的人可能有**。

---

## 8. 要 Sean 決定的 —— ✅ **2026-09-18 兩題都拍【甲】**

```
Q：這一片什麼時候貼？
A：甲 = 等推 main 那一發跑完再貼（照規矩，推薦）
   乙 = 現在就貼（要先確認沒有推 main 的動作在途中）
```

```
Q：3-2 那三發 pg_stat_statements 要不要先跑？
A：甲 = 先跑，看到 ③ 有數字而 ② 是 0 才貼（推薦 —— 那是唯一能證明「沒人在用」的尺）
   乙 = 不跑直接貼（那張表今天是空的，壞了也只是回 0 列變成回錯誤）
```

✅ **Sean 2026-09-18 兩題都拍甲**:
1. **等推 main 那一發跑完再貼。**
2. **先跑那三發 `pg_stat_statements`,`③` 有數字而 `②` 是 0 才貼。**

🛑 ⇒ **而「③ 也是 0」那條路照 3-2 的表走:甲 / 丙 / 分不出來,三種一律不貼。**

---

## 9. 這份 plan 裡【只有我量過、沒有第二個人複驗】的格子

1. 全部正式庫讀數:`relacl` · `pg_default_acl` · `rolbypassrls`(三個角色)· RLS/policy 數 · `pg_stat_user_tables` 那三列。
2. 「表級 REVOKE 會連帶收欄級」「重複 GRANT 是 no-op」「GRANT/REVOKE 對目標表零筆鎖」那組拋棄式 PG 行為量測。
3. repo grep 的 0 處 / 26 處。
4. 🛑 **6-2 那個判斷**是**推理**,不是量測 —— 它的驗法寫在 6-2,**跑過才算數**。

---

🛑 **本 plan 未批。零 SQL 貼過正式庫。`APPLIED.tsv` 未動。**
