# 內嵌陣列被靜默截斷 —— plan(鐵則 8,**等 Sean 批**)

> **狀態**:未動手,零程式改動。
> **提出**:A 窗,2026-08-16。**起因是我自己在片4c 寫下的一個未驗前提。**
> **前置已完成**:`docs/specs/2026-08-16-postgrest-max-rows-embed-finding.md`(查證結果)。
> **Sean 已答 `Q-A216-F5` = 甲「有可能破千」** ⇒ **殘餘風險不成立,要修。**

---

## 1. 🔴 病根是「零訊號」,不是「上限太低」

```
PostgREST 的 db-max-rows 會套用到內嵌陣列
而內嵌被截斷時：仍回 HTTP 200、Content-Range 不反映、Preference-Applied 沒有
⇒ 【偵測不到】
```

⇒ **把上限調高解決不了任何事** —— 調多高都還是**一個沒有訊號的懸崖**,
只是把懸崖推遠。**這片的價值在於做出一個【我方自己算得出來】的截斷旗標。**

### 證據層級(照原樣帶進來,**不要在轉寫時升級**)
「`db-max-rows` 也套用到內嵌」與「206 不套用到內嵌」兩句
出自 PostgREST 官方 repo **issue #2776 的作者敘述**,**不是 maintainer 聲明、不是官方文件正文**。
⇒ **當高可信、不當定案。**
⚠️ **Sean 答「有可能破千」不改變這個層級** —— 他答的是**業務事實**,不是 PostgREST 行為。

---

## 2. 範圍 —— **先掃完再定,不是只修被指名那一處**

**掃法(全 adapters 的 SELECT 常數,逐個列內嵌;附正向對照)**:
```
grep -rn '^\(export \)\?const [A-Z_]*SELECT' packages/adapters/src --include='*.ts' | grep -v '\.test\.'
（再對每個常數的定義範圍 grep -oE '[a-z_]+\s*\(' | sort -u）
🔴 正向對照 = 6 個常數回「（無內嵌）」⇒ 尺分得出有無，不是全部都印同一句
```

| SELECT 常數 | 內嵌 | 陣列型的 | 有設上限? |
|---|---|---|---|
| `ADMIN_ORDER_DETAIL_SELECT` | 9 個 | `order_items` `order_notes` `order_item_procurement` `payment_charge_attempts` `order_cancellations` + cancellation items | ✅ **有,6 個** |
| `ADMIN_ORDER_LIST_SELECT` | 6 個 | **`order_items`** | 🔴 **無** |
| `ORDER_LIST_SELECT` | 1 個 | **`order_items`** | 🔴 **無** |
| `PRODUCT_SELECT_DETAIL_VIEW` | `product_variants_public` | **`product_variants_public`** | 🔴 **無** |
| `PRODUCT_SELECT_DETAIL_WITH_VARIANTS` | `product_variants_public` | **`product_variants_public`** | 🔴 **無** |
| `PRODUCT_SELECT_DETAIL` | brands / categories | ⚠️ **categories 未判**(見缺口) | 🔴 無 |
| 其餘 6 個常數 | (無內嵌) | — | N/A |

**數法**:`grep -c 'referencedTable' packages/adapters/src/supabase/<檔>.ts`
⇒ `SupabaseOrderAdapter` **18**、`SupabaseProductAdapter` **0**。

**陣列判別**:`REFERENCES` 指**進來**(別表 FK → 本表)= 一對多 = 陣列。
`product_variants.product_id → products` ⇒ **`product_variants_public` 是陣列**。

### 🔴 ⇒ **範圍比主視窗派工時大**
原本只知道「列表那條」。掃完是 **4 個常數、2 個 adapter**:
訂單列表 ×2(admin + storefront)+ **商品明細 ×2**。
📎 **商品那兩支完全沒有人提過** —— 它們是這次掃描才出現的。
⚠️ **一個商品有幾個變體?** 遠少於 1000 ⇒ **風險比訂單那條低很多**,但**同樣是零訊號**。

---

## 3. 影響:員工/客人會看到什麼

**訂單列表**(admin):`orderStatusView` → `orderGoodsAxis` → `goodsAxisOfLines(order.lines)`,
三條判定都是 `.every(...)` ⇒ **`order_items` 被截時,看得見的子集全出貨就答「出貨完成」。**

🔴 **這正是 Sean 北極星的反面** —— 他要的是「員工不用人教能做對」,
而**一張被靜靜截斷的訂單**是「**他做對了,但結果是錯的**」那一類:
畫面說「出貨完成」,他就不會再動作,而那張單其實還有貨沒出。

**商品明細**(storefront):變體清單少列 ⇒ 客人看不到某些尺寸/顏色 ⇒ **少賣**,而且**不會有人回報**
(客人不知道有那個變體)。

---

## 4. 修法(**兩段,不要合成一片**)

### 片一 · 收邊界(小,零型別改動)
四個常數各補 `.limit(n, { referencedTable: '…' })`
⇒ 邊界從**伺服器的 `max-rows`** 收回**我方常數**,與 `ADMIN_ORDER_DETAIL_SELECT` 一致。
⚠️ **只做這一步的話,問題從「不知道有沒有被截」變成「一定在我方常數處被截,而仍然不知道」。**
⇒ **片一不能單獨交件**,除非同時接受這個狀態並寫進註解。

### 片二 · 給旗標(**這才是價值所在,也是鐵則 8 的部分**)
`AdminOrderSummary` 與商品讀模型各加一個截斷旗標,做法沿用明細那支已驗證的形狀:
**要 N+1 筆、拿到 N+1 就代表被截**(`ORDER_ITEMS_EMBED_LIMIT` 那條的既有作法,
`packages/adapters/src/supabase/mappers/order.ts` 搜 `ORDER_ITEMS_EMBED_LIMIT`)。
⇒ **動 domain 型別 + adapter + mapper + 顯示端** ⇒ **中鐵則 8。**

### 顯示端要顯示成什麼 —— 🔴 **這題要 Sean 拍,不是技術選擇**
```
甲  比照明細那條：整格印「未知」+ 一行說明
乙  列表那格照印，但加一個視覺標記（例如狀態膠囊旁一個 ⚠）
丙  不顯示，只在後台記 log
```
⚠️ **丙等於「知道了但不告訴員工」** —— 與本 repo 反覆記過的
「不知道 ≠ 是 0」「畫在畫面上就是最終答案」牴觸,**我不建議,但列出來讓他選。**

---

## 5. Rollback

片一 = 純查詢參數,`git revert` 即可。
片二 = 動 domain 型別 ⇒ revert 要連 mapper 與顯示端一起,**單一 commit 內完成才 revert 得乾淨**。

## 6. 我需要的批准

1. **鐵則 8 批准**(片二動 3+ 檔與 domain 型別)。
2. **顯示端甲/乙/丙**(§4 那三個選項)。
3. **片一片二要不要分開交件** —— 我建議**綁同一片**,理由見 §4 的 ⚠️。

## 7. 誠實缺口

- **我沒有實測任何一支查詢被截斷的行為** —— 全部建立在 §1 那個「高可信但非定案」的證據上。
  🔴 **實測方法我想得到但做不到**:要一張品項破千的單,而我沒有能寫正式庫的環境。
  ⇒ **若有窗有那個環境,先實測再動 code,會讓這整片的地基硬一級。**
- **`PRODUCT_SELECT_DETAIL` 的 `categories` 我沒判出是不是陣列** ——
  沒找到 `product_categories` 關聯表(`grep -loE 'CREATE TABLE (public\.)?product_categories'` 零命中),
  ⇒ **可能是我表名猜錯,不是它不存在。** 開工前要查清楚,否則範圍會漏一個。
- **`max-rows = 1000` 是 repo 內記載的「production 實測」,我沒有重量。**
- **我沒有查 storefront 的 `ORDER_LIST_SELECT` 下游怎麼用 `order_items`** ——
  只確認它沒設上限。它被截會影響什麼,未查。
