# 資安稽核第二輪 · findings 總表 + blocked-on(給主視窗 triage / 給下一個 E 窗接手)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**性質**:本輪(E-698 交接後)產出的索引;細節在各分檔。
- **口徑**:每條標庫別。兩庫不互相引用(`E-698` §0-2)。量到/推出分開。

## A. findings(依嚴重度)

| # | 庫/面 | finding | 嚴重度 | 狀態 | 檔 |
|---|---|---|---|---|---|
| 1 | 網站庫 storefront | `pcm-tier` cookie client 可偽造、不查 DB;**今天靠三道間接擋**(讀價釘 general / view 排除 price_store / mapper dummy 0)—— M-2-08 接真經銷價時任一道放寬即 **CRITICAL** | 🔴 **潛在 CRITICAL(追蹤)** | 自標 `#215`/H-1;a4 已升成向 Sean 講的一件 | `axis2-authz-boundary-audit` §4-① |
| 2 | 報價單庫 | `storefront_public_read` policy 的 USING ≠ view 的 WHERE(**少 `is_listed`**)⇒ anon 繞過 view 直查 `products` 可枚舉「未上架但有價有分類未隱藏」品項 | 🟠 MEDIUM(**無經銷價/PII**;結構已證) | 洞存在=證出來的;今天幾筆命中=量不到(帳號鎖住) | `quote-db-round2-storefront-catalog-rls` |
| 3 | 網站庫 admin | `fetchShipmentCandidates` orderIds **零長度上限** ⇒ 被盜 admin session 一次撈全部訂單成交價+PII + 無界並行 fan-out | 🟡 LOW–MEDIUM(不跨邊界、仍要 admin session) | 修法規格已交 a4 → C 窗 | `axis2` §4-③ |
| 4 | 網站庫 storefront | login/forgot 重設信節流=**全域 2/小時**(內建 provider)⇒ 自我 DoS + 防列舉隱藏寄信失敗 | 🟡 視 provider(**證據偏自建 SMTP ⇒ 偏輕**) | 卡 Dashboard 看 SMTP provider | `supabase-recovery-throttle-granularity` |
| 5 | 網站庫 storefront | tappay-notify「未上線」折扣 —— 是 **code 強制 gate**(flag 預設 off + 3DS-4 未實作 + 端點對不上就 drop),折扣站得住 | ℹ️ INFO(折扣有效) | 卡 Vercel env 看 `TAPPAY_3DS_ENABLED` 現值 | `section1-unverified-items-round2` §5 |
| 6 | 網站庫 storefront | resolveCartLines 最壞 400 循序往返/請求 —— **有上限(200)+ 循序**,匿名可達但每請求有界 | ℹ️ LOW(200 截斷已緩解) | 結構已定;實測只確認計數(需 anon key) | `section1` §7 |

## B. 負向/乾淨結論(這輪確認沒問題的,寫下來免得重審)

- **軸二授權邊界今天守得住**:admin↔storefront 密碼學隔離(會員 JWT 對 admin 無意義)、19 admin action 逐一過 `authorizeAdminMutation`、無 IDOR、經銷價今天不漏。
- **auth 關鍵 route guard 主對話親讀正確**:cron `CRON_SECRET` ×3(safeEqual 長度先驗 + timingSafeEqual,fail-closed)、tappay-notify secret(不符 404 不揭存在)、SSO state(128-bit CSPRNG + cookie 綁定 + open-redirect 白名單)。
- **無 mass/批次/export-all 端點**(pattern `batch|bulk|mass|purge|deleteAll|clear|csv|content-disposition` 於 `apps/admin/src` 命中皆非端點)。
- 報價單庫經銷價擋法=獨立 view `dealer_price_v` 沒發給 anon(**與網站庫欄級 f 不同機制**);成本欄 anon 讀不到(0,對照 postgres 活)。
- **登入流 guard 親讀正確**(LINE OAuth state 綁定在 code 兌換之前 + 失敗不清 session、Google 委派 SDK PKCE、`sanitizeNextParam` open-redirect 白名單)——`axis2` §2-verify-b。
- 🔴 **網站庫 view/policy 對稱檢查=無 asymmetry**(3 支 invoker view 皆委派 RLS,不像報價單庫 view 自帶 WHERE)——`website-db-view-policy-symmetry-check`。
- 🔴 **網站庫 Sean 兩大優先 DB 層皆 PASS**:①外部 anon 對 28 張客戶/訂單/金流表零存取(表級+欄級 0/f、分母 28)②anon 對 `price_store`/`price_by_tier`=f(經銷價不漏)③會員隔離:customers/orders/… 的 authenticated SELECT policy 全綁 `auth.uid()`=own(被盜會員 token 只讀自己)——同上檔 §4/§5。

## C. 🔴 blocked-on-Sean(這幾個東西不到,對外實打面做不了 —— 是東西不是工時)

| 缺 | 解開什麼 |
|---|---|
| **網站庫 anon key** | §1 #1(facet-counts 放大實打)/#3/#7(cart 往返實打) |
| **報價單庫 anon key** | §1#9(anon 經 PostgREST 實際看到哪些 schema)、finding#2 的 RLS gap 外部可達性、net/cron 祕密鏈外部可達性 |
| **能 SELECT `products` 的角色(service_role)** | finding#2 的 gap 現有幾筆命中 count(稽核帳號被正確鎖住 ⇒ 量不到) |
| **Dashboard → Auth → SMTP provider** | finding#4 嚴重度定案(內建=DoS/自建=輕) |
| **Dashboard → Vercel WAF 規則** | §1#4 tappay-notify/facet-counts 限流是否真存在 |
| **Vercel prod env `TAPPAY_3DS_ENABLED`** | finding#5 折扣是否被翻掉 |
| **報價單 repo(mac mini)** | production schema vs repo 一致性、finding#2 修法落點 |

## D. on hold（非 blocked，是時機未到）

- `E-698` §5 item 4 三條 traps：**等 `customers`+`products` 收割完再一次做**(traps 圈號退場兌現,`project_0817-traps-numbering-retired`)。

## E. 下一個 E 窗接手順序（anon key 到齊後）

1. 報價單 anon key → PostgREST 探測(`/rest/v1/products?is_listed=eq.false` + 200/404 對照)確認 finding#2 外部可達 + §1#9。
2. 網站庫 anon key → §1 #1/#3/#7 實打(誘餌 build harness 已就緒,`storefront-hunt-round1` §6)。
3. Dashboard 三答回來 → 定案 finding#4/#5 嚴重度。
4. 報價單 repo 到 → production vs repo 一致性(B 窗 apply 前置同缺口)。

## 口徑

本檔是索引,結論以各分檔為準。所有「未確認」都附了缺哪一道檢查。正式庫全程唯讀,零寫入/DDL/業務資料列內容(聚合 count 亦因帳號鎖住未取得)。
