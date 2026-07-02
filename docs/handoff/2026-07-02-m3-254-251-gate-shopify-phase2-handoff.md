# SESSION HANDOFF — 2026-07-02 M-3 #254 cron 限流 + #251 retry allowlist ✅ + #255/#253/B線 defer + Shopify 定調 Phase 2

> 一句話結果:**開 prod flag 前 gate 這一輪處理完:#254 cron 端點應用層限流 + #251 retry RPC reason allowlist 對齊 兩片實作完成(皆過 codex K2 + Fable 5 adversarial + code-reviewer 三模型審 0 must-fix),3 commit 已 push;#255/#253/B線 cron 經 Sean 拍板 defer;孤兒單治本方向定調 = Shopify「付款成功才建單」= Phase 2 目標架構**。**3 commit 全 push**(origin/dev=`632ead0`)。非全程 auto(Sean 逐關拍 Q1–Q4 + A+甲 方向)。
> 環境:repo `pcm-website-v2` · Supabase `bmpnplmnldofgaohnaok`(live)· branch `dev` · engineering mode。HEAD=`632ead0`。`TAPPAY_3DS_ENABLED` + `ANOMALY_ALERT_ENABLED` + `CRON_SWEEPER_ENABLED` 全程 false(prod 未部署)。
> 🔴 **接手第一件事**:**#251 migration `20260702120000` 尚未 db push**(Claude 被 `.env*` deny 擋、須 Sean 跑)→ 見 §5。
> 接手先讀:STATUS.md(下一步/Blocker)+ backlog #251/#254/#249 + memory `project_shopify-payment-first-order-phase2-target` + `feedback_adversarial-reviewer-deep-review-layer`(Fable 5 真跨模型)+ 本 handoff。

## 1. 做了什麼(按時序)

- **起手檢查**:branch=dev / 樹 clean;🔵 發現 **HEAD=`a32caf0`≠ 交接所述 `766dff7`**,查清 = a32caf0 是上個 session 的交接檔 commit(busboy 印表機)、766dff7 之子、已 push,良性 off-by-one。順帶校正 STATUS 過時字面(#256/#250「未 push/未 db push」實已完成、見上個 handoff §3)。
- **Sean 授權「寫審分離多代理 + Fable 5 + codex 額度回歸」**:本輪審查端 = **codex K2(主 session 唯讀、正牌跨模型)+ adversarial-reviewer 跑 Fable 5(`model:fable`=真跨模型)+ code-reviewer(鐵則快篩)** 三路,執行端 = 我(Opus)。鐵則 7 例外(Sean 親口要多代理審查)。
- **#254 cron 端點應用層限流 hardening**(commit `792a8f8`、純 TS 無 migration):新增共用 in-memory sliding-window 限流器 `apps/storefront/src/lib/cron/rate-limit.ts`(視窗 60s / 每窗 MAX 5、per-route key、被擋不佔額度不延長鎖定、`import 'server-only'`)+ 兩 cron route(anomaly-alert + settle-sweep)於**認證通過後、enabled gate 前**呼 `checkCronRateLimit` 超限回 429。威脅 = CRON_SECRET(兩 route 共用、Vercel 單一 secret)洩漏後持有效 secret 高頻觸發消耗 LINE/Resend quota + 放大 Record API。「評估獨立 secret」= 不做(Vercel 平台限制)→ 限流 + 輪替 secret 收口。三模型審 0 must-fix、findings 全折入(disabled+flood→429 排序釘死測 / 軟化過度承諾 + 誠實邊界#4 告警壓制窗 / 半開窗措辭 / server-only / Date.now 倒退跳註)。三綠 + 完整 vitest 146 檔 1585(+16)。
- **#251 retry RPC reason allowlist 補 released_failure_observed**(commit `8b12757`、migration + docstring):新 migration `20260702120000` CREATE OR REPLACE 兩支 SECDEF retry RPC(`mark_attempt_settle_retry` live 基線 20260624120008 / `mark_webhook_retry` live 基線 20260615120000),**唯一改動 = allowlist `IN(...)` 加第 4 碼 released_failure_observed**(可執行 SQL 除該行零行為漂移)+ `sweep-settlements.ts` docstring 對齊(暫不對齊→#251 已補、db push 生效)。**DDL MCP 零留痕 sim**(atomic DO + synthetic order/attempt/webhook + T1-T5 行為 + ACL 矩陣 + role-hygiene + 末端 RAISE rollback、殘留 0/0/0)+ 唯讀驗 live=repo 基線無漂移。三模型審 0 must-fix、nits 全折入。三綠 typecheck 7 + lint 10 + build 1。signature 未變 → database.types.ts 無需 regen。
- **Sean 拍板 defer 三片 gate**(Q1=B/Q2=依建議/Q3=B):**#255** 告警去重(併未來監控面板)/ **#253** B1 孤兒升級(sweeper ceiling 兜底、非急、留接近上線再做)/ **B 線 cron**(不升 Vercel Pro、上線規劃再決)。
- **孤兒單治本方向定調(Sean A+甲)= Shopify「付款成功才建單」= Phase 2 目標架構**(commit `632ead0`、backlog #249 決策註記):Phase 1 維持「先建單(unpaid)+ 3DS 對帳脊椎」+ 顯示層藏孤兒(#249 已做)、**先上線**;不採方案 A(reuse 補丁)、**不推翻 M-3 3DS 主線**。🔴 孤兒/未付款單**絕不硬刪**(late-success 晚扣款→刪單=客人被扣款查無單=靜默多扣、unpaid 單是對帳錨點)。方案 B = 整個 3DS 子系統重構(反轉建單↔付款因果 + 重定對帳主鍵 + 拆 FK)、走專屬 PRD + codex 雙關卡 + Sean 批;不消滅 TapPay 雙扣牆。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | push |
|---|---|---|
| `632ead0` | docs: #249 孤兒單治本定調 Shopify 付成才建單=Phase 2 目標架構 | ✅ origin/dev |
| `8b12757` | fix: #251 兩支 retry RPC allowlist 補 released_failure_observed | ✅ origin/dev |
| `792a8f8` | feat: #254 cron 端點加應用層限流防 secret 洩漏 flood | ✅ origin/dev |

**全 push**(origin/dev=`632ead0`、雙向同步 ahead 0/behind 0、pre-push lint 10/10 綠、admin bypass「Required status check "check" is expected」)。工作樹 clean。

## 3. DB / 部署 / 外部足跡(非 git,接手看不到 diff)

- 🔴 **migration `20260702120000_m3_251_retry_reason_allowlist_released_failure_observed.sql`:已進 repo + 已 push,但【未 db push】**(Claude `.env*` deny 擋)→ **Sean 待辦(見 §5)**。DDL MCP 已零留痕模擬過(BEGIN…RAISE rollback、殘留 0/0/0);另唯讀 MCP 驗過 live 兩支 RPC 仍 = 基線 3 碼版(attempt 含 R1c1 溢位 cap、ACL payment_confirmer=T/其餘=F)→ **live=repo 基線無漂移,Sean db push 安全**。db push 後 live 兩支 allowlist 會變 4 碼。
- **#254 無 DB 足跡**(純 TS in-memory 限流器);**無資料寫入**。
- **live 已套用 migration 到 `20260701130000`**(#256);#251 是唯一未套用 → **db push 只會套這一個**。
- **Vercel 部署 / env**:未動。cron 限流是 route 內縱深、prod 未部署 + gate false = 零即時風險。

## 4. graphify 地圖增量

**未刷**(本 session 動了 .ts〔#254 route+lib、#251 sweep-settlements docstring〕,依預設該刷,但 Sean 手動偏好「graphify 你說才跑」→ 跳過)。🔴 **地圖對 #254 新實體滯後**(`apps/storefront/src/lib/cron/rate-limit.ts` = 新檔、checkCronRateLimit/resetCronRateLimit 未入圖;#251 為 docstring-only 無新實體)。接手若要更新 → `/graphify --update`(從 repo 根、code-only AST 增量)。

## 5. 開放項(待辦)

- 🔴🔴 **Sean db push #251**(接手第一件事):`cd /Users/sean_1/pcm-website-v2 && mv .env.local .env.local.bak && supabase db push && mv .env.local.bak .env.local`(只套 `20260702120000`、按 Y;失敗記得手動移回 .env.local)→ **完成後 Claude 唯讀 MCP 驗兩支 RPC allowlist 已變 4 碼 + ACL 矩陣**(STATUS #251 下一步驗證關卡)。prod 未部署 + flag false = 零影響,非急但屬 #251 收尾。
- ⏳ **開 prod flag 前 gate — 已全數處置**:#254 ✅ / #251 ✅(待 db push)/ **#255 defer**(併監控面板)/ **#253 defer**(sweeper ceiling 兜底)/ **B 線 cron defer**(不升 Vercel Pro)。→ 這一輪 gate 清單處理完畢;剩「上線本身」。
- ⏳ **正式上線(日後大步驟、鐵則 8、Sean 主導)**:merge dev→main(main 落後 origin/main=`9f609b0`)+ 修 Vercel Root Directory + design-reference submodule + 設 `NEXT_PUBLIC_SITE_URL` + Sean 拍板開 `TAPPAY_3DS_ENABLED`。
- 🔴 **carry-over(Sean 手動)**:live 上 **0072/0073 兩筆真雙扣待退款**(舊 A1 popup、各 17,300;依 W1 runbook `docs/runbooks/2026-06-26-*` → claim → Dashboard 退舊 rec → resolve)。
- 🏛️ **Phase 2(日後)**:Shopify「付款成功才建單」重構(backlog #249 方案 B、memory `project_shopify-payment-first-order-phase2-target`)—— 現在**不動 code、不寫 PRD**,Phase 2 啟動才走專屬 PRD。
- ⏳ **可選**:graphify --update 刷 #254 新 lib(見 §4);/pcm-roadmap 刷進度地圖(本 session 未跑)。

## 6. push 狀態與收尾自檢(接手第一眼)

**全 push**(origin/dev=`632ead0`)、工作樹 clean、無殘檔。下個 session 進入點:① **Sean db push #251**(§5)+ Claude 驗 allowlist ② 讀 STATUS 下一步 + 本 handoff §5 ③ gate 已清 → 接「上線規劃」或 Sean 指定 / Phase 2。

收尾自檢:git status clean ✅ / 0 unpushed ✅(已 push)/ 無 .env*·data·大檔殘留(`.env.local` 未動、無 db push)✅ / Secret 0 洩漏(handoff/commit 全文無密鑰)✅ / DB 足跡見 §3 ✅ / graphify 未刷見 §4。

**驗證留痕**:#254 三綠 + vitest 146/1585 + 三模型審 0 must-fix(codex K2 PASS-with-comments 零留痕 + code-reviewer PASS + Fable 5 adversarial PASS-WITH-NITS 7 擊破全擋);#251 DDL MCP 零留痕 sim T1-T5 + ACL + role-hygiene + live-vs-repo 無漂移驗 + 三綠 + 三模型審 0 must-fix(codex K2 PASS-with-nits + code-reviewer PASS + Fable 5 PASS-WITH-NITS 9 擊破全擋);nits 全折入。

## 相關 plan / 記憶 / 文件

- backlog:`docs/phase-1-backlog.md` #254(✅)/ #251(✅ 待 db push)/ #249(方向定調 Shopify Phase 2)/ #255·#253(defer)
- migration:`supabase/migrations/20260702120000_m3_251_retry_reason_allowlist_released_failure_observed.sql`(待 db push)
- 新檔:`apps/storefront/src/lib/cron/rate-limit.ts`(+ .test.ts)
- 記憶:`project_shopify-payment-first-order-phase2-target`(Phase 2 方向)/ `feedback_adversarial-reviewer-deep-review-layer`(Fable 5 = 真跨模型、2026-07-02 升級)
- 誠實邊界:#254 限流 = per-instance best-effort 非全域硬上限(升級路徑併 #255)、活躍 flood 期間合法 cron 同窗亦 429;#251 診斷欄純遙測、Phase 1 producer-gating 零觸發;Shopify 方案 B 不消滅 TapPay 雙扣牆。
