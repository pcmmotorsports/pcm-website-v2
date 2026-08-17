# 報價單庫第二輪:`storefront_catalog_v` 底表 + RLS policy 逐條

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**庫**:`pcm-quote-v2` production
- **憑證**:`pcm_audit_ro`,真登入自檢 ⇒ `current_user = session_user = pcm_audit_ro`(相同才算)
- **庫別自檢(反向指紋)**:`to_regclass('public.customers')`=NULL、`('public.orders')`=NULL、`('public.storefront_catalog_v')`=存在 ⇒ 是報價單庫、不是網站庫
- **🔴 口徑**:本檔每一條**只對報價單庫成立**。A 庫(`pcm-website-v2`)的機制不搬過來當依據。
- **承接**:`E-698` §5 第 1 項、`2026-08-17-quote-db-external-exposure-audit.md` §3「下一輪」清單。
- **本輪全部是 `pg_catalog` metadata + `has_*_privilege` 判定,零業務資料列。**

---

## 0. 結論一句話

`storefront_catalog_v` 的**唯一底表是 `public.products`**,view 是 `security_invoker=true`。
🔴 **而 anon 讀 `products` 的 RLS policy 用的過濾條件,和 view 的 `WHERE` 不一樣 —— policy 少了 `is_listed` 這一維。**
⇒ **「未上架但有價、有分類、未隱藏」的品項,anon 繞過 view 直接查 `products` 表就讀得到,而 view 刻意把它們藏起來。**
影響天花板:**只漏非敏感的 31 欄(品名/品牌/車型/零售價/圖/上架旗標/下架日),不漏成本·經銷·毛利(量到 0),不涉客戶 PII。**

---

## 1. 量到的(metadata,authoritative)

### 1.1 底表就是 `products` 一張

`pg_get_viewdef('public.storefront_catalog_v')` 全文讀過:`WITH base AS (SELECT ... FROM products p WHERE p.is_listed AND NOT p.hidden_from_store)` → `deduped`(去重 window)→ 最終 SELECT。
**沒有任何 join、沒有其他底表。** 價格欄只輸出 `price_general AS price_retail`(零售價),無 cost/dealer/margin 任何一欄。

**機械數法(不靠肉眼讀 viewdef)**:`pg_depend` join `pg_rewrite`,列 view 的改寫規則所依賴的關聯(去掉自身、限 relkind r/v/m/p/f)⇒ **相依關聯數 = 1,就是 `public.products`(relkind=r)**。所以「唯一底表」是 catalog 證的,不是我從 SQL 文字判的。

### 1.2 `security_invoker` 是 true(當場量,不再是讀來的)

```
storefront_catalog_v.reloptions = {security_invoker=true}
```
⇒ 不論從 view 讀還是直接讀 `products`,套用的都是**呼叫者(anon)自己的欄級權限 + RLS**。

### 1.3 `products` 三條 policy 逐條(verbatim)

`products`:`relrowsecurity=t`(RLS 開)、`relforcerowsecurity=f`。

| polname | cmd | roles | USING |
|---|---|---|---|
| `dealer_price_read` | SELECT | `dealer_price_reader` | `is_listed` |
| `pcm_reparse_owner_all` | ALL | `pcm_reparse_owner` | `true` |
| **`storefront_public_read`** | SELECT | **`anon`** | **`major_category IS NOT NULL AND price_store IS NOT NULL AND price_store > 0 AND NOT hidden_from_store`** |

anon 只落在 `storefront_public_read` 一條(其餘兩條給別的角色)⇒ 對 anon 而言,有效 USING 就是這一條。

### 1.4 🔴 核心:policy 與 view 的過濾條件不對稱(配對控制組)

```
anon policy 引用 is_listed ?   f   ← storefront_public_read 的 USING 沒有 is_listed
view 定義   引用 is_listed ?   t   ← storefront_catalog_v 的 WHERE 有 is_listed
```
兩把尺同時量、一 f 一 t ⇒ **差異是機械成立的,不是我讀漏。**

**集合差(anon 直查可讀 − view 會顯示)**,兩邊都含 `NOT hidden_from_store`,約去後:
```
= NOT hidden_from_store
  AND major_category IS NOT NULL
  AND price_store > 0
  AND NOT is_listed          ← 這一項是 view 擋、policy 不擋的
```
⇒ **未上架、未隱藏、有分類、有正的 price_store 的品項** = anon 直查 `products` 可讀、但 view 藏起來。

### 1.5 anon 直查 `products` 能拿到什麼(界定漏面)

```
anon 欄級可 SELECT 的欄位          31 / 57
  含:is_listed(t)、delisted_at(t)、major_category(t)、price_general 零售價(t)
  不含:price_store(f)
成本/經銷/毛利類欄位 anon 可讀      0     ← pattern: cost|dealer|margin|profit|wholesale|purchase_price|supplier_price
  對照 postgres                    1     ← 判定式是活的,上面的 0 才算數
```
⇒ **經銷價/成本沒漏**(Sean 威脅模型第二優先安全)。漏的是未上架品的非敏感欄。
⚠️ 附帶:view 對 `delisted_at` 有「下架滿 7 天才顯示」的 CASE 遮罩;**anon 直查 `products` 拿到的是原始 `delisted_at`,沒有那道遮罩**(anon 對該欄 = t)。

---

## 2. 推出來的 / 未確認(附缺哪一道檢查)

| # | 命題 | 強度 | 缺哪一道 |
|---|---|---|---|
| A | **外部 anon 真的打得到 `/rest/v1/products`** | 🔴 **推**:標準 Supabase 行為是「public schema 一旦對外開,該 schema 內 anon 有權的表都成為端點」。而型錄 view 既然對外供得動,public schema 就是開的 ⇒ `products` 幾乎必然也是端點。**但我沒實打一發** | 用該專案 anon key 對 `/rest/v1/products?select=sku,is_listed&is_listed=eq.false&limit=1` 打一發,附一個已知 200 與一個已知 404 對照。**同 §2.1/2.2 的 blocker,缺 anon key** |
| B | **現在真的有 row 命中集合差** | 🔴 **量不到(而這是帳號被正確鎖住的證據,不是故障)**:主視窗已批 count,實跑 ⇒ `ERROR: permission denied for table products`。metadata 證因:`has_table_privilege('pcm_audit_ro','public.products','SELECT')` = **f**(對照 `postgres` = t、同把憑證讀 `pg_class` 仍回 1101 rows ⇒ 憑證活著、只是被鎖出業務表) | 有 `products` 表 SELECT 的角色才跑得動 count:`service_role`(我沒有),或走 anon key 的 PostgREST 路徑(同 A 的 blocker)。**同 §1#2 的鎖法** —— 稽核帳號讀不到業務列 |

🔴 **A、B 都不成立也不會讓 §1.4 的結構結論消失** —— 結構不對稱是 metadata 證的,A/B 只決定「今天有沒有被踩到」與「外部到不到」。這與 `over_limit=0` 同型:結構是病,計數是「今天」。

---

## 3. 這一條為什麼前一輪沒抓到(給後手的找法)

前一輪(`external-exposure-audit.md` §1.3)已經正確發現「anon 靠欄級授權 + RLS 讀得到 `products`」,並下了結論:**「設計是一致的、不是漏洞 —— anon 拿 31 欄 + 一條**限定它的** RLS policy,再由 view 讀出去。」**

🔴 **那句「一條限定它的 RLS policy」假設了 policy 的限定 = view 的意圖,但沒有人把兩個 predicate 擺在一起比。** 我這一輪做的就是這一步:把 policy 的 USING 和 view 的 WHERE 逐字比 ⇒ 在 `is_listed` 這一維上不一致。

📎 這是「基準假設了一致性、而那個一致性沒被驗過」的形狀(house `feedback_baseline-may-be-a-broken-byproduct` 一族)。**找法可複製**:凡是「view(security_invoker)+ 底表 RLS」的組合,view 的 WHERE 和底表 policy 的 USING **要逐字比對每一維**;view 多擋、policy 少擋的那幾維 = 直查繞過面。

---

## 4. 順帶收掉的:另一張唯一對 anon 開的業務表

`public.term_synonyms`:policy `term_synonyms_public_read` `TO {authenticated, anon}` `USING (is_active)`。
⇒ 只放 `is_active` 的同義詞條目。內容是搜尋用同義詞字典,**非敏感、無 PII、無價格**。無虞,列此存證。
(這是 §1.3-b 清單裡除 storefront_catalog_v 外唯一的 anon 可讀業務物件;其餘 13 個全是 storage/realtime/net/extensions 平台物件。)

---

## 5. 建議修法(唯讀窗只出規格,不改;引先例不只引拍板)

**先例(比拍板更難推翻,因為已經在跑)**:同庫 `dealer_price_read` policy 的 USING 就是 `is_listed` —— **這個 repo 自己已經有「用 policy 擋未上架」的寫法**,只是沒套在 anon 這條上。

**方向(擇一,由施工窗判)**:
1. 讓 `storefront_public_read` 的 USING **補上 `AND is_listed`**,與 view 的 WHERE 對齊(最小改、跟既有 `dealer_price_read` 同形)。
2. 若刻意要讓 anon 直查 products,則 view 的 `is_listed` 過濾應改由 policy 統一負責,避免兩把尺分岔。

🔴 **兩個方向的共通前提**:view 的 WHERE 與底表 anon policy 的 USING 應該是**同一組條件**,否則「從 view 讀」和「直查表」看到的世界不一樣,而外部只會挑好打的那條路。

---

## 6. 口徑再申明

本檔的 `products` / RLS / 欄級數字**全部量自報價單庫**。A 庫經銷價是靠 `price_by_tier` 欄級 `f` 擋的、報價單庫是靠 `dealer_price_v` 獨立 view 沒發給 anon —— **同樣「經銷價安全」,不同機制,結論不互相引用。**
