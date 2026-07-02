# SESSION HANDOFF — 2026-07-02 shop.pcmmotorsports.com 純網站上線 LIVE + #251 驗證收尾

> 一句話結果:**商城掛新副網域 `shop.pcmmotorsports.com` 已上線 LIVE**(型錄 1118 上架 + 會員登入 + 購物車、全程 Playwright 實測通過;LINE 登入排錯後通)。**真刷卡(`TAPPAY_3DS_ENABLED`)全程 false、延後「後台」里程碑**。#251 migration 唯讀 MCP 驗 PASS。**3 commit 全 push、`origin/main == origin/dev == HEAD == 718cd8a`(merge dev→main 完成)、工作樹 clean**。非全程 auto(Sean 逐題拍板 + 親自操作 merge/Vercel/DNS/env/LINE 後台)。
> 環境:repo `pcm-website-v2` · Supabase `bmpnplmnldofgaohnaok`(live)· branch `dev` · Vercel 專案 `pcm-website-v2`(`prj_4yNDP3XOt202tQIlYwF9auf5fLN7`、team `pcm-motorsports`)· 正式網域 `shop.pcmmotorsports.com`。HEAD=`718cd8a`。3 flag(`TAPPAY_3DS_ENABLED` / `ANOMALY_ALERT_ENABLED` / `CRON_SWEEPER_ENABLED`)全 false。
> 🔴 **接手第一件事**:無 blocker、上線已完成。下一階段 = **「後台」里程碑**(真刷卡 go-gate + 營運面)或 Sean 指定;先讀 launch plan §9 保存的延後 gate。
> 接手先讀:STATUS.md + `docs/specs/2026-07-02-shop-subdomain-launch-plan.md`(v0.3、真權威)+ memory `project_shop-subdomain-launch-catalog-only` + `reference_supabase-legacy-keys-disabled-use-publishable` + 本 handoff。

## 1. 做了什麼(按時序)

1. **起手 + #251 驗證(字面校正)**:唯讀 MCP 查 migration `20260702120000` **已在 live**(交接後 Sean 已 db push)→ 驗兩支 retry RPC(`mark_attempt_settle_retry` / `mark_webhook_retry`)allowlist = **4 碼含 `released_failure_observed`**(`record_unreachable/record_unverified/auth_or_pending/released_failure_observed`)+ ACL 矩陣 `payment_confirmer=T` / `anon·authenticated·service_role=F` = **PASS**。校正 STATUS/handoff/backlog #251「未 db push」過時字面 → 「已 live + 驗 PASS」。commit `e897619`。
2. **shop 副網域上線 plan(逐題拍板)**:Sean 拍 = 本商城掛新副網域 `shop.pcmmotorsports.com`(主站 `pcmmotorsports.com` 舊靜態站 + `bikes.` + `quote.` 皆不動)/ 本輪範圍 = **純網站**(型錄 + 會員)/ `TAPPAY_3DS_ENABLED` 維持 false / 真刷卡 + 營運面 + codex findings **延後「後台」里程碑** / 結帳鈕不動、**接受** flag=false 若結帳被點到生 unpaid 空單殘留(目前無下單量)。**codex 關卡1 兩輪對抗審**(round1 FAIL 10 findings、抓到「flag=false ≠ 結帳關閉、走同步舊路生孤兒單」= charge-actions/three-ds-flag 實證;round2 FAIL 6 must-fix、抓到驗收 origin 衝突 / S 排序循環 / WAF 未規格 / 缺營運 gate / TapPay env prod-not-sandbox / 計數)→ Sean 拍真刷卡延後、達 2 輪上限停 codex。真權威 plan v0.3 commit `2d70cfc`。
3. **Vercel 部署 de-risk + turbo.json 修正**:唯讀查 Vercel MCP 發現專案 `pcm-website-v2` 早已存在且 build READY(**F4 Root Directory=repo 根 + O2 storefront 零 import design-reference → 免 submodule 授權** 皆解);build log 抓到 **Turbo 2.x strict env mode 擋掉未宣告的 server env**(CRON_SECRET/LINE_CHANNEL_SECRET 等)→ 補 `turbo.json` build task `env` 白名單(列全 app env 含延後金流,NEXT_PUBLIC_* 靠 framework inference 不受影響)。三綠(typecheck7/lint10/build1)。commit `718cd8a`。
4. **merge dev→main + production 上線**:Sean 跑 merge(乾淨 ff、574 commit)→ `origin/main=718cd8a` → Vercel 自動建 **production `dpl_4EcHz`(branch main、READY)**。
5. **🔴 Supabase 舊 key 停用坑(本 session 最大卡點)**:catalog 載入失敗 = Vercel runtime error **`Legacy API keys are disabled`**(此專案 2026-05-12 於 dashboard **停用** legacy `anon`/`service_role`)。**修:改用新款金鑰** —— `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_...`(商城型錄 anon fetch)+ `SUPABASE_SERVICE_ROLE_KEY` = `sb_secret_...`(LINE callback 建 user)→ redeploy dev + production → 型錄通。🔴 **我先前誤建議「用 anon(舊)」= 憑 Supabase 通則沒查專案已停 legacy**(教訓入 memory)。
6. **Playwright 整站實測** `shop.pcmmotorsports.com`:型錄頁 ✅ / 商品頁(下導流 NT$13,700、紋路表面選項、fitments)✅ / **加入購物車 → 數字變 1** ✅ / **購物車頁**(`resolveCartLines` server action 正常 resolve 價格/圖)✅ / **前往結帳 → 導登入頁**(結帳需登入=設計)✅ / 登入頁(Email/Google/LINE)✅。唯一 console error = 4 個死連結 404 prefetch(見 §5)。
7. **LINE 登入排錯**:callback 回 **307**(有跑到、內部失敗被**靜默**導回 `/login?error=line`、code 故意不外洩原因故無 server error log)→ 診斷非 callback URL(能跳回代表 LINE 接受)→ Sean 實測他人帳號見 LINE 400「**This channel is now developing status. User need to have developer role**」= **LINE Login channel 在 Developing 狀態** → Sean 發布 channel / 加 developer → **登入通**。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | push |
|---|---|---|
| `718cd8a` | fix(config): turbo.json build task 宣告 app env 白名單(修 Vercel env 被 Turbo strict 擋) | ✅ origin/dev + origin/main |
| `2d70cfc` | docs(specs): 加 shop 副網域上線 plan v0.3(純網站先上、真刷卡+營運面延後後台) | ✅ origin/dev + origin/main |
| `e897619` | docs(docs): #251 db push 已 live 字面校正 + 唯讀 MCP 驗 allowlist PASS | ✅ origin/dev + origin/main |

**全 push + merge 完成**:`origin/main == origin/dev == HEAD == 718cd8a`。工作樹 clean(本 handoff 檔為新 untracked、待 commit)。

## 3. DB / 部署 / 外部足跡(非 git、接手看不到 diff)

- **DB**:本 session **無新 migration**;#251 `20260702120000` 在上個 session 已由 Sean db push、本 session 僅唯讀驗 PASS。live migration 到 `20260702120000`。
- **🆕 部署 = shop.pcmmotorsports.com LIVE**:Vercel production deployment `dpl_4EcHz`(sha `718cd8a`、branch `main`、READY);production alias `pcm-website-v2-pcm-motorsports.vercel.app` + 正式網域 `shop.pcmmotorsports.com`(DNS 只加 shop record、主站/bikes/quote 不動)。
- **Vercel env(Sean 設、值不入 handoff = `<REDACTED>`)**:`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`=**`sb_publishable_`** / `SUPABASE_SERVICE_ROLE_KEY`=**`sb_secret_`** / `NEXT_PUBLIC_SITE_URL`=`https://shop.pcmmotorsports.com` / `CRON_SECRET` / LINE(`LINE_CHANNEL_ID`/`_SECRET`/`_REDIRECT_URI`=`.../api/auth/line/callback`)。🔴 **金流 env 本輪未設**(延後)。
- **turbo.json**:build task 加 `env` 白名單(29 行)= 上線必要(否則 server env 被 Turbo strict 擋)。
- **LINE Developers**:LINE Login channel 由 Developing → 發布/加 developer(Sean 於 LINE 後台)。
- **Supabase Auth**:redirect allowlist 加 `https://shop.pcmmotorsports.com/auth/callback`(Sean)。
- **Flags**:`TAPPAY_3DS_ENABLED` / `ANOMALY_ALERT_ENABLED` / `CRON_SWEEPER_ENABLED` 全 false = 零真金流、cron no-op。

## 4. graphify 地圖增量

**未刷**(Sean 標準指示「graphify 不主動刷、等我說」;且本 session 只動 `turbo.json`〔config、非 code entity〕+ docs,無 code_dirs 實質新實體)。接手若要 → `/graphify --update`(Sean 說才跑)。

## 5. 開放項(待辦)

- 🔧 **死連結 nav 清理(上線前 UX)**:導覽列 **品牌(`/brands`)/ 安裝預約(`/install`)/ 合作店家(`/stores`)/ 配送&退貨(`/info/shipping`)** 四個連結目前空的、點了 404(也是瀏覽器 console error 來源);另 `favicon.ico/png` 404(網站小圖示沒放)。建議上線前**隱藏死連結或補頁面**(純前端小改、Sean 未拍)。
- 🏛️ **下一階段 = 「後台」里程碑**(真刷卡 + 營運面):真權威 = launch plan §9 保存的 **go-gate ①-⑤**(① sandbox 3DS E2E 全情境重跑〔對 pivot-A 整頁版〕/ ② Sean 真機 production build 實刷驗收 / ③ TapPay 正式商戶金鑰 / ④ Vercel WAF 對 `/api/checkout/tappay-notify/*`〔3DS-2 plan BLOCKER〕/ ⑤ 安全網 flag 上崗)+ **營運面**(退款/發票/客訴/待開票、Sean 拍「併後台一起做」)+ **codex 兩輪 findings**(§11 折入對照)。開真刷卡順序:全設驗過後**最後一步**才翻 `TAPPAY_3DS_ENABLED=true`;驗收 origin 用 `*.vercel.app` 先驗再切 `shop.` + redeploy + 小額真刷復驗。
- 🔴 **carry-over(Sean 手動)**:live `0072`/`0073` 兩筆真雙扣待 W1 runbook 退款(`docs/runbooks/2026-06-26-*`)。
- 🏛️ **Phase 2(更後)**:Shopify「付款成功才建單」重構(backlog #249、memory `project_shopify-payment-first-order-phase2-target`)——現在不動 code、不寫 PRD。
- ⏳ **可選**:graphify --update(Sean 說才跑)/ `/pcm-roadmap` 刷進度地圖(本 session 未跑)/ STATUS 7 欄補上「shop 上線」里程碑(本 handoff 已載,STATUS 可日後補)。

## 6. push 狀態與收尾自檢(接手第一眼)

**全 push + merge 完成**(`origin/main == origin/dev == 718cd8a`)、工作樹 clean(本 handoff 檔待 commit)。收尾自檢:git clean ✅ / 0 unpushed ✅ / 無 `.env*`·data·大檔殘留 ✅ / **Secret 0 洩漏**(handoff/commit 全文無金鑰、Vercel env 值 `<REDACTED>`)✅ / DB 足跡見 §3 ✅ / graphify 未刷見 §4 ✅ / 部署驗證 = Playwright 整站實測通過 + production sha `718cd8a` 對齊 origin/main ✅。

**驗證留痕**:#251 唯讀 MCP allowlist 4 碼 + ACL PASS;codex 關卡1 兩輪(round1 10 findings / round2 6 must-fix、皆零留痕、達 2 輪上限);turbo.json 三綠;Playwright shop.pcmmotorsports.com 型錄→商品→購物車→結帳→登入 全綠;LINE 登入 Sean 實測通。

## 相關 plan / 記憶 / 文件

- 真權威 plan:`docs/specs/2026-07-02-shop-subdomain-launch-plan.md`(v0.3、含 §9 延後 gate + §11 codex findings 折入對照)
- 記憶:`project_shop-subdomain-launch-catalog-only`(上線方向定案)/ `reference_supabase-legacy-keys-disabled-use-publishable`(舊 key 停用坑 + 教訓)/ `project_shopify-payment-first-order-phase2-target`(Phase 2)/ `project_geo-p0-dormant-activate-on-launch`(NEXT_PUBLIC_SITE_URL 啟 SEO、本 session 已設)
- Vercel:專案 `pcm-website-v2`(`prj_4yNDP3XOt202tQIlYwF9auf5fLN7`)、team `pcm-motorsports`、production `dpl_4EcHz`=718cd8a
- 誠實邊界:flag=false 結帳被點到 → 導登入(需帳號)→ 若登入完成走同步舊路被 TapPay status 75 拒 + 生 unpaid 空單(無真金流、Sean 接受);死連結 nav 未清;真刷卡整套延後後台里程碑。
