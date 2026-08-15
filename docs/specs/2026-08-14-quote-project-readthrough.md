# 報價單專案通讀報告(2026-08-14 夜 · B 窗)

> 交辦 = `主-B-005-DISPATCH`。**通讀報告,不是 plan。零 code、零寫入。**
> 讀的是 `/Users/sean_1/API大量上架/PCM報價單-V2` 的 **`origin/main`**(收工驗 `git status --porcelain` = 0)。
> 🔴 **Sean 逐字:「本機只是 ssh clone 過來,正本在 mac mini」⇒ 本報告全部內容都帶這條缺口,不會消失。**
> 本次**沒有 ssh 到 mac mini** —— 四個問題本機 `origin/main` 都答得出來,依紀律 1 不連。

## 0. 🔴🔴 先更正我自己 B-004 §A 的結論:**它是錯的,而且方向反了**

我在 `B-004` 寫「**據我所讀,報價單沒有『另一個系統呼叫我』的驗證方式,只有人用瀏覽器登入**」,
並據此說乙案的成本大頭在「要開機器身分、會戳到 2FA」。**這個結論不成立。**

**事實**:報價單有**兩套** server-to-server 驗證,而且其中一套**我們今天就在用**。

| 機制 | 用在哪 | 驗法 |
|---|---|---|
| `CRON_SECRET` | `/api/line/cron`、`/api/quote/cleanup`、`/api/quote/auth-cleanup` | `Authorization: Bearer` |
| `PCM_SSO_EXCHANGE_SECRET` | `/api/sso/exchange` —— 檔頭逐字「**server-to-server, 無 cookie**」 | `Bearer` + `timingSafeEqual` 常數時間比對(`route.ts:26-35`) |

`middleware.ts:16-19,38-41` 明列放行前綴 `/api/line/*`、`/api/quote/*`、`/api/sso/exchange`。
🔴 **而 `apps/admin/src/lib/sso/config.ts:24` 讀 `PCM_SSO_EXCHANGE_SECRET`、`lib/sso/exchange.ts` 就是在 POST
`quote/api/sso/exchange`** ⇒ **這條機器通道不只存在,它就是我們兩個專案之間的,而且已經在跑。**

**錯在哪(要記,不是道歉)**:我當時跑的是 `git grep -lni "...bearer..." | head -10` ——
`-l` 只給檔名、又被 `head -10` 截斷,然後我**只開了其中一支** (`gbracing-pricing`) 看到那是出站 Bearer,
就把單一樣本推成全稱句。**分母 66 支 API 我只看了 1 支。**
這次重跑全量無截斷分類:**`requireAdmin`/`requireFull2FA` 26 支、`CRON_SECRET` 3 支、兩者皆無 37 支(合計 66)**。
⇒ 同族於今天的前兩次(`~/*/` 只掃一層、`xlsx` 只掃 `.ts/.tsx`),但這次更糟:**前兩次是掃描字集窄,這次是我看了樣本卻當成普查。**

## 1. 這個專案由哪幾塊組成

| 塊 | 檔數 | 行數(.ts/.tsx/.py) | 是什麼 |
|---|---|---|---|
| `scripts/` | 238 | 47,642 | 各式維運/回填/研究腳本 |
| `app/` | 164 | 39,030 | Next.js App Router:頁面 + **66 支 API route** |
| `lib/` | 120 | 27,145 | 共用邏輯(auth、fitment parser、字典、qualifier) |
| `fetchers/` | 31 | 21,904 | **30 支供應商抓取器**(Python) |
| `components/` | 23 | 3,940 | UI 元件 |
| `supabase/` | 179 | — | migration + schema |
| `docs/` | 855 | — | 文件 |
| `tests/` | 189 | — | 測試 |

**頁面**(`app/**/page.tsx`):`admin/family`、`admin/fitment-year`、`admin/pricing`、`admin/security`、
`audit`、`dashboard`、`dictionary`、`line`、`orphans`、`quotations`、`quotations/oem`、
`quote/[token]`、`quote/[token]/c`、`quotes`、`translations`、以及首頁。
⇒ 規模上這是**比我們 admin 更大的專案**(單 `app/` 就 39k 行)。

## 2. 兩套鎖的完整運作鏈(交辦 ②)

**誰設** — `app/api/translations/update/route.ts`:`requireAdmin()` 閘 → service_role →
單筆走 RPC `update_translation_product`(檔頭逐字「products 寫入與 stale queue 結案**同 transaction**」);
群組走 `apply_translation_group`(只補 NULL)。`manually_corrected` 則由 `/audit` accept 設。

> 🔴 **2026-08-14 訂正(C 窗 M3,我逐支重跑確認):兩套鎖不是同級機制,本節原本把它們平行呈現是錯的。**
> 逐支跑 `git grep -ln "manually_corrected" origin/main -- 'app/api/**/route.ts'` ⇒ 5 支
> (`admin/fitment-year` / `audit/accept` / `audit/reject` / `dictionary/update` / `export`),
> **5 支的 `requireAdmin|requireFull2FA` 命中數皆為 0**(我另數:真的寫該欄的是 3 支 ——
> `audit/accept`×3、`audit/reject`×1、`export`×1);對照 `translations/update` ⇒ **命中 2**。
> ⇒ **`manually_corrected`(fitment 鎖)只靠 middleware session = 密碼登入;
> `translation_locked`(翻譯鎖)才在 2FA 牆後。** 這是「鎖到底有多牢」的答案,而我原本沒講出來。
> ⚠️ **作用域**:只證明「寫鎖路徑」這一族。C 窗自陳 37 支只開了 6 支 ⇒ **不是 37 支全貌,不要放大成「其餘沒保護」**
> (`middleware.ts:29-44` 白名單只有三前綴 + `/`,`/api/audit/*` 不在其中 ⇒ 仍有 session 擋)。

**誰讀** — `fetchers/base.py`:
`fetch_protected_skus()`(`:1359`)撈該供應商 `manually_corrected=true` 的 sku 集合;
`fetch_translation_locked_skus()`(`:1386`)撈 `translation_locked=true` 的。
🔴 兩者都走 `_paginated_get_json()`(`:1325`)分頁撈 —— 註解逐字:單次 GET 會在**第 1001 筆被截斷**
⇒ 鎖列保護失效 ⇒ fetcher 覆蓋人工值(**實測 RPM 2593 鎖列只保到 1000**)。這是踩過的真坑。

**怎麼跳過** — `supabase_upsert_respect_protected()`(`:1804-1878`):逐列算一個 `drop` 集合
(`sku in protected_skus` → 剝 fitment 5 欄;`translation_locked` → 剝 `_zh` 5 欄),
`clean = {k:v for k,v in row.items() if k not in drop}`,
然後 **`sig = tuple(sorted(clean.keys()))` 分組、逐組 upsert**。
`:1842-1848` 撈鎖失敗時 **fail-closed:本批不寫任何 `_zh`**。

**第三套機制(交辦沒問,但對乙案更重要)**:`PRESERVE_ON_NULL_FIELDS`(`:520`)=
`ENRICHMENT_PRESERVE_FIELDS`(`:483`,含 **`image_url` / `images`**)∪ `UNOWNED_ZH_PRESERVE_FIELDS`(`:512`)。
語意是 **COALESCE:incoming 空 且 DB 既有非空 → 保留既有**,**不綁任何鎖旗標、對所有家所有列生效**。
⇒ **「保護」在這個專案有兩種形狀:旗標鎖(可覆寫)與防洗網(只擋 null)。** 兩者代價差很多。

## 3. 乙案能不能沿用既有鏈?(交辦 ③ — **重點**)**能,而且不只沿用一半**

1. **鎖欄機制**:`PROTECTED_TRANSLATION_FIELDS`(`:467`)是一個 **frozenset 常數**,已從 3 欄擴到 5 欄
   (2026-06-12 併入 `summary_zh`/`highlights_zh`)⇒ **「多鎖幾個欄」在這條鏈上有前例、且是加字串進集合的形狀。**
2. **逐列剝欄 + key-signature 分組**:`:1865-1877` 已在生產跑,**逐列**、規模 2593+ 鎖列。
   🔴 這也順帶回答了甲案清單 A 節的疑慮:**逐列不同 key 集合 + 分組 upsert 是被證明可行的**,不是理論。
3. **UI**:`/translations` 已有勾選與鎖圖示(`translation-table.tsx:226`)⇒ 有現成的操作面可仿。
4. **機器通道**:見 §0 —— **不用新開,`PCM_SSO_EXCHANGE_SECRET` 那條就在我們兩專案之間跑著。**

⇒ **乙案比我 B-003 估的便宜得多。** 我當時說「不是『只做一個介面』那麼輕」——
就「鎖」本身而言,**它比我說的更接近「只做一個介面」**。

## 4. `requireAdmin` + 2FA 那道牆有沒有旁路(交辦 ④ —— **只回報,不設計繞過**)
有,而且是**設計好的正門**,不是漏洞:`middleware.ts` 白名單三個前綴,各端點**自驗共享 secret**
(`CRON_SECRET` / `PCM_SSO_EXCHANGE_SECRET`),`/api/sso/exchange` 用 `timingSafeEqual` 常數時間比對。
`middleware.ts:22` 逐字提醒「`/api/sso/authorize`**不**放行 —— 它需登入態才可發碼」⇒ **放行是逐條選的,不是整片開的。**
⚠️ 那 **37 支「兩者皆無」的 route 我沒有逐支開檔看**它們靠什麼保護(可能靠 middleware session、可能是公開端點)
—— **這是本報告最大的未讀面**,不要把「26+3」讀成「其餘 37 支沒保護」。

## 5. Q-B3 = B 的已知風險(照指示只登記,**不加保險、不寫成已解決**)
Sean 拍 **上下架權威歸我們後台**。我 `B-005` 提的代價仍然成立且**尚未處理**:
供應商停產 → 來源側標下架 → 我們鎖著「上架中」⇒ **客人買得到一個已經不存在的東西**。
⇒ **狀態:已知風險,待 Sean 決定要不要加保險。本報告不提保險方案。**

## 6. 誠實缺口
1. **mac mini 正本未讀**(Sean 逐字說本機只是 clone)—— 全部結論以 `origin/main` 為準,**每份報告都留這條**。
2. **37 支 route 的保護方式未逐支確認**(§4)。
3. `supabase/` 179 檔 migration **我沒讀內容**,只數了檔數。
4. 兩套鎖之外是否還有第三、第四套保護 —— 我掃的是 `base.py` 的常數區,**沒有全 repo 反向盤點**。
5. 乙案**工時仍未估** —— §3 說的是「機制存在」,不是「幾天做完」。
