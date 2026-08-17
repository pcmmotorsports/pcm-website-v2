# `E686-1` 守門規格 —— `net` 兩表對 anon 是**全 DML + TRUNCATE**,而只有「讀」那一半被記錄過

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**面**:網站庫 `pcm-website-v2`(報價單庫同型,見 §6)
- **性質**:**規格,不是實作。** E 唯讀 ⇒ 本檔只出規格與驗法,**不改 code、不跑 migration**。實作歸施工窗。
- **正本 finding**:`docs/security/2026-08-16-external-exposure-audit.md` §4 `E686-1`。

---

## 1. 上層(白話,先看這段)

pg_net 這個外掛有兩張表,一張存「**要送出去的請求**」、一張存「**送出去之後拿回來的回應**」。我們的排程(每 2 分鐘跑一次的結算兜底)就是靠它們運作的,而**我今天驗「結算兜底有沒有在跑」,看的就是那張回應表**。

問題:這兩張表**對「網站訪客」這個身分是全開的** —— 不只看得到,還**改得動、刪得掉、能整張清空**。

🔴 **要緊的不是「資料被看走」,是「紀錄可以被動手腳」**:那是我用來證明系統有沒有正常運作的那本帳。帳可以被改 ⇒ **我今天所有基於它的結論,嚴格說都只在「沒有人動過它」這個前提下成立。**

**現在為什麼還沒出事**:訪客只能透過一個叫 PostgREST 的門進資料庫,而那扇門**目前沒有把 `net` 這個區域放進開放清單**。⇒ **擋著的只有這一道,而它是 Dashboard 上的一個設定,不在程式碼裡。**

---

## 2. 量到的事實(可重跑;每條附量法)

### 2.1 權限矩陣 —— 五項全開,兩張表、兩個角色

```sql
SELECT r.rolname, t.tbl,
       has_table_privilege(r.rolname,t.tbl,'SELECT')   AS sel,
       has_table_privilege(r.rolname,t.tbl,'INSERT')   AS ins,
       has_table_privilege(r.rolname,t.tbl,'UPDATE')   AS upd,
       has_table_privilege(r.rolname,t.tbl,'DELETE')   AS del,
       has_table_privilege(r.rolname,t.tbl,'TRUNCATE') AS trunc
  FROM pg_roles r
  CROSS JOIN (VALUES ('net._http_response'),('net.http_request_queue')) AS t(tbl)
 WHERE r.rolname IN ('anon','authenticated') ORDER BY t.tbl, r.rolname;
```
**實測輸出(2026-08-17,`pcm_audit_ro`)**:4 列,`sel/ins/upd/del/trunc` **全部 `t`**。

ACL 來源(`relacl` 第二項 grantee 為空 = `PUBLIC`,權限字串 `arwdDxtm` 含 `a`=INSERT `w`=UPDATE `d`=DELETE `D`=TRUNCATE):
```
_http_response     owner=supabase_admin  {supabase_admin=arwdDxtm/supabase_admin,=arwdDxtm/supabase_admin}
http_request_queue owner=supabase_admin  {supabase_admin=arwdDxtm/supabase_admin,=arwdDxtm/supabase_admin}
```

### 2.2 RLS 兜不住 —— 兩層都不行

```sql
SELECT relrowsecurity AS rls_on, relforcerowsecurity AS rls_forced
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='net' AND c.relname='_http_response';
```
**實測**:`rls_on = f` / `rls_forced = f`。

🔴 **而且就算把 RLS 打開也擋不住 `TRUNCATE`** —— **`TRUNCATE` 不受 RLS 管**(這是本族既有坑,正本 `docs/patterns/revoking-function-execute-in-supabase.md`)。⇒ **「加 RLS policy」不是這條的修法**,寫規格的人不要往那個方向設計。

### 2.3 現況殘留量(**只數不讀**)

```sql
SELECT count(*) FROM net.http_request_queue;   -- 實測 0
SELECT count(*) FROM net._http_response;       -- 實測 180（6h TTL 窗）
```

🔴🔴 **驗這件事的人不得 SELECT `http_request_queue.headers`** —— 那一欄含 `Authorization: Bearer <CRON_SECRET>` **明碼**。**只准 `count(*)`。**
理由不是潔癖:**為了論證某個東西危險而寫下的證據,本身就複製了那個危險**。要證明「這欄很敏感」,引用 `20260723120000…:36-37` 的既有記載即可,不要自己撈一筆出來當例子。

### 2.4 🔴 外部目前打不到(**這是行為量測,不是設定宣稱**)

以網站庫 publishable key 打正式站 REST,**同一輪三個值不同 ⇒ 404 不是鈍訊號**:

| 端點 | 實測 | 意義 |
|---|---|---|
| `products_public` | **200** | 正向對照:key 有效、REST 通 |
| `customers` | **401** | 在曝露 schema 內、僅無權限 |
| `net.http_request_queue` | **404** | **不可達** |
| `net._http_response` | **404** | **不可達** |

⚠️ **口徑(這條最容易被寫壞)**:上表量到的是「**外部經 REST 現在打不到**」= **行為**。
它**不等於**「Dashboard 的曝露清單內容是 X」= **設定**。**本檔不對設定清單下斷言** —— 那要 Sean 在 Dashboard 展開才算(已請他確認,回報前一律「未確認」)。

### 2.5 🔴 SQL 修法路線 —— **已實測不可行,不要再試**

```sql
SELECT rolname, rolsuper FROM pg_roles WHERE rolname IN ('postgres','supabase_admin');
```
**實測**:`postgres` ⇒ `rolsuper = f`;`supabase_admin` ⇒ `t`。

⇒ `net` 物件與其 grant **全由 `supabase_admin`(superuser)授予**,而我們能用的最高身分 `postgres` **非 superuser** ⇒ **`REVOKE` 對它靜默 no-op(不報錯、也沒效果)**。
**既有記載**:`supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:16-21`(當時已實測並寫明「物理不可行」)。

🔴 **規格明令**:**不要留一條 `REVOKE ... FROM PUBLIC` 給下一個人去試。** 它會「跑成功」而**什麼都沒發生** —— 那比失敗更糟,因為會留下一份「我修好了」的錯誤紀錄。

---

## 3. 守門規格(**偵測型,不是強制型** —— 這一節是本檔重點)

### 3.1 🔴 先講清楚這道守門的性質與它的天花板

**它守的那個東西不在 repo 裡。** 曝露清單是 Supabase Dashboard 的設定,**repo 內任何 grep / 測試 / CI 都看不到它**;三綠**恆綠**、覆蓋率**算不到**。

⇒ **這道守門只能「偵測狀態變了」,不能「阻止狀態被改」。** 寫的人與讀的人都要接受這個天花板:
- ❌ 它**擋不住**有人去 Dashboard 把 `net` 加進清單。
- ✅ 它能在**加進去之後**、下一次跑的時候**叫出來**。
- ⇒ 因此**偵測頻率就是暴露窗**。這句要寫進實作的註解裡,否則下一個人會以為它是道牆。

### 3.2 觀測點:**外部 REST 探針**,不是 repo grep

**位置**:對正式站 `/rest/v1/` 發 GET,不需登入、不需 service_role,只需 publishable(anon)key。

**斷言形狀(三格,缺一不可)**:
| 格 | 打什麼 | 期望 | 為什麼要它 |
|---|---|---|---|
| **A 正向對照** | `products_public?select=id&limit=0` | **200** | 證明「探針本身是通的」。**沒有這格,一個網路故障會被讀成『很安全』。** |
| **B 判別力對照** | `customers?select=id&limit=0` | **401** | 證明「404 不是我打錯路徑的通用回應」——曝露 schema 內的表回的是 401。 |
| **C 主張** | `http_request_queue` 與 `_http_response` 各一發 | **404** | 主斷言:`net` 不可達。 |

🔴 **三格必須在同一次執行內全部通過才算綠**。只有 C 綠 = 恆綠格(斷網、key 過期、專案睡著都會給你 404)。

🔴 **失敗時要印的是【三格各自拿到什麼】,不是「不安全」** —— 兩個世界要印不同的值,而「不安全」在「真的曝露了」與「探針壞了」兩個世界是同一句話。

### 3.3 跑在哪、多久跑一次

- **不要放進單元測試 / 三綠**:它打的是**正式站**、依賴**外部網路**,放進去會做出一個時好時壞的測試,而**假紅比沒有守門更糟**(團隊會學會忽略它)。
- **建議**:獨立腳本 `scripts/probe-net-schema-exposure.sh`,由**人**或**排程**跑;納入既有的部署後 smoke / milestone 收尾清單。
- **頻率 = 暴露窗**(見 §3.1),由指揮者定;**Dashboard 動過設定之後必跑一次**是硬要件。

### 3.4 順帶(同一支探針幾乎免費多守的)

`cron` / `vault` / `auth` / `extensions` 這幾個 schema 同樣**不該**經 REST 可達,而它們的曝險等級**比 `net` 更高**(`vault` 存的就是 `cron_secret` 本體)。⇒ **探針的 C 格建議一次列這幾個**,邊際成本接近零。
⚠️ 但**逐一附期望值**,不要寫成迴圈然後只斷言「全部都是 404」——那句在「清單是空的」時**恆真**(本族既有坑:`feedback_absence-read-as-verified`)。

---

## 4. 不做什麼(避免把規格寫成新的風險)

- ❌ **不寫 `REVOKE`**(§2.5:已實測 no-op)。
- ❌ **不加 RLS policy 當修法**(§2.2:`TRUNCATE` 不受 RLS 管)。
- ❌ **不 SELECT `headers` 欄**(§2.3),包含「為了寫報告舉個例」。
- ❌ **不對設定清單下斷言**(§2.4),那要 Sean 在 Dashboard 展開。
- ❌ **不把探針塞進三綠**(§3.3)。

---

## 5. 這條的嚴重度為什麼是「低-中(潛伏)」而不是高

- **低**的那一半:外部**現在打不到**(§2.4 量到的,含正負對照),⇒ **今天沒有可利用路徑**。
- **中**的那一半:①擋著的**只有一道 Dashboard 設定**,沒有第二層;②後果**不是洩漏是湮滅**(可 `TRUNCATE` 稽核軌跡)⇒ 它會**破壞事後調查的能力本身**;③這一半**從未被任何文件記錄過** —— `20260723120000…:26` 只寫了「anon 即可讀 headers」,寫/刪/TRUNCATE 那一半**沒有人寫下來過**。
- 🔴 **③ 才是這條值得開的理由**:有人查過這張表、**寫下了他看到的那一半**,而下一個人讀到那段會以為**整張表都被評估過了**。

---

## 6. 報價單庫(`pcm-quote-v2`)同型,**未逐項複驗**

`pcm_audit_ro` 在**兩個庫**對 `net` 都有 `USAGE`(實測 `has_schema_privilege` ⇒ 兩庫皆 `t`),且 pg_net 的 PUBLIC 授予來自**外掛安裝 SQL、非本專案**(⇒ 兩庫同源、**推論**)。
⚠️ **標未確認**:報價單庫的**權限矩陣與外部 REST 三格對照我這一輪沒跑**。要下結論請照 §2.1 / §2.4 對報價單庫各跑一次(`~/.pcm-readonly-quote-db` + `~/.pcm-quote-anon-key`,**兩把 anon key 同長度同前綴、開打前先做庫別三發對照**)。

---

## 7. 口徑

權限矩陣 / RLS 旗標 / `rolsuper` / 殘留列數 = **`pcm_audit_ro` 唯讀 SQL 實測**(2026-08-17,量法附在各處)。外部可達性 = **publishable key 打正式站 REST 實測**,含正向與判別力對照。**曝露清單的設定內容 = 未確認**(Sean 在查)。修法不可行性 = `20260723120000…:16-21` 既有實測 + 本輪 `rolsuper` 複核。**全程唯讀:只有 SELECT 與 GET,零寫入、零 DDL、未讀 `headers` 欄。**
