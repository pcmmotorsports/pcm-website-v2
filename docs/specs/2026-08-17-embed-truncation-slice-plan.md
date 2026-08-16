# 靜默截斷:讓它不會發生 —— plan(鐵則 8,**等 Sean 批才動手**)

> **狀態**:未動手,零程式改動。
> **提出**:A 窗,2026-08-17。worktree `/Users/sean_1/pcm-bmw-m`,分支 `bmw-m-headline`。
> **上游**:`docs/specs/2026-08-16-embed-truncation-plan.md`(前一任 A 窗 plan + 我 `a633b7b6` 補的 production 實測)。
>
> 🔴 **驗收標準(Sean 逐字,經主視窗轉)**:
> 「我們立場不是【如果東西壞了,那我要提醒 Sean 什麼、寫什麼字給員工看】,
> 而是【**這樣的狀況不應該讓他發生;如果會發生,那我們現在應該怎麼解決問題讓他不要發生**】。」
> ⇒ **不是「被截時有沒有訊號」,是「不會被截」。**

---

## 0. 結論先講 —— **四個面,兩個證明不會發生、兩個現在正在發生**

| 面 | 狀態 | 依據 |
|---|---|---|
| 商品變體內嵌 ×2 常數 | ✅ **不會發生** | 每商品最大變體數 **29** vs 上限 1000 ⇒ 34 倍餘裕 |
| `brands → products_public` 內嵌 | ✅ **問題不存在** | 前台沒在用;repo 內 0 命中(正向對照 8 / 分母 653 檔) |
| `listByBrand`(推薦 Case B) | 🔴 **正在發生** | 某品牌 **4,566** 商品 ⇒ 實得 **1,000** |
| **`queryProductsByFitment`**(推薦 Case A) | 🔴 **正在發生,且在主線車型上** | **BMW S 1000 RR** 有 **1,423** 列 fitment ⇒ 實得 **1,000** |

🔴 **這張表本身就是最重要的發現**:
**我們花了兩輪找「內嵌會不會被截」,而真正在被截的兩支都是【頂層】查詢。**
⇒ **逐支補上限,補不到你沒想到的那一支。**

---

## 1. 兩個「不會發生」—— **是證明過的,不是放棄**

### 1-a `brands → products_public` 內嵌:前台沒在用

```
目標 pattern  grep -rn 'products_public(' packages/ apps/ --include='*.ts' --include='*.tsx' \
              | grep -v '\.test\.' | grep -v 'product_variants_public('        ⇒ 0
正向對照      同一支 grep 換成 'product_variants_public('                      ⇒ 8   ← 尺抓得到內嵌寫法
分母          find packages apps -name '*.ts' -o -name '*.tsx' | grep -v node_modules | grep -v '\.test\.' | wc -l ⇒ 653
```
⇒ 它只是我實測 PostgREST 行為用的**量測載體**。**零改動。**

### 1-b 商品變體內嵌:29 vs 1000

```
商品數 19,777 / 變體總數 50,925（分頁 50×1000+925，與 count=exact 對齊 ⇒ 沒有漏頁）
每商品最大變體數 = 29
```
🔴 **`29` 是 2026-08-17 這批資料的最大值,不是系統上界。失效條件:任一商品變體數 > 1,000。**
📎 這個數不會靜靜長大 —— 要跨過 1000,得有人為一款商品開一千個規格。

---

## 2. 🔴 兩個「正在發生」—— **同一個病、同一個呼叫端、同一個修法**

兩支的**唯一**真實呼叫端都是推薦引擎(數法:`grep -rn 'listByBrand\|listByFitment' packages/ apps/ --include='*.ts' | grep -v '\.test\.' | grep -v contract`):

```
apps/storefront/src/lib/recommendations/rule-based-engine.ts:98   Case A 客人選了車 → listByFitment
apps/storefront/src/lib/recommendations/rule-based-engine.ts:110  Case B 沒選車     → listByBrand
```

### 2-a 量到的事實

| 路徑 | 母體 | 實得 | 落差 |
|---|---|---|---|
| Case A `BMW S 1000 RR` | 1,423 列 fitment(= **724** 個 distinct 商品) | 1,000 列(= **490** 個商品) | **少 234 個候選(32%)** |
| Case B 最大品牌 | 4,566 個商品 | 1,000 個 | 少 3,566 個候選 |

**Case A 可重跑**(三次重跑皆 1,000 列 / 490 distinct,穩定):
```
curl -s -H "apikey: $K" -H "Authorization: Bearer $K" \
  "$U/rest/v1/product_fitments?select=product_id&moto_brand=eq.BMW&model_code=eq.S%201000%20RR" \
  | python3 -c "import sys,json; ids=[r['product_id'] for r in json.load(sys.stdin)]; print(len(ids), len(set(ids)))"
```
**破千的車型有幾個**:全表 87,619 列逐車型分組 ⇒ **1 個**(`BMW|S 1000 RR`);
第二名 `Ducati|Scrambler 800` = 881 列(**離 1000 只剩 119 列**)。

### 2-b ⚠️ 影響面**不要說大** —— 我先寫錯過一次,當場改掉

**客人在目錄頁看得到全部相容商品** —— `/products?vehicle=…` 走 `search_catalog_by_vehicle` RPC
(`apps/storefront/src/lib/products.ts:494` → `getCatalogPageCached`),**不經 `listByFitment`**。
⇒ 正確說法是「**推薦候選池少了 234 個**」,**不是**「客人少看到 234 個商品」。
🔴 我第一版寫的是後者 —— **它讀起來更嚴重,而且是錯的。**

⇒ **實際後果**:那 234 個商品**永遠不會出現在推薦區**(客人仍能從目錄頁找到它們)。
**嚴重度:中低。但它是【確定正在發生】的**,與變體那面「永遠不會發生」不同。

### 2-c 🔴 而查完呼叫端之後,問題換了一個樣子:**它根本不需要撈完**

```
rule-based-engine.ts:63   收集器上限 = limit+1（註解逐字「控成本 + hasMore 準」）
rule-based-engine.ts:131  const hasMore = primaryPoolCount > limit;
rule-based-engine.ts:132  const items = collected.slice(0, limit)...
```
⇒ 推薦只吐 `limit` 筆(個位數),**卻把 1,000 筆完整列拉進記憶體再篩**,
而那個投影帶 `images` / `description` jsonb ——**同檔 `:98` 註解自己寫著 list 路徑要「避 N+1 jsonb 膨脹」。**

⇒ **這不只是截斷,是一個「拉太多又拉不完」的查法。**

### 2-d 修法:**池大小用 `count`,候選只拉需要的量** ⇒ 既不會被截,也不必撈完

```
① primaryPoolCount ← PostgREST 的 count（header，不是 rows）
   🔴 已實測 count 不受 max-rows 影響：Range: 0-0 + Prefer: count=exact
      對 product_variants_public 回 content-range: 0-0/50925（總數，而 rows 只回 1 筆）
② 候選 rows ← 明示 .limit(N)，N 只要穩定大於推薦所需（limit+1）
③ 「明示的 N」與「靜默的 1000」差在：前者寫在我方 code、看得到、測得到
```
📎 **repo 內已有這個形狀的前例**:品牌頁 RPC `LIMIT LEAST(GREATEST(p_limit, 1), 100)`
(`apps/storefront/src/lib/brand-products.ts:15-16` 指向 migration
`20260719150000_catalog_product_image_trim.sql:110,172`)⇒ **品牌頁安全,因為它的上限是明示的。**

⚠️ **要動介面**:`IProductRepository.listByBrand(brandId)` / `listByFitment(spec)` 的語意現在是「全部」
(`packages/ports/src/IProductRepository.ts:104` 與 `:110`)⇒ 要加「要幾筆」⇒ **動 ports + 兩個實作 + contract test**。

### 2-e ⚠️ 一個施工細節(不影響批准)

`brandPool` / `vehiclePool` 現在**沒有 `order by`**,「同分類優先」是拉回來後在記憶體篩的。
只拉 N 筆會**可能拉不到同分類那幾筆** ⇒ 施工時要把「同分類優先」下推到查詢,或 N 取足夠大。
🔴 **這個問題現在就存在**(現在拉 1,000 筆也沒有 order,只是比較不容易撞到)——**不是本片引入的。**

---

## 3. 還有哪些沒盤到 —— **一個上界,不是一份清單**

```
掃法  每個 .from( 起、到該敘述 ; 止的 chain，內含 limit/range/single/maybeSingle/count:exact 即算「有上限」
結果  掃過 379 支 .ts；.from( chain 共 111（分母）；其中沒有明示上限 = 66
腳本  scripts/scan-unbounded-queries.py（唯讀，本 commit 一併落 repo；跑法 python3 scripts/scan-unbounded-queries.py）
```
🔴 **`66` 是上界,不是缺陷數** —— 這把尺**已知會多報**:
`.eq('id', …)` 這種必定單列的查詢也算進來、`InMemoryProductRepository` 那 8 筆是測試替身不是真查詢。
**它也會少報**:`.rpc(` 與裸 SQL **完全掃不到**。
⇒ **要判斷「還有幾支真的有問題」必須人工逐條看,我沒有做。**

📎 **值得記的**:`fitment-queries.ts:43` 的註解**早就寫著**「`.in('id', ids)` 無上限:熱門車型可能配大量商品」
(還立了 stopgap `#51`)—— **而它擔心的是 URL 長度,不是 `max-rows` 靜默截斷。**
🔴 **同一行 code 底下有兩個病,前一個被看見了,後一個沒有** ——
**看過那行的人都會覺得「這裡已經有人想過了」。**

---

## 4. 影響面 / Rollback / 鐵則判定

- **動到**:`packages/ports`(介面)+ `packages/adapters`(兩支查詢 + in-memory 實作)
  + `apps/storefront/src/lib/recommendations/rule-based-engine.ts`。
- **不動**:訂單那兩面(已完成)、品牌頁 RPC、目錄頁 RPC、商品變體兩支常數(§1-b 證明不必)。
- **Rollback**:純查詢層 + 介面參數 ⇒ 單一 commit `git revert`。
- **鐵則 12 判定**:不涉錢/權限/schema/平台設定/對外發送;`packages/adapters`、`packages/ports` **不是** `packages/ui`
  ⇒ **不中鐵則 12**。中**鐵則 8**(動共用層 + 跨 3 檔)⇒ 故走本 plan。

## 5. 旗標怎麼辦 —— **留最後一道保險,不當產品**

主視窗給的判別句,逐字採用:
> **如果那個旗標在正式站上亮了一次,那是我們的分頁壞了,不是使用者做錯事。**

⇒ **不進 UI、不寫給客人看**,只在我方記一筆。
⚠️ **`ANOMALY_ALERT_ENABLED` 我只確認 env 旗標存在,沒讀實作** ⇒「接既有告警管線」是**提案**,不是「已確認接得上」。

---

## 6. 證據(anon 側 / production / 2026-08-17 00:2x–01:0x / 經 PostgREST)

| 品牌真實商品數 | 內嵌回傳 | HTTP | `content-range` |
|---|---|---|---|
| **4,566** | **1,000** | 200 | `0-0/*` |
| 959 | 959 | 200 | `0-0/*` |
| 113 | 113 | 200 | `0-0/*` |

🔴 **雙向對照**:破千那格印 1000、沒破千兩格印真實數 ⇒ 尺分得出兩個世界;
**而系統自己給的訊號(HTTP / header)三格一模一樣** ⇒ **「零訊號」是實測,不是推論。**

---

## 7. 誠實缺口

- **`hasMore` 不受截斷影響是我推算的,不是量的**(池 1,000 與 4,566 都遠大於推薦 `limit`)⇒ 標**未量**。
- **「推薦品質下降多少」未量** —— 我只證明候選池少了 234 / 3,566 個。轉述時不要升級成「推薦壞掉」。
- **§3 的 `66` 是上界**,含已知誤報與已知盲區(`.rpc(` 掃不到),**未逐條人工分類**。
- **`ANOMALY_ALERT_ENABLED` 實作未讀。**
- **上游 plan §7 第四條(`ORDER_LIST_SELECT` 下游怎麼用 `order_items`)仍未查** —— 我沒碰它。

## 8. 我需要的批准

1. **鐵則 8 批准**(動 `packages/ports` 介面 + 跨 3 檔)。
2. **§2-d 修法**(`count` 取池大小 + 明示 `.limit(N)` 拉候選)—— 這樣對嗎?
3. 🔴 **範圍**:
   ```
   甲  只修推薦引擎那兩支（Case A + Case B），快
   乙  甲 ＋ 把 §3 那 66 筆人工分類過一遍，慢，但能找到我沒撞到的那幾支
   ```
   **我推薦乙**,理由就是 §0 與 §3 那句:**我們找內嵌兩輪,真正在被截的是頂層;
   而 `fitment-queries.ts:43` 證明「有人想過」不等於「想到的是同一個病」。**
