# 報價單 `3-App` 路由盤點(**盤點與分類,零滲透測試**)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**狀態**:**盤點,未打任何一發**
- **標的**:`/Users/sean_1/API大量上架/PCM報價單-V2`(**另一個 repo**;本輪**唯讀,未動它任何檔**)
- **理由**:滲透測試計畫 §9-1 `M1` —— 這一面先前是**零**,而**目錄裡有名字的零,執行時會被當成已涵蓋**。

> 🔴🔴 **2026-08-17 深夜 · 本檔有兩處結論被 Sean 的答案改寫,引用前先看這兩節**
> ```
> 附錄 A-3  ✅ 原「token 永久有效」→ 推翻,且**這條風險已關閉**。
>              DDL 逐字:`expires_at ... DEFAULT (now() + '30 days'::interval) NOT NULL`
>              ⇒ 窗長 **30 天**(已讀真值);`NOT NULL` ⇒ null 寫不進去 ⇒ 不是「沒踩到」是「不可能」
>              ⚠️ 本檔中間一版寫過「code 層的洞還在、只要有一列寫成 null」—— **那版也錯了**,見 A-3
> 附錄 D-2  ❌ 原「2FA 是解藥、已在 code 裡」→ 現實不成立。Sean 答 2FA 沒開
>              ⇒ legacy 降級路徑【現在是活的】，「強制重新登入」對它無效 ⇒ 嚴重度上修
> ```
> **兩處的原文都照留在各自小節裡**(不刪,供對帳)。**舊結論不得再引用。**

---

## 🔴 0. 頭條:**不是 66 支要逐支看,是 8 支公開可達**

**`middleware.ts` 是一道【全站閘】,不是逐路由設定。** 先讀它,分類就完全不同(這一步省掉 58 支的逐支分析):

```
matcher（:98）  '/((?!_next/static|_next/image|favicon.ico|icon.svg|logo-pcm.svg|no-photo.png).*)'
⇒ 除靜態資產外【所有路徑都過這道閘】，包含全部 /api/*
```

**放行清單(= 公開攻擊面的全部,`middleware.ts:28,36-44`)**:
```
PUBLIC_PATHS（:28）  /  、 /api/admin/login 、 /api/sso/exchange
前綴放行（:39-41）    /api/line/*  、 /api/quote/*  、 /quote/*
未登入的其餘          頁面 → 導回 /；API → 401（:46-49 deny()）
```

**分母(當場量)**
```
route.ts 總數                                    66
  ├ 公開可達（在放行清單內）                      8   ← 攻擊面第一排
  │   /api/line/*   2   ／ /api/quote/*  4
  │   /api/admin/login 1 ／ /api/sso/exchange 1
  └ 受全站閘保護                                 58
數法:find <repo>/app/api -name route.ts | wc -l ⇒ 66
     find <repo>/app/api/{line,quote} -name route.ts ⇒ 2 / 4
     其餘 = 66 − 8 = 58（grep -vE 反向列舉核對過）
```

✅ **一個做對的設計值得記(`:33-34`)**:
```js
const isServerAction = req.method === 'POST' && req.headers.get('next-action') != null;
// server action 一律【不走公開放行】→ 落到要求登入（縱深；action 另有 requireAdmin）
```
⇒ **公開前綴不會被 server action 借道。** 這是主動想過的縱深,不是預設行為。

---

## 1. 公開可達的 8 支 —— 逐支的認證機制(**都不是裸的**)

| # | 路由 | 認證機制 | 位置 |
|---|---|---|---|
| 1 | `/api/admin/login` | 密碼 + `timingSafeEqual` / `createHash` | `route.ts:2,43-56` |
| 2 | `/api/line/cron` | `CRON_SECRET` Bearer;**未設 → 500 fail-closed** | `:11-12` |
| 3 | `/api/line/webhook` | LINE 簽章 `x-line-signature` | `:59` |
| 4 | `/api/quote/cleanup` | `CRON_SECRET`;未設 → 500 | `:43-44` |
| 5 | `/api/quote/auth-cleanup` | `CRON_SECRET`;未設 → 500 | `:15-16` |
| 6 | `/api/sso/exchange` | `PCM_SSO_EXCHANGE_SECRET` Bearer,常數時間比對 | `:2,8,28` |
| 7 | `/api/quote/dealer-update` | 🔴 **不可猜 token(車行 token)** | `:53` |
| 8 | `/api/quote/submit-selection` | 🔴 **不可猜 token(customer_token)** | `:90-96,177` |

**✅ 一個反覆出現的正確 pattern**:三支 cron 端點都寫著
「`CRON_SECRET` 未設 → **500**(否則 `Bearer undefined` 會被偽造命中)」
⇒ **fail-closed,而且註解寫明了為什麼**(`/api/quote/*` 是公開前綴,錯了就直接對外)。

### 1-b 🔴 第 7、8 支是**公開寫入端點**,信任模型是「誰握 token 誰是該角色」
`dealer-update:4-6` 逐字:
> **車行頁 `/quote/<token>` 是公開的(車行無 PCM 後台密碼),故此端點 = 公開 + 用「車行 token」自驗,
> 與 `submit-selection`(用 `customer_token`)同信任模型:**誰握 token 誰是該角色**。
> 防升級:`getSnapshotByToken` 只用 token 欄;客人只有 `customer_token` → 用在此查無 → 404。**

**已具備的緩解(量到)**:只寫**單一欄**、只寫 **token 命中那一列**、`quoteRateLimit`、
`anon` 經 RLS deny-all 無法直寫(唯一寫路徑是 route 的 `service_role`)。

🔴 **⇒ 這兩支的安全性【完全等於 token 的不可猜性】,那是這一面最該打的地方**(留給執行輪,本輪不打):
```
· ~~token 熵夠不夠？怎麼產生的？（本輪未查）~~  ✅ **已答，見附錄 A-1:CSPRNG／128 bit**
· ~~quoteRateLimit 的實際門檻與作用域（本輪未讀）~~ ✅ **已答，見附錄 A-1:20 或 30 次／60 秒／IP**
· 「客人 token 用在車行端點 → 404」這條【防升級宣稱】要實測
  兩個世界會不同的值:拿 customer_token 打 dealer-update ⇒ 404 才對；200 就是提權
  ⇒ **執行輪第一項**（要發請求，本輪不做）
· token 會不會出現在 Referer / 分享連結 / log（本輪仍未查 ⇒ 未確認）
🔴 **而附錄 A 的結論把這一段的前提改了**:安全性**不是**等於「不可猜性」——
   128 bit 之下爆破不可行 ⇒ **真正的風險是洩漏後無法區分**（見 A-4）。
```

---

## 2. 受閘保護的 58 支 —— **本輪不逐支看,但閘本身要驗這幾條**

**理由**:它們共用**同一道閘**,所以要打的是**閘的旁路**,不是 58 支各自的邏輯。

```
① 前綴放行是【字串前綴】比對（:39-41 startsWith）
   ⇒ 要驗有沒有路徑穿越 / 大小寫 / 編碼變體能偽裝成 /api/quote/ 開頭
   （本輪未測 ⇒ 未確認）
② SESSION_SECRET 未設時【忽略新 cookie、退回 legacy】（:53-57 註解自述）
   ⇒ 那是刻意的（避免缺 env 反而鎖死），但它是一個【降級路徑】
   ⇒ 要驗:legacy 路徑在 2FA 未開時可用（:82-90），而 legacy cookie 無 amr/ver、
     token_version bump 撤不掉（:80-81 自述）
③ 2FA 開啟後拒 amr=['pwd'] 的舊 session（:62）—— 要驗這條真的會拒
④ sliding refresh 只在非 API GET 且非 prefetch 時重發（:68-73）
```
🔴 **②③ 是 code 註解【自己寫出來的弱點】** —— 那不是我發現的,是作者標的。
**而註解標了不等於被驗過**(今晚 `#626` 的母題)⇒ **這三條要進執行輪的清單。**

---

## 3. 🔴 第五格:**跨 repo 的同類判定 —— 找到一個真的耦合**

主視窗要的第五格是「這一支的 auth 判定與 admin 那邊的同類判定是不是同一套」。
**兩個 repo 的 auth 堆疊結構上不同**(報價單走自建 HMAC session + 密碼;網站庫走 Supabase auth)
⇒ **不是「同一份判定被抄成兩份」那種病。**

**但有一個真的耦合,而且兩邊都看不到對方**:
```
env 變數名 `CRON_SECRET` 【兩個 repo 都在用】
  報價單:4 檔（grep -rl 'CRON_SECRET' --include='*.ts'）
  網站庫:7 檔（git grep -l 'CRON_SECRET' -- apps packages）
```
🔴 **而「它們是不是同一個值」,在任何一個 repo 裡都查不到** —— 那是兩個 Vercel 專案的設定。
```
同值 ⇒ 任一邊洩漏，另一邊的 cron 端點【一起淪陷】，而各自的 repo 完全看不出來
異值 ⇒ 沒事，但【沒有任何東西記錄著這件事】，下一個人一樣要重問
```
⚠️ **我方未確認是同值或異值** —— 缺的檢查:看兩個專案的 env 設定(我沒有面板權限)。
⇒ 🔴 **這一格請進滲透測試計畫的「面四:外部整合憑證」**,它正是那一面的典型:
**一個橫跨兩個信任邊界、而任一邊都無法自證的憑證。**

**另注**:兩邊的驗證嚴格度**寫法不同** —— 網站庫的 cron 是 `timingSafeEqual` + `<32` fail-closed
(V 窗量到);報價單是 `未設 → 500` + Bearer 比對。**本輪未逐字比對兩邊的比對函式是否等強** ⇒ 未確認。

---

## 4. 本輪**做到哪裡 / 沒做什麼**(🔴 不抽樣然後報成盤點)

```
✅ 做了  middleware 全文讀完（99 行）、放行清單逐條列出、66 支分母核對
        公開可達 8 支【逐支】確認認證機制並附 檔案:行號
        跨 repo CRON_SECRET 耦合（附兩邊數法）
❌ 沒做  · 受閘保護的 58 支【一支都沒讀內容】——本輪刻意，理由見 §2
        · 8 支公開端點的【邏輯正確性】只看認證那一段，沒有逐行讀完
        · ~~token 熵、quoteRateLimit 門檻~~ ✅ **附錄 A 已補**（2026-08-17 夜，純讀 code）
        · 防升級宣稱 —— 仍未測（要發請求）
        · 前綴放行的路徑穿越 / 編碼變體 —— 未測
        · CSRF / session 狀態機矩陣 —— 未做（那是執行輪的事）
        · 🔴 未跑任何一發請求。本輪零網路流量、零寫入。
```
⚠️ **口徑**:本檔是**分類**,不是**保證**。「有認證機制」≠「認證正確」。
上表第 1 欄的每一支我都**只看了認證那幾行**,**沒有驗證它擋得住**。

## 5. 口徑
`middleware.ts` 全文、放行清單、66/8/58 三個數、8 支的認證位置、`CRON_SECRET` 兩邊檔數
= **2026-08-17 當場實查**。
**「兩個 repo 的 `CRON_SECRET` 是否同值」= 未確認,缺面板權限。**
**token 熵、rate limit 門檻、防升級宣稱、前綴穿越 = 未測,已列進執行輪清單。**
**本輪未動報價單 repo 任何檔案、未送任何請求。**

---

# 附錄 A · 公開寫入端點的 token 熵(**純讀 code,零請求**,2026-08-17 夜)

## A-1 結論先講:**熵不是這兩支的弱點,而且差得很遠**

```
產生器  lib/quote-token.ts:6-12  generateQuoteToken()
        crypto.getRandomValues(new Uint8Array(16))   ← 🔴 CSPRNG，不是 Math.random
        → base64url 22 字元（A-Za-z0-9-_），去掉 padding
熵      16 bytes = **128 bit**（檔頭 :2 自述亦為 128 bit，與實作一致）
兩支都是它  lib/quote-snapshot.ts:223  token = generateQuoteToken()
            lib/quote-snapshot.ts:224  customerToken = generateQuoteToken()
        ⇒ 車行 token 與客人 token【同一個產生器、同樣 128 bit】
```

**rate limit(實際數字,call site 讀出)**
```
/api/quote/submit-selection:77   quoteRateLimit(req,'qsub',   60, 20)  ⇒ 20 次 / 60 秒 / IP
/api/quote/dealer-update:40      quoteRateLimit(req,'qdealer',60, 30)  ⇒ 30 次 / 60 秒 / IP
```

**「猜中一個要多久」(算式與假設都寫出來)**
```
單一 token 的期望嘗試次數 ≈ 2^127 ≈ 1.7 × 10^38
單一 IP 一年可送            20 × 60 × 24 × 365 ≈ 1.05 × 10^7 次
⇒ 單 IP:1.7e38 / 1.05e7 ≈ **1.6 × 10^31 年**
⇒ 就算動用 100 萬個 IP 完全繞過 per-IP 限速:≈ **1.6 × 10^25 年**
   （宇宙年齡 ≈ 1.4 × 10^10 年 ⇒ 約為其 10^15 倍）
⇒ 就算庫裡有 100 萬張有效報價（撞任一張）:2^128/10^6 ≈ 3.4e32 次
   ÷ (100 萬 IP × 1.05e7) ≈ **3.2 × 10^19 年**
```
🔴 **假設寫明**:上述只算**線上**猜測。**離線爆破在此不適用** —— token 不是雜湊比對,
攻擊者手上沒有任何可離線驗證的材料,**每一次猜測都必須送一個請求**。
⇒ **結論:爆破不是這兩支的威脅模型。rate limit 在這裡不是防爆破的,是防灌爆寫入成本的**
(`quote-guard.ts:11` 註解自述正是這個目的,**不是防猜 token**)。

## A-2 ✅ 一個我原本擔心、實查後排除的:`short_code` **不是**低熵旁路

`lib/quote-snapshot.ts:233` 用 `generateQuoteToken().slice(0, 5)` 產 `short_code`
⇒ 只有 5 字元(≈30 bit),**若它能拿來查報價就是一條低熵旁路**。
**實查:它只用於顯示** —— `submit-selection/route.ts:48` 把它拼進 LINE 訊息標題
(`[待車行送單 · <short_code>]`)。
**掃描範圍**:`grep -rn "short_code" app lib --include='*.ts'` ⇒ 命中處僅
「欄位選取清單」與「訊息標題」兩類,**無任何 `eq('short_code', …)` 之類的查詢**。
⇒ 🔴 **沒有 short_code 查詢路徑。這條旁路不存在。**(負面發現,附掃描範圍。)

## A-3 🔴 有效期:**設計允許永久,而【實際資料沒有踩到】**(2026-08-17 深夜已更正)

> 🔴 **更正紀錄**:本節原本的結論是「A-3 永久有效 ⇒ 把 A-4 放大成永久」。
> **那半已被實測推翻。** 原文照留於下方引用,便於對帳:
> 「⇒ **`expires_at` 為 null 的報價,其 token 永久有效。**
> ⚠️ 實際上有多少張是 null、預設有沒有設到期,我查不到(業務表被鎖)⇒ 要有權限的角色跑一句
> `SELECT count(*) FROM quote_snapshots WHERE expires_at IS NULL`。
> **熵夠高 ⇒ 永久有效本身不致命**;但它把下面 A-4 的問題放大成**永久**。」

```
lib/quote-token.ts:16-21  isQuoteExpired(expiresAt)
  if (!expiresAt) return false;      ← null = 不判為過期（code 層的洞，仍在）
```

**那句 SQL 已經有人跑了。Sean 2026-08-17 貼回的輸出(照抄,未重打)**:
```
total 307 | never_expire 0 | last_30_days 126 | dealer_opened 0
```
⇒ ✅ **307 張裡 `never_expire` = 0 ⇒ 沒有一張是永不過期的。**
⇒ 🔴 **所以「把 A-4 放大成永久」這個推論的【前提不成立】,已撤。**
   A-4 仍然成立,但它的時間窗是**有限**的。

> 🔴🔴 **二次更正(2026-08-18,已去讀 DDL)。上面那版的【方向對、機制錯】。**
> 我當時寫的兩層是:
> 「code 層 洞還在 —— **只要有一列寫成 null**,那張就不會過期,而 code 不攔 /
>   資料層 今天沒有一列踩到(307 / never_expire 0)」
> **⇒ 寫不進去。那個欄是 `NOT NULL`。**

**當場讀到的真值(逐字)**:
```
/Users/sean_1/API大量上架/PCM報價單-V2/supabase/migrations/20260730000000_baseline_schema.sql:4592
  （CREATE TABLE public.quote_snapshots 起於 :4588）

    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
```
⇒ ✅ **窗長 = 30 天**(Sean A3「30 還是 60 我忘了」⇒ **是 30**,不再是未確認)。
⇒ 🔴 **`NOT NULL` 才是關鍵**:`never_expire = 0` **不是「今天剛好」,是【不可能】。**
   ⇒ 這條風險**在 schema 層就關閉了**。

**現在的正確三層**:
```
DB 層    ✅ NOT NULL + DEFAULT now()+30 days ⇒ 關閉
code 層  ⚠️ `if (!expiresAt) return false` 仍在，但對這張表【到不了】—— 防禦性分支
型別層   📌 app/quote/_lib/snapshot-read.ts:33 宣告 `expires_at: string | null`
           ⇒ TS 型別比 DB 寬。不是漏洞（DB 擋著），但型別與 schema 不一致。
```
⇒ **A-4 的洩漏面時間窗 = 最長 30 天(自建立起算)。**

## A-4 🔴🔴 真正的風險不是熵,是**洩漏後無法區分**(這才是 bearer token 模型的病)

**觀測端實查**:
```
token 查無 → 純 404，無記錄、無告警
  submit-selection/route.ts:97   return … { status: 404 }
  dealer-update:  grep -cE "console\.(warn|error)|alert|notify|captureException" ⇒ **0**
  submit-selection: 同 pattern ⇒ 5（逐一看過:皆為其他錯誤路徑，非「token 猜錯」偵測）
唯一的痕跡  login_rate_buckets（per-IP 計數）
            而它由 auth-cleanup cron【每天清掉 1 小時前的舊窗】(quote-guard.ts:7-8 自述)
            ⇒ 不是稽核軌跡，是限速用的暫存
```
🔴 **推論(不是量到的,標清楚)**:一個**合法持有 token 的人**與一個**撿到 token 的人**,
在這兩支端點上**送出的請求完全一樣** ⇒ **系統分不出來,而且沒有留下可事後追查的軌跡。**

**⇒ 所以真正該防的是「token 怎麼流出去」,不是「token 會不會被猜到」**:
```
· 車行頁 /quote/<token> 是公開網址 ⇒ 轉貼、截圖、瀏覽器歷史、Referer 外洩
· token 在 URL 路徑上 ⇒ 會進 CDN log／瀏覽器歷史／分享預覽
  ⚠️ 本輪【未查】Referer policy 與 CDN log 保留策略 ⇒ 未確認
· ~~永久有效（A-3）⇒ 一旦流出，沒有自然失效點~~
  🔴 已更正(二次):窗長 **30 天**（DDL 真值，見 A-3；`NOT NULL` ⇒ 不存在永久那種）
  ⇒ 一旦流出，【30 天之內】沒有辦法主動作廢它（沒有撤銷機制）—— 這半仍然成立
```
📎 **這正是 `M10`(零觀測的控制平面)的一個具體實例**:
**不是「爆破偵測不到」(爆破本來就不可行),是【token 濫用與正常使用在觀測上完全同形】。**

## A-5 執行輪的第一項(**要發請求,本輪不做**)

> 🔴 **防升級宣稱實測**:拿 `customer_token` 打 `/api/quote/dealer-update`。
> **兩個世界不同的值很乾淨:404 才對;200 就是提權。**
> 依據 `dealer-update/route.ts:6` 註解自述「客人只有 `customer_token` → 用在此查無 → 404」。

**其餘未做(逐條)**:rate limit 的分散式繞法實測、Referer/CDN log 外洩面、
~~`expires_at IS NULL` 的實際張數(缺權限)~~ ✅ **已由 Sean 跑出:307 中 0 張,見 A-3**、
token 是否出現在任何 log。
✅ ~~新增一項未做:讀報價單專案寫 `expires_at` 的那段 code,取回 30 或 60 天的真值~~
   **已做(2026-08-18)**:真值 = **30 天**,且欄為 `NOT NULL`。逐字 DDL 見 A-3。
   📌 順帶量到:app 層 `lib/quote-snapshot.ts:258` 的 insert **根本沒寫 `expires_at`**
      ⇒ 值完全來自欄預設 ⇒ 改預設就是改全站有效期,而 app 層 grep 不到任何線索。

## A-6 口徑
產生器、熵、兩支的 rate limit 參數、`short_code` 無查詢路徑、`isQuoteExpired` 的 null 語意
= **2026-08-17 當場讀 code 實查**(皆附 `檔案:行號`)。
**「猜中要多久」= 依上述參數計算,算式已列,假設已標(僅線上猜測、無離線爆破面)。**
**A-4 的「分不出來」= 推論,非量到。**
~~`expires_at IS NULL` 張數 = 查不到,缺有權限的角色~~
✅ **已量到(2026-08-17 深夜更正)**:Sean 貼回 `total 307 | never_expire 0` ⇒ **量到的,不是推的**。
⚠️ 但它只證明**那一刻的正式庫**。
✅ **到期天數已讀 = 30 天**(`baseline_schema.sql:4592` DDL 逐字,非推論);
   且 `NOT NULL` ⇒ 「永久有效」不是「沒發生」而是**寫不進去**。
🔴 **附錄 D-2 的「2FA 是解藥、已在 code 裡」同日已更正** —— Sean 答 2FA 沒開 ⇒ **解藥未啟用**,見 D-2。
**本附錄零請求、零寫入、未動報價單 repo 任何檔。**


---

# 附錄 B · 🔴 射程確認:**Sean 那句業務前提【不涵蓋報價單】**(2026-08-17 夜)

## B-1 問題
Sean 逐字「**現在沒有正式的訂單,都還沒對外開放使用,所有都是我們自己測試的**」
= **上線前必關清單每一條的嚴重度分母**。
⇒ **若這句話被套用到報價單,附錄 A 的發現會被誤讀成「未來的風險」。**

## B-2 證據(**支持「報價單是活的」,但要看清楚每一條證明到哪**)

```
① 完整且打磨過的車行 UX（不是骨架）
   app/quote/_components/quote-view.tsx:290,609,630-635
     「複製連結」按鈕 → navigator.clipboard.writeText(customerLink)
     :630 逐字「桌機『複製連結』: ★先 await 存檔再複製★ (bulletproof)
                → 複製到的連結對應的 DB dealer_pricing 一定是最新」
   :1053 逐字描述車行操作流程「開場一句『不調也有賺』→ 一次調整全部
        (建議售價/+5/+10/+15/+20/自訂%) → 工資 → 逐件微調 → 更新報價/複製連結」
   ⇒ 證明:【車行把連結交給客人】這條流程是【做完的產品功能】，不是計畫

② 為真實流量而設的防護
   submit-selection:16  NOTIFY_COOLDOWN_MS = 60_000
     「同一張連續送出, 60 秒內只推 LINE 一次」
   ⇒ 證明:有人預期【真的會有人反覆按送出】——那是對真實使用者的防呆

③ 供應商 fetcher 沒有停，是【搬機器】
   ~/Library/LaunchAgents/ 的 plist 檔名尾綴:
     com.pcm.daily-fetchers.plist.disabled-20260731-movedtomini
   ⇒ 「movedtomini」＝ 2026-07-31 移到 mac mini 繼續跑，不是停用

④ repo 仍在積極開發:最後一顆 commit 2026-08-13（4 天前）
```

## B-3 🔴 結論與**它證明不到的那一格**

**結論**:**主視窗的射程判斷成立** —— Sean 那句話講的是 `pcm-website-v2` 的顧客站,
**報價單是另一套、對車行在用的工具,不在那句話的射程內。**

⚠️ 🔴 **但要精確**:上面四條證明的是
> **「這套系統是做完的、為真實使用者設計的、而且維運仍在持續」**

**它們【沒有】證明「今天有車行正在開連結」。**
```
缺的檢查（我做不到，業務表被鎖）:
  SELECT count(*) FROM quote_snapshots WHERE created_at > now() - interval '30 days'
  SELECT count(*) FROM quote_snapshots WHERE dealer_opened_at IS NOT NULL
  （dealer_opened_at / customer_opened_at 兩欄確實存在，見 snapshot-read.ts:72）
⇒ 那兩個數字才是「活的」的直接證據。要有權限的角色跑。
```
⇒ **口徑:「證據強烈指向活的,但未取得使用量的直接證據」** —— 不寫成「已確認活的」。

## B-4 若是活的,**實害具體是什麼**(逐欄讀出來,不是形容詞)

**`dealer-update` 寫的那一欄 = `dealer_pricing`**,型別 `quote-snapshot-types.ts:125-135`:
```
markups     各群【加價 %】   ← 🔴 這就是車行自己的利潤結構
quantities  各群數量
labor       整單工資 (NT$)
at          存檔時間
```
⇒ **撿到【車行 token】的人:看得到並改得動那張報價的加價%、工資、數量。**
⇒ **撿到【客人 token】的人:看得到客人版報價(含售價),並可送出選擇、觸發 LINE 通知 PCM。**

✅ **而一條真正的邊界守住了(值得記)**:
`quote-snapshot-types.ts:181` 逐字「**★永不在此清單★: `price_cost` / `price_source_amount` /
`price_source_currency` / `description_origin`**」
⇒ **PCM 自己的成本與來源價【不在快照裡】** ⇒ 連結外洩**不會洩漏 PCM 的成本**。
🔴 **這是刻意設計的資料邊界,不是巧合** —— 洩漏面因此被限制在「該張報價的售價與車行加價」,
**沒有擴散到 PCM 的進價結構**。

## B-5 處置建議(要主視窗裁)
```
· 附錄 A 的發現（token 洩漏後無法區分 + 永久有效）
  ⇒ 🔴 不屬於「上線前必關清單」（那份的分母是顧客站「還沒開放」）
  ⇒ 建議【另立】，標「現行系統、車行在用」
· 而它的嚴重度仍受限於 B-4:洩漏面 = 單張報價的售價/加價，不含 PCM 成本
  ⇒ 不是「資料大外洩」，是「單張報價的商業資訊 + 可被竄改」
· expires_at IS NULL 的張數 ⇒ 照舊「要有權限的角色」
```


---

# 附錄 D · `middleware` 四條旁路的唯讀判定(2026-08-17 夜,**零請求**)

**環境**:`next: ^15.1.4`(`package.json` 實查)。**判定方式**:讀 `middleware.ts` 比對邏輯
+ **本機實測 WHATWG URL 正規化**(`node -e`,對照組七個變體)。**未對報價單站送任何請求。**

## D-1 ① 前綴放行的路徑等價寫法 —— **六個不成立,一個唯讀判不出來**

`middleware.ts:38-41` 用 `PUBLIC_PATHS.has(pathname)` + `pathname.startsWith('/api/quote/')` 等**純字串比對**。
**危險的方向只有一個**:讓 middleware 看到**公開前綴**、而請求實際落到**受保護的 handler**。

**本機實測(`new URL(c, base).pathname`,Node 22 / WHATWG URL —— 與 Next 的 `nextUrl` 同一套解析)**:
```
輸入                                  正規化後 pathname           startsWith('/api/quote/')
/api/quote/../admin/users          → /api/admin/users            false   ✅ 落到要登入
/api/quote/%2e%2e/admin/users      → /api/admin/users            false   ✅ 🔴 %2e%2e【會】被解碼並摺疊
/API/quote/x                       → /API/quote/x                false   ✅ 大小寫不匹配 ⇒ 走要登入（fail-closed 方向）
//api/quote/x                      → /quote/x                    false   ✅ （落到 /quote/ 公開頁，非提權）
/api/quote/./x                     → /api/quote/x                true    ✅ 本來就是報價路由
/api/quotex                        → /api/quotex                 false   ✅ 前綴含尾斜線，不會誤放
/api/quote/..%2fadmin              → /api/quote/..%2fadmin       true    🔴 ← 見下
```
🔴 **一個我原本預期會出事、而實測推翻的**:我原本以為 `%2e%2e` **不會**被 WHATWG 解碼
⇒ 會讓 middleware 看到公開前綴。**實測顯示它會被解碼並摺疊成 `/api/admin/users`** ⇒ **這條不成立。**
**(我先寫下預期再量,量出來相反 —— 記在這裡,免得下一個人重蹈我的預期。)**

### 🔴 唯讀判不出來的那一條:`..%2f`(**編碼過的斜線**)
```
/api/quote/..%2fadmin  ⇒ pathname 原樣保留（%2f 不被解碼成 /）
                       ⇒ startsWith('/api/quote/') = true
                       ⇒ 🔴 middleware【會放行】
```
**⇒ 剩下的問題是:Next 15 的路由層之後會不會把 `%2f` 解碼並解析成 `/api/admin`?**
```
會   ⇒ 🔴 這是一條真旁路（middleware 看到公開、實際落到受保護 handler）
不會 ⇒ 該路徑無對應 route ⇒ 404，無提權
```
**我判不出來,而且【不該用猜的】** —— 它取決於 Next 內部的解碼順序。
**要一發請求才知道**:`GET /api/quote/..%2fadmin`(或任一受保護路由名)
```
兩個世界不同的值:
  回 401 / 404          ⇒ 沒有旁路
  回 200 或該保護路由的回應 ⇒ 🔴 旁路成立
```
⇒ **進執行輪,列為 `3-App` 的第二項**(第一項是防升級宣稱 404)。

## D-2 ② `SESSION_SECRET` 未設的降級路徑 —— **成立,但【不是 fail-open】**

`middleware.ts:53-57` 逐字自述:「**只有 `SESSION_SECRET` 設好(能驗)才把新 cookie 當權威**;
未設時忽略殘留的新 cookie、直接走 legacy(否則缺 env 反而鎖死)」。

**降級成什麼(逐行讀 :82-90)**:
```
SESSION_SECRET 未設 ⇒ 跳過新 cookie ⇒ 落到 legacy 雙讀
legacy 條件:!state.require2fa 且 ADMIN_PASSWORD 有設
           且 legacy cookie === adminToken(ADMIN_PASSWORD)   ← 仍需【知道密碼】
```
⇒ 🔴 **降級後仍需憑證,不是「誰都進得來」** ⇒ **不是 fail-open,是 fail-weaker。**

**但它有一個具體後果,而且 code 自己寫了(:80-81)**:
```
legacy cookie 無 amr / 無 ver
⇒ 🔴 token_version bump【撤不掉它】——「強制重新登入」對 legacy 路徑無效
⇒ 且「可被知道密碼者偽造」（:81 逐字）
```
⇒ **結論:成立,嚴重度=【撤銷失效】而非【繞過認證】。**

> 🔴🔴 **更正(2026-08-17 深夜) —— 本段原本寫「解藥已經在 code 裡」,那句在現實不成立。**
> **原文**:「✅ 而 2FA 開啟時 legacy 整條被拒(`if (!state.require2fa)`)⇒ 2FA 是這條的解藥,已經在 code 裡。
> ⇒ 執行輪要驗的是『2FA 實際是開的嗎』,那是 Edge Config 的值 ⇒ 需面板權限,我查不到。」
> **Sean 2026-08-17 已答(A2,逐字)**:「目前有登入，但是只是用密碼而已 2FA應該沒有」
> 正本 `docs/security/2026-08-17-questions-for-sean.md:29`。

**改寫後的結論**:
```
code 層     2FA 開啟時 legacy 整條被拒（if (!state.require2fa)）—— 判定式存在，形狀正確
現實層  🔴 2FA【沒有開】⇒ 那個判定式今天不會生效 ⇒ 解藥在 code 裡而【沒有被啟用】
```
⇒ 🔴 **後果:`SESSION_SECRET` 未設時的 legacy 降級路徑【現在是活的】。**
⇒ 🔴 而 legacy cookie 無 `amr` / 無 `ver`(`middleware.ts:80-81` 自述)⇒ `token_version` bump 撤不掉它
⇒ 🔴 **「強制所有人重新登入」對報價單後台【現在是無效的】。**
⇒ **本條嚴重度上修**:從「有解藥、未驗是否開啟」升成「**解藥確認未啟用**」。

⚠️ **口徑**:Sean 答的是「**應該**沒有」——那是**他的認知,不是面板讀數**。
   剩下的檢查＝看 Edge Config `require2fa` 的實際值(**需面板權限,我查不到**)。
   🔴 **但方向要對**:未確認的那一半是「會不會其實開著」,
   **保守處理＝先當它沒開**(這是安全判斷,答不出 yes 就當 no)。

## D-3 ③ 2FA 拒 `amr=['pwd']` —— 🔴 **不與 B 窗重工,但也不是我這一輪能驗的**

主視窗提示「與 B 窗那條 amr 線同源」。**我核過:不同源。**
```
B 窗那條   pcm-website-v2 的 migration / service_role / RLS —— 與 amr 無關
本條       報價單 repo middleware.ts:62 的 2FA session 判定
⇒ 兩個不同 repo、不同 auth 堆疊 ⇒ 【不重工】，但也不能互相引用結論
```
**唯讀能確認的**:`:62` 確實有 `if (state.require2fa && payload.amr.length === 1 && payload.amr[0] === 'pwd') return deny();`
⇒ **判定式存在且形狀正確**(只有密碼的 session 在 2FA 開啟後被拒)。
**唯讀判不出來**:`state.require2fa` 來自 **Edge Config**(`lib/edge-config`)⇒ **實際值不在 repo 裡**。
⇒ **要面板權限或一發請求。**

## D-4 ④ sliding refresh 範圍 —— **不成立(非安全問題)**

`:68-73` 條件:`exp - now < MAX_AGE/2` **且** 非 prefetch(無 `Next-Router-Prefetch`/`RSC` 標頭)
**且** `GET` **且** 非 `/api/`。重簽時 payload 原樣帶過(`{...payload, iat, exp}`)。
```
⇒ session 可被無限延長（只要使用者持續瀏覽）—— 這是 sliding session 的【預期行為】
⇒ 而它仍受 token_version（ver）約束 ⇒ 強制重登可以撤掉它
⇒ 🔴 唯一的殘留風險已被 D-2 涵蓋:legacy 路徑無 ver ⇒ 那條撤不掉
⇒ 本條【不另計】為旁路
```

## D-5 四條的結論一覽

| | 判定 | 依據 |
|---|---|---|
| ① 路徑等價寫法 | **6 個不成立 / 1 個唯讀判不出來(`..%2f`)** | 本機實測七變體 + 讀比對邏輯 |
| ② `SESSION_SECRET` 降級 | **成立** —— 但**不是繞過認證,是撤銷失效** | `:53-57` / `:80-90` 逐行 |
| ③ 2FA 拒 `amr=['pwd']` | **判定式存在且形狀正確;實際是否生效唯讀判不出來** | `:62` + Edge Config 不在 repo |
| ④ sliding refresh | **不成立**(預期行為,殘留風險已併入 ②) | `:68-73` |

## D-6 口徑
Next 版本、`middleware.ts` 各行、七個 URL 變體的正規化結果 = **當場實查/實測**。
🔴 **`..%2f` 那條 = 未確認,缺的是【一發請求】,已寫成兩個世界的判準。**
🔴 **`state.require2fa` 與 `SESSION_SECRET` 的實際值 = 不在 repo,缺面板權限。**
**本輪零請求、零寫入、未動報價單 repo 任何檔。**
