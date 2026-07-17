# CURRENT HANDOFF — pcm-website-v2

> 這是下一個 Codex 或 Claude session 的唯一當次交接入口。長期規則看 `docs/ops/AI_CONTRACT.md`,專案進度以根目錄 `STATUS.md` 為準(已同 commit 對齊)。
> E1c 當次快照:`docs/handoff/2026-07-17-m4a-email-e1c-handoff.md`(⚠️ **僅供 E1c 追溯、不是開工依據**——其「下一步」字面已被 E2a-a 超越〔E2a 已拆三片、§⑩ 已定案、port method 已存在〕;**開工入口 = 本檔 + `STATUS.md`「下一步」**)。

## 交接資訊

- Updated: 2026-07-17,Asia/Taipei
- Agent: Claude Code 實作視窗(E1c 兩片 → **E2a-a lease 回收零件層**〔port `reclaimStaleLeases`+adapter+7 測〕)
- Branch / HEAD: `dev` = **`6025a37`** = `origin/dev`(**已同步、ahead 0**;E2a-a = `6a8b155` 已 commit **已推**,`merge-base --is-ancestor` 驗過)。`origin/main` = `13ce3a9`(production、本線未上)
- DB: migrations 至 `20260717020000` **全 apply**;E1c-2(§⑨)與 **E2a-a(§⑩)**皆 = **純註解增補、零 DDL**(獨立驗證:剔除 `--` 行後 byte-identical → **無需 re-apply、無漂移**);無新 migration

## 目前目標

**M-4a 第一期收口 ②Email 通知片**。E1a(表)✅ → E1b(port/adapter)✅ → E1c(429 三分+退避合約)✅ 已推 → **E2a 拆三片(Sean Q12=A)**:**E2a-a(lease 回收零件層)✅ 已推(`6a8b155`)** → **下一=E2a-b(退避政策+sweeper use-case)** → E2a-c(route+composition)→ E2a-2(對帳+**五訊號**)→ E2b(pg_cron/pg_net/Vault)→ E3(order_created)→ E4。
> 🔴 **Sean Q13=A:E2a 三片皆不做告警**(全歸 E2a-2 獨立管道;plan §5「E2a + failed 告警」字面**已作廢**——sweeper 不可自我監看)。

## 🔴 下一個最小動作(E2a 執行視窗)

> 🔴 **寫 E2a-b plan 前必查 graphify 連動面**(Sean 07-17 當場抓、memory `feedback_graphify-query-before-planning-is-mandatory`):在 repo 根跑 `graphify query "<E2a-b 相關問題>"`(用本 repo `graphify-out/`)查 sweeper/退避政策/`IEmailOutbox`/`checkAnomalyAlerts` 的連動邊,plan **必附「相關既有紀錄與連動面」一節**,否則 Sean 看不到你有沒有跳步。注意:**查(每片必做)≠ 刷 `--update`(milestone/每日收工才跑)**。

1. 讀 migration `20260717020000` 頭註 **§⑦+§⑨+§⑩**(⚠️ **漂移仲裁序 = §⑦ < §⑨ < §⑩**;§⑦「四訊號」已被 §⑨ 超越為**五訊號**;**§⑩ = E2a-a 的回收落點定案**〔回收落 `failed`、`pending@max` 不可達、零盲區〕)+ `packages/ports/src/IEmailOutbox.ts` JSDoc(⚠️ **世代柵欄只在持有者路徑**;回收器走 CAS 述詞)+ memory `project_m4a-email-e2a-decisions`(Q1-Q13)+ plan **v3.2** §3.5b/§3.6/§4.2。
2. ✅ **原硬前置「同步 plan」已消滅**(Sean 07-17 **Q15=A**):plan 真權威**已搬進本 repo** = **`docs/specs/2026-07-16-m4a-email-notify-plan.md` v3.3**(舊路徑 `pcm-tools/review-inbox/` 為**零版控 untracked 檔**、已改指標 stub、**不得再引用**)。v3.3 已更正:§3.5-4/§3.6 回收落 `failed`(非 pending)、§5 拆片表 E2a-a✅/b/c、§5「E2a + failed 告警」**作廢**(Q13=A)。→ **plan 從此與 code 同 commit,不再有跨 repo 同步債**。
3. **E2a-b**(退避政策模組 + sweeper use-case + 單測;鏡像 `checkAnomalyAlerts` 分層):退避照 **§⑨ 三列**(quota_daily/monthly+`http_429` = 失敗時點 +24h+jitter、**禁指數退避**;`rate_limited` = 15 分+jitter;其餘 = 指數 5min×2^(attempts-1) 上限 2h)。**燒速上限每日 1 次不需另做機關**:`max_attempts=5` 配 +24h 天然 = 每日一次 → 5 天緩衝。
4. **E2a-c**(route + server-only composition + 單測):骨架抄 `anomaly-alert/route.ts`;composition 抄 `line-admin.ts:19-21`(`import 'server-only'` + `eslint-disable-next-line no-restricted-imports` 受控例外);窄 cast `createSupabaseServiceClient() as unknown as EmailOutboxClient`;`syntheticEmailDomain` 注入 `LINE_SYNTHETIC_EMAIL_DOMAIN`(`line.ts:38`)。🔴 **不進 `vercel.json` crons**(排程走 E2b 的 pg_cron;Hobby cron 一天一次放不了 `*/5`)。
5. 審查閘=code-reviewer + codex 關卡2(plan §5 明定、**勿省**)。⚠️ **codex 07-17 起撞 quota 牆、07-23 才恢復**(`EXIT=0` 是假訊號=錯誤寫 stdout;**必讀輸出內容**才知有沒有真的審)→ 替身 = adversarial-reviewer 帶 **Fable**(真跨模型),但**不等於 codex 背書**、不得寫「雙審都過」= STATUS 待決策⑥。

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
