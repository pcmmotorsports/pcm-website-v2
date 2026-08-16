# 規格：`payment_confirmer` 零表授權斷言

- **來源**：E 窗 Phase 2 §5.1（`docs/security/2026-08-16-security-audit-run1-phase2-hunt.md`）
- **狀態**：**規格，不是實作。** E 窗唯讀 ⇒ 只交規格，migration 由別的窗寫。
- **日期**：2026-08-16

---

## 1. 要解決的問題（**不是「有洞」，是「沒有守衛」**）

實測：`payment_confirmer`（金流狀態機專用的窄權登入角色）
對 `public` 的 **55 個關聯 × 5 種權限 = 0/55 全零**。

**這是好消息，而好消息正是它危險的地方** —— 讀到這裡的人會停下來。

🔴 **那個 `0/55` 沒有任何東西在守。** 它成立的原因是：
**Supabase 的 `ALTER DEFAULT PRIVILEGES` 名單裡只有 `anon` / `authenticated` / `service_role`，沒有它。**
⇒ **今天沒人手寫過 `GRANT … TO payment_confirmer`，如此而已。**

**⇒ 「那把憑證外流也撈不走客戶資料」這個結論的有效期，
等於「沒有人手寫過那句 GRANT」的有效期。而沒有東西會在有人寫下它的時候叫。**

📎 同族：`feedback_seen-written-handled-are-three-steps`
—— 判別句：**如果沒人回來看這件事，會有任何東西紅嗎？** 現在的答案是「不會」。

---

## 2. 要斷什麼

**在 `public` schema 內，`payment_confirmer` 對【每一個關聯】的下列權限必須全部為假：**

```
SELECT · INSERT · UPDATE · DELETE · TRUNCATE
```

🔴 **五項，不是四項。** 只寫 CRUD 四個字會漏掉 `TRUNCATE` ——
而 **`TRUNCATE` 不受 RLS 管**，且同一個漏法今天已經在 Dashboard 那個開關上量到過一次
（官方原句只 revoke `select,insert,update,delete`，`TRUNCATE`／`REFERENCES`／`TRIGGER` 留著；
見 Phase 2 上游檔 §7c-2）。

⚠️ **不要**把 `REFERENCES` / `TRIGGER` 也列進來：那兩項不讓人讀到資料，
列進去會讓斷言在無害情況下紅、然後被人放寬 —— **一條會誤報的斷言，壽命比沒有斷言還短。**

### 🔴 2.1 一定要同時斷**欄級**，否則斷言是可繞過的

`has_table_privilege` 對**欄級授權回 false**。
⇒ 只用 `has_table_privilege` 寫的斷言，遇到
`GRANT SELECT (customer_user_id, phone) ON customers TO payment_confirmer`
**會判綠**，而那句話已經足以撈走 PII。

🔴 **這不是假設，是今天真的發生過的**：`E-684` 的斷言樣板第一版就是這樣，被 B 窗實跑打穿。

⇒ **表級一圈 + 欄級一圈，兩圈都要。**

---

## 3. 分母怎麼來（可重跑）

```sql
SELECT c.oid, c.relname
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p','v','m','f');   -- 表 / 分割表 / view / 物化 view / 外部表
```

**2026-08-16 實測 = 55 個關聯。**

⚠️ **分母不要寫死成 55。** 斷言要對「**當下查到的每一個**」跑，
否則新增的表天生不在檢查範圍內 —— **那正是要防的東西。**

🔴 **一律用 `pg_catalog`，絕不用 `information_schema`**：
後者只回「呼叫者有權限的東西」，對低權限帳號**系統性回 0** ⇒ 會產生一份漂亮的假綠。

---

## 4. 斷言形狀

```sql
DO $$
DECLARE
  v_bad text[] := ARRAY[]::text[];   -- 🔴 必須標型別，否則錯誤訊息會變成另一個錯
  r     record;
  p     text;
  a     text;
BEGIN
  -- 前置閘：角色不存在就停（不要靜默通過 —— 「查無」不是「沒問題」）
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'payment_confirmer') THEN
    RAISE EXCEPTION '前置閘：角色 payment_confirmer 不存在（`20260611120000:62` 建立）⇒ 停下';
  END IF;

  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
  LOOP
    -- ① 表級
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege('payment_confirmer', r.oid, p) THEN
        v_bad := v_bad || format('%s:表級:%s', r.relname, p);
      END IF;
    END LOOP;

    -- ② 欄級（🔴 表級為 false 時【仍然】要查；has_table_privilege 看不到欄級授權）
    FOR a IN
      SELECT att.attname FROM pg_catalog.pg_attribute att
       WHERE att.attrelid = r.oid AND att.attnum > 0 AND NOT att.attisdropped
    LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
        IF has_column_privilege('payment_confirmer', r.oid, a, p) THEN
          v_bad := v_bad || format('%s.%s:欄級:%s', r.relname, a, p);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF array_length(v_bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'payment_confirmer 不該對 public 有任何表/欄授權，實測命中 %：%',
      array_length(v_bad, 1), array_to_string(v_bad, ', ');
  END IF;
END $$;
```

### 🔴 4.1 正向對照（**沒有它，這條斷言可能是恆真的**）

同一支 migration 裡要再斷一句「**它該有的東西還在**」：

> # 🔴 F8 更正：原版只驗**一支**，其餘收光了照樣綠
>
> 原版只檢查 `confirm_order_payment` 一支。
> ⇒ **保留這支、同時撤掉 `claim_due_webhook_events` / `claim_stuck_unsettled_attempts` /
> `get_active_charge_attempt`，這個對照【仍然綠】，而 sweeper 已經整條死了。**
> ⇒ 它只證「這個角色還有**某一項**能力」，**不證「金流 cron 還活著」**。已改成逐支涵蓋。

```sql
-- payment_confirmer 必須仍呼得到【sweeper／cron 真正依賴的每一支】，
-- 否則收權收過頭 ⇒ 金流排程整條啞掉，而「零表授權」那半照樣綠。
DECLARE
  c_required constant text[] := ARRAY[
    'confirm_order_payment',            -- 入帳終點
    'get_active_charge_attempt',        -- settleCharge 反查
    'claim_due_webhook_events',         -- webhook sweeper
    'claim_stuck_unsettled_attempts',   -- attempt sweeper
    'claim_expired_pending_attempts',   -- 12h 孤兒回收
    'mark_webhook_processed',
    'mark_attempt_settle_retry',
    'claim_order_poll_settle'           -- 輪詢節流
  ];
  v_missing text[] := ARRAY[]::text[];
  fn text;
BEGIN
  FOREACH fn IN ARRAY c_required LOOP
    -- 用 to_regprocedure 而非 ::regproc：同名多載時 ::regproc 會擲錯
    IF to_regprocedure('public.'||fn||'(...)') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname=fn
            AND has_function_privilege('payment_confirmer', p.oid, 'EXECUTE'))
    THEN
      v_missing := v_missing || fn;
    END IF;
  END LOOP;

  IF array_length(v_missing,1) IS NOT NULL THEN
    RAISE EXCEPTION '正向對照：payment_confirmer 對這 % 支沒有 EXECUTE ⇒ 收權收過頭，'
      '金流 sweeper／cron 會整條啞掉（而零表授權那半仍會綠）：%',
      array_length(v_missing,1), array_to_string(v_missing, ', ');
  END IF;
END;
```

⚠️ **`c_required` 這份清單我沒有逐支追它的呼叫端**（是從 `PgWebhookInboxAdapter` /
`PgChargeAttemptAdapter` / `PgPollSettleThrottleAdapter` 讀出來的）
⇒ **實作者要自己再對一次**，少列一支就退回 F8 那個病。

**理由**：一條「什麼都不該有」的斷言，在**角色被整個刪掉**或**權限被收過頭**時**也會綠**。
前置閘擋掉「角色不存在」，這一句擋掉「角色還在但已經廢了」。

---

## 5. 🔴 負向對照 —— **交付前必跑，不跑不算做完**

**目的**：證明這條斷言**紅得起來**。在**拋棄式 PG**上跑（**絕不在正式庫**）：

```sql
BEGIN;
  -- 情境 A：表級授權 ⇒ 斷言必須紅
  GRANT SELECT ON public.customers TO payment_confirmer;
  -- …此處貼上 §4 的 DO 區塊…      期望：RAISE EXCEPTION，訊息含 customers:表級:SELECT
ROLLBACK;

BEGIN;
  -- 🔴 情境 B：只給【欄級】⇒ 斷言【仍然】必須紅
  --    這一格是整份規格的重點：只寫 has_table_privilege 的版本會在這裡判綠
  GRANT SELECT (phone) ON public.customers TO payment_confirmer;
  -- …此處貼上 §4 的 DO 區塊…      期望：RAISE EXCEPTION，訊息含 customers.phone:欄級:SELECT
ROLLBACK;

BEGIN;
  -- 情境 C：只給 TRUNCATE ⇒ 必須紅（防「只想到 CRUD 四個字」）
  GRANT TRUNCATE ON public.customers TO payment_confirmer;
  -- …期望：RAISE EXCEPTION，訊息含 customers:表級:TRUNCATE
ROLLBACK;

BEGIN;
  -- 情境 D：正向對照本身 —— 收掉 EXECUTE ⇒ §4.1 那句必須紅
  REVOKE EXECUTE ON FUNCTION public.confirm_order_payment FROM payment_confirmer;
  -- …期望：RAISE EXCEPTION，訊息含「收權收過頭」
ROLLBACK;
```

🔴 **四格都要看到【紅】，而且要確認紅的是【預期那一條訊息】** ——
「紅了」不等於「紅對地方」（今天已經在別處踩過：`git checkout` 還原把突變與實作一起收掉，
造成的紅其實是實作不見了）。

⚠️ **`ROLLBACK` 之後要驗零留痕**：`git status --porcelain` 與再跑一次斷言（應為綠）。

---

## 6. 放哪、什麼時候跑 —— 🔴 **本節 2026-08-16 整段重寫（F1）**

> # 🔴🔴 F1：本節原版**防不住這份規格自己定義的威脅**
>
> 原版寫「放進新一支 migration 的**尾段斷言區**」+「隨 `db push` **每次 apply 都跑**」。
> **那兩句自相矛盾，而我沒看出來：**
>
> **migration 只在【首次 apply】執行一次**（ledger 記已套用、之後不重跑）。
> ⇒ 之後有人在 Dashboard SQL editor 或**更晚的一支 migration** 裡下 `GRANT … TO payment_confirmer`，
> **這條斷言永遠不會響。**
>
> **而「之後有人寫的那句 GRANT」正是 §1 寫的那個威脅本身。**
> ⇒ **這不是瑕疵，是規格沒有解決它自己提出的問題。** 所以整段重寫，不打補丁。
>
> 📎 形狀＝**守門不守它宣稱要守的東西**（我今晚在別處抓過同一形狀，這次是在自己的規格裡）。

### 6.1 正解：**常駐**機制，二選一

> 📌 **平台版本（本規格的核心機制是版本相關的，所以指名）**：**PostgreSQL 17**。
> 正式庫 **17.6**、拋棄式驗證環境 17.10 —— **同 major，行為一致**。
> 🔴 **本規格先前【沒有指名任何 PG 版本】，那本身是缺陷**（V 窗 `grep` 零命中指出）：
> **一份規格站在一個未指名的平台版本上，而它的核心機制隨版本而異。**

| 方案 | 怎麼運作 | 取捨 |
|---|---|---|
| **A. Event trigger**（**推薦**） | 掛 `ddl_command_end`，**任何 `GRANT`／`REVOKE` 一下去就當場檢查** | ✅ **即時**、與威脅同一層。**`GRANT` 會觸發 —— 已由官方文件確認，不再是未確認項**（見下） |
| **B. `pg_cron` 排程**（週期重跑 §4 那個 `DO` 區塊） | 週期性重掃，違反就告警 | ✅ **補 A 的已知盲區**（見下）；⚠️ 有時間窗 |

### 6.1-a `ddl_command_end` 對 `GRANT` 會不會觸發 —— **已結案（官方文件）**

PG17 **Event Trigger Firing Matrix**：`GRANT` / `REVOKE` 的 `ddl_command_end` 欄是 **X（支援）**，
註記逐字 **`Only for local objects`**；`ALTER DEFAULT PRIVILEGES` 的 `ddl_command_end` 也是 **X**（無註記）。

⇒ **本規格的主威脅（`GRANT SELECT ON <表> TO payment_confirmer`）＝ local object ⇒ 抓得到。**

### 6.1-b 🔴 但 `Only for local objects` 是一道**真實邊界**，不是小字

PG17 Event Trigger 定義逐字：

> `this event does not occur for DDL commands targeting shared objects
> — databases, roles, and tablespaces —`

```
GRANT SELECT ON <table> TO payment_confirmer    local            ⇒ 觸發 ✅
GRANT <某個有權限的角色> TO payment_confirmer    roles = shared   ⇒ 【不觸發】🔴
```

⇒ **event trigger 抓不到「把一個有權限的角色【授予】它」這條路。**

✅ **而那條路【已經有守】**：§7 提到的**角色成員資格斷言**
（`20260811060000_…` 約 `:363-374`，408 行內、已覆核）正是守它的。
⇒ **洞不存在 —— 但讀者不會自己把這兩件事接起來，所以寫在這裡。**

### 6.1-c ⇒ 所以 A 與 B **不是「保險起見都做」，是互補**

🔴 **這個區別決定那個機制活不活得下來：**

```
❌ 「保險起見」的機制   ⇒ 下一個做效能整理的人會拿掉它
✅ 「補某某盲區」的機制 ⇒ 不會，因為理由寫在它旁邊
```

**⇒ `pg_cron` 的存在理由是：它涵蓋 event trigger 的【已知盲區】**
（shared object 的授權、角色成員繼承）**，不是備援。**
**理由本身就是那個機制的存活條件。**

📎 本 repo **已有 event trigger 的可用範本**：外部曝險稽核檔 §7c-2 的 A2（`autorevoke_new_objects`）。
📌 官方文件已足以結案，但**實作時建議在 17.10 補跑一次真實測當 belt-and-suspenders**
（**不是 blocker**）。

### 6.2 仍然成立的兩句（原版對的部分，保留）

| | |
|---|---|
| **不放哪** | ❌ **不要只放進 CI 的 lint／grep** —— **那句 `GRANT` 可以不經過 repo**（Dashboard SQL editor 直接下） |
| **為什麼** | 🔴 **這個威脅的載體不是 repo，是資料庫本身** ⇒ **守衛必須也長在資料庫裡。** |

⚠️ **migration 尾段斷言仍有一個用途**：**驗證「安裝當下」的狀態是乾淨的**。
⇒ **可以留**，但**它是安裝驗收，不是常駐守衛** —— 兩者不要混為一談（原版就是混了）。

---

## 7. 誠實邊界

- 本規格**只涵蓋 `public` schema**。`payment_confirmer` 對其他 schema 的授權**沒有量過**（未確認）。
- 只涵蓋**表與欄**。**函式 EXECUTE 面見下面那個更正框 —— 原本那句是錯的。**

> # 🔴🔴 F7 更正：這裡原本寫錯了兩件事
>
> 原文：「**函式 EXECUTE 的白名單已由既有斷言守著**（`20260811060000_…:517` 斷言非 owner grantee
> 恰為 `[payment_confirmer:EXECUTE]`）」
>
> **(a) `:517` 不存在。** 那支檔**只有 408 行**（`wc -l` 實測）。正確位置約在 **`:290-306`**。
> **(b) 更重要：那道斷言只涵蓋【一支】函式**，不是「23 支金流函式的白名單」——
> 它斷的是**該 migration 自己定義的那一支**（`claim_stuck_unsettled_attempts`）的 grantee 集合。
>
> **而那支檔【自己】就寫了射程限制**（`:207` 逐字）：
> > 「**射程之外**：owner 持有的其他 SECDEF 函式若把本支包起來、或動態 SQL 轉呼，
> > 前台角色仍可**間接**觸發它 …… **本片不宣稱擋得住間接可達**。」
>
> ⇒ **正確口徑：函式 EXECUTE 面【沒有】一道涵蓋全部的白名單斷言。**
> 存在的是**逐片、逐支**的局部斷言。**本規格不重複它們，但也不能宣稱它們已經守住整個面。**
>
> 🔴 **這條的諷刺我要自己說**：我在外部曝險稽核檔 §2.6 逐字寫過
> 「**錯的 `檔案:行號` 比沒有出處更糟**」「**`檔案:行號` 一律逐條開檔驗**」
> —— **而 `:517` 正是我警告的那種錯，出現在我自己寫的規格裡。**
>
> 📌 **我後來對全部四份檔做了機械複驗**（`檔名:行號` 逐條比對實際行數）：
> **43 條在範圍內、0 條超出**。
> 🔴 **而 `:517` 沒有被那次複驗抓到** —— 因為我寫的是縮寫 `20260811060000_…:517`，
> **沒有副檔名，正規表示式根本沒匹配到它。**
> ⇒ **量具自己有盲點，而它回報「0 條超出」，讀起來像乾淨。**
> ⇒ **這是「引用要寫完整檔名、不寫縮寫」的第二個理由**：縮寫**逃得過機械複驗**。

- **角色成員資格**（誰可以繼承 `payment_confirmer`）**已有斷言**（同檔約 `:363-374`，**在 408 行範圍內、已覆核**），本規格不重複。
- 本規格**沒有實作、沒有跑過**。§5 的四格負向對照**是要求，不是已完成的紀錄**。
