# SESSION HANDOFF — 2026-07-02 M-3 #252 begin-dedup 驗證 → GAP2 盲區 B+A → #256 卡住指紋治本

> 一句話結果:**#252 begin-dedup 兜底驗證(二度確認抓出 GAP2 靜默雙扣盲區)→ Sean 拍 B+A 處置 → #256 pending-based 雙扣偵測「卡住指紋」治本 全數完成、db push live 驗過**。**3 commit 全 push**(origin/dev=`766dff7`)。非全程 auto mode(Sean 逐關拍板 Q1/Q2/Q3 + 操作 db push/push)。
> 環境:repo `pcm-website-v2` · Supabase `bmpnplmnldofgaohnaok`(live)· branch `dev` · engineering mode。HEAD=`766dff7`。`TAPPAY_3DS_ENABLED` + `ANOMALY_ALERT_ENABLED` 全程 false(prod 未部署)。
> 接手先讀:STATUS.md(當前 slice/下一步/Blocker)+ 真權威 `docs/specs/2026-07-01-m3-256-pending-double-charge-detection-plan.md` + 驗證報告 `docs/reviews/2026-07-01-m3-252-begin-dedup-fallback-verification.md` + backlog #256/#252 + CLAUDE.md 鐵則 8/12。

## 1. 做了什麼(按時序)

- **#252 begin-dedup 兜底驗證**(commit `e5fa597`、純文件):驗「3DS flag 緊急關閉中間態、pending 兄弟單靠舊版 `begin_charge_attempt` cart-dedup 兜底」。唯讀 MCP 確認 live begin(0c 版)+ DDL MCP 六場景 `BEGIN..ROLLBACK` 零留痕合成模擬(殘留 0/0/0):同 cart pending/charged→`needs_settle`、paid→`duplicate`、異 cart <10min→**user_in_flight cart-agnostic 安全網**→ 主場景守住;GAP1(released)/GAP2(異 cart+>10min)→acquired=true。**二度確認 adversarial-reviewer + codex 跨模型 round1 皆 FAIL**:🔴 **修正初稿過度承諾** —— GAP1 released 可達但 `released→charged` 觸發 genesis→#250 `open` 偵測+W1 可退;🔴 **GAP2 純 pending(異 cart+>10min)= 靜默雙扣偵測盲區**(late-success 走 `pending→charged` 不觸發 anomaly genesis〔全 repo 唯一 anomaly 主表 INSERT gate `status='released'`、`20260624120005:118/128`〕、#250 六計數逐一驗無一抓得到)→ round2 PASS + code-reviewer PASS-WITH-NITS。gate=PASS-WITH-CAVEAT。
- **GAP2 盲區處置 拍 B+A**(commit `3114227`、純文件):Sean 拍「依建議」=B+A。**B(縱深、已落)**=canonical §14 步45 加「關 flag 縱深防護」條目(計畫性關 flag 先跑 settle-sweep 收斂 in-flight pending→終態再關;緊急關後立即跑+人工比對;壓縮盲窗非零窗)。**A(治本、排 #256)**=pending-based 雙扣偵測。不採單純 C(informed-accept)。
- **#256 pending-based 雙扣偵測「卡住指紋」治本**(commit `766dff7`、code+migration+docs):Sean 拍 Q1=A 嚴啟發式(窗 5min→codex K1 審出結構性漏→改 12h)/ Q2=A 輕量(計數告警+runbook 查明細、不建持久表)/ Q3=A 批准。**Sean 顧慮「客人真的會買兩個一樣的分兩單」→ 資料驗證解**:真實 charged attempt 從結帳到扣款耗時全 <2min、卡住>10min=0 → 用「**卡住指紋**」(charged attempt `updated_at-created_at`>門檻)區分:正常買兩個秒扣不報、GAP2 第一筆卡久才報。實作見 §3+下列 code。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 | push |
|---|---|---|
| `766dff7` | feat: #256 pending 雙扣偵測擴 anomaly 聚合 RPC 加卡住指紋計數(migration+TS 全鏈+runbook Report C+plan+STATUS/backlog) | ✅ 已推 origin/dev |
| `3114227` | docs: #252 GAP2 盲區處置拍 B+A + 建 backlog #256 治本 | ✅ 已推 origin/dev |
| `e5fa597` | docs: #252 begin-dedup 兜底驗證 PASS-WITH-CAVEAT + GAP2 盲區 | ✅ 已推 origin/dev |

**全 push**(origin/dev=`766dff7`、ahead 0/behind 0)。工作樹 clean。

## 3. DB / 部署 / 外部足跡(非 git,接手看不到 diff)

- **migration `20260701130000_m3_256_pending_double_charge_detection.sql`**:✅ **已 db push live**(Sean 於 2026-07-02 跑、`.env.local` 暫移法、`Applying→Finished`)。**DROP 舊單參 `get_payment_anomaly_alert_summary(integer)` → CREATE 三參 `(integer,integer,integer)`**:#250 六計數逐字保留 + 加第 7 計數 `pending_double_charge_candidate_count`(同 user+同 total+兩 paid 單 paid_at 差<`p_pending_dc_window_seconds`〔12h〕+ 其一 charged attempt `updated_at-created_at`>`p_pending_dc_stuck_seconds`〔10min 卡住指紋〕的候選「組」數)+ ACL REVOKE 5+GRANT payment_confirmer + 4 assert(EXECUTE 矩陣/role_routine danger/role-hygiene/effective-priv 含 orders)。
- **Claude 唯讀 MCP 驗證 gate(db push 後)= ALL PASS**:三參簽名存在/單參已 DROP、SECDEF+`search_path=""`、ACL 矩陣(pc=T/anon·auth·svc=F)、role_routine danger=0、effective-priv payment_confirmer 對 anomaly 兩表/attempts/**orders** 零直讀=false、呼叫回 7 鍵、pdc_count=0。
- **資料寫入**:無(本片純唯讀聚合 + 讀取報表、零寫路徑)。
- **#250 migration `20260701120000`**:早已 db push live(本 session 前);#256 DROP 其單參函式 → 建三參版取代(migration 鏈正常)。
- **Vercel 部署 / env**:未動。cron `anomaly-alert` 已存在(#250)、現多讀第 7 計數 + 2 個 route 常數(43200/600);gated by `ANOMALY_ALERT_ENABLED` 預設 false = 未實際跑。launch 前設 flag+密鑰時第 7 計數自動生效(無需再改 code)。

## 4. graphify 地圖增量

**未刷**(本 session #256 動了 .ts,依預設該刷,但 Sean 本 session 明講「graphify 你說才跑」→ 尊重手動偏好、跳過)。🔴 **地圖對 #256 新 code 實體滯後**(getAlertSummary 三參 / pendingDoubleChargeCandidateCount / ALERT_PENDING_DC_* 常數等未入圖)。接手若要更新 → `/graphify --update`(從 repo 根、code-only AST 增量)。前次刷=#250 session(3361 nodes/5015 edges)。

## 5. 開放項(待辦)

- ⏳ **開 prod flag 前 gate(剩)**:**#251** DB reason allowlist 補 released_failure_observed(需 db push)/ **#253** B1 manual=false 孤兒升級(新窄權 RPC、鐵則 8/12、需 db push、Sean 拍過 defer)/ **B 線 cron route**(reconfirmExpiredOrphans 無 caller;🔴 Vercel Hobby 上限 2 cron/daily〔settle-sweep + anomaly-alert 已滿〕→ 加第 3 個需 Pro)/ **#254** cron 限流 hardening(純 TS、LOW)/ **#255** 雙扣告警去重(需 db push、可與 #256 監控併)。
- 🔴 **carry-over(非本 session)**:live 上 **0072/0073 兩筆真雙扣待 Sean 依 W1 runbook 退款**(舊 A1 popup 事件、各 17,300;依 `docs/runbooks/2026-06-26-*` Report A → claim → Dashboard 退舊 rec → resolve)。
- ⏳ **正式上線(日後大步驟、鐵則 8)**:merge dev→main(main 落後)+ 修 Vercel Root Directory + design-reference submodule + 設 `NEXT_PUBLIC_SITE_URL` + Sean 拍板開 `TAPPAY_3DS_ENABLED`。
- ⏳ **可選**:graphify --update 刷 #256 code 實體(見 §4)。

## 6. push 狀態與收尾自檢(接手第一眼)

**全 push**(origin/dev=`766dff7`)、工作樹 clean、無殘檔。下個 session 進入點:① 讀 STATUS 下一步 + 本 handoff §5 ② 挑剩餘 gate(#251 最輕〔但需 db push〕/ #253 / #254 純 TS 可完整做完 / B 線 cron)或 Sean 指定 ③ 動手前照 CLAUDE.md 自驅 SOP(grep 真權威 + 標鐵則 8/12)。

收尾自檢:git status clean ✅ / 0 unpushed ✅ / 無 .env*·data·大檔殘留(`.env.local` db push 後已還原)✅ / Secret 0 洩漏(handoff 全文無密鑰、commit 經 code-reviewer+adversarial+codex 掃)✅ / DB 足跡見 §3 ✅ / graphify 未刷見 §4。

**驗證留痕**:#252 DDL MCP 六場景零留痕(殘留 0/0/0)+ #256 DDL MCP 六模擬〔S1 卡700s同額=1 / S2 秒扣30s同額=0〔Sean 顧慮解〕/ S3 異額 / S4 超窗 / S5 單筆=0〕零留痕 + 三參 overload ACL/effective-priv 驗 + **db push 後唯讀 MCP gate ALL PASS** + 三綠 typecheck7/lint10/build1 + **vitest 145 檔 1569 passed** + 審查鏈(#256:codex K1 二輪〔r1 FAIL→r2 PASS〕+ codex K2 跨模型 + adversarial-reviewer + code-reviewer 皆 PASS-WITH-NITS、findings 全折入)。

## 相關 plan / 記憶 / 文件

- 真權威 plan:`docs/specs/2026-07-01-m3-256-pending-double-charge-detection-plan.md`(#256、codex K1 r2 PASS)
- 驗證報告:`docs/reviews/2026-07-01-m3-252-begin-dedup-fallback-verification.md`(#252、GAP2 盲區來由)
- runbook:`docs/runbooks/2026-06-26-m3-3ds-double-charge-refund-runbook.md`(§1E Report C = #256 pending 雙扣候選查明細 + 退款目標人工查證;Report A = 0072/0073 W1 退款)
- canonical:`docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §14 步45(GAP2 縱深 B)
- backlog:`docs/phase-1-backlog.md` #252(PASS-WITH-CAVEAT+B+A)/ #256(✅ 已實作待驗〔已驗〕)/ #251/#253/#254/#255
- 誠實邊界(#256):候選待查證非已確認雙扣、卡住指紋降誤報非零(極少數正常付款也可能拖久)、`updated_at-created_at` 近似 charged 時長(偏保守多抓非漏)、退款目標人工查證(GAP2 無 released 錨點、不可自動退)。
