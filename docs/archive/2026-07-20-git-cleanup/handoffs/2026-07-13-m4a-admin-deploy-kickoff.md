# M-4a 後台部署 slice — kickoff(2026-07-13 Fable 過夜備、明天執行)

> Fable 過夜偵察+規劃產物(未 commit、未部署)。明天開「部署 admin」slice 照此走。
> 分工:Sean 做 Vercel dashboard + DNS;Fable/實作視窗備 config + 驗 build。

## 目標與卡點
把 `apps/admin`(網站後台:SSO 收端 + 訂單列表 + 稽核基建、code 全完覆核過已 push)部署到 Vercel + 綁 `admin.pcmmotorsports.com`。**這是 M-4a 唯一硬卡點**:現在 SSO 對接(報價單→網站後台)與訂單列表真實資料都因後台無公開網址而 NXDOMAIN。

## 事實基礎(已查證)
- Vercel team `team_uMPmFCKRDUhoixK6p3JC0Tis`:4 project(pcm-quote-v2 / pcm-website-v2〔storefront、綁 shop.pcmmotorsports.com、Node 24.x〕/ pcm-official-site / pcm-moto)、**無 admin**;`apps/admin` 從沒 vercel link/deploy。
- 🔴 **repo root `vercel.json` 是 storefront 專屬**:含 crons(`/api/cron/settle-sweep`、`/api/cron/anomaly-alert`)+ 一串 TAPPAY/LINE/金流 env。admin **不可共用**(沒那些 cron routes、不需金流 env)。
- `apps/admin/package.json`:`name=@pcm/admin`、`build=next build`、依賴 workspace `@pcm/adapters`+`@pcm/domain`+base-ui+next。
- admin build 本機已過(dc6deca 三綠含 admin build);Vercel 冷 build 第一次可能要調(見坑)。
- admin runtime 3 env(全 server-only、非 build-time):`ADMIN_SESSION_SECRET`(新生≥32)/`PCM_QUOTE_SSO_BASE`(報價單網址)/`PCM_SSO_EXCHANGE_SECRET`(同報價單值)。

## 執行步驟
**A. Sean — Vercel 建 project**
1. Import GitHub repo `pcmmotorsports/pcm-website-v2`(同一個 repo、新 project)。
2. Project name 建議 `pcm-admin`。
3. 🔴 **Root Directory = `apps/admin`**(關鍵:讓 Vercel 只 build admin、用 admin 自己的設定、**天然避開 repo root 那份含 storefront crons 的 vercel.json**)。
4. Framework 自動偵測 Next.js;Node 24.x(對齊 storefront)。
5. Install/Build:Vercel 偵測 pnpm workspace + Turborepo 通常自動處理(root install、build app);第一次若失敗見坑①。

**B. Sean — 設 5 個 env**(到 pcm-admin project、Production):
- SSO(3):`ADMIN_SESSION_SECRET`(本機 `openssl rand -hex 32` 新生、勿貼對話)/ `PCM_QUOTE_SSO_BASE` / `PCM_SSO_EXCHANGE_SECRET`(同報價單值)。
- 🔴 **資料庫讀訂單(2、2026-07-13 本地測試漏抓後補上)**:`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`——**兩者皆同 storefront `pcm-website-v2` project 的值**(同一 supabase project `bmpnplmnldofgaohnaok`;service key 值=sb_secret_ 新版、變數名不改)。缺這 2 → admin `packages/adapters/src/supabase/client.ts:62-63` `createSupabaseServiceClient` requireEnv 拋錯 → 訂單列表「載入失敗」錯誤態(本地實測畫面即此態、優雅降級非崩潰)。

**C. deploy** → 拿到 `pcm-admin-xxx.vercel.app` 臨時網址先驗(見驗證清單)。

**D. Sean — 綁正式網域**:pcm-admin project 加 domain `admin.pcmmotorsports.com` → Vercel 給 CNAME target → 到網域 DNS 商加 CNAME record → 等傳播(幾分鐘~數小時)。

**E. Sean — 報價單側**:確認 `PCM_ADMIN_APP_URL` = `https://admin.pcmmotorsports.com`(已設、確認網址對上)。

## 建議 apps/admin/vercel.json 草稿(實作視窗/Sean 決定要不要加)
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["sin1"]
}
```
(對齊 storefront region、**刻意無 crons/無金流 env**;若 Root Directory=apps/admin 且 Vercel 自動偵測正常,此檔可省——第一次 deploy 若 region/build 要 override 再加。)

## 已知坑 + 預期調試
- **① monorepo install/build**:admin 依賴 workspace packages,Vercel 要在 repo root `pnpm install`(裝整個 workspace)再 build admin。Root Directory=apps/admin 時 Vercel monorepo 偵測通常自動搞定;若 build 抓不到 workspace deps → 在 project settings override:Install=`corepack enable && pnpm install --frozen-lockfile`(在 repo root)、Build=`cd ../.. && pnpm turbo build --filter=@pcm/admin`(或 Vercel UI 的 monorepo 選項)。storefront 當初也調過、非新問題。
- **② crons 隔離**:Root Directory=apps/admin 天然不讀 repo root vercel.json,admin 不會誤註冊 storefront crons。✅(這是選 apps/admin 為 root 的主因之一。)
- **③ DNS 傳播**:綁域名後非即時,`admin.pcmmotorsports.com` 要等 CNAME 傳播才解析得到(在此之前仍 NXDOMAIN、屬正常)。
- **④ turbo build env 白名單**:`turbo.json` 的 build env 是 storefront 的;admin build 若需要某 NEXT_PUBLIC_ 值要加進白名單(admin 目前無 NEXT_PUBLIC build-time 依賴、3 env 皆 runtime,預期不需)。

## 驗證清單(deploy READY 後)
1. `pcm-admin-xxx.vercel.app/` GET 200(admin 頁殼)。
2. `.../orders` → 顯示 prod 真實訂單(30 筆)、四軸篩選+分頁能動 = 訂單列表真實資料驗收。🔴 **2026-07-13 真資料驗證(execute_sql)**:30 筆、payment_status **unpaid 24/paid 6 有區分**(此軸篩選現有用);fulfillment_status/order_source/payment_channel **目前皆單值**(notOrdered/web/tappay=舊訂單 DEFAULT 回填)→ 那 3 個下拉暫時篩不出區分**屬正常非 bug**、待手動單/出貨進度豐富。經銷隔離驗證:僅查狀態+count、未取金額/PII。
3. 綁域名+DNS 傳播後:報價單後台點「網站管理」→ 無縫跳進網站後台不用再登 = SSO 對接驗收。
4. SSO 若跳回失敗:查 admin `/api/sso/callback` log(Vercel runtime log)+ 確認報價單 PCM_ADMIN_APP_URL 網址一致。

## 分工
- **Fable(明天 session 開頭)**:本機 `pnpm turbo build --filter=@pcm/admin` 再確認冷 build 能過 + 視需要備 `apps/admin/vercel.json`;deploy 卡住時看 build log 判。
- **Sean**:Vercel dashboard 建 project + env + 綁域名 + DNS(dashboard/DNS 專屬)。
- **不涉**:無 schema/DB 改動、無金流。純部署基建。
