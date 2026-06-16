# M-3 3DS-4 — sweeper cron plan(2026-06-15、鐵則 8 + 鐵則 12、待 Sean 批)

> **真權威**:master plan v5 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` §2(3DS-4)+ §1(a)(c)/§4/§7/§9。
> **前序已成**:settleCharge 對帳脊椎(3DS-1b、`packages/use-cases/src/settle-charge.ts`)+ getSettleChargeDeps cookieless factory + webhook inbox(3DS-0a `payment_webhook_events`)+ webhook route(3DS-2)+ callback page(3DS-3)皆已 push。
> **流程**:本 plan → codex 關卡1(read-only 審 plan vs master §2)→ 自修 → 橋接審查 session 第二意見 → 決策批次問 Sean → 批准才實作。**本階段只規劃、不寫 code、不動 vercel.json、不 commit。**

---

## ① 任務目標(1-2 句)

建 **3DS 對帳兜底 sweeper(週期 cron)**:掃兩來源〔① webhook inbox `processed=false` 退避未處理事件 ② stuck unsettled charge attempt(pending+charged-未付款)〕→ 共呼 `settleCharge`(Record API 唯一權威);只 Record 明確 final-failed/cancel 才判 failed、其餘保留+告警;端點 CRON_SECRET 硬驗、Record 節流 + per-order 去重。**Phase I 結算基建最後一塊**(callback/webhook 漏接的最終一致保證)。

---

## ② 前置檢查

```
git branch --show-current   # = dev
git status                  # 允許 untracked:.playwright-mcp/ + docs/reviews/m3-3ds-review-log.md + 本 plan 檔;允許 modified(規劃折入):docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md(§9 amend)+ docs/phase-1-backlog.md(#231)
git log --oneline -3        # HEAD = 76cbf00(3DS-3 K2 r1)對齊 STATUS
```
三者綠才繼續(規劃折入已動 master §9 + backlog #231 + 本 plan 檔;此三者隨 4a 同一規劃提交、或先獨立 docs 提交;codex K1 r2 consider)。

---

## ③ 執行模式(規劃階段)

mode B / conductor: main session / **本階段 = plan + codex 關卡1 only、不實作**。實作階段(Sean 批後)subagent_chain: code-reviewer 必跑、codex 關卡2 必跑(鐵則 12 payment + migration)。

🔴 **鐵則 4 拆 sub-slice**(15-45min 可中斷;沿 3DS-0/1 拆法;三模型審查群 1/5 令 4a schema 變大 → 拆 4a-1 inbox / 4a-2 attempt、4c 拆出 4d activation):
| 子片 | 內容 | 命中 | bundle |
|---|---|---|---|
| **3DS-4a-1** | migration(inbox RPC):`claim_due_webhook_events`(🔴 原子 lease=CTE `SELECT … FOR UPDATE SKIP LOCKED LIMIT p_limit` → `UPDATE … FROM due RETURNING`;claim 內 attempt_count++、回 `attempt_count`〔claim token、群4〕;claim 濾 `attempt_count<ceiling`〔達上限退熱迴圈〕)/ `mark_webhook_processed(p_rec_trade_id, p_claimed_count)` / `mark_webhook_retry(p_rec_trade_id, p_claimed_count, p_reason_code)`(🔴 群4 token guard:`WHERE processed=false AND attempt_count=p_claimed_count`、回 affected count;只寫 next_retry_at 退避+last_error、**不 ++**;達 ceiling → set `needs_manual_review`〔群6 durable〕);+ inbox 加 `needs_manual_review boolean DEFAULT false` 欄;REVOKE EXECUTE 全+GRANT payment_confirmer+矩陣 assert | migration | 🔴 **入 db push bundle** |
| **3DS-4a-2** | migration(attempt schema+RPC):🔴 群1 `payment_charge_attempts` ALTER 加 `settle_attempt_count int NOT NULL DEFAULT 0` + `next_settle_at timestamptz` + `needs_manual_review boolean DEFAULT false`(鏡像 inbox);🔴 r2-#2 **`claim_stuck_unsettled_attempts`**(原子 FOR UPDATE SKIP LOCKED+lease+token、ceiling-expirer 前置、`status IN(pending,charged) AND payment_status='unpaid'`)/ 🔴 r2-#3 **`flag_non_unpaid_active_attempts`**(標 refunded/partiallyPaid 殘留→needs_manual_review)/ `mark_attempt_settle_retry`(token guard〔含 needs_manual_review=false、codex K2 r1〕、達 ceiling→manual、不 ++);REVOKE/GRANT/矩陣 assert | migration | 🔴 **入 db push bundle** |
| **3DS-4b-1** | port 擴 + adapter:`IWebhookInbox` 加 claimDueEvents/markProcessed/markRetry(帶 claimedCount+reasonCode);`IChargeAttemptStore` 加 `listStuckUnsettled` + `markSettleRetry`;Pg*Adapter 實作(payment_confirmer 同鑰、複用 buildPgConfig)+ adapter 單元測 | adapter | 純 code |
| **3DS-4b-2** | sweeper use-case `sweepSettlements`(orchestrate 兩來源 → settleCharge 共呼〔🔴 群3 inbox 帶 recTradeIdHint〕、🔴 群7 順序/有界並發、per-order 去重、fail-closed 單筆不中斷、pending→markRetry/markSettleRetry、達上限→needs_manual_review+結構化告警)+ 單元測(見 §5.2) | use-case | 純 code |
| **3DS-4c** | cron route `app/api/cron/settle-sweep`:🔴 群5 `export async function GET`(Vercel cron 走 GET)+ `requireCronSecret()` Bearer 硬驗(沿 3DS-2 requireNotifySecret)+ 🔴 `CRON_SWEEPER_ENABLED` gate(default false=200 no-op、enabled+error=5xx)+ 批次/timeout 上限 + 結構化告警 log。**route+use-case 純 code、不含 vercel.json** | route | 純 code |
| **3DS-4d** | vercel.json crons 啟用(🔴 群5 獨立片、deploy config 鐵則 8)。**前置硬列**:prod 已設 `CRON_SECRET`(已存在 .env.local、確認高熵未外洩)+ 4a 兩 migration 已 push prod + `CRON_SWEEPER_ENABLED` 決策完成 | deploy config | 純 config(gated) |

---

## ④ Manifest Impact + Review 觸發

- **動到的**:**新後端**(RPC/use-case/adapter/cron route)+ **deploy config**(vercel.json crons);**零 storefront 元件**(非 design-mirror 範圍、manifest CheckoutPage 不動)。
- **對應 design 源**:無(後端對帳基建、design 無此面)。
- **review_triggers**:slice_review / code_review / **security_review_required**(鐵則 12 payment + 未驗證端點)/ **codex_review_required**(關卡1 plan + 關卡2 diff、每子片)/ **db_migration_review**(4a)。

---

## ⑤ 執行步驟(實作階段、Sean 批後;本階段只規劃)

### 5.0 架構定調(grep 驗後)

- **Vercel cron HTTP route(非 Supabase pg_cron)**:settleCharge 是 TS use-case + 需 TapPay Record API(出站 HTTPS);pg_cron 無法跑 TS/出站 HTTP → 必 Vercel cron 觸發 Next route handler → 跑 settleCharge。master §2「Supabase/Vercel cron」取 Vercel。
- **payment_confirmer 表層零權限事實(grep 實證;codex 關卡1 consider 4 精準化)**:`payment_webhook_events` 顯式 `REVOKE ALL … FROM payment_confirmer`(0a L92);`payment_charge_attempts` 零表權限主要由 **role-hygiene assert** 證明(s2d:非每處顯式 REVOKE payment_confirmer、但矩陣 assert 終態自證表全 false)。兩表寫入皆唯 SECURITY DEFINER RPC;現有 RPC 僅 `record_webhook_event`(insert)/ `get_active_charge_attempt`(單筆讀)/ begin/mark×2 → sweeper 要的「列未處理 inbox / 列 stuck unsettled / claim+mark」**全不存在** → 3DS-4a 必新 RPC = **必 migration**。
  - **替代評估(service_role 直讀)否決**:service_role 對兩表有 SELECT(0a L93 / s2d L121),但 ① 無法 atomic claim/mark(UPDATE 權限被 REVOKE)② 引 service_role 進 cron = 擴大密鑰面(違窄權模型)→ **不採**,維持 payment_confirmer 窄權 RPC。

### 5.1 3DS-4a-1 migration(inbox RPC)

> 🔴 **lease_interval 釘死(群4)**:常數 **5 min**;不變式「`lease_interval ≥ 單筆最壞處理時間 × p_limit` 且 ≥ route maxDuration(60s)餘量」(Q3=A:50 筆×~500ms=25s < 60s < 5min,充裕)。🔴 **attempt_count 語意=「claim 次數」非「失敗次數」**(群4;claim 唯一遞增點)。**退避公式用 `(attempt_count-1)`**(對齊 Q2 1/2/4/8/16:首次 claim 後 count=1→2^0=1min;off-by-one 校正)。

- 🔴 **ceiling-expirer 前置(codex K1 r2 must-fix #1)**:claim 前(同 RPC pre-step 或獨立)先
  `UPDATE payment_webhook_events SET needs_manual_review=true WHERE processed=false AND needs_manual_review=false AND attempt_count>=ceiling`。**防孤兒卡死**:claim 把 attempt_count 加到 ceiling 後若 route timeout/crash 在 mark 前 → 該事件 `attempt_count>=ceiling` 永遠被 claim 濾掉、又沒被 markRetry set needs_manual_review → 永久孤兒(不掃不告警)。前置 expirer 把「達 ceiling 仍未 processed/manual」一律轉 manual(durable 告警)、補測「最後一輪 claim 後未 mark→下輪轉 manual」。
- `claim_due_webhook_events(p_limit int)` → 🔴 **原子 lease**:CTE
  `WITH due AS (SELECT rec_trade_id FROM payment_webhook_events WHERE processed=false AND needs_manual_review=false AND attempt_count<:ceiling AND (next_retry_at IS NULL OR next_retry_at<=now()) ORDER BY next_retry_at NULLS FIRST FOR UPDATE SKIP LOCKED LIMIT p_limit) UPDATE payment_webhook_events e SET attempt_count=attempt_count+1, next_retry_at=now()+'5 min' FROM due WHERE e.rec_trade_id=due.rec_trade_id RETURNING e.rec_trade_id, e.order_number, e.attempt_count`。SKIP LOCKED+LIMIT=兩 run 不重領、obey p_limit;lease 本批處理中不被重領;濾 `attempt_count<ceiling`+`needs_manual_review=false`=達上限退熱迴圈、停打 Record(群1)。回 `rec_trade_id`(🔴 群3 餵 settleCharge recTradeIdHint)+`order_number`(orderId)+`attempt_count`(🔴 群4 claim token)。
- `mark_webhook_processed(p_rec_trade_id text, p_claimed_count int)` → 🔴 **群4 token guard + 🔴 codex K2 r1**:`UPDATE … SET processed=true, processed_at=now() WHERE rec_trade_id=p_rec_trade_id AND processed=false AND attempt_count=p_claimed_count AND needs_manual_review=false` → 回 affected count(stale mark〔事件被另一 run 重領、count 變〕或**已轉人工 row late mark** = 0 no-op、不覆蓋)。🔴 `needs_manual_review=false` 把不變式收回 migration 本地、decouple 4c maxDuration≤lease 耦合(Vercel 預設 300s=lease)。
- `mark_webhook_retry(p_rec_trade_id text, p_claimed_count int, p_reason_code text)` → token guard 同上(含 `needs_manual_review=false`);**只**寫 `next_retry_at=now()+退避((attempt_count-1)→1/2/4/8/16 min)` + `last_error=p_reason_code`(🔴 固定錯誤碼集〔record_unreachable/record_unverified/…〕、零 PII);**不 ++**(遞增唯一在 claim);達 `attempt_count>=ceiling` → set `needs_manual_review=true`(群1+6 durable 轉人工、退熱迴圈)。〔無副作用:正常 count=8 markRetry 此時 needs_manual_review 仍 false→WHERE 過、再 SET 轉 true。〕
- **schema**:`ALTER TABLE payment_webhook_events ADD COLUMN needs_manual_review boolean NOT NULL DEFAULT false`(群6 durable 旗標、後台/SQL 可查)。
- **權限**:`REVOKE ALL ON FUNCTION … FROM PUBLIC,anon,authenticated,service_role` → `GRANT EXECUTE … TO payment_confirmer` → `has_function_privilege` 矩陣 fail-closed assert(memory `supabase-service-role-execute-default-grant`)。search_path='' + schema-qualified。

### 5.1b 3DS-4a-2 migration(attempt schema + RPC)

- **schema(群1)**:`ALTER TABLE payment_charge_attempts ADD COLUMN settle_attempt_count int NOT NULL DEFAULT 0, ADD COLUMN next_settle_at timestamptz, ADD COLUMN needs_manual_review boolean NOT NULL DEFAULT false`(鏡像 inbox 退避/上限/轉人工;原 charge_attempts 無此 → 修 stuck-attempt 無界重打 Record 群1 共識破口)。
- 🔴 **`claim_stuck_unsettled_attempts(p_age_seconds int, p_limit int)`(codex K1 r2 must-fix #2:attempt 路徑須對稱 inbox 的原子 claim/lease,非 read-only list)**:
  - **ceiling-expirer 前置**(must-fix #1 同理):`UPDATE … SET needs_manual_review=true WHERE status IN ('pending','charged') AND needs_manual_review=false AND settle_attempt_count>=ceiling`(防孤兒)。
  - **原子 claim**:CTE `SELECT a.id, a.order_id FROM payment_charge_attempts a JOIN orders o ON o.id=a.order_id WHERE a.status IN ('pending','charged') AND o.payment_status='unpaid' AND a.needs_manual_review=false AND a.settle_attempt_count<ceiling AND (a.next_settle_at IS NULL OR a.next_settle_at<=now()) AND a.created_at<now()-make_interval(secs=>p_age_seconds) ORDER BY a.created_at FOR UPDATE SKIP LOCKED LIMIT p_limit` → `UPDATE … SET settle_attempt_count=settle_attempt_count+1, next_settle_at=now()+'5 min' FROM claimed RETURNING attempt_id, order_id, settle_attempt_count`(claim token=settle_attempt_count;SKIP LOCKED+LIMIT+lease 同 inbox、防 timeout/卡 ceiling-1 每輪重打 Record)。
  - 🔴 **群1 含 charged-unpaid**:markCharged 成功但 confirm throw → attempt=charged/order unpaid、只掃 pending 則 confirm 永不補 → settleCharge 重入(markCharged 同 rec no-op→confirm 冪等補)收斂。回非 PII。
- 🔴 **`flag_non_unpaid_active_attempts(p_limit int)`(codex K1 r2 must-fix #3:群2 標記須真實作、非嘴上承諾)**:`UPDATE payment_charge_attempts a SET needs_manual_review=true FROM orders o WHERE o.id=a.order_id AND a.status IN ('pending','charged') AND o.payment_status NOT IN ('unpaid','paid') AND a.needs_manual_review=false RETURNING count`。claim 的 `payment_status='unpaid'` 濾掉 refunded/partiallyPaid 殘留 attempt(confirm 只收 unpaid、永不收斂)→ 本 RPC 偵測+durable 標記+回 count(sweeper 告警);補測「refunded/partiallyPaid + pending/charged → flagged」(Phase I 不可達、前瞻正確)。
- `mark_attempt_settle_retry(p_attempt_id uuid, p_claimed_count int, p_reason_code text)` → 🔴 **token guard**(`WHERE settle_attempt_count=p_claimed_count AND needs_manual_review=false`〔🔴 codex K2 r1 對齊 inbox:已轉人工 row late mark=no-op、decouple maxDuration 耦合〕、stale=no-op)+ 只寫 `next_settle_at=now()+退避((settle_attempt_count-1)→…)` + last reason_code;達 ceiling→needs_manual_review(對齊 inbox markRetry;**不再 ++**=遞增唯一在 claim)。
- **權限**:同 4a-1 REVOKE/GRANT/矩陣 assert。
- 🔴 **末補 payment_confirmer role-hygiene 回歸 assert(群5)**:`role_table_grants=0 AND role_column_grants=0`(照 1b/s2d;ALTER 加欄勿洩 grant、否則炸整 bundle)。

- **MCP 模擬驗(4a-1+4a-2)**(memory `supabase-rls-schema-test-txn-simulation`):BEGIN+套 migration+模擬 claim〔SKIP LOCKED+token+ceiling 濾〕/mark〔token guard stale=no-op〕/list〔unpaid+ceiling+age〕+ has_function_privilege 矩陣 + role-hygiene assert + ROLLBACK + 零留痕;pooled MCP SET ROLE SECDEF 斷線 → has_function_privilege+owner-run 等價論證(memory `pooled-mcp-set-role-secdef-terminates`)。🔴 **時戳 ≥ 20260615xxxxxx 嚴格排 bundle 最末**(claim/list 引用 0a/s2d/orders 前置表;checkpoint `ls supabase/migrations|sort|tail -1` 確認 4a-2 最後)+ 檔頭列依賴行(對齊 0a/1b 慣例)。

### 5.2 3DS-4b sweeper use-case + port/adapter

- **port 擴**:`IWebhookInbox` 加 `expireEventsAtCeiling(): Promise<number>`(🔴 ceiling-expirer、claim 前置)/ `claimDueEvents(limit): Promise<{recTradeId,orderNumber,attemptCount}[]>` / `markProcessed(recTradeId, claimedCount)` / `markRetry(recTradeId, claimedCount, reasonCode)`;`IChargeAttemptStore` 加 `expireStuckAtCeiling(): Promise<number>`(🔴 ceiling-expirer、claim 前置;**4b-1 補、原 §5.2 list 漏、§5.2③ 每輪呼不變式所需、codex K2 逮**)+ `claimStuckUnsettled(ageSeconds, limit): Promise<{attemptId,orderId,settleCount}[]>`(🔴 原子 claim、非 list)+ `markSettleRetry(attemptId, claimedCount, reasonCode)` + `flagNonUnpaidActive(limit): Promise<number>`。
- `sweepSettlements(deps, opts)` use-case:
  - ① claim due inbox → 各 `settleCharge(deps, { orderId: e.orderNumber, recTradeIdHint: e.recTradeId })`(🔴 **群3:帶 recTradeIdHint**、對齊 master §1 rec 來源優先序,attempt 無 rec/bank 時用 inbox rec 查 Record)→ terminal(paid/failed)/no_attempt → `markProcessed(rec, claimedCount)`;pending → `markRetry(rec, claimedCount, outcome.reason)`(退避)。
  - ② **claim** stuck unsettled(原子 lease)→ 各 `settleCharge(deps, { orderId })` → terminal/no_attempt → (attempt 路徑無「processed」、靠 settleCharge 改 status 收斂);pending → `markSettleRetry(attemptId, claimedCount, outcome.reason)`。
  - ③ 🔴 `flagNonUnpaidActive()`(**每輪無條件呼叫、不可當可選步驟**)→ 標記 refunded/partiallyPaid 殘留 attempt + 回 count(>0 告警)。**唯一回收路徑**:refunded/partiallyPaid + active + 達 ceiling 的 attempt 被 claim/expirer/mark 的 `payment_status='unpaid'` 閘全跳過 → 僅本 RPC 轉 manual;4b 漏呼=該格永久殘留(4a-2 對抗複驗 wbpvvr5b7 completeness nit、Phase I 零流量不可達但前瞻正確)。**必補測**「refunded/partiallyPaid + active → flagged」(plan §5.1b L78 已列)。
  - **per-order 去重**:同一 run 內 inbox+stuck 撞同 orderId → 只 settle 一次(in-memory Set;Q4=A Phase I 降級、見 Q4)。
  - 🔴 **群7 連線預算**:**順序處理**(非 `Promise.all`)或小並發 `p-limit 2-3`,避免 N×per-request pg Client 撞 session pooler ceiling;預算算式「每輪上限(Q3=A 100 筆)× 單筆最壞(~500ms)= 50s < maxDuration 60s」綁進 Q3;route 中途 timeout 殺 → 已 claim 事件靠 lease(5min)/退避自然重來(群4)。
  - fail-closed:單筆 throw try/catch+continue(不中斷整批);**告警/轉人工**:達 ceiling → RPC 已 set `needs_manual_review`(durable、群6)+ 結構化 `console.error`(reason_code、零 PII);🔴 **告警信號=reason 連續性**(record_unreachable/unverified 反覆)而非單純 count≥5(群4:避 Phase II 銀行端慢確認單第 5 輪誤告警)。真告警 channel 接入=prod 前置(master §9、見群6 amend)。
- adapter 走 getSettleChargeDeps 同 payment_confirmer 鑰(cookieless);Record 節流=批次 limit + 順序/有界並發。
- 單元測:亂序/重入冪等 / Record 失敗保留 pending+markRetry / per-order 去重 / 🔴 **charged-unpaid 被收斂(markCharged no-op→confirm 補→paid)** / 🔴 **群3 attempt 無 rec/bank+inbox 有 rec → 用 hint 查 Record** / 達 ceiling→needs_manual_review+不再掃 / token guard stale mark no-op / 單筆 throw 不中斷批 / 🔴 **O8 charged-unpaid 遇 explicit_failed**:settleCharge markFailed 撞 `charged→failed` RAISE(s2d status=pending guard)→ settleCharge catch 吞成 pending(**刻意安全、非缺陷**:已扣款單不可釋鎖、留 needs_manual_review 人工)→ 測 + 註解「勿改成釋鎖」。⚠️ **codex K1 r2 consider**:此態目前 reason=`record_unreachable`、與暫時 DB 失敗不可辨識 → 經 ceiling 才轉 manual(慢);**distinct reason(charged_final_failed_conflict→直送 manual)留 follow-up**(改 settleCharge〔3DS-1b 已上線〕、入 #231 prod 前置;Phase I 無流量、ceiling-then-manual 可接受)。

### 5.3 3DS-4c cron route(純 code、不含 vercel.json)

- route `app/api/cron/settle-sweep/route.ts`(runtime=nodejs、`dynamic='force-dynamic'`):🔴 **群5 `export async function GET(req)`** —— Vercel cron **走 GET**(寫成 POST 等 → cron 永不觸發=靜默不結算;明寫 GET)。
- 🔴 **`requireCronSecret()` Bearer 硬驗**(沿 3DS-2 requireNotifySecret 寫法):讀 `req.headers Authorization: Bearer ${CRON_SECRET}` + timingSafeEqual;`CRON_SECRET` env 未設 → throw → fail-closed(拒不執行、非放行);不符/缺 → 401(不揭內部)。
- 🔴 **CRON_SWEEPER_ENABLED 強制 sequencing gate(must-fix #3)**:default **false** → 認證過後 200 no-op(刻意停用、4a 未 push prod 時安全態);設 **true**(Sean 在 4a 進 prod 後才開)→ 呼 sweepSettlements;**enabled 後 RPC missing / DB error 必 5xx + 結構化 error log、不可吞成 200**(壞掉的 sweeper 偽裝成功=靜默不結算)。認證過+enabled+成功 → 200+計數摘要(零 PII)。

### 5.4 3DS-4d vercel.json crons 啟用(deploy config、鐵則 8、群5 獨立片)

- vercel.json 加 `crons: [{ path: '/api/cron/settle-sweep', schedule: '<Q1>' }]`。
- 🔴 **前置硬列(全綠才落 4d)**:① 🔴 **Sean 於 Vercel Production env 驗證 `CRON_SECRET` 已設且高熵**(codex K1 r2 consider:`.env.local` 是本機、**不能證明 prod Vercel env 已設**;Vercel 保留字、cron 自動帶;必要時輪替)② 4a-1+4a-2 兩 migration 已 push prod(bundle 解鎖後)③ `CRON_SWEEPER_ENABLED` 決策完成(Sean 設值)。
- 🔴 **部署 sequencing**:4a 在 prod 前 `CRON_SWEEPER_ENABLED=false`(即使 4d 已啟、cron 200 no-op、不噪不偽結算);4a 進 prod + Sean 開 flag 才真跑。**Phase I prod 結帳關閉、零 pending → 即使開亦無事**(中間態誠實)。
- rollback:vercel.json crons 段移除即停排程(即時、無資料)。

### 5.5 UX 防雙下單(群8、Gemini 廣度)

- 🔴 **Phase I 附帶項(廉價、動 3DS-3 已上線 callback page、小 follow-up、非 4a/4b/4c 範圍)**:3DS 等待 / callback `processing` 畫面加防呆文案「**背景自動對帳中,請勿重複下單,稍後可至『我的訂單』確認**」(台灣買家付款卡住易重新下單→重複扣款;sweeper 撈救前的 UX 防線)。**標為 Phase I 附帶 follow-up**(可與 3DS-4 並行 / 獨立 slice、動 CheckoutSuccess processing 文案)。
- **Phase II**:sweeper 撈救成功 → 主動通知(email/LINE)客人訂單已成立(留 Phase II、需通知 channel)。

---

## 🔴 鐵則 8(重大改動:deploy config + 新 RPC)

- **改 vercel.json**(新 crons 段、首次 cron、=4d)+ 新 cron route(Vercel function、=4c)+ 新 RPC 群(inbox:ceiling-expirer/claim/mark_processed/mark_retry;attempt:ceiling-expirer/claim_stuck/flag_non_unpaid/mark_settle_retry)+ 2 表 ALTER(inbox+attempt 加欄)+ port/adapter 擴(跨多檔、動部署)。
- **影響面**:① Vercel:新增週期 function 調用(成本=調用次數×頻率;Phase I 無 pending→近 no-op)。② DB:新 RPC 群 + 2 表加欄(payment_confirmer 窄權、零表權限擴張、零新角色/密碼;role-hygiene assert 守)。③ env:🔴 **`CRON_SECRET` 本機 .env.local 已有**(群5、Vercel 保留字、非新設)→ 但 **prod 用須 Sean 於 Vercel Production env 驗證已設且高熵**(codex K1 r2:.env.local≠prod env);**`CRON_SWEEPER_ENABLED` 才是真新 env**(default false、4a 進 prod 後 Sean 開)。
- 🔴 **Vercel 方案頻率限制**:cron 頻率受 Vercel plan tier 限(Hobby 較嚴、Pro 任意)→ 決策 Q1 須核 storefront 專案實際 plan(memory `deploy-topology`:暫不上線、Phase I 無流量 → 頻率非急、可 Phase II 開 prod 前定)。
- **rollback**:vercel.json crons 段移除即停排程(即時、無資料);route/use-case/adapter 未 push 可 reset;4a migration 走新檔 + rollback SQL(DROP 全新 RPC 群 + 2 表 ALTER…DROP COLUMN〔inbox needs_manual_review;attempt settle_attempt_count/next_settle_at/needs_manual_review〕);`CRON_SWEEPER_ENABLED` 移除即停。每子片獨立 commit。

## 🔴 鐵則 12(payment 端點 + 威脅模型)

- **威脅模型(cron route 觸發 settleCharge=payment)**:① 外部亂打 cron route → 偽造大量 settleCharge → 打爆 Record API 額度 / 探測 → **CRON_SECRET Bearer 硬驗擋**(無 secret → 401;Vercel cron 自動帶、外人無 secret)。② settleCharge 本身冪等 + Record 唯一權威 + 金額整數 → 即使被觸發亦不雙扣/不偽 paid(縱深)。③ sweeper 不採信任何外部輸入(無 client 參數、orderId 全 from DB)。④ last_error log 零 PII(截斷 + 白名單)。
- **不弱化既有防線**(禁止清單):不以年齡判 failed(只 Record final-failed/cancel)/ 不釋已 charged 鎖 / 經銷價零外洩(sweeper 不讀價、只 orderId)/ 卡資料零落地。

## 🔴 migration / db push bundle 判定

- **3DS-4a 需 migration**(新 RPC 群 + 2 表 ALTER、時戳最末)→ 🔴 **併入既有 db push bundle〔0b/0c/1b RPC/#214a〕**;該 bundle **受 cart_session_id 整合阻擋**(memory `3ds-db-push-bundle-blocked-until-cart-session-integration`:0b DROP 4p create_order、部署中 adapter 仍 4p、前端無 cart_session_id → 現在 db push 弄壞 prod 結帳)→ **3DS-4a 不可單獨 db push、隨 bundle 等 cart_session_id 整合(Phase II 3DS-5b/7)後一起 push**。
- **3DS-4b/4c 純 code**(use-case/adapter/route/vercel.json)→ 可先 merge dev;但 cron route 依賴 4a RPC、4a 在 prod 前 route fail-closed(§5.3 sequencing)。
- 誠實中間態:3DS-4 全到位 ≠ 開放 prod 結帳(同 master §2;Phase I+II+flag on+sandbox 過+Sean 肉眼驗 才開)。

---

## ⑥ 驗收(yes/no)

- [ ] sweeper 掃兩來源(inbox processed=false 退避 + stuck unsettled〔pending+charged-unpaid〕)→ 共呼 settleCharge(getSettleChargeDeps cookieless)。
- [ ] 只 Record final-failed/cancel(record_status -1/5)才判 failed;查不到/rate-limited/仍 pending → 保留 + markRetry 退避 + 告警(不以年齡判 failed)。
- [ ] per-order 去重(同 run inbox+pending 撞同單只 settle 一次);Record 節流(批次 limit)。
- [ ] 🔴 cron route CRON_SECRET Bearer 硬驗:無/錯 secret → 401;Vercel cron 自動帶過。
- [ ] claim 原子 lease(SKIP LOCKED+LIMIT、兩 run 不重領);🔴 **token guard**(mark 帶 claimed_count、stale mark=no-op);lease_interval=5min ≥ maxDuration;單筆 throw 不中斷整批(fail-closed)。
- [ ] 🔴 群1 **stuck-attempt 退避/上限/轉人工**:settle_attempt_count/next_settle_at/needs_manual_review 三欄 + mark_attempt_settle_retry + list ceiling 濾(達上限退熱迴圈、不無界重打 Record)。
- [ ] 🔴 群2 **charged 分支 `payment_status='unpaid'`**(非 refunded/partiallyPaid 永不收斂);非 unpaid 非 paid 殘留 → needs_manual_review 不入掃。
- [ ] 🔴 群3 inbox settleCharge 帶 **recTradeIdHint**(attempt 無 rec/bank 時用 inbox rec 查 Record)。
- [ ] 🔴 群5 cron route **GET handler** + requireCronSecret(env 未設→fail-closed)+ Vercel cron GET→200 / 無 Bearer→401 / CRON_SECRET 未設→拒。
- [ ] 全 RPC 群 + 2 表 ALTER 窄權:REVOKE EXECUTE 全 + GRANT payment_confirmer + has_function_privilege 矩陣 assert + 🔴 role-hygiene 回歸 assert(role_table/column_grants=0、加欄勿洩 grant);零表權限擴張、零新角色。
- [ ] 🔴 O8 charged-unpaid 遇 explicit_failed→markFailed RAISE→settleCharge 吞 pending(刻意安全、測 + 註解勿改釋鎖)。
- [ ] 三綠 + 完整 pnpm test + code-reviewer + codex 關卡2 + 4a-1/4a-2 MCP 模擬零留痕;4a 時戳最末入 bundle 不單推、4b/4c 純 code、4d gated。

---

## 禁止清單(基線 + 本片)

不改 scope 外檔 / 不以年齡判 failed(只 Record final-failed/cancel)/ 不釋已 charged 鎖(O8 markFailed RAISE 吞 pending 為刻意安全、勿改) / 不無界重打 Record(達 ceiling 退熱迴圈+needs_manual_review) / charged 分支只掃 `payment_status='unpaid'`(非 refunded/partiallyPaid) / inbox settleCharge 必帶 recTradeIdHint / 轉人工走 durable needs_manual_review 旗標(非僅 console.error) / claim 必 token guard(stale mark no-op) / cron route 必 GET / 不採信外部輸入(orderId 全 from DB)/ cron 端點無 secret 一律 401·env 未設拒 / 不存 last_error PII(固定 reason_code) / 不弱化 rec_trade_id UNIQUE·confirm 冪等樹 / 經銷價零外洩 / 卡資料零落地 / 金額整數零浮點 / 密鑰 server-only / 4a 不單獨 db push(隨 bundle)/ 4a 末補 role-hygiene assert / 不改已套用舊 migration(走新檔)/ 不用 git add .·-A / 不自動 push / 不 db push / 不動 .env*
— 禁止清單結束 —

---

## codex 關卡1 收斂(r1 FAIL → 全採納)

- **must-fix**:① `list_stuck_unsettled` 漏 charged-unpaid〔markCharged 成功但 confirm throw→attempt=charged/order 未 paid、只掃 pending 則 confirm 永不補〕→ 改掃 `status IN ('pending','charged') AND payment_status<>'paid'` + 收斂測(§5.1/§5.2);② claim lease 未釘 `FOR UPDATE SKIP LOCKED LIMIT`→ CTE 釘死、attempt_count 唯一在 claim 遞增(§5.1);③「RPC missing→200」偽裝成功→ `CRON_SWEEPER_ENABLED` gate:disabled=200 no-op、enabled+error=5xx(§5.3)。
- **consider**:① Q4 in-memory 不覆蓋跨路徑→明標 Phase I 降級 + Phase II hard gate 補 B(Q4);② attempt_count 雙加→ claim ++ / markRetry 只 backoff(§5.1);③ 4b 估偏大→拆 4b-1 adapter/4b-2 use-case + 4a 標超時 checkpoint(③ 表);④ migration 判定字面精準化 + service_role 直讀否決(§5.0)。
- 全收斂進 plan(r1 版);改版後再跑 codex 關卡1 複審。

## 三模型審查收斂(2026-06-15、Opus+Codex+Gemini、8 群全折入)

> 審查 log `docs/reviews/m3-3ds-review-log.md` §3。verdict=plan 未就緒、4a 前須改版(全非 Phase I live 危害〔零真流量〕、但多項改 4a schema/RPC)。
- **群1**🔴(3 模型共識、最重)stuck-attempt 無退避/上限/轉人工→每輪無界重打 Record:4a-2 加 `settle_attempt_count/next_settle_at/needs_manual_review` 欄 + `mark_attempt_settle_retry` RPC + list ceiling 濾(§5.1b/③)。
- **群2**🔴 `payment_status<>'paid'` 太寬(掃到 refunded/partiallyPaid 永不收斂)→ charged 分支收緊 `='unpaid'`、非 unpaid 非 paid→needs_manual_review(§5.1b)。
- **群3**🔴 漏傳 recTradeIdHint→違 master §1 rec 優先序:inbox claim 回 rec、settleCharge 帶 recTradeIdHint + 補測(§5.2)。
- **群4**🔴 claim lease 無 token guard + lease_interval 未定義:claim 回 attempt_count 當 token、mark 加 `p_claimed_count` guard + 回 affected、lease=5min 釘死 + 不變式、attempt_count 語意=claim 次數、退避用 (count-1)、告警看 reason 連續性非 count≥5(§5.1/§5.2)。
- **群5**🟠 部署 sequencing:4c 拆 4d(vercel.json 啟用獨立片)、CRON_SECRET 已存在非新設、4c 明寫 GET + requireCronSecret、4a 時戳最末 + role-hygiene 回歸 assert(③/§5.1b/§5.3/§5.4/鐵則8)。
- **群6**🟠 prod hard-gate + 轉人工 durable:needs_manual_review 旗標(durable、非 console.error-only)+ master §9 amend(Q4-B/告警接入/heartbeat/轉人工)+ backlog 掛號 + Q4-B 綁 flag-on(§5.1/§5.2/Q4 + master §9〔另檔 amend〕)。
- **群7**🟠 連線池/批次預算:順序/有界並發(p-limit 2-3)+ 預算算式 vs pooler ceiling(§5.2/Q3)。
- **群8**🟡 UX 防雙下單:Phase I callback processing 防呆文案(動 3DS-3、附帶 follow-up)+ Phase II 撈救通知(§5.5)。
- **O8** charged-unpaid 遇 explicit_failed→markFailed RAISE→settleCharge 吞 pending=刻意安全:4b-2 補測 + 註解勿改釋鎖(§5.2)。

### codex 關卡1 r2 複審改版收斂(2026-06-15、FAIL→全採納、依 2 輪上限不跑 r3)

改版引入 attempt-path schema 但未給對稱原子 claim → codex r2 逮 3 新 must-fix(皆已折入):
- **r2-#1** inbox claim 達 ceiling 後 crash→孤兒卡死 → 加 ceiling-expirer 前置(§5.1)。
- **r2-#2** attempt 路徑無原子 claim/lease(只 list+increment、卡 ceiling-1 每輪重打 Record)→ list 改 **claim_stuck_unsettled_attempts**(原子 FOR UPDATE SKIP LOCKED+lease+token、對稱 inbox)+ ceiling-expirer(§5.1b/§5.2)。
- **r2-#3** 「非 unpaid 標 manual」只是承諾、無 RPC 實作 → 加 **flag_non_unpaid_active_attempts** RPC(§5.1b/§5.2)。
- consider:O8 reason 不可辨識→distinct reason follow-up #231(§5.2);.env.local≠prod env→4d 前置改 Vercel Production env 驗證(§5.4/鐵則8);前置檢查 self-block→§2 允許 master/backlog amend。
- 🔴 codex 關卡1 達 2 輪上限(r1 原始 plan + r2 改版),**不跑 r3**;第二意見交審查 session 輕量複審 + raise Sean。

### codex 關卡2(審查側獨立、4a-1 commit 後)r1 收斂

- **執行側 K2(commit 前)**:PASS 0 must-fix(2 consider 收:expirer lease 條件 + bundle 註解列 0a)。
- **🔴 審查側獨立 K2 r1(amend f5b8015、Sean 拍 A)**:2 mark RPC(`mark_webhook_processed`/`mark_webhook_retry`)token guard 未排除 `needs_manual_review=true` → late worker(理論上 maxDuration<lease 已防、但 Vercel 預設 maxDuration 現 **300s = lease**=耦合脆弱)可在 expirer 轉 manual 後 mark → `processed=true + needs_manual_review=true` 矛盾態。**防禦修**:兩處 WHERE 加 `needs_manual_review=false`(把不變式收回 migration 本地、decouple 4c maxDuration);無副作用(正常 count=8 markRetry 此時 manual 仍 false)。🔴 **4a-2 `mark_attempt_settle_retry` 同步加**(§5.1b)。MCP 補測「manual row late mark→no-op」。

## 決策岔路(關卡1 後一次性批次問 Sean)

- **Q1 cron 頻率**:A=每 5 分(latency 低、Record 呼叫量中;Phase I 無流量→近 no-op)‖ B=每 15 分 ‖ C=每 1 分(latency 最低、Record 量高、受 Vercel plan 限)。**建議 A**(兼顧 latency 與額度;Vercel plan 若 Hobby 僅每日 → 退而求其次每日 + Phase II 開 prod 前升頻;須核 plan tier)。
- **Q2 stuck unsettled 門檻 + inbox 退避 + ceiling**(群4 校正):A=pending/charged 齡 >10 分才掃(避 racing 即時 callback/webhook;對齊 s2d user_in_flight 10 分閘)+ 退避 `(count-1)`→1/2/4/8/16 分(對齊 TapPay 重送)+ **ceiling=8**(達 8 → needs_manual_review、退熱迴圈;🔴 **非 5**=避 Phase II 銀行端慢確認單在第 5 輪誤判轉人工)+ 告警信號=**reason 連續性**(同 reason_code 反覆)非單純 count ‖ B=其他閾值。**建議 A**。
- **Q3 每輪批次量 / 函式 timeout**:A=每輪上限 inbox 50 + pending 50(Record 節流;超出留下輪)、route maxDuration 60s ‖ B=其他。**建議 A**(Phase I 無量、保守上限;Vercel 預設 timeout 充裕)。
- **Q4 recently-settled skip 存哪**(三模型:A 不覆蓋跨路徑/跨 run/Vercel 重送):A=**僅 in-memory 單 run 去重**(同 run inbox+stuck 撞同單只 settle 一次;跨 run 靠 inbox next_retry_at 退避 + settleCharge paid 短路)—— 🔴 **明標 Phase I 暫時降級**:**不**覆蓋 callback/webhook/sweeper 跨路徑同時到的 Record 放大 ‖ B=charge_attempts 加 `last_settle_attempt_at` 欄、**callback/webhook/sweeper 三路**settle 前查窗 skip(跨路徑/跨 run 持久;須**回頭改已上線的 3DS-2/3** 加查窗)。**建議 A + 🔴 Q4-B 綁 flag-on 前置鏈**(群6 收緊:降級論證**非**「零流量→零放大」、而是「單筆撞三路仍放大、但 Phase I 零真刷卡→撞三路機率≈0」;Q4-B **必在 `TAPPAY_3DS_ENABLED` flag-on 前 land**〔非僅 4a db push 前〕、入 master §9 prod 前置)。
- **Q5 cron 平台**:A=Vercel cron(架構定調、settleCharge TS+TapPay HTTP 必走)‖ (B=Supabase pg_cron 已排除:無法跑 TS/出站 HTTP)。**建議 A**(B 非可行、僅列證偽)。
