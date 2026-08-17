# 資安稽核第二輪 · findings 總表 + blocked-on(給主視窗 triage / 給下一個 E 窗接手)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**性質**:本輪(E-698 交接後)產出的索引;細節在各分檔。
- **口徑**:每條標庫別。兩庫不互相引用(`E-698` §0-2)。量到/推出分開。

## A. findings(依嚴重度)

| # | 庫/面 | finding | 嚴重度 | 狀態 | 檔 |
|---|---|---|---|---|---|
| 1 | 網站庫 storefront | `pcm-tier` cookie client 可偽造、不查 DB;**今天靠三道間接擋**(讀價釘 general / view 排除 price_store / mapper dummy 0)—— M-2-08 接真經銷價時任一道放寬即 **CRITICAL** | 🔴 **潛在 CRITICAL(追蹤)** | 自標 `#215`/H-1;a4 已升成向 Sean 講的一件 | `axis2-authz-boundary-audit` §4-① |
| 2 | 報價單庫 | `storefront_public_read` policy 的 USING ≠ view 的 WHERE(**少 `is_listed`**)⇒ anon 繞過 view 直查 `products` 可枚舉「未上架但有價有分類未隱藏」品項 | 🟠 結構 MEDIUM / **當前曝險 0 筆** | 外部可達=✅實打 206;gap 今天=**0 筆(實打 `*/0`)**;結構仍在(觸發條件已明寫)⇒ 未降級 | `quote-db-round2-storefront-catalog-rls` |
| 3 | 網站庫 admin | `fetchShipmentCandidates` orderIds **零長度上限** ⇒ 被盜 admin session:①無界並行 fan-out ②大量訂單【品項/料號/單號】對映(🔴 08-17 收窄:~~成交價+PII~~ 不成立,C 窗開 DTO 核出回窄 DTO 零金額欄) | 🟡 LOW–MEDIUM(不跨邊界、仍要 admin session) | 上限已加 `b5500042`(C 窗) | `axis2` §4-③ |
| 4 | 網站庫 storefront | login/forgot 重設信節流粒度=全域(僅內建 provider);PCM=自建 Resend SMTP ⇒ 全域 DoS 不成立,殘留只剩 §10 防列舉隱藏寄信失敗 | 🟢 LOW(已定案) | ✅ Sean Dashboard 截圖=自建 SMTP + `Minimum interval per user 60s`;不上調 | `supabase-recovery-throttle-granularity` |
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
**✅ 今天(2026-08-17 下午)解掉的:**
| 原 blocker | 結果 |
|---|---|
| ~~報價單庫 anon key~~ | Sean 交付(`sb_publishable_` len46)⇒ 實打完成:finding#2 外部可達=是、gap 今天=**0 筆**、經銷價外部 401、§1#9 net/extensions 406 不可達 |
| ~~gap count 需 service_role~~ | 改由 anon key REST 取得(count-only)=0 筆 ⇒ 不需 service_role |
| ~~Dashboard SMTP provider~~ | Sean 截圖=自建 Resend SMTP ⇒ finding#4=分支乙(輕);另量到 `Minimum interval per user=60s` |
| ~~報價單 repo(mac mini)~~ | **量錯更正:repo 在本機 `~/API大量上架/PCM報價單-V2`**(`-maxdepth 3` 掃不到深度 4、正向對照剛好在深度 3 內沒測到深度維)⇒ 讀 `origin/main`(不 db push) |

**⏳ 仍 pending(還在 Sean 手上):**
| blocker | 解開什麼 |
|---|---|
| **網站庫 anon key** | §1 #1(facet-counts 放大實打)/#3/#7(cart 往返實打) |
| **Dashboard → Vercel WAF 規則** | §1#4 tappay-notify/facet-counts 限流是否真存在(全域節流已立 backlog `#607`) |
| **Vercel prod env `TAPPAY_3DS_ENABLED`**(a4 併問中) | finding#5 折扣是否被翻掉 |

## D. on hold（非 blocked，是時機未到）

- `E-698` §5 item 4 三條 traps：**等 `customers`+`products` 收割完再一次做**(traps 圈號退場兌現,`project_0817-traps-numbering-retired`)。

## E. 下一個 E 窗接手順序（剩下的）

1. **網站庫 anon key 到 → §1 #1/#3/#7 實打**(誘餌 build harness 已就緒,`storefront-hunt-round1` §6)。
2. production vs repo 一致性:讀報價單 repo `origin/main`(本機,已解鎖)比對 production schema(B 窗 apply 前置同缺口)。
3. `TAPPAY_3DS_ENABLED` prod 值回來 → 定案 finding#5。

## F. 🔴 踩在「Dashboard 一點就變 / repo 查不到 / 零監控」值上的結論(apply/上線當天要重驗)

2026-08-17 一天內第三次撞到這個形狀 ⇒ 盤點哪些結論站在它上面。共通病:**唯一在擋的那道控制改起來不留痕、不會有測試紅、不會有掃描命中**,而引爆它的改動看起來與資安無關。

| 結論 | 踩在哪個值 | 值在哪(repo 查不到) | 若它變了 |
|---|---|---|---|
| finding#4 recovery 節流=輕 | 自建 SMTP 開著 + `Minimum interval per user 60s` | Supabase Dashboard→Auth→SMTP | 關自建 SMTP → 回內建全域 2/小時;改 60s → 改節流粒度 |
| §1#9/§5-b net·pg_stat 外部不可達 | db-schemas 白名單 = `public, graphql_public` | PostgREST 設定(從 `PGRST106` 挖出、DB 端查不到) | 加 `net`/`extensions` 進白名單 → 那四張外部可讀、net.* 是祕密 |
| #8 service_role SET ROLE=0(供 B 窗) | 當前角色成員圖 | 角色可後台新增 / 授 membership | 新增一個「service_role 有 SET」的角色 → 0 變非零、B 窗那道斷言重獲判別力 |
| finding#5 tappay-notify 未上線折扣 | `TAPPAY_3DS_ENABLED` 現值 | Vercel prod env | 翻 true(而 3DS-4 未實作)→ 折扣失效、嚴重度上調 |
| §1#4 / backlog #607 tappay-notify 限流 | Vercel WAF 規則存在與否 | Vercel Dashboard(未驗) | 規則不存在 / 被移除 → 端點無限流 |

🔴 **共通處置**:這些結論一律**帶時點、不寫無時效句**;**apply / 上線當天重驗一次**,不能拿今天的值當那天的值。正本(env 值 → 誰踩在上面)在 `docs/reference/environment-values-and-what-stands-on-them.md`(I 窗維護);上列依賴文字 E 已交主視窗轉。

## 口徑

本檔是索引,結論以各分檔為準。所有「未確認」都附了缺哪一道檢查。正式庫全程唯讀,零寫入/DDL/業務資料列內容;報價單 gap count 經 anon key PostgREST **count-only**(`Range:0-0`+`Prefer:count=exact`,只取 Content-Range 總數、不落 row)取得=0 筆。
