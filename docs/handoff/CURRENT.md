# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> E1c 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`(⚠️ **僅供 E1c 追溯、不是開工依據**——其「下一步」字面已被 E2a-a 超越〔E2a 已拆三片、§⑩ 已定案、port method 已存在〕;**開工入口 = 本檔 + `STATUS.md`「下一步」**)。

## 交接資訊

- Updated: 2026-07-18,Asia/Taipei
- Agent: Claude Code 實作視窗(**E2a-c sweeper route + server-only composition + 單測**〔`api/cron/email-sweep/route.ts`+`lib/email/composition.ts`+兩測+plan;codex R1 5+R2 3 must-fix 全修+突變自驗〕)
- Branch / HEAD: `dev` = E2a-c commit(🔴 hash/未推數**不寫死**,實跑取得:`git log --oneline -1` / `git rev-parse --short origin/dev` / `git rev-list --count origin/dev..HEAD`;本檔寫定當下 = origin/dev `a691a9d`〔E2a-b 已推〕、本地 ahead 1〔E2a-c〕)。`origin/main` = `13ce3a9`(production、本線未上)
- DB: migrations 至 `20260717020000` **全 apply**;E1c-2(§⑨)與 **E2a-a(§⑩)**皆 = **純註解增補、零 DDL**(獨立驗證:剔除 `--` 行後 byte-identical → **無需 re-apply、無漂移**);無新 migration

## 目前目標

**M-4a 第一期收口 ②Email 通知片**。E1a ✅ → E1b ✅ → E1c ✅ 已推 → **E2a 拆三片(Sean Q12=A)**:E2a-a ✅(`6a8b155`)→ E2a-b ✅(`a691a9d`)→ **E2a-c(route+server-only composition)✅ code 收工、未推(本 commit)** → **下一=E2a-2(對帳+五訊號)** → E2b(pg_cron/pg_net/Vault)→ E3(order_created)→ E4。
> 🔴 **Sean Q13=A:E2a 三片皆不做告警**(全歸 E2a-2 獨立管道;plan §5「E2a + failed 告警」字面**已作廢**——sweeper 不可自我監看)。
> 🔴 **E2a-c 定案(Sean 07-18 依建議)**:**無 `*_ENABLED` gate**(codex 抓「未批准架構增項+靜默失敗態」→ 移除;真寄前自然閘=`ORDER_EMAIL_FROM` 未設即 503 + E2b pg_cron + E3 前表零列)。

## 🔴 下一個最小動作(E2a-2 執行視窗)

> 🔴 **寫 E2a-2 plan 前必查 graphify 連動面**(Sean 07-17 當場抓、memory `feedback_graphify-query-before-planning-is-mandatory`):repo 根跑 `graphify query`(本 repo `graphify-out/`)查對帳/anomaly-alert/`checkAnomalyAlerts`/`email_outbox` NOT EXISTS 的連動邊,plan **必附「相關既有紀錄與連動面」一節**。**查(每片必做)≠ 刷 `--update`(milestone/每日收工才跑)**。

1. 讀 migration `20260717020000` 頭註 **§⑦+§⑨+§⑩**(仲裁序 §⑦<§⑨<§⑩、五訊號)+ **REQUIRED-E2a-2**(§⑧ `skipped_order_ineligible` 天然不被訊號命中的殘餘盲區)+ memory `project_m4a-email-e2a-decisions`(Q1-Q15)/ `project_refund-line-two-stage`(Q8)+ plan **v3.3** §3.5b/§3.6/§4。
2. **E2a-2**(對帳補寄 + 五訊號掛 anomaly-alert 獨立管道 + 單測):
   - **對帳補寄**(§3.5b):**固定下界+`NOT EXISTS`** 全量重疊掃(否決移動 watermark);**Q4=A 下界走 env、未設即 skip 並在 response 明說**;述詞欄=`orders.paid_at`;吃 `email_outbox_order_idx (order_id, event_type)`。
   - **Q3=A ineligible gate** = `payment_status='refunded' OR cancelled_at IS NOT NULL`(🔴 **今日命中率 0**:兩者皆有欄零程式寫入、退款人工在 TapPay 後台 → 待[退款線第一段](memory `project_refund-line-two-stage`)落地才生效);轉入必寫 `last_error_code='order_ineligible'`+抑制路徑必附測試。
   - **🔴 五訊號**掛 anomaly-alert **獨立管道**(`checkAnomalyAlerts` use-case / `getAnomalyAlertDeps` composition;🔴 **不可放進 sweeper 自我監看**、死時告警一起死)。訊號定義見 migration §⑦(1-4)+§⑨(訊號 5 額度耗盡走 LINE、訊號 1 述詞修正)。
3. 🔴 **E2a-c 已定合約**:sweeper route=`api/cron/email-sweep`(GET/CRON_SECRET/limit 50/`maxRunSeconds: maxDuration`/`errors>0→503`/`deferred>0→200`/counts allowlist/**零告警**);composition=`lib/email/composition.ts`(`getSweepEmailOutboxDeps`);**排程仍待 E2b pg_cron**(本片與 E2a-c 皆不進 `vercel.json`)。
4. 審查閘=code-reviewer + codex 關卡2(**勿省**;⚠️ `EXIT=0` 假訊號、**必讀輸出內容**;`codex exec` 背景跑+porcelain 前後比對)。🔴 **修 must-fix 一律 grep 全 diff 掃同款、非只改點名行**(E2a-c R1→R2 兩輪皆因此再 FAIL)。

## 流程紀律(沿用)

- 執行 session 不 push(07-17 三推皆 Sean 明說);動 schema commit 壓住等 db push+驗;dev:main 恆 Sean 明說。
- ⚠️ `dev` = pcm-admin 的 **production** 分支(推 dev = admin 後台直接上線);storefront 才守 `main`。
- 拍板即落檔;codex 全程 `-s read-only`+porcelain 前後比對。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`、`docs/progress-roadmap.html`(pre-existing modified、刻意不 stage)
- untracked 凍結:`admin-orders.png`、`mobile-*.png`、`docs/handoff/2026-07-1*` kickoff/report 群、`docs/reviews/2026-07-16-m4a-v-line-packet.md`、`docs/specs/2026-07-1*`、`docs/superpowers/`
- 接手不得 reset/stash/刪除或混成同一 commit。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值。
- migration db push=Sean 操作;`email_outbox.recipient_email`=PII、client 零權限;經銷價不進非 admin client;金額整數;audit 不可繞。

## 相關入口

- 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`
- plan 真權威:`docs/specs/2026-07-16-m4a-email-notify-plan.md` **v3.3**
- memory:`project_m4a-email-e2a-decisions`(**Q1-Q13** 拍板+Resend 事實+E1c/E2a-a 審查紀錄)/ `project_refund-line-two-stage`(Q8)/ `project_m4a-email-e1a-decisions`(E1a+E1b+REQUIRED-E2a/E3 義務)
- backlog:**#285**(未知 429 精準退避)/ **#286**(死信人工重送工具)
