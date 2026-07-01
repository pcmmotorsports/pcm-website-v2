# #252 驗證報告 — 3DS flag 緊急關閉中間態 begin-dedup 兜底(開 prod flag 前 gate)

> 一句話結論:**begin_charge_attempt 的「cart-dedup + user_in_flight」雙層兜底,對 #252 主場景(pending in-flight 3DS 兄弟單、客人立即重付)守得住(實證 needs_settle/duplicate/user_in_flight,零雙扣)。但二度確認(adversarial-reviewer + codex 跨模型)擊破了本報告初稿的「殘餘缺口皆下游覆蓋」樂觀敘述,修正如下:GAP1(released 兄弟單)在 rollback 場景可達、但其雙扣會被 #250 anomaly 偵測+W1 可退;🔴 GAP2(純 pending 兄弟單、異 cart、>10 分鐘)是「靜默雙扣偵測盲區」——late-success 走 `pending→charged` 不觸發 anomaly genesis,#250/W1 看不見。故本 gate 判定 = PASS-WITH-CAVEAT,GAP2 盲區需 Sean 決策處置(見 §6)。**
>
> 驗證方式:唯讀 MCP 確認 live 定義 + DDL MCP `BEGIN..ROLLBACK` 六場景零留痕合成模擬(全場景 `RAISE EXCEPTION` 強制回滾、殘留檢查 3/3 = 0)。**全程 flag=false、prod 未部署、零寫入**。二度確認見 §7。
>
> 對應:backlog #252 / canonical `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §2.3 / §14 步44-45 / `begin_charge_attempt`(live = 0c 版 `20260613140000`)/ `adjudicateSettlement`(`charge-actions.ts`)/ anomaly genesis(`20260624120005`)/ #250 summary(`20260701120000`)。dev HEAD=`fe7cbed`。

---

## 1. 背景與待驗問題(backlog #252)

- **場景**:未來 prod 真開 3DS(`TAPPAY_3DS_ENABLED=true`)後,若有客人卡在 pending 3DS 兄弟單時被**緊急關閉 flag**(§14 步45 rollback 第一動作),客人走**同步路徑**重付 → **跳過 preflight**(preflight 只在 flag on 跑,Q1=A 2026-06-25 拍)。
- **兜底靠誰**:此中間態不靠 preflight,而靠舊版 `begin_charge_attempt` 的 **cart-instance dedup**(同 `cart_session_id` 的 pending/charged 兄弟單 → `duplicate`/`needs_settle` → `adjudicateSettlement`)。
- **待證**:① 兜底在 proceed 路徑下是否正確回 `duplicate`/`needs_settle`(**非** `acquired:true` 新刷)② 殘餘缺口範圍與下游是否真覆蓋。

---

## 2. 驗證方式(全唯讀 / 零留痕)

| 步驟 | 手段 | 結果 |
|---|---|---|
| A. live 定義對齊 | `pg_get_functiondef('public.begin_charge_attempt(uuid)')` | md5=`55e32431…`、len=5175;`active-only JOIN`=true、`mentions_released`=**false**、`uses_cart_session`=true(對齊 repo 0c 版 `20260613140000`) |
| B. 現況曝險量化 | 唯讀聚合 | attempts:failed=15/pending=2/charged=10/released=10;**同user+同cart+active 兄弟群=1 組**;**released 兄弟群=2 組** |
| C. 六場景合成模擬 | DDL MCP `DO $$ … $$`、每場景 sub-block(savepoint)隔離 + `RAISE EXCEPTION` 回滾、末 RAISE 全回滾 | 見 §3 |
| D. 殘留檢查 | 唯讀 count(SIM 標記 `PCM-2999-90%` / `REC2..4` / by-uid) | **0 / 0 / 0**(零留痕) |

- 合成資料:引用 1 個真實 `customers.user_id` 滿足 FK,其餘 orders/attempts 全合成(高年份 `PCM-2999-*` display_id 避碰),經 `RAISE EXCEPTION` 強制回滾;`begin_charge_attempt` 為 SECURITY DEFINER,以 owner 連線直呼(不 `SET ROLE`,避 pooled MCP SECDEF 斷線),ACL 另以 `has_function_privilege` 唯讀核。
- 誠實限制:模擬以合成 in-transaction 資料證明**函式控制流**,未做雙實體並發 claim(begin 的 dedup 讀無 row lock、per-user advisory xact lock 序列化,並發窗屬既有 0b/0c 分析)。

---

## 3. 六場景實證矩陣(begin_charge_attempt 回覆)

| # | 兄弟單態 | cart | attempt 齡 | `reason` | `acquired` | 判定 |
|---|---|---|---|---|---|---|
| S1 | pending | 同 | 新 | `needs_settle` | **false** | ✅ 兜底攔截 → `adjudicateSettlement` → `settleCharge`(Record 權威)|
| S2 | charged | 同 | 新 | `needs_settle` | **false** | ✅ 兜底攔截(charged 最強扣款證據)|
| S3 | paid | 同 | — | `duplicate`(`existing_paid=true`)| **false** | ✅ paid-equivalent 終態、顯既有單、零新刷 |
| S4 | **released** | 同 | 新 | ∅ | **true** | 🔴 **GAP1**:dedup JOIN 限 pending/charged、user_in_flight 亦限 pending/charged → released 雙漏 → 取新鎖 |
| S5 | pending | **異** | 新(<10min)| `user_in_flight` | **false** | ✅ **user_in_flight 安全網(cart-agnostic、10 分鐘窗)攔截**(backlog 原描述未點出此層)|
| S6 | pending | **異** | 舊(>10min)| ∅ | **true** | 🔴 **GAP2**:user_in_flight 窗過期 + dedup 異 cart 漏 → 取新鎖 |

> S1–S3 對應 `adjudicateSettlement`:`duplicate`→既有 paid 單 paid-equivalent(零扣款);`needs_settle`→鎖外 `settleCharge`(Record API 權威 + `markCharged`/confirm `FOR UPDATE` + paid 短路 → 零雙扣/零雙 settle)。故 S1/S2/S3 **無雙扣路徑**(二度確認 HOLDS)。

---

## 4. 結論(已折入二度確認修正)

### 4.1 #252 主場景守得住(雙層兜底)— HOLDS

緊急關 flag 當下、客人**立即**重付的 in-flight 3DS 兄弟單一律是 **pending**(3DS 進行中)或 charged:

- **同 cart_session**(未換裝置/未清 cookie)→ `needs_settle`/`duplicate`(S1/S2/S3)→ 零雙扣。
- **異 cart_session 但立即重付(<10 分鐘)**→ **user_in_flight 安全網**(S5)攔截。此層 **不以 cart_session 過濾**(begin `20260613140000` user_in_flight 閘 156-168、`IF EXISTS` 開 158 / `RETURN` 168、predicate 無 `cart_session_id` 條件、二度確認雙方 HOLDS)、純看「同 user + 10 分鐘內 + active + 該單未 paid」→ 補住 dedup 的 cart 依賴缺口。**這是 backlog #252 原始描述漏列的一層兜底**。

### 4.2 兩個殘餘缺口(修正:一個可退、一個是盲區)

| 缺口 | 觸發條件 | #252 rollback 場景可達性 | 雙扣是否被偵測+可退 |
|---|---|---|---|
| **GAP1 released 兄弟單** | 有 released 兄弟單(begin 全函式零提及 released)| **可達**(codex 擊破初稿「不可達」:flag-on preflight release CAS 已產生的 released row,rollback 後仍存活觸發 S4;flag-off 期間不再新產生)| ✅ **可退**:released 兄弟單 late-success 走 `released→charged` → anomaly genesis(`20260624120005:118/128`)寫主表 → #250 `open` 偵測 + W1 退款 |
| **🔴 GAP2 純 pending 兄弟單、異 cart、>10 分鐘** | 換裝置/清 cookie 致 cart_session 不同,且兄弟 pending attempt 已逾 10 分鐘 user_in_flight 窗 | **可達**(需客人隔 >10 分鐘、換裝置、且原 3DS 稍後 late-success)| ❌ **偵測盲區(靜默雙扣)**:純 pending 兄弟 late-success 走 `pending→charged`(**非** released→charged)→ **不觸發 genesis** → 零 anomaly row → #250 `open` 恆不 fire、W1 恆不列 → 無告警、無退款工單 |

> 🔴 **核心修正**:初稿宣稱「GAP1/GAP2 皆下游 anomaly+W1 覆蓋」。二度確認 triage 證實:**全 repo `payment_double_charge_anomalies` 主表唯一 INSERT 在 genesis、硬 gate `status='released'`**(其餘 INSERT 皆 events 生命週期表)。故只有「曾為 released 的兄弟單 late-success」才被偵測。GAP2 的兄弟從未 released(release CAS 只在 flag-on preflight 跑),其 late-success 靜默完成 → **雙扣不可見**。這是本報告因二度確認而發現的**真實盲區**(同時修正 backlog #252 原「GAP2 由 anomaly/W1 下游偵測」的過度樂觀假設)。
>
> 補強(round2 NIT 折入):pending→charged late-success **不論走主軌 `mark_charge_attempt_charged` 或備軌 `mark_charge_attempt_charged_fallback`(`20260612150000`)皆無 genesis**(備軌護欄③ `WHERE status='pending'` 亦不接受 released)→ 兩軌皆不偵測 GAP2,更坐實盲區。round2 亦驗證 #250 六計數(open/refunding/refunding_stuck/oldest_open_age/attempt_manual_review/released_stuck)**無一**能間接抓 GAP2 純 pending 雙扣態(late-success 後 order=paid → attempt_manual_review 的 unpaid gate 亦掉出)。

### 4.3 建議

- **不採 Q1=C**(同步路徑額外輕量 lookup):二度確認雙方 HOLDS —— 現有 own-only lookup 仍綁 `cart_session_id` 且 active 只含 pending/charged,對 GAP1(released 非 active)/GAP2(異 cart + >10min 已非 active-in-window)皆無效;對 S1/S2/S3/S5 又冗餘 → 投報比低。
- **GAP1**:接受(可達但可退)。現況 begin/adjudicateSettlement 不需改。
- **🔴 GAP2 盲區需 Sean 決策(§6 決策 fork)**。可選:① rollback runbook 升「關 flag 前先跑 settle-sweep 收斂 in-flight pending→終態」為**硬前置**(壓縮盲窗、但非零窗:sweep 與 late-settle 間仍有殘窗)② 補「pending-based 雙扣偵測」進 #250/#255(同 user 短窗多筆 paid 掃描)= 唯一能關盲區的治本 ③ informed-accept 盲區並落檔。
- **gate 判定**:**PASS-WITH-CAVEAT** —— begin/adjudicateSettlement 行為正確(無程式 bug),但 GAP2 盲區使「所有殘餘雙扣皆可偵測+可退」不成立、需 Sean 明確處置後才可視為 #252 關閉。

---

## 5. 誠實邊界

- 本 gate 為 **flag=false 期間不可達**(prod 未開 3DS);驗證的是「未來開 flag 後緊急關閉」的兜底正確性,非當前在線行為。
- GAP1 = 偵測+退款覆蓋(**非零雙扣保證**、增退款工單);GAP2 = **偵測盲區**(靜默雙扣、無工單)——兩者性質不同,不可混為一談(初稿之誤)。
- user_in_flight 的 10 分鐘窗是既有設計參數(0c `interval '10 minutes'`),非本次調整;S6 證明其邊界外行為。
- 模擬未涵蓋雙實體並發 claim(理由 §2);begin dedup 讀無 row lock 的並發窗屬 0b/0c 既有分析範圍。

---

## 6. 後續動作 / Sean 決策 fork

**🔴 決策(GAP2 盲區處置)** — 見 §7 給 Sean 的白話 fork。落定後:
- ☐ 若採縱深 runbook(選項①)→ 於 canonical §14 步45 或 `docs/runbooks/` 補「關 flag 前先跑 settle-sweep」硬前置條目。
- ☐ 若採治本偵測(選項②)→ 開/併 backlog(#255 去重表可順帶掛「同 user 短窗多筆 paid」盲區偵測)。
- ☐ 若 informed-accept(選項③)→ backlog #252 明列 GAP2 盲區 + Sean accept 落檔。
- ☐ backlog #252 標記「已驗證 PASS-WITH-CAVEAT + GAP2 盲區(初稿覆蓋假設經二度確認修正)+ Q1=C 不採」。

---

## 7. 二度確認(adversarial-reviewer + codex 跨模型)

> Sean 指定「gemini or codex 與 skill 二度確認」。本 gate 為金流片(鐵則 12),跑兩獨立審查器 refute-first 審驗證結論,findings 全經 Claude triage(親驗程式、非盲收)。

**A. adversarial-reviewer(Claude subagent、PCM overlay)** — 裁決 FAIL:
- **F1 [HIGH/must-fix]**:GAP2「下游 anomaly+W1 覆蓋」為假 → 純 pending 雙扣對 #250/W1 隱形(genesis 只認 released→charged)。→ 已折入 §4.2/§4.3/§5。
- F2 [MEDIUM]:GAP1 列的 `released_stuck` 是「死卡偵測」非「雙扣偵測」;真偵測靠 `open`(genesis)。→ 已修 §4.2 為 `open`。
- F3 [NIT]:懸空 §7 引用 + 信號語意混用。→ 已修(§7 現存在)。
- HOLDS:點1 user_in_flight cart-agnostic、點2 S1/S2/S3 零雙扣、點3 GAP1 flag-off 不新產生 released。

**B. codex(OpenAI gpt-5.5、cross-model、`-s read-only`、零留痕)** — 裁決 FAIL:
- **BROKEN 點3 [must-fix]**:GAP1「producer-gated 不可達」過強 → flag-on 已產生的 released row 在 rollback 後存活觸發 S4;應改「flag-off 不新產生、但既有 released row 仍可觸發、決策=接受 #250/W1 偵測退款」。→ 已折入 §4.2 GAP1(可達但可退)。
- BROKEN 點6 [NIT]:懸空 §7 引用。→ 已修。
- HOLDS:點1(user_in_flight 無 cart 過濾)、點2(settleCharge 非請款、FOR UPDATE 序列化)、點4(無漏場景)、點5(Q1=C 救不了 GAP1/GAP2)。

**Claude triage(親驗)**:`grep INSERT INTO public.payment_double_charge_anomalies` 全 repo = 唯一 `20260624120005:128`、gate `IF v_row.status='released'`(:118);其餘 5 處 INSERT 皆 `..._anomaly_events`(生命週期)。**F1 成立**。GAP1 可達性(codex)成立。兩審查者收斂 → 初稿 over-claim 已降級為誠實盲區敘述。

---

*驗證者:Claude Code(dev session、2026-07-01)。方法=唯讀 MCP + DDL MCP 零留痕模擬(殘留 0/0/0)+ adversarial-reviewer + codex 跨模型二度確認(皆 FAIL→findings 全折入本定稿)。gate=PASS-WITH-CAVEAT,GAP2 盲區待 Sean 決策。*
