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

```sql
-- payment_confirmer 必須仍呼得到金流 RPC，否則 sweeper / cron 會整條啞掉而斷言還是綠的
IF NOT has_function_privilege('payment_confirmer', 'public.confirm_order_payment'::regproc, 'EXECUTE') THEN
  RAISE EXCEPTION '正向對照：payment_confirmer 對 confirm_order_payment 沒有 EXECUTE ⇒ 收權收過頭了';
END IF;
```

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

## 6. 放哪、什麼時候跑

| | 建議 | 理由 |
|---|---|---|
| **放哪** | 新一支 `supabase/migrations/` 的**尾段斷言區**，與既有金流片同款（例：`20260811060000_…:306-374` 已有 ACL／成員資格斷言，形狀可直接對齊） | 與現行慣例一致，不另造機制 |
| **何時跑** | 隨 `db push` 每次 apply 都跑（**不要**做成一次性腳本） | 一次性腳本擋不住「**之後**有人寫的那句 GRANT」，而那正是威脅 |
| **不放哪** | ❌ 不要只放進 CI 的 lint／grep | **那句 `GRANT` 可以不經過 repo**（Dashboard SQL editor 直接下），grep 掃不到 |

🔴 **最後一列是這份規格的核心**：
**這個威脅的載體不是 repo，是資料庫本身** ⇒ **守衛必須也長在資料庫裡。**

---

## 7. 誠實邊界

- 本規格**只涵蓋 `public` schema**。`payment_confirmer` 對其他 schema 的授權**沒有量過**（未確認）。
- 只涵蓋**表與欄**。**函式 EXECUTE 的白名單**已由既有斷言守著
  （`20260811060000_…:517` 斷言非 owner grantee 恰為 `[payment_confirmer:EXECUTE]`），本規格不重複。
- **角色成員資格**（誰可以繼承 `payment_confirmer`）**已有斷言**（同檔 `:363-374`），本規格不重複。
- 本規格**沒有實作、沒有跑過**。§5 的四格負向對照**是要求，不是已完成的紀錄**。
