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

## 2. ✅ 已用 anon key 實打量到(2026-08-17,取代原「推 / 量不到」)

Sean 交付報價單專案 anon key(`sb_publishable_…`,len 46,新格式 Publishable key);REST base = `https://dllwkkfanaebrsuyuedy.supabase.co/rest/v1`(projectref 由 pooler username 推導、不印密碼)。全程 **GET-only、count-only(`Range: 0-0` + `Prefer: count=exact`,只取 Content-Range 的總數、不落任何 row)、雙向表演**。

| # | 命題 | 量到的結果 |
|---|---|---|
| A | **外部 anon 真打得到 `/rest/v1/products`** | ✅ **是**:`GET /rest/v1/products?select=sku` ⇒ **http 206、Content-Range `0-0/51811`**。正向對照 `storefront_catalog_v` 同樣 206/51811(key 有效、送法正確)⇒ anon 確實可繞 view 直查 products 端點 |
| B | **現在真有 row 命中集合差**(is_listed=false 且 RLS 放行) | ✅ **今天 = 0 筆**:`GET /rest/v1/products?select=sku&is_listed=eq.false` ⇒ **http 200、Content-Range `*/0`**。算術對得上:products 全體 51811 = `is_listed=true` 51811 + `is_listed=false` 0 ⇒ **目前每一筆 anon 可見品項都是 is_listed=true** |

🔴 **結構 gap 仍在、只是今天零命中**(同 `over_limit=0`):policy 仍少 `is_listed` 一維(§1.4 metadata 證),**只要業務把一筆「有分類、price_store>0、未隱藏」的品項設成 is_listed=false,它當下就會變成 anon 直查可枚舉**,而那次改動看起來與資安無關。⇒ **finding 維持,嚴重度=結構性 MEDIUM、當前曝險 0 筆。**

### 🔴 附帶(雙向表演)—— 經銷價外部零漏,量到的(Sean 第二優先,最強形式)
```
GET /rest/v1/products?select=sku          ⇒ 206（anon 授權欄,對照組亮）
GET /rest/v1/products?select=price_store  ⇒ 401（經銷價欄,anon 未授權 ⇒ 外部讀不到）
GET /rest/v1/dealer_price_v               ⇒ 401  body {"code":"42501","message":"permission denied for view dealer_price_v"}
```
⇒ **經銷價在報價單庫【外部 REST 層】確認擋死**(不只 DB metadata):授權欄 200 / 經銷欄 401,兩個世界印不同的東西。

### 🔴 §1#9 / §2.1 / §2.2 一起收口 —— net / pg_stat_statements 外部不可達(量到的)
前一任標「未確認」的兩條(`net.*` 存 cron 祕密的 Authorization 標頭、`extensions.pg_stat_statements` 存查詢文字):anon **有 DB grant**,但**外部要碰得靠 PostgREST 暴露那個 schema**。實打:
```
Accept-Profile: public      storefront_catalog_v  ⇒ 200（POS 對照,profile 機制活）
Accept-Profile: net         _http_response        ⇒ 406  PGRST106
Accept-Profile: extensions  pg_stat_statements    ⇒ 406  PGRST106
   兩者 body 逐字:{"message":"Invalid schema: net/extensions",
                    "hint":"Only the following schemas are exposed: public, graphql_public"}
```
⇒ **PostgREST db-schemas 白名單 = `public, graphql_public` 兩個而已**(這正是前一任「`pg_db_role_setting` 裡查不到 `pgrst.db_schemas`」缺的那個事實,由錯誤訊息自曝)。**`net` / `extensions` 不在名單 ⇒ 外部匿名經 REST 打不到那些表**,不論 DB grant 如何。§2.1/2.2 的外部曝險 = **關閉(外部不可達)**;DB 內部的 grant 縱深仍建議收(RLS/REVOKE),但不是對外洞。

### 🔴 報價單庫外部 anon REST 面 —— 完整確認(2026-08-17 實打)
| 端點 | http | 說明 |
|---|---|---|
| `storefront_catalog_v` | 206 (51811) | 型錄 view,對外本應開 |
| `products` | 206 (51811) | 直查可達,但經銷欄 401(見上)|
| `term_synonyms` | 206 (184) | 同義詞字典,非敏感 |
| `dealer_price_v` | **401** | 經銷價 view,permission denied |
| `suppliers` | **401** | 供應商表,擋 |
| `quote_snapshots` | **401** | 報價快照,擋 |
| `net` / `extensions` schema | **406** | 不在 db-schemas 白名單 |
| **REST root `/` (OpenAPI schema)** | **401** | 🔴 **"Only secret API keys can be used"** ⇒ **anon 拉不到 schema introspection = 一道外部硬化,攻擊者無法用公開 key 枚舉整個 table/RPC 面** |
⇒ 外部 anon 可達的業務物件僅 **型錄 view + products(無經銷欄)+ 同義詞字典**;供應商/報價/經銷價全 401。**經銷價、供應商成本、報價資料外部零漏**(量到的,雙向對照齊)。

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

## 5. 修法規格(唯讀窗只出規格,不改 code、不動報價單 repo)

> 修改落點在**報價單 repo**(`~/API大量上架/PCM報價單-V2/supabase/migrations`,另一個專案)。🔴 **E 只出規格;動它要另外談。** 施工用該 repo 的 migration 機制,**絕不 `db push`**(ledger desync,memory `reference_quote-repo-migration-ledger-desync`);改前 `git fetch`、對 `origin/main`(`482bec5`)。

**先例(比拍板更難推翻,因為已經在跑)**:
- 同庫 `products.dealer_price_read` policy 的 USING 就是 `is_listed` —— **這個 repo 自己已有「用 policy 擋未上架」的寫法**,只是沒套在 anon 這條上。
- **網站庫**的 anon 型錄 view(products_public 等)**根本不自帶 WHERE、過濾全在 RLS policy** ⇒ 走 view 與直查表看到同一組 row(`website-db-view-policy-symmetry-check`)。**網站庫已經是報價單庫該改成的樣子** —— 修法有 repo 內先例,不用設計。

**最小安全修法**:`storefront_public_read` 的 USING **補一維 `AND is_listed`**:
```sql
-- 現況 USING:major_category IS NOT NULL AND price_store IS NOT NULL AND price_store > 0 AND NOT hidden_from_store
-- 改為:    ... AND NOT hidden_from_store AND is_listed
ALTER POLICY storefront_public_read ON public.products
  USING (major_category IS NOT NULL AND price_store IS NOT NULL AND price_store > 0
         AND NOT hidden_from_store AND is_listed);
```
這讓 policy **變嚴**、與 view 的 `is_listed` 對齊 ⇒ 關掉「直查繞過」那條路。

**🔴 兩個世界的驗收(缺任一則修法可能把整條路關掉而沒人發現)**:
1. **is_listed=false 那一筆修完必須讀不到**:施工窗以 anon key 打
   `GET /rest/v1/products?select=sku&is_listed=eq.false` ⇒ **count 必須 = 0**(且刻意造一筆 is_listed=false + major_category + price_store>0 + not hidden 的測試列,修前讀得到、修後讀不到 = 負向對照,證明測試是活的)。
2. **is_listed=true 那些必須照樣讀得到**:`storefront_catalog_v` 的 count **不得下降**(修前基準=51811);`products?is_listed=eq.true` count 不變 ⇒ 沒把型錄一起關掉。
3. 收尾雙向:授權欄仍 206、經銷欄仍 401(修 RLS 不該動到欄級授權)。

**⚠️ 另一個方向(非安全、屬設計)**:policy 與 view 目前在 `major_category`/`price_store>0` 這兩維也不同(view 不看、policy 看)⇒ 有「listed 但無分類/無店價」的品項會被 security_invoker view 的 anon RLS 擋掉(**under-exposure,安全上無害**)。要不要讓 policy USING **完全等於** view WHERE(`is_listed AND NOT hidden`),是 Sean/施工窗的設計取捨,不是這條安全 finding 要求的。

---

## 5-b. 縱深修法規格(內部 grant,LOW,非對外洞但拿掉多餘授權)

**現況(量到的,metadata)**:`net._http_response` / `net.http_request_queue`(RLS=**false**,存 cron 的 `Authorization` 標頭)與 `extensions.pg_stat_statements` / `pg_stat_statements_info`(存查詢文字)對 **anon 與 authenticated 皆 `SELECT=t`**(對照 postgres=t)。

🔴 **它們今天外部打不到,只因 db-schemas 白名單 = `public, graphql_public`(§2)** —— **單一控制在擋**。若日後有人把 `net` 或 `extensions` 加進 db-schemas(為了暴露某個 helper),這四個立刻變外部可讀,而 net.* 那半直接是祕密。同前一任「延遲觸發的坑」(inventory §🟡)。

**縱深修法(第二道獨立控制,施工窗判、動 report repo 需另談、不 db push)**:
```sql
REVOKE SELECT ON net._http_response, net.http_request_queue FROM anon, authenticated;
REVOKE SELECT ON extensions.pg_stat_statements, extensions.pg_stat_statements_info FROM anon, authenticated;
-- 若 ACL 顯示是經 PUBLIC 授的,對 PUBLIC 也 REVOKE(先查 relacl 再決定)
```
⚠️ **安全性**:app 用 pg_net 走 cron(service_role/postgres),**不經 anon/authenticated** ⇒ REVOKE 這兩個角色不影響功能。驗收:REVOKE 後 `has_table_privilege('anon',...)` 全轉 f、service_role 仍 t、cron 排程照跑。**價值=把「外部到不到」從『靠 db-schemas 設定對』升級成『靠授權+設定兩道』。**

## 6. 口徑再申明

本檔的 `products` / RLS / 欄級數字**全部量自報價單庫**。A 庫經銷價是靠 `price_by_tier` 欄級 `f` 擋的、報價單庫是靠 `dealer_price_v` 獨立 view 沒發給 anon —— **同樣「經銷價安全」,不同機制,結論不互相引用。**
