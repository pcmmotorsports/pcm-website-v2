# Plan · 後台看得出「原廠已無此品」 —— Q4 甲(只顯示,不自動下架)

> Sean 2026-09-17 早上拍 **甲**:要,而且**只顯示、不自動下架**。
> 🔴 鐵則 8:本片碰 schema ⇒ **先 plan、等 Sean 批,不動碼。**
> 作者:後台窗 `pcm-website-v2-89` · worktree `/Users/sean_1/pcm-ops` · branch `agent/ops-17`

---

## 0. 🔴 先查它還活不活著 —— 而查完發現**大半已經做好了**

| 查什麼 | 答案 | 出處(可重跑) |
|---|---|---|
| 後台有沒有地方**已經**在顯示這件事 | 🟢 **有,兩處** | `components/products/product-detail.tsx:121` · `components/products/products-table.tsx:99`,兩處都印「**原廠已無此品**」 |
| 靠哪個欄位 | `products.source_missing_at` | `lib/products/product-repository.ts:143-144` `isSourceMissing()` |
| 欄位存在嗎 | 🟢 **在**,2026-08-15 就建了 | `supabase/migrations/20260815030000_m4b_20_products_listing_set_by_source_missing.sql` |
| 有人在**寫**它嗎 | 🟢 **有** | `scripts/rpm-reconcile.ts:193` `.update({ source_missing_at: now })` |
| 正式庫真的有值嗎 | 🟢 **3 筆 / 26,491** | 見下面那一發 |

```bash
cd /Users/sean_1/pcm-ops
printf '%s\n' "SELECT count(*) AS 全站, count(*) FILTER (WHERE source_missing_at IS NOT NULL) AS 有標來源消失, count(*) FILTER (WHERE delisted_at IS NOT NULL) AS 已下架 FROM public.products;" > /tmp/q4.sql
bash scripts/readonly-prod-sql.sh /tmp/q4.sql
```
```
 全站  | 有標來源消失 | 已下架
-------+--------------+--------
 26491 |            3 |   1089
```
🔵 **3 不是 0** ⇒ 那條路**是活的**,不是裝好沒接線。

### 🛑 所以「做一個新功能」是錯的題目 —— 真正缺的只有一格

```
供應商說「我這裡沒有這件了」有兩種講法, 而我方只接住了一種:

  甲  整列從報價單 view 消失      ⇒ rpm-reconcile.ts:193 寫 source_missing_at  ⇒ 🟢 後台看得到(3 筆)
  乙  列還在, 但報價單把它標 delisted_at ⇒ 🔴 rpm-transform.ts:304 【刻意丟掉】 ⇒ 沒有任何欄位接住
```

`scripts/rpm-transform.ts:304-310` 逐字:
> 「🔴 2026-08-15 `#20` 片2b:**`delisted_at` 已從本型別移除,同步管線不再輸出這個 key**…
>  🔴 **不要把這一欄加回來** —— 加回來等於把下架權威還給來源,直接推翻本片與 Sean 的拍板。」

⇒ **丟掉是對的,而且是拍板。本 plan 不動它。**
⇒ 🔴 **但它被丟掉之後沒有落在別的地方** ⇒ **乙那一種,後台完全看不見。**

### 影響面(前台窗 09-17 實測,`進度-前台窗-0917.md` §1)
| | 群數 |
|---|---:|
| 報價單側已標 `delisted_at` | **263** |
| ├ 顧客站也下架了 | 80 |
| └ 顧客站還掛著 | **183** |
| 　　其中 `in-stock`(**客人現在就買得到**) | **102** |

⚠️ **推論,未核**:183 群對應**幾件商品**我沒量(群 ≠ 件)。實作前要量,`影響` 那格才寫得出真數。

---

## 1. 要改什麼

### 1-1 · schema:`products` 加一欄
```sql
ALTER TABLE public.products ADD COLUMN source_delisted_at timestamptz;
```
- **不是** `boolean` —— 跟 `source_missing_at` 一致用時間戳,且來源取消標記時要能清回 `NULL`。
- **不加 NOT NULL、不加 DEFAULT** ⇒ 純新增欄位,對既有列零影響、不鎖表重寫。

### 1-2 · 🔴 COLUMN COMMENT —— **照 `20260815030000` 既有的寫法,不自己發明句子**
```sql
COMMENT ON COLUMN public.products.source_delisted_at IS
  '來源(報價單 view)把這筆標成已下架的時間;來源取消標記時清回 NULL。'
  '⚠️ 這一欄只描述「來源端有沒有把它標掉」,**不代表能不能賣** —— 員工可能有現貨仍要繼續賣'
  '(Sean 2026-08-15 逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」)。'
  '⚠️ 因此本欄**不得**被接到任何自動下架 / 自動隱藏邏輯上,那會推翻 #20 片2 整片的目的。'
  '🔴 與 `source_missing_at` 是**兩個不同的訊號**:那一欄是「整列從來源消失」,本欄是「列還在但被標掉」。'
  '畫面文案**不得**寫成「已停產」(會讓員工以為不能賣)。'
  '本欄為顯示用、**不承載正確性**,不要拿它當任何守門條件。';
```
🛑 **「不得接到自動下架 / 自動隱藏」那一句是逐字抄 `20260815030000:75` 的**,不是我改寫的。

### 1-3 · 同步那條路在哪一步把訊號留下來
🔴 **不改 `rpm-transform.ts:304` 丟掉 `delisted_at` 的行為**(那是拍板)。
改在**對賬那一支**,與既有的「來源消失」並排 —— 同一個檔、同一個形狀、同一批寫入:

| | 既有 | 本片新增 |
|---|---|---|
| 判準 | target 現存未下架商品**不在**本次 source external_id 集合 | source 那一列**存在**且 `delisted_at IS NOT NULL` |
| 寫 | `scripts/rpm-reconcile.ts:193` `source_missing_at = now` | `source_delisted_at = now` |
| 清 | `:221` `source_missing_at = null` | 來源取消標記 ⇒ 清回 `null` |

🔵 **為什麼放這裡而不是 transform**:transform 的合約是「**不輸出這個 key**」(`:306`),
在那裡動就會碰到那條拍板;reconcile 的合約本來就是「**比對來源與我方,把差異標在我方欄位上**」
⇒ **同一個形狀再做一次,不是新機制。**

### 1-4 · 🎯 員工在哪裡看到它 —— **沒有這一格,做完等於沒做**
**不新增畫面,掛在已經在講同一件事的那兩處**:

| 位置 | 現在 | 改後 |
|---|---|---|
| `components/products/product-detail.tsx:117-121` | `原廠已無此品` / `原廠仍有` 二選一 | 三態:`原廠已無此品`(來源消失)/ **`原廠已標下架`**(本片)/ `原廠仍有` |
| `components/products/products-table.tsx:95-99` | 命中才印一行小字 | 同上,兩種訊號印不同字 |

🔴 **兩個訊號要印不同的字,不可以合併成一句** —— 它們是不同的事實
(「來源整列不見了」vs「來源還在,只是標掉了」),合併會讓員工分不出哪一種,
而**那正是 `source_missing_at` 的 COMMENT 在防的事**。

⚠️ **建單流程(`orders/…`)本片不碰。** 理由:那條路現在完全沒有讀 `source_missing_at`,
本片若順手掛上去,等於**在建單那一步新增一個會影響員工決策的訊號** ⇒ 超出「只顯示」的範圍。
🙋 **要不要在建單也顯示 ⇒ 留給 Sean 決定,本 plan 不預設。**

### 1-5 · 🔴 成本遮罩:**這一欄不落進「老闆才看得到」那一類**
`app/settings/audit/page.tsx:72` 的遮罩只掛 `COST_AUDIT_ACTION = 'orders.item.costs.set'`,
而本欄是**商品頁 / 商品列表**,**不經過稽核頁那條路** ⇒ 遮罩射程碰不到它。
**而那是對的**:「原廠還有沒有這件」**不是成本資訊**,員工要看得到才做得了事。
📌 **在這裡答掉,不留到實作**(主視窗 09-17 明示)。

---

## 2. 影響

| | |
|---|---|
| 客人 | **零**。前台不讀這一欄,本片不碰 storefront |
| 員工 | 商品頁 / 商品列表多一種狀態字;**沒有任何按鈕行為改變** |
| 自動化 | **零**。不接下架、不接隱藏、不接守門(COMMENT 寫死) |
| 既有資料 | 新欄位全 NULL,**apply 當下畫面一個字不變** —— 要等對賬跑過才開始有值 |

---

## 3. Rollback

`supabase/rollbacks/<版本>-rollback.sql`:
```sql
ALTER TABLE public.products DROP COLUMN IF EXISTS source_delisted_at;
```
- **可逆、無資料損失風險**:該欄只有顯示用途,不承載正確性,沒有別的物件依賴它。
- 🔴 **碼要先退**:欄位被 DROP 而 `product-repository.ts:392` 的 select 清單還列著它 ⇒ 整個商品列表 500。
  ⇒ **還原順序 = 先退碼、再跑還原檔**(與貼板時的順序相反)。
- ⚠️ **絕不對正式庫跑還原檔**;演練走拋棄式 PG(`scripts/rollback-drill.sh`)。

---

## 4. 🛑 這個 plan 沒有回答的(要 Sean 或要先量)

```
Q1:建單的時候要不要也看得到「原廠已無此品 / 已標下架」?
A: 甲 = 不要, 只在商品頁與商品列表(推薦 —— 本片範圍是「只顯示」, 建單那一步加訊號會影響下單決策)
   乙 = 要, 建單挑品時也顯示

Q2:那 183 群裡「顧客站還掛著而且 in-stock」的 102 群, 要不要在後台【另外列一張清單】給員工看?
A: 甲 = 不要, 就靠商品頁那個字(推薦 —— 不新增畫面, 也不新增一條要維護的路)
   乙 = 要, 另開一頁
```
⚠️ **未量**:183 群 = 幾件商品。實作前要量,`影響` 那格才寫得出真數。

---

## 5. 驗收(yes / no)

1. 貼板後立刻查:`source_delisted_at` 全表 NULL、畫面一個字沒變 ⇒ **yes**
2. 對賬跑過後:有值的件數 > 0,且**與 `source_missing_at` 的件數不相等**(兩個訊號分得開)⇒ **yes**
3. 🔴 **反向**:拿一件 `source_delisted_at` 有值的商品,確認它**仍然是上架、仍然買得到** ⇒ **yes**
   (這一格在驗「沒有接到自動下架」—— **不驗這格,就沒有人證明過那句 COMMENT**)
4. 商品頁三態各截一張,**三種字不一樣** ⇒ **yes**
