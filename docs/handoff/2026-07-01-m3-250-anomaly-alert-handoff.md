# SESSION HANDOFF — 2026-07-01 M-3 #250 雙扣 anomaly 主動告警 gate 完整收尾

> 一句話結果:**#250 雙扣 anomaly 主動告警 gate 100% 完成 + 端到端實證**(SECDEF 聚合 RPC + cron + LINE/Email notifier、四方審全過、db push live 驗過、Email 真收到告警信)。**全 push**(origin/dev=`2e9f85f`)。非全程 auto mode(Sean 逐關拍板 + 操作 Vercel/db push)。
> 環境:repo `pcm-website-v2` · Supabase `bmpnplmnldofgaohnaok`(live)· branch `dev` · engineering mode。HEAD=`2e9f85f`。`TAPPAY_3DS_ENABLED` + `ANOMALY_ALERT_ENABLED` 全程 false(prod 未部署)。
> 接手先讀:STATUS.md(當前 slice/下一步/Blocker)+ 真權威 `docs/specs/2026-07-01-m3-250-anomaly-alert-plan.md` + L1 報告 `docs/security/2026-07-01-website-run-1/REPORT.md` + 記憶 `project_250-email-alert-resend-verified-domain` + CLAUDE.md 鐵則 8/12。

## 1. 做了什麼(按時序)

- **選 gate + 動手前審**(關卡1):從 STATUS 下一步 5 道 gate 選 **#250**(Gemini 標「上線前必補」最高)。寫 plan → Gemini(範圍/半套)+ codex K1(schema/RPC、零留痕 PASS)+ adversarial-reviewer(plan 級 PASS-with-comments)三方審,**6 findings 全折入**:死卡列拆兩計數 / 文案不宣稱已確認雙扣 / Vercel tier 現實 / ACL 5 角色 REVOKE / CRON_SECRET sequencing / 營運參數揭示可調非 SLA。
- **Sean 拍板**:Q1=**A+C**(LINE + Email 雙管道)/ Q2=**不做 heartbeat**(歸未來系統檢測監控面板)/ Q3=**批准開工**。
- **實作**(commit `2d6c8c5`、20 檔 code + 4 docs):見 §3 DB + 下列 code。owner-defined SECDEF 聚合 RPC 讀零 PII 計數(payment_confirmer 對 anomaly 兩表零表權→經受控窗)+ cron route(鏡像 settle-sweep)+ use-case(門檻踩→Promise.allSettled 對所有管道、reader/notifier throw→503 fail-closed、踩門檻零管道 throw)+ LINE/Email notifier(原生 fetch 零新依賴、密鑰不入 log/訊息)+ composition getAnomalyAlertDeps(依 env 組管道)+ vercel.json 加 cron `0 1 * * *`。
- **動手後審**(關卡2):**codex K2 跨模型 PASS**(2 MED+1 NIT 折入:use-case 零管道 guard / effective-privilege assert / oldest age plumb)+ code-reviewer PASS + adversarial-reviewer PASS-with-comments + **pcm-security-audit L1**(0 CRITICAL/0 HIGH/1 LOW→#254)。findings 全折入。
- **db push live 驗過**(Sean 跑 db push、Claude 唯讀 MCP 驗):函式簽名/SECDEF/`search_path=""`/ACL 矩陣(pc=T·anon/auth/svc=F)/role-hygiene/effective-privilege/行為 round-trip(live open=2)/migration 入帳 = **ALL PASS**。
- **Email 管道實證**:Sean 於 Resend 驗證網域 `pcmmotorsports.com`(DKIM/SPF Verified、DNS 在 Squarespace)+ Vercel Production env 設好 + **本機 smoke 端到端測試成功**(cron→RPC→Resend→真收到告警 email、報 2 筆真雙扣候選)。
- **結論型決策**:Email 管道走 **Resend 驗網域**(Sean 拍 A 否決 Google SMTP、程式零改動、與 Google Workspace 共存)— 記憶 `project_250-email-alert-resend-verified-domain`。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | push |
|---|---|---|
| `2d6c8c5` | feat: #250 雙扣 anomaly 主動告警 cron + SECDEF 聚合 RPC(20 檔 code + STATUS/backlog/plan/L1) | ✅ 已推 origin/dev |
| `2e9f85f` | docs: 進度地圖刷新(M-3-D6、#250 收尾) | ✅ 已推 origin/dev |

**全 push**(origin/dev=`2e9f85f`、ahead 0/behind 0)。工作樹 clean。

## 3. DB / 部署 / 外部足跡(非 git,接手看不到 diff)

- **migration `20260701120000_m3_250_anomaly_alert_summary.sql`**:✅ **已 db push live**(Sean 跑)。純 ADD 一支唯讀 SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(integer)`(REVOKE 5 角色 + GRANT payment_confirmer + 6 fail-closed assert)。**不動** anomaly 兩表 grant 與 lifecycle RPC。CREATE OR REPLACE 語意、可重跑;rollback = `DROP FUNCTION`。已唯讀 MCP 驗 catalog/ACL/effective-privilege/行為 ALL PASS、DDL MCP BEGIN..ROLLBACK 零留痕模擬過。
- **資料寫入**:無(本片純唯讀聚合、零寫路徑)。
- **Vercel 部署 / env**:Sean 於 Production 設 `ANOMALY_ALERT_ENABLED='true'` + `RESEND_API_KEY`<REDACTED> + `ALERT_EMAIL_FROM=alerts@pcmmotorsports.com` + `ALERT_EMAIL_TO=<Sean 信箱>`(LINE 那組 `LINE_CHANNEL_ACCESS_TOKEN`/`LINE_ALERT_TO` **未設**=LINE 待補)。`CRON_SECRET` 與 settle-sweep 共用(已存在)。
- **🔴 Vercel prod 紅叉(無害、勿誤修)**:Vercel Production 綁 **main** 分支,main=`9f609b0`(落後 dev **562 commit**、**無 vercel.json**)→ 設 env 後 Redeploy 觸發 build main 失敗「No Next.js detected」。**與 #250 無關、無在線站被弄壞**(prod 本就未上線)。上線=日後計畫(merge dev→main + 修 Root Directory + submodule),**不要為消紅叉反射性 merge**。
- **排程**:vercel.json 新增 cron `/api/cron/anomaly-alert` `0 1 * * *`(UTC=台灣 09:00、晚 settle-sweep 1h);gated by `ANOMALY_ALERT_ENABLED` 預設休眠、prod 未部署 = 未實際跑。Hobby 上限 2 cron/daily(這是第 2 個、無升頻空間、升頻需 Pro)。

## 4. graphify 地圖增量

**已刷**(本 session /graphify --update、code-only AST 增量):`3289→3361 nodes / 4893→5015 edges / 302 communities`(+72 nodes / +122 edges = #250 code 實體 anomaly-alert.ts / getAnomalyAlertDeps() / CheckAnomalyAlertsDeps / LineAlertNotifierConfig 等)。graphify-out 本機不入 git。前綴對齊、0 PII。

## 5. 開放項(待辦)

- 🔴 **Sean 親自**:還原本機 `apps/storefront/.env.local` 測試變數(刪/false 掉 `ANOMALY_ALERT_ENABLED` + `RESEND_*` + `ALERT_EMAIL_*`、把 `LINE_CHANNEL_ACCESS_TOKEN` 前的 `#` 拿掉)。本機檔、不影響 Vercel。
- 🔴 **0072/0073 雙扣待 Sean W1 退款**（live 現有 2 筆 open anomaly = 告警實測報的那 2 筆;依 W1 runbook claim→Dashboard 退舊 rec→resolve）。carry-over。
- ⏳ **LINE 告警管道待設**（Email 已實證;LINE 需正式 Messaging API 頻道 access token + Sean userId `LINE_ALERT_TO`,非 LINE 登入的 CHANNEL_ID/SECRET）。接手可給 Sean 逐步清單。
- ⏳ **開 prod flag 前 gate 剩**:**#252** R3 gating begin-dedup 兜底驗證(偏 MCP 驗證、~15min）/ **#253** B1 manual=false 孤兒升級（sweeper 已兜底、Sean 拍過 defer、~30-45min 新窄權 RPC）/ **B 線 cron route**（reconfirmExpiredOrphans 無 caller、接排程、canonical §9）。
- ⏳ **follow-up**:**#254** cron 限流 + 評估獨立 secret（LOW hardening）/ **#255** 雙扣告警去重（含未來監控面板 heartbeat）。
- ⏳ **正式上線（日後大步驟、鐵則 8）**:merge dev→main（562 commit）+ 修 Vercel Root Directory + design-reference submodule fetch + 設 `NEXT_PUBLIC_SITE_URL` 正式網域 + Sean 拍板開 `TAPPAY_3DS_ENABLED` — 要當完整計畫做、非現在。

## 6. push 狀態與收尾自檢(接手第一眼)

**全 push**（origin/dev=`2e9f85f`）、工作樹 clean、無殘檔。下個 session 進入點:① 讀 STATUS 下一步 + 本 handoff §5 ② 挑 #252（最輕、MCP 驗證）或 #253 或 B 線 cron 開工，或 Sean 指定 ③ 動手前照 CLAUDE.md 自驅 SOP（grep 真權威 + 標鐵則 8/12）。

收尾自檢:git status clean ✅ / 無 .env*·data·大檔殘留 ✅ / Secret 0 洩漏（handoff 全文以 `<REDACTED>` 帶過、commit diff 經 code-reviewer+adversarial 掃無密鑰）✅ / DB 足跡見 §3 ✅ / graphify 已刷見 §4 ✅。

**驗證留痕**:DDL MCP 零留痕模擬（行為 delta open2→3/refunding0→1/stuck@24h=1/stuck@30d=0 + residue=0）+ live 唯讀 MCP round-trip ALL PASS + 三綠 7/7·10/10·1/1 + **完整 vitest 145 檔 1568 passed** + **Email 端到端 smoke 實證成功**（真收到告警信）。

## 相關 plan / 記憶 / 文件

- 真權威 plan:`docs/specs/2026-07-01-m3-250-anomaly-alert-plan.md`
- L1 安全報告:`docs/security/2026-07-01-website-run-1/REPORT.md`
- 記憶:`project_250-email-alert-resend-verified-domain`(Email 管道決策)、`project_m3-3ds-yi-r1-db-sim-pass`(R1/anomaly gate 脈絡)
- backlog:`docs/phase-1-backlog.md` #250(✅)/#252/#253/#254/#255
- canonical:`docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §7 + W1 runbook `docs/runbooks/2026-06-26-m3-3ds-double-charge-refund-runbook.md`
