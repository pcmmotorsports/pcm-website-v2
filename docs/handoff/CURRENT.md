# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> 🏁 **2026-07-20 #288-a production build E2E 守門 ✅ 全收工上線(非 M-4a 主線、獨立支線)**:
> commit `e700481` → Sean 批推 → **dev 與 main 皆已推齊**(07-20 當下兩者同指 `cc9ce02`;之後以實跑
> `git rev-parse --short origin/dev origin/main` 為準)→ **GitHub Actions「E2E (production build)」
> 首航 dev/main 兩條皆綠**(Secrets 已由 Sean 設好、preflight 非空檢查通過 = 真連上資料庫)。
> plan 真權威 `docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md` v3.2(五片 a-e,**a ✅**)、
> Packet+審查全史 `docs/reviews/2026-07-20-288a-prod-e2e-packet.md`(文末 R2 後記=web Codex FAIL 4 must-fix 的處置與複驗)。
> 🔴 **本次上 production 的可見改動**(隨 dev:main FF 一併上線):`799a733` 手機死碼 chip 移除
> + **抽屜車輛 tab 改「選擇車款」**(手機開篩選抽屜可肉眼驗)——Sean 肉眼驗待跑。
> 🔴 **分工新拍板(Sean 07-20)**:codex CLI 可直接當 executor 動手修檔(`exec -s workspace-write`、
> 帶精確 old/new 的 W 工單)、審查端核 diff;詳 memory `feedback_codex-cli-direct-executor-no-packet`
> + 三個操作坑 `reference_codex-exec-write-root-cwd-and-hang-pattern`(🔴 可寫根=啟動 cwd,必從 repo 根啟動)。
> Ownership 見下方「Working tree ownership」。**M-4a 主線下一步仍是 B-3、不受此片影響**
> (STATUS.md「下一步」已補雙軌註記)。
> 🆕 **2026-07-19 前台插隊線當次快照**:`docs/handoff/2026-07-19-storefront-catalog-lightbox-handoff.md`
> (商品卡去白邊 trim 線 ✅ 上 production + lightbox 鍵盤循環 ✅;含未結項與部署狀態。
> **兩條線皆已收工,不是 M-4a 下一步**;M-4a 主線下一步仍是本檔 + `STATUS.md` 的 **B-3**)。
> E1c 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`(⚠️ **僅供 E1c 追溯、不是開工依據**——其「下一步」字面已被 E2a-a 超越〔E2a 已拆三片、§⑩ 已定案、port method 已存在〕;**開工入口 = 本檔 + `STATUS.md`「下一步」**)。

## 交接資訊

- Updated: 2026-07-20,Asia/Taipei
- Agent: Claude Code 視窗(**#288-a production build E2E 守門全收工上線**;審查鏈=code-reviewer 6 + Fable 7 + web Codex 4 must-fix 全處置;**下一視窗 Sean 預計改用 Codex 當執行端**)
- Branch / HEAD: 🔴 hash/未推數**不寫死**,實跑取得:`git log --oneline -1` / `git rev-parse --short origin/dev origin/main` / `git rev-list --count origin/dev..HEAD`。本檔寫定當下 = dev 與 main **推齊同指 `cc9ce02`**、本地零未推;兩條 GitHub Actions(CI + E2E production build)在 dev/main **皆綠**。
- DB: migrations 至 `20260719150000`(trim 線)**全 apply**;#288-a **零 migration、零產品程式碼改動**(純測試基建 + CI)。

## 目前目標

**M-4a 第一期收口 ②通知線(修正版 D′)**。E 線(E1a~E2a-c)✅ 全關(歷史);07-18 轉折後:B-0 PRD ✅ → B-1 ✅ 已 apply 上 prod → B-2 ✅ 已 apply 上 prod + 路徑② 驗收 → **下一=B-3(結帳頁 email 欄 + zod 六條件鏡像)**,詳上方「下一個最小動作」。~~下一=E2a-2~~(**已作廢**,見 STATUS 07-18 轉折)。
> 🔴 **Sean Q13=A:E2a 三片皆不做告警**(全歸 E2a-2 獨立管道;plan §5「E2a + failed 告警」字面**已作廢**——sweeper 不可自我監看)。
> 🔴 **E2a-c 定案(Sean 07-18 依建議)**:**無 `*_ENABLED` gate**(codex 抓「未批准架構增項+靜默失敗態」→ 移除;真寄前自然閘=`ORDER_EMAIL_FROM` 未設即 503 + E2b pg_cron + E3 前表零列)。

## 🔴 下一個最小動作(2026-07-20 收工後;二選一、看 Sean 指哪條)

**主軌 = M-4a B-3(結帳頁 email 欄 + zod)**:
1. 讀 `docs/handoff/2026-07-19-m4a-b2-applied-handoff.md`(B-2 收案 + B-3 起手)+ PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md` §3.4/§4。
2. 🔴 紅線:zod **必鏡像 §3.4 全部六條件**(可列印 ASCII / 去尾點 / 擋子網域)—— 漏做 = app 放行、DB 擋、**結帳 500**;單一 env flag 同時翻四層、預設 off;B-3/B-4 動 TS 時必銷 **B-2 plan §8.2 的 11 項舊字面**(含兩處硬編碼 8 鍵斷言,不同步即假綠)。
3. 規劃前必查 graphify 連動面 + plan 附「相關既有紀錄與連動面」節(SOP ②)。

**支線 = #288-b(E2E 資料合約 + mobile device project)**:
plan v3.2 §6 表格(`docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md`);內容=globalSetup 資料合約(含 §7.1 逾時)+ 完整 device profile 的 mobile project(斷言 `html[data-mobile="true"]`);檔案清單以 §6 表為準。
🔴 給 Codex 執行端的操作注意:`codex exec -s workspace-write` 的**可寫根=啟動時 cwd,必從 repo 根啟動**;審查唯讀仍 `-s read-only`;E2E 本機跑 `cd apps/storefront && pnpm test:e2e:prod`(會自己 build,勿與 dev server 併跑;`.next` 共用)。

---

## ~~🔴 下一個最小動作(E2a-2 執行視窗)~~(🔴 **已作廢** —— 07-18 D′ 轉折後 E2a-2 作廢、B-1/B-2 已上 prod,主線=B-3;下段僅供追溯)

> 🔴 **寫 E2a-2 plan 前必查 graphify 連動面**(Sean 07-17 當場抓、memory `feedback_graphify-query-before-planning-is-mandatory`):repo 根跑 `graphify query`(本 repo `graphify-out/`)查對帳/anomaly-alert/`checkAnomalyAlerts`/`email_outbox` NOT EXISTS 的連動邊,plan **必附「相關既有紀錄與連動面」一節**。**查(每片必做)≠ 刷 `--update`(milestone/每日收工才跑)**。

1. 讀 migration `20260717020000` 頭註 **§⑦+§⑨+§⑩**(仲裁序 §⑦<§⑨<§⑩、五訊號)+ **REQUIRED-E2a-2**(§⑧ `skipped_order_ineligible` 天然不被訊號命中的殘餘盲區)+ memory `project_m4a-email-e2a-decisions`(Q1-Q15)/ `project_refund-line-two-stage`(Q8)+ plan **v3.3** §3.5b/§3.6/§4。
2. **E2a-2**(對帳補寄 + 五訊號掛 anomaly-alert 獨立管道 + 單測):
   - **對帳補寄**(§3.5b):**固定下界+`NOT EXISTS`** 全量重疊掃(否決移動 watermark);**Q4=A 下界走 env、未設即 skip 並在 response 明說**;述詞欄=`orders.paid_at`;吃 `email_outbox_order_idx (order_id, event_type)`。
   - **Q3=A ineligible gate** = `payment_status='refunded' OR cancelled_at IS NOT NULL`(🔴 **今日命中率 0**:兩者皆有欄零程式寫入、退款人工在 TapPay 後台 → 待[退款線第一段](memory `project_refund-line-two-stage`)落地才生效);轉入必寫 `last_error_code='order_ineligible'`+抑制路徑必附測試。
   - **🔴 五訊號**掛 anomaly-alert **獨立管道**(`checkAnomalyAlerts` use-case / `getAnomalyAlertDeps` composition;🔴 **不可放進 sweeper 自我監看**、死時告警一起死)。訊號定義見 migration §⑦(1-4)+§⑨(訊號 5 額度耗盡走 LINE、訊號 1 述詞修正)。
3. 🔴 **E2a-c 已定合約**:sweeper route=`api/cron/email-sweep`(GET/CRON_SECRET/limit 50/`maxRunSeconds: maxDuration`/`errors>0→503`/`deferred>0→200`/counts allowlist/**零告警**);composition=`lib/email/composition.ts`(`getSweepEmailOutboxDeps`);**排程仍待 E2b pg_cron**(本片與 E2a-c 皆不進 `vercel.json`)。
4. 審查閘=code-reviewer + codex 關卡2(**勿省**;⚠️ `EXIT=0` 假訊號、**必讀輸出內容**;`codex exec` 背景跑+porcelain 前後比對)。🔴 **修 must-fix 一律 grep 全 diff 掃同款、非只改點名行**(E2a-c R1→R2 兩輪皆因此再 FAIL)。

## 🌙 過夜自驅片單(2026-07-18 夜;Sean 過夜跑、早上驗收)

> 新視窗照此片單依序跑,**卡住就跳下一片**(不空轉不猜),持續寫晨間報告 `docs/handoff/2026-07-19-overnight-report.md`(①完成片+commit hash ②🔴 Sean 待辦逐條 ③卡住/跳過原因 ④決策題)。**每片走完整 SOP:graphify 查連動→plan(標 L1/L2/L3、判鐵則8)→實作→三綠→審查→精準 commit+STATUS 7 欄同 commit→不 push**。

**🔴 審查省 codex 額度規則(Sean 2026-07-18 拍)**:codex 關卡2 **只跑高風險片**(鐵則 12 = order/payment/schema/RLS/migration/tier/經銷價、或鐵則 8 重大改動);**純前台 UI/小件低風險片跳 codex**,走 **code-reviewer + Fable** 兩審即可(Fable = `Task` spawn `adversarial-reviewer` + `model:fable`、在 Claude 訂閱、不吃 codex OpenAI 額度;不可用時路由 Opus 仍算獨立一審)。每個 reviewer 硬上限 2 輪、R2 仍 FAIL→停該片寫報告跳下一片;🔴 修 must-fix grep 全 diff 掃同款。

**片單(依序、卡住跳下一項)**:
1. **E2a-2**(對帳補寄+五訊號)= app 層無 migration、**可完全自主**。🔴 高風險(order 對帳)→ **三審含 codex**。紅線見上「E2a-2 執行視窗」。
2. **E2b**(pg_cron/pg_net/Vault)= 🔴 **Sean-gated**(db push/SQL Editor/Vault)→ **只寫 plan 進報告、不執行任何 DDL/schedule**。
3. **E3**(order_created enqueue)= 動付款成功路徑 🔴 高風險 → 可做 app 層 + L2 placeholder 文案、**真文案等 Sean 過目**、enqueue 必全 catch 不影響付款、產 Codex Packet 進報告(三審含 codex);判斷風險高就只寫 plan 等 Sean。
4. **不擋線小件**(純前台低風險 → **跳 codex、code-reviewer + Fable 兩審**):最新商品 UI / Q3d 佔位圖 / Q3a 佔位頁 / Q3e 結帳內嵌地址。
5. **E4** = 🔴 **BLOCKED**(等 Sean 定義「一批」+ dedup 算法)→ 不做。

**硬 STOP(命中寫報告+跳過,絕不自己做)**:push / db push / migration apply / SQL Editor / Vault / pg_cron / pg_net / 動 .env* / 輸出 secret / 替 Sean 拍板 / L3 內容 / 不可逆或對外 / 文案最終版 / 宣稱「肉眼驗」/ 鐵則 8 重大改動的「執行」/ 兩輪用盡或同錯法第 2 次。

## 流程紀律(沿用)

- 執行 session 不 push(07-17 三推皆 Sean 明說);動 schema commit 壓住等 db push+驗;dev:main 恆 Sean 明說。
- ⚠️ `dev` = pcm-admin 的 **production** 分支(推 dev = admin 後台直接上線);storefront 才守 `main`。
- 拍板即落檔;codex 全程 `-s read-only`+porcelain 前後比對。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`、`docs/progress-roadmap.html`(pre-existing modified、刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*` kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 🆕 **2026-07-20 #288-a(E2E 守門支線、未 commit、awaiting codex review finalization)**:
  `apps/storefront/scripts/e2e-prod-preflight.mjs`、`apps/storefront/playwright.prod.config.ts`、
  `apps/storefront/e2e-prod/runner-smoke.spec.ts`、`.github/workflows/e2e-prod.yml`、
  `vitest.config.ts`、`apps/storefront/package.json`、
  `docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md`、`docs/phase-1-backlog.md`、`STATUS.md`
  ——全屬本片(✅ 已於 07-20 收進單一 commit;另含 `docs/reviews/2026-07-20-288a-prod-e2e-packet.md` 與本檔)。
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值。
- migration db push=Sean 操作;`email_outbox.recipient_email`=PII、client 零權限;經銷價不進非 admin client;金額整數;audit 不可繞。

## 相關入口

- 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`
- plan 真權威:`docs/specs/2026-07-16-m4a-email-notify-plan.md` **v3.3**
- memory:`project_m4a-email-e2a-decisions`(**Q1-Q13** 拍板+Resend 事實+E1c/E2a-a 審查紀錄)/ `project_refund-line-two-stage`(Q8)/ `project_m4a-email-e1a-decisions`(E1a+E1b+REQUIRED-E2a/E3 義務)
- backlog:**#285**(未知 429 精準退避)/ **#286**(死信人工重送工具)
