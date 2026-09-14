# plan · #953 同一條金額等式住在多個地方 ⇒ 收斂成一處 —— 2026-09-14

> backlog `#953`(`docs/phase-1-backlog.md:35790`)。主視窗 2026-09-14 派:「五個地方各在哪、收斂到哪、每個呼叫端怎麼改、影響哪些畫面與 RPC、rollback、分片」。
> 碰錢 + schema(CHECK)+ 共用元件(`packages/domain`)⇒ 鐵則 8,**本 plan 先寫,不動碼**。
> 🔴 前提照 `#957` 實測:等式對不上時 DB 是**`check_violation` 整筆回捲、吵著炸**,不是靜靜算錯。本 plan 的每一步都以「炸」為守門,不以「數字對」為守門。
> 版本號:`20260915030000`(2026-09-14 `scripts/migration-version-free.sh` 掃 116 ref / 8 worktree 為空;**開工那一刻要再掃一次**,今天 `…110000` 已被施工窗佔走)。

---

## 0. 一句話

現在 `total` 的等式(`subtotal + shipping_fee − discount_total + tax_total`)在 repo 裡**有 9 份會跑的拷貝**(SQL 4 + TS 5),其中 **TS 有 3 份還是舊式(沒有稅)**。
收斂成:**DB 一支 IMMUTABLE 函式 `pcm_order_total()`,CHECK 與三支寫 `total` 的 RPC 都呼叫它;TS 一支 `orderTotal()`,五個 TS 落點都呼叫它。** 兩邊各有一發「把稅拿掉 ⇒ 必須紅」的突變測試。

---

## 1. 現況:等式每一份住在哪(2026-09-14 逐檔讀出來的;只列**會執行**的,註解裡的不算)

### 1-a SQL(正式庫上跑的那一代)

| # | 物件 | 檔案:行號 | 逐字 | 有稅? |
|---|---|---|---|---|
| S1 | `orders_total_balances` CHECK | `supabase/migrations/20260828100000_m4b_b1_orders_tax_and_invoice_requested.sql:281` | `CHECK (total = subtotal + shipping_fee - discount_total + tax_total)` | ✅ |
| S2 | `create_order`(11 參,顧客站結帳) | `supabase/migrations/20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql:552` | `v_total := v_subtotal + v_shipping_fee - v_discount_total + v_tax;` | ✅ |
| S2′ | `create_order`(10 參 legacy) | 同檔 `:1053` | 同一句 | ✅(`20260913090000` 會 DROP 它,「貼 154」還沒貼 ⇒ 今天正式庫還在) |
| S3 | `admin_create_manual_order`(第 9 代) | `supabase/migrations/20260914030000_m4b_manual_order_tier_override.sql:601` | `v_total := v_subtotal + p_shipping_fee + v_tax;`(手動單沒有折扣 ⇒ 少一項,而 `discount_total` 落 DEFAULT 0) | ✅ |
| S4 | `admin_update_order_item_amount`(第 4 代) | `supabase/migrations/20260909080000_m4b_a1_audit_active_attempt_on_price_change.sql:260` | `v_total := v_subtotal + v_ord.shipping_fee::bigint - v_ord.discount_total::bigint;` | ❌ **沒有稅** —— 靠同函式 `:248-254` 的 `pcm_e13_no_edit_when_taxed` 閘把有稅的單整個擋掉才沒炸 |

`SET total =` / `INSERT INTO orders` 全掃過:寫 `orders.total` 的只有 S2 / S2′ / S3 / S4 這四支,沒有 trigger 在重算 `total`。

### 1-b TS(`packages/` 與 `apps/`)

| # | 落點 | 檔案:行號 | 逐字 | 有稅? | 今天有人呼叫嗎 |
|---|---|---|---|---|---|
| T1 | `createOrder()` factory | `packages/domain/src/order/order.ts:275` | `subtotalAmount + shippingFee.amount - discountTotal.amount` | ❌ | 沒有(只在 `packages/domain/src/index.ts` 匯出;`packages/ports/src/IOrderRepository.ts:44` 註明 `save(order)` 已廢) |
| T2 | `assertOrderInvariant()` | `packages/domain/src/order/order.ts:341` | `order.subtotal.amount + order.shippingFee.amount - order.discountTotal.amount` | ❌ | 沒有(`IOrderRepository.ts:32` 把它寫成讀取合約,而沒有 adapter 真的呼叫) |
| T3 | `computeTax()` 回傳的 `total` | `packages/domain/src/order/tax.ts:83` | `total: taxableBase + tax`(taxableBase = 未稅小計 + 運費) | ✅ | `apps/storefront/src/components/CheckoutView.tsx:443` ⇒ `payableTotal`(摘要 / 付款鈕 / 手機底部條) |
| T4 | 信件金額自檢 | `packages/use-cases/src/order-email-copy.ts:156` | `ctx.subtotal + ctx.shippingFee - ctx.discountTotal + ctx.taxTotal === ctx.total` | ✅ | 付款成功信 / 出貨信的明細段(對不上 ⇒ 不列明細) |
| T5 | 手動單試算 | `apps/admin/src/lib/orders/manual-order-form.ts:420` | `total: subtotal + shippingFee + tax` | ✅ | 後台建手動單的「總額預覽」(`manual-order-total-preview.tsx`) |

🔴 **T1 / T2 就是 #953 說的「第五份、會丟例外的那一份」,而它們今天仍然是舊式。** `Order` type(`packages/domain/src/order/types.ts:143-160`)**根本沒有 `taxTotal` 欄位** ⇒ 誰哪天把 `assertOrderInvariant` 接上 adapter,每一張有稅的單都會 `total_mismatch` throw。`Order` type 的使用者只有 `order.ts` 與 `state-machine.ts` 兩檔(grep 過 `packages/` `apps/`)⇒ 加欄位是**局部**的。

### 1-c 同族但**不收**(寫清楚為什麼,免得下一個人以為漏了)

| 落點 | 為什麼不收 |
|---|---|
| `pcm_order_effective_amounts_v.effective_total`(`20260909100000:128-133`)= `effective_subtotal + effective_shipping_fee` | 那是**取消部分品項之後**的「剩餘應收」,刻意不含券、不含稅(Sean 09-10 甲:算不出來回 NULL)。它答的不是 `orders.total`,是另一個名詞。 |
| `pcm_order_remaining_receivable()`(`20260914070000:82`)`subtotal + shipping_fee - discount_total` | 那是**稅基**(等式的前三項),用來驗「儲存的 `tax_total` 能不能被 web 那一句重現」。稅基是稅的輸入,不是 total 的定義。 |
| `apps/storefront/src/hooks/useResolvedCart.tsx:202` `subtotal + shipping` | 購物車階段,還沒有券、沒有付款方式 ⇒ 算不出稅;它是「目前小計」不是 `orders.total`。 |
| 稅**怎麼算**(`round(稅基 × 0.05)`、web 一句 / 手動單殘差)| **不是本條**。本條只收「四個數加起來要等於 total」這一句;稅率規則另有 `computeTax` / `MANUAL_ORDER_VAT_RATE` / 兩支 RPC 各自的 `v_tax :=`,那是 `⟦b4-*⟧` 那一族。 |

---

## 2. 收斂到哪:**DB 一支函式,TS 一支函式**(方向甲;乙、丙為什麼不選在 §2-c)

### 2-a DB:`public.pcm_order_total(subtotal int, shipping_fee int, discount_total int, tax_total int) RETURNS bigint`

```sql
CREATE FUNCTION public.pcm_order_total(
  p_subtotal integer, p_shipping_fee integer, p_discount_total integer, p_tax_total integer)
RETURNS bigint
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$ SELECT p_subtotal::bigint + p_shipping_fee - p_discount_total + p_tax_total $$;
REVOKE ALL ON FUNCTION public.pcm_order_total(integer,integer,integer,integer) FROM PUBLIC;
-- authenticated / service_role / anon 都不需要直接呼叫;CHECK 與 SECURITY DEFINER 的 RPC 以 owner 身分跑 ⇒ 不用 GRANT。
```

形狀逐字抄 repo 唯一前例 `m3_jsonb_values_all_string`(`20260604120000:73-87`:`LANGUAGE sql IMMUTABLE SET search_path = ''`,CHECK 裡呼叫)—— **不自己發明**。
- 回 `bigint`:三支 RPC 今天都用 `bigint` 中間值再自己驗 `> 2147483647` 才 `::integer` ⇒ 函式回 bigint,溢位閘留在各 RPC 原位不動。
- `STRICT`:四欄都 `NOT NULL`(`20260604120000:101-104`、`20260828100000:174`)⇒ 永遠不會餵 NULL;寫 STRICT 只是讓「有人餵 NULL」時回 NULL 而 CHECK 當真通過 —— ⚠️ **這一格要在 pgTAP 裡釘死**:`total IS NULL` 的列**本來就被 `total integer NOT NULL` 擋掉**,所以 STRICT 不會開洞。（不寫 STRICT 也行;寫的理由是 planner 常數摺疊。Sean 不用管這格,實作時 codex 會再看。）

CHECK 換成:
```sql
ALTER TABLE public.orders DROP CONSTRAINT orders_total_balances;
ALTER TABLE public.orders ADD CONSTRAINT orders_total_balances
  CHECK (total = public.pcm_order_total(subtotal, shipping_fee, discount_total, tax_total));
```
🔴 這一步**全表驗證會鎖 `orders`**(與 `20260828100000:276-281` 同一件事,當時做過一次)。等式一字不變 ⇒ 既有列全數通過(B1 當時證過:四欄 integer NOT NULL、舊 CHECK 建表就 validated)。
⚠️ **`DROP FUNCTION pcm_order_total` 會被 CHECK 擋住**(依賴)—— 這是**要的**:等式那一份被刪 ⇒ 資料庫拒絕,不會靜靜消失(對照 `20260828100000:468` 記的「先刪 `tax_total` ⇒ CHECK 連帶被靜靜刪掉」那個反方向的坑)。

### 2-b TS:`packages/domain/src/order/total.ts`

```ts
export function orderTotal(p: { subtotal: number; shippingFee: number; discountTotal: number; taxTotal: number }): number {
  return p.subtotal + p.shippingFee - p.discountTotal + p.taxTotal;
}
```
與 SQL 那一句**逐字同序**,並在檔頭註明「SQL 真相 = `pcm_order_total`,改一邊必改另一邊」+ 一支 parity 測試把兩邊字串比一次(形狀照既有 `notification-fallback-sql-parity.test.ts`)。

### 2-c 為什麼是甲,不是乙 / 丙

- **乙(行為守門:建有稅單 ⇒ 改品項 ⇒ 斷言 total 沒變小)**:今天 S4 根本不讓有稅的單改金額(`pcm_e13_no_edit_when_taxed`)⇒ 這個測試**今天走不到要驗的那一行**。等 S4 真的支援有稅改價那一片,乙自然會以 pgTAP 形式出現,而它會呼叫甲的函式。
- **丙(原始碼掃描守門)**:CLAUDE.md 2026-09-09 起「不加 `scripts/` 量測腳本」。而且丙抓的是字面(`v_total :=`),抓不到有人用別的變數名寫第五份;甲讓「寫第五份」這件事本身變得**比呼叫函式還費事**,才是根治。
- 甲的**天花板(誠實寫)**:它收斂的是「四個數怎麼加」,**不收斂「稅怎麼算」**。稅率規則仍住在 S2 / S3 / `computeTax` / `manual-order-form.ts` 四處 —— 那是另一條 backlog,本 plan 不擴張。

---

## 3. 每個呼叫端怎麼改

| # | 改法 | 行為變不變 |
|---|---|---|
| S1 CHECK | `DROP CONSTRAINT` + `ADD CONSTRAINT`(§2-a)| **不變**(同一等式)。全表驗證一次。 |
| S2 `create_order` 11 參 | `:552` 改 `v_total := public.pcm_order_total(v_subtotal::integer, v_shipping_fee::integer, v_discount_total::integer, v_tax::integer);` —— 🔴 四個中間值今天是 `bigint`,轉 `::integer` 之前**先做溢位閘**(`:553-558` 那兩道要搬到這一行**上面**,不然 `v_tax > 2147483647` 會在轉型那一刻先 `numeric_value_out_of_range` 炸、訊息不是我們寫的那句)。用 `CREATE OR REPLACE`,整支從 `20260907040000:145` 抄(它是 live,`latest-definition-of.sh` 印 `live = 20260907040000`);簽章不動。 | 不變 |
| S2′ `create_order` 10 參 | **不改**。它在 `20260913090000`(「貼 154」)要 DROP;本 plan 的 migration **版本號在它之後**,而 154 還沒貼 ⇒ 兩種順序都要能過:154 先貼 ⇒ 10 參已不在,本支不碰它 ✅;本支先貼 ⇒ 10 參還在、仍是舊寫法、仍受新 CHECK 保護 ✅。**一律不碰它就沒有順序問題。** | 不變 |
| S3 `admin_create_manual_order` | `:601` 改 `v_total := public.pcm_order_total(v_subtotal::integer, p_shipping_fee, 0, v_tax::integer);` —— `0` 那一格**就是把「手動單沒有折扣」這個事實寫成明文**(今天靠 DEFAULT 0 暗合)。同上,溢位閘 `:603-605` 搬到上面。從 `20260914030000:83` 抄(live = newest)。 | 不變 |
| S4 `admin_update_order_item_amount` | `:260` 改 `v_total := public.pcm_order_total(v_subtotal::integer, v_ord.shipping_fee, v_ord.discount_total, v_ord.tax_total);` —— 🔴 **多帶第四項 `v_ord.tax_total`**。今天有稅的單被 `:248-254` 那道閘擋住 ⇒ `tax_total` 恆為 0 ⇒ 行為不變;**而閘哪天拿掉,這一行不用再改**(這正是 #953 說「B2 的地雷」那一格,先把地雷拆了,閘留著)。⚠️ **不動那道閘** —— 拆閘 = 支援有稅改價 = 要重算稅,另一片。`v_subtotal > 2147483647` 閘 `:266-270` 搬到上面。從 `20260909080000:122` 抄。 | 不變 |
| T1 / T2 `order.ts` | `Order` type 加 `taxTotal: Money`(`types.ts:143`);`createOrder()` 多收 `taxTotal`(預設 `{amount:0,currency}` 讓既有測試不改語意);`:275` 與 `:341` 改呼叫 `orderTotal()`;`errors.ts:20` 與 `types.ts:134,159` 三處註解跟著改成四項。`state-machine.ts` 只是 spread,不用改。 | **變**:有稅的 `Order` 今天會 throw,改完不會 —— 而今天沒有呼叫端,零畫面影響 |
| T3 `tax.ts:83` | `total: orderTotal({ subtotal: input.subtotalUntaxed, shippingFee: input.shippingUntaxed, discountTotal: 0, taxTotal: tax })`。⚠️ `taxableBase` 夾 0 以上那一格(`:66`)不動。 | 不變(`tax.test.ts` 釘著) |
| T4 `order-email-copy.ts:156` | `return orderTotal(ctx) === ctx.total;`(`ctx` 已有四欄同名)| 不變 |
| T5 `manual-order-form.ts:420` | `total: orderTotal({ subtotal, shippingFee, discountTotal: 0, taxTotal: tax })` | 不變(`manual-order-form.test.ts` 釘著)|

**影響哪些畫面與 RPC(全列)**:
- RPC:`create_order`(11 參)、`admin_create_manual_order`、`admin_update_order_item_amount` —— 各 `CREATE OR REPLACE` 一次,**簽章、ACL、SECURITY DEFINER、search_path 全部不動**;COMMENT 尾巴加一句「total 由 pcm_order_total 算」。
- 畫面:顧客站結帳應付金額(T3)、後台手動單總額預覽(T5)、付款/出貨信明細段(T4)—— **數字一個都不該變**;驗法 = 各自既有測試綠 + Sean 走一張含稅單(刷卡經銷)與一張手動勾發票的單看數字。
- `packages/adapters/src/supabase/database.types.ts`:新函式要不要進 types —— **不用**,沒有 TS 端呼叫它。

---

## 4. 分片(每片獨立三綠、獨立可 commit)

| 片 | 做什麼 | 估 | 三綠 / 測試 |
|---|---|---|---|
| **P1 · DB 函式 + CHECK + pgTAP** | 寫 `supabase/migrations/20260915030000_m4b_953_pcm_order_total_single_source.sql`:①建函式 ②換 CHECK ③前置閘(現行 CHECK 定義字串必含 `tax_total`、`pcm_order_total` 尚不存在;正/負對照各一)④事後閘(`pg_get_constraintdef` 必含 `pcm_order_total(`)。寫 `supabase/tests/database/pcm_order_total.test.sql`(pgTAP):函式存在 / IMMUTABLE / 四組值 / **突變格**:`INSERT orders` 一列 `total = subtotal+shipping−discount`(少稅、tax_total=50)⇒ `throws_ok … 23514`。寫 `supabase/rollbacks/20260915030000-rollback.sql`(§5)。**寫好不貼。** | 40 分 | 只動 .sql ⇒ 免三綠;拋棄式 PG(`docs/runbooks/throwaway-postgres-for-migration-verification.md`)依序套 → 跑 pgTAP 綠 → 手動把函式體的 `+ p_tax_total` 拿掉再跑 ⇒ 突變格**必須紅**(截圖進 commit body)|
| **P2 · 三支 RPC 改呼叫** | 同一支 migration 檔(P1 之後、同一交易)追加 S2 / S3 / S4 三個 `CREATE OR REPLACE`,溢位閘位置照 §3。每支尾端加事後閘:`pg_get_functiondef` 必含 `pcm_order_total(`,且**不含**舊字面 `v_shipping_fee - v_discount_total`(S2)/ `p_shipping_fee + v_tax` (S3)/ `v_ord.shipping_fee::bigint` (S4)。 | 45 分 | 拋棄式 PG 套完:建一張 web 含稅單、一張手動勾發票單、一張改品項金額的無稅單 ⇒ 三張 `total` 與套用前**逐位元相同**(套用前的三個數存暫存表比,不用眼睛)。**codex 唯讀審**(鐵則 12:錢 + schema)。 |
| **P3 · TS `orderTotal()` + T1-T5** | 新增 `total.ts` + `total.test.ts`(含 parity:讀 P1 那支 migration 檔的函式體字串,與 TS 函式體比);改 `types.ts` / `order.ts` / `tax.ts` / `order-email-copy.ts` / `manual-order-form.ts`;`order.test.ts` 加一格「有稅 Order 不 throw」+「total 少稅 ⇒ throw total_mismatch」。 | 45 分 | `TURBO_FORCE=1 pnpm typecheck && lint && build`;跑 `packages/domain` `packages/use-cases` `apps/admin/src/lib/orders/manual-order-form.test.ts` 那幾支。**這片碰 `packages/domain` 共用型別 ⇒ codex 也審一輪**(可與 P2 同一輪)。 |
| **P4 · 貼板 + 記帳** | Sean 貼 `20260915030000`(或常設授權那一次由主視窗代貼)⇒ `APPLIED.tsv` 記帳 ⇒ `pcm_acl_approve_latest`(0914 拍甲,理由寫版本號)⇒ Sean 開瀏覽器走三張單。 | 15 分 | `bash scripts/is-migration-applied.sh 20260915030000` |

P1 → P2 同一檔、可分兩顆 commit;P3 與 P1/P2 **互不相依**(TS 不呼叫 DB 函式)⇒ P3 可以先合、先上,DB 那半等貼板。
🔴 **P3 先上、P1/P2 還沒貼的那段時間**:TS 與 DB 的等式仍然是同一句(只是 DB 那句還寫在 CHECK 裡)⇒ 沒有窗口期問題。

---

## 5. Rollback

`supabase/rollbacks/20260915030000-rollback.sql`(檔名照 `supabase/rollbacks/README.md`):
```sql
BEGIN;
-- ① 三支 RPC 回上一代:逐字貼回 20260907040000:145-…(create_order 11 參)、
--    20260914030000:83-…(admin_create_manual_order)、20260909080000:122-…(admin_update_order_item_amount)
--    🔴 用 CREATE OR REPLACE 貼「整支」,不是只改那一行 —— CREATE OR REPLACE 會把 SET 子句整組換掉
--    (memory reference_create-or-replace-resets-set-clause)⇒ 從原檔整段抄。
-- ② CHECK 換回字面等式(= 20260828100000:278-281 逐字)
ALTER TABLE public.orders DROP CONSTRAINT orders_total_balances;
ALTER TABLE public.orders ADD CONSTRAINT orders_total_balances
  CHECK (total = subtotal + shipping_fee - discount_total + tax_total);
-- ③ 依賴解開之後才刪得掉函式(順序反過來會被 ② 之前的 CHECK 擋住 —— 那是設計,不是 bug)
DROP FUNCTION public.pcm_order_total(integer,integer,integer,integer);
COMMIT;
```
- 回退**不動任何一列資料**(等式沒變 ⇒ 沒有一張單的 `total` 需要改)。
- 回退再做一次全表驗證(鎖 `orders` 一次,與正向同量級)。
- TS 那半(P3)回退 = `git revert` 那顆 commit;與 DB 那半**互不相依**,可各自退。
- 拋棄式 PG 走一次「套用 → 回退 → 再套用」三段(照 `scripts/rollback-drill.sh` 既有形狀)進 P1 的驗收。

---

## 6. 驗收(yes/no)

| 派工單要的 | 答 |
|---|---|
| (1) 五處全列齊有行號 | yes —— §1 列 **9** 處(SQL S1-S4 含 S2′、TS T1-T5),外加 §1-c 四處「同族不收」各附理由 |
| (2) 有 rollback | yes —— §5,檔名照 README,順序 RPC → CHECK → 函式 |
| (3) 分片每片可獨立三綠 | yes —— P1/P2 只動 .sql(免三綠,拋棄式 PG + pgTAP);P3 純 TS 三綠;P3 與 P1/P2 無相依 |

**做完的定義**:`grep -rn 'shipping_fee - .*discount_total\|shippingFee.*discountTotal' supabase/migrations apps packages` 裡**會執行的**只剩 `pcm_order_total` 函式體與 `total.ts` 兩行(其餘全是註解或 §1-c 那四處);把任一邊的 `+ tax` 拿掉 ⇒ pgTAP 或 vitest 至少一格紅。

---

## 7. 要 Sean 拍的(只有一題,不答就照推薦做)

```
Q1:S4(後台改品項金額)那道「有稅的單不給改」的閘,這次要不要一起拆?
A:甲 不拆,只把算式改成會帶稅(推薦 —— 拆閘 = 要重算稅 = 另一片、另一輪審)
   乙 一起拆(要多寫「改完重算稅」那段,而手動單的稅有逐列殘差、今天存不下來 ⇒ 會卡在 20260914070000 那個「算不出來」的同一堵牆)
```
