# S5 排程上線 Plan — 報價單→網站每天自動同步

> 2026-06-03 / Claude Code 自驅。**鐵則 8 重大改動(infra/部署)plan、等 Sean 拍「排哪裡跑」才動手、本片未碰實作。**
> 前序:S3b-2 全站上線 ✅ + S4 下架對賬 ✅ + S6 fitments 接線 ✅。S5 是資料線最後一片。
> 相關:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md` §4 S5、`docs/specs/2026-06-02-S3b-sync-rewrite-plan.md`。

---

## 1. 目標
每天自動把網站商品對齊報價單源頭(無人值守):跑既有 `scripts/rpm-import.ts --confirm-write`(FULL 模式 → 含 S4 下架對賬),後台一改、最慢隔天自動上架/改價/下架。源頭掛掉網站照賣昨天資料(複製模式天然降級)。

## 2. 什麼跑 / 何時跑
- **命令**:`pnpm exec tsx scripts/rpm-import.ts --confirm-write`(全量、無 `--group`/`--limit` → FULL_MODE → 走 reconcile;tsx 已釘 devDep、走 exec 不 dlx 避免抓 latest)。
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
- ✅ **57014 retry(已實作 rpm-fetch.ts `fetchPageWithRetry`)**:每頁指數退避(1s→2s)、限 3 次、最後仍敗才拋;無人值守冷 timeout 自動恢復。
- ✅ **W1 抓取完整性 gate(已實作 rpm-preflight.ts `checkFetchIntegrity`、Sean 拍 A;fallback W1-1/W1-2/W1-4 修正)**:**商品維度差集**(target active 商品 external_id − source main_sku、growth-immune 新品蓋不掉缺口;非變體維度、非淨筆數),缺現存上架商品 **>5% 硬 abort**(嚴於 S4 下架 10%、專抓 5–10% 靜默截斷帶)、首灌(active=0)不擋、`--allow-fetch-shrink` bypass、**pre-write**(寫入前 throw、dry-run 只報告)。⚠️ **殘留缺口(誠實標)**:<5% 靜默截斷單次快照無法與日常合法下架區分 → 根治需持久化上次成功基線、**留 backlog #210**;日常增量幅度遠 <5%、且 S4 >10% 兜底。
- ✅ **W2 並發互斥(已實作 workflow `concurrency: {group: rpm-sync, cancel-in-progress: false}`)**:後到 run 排隊、不互殺(防 reconcile read→compute→apply 交錯)。

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

**實作 + 審查實況(2026-06-03)**:Sean 拍 A(GitHub Actions + 台灣 03:00)→ 實作完成(workflow `rpm-sync.yml` + 57014 retry + W1 + secret docs §10)→ 審查 round1:code-reviewer PASS、Claude fallback(codex 代替)PASS-with-WARN **抓 W1 真 BLOCKER**(W1 原量「變體」維度 + 淨筆數、與 S4「商品」維度誤下架錯配、且新品蓋缺口;tsx 未釘供應鏈)→ Sean 拍 A 修法:**W1 改商品維度差集 + 5% 門檻(嚴於 S4 10%)+ tsx 釘 devDep + 殘留 <5% 缺口 backlog #210** → 重審 round2 → commit。

## 10. Secret 設定步驟(Sean dashboard 操作、Code 不碰金鑰值)
平台選定 A GitHub Actions 後,在 repo 設 4 個 secret(workflow:`.github/workflows/rpm-sync.yml`):
1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**。
2. 逐一新增(Name 完全照下、Value 貼對應金鑰):

   | Secret Name | 值來源 | 說明 |
   |---|---|---|
   | `QUOTE_SUPABASE_URL` | 報價單 B庫 → Settings → API → Project URL(`https://dllwkkfanaebrsuyuedy.supabase.co`) | 來源 view |
   | `QUOTE_SUPABASE_PUBLISHABLE_KEY` | 報價單 B庫 → API → anon / publishable key | 來源唯讀(讀不到成本/蝦皮/經銷) |
   | `NEXT_PUBLIC_SUPABASE_URL` | 網站庫 → API → Project URL(`https://bmpnplmnldofgaohnaok.supabase.co`) | 目標 |
   | `SUPABASE_SECRET_KEY` | 網站庫 → API → **service_role** key | 🔴 目標寫入、最高權限、只放此處 |

3. 設好後到 **Actions 頁 → RPM Daily Sync → Run workflow**(workflow_dispatch)手動跑一次驗證(或等隔天台灣 03:00 自動)。
4. 🔴 `SUPABASE_SECRET_KEY` 是「能改全站資料」的最高權限金鑰:**只設於此 secret、絕不貼對話 / 進 git / echo 到 log**。Code 端不碰金鑰值(本機 `.env.local` 已有同名、不外流)。
5. ⚠️ scheduled workflow 60 天無 repo 活動會被 GitHub auto-disable;PCM 開發活躍期一般不會觸發,但長假/凍結期需留意到 Actions 頁確認仍啟用。

— END —
