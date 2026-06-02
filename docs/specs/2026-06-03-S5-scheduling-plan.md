# S5 排程上線 Plan — 報價單→網站每天自動同步

> 2026-06-03 / Claude Code 自驅。**鐵則 8 重大改動(infra/部署)plan、等 Sean 拍「排哪裡跑」才動手、本片未碰實作。**
> 前序:S3b-2 全站上線 ✅ + S4 下架對賬 ✅ + S6 fitments 接線 ✅。S5 是資料線最後一片。
> 相關:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md` §4 S5、`docs/specs/2026-06-02-S3b-sync-rewrite-plan.md`。

---

## 1. 目標
每天自動把網站商品對齊報價單源頭(無人值守):跑既有 `scripts/rpm-import.ts --confirm-write`(FULL 模式 → 含 S4 下架對賬),後台一改、最慢隔天自動上架/改價/下架。源頭掛掉網站照賣昨天資料(複製模式天然降級)。

## 2. 什麼跑 / 何時跑
- **命令**:`pnpm dlx tsx scripts/rpm-import.ts --confirm-write`(全量、無 `--group`/`--limit` → FULL_MODE → 走 reconcile)。
- **頻率**:一天一次(Q3=A 即時層延後、批次足夠)。
- **時段(建議)**:每天一個點、台灣 03:00(= `cron: '0 19 * * *'`、UTC;台灣 UTC+8 全年無夏令時、UTC 19:00 恆為次日台灣 03:00)。理由:避報價單側白天作業中(source 資料較定)、網站低流量、給 ISR/CDN 隔天 revalidate 緩衝。⚠️ GitHub Actions cron 表達式**一律 UTC、勿填台灣時間**。

## 3. 平台決策(鐵則 8、Sean 拍「排哪裡跑」)

| 平台 | 怎麼跑 | Pros | Cons | 改寫量 |
|---|---|---|---|---|
| **A GitHub Actions(推薦)** | scheduled workflow `on: schedule: cron`(UTC)直跑既有 tsx 腳本(同 ci.yml runner:pnpm 9.15.0 + Node 22 + frozen-lockfile) | infra + Node 腳本 pattern 已在(ci.yml);充裕 time limit(無 serverless 限時、全量 8878 沒問題);secrets 走 repo/environment secrets;不擴 service_role 到 storefront | cron 觸發 best-effort(可能延數分~十數分);egress 從 GitHub runner 連兩個 Supabase 專案;失敗通知弱 + 60 天無活動 auto-disable 須留意(§8);並發須自設 concurrency(§5 W2) | **極小**(env bootstrap 已修 ✅ 99346da + 加 1 個 .github/workflows/*.yml〔含 concurrency〕+ 設 4 個 repo secret) |
| **B Supabase pg_cron** | pg_cron 排程、但**不能直跑 tsx Node 腳本** → 須把整條 TS pipeline 改寫 Deno Edge Function(pg_net 觸發)或純 SQL | 跑在 Supabase 內、無外部 runner | 來源是**另一個** Supabase 專案(B庫 `dllwk…` vs 目標 `bmpnpl…`)→ 跨專案讀 view 仍須 edge function 做 HTTP;**整條 pipeline 大改寫**(TS→Deno/SQL)、複合鍵 upsert/兩層 delta/reconcile/安全 gate 全要重寫重驗 | **高**(等於重做 S2–S4) |
| **C Vercel Cron** | Vercel Cron 觸發 storefront API route(`app/api/cron/sync`)、route 內跑 sync | 與部署同平台(vercel.json 已 nextjs);secrets 走 Vercel env | 須包 sync 成 API route;**service_role key(SUPABASE_SECRET_KEY)進 storefront 部署**=擴 ADR-0005 §7 service_role surface(目前 storefront 只 line-admin 一處受控小門);**serverless function timeout 風險**(全量 fetch 8878 + upsert 8878 + reconcile 可能 >Vercel 限時 60–300s) | 中(API route wrapper + env + surface 擴張審查) |

**推薦 A**:重用既有腳本(僅需極小 env bootstrap 修、已修 99346da)、time limit 充裕、不擴 service_role 到 storefront、infra pattern 已驗(ci.yml)。

> ⚠️ **fallback 對抗審查更正(2026-06-03)**:本 plan v1 §3/§5 原宣稱 A 案「零腳本改寫」**不實**(鐵則 11)。實況:`rpm-import.ts` 原無條件 `loadEnvFile('.env.local')`、runner 無此檔會 ENOENT crash → 已修為 existsSync 守(99346da)。下方 §5 同步補 3 個 fallback 審查發現的韌性缺口(W1 部分頁殘缺 / W2 並發 / W3 告警)。codex 關卡1 本輪撞 OpenAI usage limit(到 7/2 才恢復)未取得、改 Claude fresh-context fallback 對抗審查(同模型、非 codex 不同模型);正式 codex k1 留 S5 實作前補(quota 恢復 / Sean 貼 web Codex)。

## 4. 安全(不論平台、硬性)
- 4 個連線 env 一律走**平台 secret store、絕不進 git**:
  - `QUOTE_SUPABASE_URL` / `QUOTE_SUPABASE_PUBLISHABLE_KEY`(來源報價單 anon、讀不到成本/蝦皮/經銷)
  - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY`(目標 service_role、寫 products/variants)
- service_role key 只在排程 runner 環境、不進 client bundle(本就 server-side ETL 腳本、無 bundle 面)。
- 最小權限:來源 anon publishable(敏感欄物理排除)、目標 service_role(僅排程環境持有)。
- A 案 secret 設定:repo Settings → Secrets and variables → Actions(或 environment secrets 加 protection);⚠️ 絕不 echo secret 到 log、workflow 用 `${{ secrets.* }}` 注入 env。
- A 案 workflow 觸發限縮(fallback 審查):限 `on: schedule`(+ 選擇性 `workflow_dispatch` 限 collaborator)、**不掛 `pull_request`/`pull_request_target`**(scheduled workflow 不接外部 PR 觸發、secret 不給 fork PR、故 fork secret 暴露面實際不存在);持有 service_role 的 workflow **不引入未審第三方 action**、沿用 ci.yml 已驗(actions/checkout@v4 + pnpm/action-setup@v4 + actions/setup-node@v4)。

## 5. 韌性(script 已有 + S5 補)
- ✅ 冪等 upsert(複合鍵 onConflict)— 重跑安全。
- ✅ 異常硬 gate(null/0/負/NaN)+ `--confirm-write` 守門 — S3b 已建。
- ✅ 下架安全 gate(source 空硬 abort / 比例>10% abort)+ scope rpm — S4 已建。
- ✅ 失敗 → `process.exit(1)` → 平台 mark run 失敗 + 通知;隔天 run 自動補(複製模式降級、source 掛網站照賣昨天)。
- ✅ env bootstrap(B1、已修 99346da):existsSync 守 loadEnvFile、runner 無 .env.local 不再 ENOENT crash(fallback 審查 BLOCKER、已修)。
- ✅ target host gate(rpm-import:寫入前精準比對目標 host、非允許 dev project 拒寫):額外保險、fallback 審查確認屬實。
- ⚠️ **S5 須補:anon view 57014 statement timeout**。現腳本 `rpm-fetch.ts` fetch 無 retry、cron 遇冷 timeout 會整 run 失敗(今日手動 3 次中 2 次首發冷撞、retry 即過)。S5 實作補 **fetch 層 retry**(指數退避、限 3 次)或請報價單側 view 加索引(跨 repo、Sean 協調)。屬 S5 實作項、平台無關。
- ⚠️ **S5 須補(W1、fallback 審查):source 部分頁靜默殘缺 <10% → 誤下架真商品**。`rpm-fetch.ts` 逐頁累加 + `rows.length < PAGE_SIZE` 即 break;若某頁無 error 但回少量列(非預期截斷)→ fetch「成功」回殘缺集合、delta 看不出(只比價)、下架 10% gate 是唯一防線、殘缺剛好 <10% 會靜默軟下架在架商品(無人值守無 Sean 看 dry-run)。緩解(Sean 拍):fetch 後驗總筆數 vs 上次成功/期望基線、低於閾值 abort。S5 實作項。
- ⚠️ **S5 須補(W2、fallback 審查):並發 run 互斥**。新 scheduled workflow 不繼承 ci.yml 的 concurrency;reconcile 的 read-active→compute→applyDelist 無交易包裹、兩 run 交錯可能算出不一致 toDelist。緩解:新 workflow 自設 `concurrency: { group: rpm-sync, cancel-in-progress: false }`(後到排隊、不互殺到一半)。A 案實作項。

## 6. Rollback
- 排程可停(disable workflow / 刪 cron)。
- 已寫資料冪等、下一次 clean run 覆寫;軟下架可還原(scope rpm)。
- 最壞回到「手動跑腳本」現狀。

## 7. 影響面
- **不動 storefront runtime**(storefront 讀自家 `products` 不變、只是資料來源變每天自動)。
- A 案:加 `.github/workflows/<name>.yml` + 設 repo secrets(Sean dashboard 操作)。
- B/C 案:見 §3 改寫量。

## 8. 需要 Sean
- **Q-S5-platform(鐵則 8)**:排哪裡跑?A GitHub Actions(推薦)/ B Supabase pg_cron / C Vercel Cron。
- **Q-S5-secret**:平台選定後、4 個 env 由 Sean 在該平台 dashboard 設 secret(Code 端不碰 .env/secret 值)。
- **Q-S5-schedule(可選)**:時段沿用建議台灣 03:00(`cron: '0 19 * * *'` UTC)或 Sean 指定。
- **Q-S5-alerting(fallback 審查 W3)**:失敗告警走 GitHub Actions 預設 email(只寄給上次改該 workflow 的人、夠用?)還是要更可靠主動告警(失敗 step 發 webhook / LINE)?⚠️ 已知陷阱:**GitHub scheduled workflow 60 天無 repo 活動會被自動 disable**(無人值守需週期性活動或留意)。

## 9. 流程(本片)
S5 plan(本檔)→ ~~codex 關卡1~~(本輪撞 OpenAI usage limit、到 7/2 恢復)→ **Claude fresh-context fallback 對抗審查已跑**(findings 折入:B1 已修 + W1/W2/W3 + N1)→ Sean 拍平台 + 時段 → 才實作(A 案:寫 workflow yml〔含 concurrency + on:schedule 限縮〕+ fetch retry〔57014〕+ source 筆數 sanity check〔W1〕+ 文件化 secret 設定步驟、三綠、code-reviewer;**正式 codex k1/k2 留 quota 恢復或 Sean 貼 web Codex 補**;命中 infra 不命中 schema/RLS/migration/pricing → codex 關卡2 視改動判)。

— END —
