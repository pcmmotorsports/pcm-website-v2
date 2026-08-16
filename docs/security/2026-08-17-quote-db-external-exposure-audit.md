# 報價單庫（`pcm-quote-v2`）對外曝險稽核

- **窗**：E（資安稽核，唯讀）　**日期**：2026-08-17
- **🔴 口徑**：本檔每一條結論**只對報價單庫成立**。
  A 庫（`pcm-website-v2`）那份的數字**一個都不搬過來**，只沿用**方法**。
  （今晚兩庫互套結論已經出錯三次。）
- **憑證**：`pcm_audit_ro`，**真登入**自檢 ⇒ `current_user / session_user` 皆 `pcm_audit_ro`（相同才算）
- **庫別自檢（反向指紋，不靠眼睛）**：`to_regclass('public.customers')` ⇒ `無`、`to_regclass('public.orders')` ⇒ `無`
  ⇒ **不是網站庫。** （正向指紋我不用 —— 報價單庫的表我還沒查過，拿沒查證的表名當依據等於自己編。）

---

## 0. 🔴 開跑前的**預測**（**本節在跑任何查詢之前落檔並 commit，git 歷史可證**）

> **為什麼**：不先寫預測，查到什麼都會覺得「本來就是這樣」。
> **猜錯的那幾條才是這一輪真正的收穫。**

| # | 問題 | 我的預測 | 我憑什麼這樣猜 |
|---|---|---|---|
| **P1** | `public` 裡 `anon` 可 SELECT 的關聯數 | **非 0，估 5–30** | storefront 走 PostgREST `anon` 讀報價單側的 view（memory `reference_quote-repo-truth-moved-to-mac-mini` 一族）⇒ 型錄面本來就要對外開 |
| **P2** | `anon` 可 EXECUTE 的 SECURITY DEFINER 函式數 | **0** | A 庫實測 80 支中 0。⚠️ **這是拿 A 庫的【結果】當先驗，不是證據** —— 猜錯要當成新事實，不要當成「退步」 |
| **P3** | `pg_default_acl` 在 `public` 的筆數與 grantee | **有數筆，grantee 含 `anon`／`authenticated`** | 兩庫都是 Supabase 專案、年代相近 |
| **P4** | 有沒有「客戶／報價」語意的表對 `anon` 開著 | **沒有客戶 PII** | 該庫面向內部作業 |
| 🔴 **P5** | **成本價／毛利欄對 `anon` 開不開得到** | **不開** —— 但**我對這條最沒把握** | 🔴 **報價單庫的核心資料【就是】供應商成本與毛利**（Sean 的威脅模型第二優先＝經銷價絕不外洩）。A 庫是靠 `price_by_tier` 欄級 `f` 擋住的，**而報價單庫的擋法我完全沒看過** |

### 🔴 這一輪最值錢的一格是 P5，理由要寫在跑之前

A 庫那輪「經銷價零外洩」是**三層各自獨立**擋住的（DB 欄級、app 逐欄白名單、eslint）。
**那三層全部長在 A 庫。** 報價單庫**不共用其中任何一層** ——
它的前台消費者是**另一個 repo 的 PostgREST 呼叫**。

⇒ **「經銷價安全」這個結論在報價單庫是【完全未經檢驗】的。**
⇒ 若 P5 猜錯，那是今晚最高優先的一條。

---

## 1. 結果（第一輪，**全部是 `pg_catalog` metadata，零業務資料列**）

### 1.0 量具自檢（**沒過的話下面每個 0 都不算數**）

```
角色存在        anon / authenticated / service_role / postgres / pcm_audit_ro  ⇒ 五個都在
pg_catalog 可讀  pg_attribute 欄位總數 = 4938（非 0）
分母            關聯 354 個 / 非系統 schema 14 個 / 函式 570 支
真登入          current_user = session_user = pcm_audit_ro
庫別            to_regclass('public.customers') ⇒ 無、('public.orders') ⇒ 無 ⇒ 不是網站庫
```

### 1.1 五條預測的驗收 —— **四中一「中但理由不同」**

| # | 預測 | 實得 | 判 |
|---|---|---|---|
| **P1** | anon 可 SELECT 關聯 5–30 | **15**（分母 143） | ✅ |
| **P2** | anon 可執行的 SECDEF = 0 | **0**（SECDEF 60 支 / 函式分母 570） | ✅ |
| **P3** | `pg_default_acl` 有數筆、grantee 含 anon/authenticated | **27 筆**，`public`／`graphql`／`graphql_public`／`storage` 四個 schema 的預設授權**確實含 `anon`** | ✅ |
| **P4** | 沒有客戶 PII 表對 anon 開著 | **沒有** | ✅ |
| 🔴 **P5** | 成本／毛利欄 anon **讀不到** | **讀不到，0 個** | ✅ **但理由與我想的不同，見 1.2** |

### 1.2 🔴 P5：**經銷價／成本在報價單庫對 `anon` 是關著的 —— 這是量到的，不是推的**

```
全庫欄名像成本/經銷/毛利的        16 個欄位、涉及 7 個關聯
  pattern: cost|dealer|margin|profit|wholesale|purchase_price|supplier_price
正向對照（證明 pattern 活著）      同一支換成 'price' ⇒ 51 個欄位
🔴 anon 讀得到的（schema USAGE + 欄級 SELECT 並查）  ⇒ 0 個
🔴 對照（同一個欄級判定式對 postgres）              ⇒ 16 個  ← 判定式是活的
```

⇒ **那個 0 兩邊都有對照撐著**：pattern 活的（51）、判定式活的（16）。

**擋法查明了，而它與 A 庫【不是同一套】**（所以不能互相引用）：

| 物件 | anon | authenticated | service_role | postgres |
|---|---|---|---|---|
| `public.dealer_price_v` | **f** | **f** | t | t |

⇒ **經銷價住在一支獨立的 view 裡，而那支 view 根本沒有發給 `anon`／`authenticated`。**
（A 庫是靠 `price_by_tier` **欄級** `f` 擋的 —— **同樣的結果，不同的機制**。）

**而 anon 唯一讀得到的業務物件 `public.storefront_catalog_v` 逐欄看過（30 欄）**：
價格欄**只有 `price_retail`**（零售價，本來就要對外）。**無 cost／dealer／margin／supplier price 任何一欄。**

### 🔴 1.3 **更正（2026-08-17 第二輪自查）：下面那個 `15` 是錯的，正確是 `16`**

**我用 `has_table_privilege` 算 §1.3，而它看不到【欄級】授權 ⇒ 少報。**

```
表級版  anon 可讀關聯 = 15
欄級版  anon 可讀關聯 = 16          ← 正確
差集    public.products（RLS=true） ← 只差這一個，而它是本庫最核心的表
```

**`public.products` 的實況（欄級量的）**：

```
總欄數 57  |  anon 欄級可讀 31  |  authenticated 欄級可讀 2  |  對照 postgres 57
relacl 原文：postgres / service_role / pcm_reparse_owner —— 【表級】確實沒有 anon
RLS policy：storefront_public_read  FOR SELECT  TO anon     ← 而 RLS 這一層是給 anon 的
```

⇒ **設計是一致的、不是漏洞**：`anon` 拿到的是 **57 欄裡的 31 欄**＋一條**限定它的 RLS policy**，
再由 `storefront_catalog_v`（`security_invoker=true`）以**呼叫者權限**讀出去。

🔴 **而我原本預測這裡會有矛盾** —— 我以為 `security_invoker=true` 的 view + 「anon 對底表無權」
會讓 storefront 根本讀不到。**那個預測錯了，錯的原因是我的量法太粗。**

### 🔴 1.3-a 這次踩到的是**我自己在同一份流程裡寫過的那條**

開跑清單 §3-3 逐字：**「`has_table_privilege` 看不到欄級授權（少報）」**。
**我讀過它、抄進了 §1.2 的 P5 檢查（那裡我用的是 `has_column_privilege`，所以 P5 的結論不受影響），
然後在 §1.3 用了表級。**

⇒ 📎 traps `㊺`：**正在書寫某條規則的當下，是它最容易被違反的時刻。**
⇒ 📎 而它同時是 `㊹` 的「站錯位置」：**量具的解析度比被量的東西粗一級。**

### ✅ 這次更正**不改變**的結論（逐條講清楚，免得被讀成全盤翻案）

| 結論 | 受影響嗎 |
|---|---|
| **P5 成本／毛利欄 anon 讀不到** | ❌ **不受影響** —— P5 從一開始就用**欄級**判定。**且本輪在 `products` 上再獨立驗一次**：該表成本類欄位 **1 個**、**anon 讀得到 0**、對照 `postgres` **1** |
| `dealer_price_v` 對 anon/authenticated 皆 `f` | ❌ 不受影響（那是表級沒發、欄級也沒發） |
| 疑似含祕密欄位 anon 可讀 = 0 | ❌ 不受影響 —— 那條也是用**欄級**算的 |
| **§1.3 的「15」與「業務面只有 2 個」** | 🔴 **受影響，已更正為 16 / 業務面 3 個**（多 `public.products`） |

---

### 1.3-b anon 讀得到的物件（**原表級版，數字已由上方更正**）

```
public.storefront_catalog_v   ← 型錄 view,storefront 就是靠它,security_invoker=true
public.term_synonyms          ← 同義詞表,RLS 開著
其餘 13 個全是平台物件:storage.* ×7、realtime.* ×2、net.* ×2、extensions.pg_stat_statements* ×2
```

📌 **順帶量到「只查表級會多報」的幅度**：只看表級 ⇒ **17**，兩層並查 ⇒ **15** ⇒ **多報 2 個**。
（那 2 個有表授權但進不去 schema。**這就是為什麼斷言要兩層並查。**）

---

## 2. 🔴 兩條要繼續追的（**都不是已證實的洞，是未閉合的鏈**）

### 2.1 `net.*` 兩張表對 `anon` 開著，而**那條鏈是活的不是理論的**

```
net.http_request_queue   anon 可讀   目前 0 列
net._http_response       anon 可讀   目前 6 列   ← 🔴 有東西 ⇒ pg_net 正在被使用
```

**為什麼這條要緊**：`cron.job` 有 **2 支排程**的定義命中 `bearer|secret|token|key|password`
（`fuse-recompute-prices`／`line-followup-hourly`，2026-08-16 Sean 實跑）。
**若它們透過 `pg_net` 送出請求，`Authorization` 標頭會經過 `http_request_queue`，回應留在 `_http_response` 約 6 小時。**

⚠️ **鏈上有一環我【沒有】驗，明說**：**我沒有讀那兩張表的內容，也不打算讀。**
（為了論證危險而寫下的證據，本身就複製了那個危險。）

🔴 **而有一件事讓嚴重度大幅下降，也是量到的**：

```
anon 的 rolcanlogin = f   ← anon【不能直接登入資料庫】
```

⇒ 外部要用 `anon` 身分讀那兩張表，**只能透過 PostgREST**，而 PostgREST 只暴露被設定的 schema。
⚠️ **那份設定我從 DB 查不到**（`pg_db_role_setting` 裡沒有 `pgrst.db_schemas`，實查 8 筆設定無此項）
⇒ 🔴 **「外部打不打得到 `net` schema」= 未確認。缺的檢查是：對該專案的 REST 端點打一發 `/rest/v1/` 探測，並附一個已知 200 與一個已知 404 的對照。**
**我沒有那個專案的 anon key ⇒ 這一步我現在做不到。**

### 2.2 `extensions.pg_stat_statements` 對 anon 開著，且 `security_invoker` **未設（＝false）**

`pg_stat_statements` 存的是**查詢文字**。`security_invoker` 未設的 view 以 owner 權限解析底層物件。

⚠️ **我沒有驗 anon 實際看得到什麼** —— 該擴充套件本身會依呼叫者身分把別人的查詢文字換成
`<insufficient privilege>`，**但那是我讀規格推的，不是我量的**，而且我**無法用 `SET ROLE` 代替**
（`pcm_audit_ro` 不是 `anon` 的成員；且 `SET ROLE` 本來就量不出目標角色的真實權限）。
⇒ **標未確認。** 缺的檢查同 2.1：一個真正以 `anon` 身分發出的請求。

---

## 3. 本輪**沒有**做的

| 沒做 | 出口 |
|---|---|
| **讀任何一列業務資料** | 刻意。碰之前要先報備 |
| **讀 `cron.job` 的 `command`** | 🔴 **做不到也不用做**：`has_schema_privilege('pcm_audit_ro','cron','USAGE')` ⇒ **f**。順帶量到 **`anon` 對 `cron` 也是 `f`** ⇒ **排程裡那兩個疑似祕密，`anon` 從資料庫這一側碰不到** |
| PostgREST 實際暴露哪些 schema | 需要該專案的 REST 端點與 anon key |
| RLS policy 逐條讀（16 條那種） | 下一輪 |
| `storefront_catalog_v` 的**底表**是誰、RLS 怎麼設 | 下一輪 |
| B 窗要的 `#4`（production schema vs repo 一致性） | 下一輪，**這條做完直接給 B 窗** |

📌 **順帶實測（本庫值，不是搬 A 庫的）**：`statement_timeout` ⇒ `anon=3s`／`authenticated=8s`／`authenticator=8s`。
**與 A 庫的更正後數值相同 —— 但這是各自量的，不是引用。**
