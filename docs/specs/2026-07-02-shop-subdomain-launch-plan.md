# 正式上線 Plan — `shop.pcmmotorsports.com` 純網站上線(型錄 + 會員;真刷卡延後)

> 真權威:本檔。狀態:**草案 v0.3、方向已定、待 Sean 逐步執行**（2026-07-02）。
> 鐵則 8（部署/網域/env/merge main）。**真刷卡不在本輪**（延後里程碑、§9）。
> **v0.3 定案**（Sean 2026-07-02 逐題拍）:上線範圍 = **純網站(型錄可逛 + 會員登入)**;`TAPPAY_3DS_ENABLED` **維持 false**;真刷卡 + 營運面(退款/發票/客訴/待開票)+ codex 全 findings → **併入「後台」里程碑再一起做**。結帳鈕**不動**(接受 flag=false 若被點到 = 壞畫面 + 生 unpaid 空單、無真金流;Sean「目前不會有人下單」接受此殘留)。
> 相關:STATUS「下一步」上線段、`three-ds-flag.ts` docstring、memory `project_geo-p0-dormant-activate-on-launch` / `project_security-audit-2026-06-05-dealer-price-chain`。

---

## 0. Sean 已拍板（2026-07-02、逐題）

- **上線範圍 = 純網站**：型錄(1118 上架)可逛 + 會員登入;**不開真刷卡**。
- **`TAPPAY_3DS_ENABLED` 維持 false**;不做「結帳關閉 gate」、結帳鈕不動。
- **真刷卡 + 營運面 + codex findings = 延後**:等「後台」做完一起併入(§9 gate 保存)。
- **殘留接受**:flag=false 結帳被點到 → 壞畫面 + unpaid 空單(無真金流);Sean 目前無下單量、接受。
- **網域 = 新增副網域** `shop.pcmmotorsports.com`;主站 `pcmmotorsports.com`、`bikes.`、`quote.` 不動。

---

## 1. 目標與範圍

**目標**：把 `apps/storefront`（Next.js）部署 Vercel Production、掛新副網域 `shop.pcmmotorsports.com`,**開放型錄瀏覽 + 會員登入**,真刷卡結帳維持關(flag false)。

**範圍內(本輪)**：merge `dev→main`、Vercel 專案設定、DNS 副網域、Vercel Production env(一般 + 會員登入)、Supabase Auth redirect allowlist。
**範圍外(延後「後台」里程碑,§9)**：真刷卡(3DS flag on)、go-gate ①-⑤、營運面(退款/發票/客訴/待開票)、codex round1/round2 全 findings 的金流部分、Vercel WAF、TapPay 正式金鑰、安全網 flag。
**永久不動**：Supabase schema(已 live)、主站/`bikes.`/`quote.`、報價單管線、Phase 2 Shopify。

---

## 2. 網域生態

| 網域 | 是什麼 | 專案 | 本次 |
|---|---|---|---|
| `pcmmotorsports.com` | 舊靜態站 | 舊站 | 不動 |
| `bikes.pcmmotorsports.com` | 二手車網站 | `/Users/sean_1/網頁影片製作` | 不動 |
| `quote.pcmmotorsports.com` | 報價單後台 + 型錄資料源 | `/Users/sean_1/API大量上架` | 不動 |
| **`shop.pcmmotorsports.com`** | **本商城** | `pcm-website-v2` | 🆕 新增副網域 |

資料流:報價單爬蟲 → Supabase → 商城讀 Supabase(每天 03:00 GHA、S5 live)。子網域各自獨立部署、共用 Supabase `bmpnplmnldofgaohnaok`;商城 runtime 不跨呼叫 quote/bikes。

---

## 3. 部署拓樸

- **目標**：Vercel（`apps/storefront`,Next.js 16 / React 19 / Tailwind v4）+ Supabase(已 live)。無 Railway/Medusa/獨立後端。
- **vercel.json**(repo 根):`framework: nextjs` / `installCommand: corepack enable && pnpm install --frozen-lockfile` / 2 daily cron(`settle-sweep` `0 0`、`anomaly-alert` `0 1`,UTC)。**crons 本輪維持在檔內、但 `*_ENABLED` flag 全 false = 每次 200 no-op**(不移除 = 零 code 改;設 `CRON_SECRET` 避免 requireCronSecret 回 500 噪音)。
- **Root Directory = repo 根**(STATUS 3DS-4d 記 build-log 證實 crons 生效);build 經 monorepo 建 storefront。⚠️ **F4 待驗**:上線前用 preview build log 實證 Root/cron/installCommand 生效。
- **submodule**:`design-reference`(private、`637dafc`)。⚠️ **O2 待驗**:build 是否 import → 決定 Vercel 是否需授權抓 private submodule。

---

## 4. 型錄就緒度(2026-07-02 唯讀 MCP)

products **1409**(上架 1118)/ variants **9283** / brands **21**;全套 migration 已 live。型錄資料面就緒。
🔒 **經銷價防護**:catalog 公開曝光,經銷價/tier 由 server 端護(2026-06-05 安全稽核 0 live HIGH、三層 CI 守門、經銷價零外洩)= 既有防線、非本輪新風險;上線後 L1 輕掃復查。

---

## 5. 上線步驟(純網站、Sean 主導)

| # | 步驟 | 要改什麼 | 誰做 | Rollback |
|---|---|---|---|---|
| S1 | Sean push 本地 `dev`(含 A commit `e897619` + 本 v0.3)→ origin/dev | — | **Sean** | — |
| S2 | merge `origin/dev`→`main`(F8:以上線當下 origin/dev HEAD 為準重數、釘死目標 SHA;已驗乾淨 FF) | 快進 | **Sean**(手動 merge+push) | `main` reset 回 `9f609b0` |
| S3 | Vercel 專案:Root Directory=repo 根、Production branch=`main`、framework=nextjs | 沿用 vercel.json | **Sean** | 改設定 |
| S4 | 設 Vercel env(**Production + Preview 兩份**,F5;§6 對照表、**只設一般 + 會員登入**) | env | **Sean**(`.env*` deny 我碰不到) | 移除變數 |
| S5 | 部署到 Production、`*.vercel.app` URL 驗收(F4 build-log 證 Root/cron;O2 submodule;瀏覽型錄/登入/tier 顯示對) | — | Sean 肉眼驗 / Claude 唯讀查 log | 不掛網域即止血 |
| S6 | Supabase Auth / OAuth redirect allowlist 加 `shop.` 網域(F7) | Redirect URLs:`https://shop.pcmmotorsports.com/auth/callback` + LINE `.../api/auth/line/callback` + Google provider 確認 | **Sean** | 移除 URL |
| S7 | DNS 掛副網域(F10:只加 `shop` 精確 record、**不動** `@`/`www`/`*`/`bikes`/`quote`、先截圖 DNS) + Vercel 加 domain | `shop`→Vercel | **Sean**(DNS + dashboard) | 移除 `shop` record(主站/其他子站零影響) |
| S8 | 上線後煙霧驗:型錄/商品頁/會員登入/tier 價格顯示 + L1 安全輕掃 | — | Sean 肉眼 / Claude 唯讀 | Instant Rollback / 移 DNS |

**影響面**：`shop.` 子網站(型錄+會員)live;SEO 生效;**零真金流**(flag false);主站/其他子站零影響。

---

## 6. Vercel env 對照表(本輪 = 一般 + 會員登入;金流 env → §9 延後)

> 🔴 值一律 Sean dashboard 設(`.env*` deny 硬擋 Claude);含密鑰欄不貼對話;Production + Preview 兩份(F5)。

### 一般(必設)

| 變數 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client(anon、受 RLS) |
| `NEXT_PUBLIC_SITE_URL` = `https://shop.pcmmotorsports.com` | SEO robots/sitemap/JSON-LD 啟動 |
| `CRON_SECRET` | 2 cron route Bearer(不設→每日 500 噪音;flag false 仍需) |

### 會員登入(若開 LINE/Google 登入;F6 分清)

| 變數 | 用途 |
|---|---|
| `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` / `LINE_REDIRECT_URI` | LINE **登入** OAuth(`_REDIRECT_URI`→shop 網域) |
| 🔴 `SUPABASE_SERVICE_ROLE_KEY` | LINE callback 建/查 user(`lib/auth/line-admin.ts`)+ adapters;server-only 敏感 |

### 選配

| 變數 | 用途 |
|---|---|
| `NEXT_PUBLIC_TAPPAY_APP_ID` / `_APP_KEY` / `_ENV`(sandbox) | 選配:設 sandbox 讓結帳頁卡欄不 runtime error(不設則卡欄不載、不影響其他頁);**server `TAPPAY_*` / 正式金鑰本輪不設** |

### 🔴 本輪不設(延後「後台」里程碑,§9)

`TAPPAY_3DS_ENABLED`(維持 false)、server `TAPPAY_ENV`/`TAPPAY_PARTNER_KEY`/`TAPPAY_MERCHANT_ID`/`TAPPAY_FIELD_IDS`、`TAPPAY_NOTIFY_PATH_SECRET`、`PAYMENT_CONFIRMER_DB_URL`、`ANOMALY_ALERT_ENABLED`、`CRON_SWEEPER_ENABLED`、`RESEND_API_KEY`/`ALERT_EMAIL_*`/`LINE_ALERT_TO`/`LINE_CHANNEL_ACCESS_TOKEN`。

---

## 7. Rollback runbook(F9:無「秒關」神話)

- **止血最快**:Vercel **Instant Rollback**(promote 前一個良好 deployment)或移除 `shop.` DNS record(對主站零影響)。
- **env 改動**:Vercel 改 env **不即時影響既有 deployment** → 需 redeploy 或 promote 才生效(數十秒~數分)。
- **merge**:`main` reset 回 `9f609b0`(Sean)。
- **DNS**:只移除 `shop` 精確 record(F10)。

---

## 8. 🔴 誠實邊界 / 已接受殘留

- **flag=false ≠ 結帳關閉**:結帳走同步舊路,被 TapPay status 75 拒(無真金流)、但 **placeOrder 已建一張 unpaid 空單**(孤兒)。Sean 2026-07-02 拍板**接受**此殘留(目前無下單量);要消滅需前端改結帳鈕(本輪 Sean 選不動)或延後里程碑一起處理。
- **無真刷卡**:本輪 `TAPPAY_3DS_ENABLED` 全程 false、零真金流。
- 所有 dashboard/DNS/env/merge/push = **Sean 操作**;Claude = 規劃/唯讀查證/產 checklist/改 repo 文件。

---

## 9. 🏛️ 延後里程碑「開真刷卡 + 後台」gate(保存、本輪不做)

> 觸發 = Sean「後台」做完、要開真金流時。屆時**全部**要過(此段保存 codex 兩輪 findings + go-gate,避免日後重踩):

**go-gate ①-⑤**:① sandbox 3DS E2E 全情境(對 pivot-A 整頁版)重跑綠 / ② Sean 真機(production build)實刷驗收整條 / ③ TapPay 正式商戶金鑰 / ④ **Vercel WAF** 對 `/api/checkout/tappay-notify/*`(POST、合法不擋、錯 secret 404、flood 擋、dashboard log 佐證;3DS-2 plan BLOCKER)/ ⑤ 安全網 flag 上崗(`ANOMALY_ALERT_ENABLED` + `CRON_SWEEPER_ENABLED` + 密鑰)。

**營運面(D1、Sean 拍「併後台一起做」)**:退款 SOP(TapPay Dashboard 手動、誰操作、證據記錄、DB 訂單狀態)、取消訂單、客訴、發票開立、每日待開票核對。

**codex 關卡1 findings(round1 10 + round2 6、金流部分延後)**:
- round1 已折入本輪的 = F4(Root Directory)/F5(Preview env)/F6(LINE 登入 env + service_role)/F7(OAuth redirect)/F8(merge SHA)/F9(rollback)/F10(DNS 精確);金流相關 F1/F2/F3 → 延後。
- round2 全 6(驗收 origin 策略 / S 排序 / WAF 規格 / 營運 gate / TapPay 精確 env prod-not-sandbox / 計數)→ **全延後**(皆屬真刷卡開啟)。
- **開 flag 順序**:WAF + 正式金鑰 + 安全網 flag/密鑰全設驗過後,**最後一步**才翻 `TAPPAY_3DS_ENABLED=true`;驗收 origin 用 `*.vercel.app` 當 `NEXT_PUBLIC_SITE_URL` 先驗 3DS → 過再切 `shop.` + redeploy + 小額真刷復驗。

---

## 10. 開放項(本輪相關)

- **F4｜Root Directory + 根 vercel.json**:preview build log 實證。
- **O2｜design-reference build 期相依**:grep 確認 → 決定 Vercel submodule 授權。
- **O5｜DNS 託管方**:確認 registrar / `bikes`·`quote` 既有做法,`shop` 沿用。

— END(草案 v0.3、方向已定、待 Sean 逐步執行)—
