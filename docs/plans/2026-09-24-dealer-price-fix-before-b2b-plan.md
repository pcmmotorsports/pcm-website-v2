# 計畫：B2B 開工前的經銷價修正

- 日期：2026-09-24
- 狀態：**只寫計畫。沒有改程式、沒有寫正式庫、沒有推送。**
- 命中：鐵則 8（改資料庫 view 與函式）＋ 鐵則 12（價格）。實作前要 Sean 批准，並再送 Codex 審一輪。
- 相關：`docs/plans/2026-09-23-b2b-subdomain-plan.md`（分支 `worktree-agent-a35359609896b2810`）第 4 節。**本計畫推翻那份第 4.2 節的修法**，理由見第 2 節。
- 拍板依據：`project_0909-dealer-price-whole-package-after-launch`（經銷價整包排上線後、跟 B2B 一起做）、`project_0923-b2b-subdomain-decided`（做 b2b 子網域）、`project_0906-dealer-price-display-tax-by-payment-method`（經銷價未稅不標、稅隨付款方式）。

---

## 1. 結論

1. **目錄頁經銷價應該接「基準款變體的 `product_variants.price_store`」**，取不到再退回一般價。這跟結帳實際收的錢是同一個欄位。
2. **不能照 B2B 計畫原本寫的改接 `products.price_by_tier->'store'`。** 那一欄今天有 **1,086 件比一般價還貴**，全部是過期的舊價，不是經銷價。照原計畫貼下去，經銷商會在目錄頁看到比一般客人更貴的價。
3. 商品頁在經銷商**還沒選規格**時，讀的也是那個過期欄位（`get_effective_prices` 商品那一半）。今天沒有經銷會員，所以沒有人看到，但要一起修。
4. 真正的經銷價**一筆都還沒灌進網站**。要從報價單資料庫 `dealer_price_v` 灌，而且要等 Sean 說「灌」這個字。可以灌多少筆，我這次沒量到（第 4.3 節）。

---

## 2. 實測數字（2026-09-24 03:5x，正式網站資料庫唯讀）

量法：`bash scripts/readonly-prod-sql.sh <sql>`，SQL 放在本 session 暫存區，只有 SELECT。

| 項目 | 數字 | 意思 |
|---|---|---|
| 經銷目錄 view 還在讀 `pr.price_store` | 是 | 正式庫 `pg_get_viewdef` 實讀，跟 migration `20260908000000:216` 一致 |
| 經銷目錄 view 的權限（relacl） | `{postgres=arwdDxtm/postgres}` | 只有 owner，`anon`／`authenticated` 都沒有，跟 migration 一致 |
| `products` 總數 | 26,642 | |
| `products.price_store` 有值 | 1 | 其餘全部 NULL ⇒ 目錄頁經銷價今天全部退回一般價 |
| `price_by_tier.store` 非數字或非台幣 | 0 | |
| `price_by_tier.store` 與一般價不同 | **1,109** | 9/9 時是 9 |
| 其中比一般價**貴** | **1,086** | 9/9 時是 5 |
| `product_variants` 總數 | 61,460 | |
| `product_variants.price_store` 有值 | 1（`PCM-BALANCE-1`，一般價 1、經銷價 1） | ⇒ 真經銷價沒灌過 |
| 變體經銷價與一般價不同 | 0 | |
| 會員等級 | general 18、store 0 | 今天沒有經銷會員 ⇒ 這些錯價還沒有人看到 |

「與一般價不同」依供應商分：

| 供應商 | 商品數 | 不同 | 較貴 | 較便宜 |
|---|---|---|---|---|
| rizoma | 1,008 | 984 | 984 | 0 |
| dbk | 1,960 | 85 | 83 | 2 |
| evotech | 3,717 | 17 | 3 | 14 |
| rpm | 1,438 | 16 | 13 | 3 |
| materya | 64 | 2 | 0 | 2 |
| gilles、wrs、kspeed、samco、eazigrip | 各約 1,000 上下 | 各 1 | — | — |

抽樣（rizoma，2026-09-22 那輪同步寫的）：`AZ019` 一般價 3,300、`store` 4,000；`AZ021` 6,500、8,200；`AZ451` 7,700、9,800。這些商品的變體一般價跟商品一般價相同，變體經銷價都是 NULL。

### 為什麼 `price_by_tier.store` 是過期價

`scripts/rpm-transform.ts:563` 寫商品層 `store` 用的是 `productStoreOf()`（`:653-658`）。沒開灌價的供應商（allowlist 是空的，今天全部都是）一律回**商品自己的舊值**，不重算。這是 Codex 總審要求的，理由是「不動 = 不碰」。

而同一列的一般價 `price_general`（`:467`）**每輪都從基準款的零售價重算**。

⇒ 一般價每天跟著供應商更新，`store` 停在第一次寫入時的數字。rizoma 那 984 件就是之後降過價，`store` 留在降價前。**這一欄只在「那家供應商開了灌價」的那一輪才會被更新成真的經銷價。**

---

## 3. 修法

### 3.1 原則：經銷價只認一個欄位

真的經銷價只有一個地方會被灌進來、也只有一個地方被收錢：**`product_variants.price_store`**。

- 結帳收錢：`create_order` 取 `coalesce(v_variant.price_store, v_variant.price_general)`（`20260915100000:377`）
- 商品頁選了規格：`get_effective_prices` 變體那一半（`20260907010000`，變體段）

所以目錄頁和商品頁「還沒選規格」時，要用**同一個欄位**算出來，不要再讀商品層那個會過期的 `store`。

### 3.2 商品的「代表價」要取哪一支變體

商品的一般價取自基準款：群內零售價最低、同價時 sku 小的那一支（`scripts/rpm-transform.ts:448-452`）。經銷價要取**同一支**的 `price_store`，兩個數才是一對，折扣才是真的。

SQL 端沒有存「哪一支是基準款」，要照同一條規則選：`price_general` 最小、同價 sku 最小。

⚠️ **SQL 端可能選到跟同步程式不同的一支**，三個原因（R1 審查實查正式庫）：

1. **同價並列很多**：25,553 件上架商品中，**5,839 件**有兩支以上變體並列最低一般價，要靠 sku 決勝。
2. **sku 排序規則不同**：同步程式用 JavaScript 字元碼比較（`rpm-transform.ts:450` `a.sku < b.sku`），資料庫預設用 `en_US.UTF-8` 排序，大小寫與符號的先後不一樣。⇒ SQL 一定要寫 `ORDER BY pv.sku COLLATE "C"`，才會跟 JavaScript 同順序。R2 實查：61,460 個 sku 全部是 ASCII（非 ASCII 0 筆），所以 `COLLATE "C"` 與 JavaScript 比較結果完全相同；不加的話，上架商品中有 **12 件**會選到不同的變體。
3. **零售價四捨五入**：同步程式依上游零售價排，SQL 只能依網站上四捨五入後的一般價排。另外有 **6 件**商品的一般價不等於最低那支變體的一般價（dbk 3、materya 2、rpm 1，例 `HCBR1KRR12-19` 商品 25,000、最低變體 20,500），原因還沒查。

選到不同支時，目錄上的經銷價可能是**同一件商品另一支規格**的經銷價，可能高也可能低。**這只影響目錄上的顯示；收錢一律照客人實際選的那一支**（`create_order` 逐變體取價，`20260915100000:377`），不會收錯。片 1 要量加了 `COLLATE "C"` 之後，SQL 選到的那一支跟同步程式選的有幾件不同。

### 3.3 改動一：經銷目錄 view（migration A）

`CREATE OR REPLACE VIEW public.products_list_dealer`，只改價格那一格：

```sql
coalesce(b.price_store, v.price_general) AS price_general
...
FROM public.products_list_public v
JOIN public.products pr ON pr.id = v.id
LEFT JOIN LATERAL (
  SELECT pv.price_store
    FROM public.product_variants pv
   WHERE pv.product_id = pr.id
   ORDER BY pv.price_general ASC NULLS LAST, pv.sku COLLATE "C" ASC
   LIMIT 1
) b ON true
WHERE pr.delisted_at IS NULL;
```

- 沒有變體的商品，`b` 是 NULL，就退回一般價，跟今天一樣。
- 沿用 `20260908000000` 的做法：`security_invoker` 不設、兩道 REVOKE、誰都不 GRANT。用 `CREATE OR REPLACE` 會保留既有權限，但貼完還是要查一次 relacl。
- 欄位名稱、順序、型別都不變，所以讀它的經銷目錄函式 `search_catalog_by_vehicle_dealer`（現役 `20260922130000`）不用改。

**效能要先量**：經銷目錄函式在篩選那一層就拿 view 的價格欄做價格篩選與排序（`20260922130000:693-694、786-788、951-952`），所以每一件**候選商品**都要多算一次變體查詢，不是只算那一頁。沒有關鍵字的通用區查詢會整張 view 都算。`product_variants(product_id)` 有索引（`idx_product_variants_product_id`，R1 已在正式庫實查存在）。片 1 要用最差的查詢量 `EXPLAIN ANALYZE`：不帶關鍵字、依價格由低到高、每頁 1,000 件。今天沒有經銷會員，就算變慢也不會影響任何客人，但上線前要知道；太慢的話改成把基準款經銷價存成一欄，那是另一份計畫。

貼完照 `20260908000000` 的事後檢查再查一次 `security_invoker` 與 relacl：`CREATE OR REPLACE VIEW` 不帶 `WITH` 會把 view 選項整組換掉（今天本來就沒設，無害，但要確認）。

### 3.4 改動二：商品頁還沒選規格時的經銷價（migration B）

`get_effective_prices` 商品那一半今天讀 `p.price_by_tier -> v_tier ->> 'amount'`（`20260907010000`，商品段）。經銷會員會拿到 `store` 那個過期值。

改法：`v_tier = 'store'` 時，改成跟 3.3 同一個子查詢取基準款變體的 `price_store`，取不到退回一般價。一般會員那一條（`general`）不動。

這支是**金流相關函式**（`SECURITY DEFINER`，結帳前的顯示價），所以：

- 用 `bash scripts/latest-definition-of.sh get_effective_prices` 確認現役只有 `20260907010000` 一代，照抄全文只改商品段。
- `CREATE OR REPLACE` 會把 `SET search_path = ''` 那一行一起換掉（`reference_create-or-replace-resets-set-clause`），新版一定要寫回去。
- 權限照原本：REVOKE PUBLIC／anon，只給 `authenticated`。

### 3.5 同步程式要不要改

**這次不改。** 兩個讀取的地方都改掉之後，`price_by_tier.store` 就沒有任何客人會看到的路徑在讀了。資料庫的 CHECK 還是要求這個 key 存在，所以同步程式照舊寫，不影響任何人。

要不要把它清成一般價，或乾脆拿掉，另外排，不跟這次綁在一起。

### 3.6 不在這次範圍

- 一般站移除經銷價邏輯：B2B 計畫第 5 節，依 Sean 已拍的 Q1 做。
- 搜尋疊層與相關商品：B2B 計畫第 4.5 節，Sean 已拍「經銷站不顯示價格」。
- 後台建單自動帶經銷價（`#215`）：另外一件。
- `create_order` 舊的 10 參數版本：`20260913090000` 已寫好 DROP，還沒貼，另外處理。

---

## 4. 把真的經銷價灌進網站

### 4.1 從哪裡來

- 來源：報價單資料庫（`dllwkkfanaebrsuyuedy`）的 `public.dealer_price_v`，欄位 `supplier_slug, sku, price_store`（`scripts/dealer-price-source.ts:162`）。
- 讀取帳號：專用唯讀角色 `dealer_price_reader`，GitHub secret `DEALER_PRICE_DATABASE_URL`。
- 開關：GitHub secret `DEALER_PRICE_SUPPLIERS`，逗號分隔的**供應商代號**清單（`scripts/rpm-import.ts:272`）。今天是空的，9/22 那輪 log 印「allowlist: (空) · 家數 0」。
- 寫到哪裡：每日商品同步把清單裡那幾家的經銷價寫進 `product_variants.price_store`，商品層 `price_by_tier.store` 也會一起更新成基準款的上游價（`rpm-transform.ts:653-658`）。

### 4.2 流程

照 `docs/runbooks/dealer-price-first-load.md` 那五道門，但**門 4 與門 5 的順序要改**（R1 必修，已開檔核對）：

- 排程觸發的同步**不需要校驗碼**，會直接照上游寫（`scripts/rpm-import.ts:376-390`：只有 `workflow_dispatch` 或本機才要校驗碼，`schedule` 照常跟上游）。排程時間又不固定（`.github/workflows/rpm-sync.yml:75-77`：舊時段實測晚 4.2–5.6 小時，新時段還沒量過）。
- ⇒ 如果照 runbook 先設清單（門 4）、再取還原資料（門 5），中間只要排程先跑一輪，真經銷價就會**在沒有校驗碼、也沒有還原資料的情況下**寫進去。

改成：

1. 門 2：清單保持空的，先跑一輪，確認網站上的經銷價筆數沒變（今天是 1）。
2. 門 3：本機跑 `rpm-import --dry-run`，拿到「會寫幾筆、校驗碼、異常值」。
3. **門 4：Sean 說「灌」這個字。沒說就停在這裡。**
4. **等當天那一輪排程同步跑完**才開始下一步。查法：`gh run list --workflow=rpm-sync.yml --event=schedule --limit 1`，要看到今天建立、狀態 completed。一天只有一條排程（`rpm-sync.yml:100`），跑完之後到隔天早上前不會再有排程，下面三步之間就沒有排程插進來的空窗。`concurrency` 設定（`:133-135`）只會排隊，擋不住排程在中間開跑（R2 審查）。
5. 以下三步一次做完，中間不停：
   a. 確認 GitHub Actions 沒有正在跑或排隊中的商品同步；
   b. 取還原用的舊資料（門 5）；
   c. 設 `DEALER_PRICE_SUPPLIERS`，**立刻**用 `workflow_dispatch` 帶門 3 的校驗碼觸發。
6. **清單一設下去，就當成已經開始寫入**。之後每天的排程都會照上游更新那一家。
7. 觸發那一輪如果印「checksum 不符」，**立刻把 `DEALER_PRICE_SUPPLIERS` 清空**（runbook 第五節第 1 步）。不清的話，隔天排程不比對校驗碼，會把沒核准的那批直接寫進去。
8. 不能用「先停用 workflow」來擋排程：`gh workflow disable` 之後連手動觸發也跑不了。

runbook 本身也要同步改這個順序，另開一片，不在本計畫。

建議**一次開一家**，先開 rpm（變體最多、runbook 就是照它寫的）。每家灌完量一次第 4.4 節再開下一家。

### 4.3 灌多少筆：這次沒量到

我想用 `dealer_price_reader` 唯讀查報價單 `dealer_price_v` 每一家有幾筆，**被本機權限擋下來，沒有查**。報價單的 Supabase 連線工具也沒有授權。

⇒ 筆數要在門 3 的 dry-run 拿到。或者由 Sean 允許本窗用那組唯讀帳號跑下面這一句（只讀，不印連線資料）：

```sql
SELECT supplier_slug, count(*) AS 列數, count(price_store) AS 有經銷價,
       count(DISTINCT sku) AS 料號數
  FROM public.dealer_price_v GROUP BY 1 ORDER BY 1;
```

網站這一邊的上限是變體總數 61,460；runbook 記的 rpm 基線是 8,041 個變體（09-06）。

### 4.4 灌完怎麼驗

正式庫唯讀，每開一家量一次：

1. 那一家 `product_variants.price_store IS NOT NULL` 的筆數，要接近 dry-run 說的筆數。
2. **經銷價比一般價貴的變體數要是 0。** 不是 0 就停，清單清空，照 runbook 第五節退回。
3. 抽三件：經銷目錄 view 的價、`get_effective_prices` 商品半與變體半的價、報價單 `dealer_price_v` 的價，三個要一樣。
4. 一般會員看同一件商品，還是一般價。

---

## 5. 分片與順序

| 片 | 內容 | 時間 | 誰 |
|---|---|---|---|
| 1 | 唯讀：查那 6 件一般價不等於最低變體價的原因；用最差查詢 `EXPLAIN ANALYZE` 經銷目錄。⚠️ 「SQL 選到的基準款跟同步程式不同」**純 SQL 量不到**：同步程式選的基準款 sku 沒有存進資料庫，只能量「商品一般價 ≠ SQL 選到那支的一般價」（今天 6 件），其餘要靠本機 dry-run 對照；不要把量不到寫成 0 | 30 分 | 施工窗 |
| 2 | 寫 migration A（view）＋退回 SQL＋測試，先故意寫回舊的那一格，確認測試會變紅 | 45 分 | 施工窗 |
| 3 | 寫 migration B（`get_effective_prices` 商品半）＋退回 SQL＋測試 | 45 分 | 施工窗 |
| 4 | Codex 審 A、B 兩支 | — | 主視窗 |
| 5 | 貼 A、B | — | **Sean** |
| 6 | 灌價五道門 | 另計 | **門 4 要 Sean 說「灌」** |

順序理由：**先改讀取、再灌價。** 反過來的話，灌了 rpm 之後，其他沒灌的供應商在商品頁還是會顯示那 1,086 個過期價。先改讀取的話，灌之前畫面上全部是一般價，一個數字都不會變，這是對的。

A、B 可以同一次貼。兩支都只改讀取，不改寫入，也不改簽章。

---

## 6. 退回方式

| 狀況 | 怎麼退 | 可逆嗎 |
|---|---|---|
| A 貼上後目錄頁價格不對或變慢 | 貼退回 SQL：view 那一格換回 `coalesce(pr.price_store, v.price_general)`，拿掉 LATERAL。那一欄永遠 NULL，退回後就是今天的行為 | 可逆，秒級 |
| B 貼上後商品頁價格不對 | 貼**另外寫好的退回 SQL**：`CREATE OR REPLACE FUNCTION` 抄 `20260907010000` 的函式本體，保留 `SET search_path = ''`（正式庫實查 `proconfig = {search_path=""}`），重下 REVOKE／GRANT 與權限檢查。**不能直接重貼 `20260907010000`**：那支是 `CREATE FUNCTION`（不是 OR REPLACE），函式已存在時會報錯、整個交易回滾，等於沒退（R1 必修）。退回 SQL 在片 3 跟 migration B 一起寫，放 `supabase/rollbacks/<版本>-rollback.sql`（照既有 `20260922130000-rollback.sql` 的慣例，不放進 migrations 以免被當成正向變更），一起在拋棄式 PG 跑過一次 | 可逆，秒級。⚠️ 退回後經銷會員會再看到過期價，今天 0 人 |
| 灌價後價格錯 | 照 runbook 第五節：清單清空，下一輪同步帶舊值；必要時用門 5 的舊資料還原 | 可逆，前提是門 5 有做 |

---

## 7. 要問 Sean 的題

**Q1　目錄頁與商品頁的經銷價，要改接哪一欄？**

- **甲（推薦）**：接基準款變體的經銷價（`product_variants.price_store`），就是結帳真的收錢的那一欄。今天畫面一個數字都不會變，灌價後才會出現經銷價。
- 乙：照 B2B 計畫原本寫的接商品層 `price_by_tier.store`。**會讓 1,086 件比一般價貴的過期價直接給經銷商看到**，不建議。

**Q2　灌價要一次開幾家？**

- **甲（推薦）**：一次一家，先開 rpm，驗完再開下一家。慢，但出錯只影響一家。
- 乙：一次全開。快，但出錯時要一次還原全部。

（「灌」這個字本身不是這一題，要等 A、B 貼好、門 1–3 做完再問。）

---

## 審查紀錄

### R1　2026-09-24　Fable 對抗審查（`adversarial-reviewer`）

結果：**FAIL，2 條必修**。兩條我都開檔核對過，都成立，已修。

| 編號 | 問題 | 處置 |
|---|---|---|
| M1 | 第 6 節「B 退回 = 重貼 `20260907010000`」退不回去：那支是 `CREATE FUNCTION`，函式已存在會報錯回滾 | 改成另寫一支 `CREATE OR REPLACE` 的退回 SQL，保留 `search_path`，片 3 一起寫一起測 |
| M2 | 灌價時「先設清單、再取還原資料」中間有空窗：排程觸發不需要校驗碼（`rpm-import.ts:376-390`），排程先跑就會直接寫 | 第 4.2 節改成「確認沒有同步在跑 → 取還原資料 → 設清單 → 立刻帶校驗碼觸發」一次做完 |

建議也採納：sku 排序加 `COLLATE "C"` 對齊 JavaScript，並寫進 5,839 件並列、6 件一般價不等於最低變體價兩個實查數字（3.2）；效能要量整個候選集、用最差查詢（3.3）；貼完再查 view 選項（3.3）。

審查員確認成立的：第 2 節根因、第 3.5 節「沒有其他客人路徑讀 `price_by_tier.store`」、第 5 節先改讀取再灌的順序、`get_effective_prices` 正式庫設定與 migration 一致。

### R2　2026-09-24　Fable 對抗審查

結果：**PASS，沒有必修**。R1 兩條必修確認修對。依照規則，第二輪通過就結束審查，實作前再送 Codex。

採納的建議：

- 灌價還有一個很窄的空窗：排程可能在「取還原資料」到「觸發」之間開跑，照不比對校驗碼的方式寫入。已改成**等當天排程跑完才做**，並補上「校驗碼不符就立刻清空清單」與「不能用停用 workflow 擋」（4.2）。
- `COLLATE "C"` 實查與 JavaScript 比較結果相同（sku 全 ASCII），不加的話有 12 件選到不同變體，已寫進 3.2。
- 片 1 的量法：同步程式的基準款沒存進資料庫，純 SQL 量不到，已寫明（第 5 節）。
- 退回 SQL 放 `supabase/rollbacks/`（第 6 節）；延遲引用改成現況的 4.2–5.6 小時（4.2）。

審查員也確認：view 改法、先改讀取再灌的順序、B 的退回方式、B2B 計畫 §9.7 的登入判斷與更新筆數判斷都成立。

**還沒證實的一件**：新排程時段（台灣 07:45）還沒跑過，實際延遲多久沒人量過。

## 哪些親自驗過、哪些沒有

- **親自唯讀實查**：第 2 節所有數字、view 定義與權限、會員等級。
- **親自開檔核對**：`rpm-transform.ts:448-467、534、563、635-658`；`get_effective_prices` 商品段與變體段；`products_list_dealer` 定義；`ProductInfo.tsx` 經銷價選取（沒選規格用商品價、選了用變體價）；`product/[slug]/page.tsx` 商品半與變體半一起送。
- **沒有驗**：報價單 `dealer_price_v` 的筆數（被擋，第 4.3 節）；3.2 那種「選到不同支」的商品數；經銷目錄加 LATERAL 之後的速度。這三件都排在片 1 或門 3。
