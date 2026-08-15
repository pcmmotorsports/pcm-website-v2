# 客戶頁三欄(訂單數 / 消費金額 / 最後下單)— slice plan

> **日期**:2026-08-16 · **執行**:A 窗(訂單線)· **來源**:Sean 08-16 逐字「客戶頁三欄你先做你覺得最完整的功能頁面」,主視窗轉派(C 窗手上是搜尋線,騰不出來)
> **片型**:**高風險片**(鐵則 12③ DDL)· **鐵則 8** 命中(動 schema)⇒ Sean 已授權本片,但**口徑與契約偏離**逐條列在下面等裁
> **參照真權威**:`supabase/migrations/20260814140000_m4b_e10_484a_order_goods_axis_view.sql` §2 的寫法契約

---

## 1. 要做什麼

後台客戶列表每一列多三欄:**訂單數 / 消費金額 / 最後下單**。
作法 = 新增聚合 view `admin_customer_list_v`,抄 `admin_order_list_v` 的形狀。
**additive:只新增一個 view,不動任何既有表、函式、索引、權限。**

## 2. 口徑(主視窗 2026-08-16 裁的那一條 + 我補的兩條)

### 2.1 消費金額 —— **主視窗裁,不是 Sean 逐條答**

```
消費金額 = 排除已取消、不扣退款
```
理由(主視窗原文):①「消費金額」在店家語境是「這個客人買了多少」
②扣退款要碰退款帳(跨線)③選最保守可解釋的那個。
⚠️ **明寫「主視窗 2026-08-16 裁、Sean 未逐條答、要改直接改」** —— 這句要進 view 的 `COMMENT`。

### 2.2 🔴 訂單數 / 最後下單 —— **沒有任何人裁過,是我選的**

> **狀態(2026-08-16 更新)**:codex 關卡1 判「最後下單」該由 Sean 裁。
> **已列進決策題送主視窗,未答之前用本節的口徑實作。**

主視窗只裁了消費金額那一條。另外兩欄的口徑**是我自己決定的**,判別如下:

| 欄 | 我選 | 為什麼 | 反方 |
|---|---|---|---|
| 訂單數 | **排除已取消** | 與消費金額同一個過濾器 ⇒ 同一列的三個數字**互相解釋得通**(10 筆 / 5 萬,不會出現 10 筆卻只有 3 筆的錢) | 「他總共下過幾次單」含取消也有意義 |
| 最後下單 | **排除已取消** | 同上 | 取消的單也是「他來過」的訊號 |

🔴 **我選一致性,理由是「三個數字擺在同一列會被讀者互相對照」** ——
不一致時員工第一反應是「系統算錯了」,而不是「口徑不同」。
⚠️ 這條**同樣要寫進 `COMMENT`、同樣標「A 窗 2026-08-16 選、無人裁、要改直接改」。**

## 3. 🔴 我要偏離 `admin_order_list_v` 契約①的一點(這是本 plan 最需要被審的地方)

`admin_order_list_v` 契約① 逐字:「`orders` 的欄位一律 **`o.*` 原樣帶出**」
(`20260814140000_…:33-34`),理由是 PostgREST 要把 view 欄位追回底表才 embed 得出來。

**但 `customers` 有兩顆刻意不給後台列表看的欄**:
```
ADMIN_CUSTOMER_LIST_SELECT === 'user_id, name, email, phone, tier, created_at'
  ⇒ SupabaseCustomerAdapter.test.ts:25 有 byte-equal 守門
  ⇒ 排除的是 wallet_balance / total_deposit(customers 建表 :21-22)
```

⇒ **`c.*` 會把 `wallet_balance` / `total_deposit` 帶進 view**。
adapter 不 select 它們不代表沒事 —— **view 一旦 GRANT 出去,那兩欄就在那個角色的可查表面上**。

**我的作法:欄位逐顆列出(那 6 顆),不用 `c.*`。**
- 契約① 的**理由**(FK 追得回底表)仍成立:逐顆列出的**純欄位引用**照樣追得回去,
  它禁的是「包表達式 / 改名 / 型別轉換」,不是「不能列名」。
- 代價 = 失去契約④ 的自動性?**不,反而更好**:`c.*` 是建 view 當下凍結的,
  逐顆列出至少讓「加欄要重建 view」變成明寫的事,不是隱藏陷阱。

🔴 **這一條請審**:如果 PostgREST 的 embed 對「明列欄位」與「`*` 展開」有實質差異,我要知道。

## 4. 契約②③ 照抄不打折

- **不得 `GROUP BY`、不得 `DISTINCT`、不得 join 到 `orders`** —— 三個新欄一律**純量子查詢**。
- 新欄只能往後加,且必須是**純量**。

形狀(草稿,以實作為準):
```sql
CREATE OR REPLACE VIEW public.admin_customer_list_v AS
SELECT
  c.user_id, c.name, c.email, c.phone, c.tier, c.created_at,
  (SELECT count(*)          FROM public.orders o
     WHERE o.customer_user_id = c.user_id AND o.cancelled_at IS NULL)          AS active_order_count,
  (SELECT coalesce(sum(o.total), 0) FROM public.orders o
     WHERE o.customer_user_id = c.user_id AND o.cancelled_at IS NULL)::bigint  AS active_spend_total,
  (SELECT max(o.created_at) FROM public.orders o
     WHERE o.customer_user_id = c.user_id AND o.cancelled_at IS NULL)          AS last_active_ordered_at
FROM public.customers c;
```

🔴 **出貨版的欄名一律帶 `active_`**(`active_order_count` / `active_spend_total` / `last_active_ordered_at`)——
codex 關卡1:「訂單數」實際是「未取消訂單數」,名字會誤導 ⇒ **讓欄名自己講口徑,不靠 COMMENT**。
🔴 **兩顆聚合欄都是 bigint,不是只有 sum**:plan 初版把 `count` 轉 `integer` 卻替 `sum` 講溢位 = 自相矛盾。

⚠️ **`active_spend_total` 用 `bigint` 不是 `integer`**:`orders.total` 是 int4,但 `sum()` 會溢位 ——
一個客人累積下單超過 21 億元就爆。**這不是理論**:`sum(int4)` 在 PG 回 `bigint` 是預設行為,
我只是把它明寫出來、不要被誰「順手」轉回 int4。

## 5. 權限

抄 `admin_order_list_v` 那支的 GRANT 形狀(**動手前逐字讀它、不憑本 plan 這句**)。
🔴 **絕不 GRANT 給 `anon`。** view 裡有 email / phone。

## 6. 驗證(不自驗;三層)

1. **拋棄式 Postgres 實跑** —— 照 `docs/runbooks/throwaway-postgres-for-migration-verification.md`。
   apply migration + 造資料 + 斷言三欄的值(含**取消單不算**那條的正反對照)。
   🔴 **實作時被 codex 關卡1 推翻成兩層,出貨版照拆法走(2026-08-16 就地更新)**:
   · **結構不變式**(view 長對了、權限收對了)→ **留在 migration 的 `DO` 區塊**,apply 到哪個庫就在哪跑。
   · **值斷言**(三欄算出來的數字對不對)→ **只在 probe**,因為它要造 fixture,
     而 migration **正式 apply 時也會跑** ⇒ 會污染正式資料。
   ⚠️ **本節初版寫「值斷言也要寫進 migration」—— 那是錯的,不要照抄。**
2. **契約自我斷言**:`DO` 區塊檢查 view 定義裡**沒有** `GROUP BY` / `DISTINCT`。
3. **codex 對抗審查**(鐵則 12③ 不降級)。

## 7. 不做的事

- **不動** `~/pcm-customers` 的 `scripts/525-verify.sh` 與 `20260816010000_*.sql`(D 窗凍結中)。
- **不 apply 到正式庫**(Sean 按)。**不 push。**
- **不接前端**(TS 側接線是另一片)—— 本片只到 view + 驗證。

## 8. 我還答不出來的

> 🔴 **本節在實作完成後就地更新過(2026-08-16)** —— 自陳缺口過期會以「誠實」的外觀活下去,
> 而方向往低報沒人會來查。下面標 ✅ 的是**已經關掉的**,不要再拿它當缺口。

- ✅ **已讀**:`admin_order_list_v` 的 GRANT 形狀(`20260814140000_…:93-94,109,144-151`)——
  `security_invoker = true`、`REVOKE ALL FROM PUBLIC`、`REVOKE ALL FROM anon, authenticated`、
  `GRANT SELECT TO service_role`。本片逐字照抄。
- 後台客戶列表頁**現在的排序**是 `created_at desc`(`SupabaseCustomerAdapter.test.ts:42`);
  三欄進來之後要不要能點欄排序 —— **本片不做,也還沒問**。
