# 2026-06-21 M-3 3DS-S4 in-flight 鎖窗縮短(pending 3 分 / charged 保持 10 分)plan

> **⚠️ 已重定位/暫停(2026-06-21,勿照本 plan 動 code)** — 本 plan 經四方金流安全審查(`docs/reviews/2026-06-21-payment-flow-multiparty-audit.md`)判定為**治標**:縮時間鎖治不了 idempotency 休眠根因,且 codex S4 K1 已證縮窗引入新雙扣縫(3D 頁仍活著的 pending)。**Sean 拍 Q1=A:暫停 S4 縮窗,user_in_flight 維持現況 10 分鐘,改提前做治本 idempotency(= 3DS-7)。** 本 plan 保留作分析紀錄,治本方向見審查報告 §五/§六 + 3DS-7。
>
> **性質**:審查 session(寫審分離 ROLE=A)起草的 slice plan。鐵則 8(動 SQL migration)+ 鐵則 12(payment 鎖、雙扣)。
> **來源** = 設計包 `docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md` §5.2;親讀 `begin_charge_attempt` 後 framing 給 Sean、Sean 拍 **Q1=A(只縮 pending 窗、charged 保持)+ Q2=3 分鐘**。
> **～~待 codex K1 + Sean 批准才動 code。~~ → 已暫停(見上方 banner)。**

---

## 0. 一句話

`begin_charge_attempt` 的 per-user 閘現對 `pending` 與 `charged` 一律 10 分鐘窗。改成 **pending 縮 3 分鐘 / charged 保持 10 分鐘** —— 讓「刷一半放棄(pending)」的客人 3 分鐘後能重下單,「已扣款待確認(charged)」的雙扣防護視窗完整保留 10 分鐘。

---

## 1. 背景(親讀糾正設計包前提)

設計包 §5.2 假設「成立後鎖不釋放、客人被卡」。**親讀 `begin_charge_attempt`(migration 20260612150000 L202-213)糾正**:per-user 閘條件 = `status IN ('pending','charged')` **且** `payment_status <> 'paid'`,故:
- **成立(paid)→ 被 `<> 'paid'` 排除 → 根本不卡**;**失敗(failed)→ 不在 `('pending','charged')` → 根本不卡**。
- 真正卡 10 分鐘的**只有 stale pending**(客人 3DS 放棄/關頁、attempt 卡 pending、order 未 paid)。

Sean 拍 **Q1=A**(只縮 pending、charged 保持)**+ Q2=3 分鐘**。

---

## 2. 改動清單

### 2a. SQL migration(核心、新檔 `20260621140000_m3_3ds_s4_inflight_pending_window.sql`、CREATE OR REPLACE)
改 `begin_charge_attempt` per-user 閘的 status×時間窗條件(migration 20260612150000 L208-209):

```sql
-- 原:
   AND a.status IN ('pending', 'charged')
   AND a.created_at > pg_catalog.now() - interval '10 minutes'
-- 改:
   AND (
     (a.status = 'pending' AND a.created_at > pg_catalog.now() - interval '3 minutes')
     OR (a.status = 'charged' AND a.created_at > pg_catalog.now() - interval '10 minutes')
   )
```

**只動這段 predicate**;其他(異單 `order_id <> p_order_id`、`customer_user_id` 相等、`o.payment_status <> 'paid'`、advisory xact lock、per-order INSERT/ON CONFLICT、token 發放、回傳形狀)**逐字不動**。CREATE OR REPLACE only-diff、forward + rollback(回 10 分鐘 IN 版)。COMMENT 同步更新窗口語意。

### 2b. 文案(charge-actions.ts)
- **MSG.inFlight**(L64「您有一筆付款正在處理中,請稍候再試」)= user_in_flight 真正文案、**無寫死分鐘數 → 不動** ✅。
- **MSG.chargeFailedWait**(L61「…請約 **10 分鐘**後再試」)= charge_failed_wait(未扣款、鎖殘留稍候)。其 attempt 為 pending(未 charged)→ pending 窗縮 3 分後 per-user 閘放行下新單。**改:「約 10 分鐘」→「請稍候再試」**(去寫死數字 —— pending 3 分 / 同單 per-order 鎖無時間窗待 sweeper,寫任何單一數字都可能不準;對齊 inFlight 風格最誠實)。charge-actions.test.ts L249/L378 對應斷言同步更新。

---

## 3. 🔴 安全論證(雙扣防護、codex K1 重點審)

**核心問題**:pending ≠「沒扣款」—— 可能「已授權但系統未收斂」(callback 沒走完)。縮 pending 窗會否開「pending-已授權 → 同 user 異單雙扣」縫?

**論證 = 風險窄且自癒**:
1. **pending→charged 自動升級**:querystatus-fix 後,授權成功的單 **callback 首次即成立 → markCharged(status=charged)**,幾秒內從 pending 升 charged → **自動享 10 分鐘窗保護**。故「已授權」單極少久留 pending 3 分窗。
2. **停在 pending 3 分窗的 = 真未授權/放棄單**:放行下新單安全(原單未扣款)。
3. **殘餘窄縫**:callback **且** webhook **且** sweeper 全沒收斂的「pending-已授權」(需多重失效疊加、Phase I sweeper 本機未跑)→ 3 分後可下異單 → 理論雙扣。緩解 = 多重失效機率極低 + querystatus-fix 後成立即時 + sandbox 無真流量;Phase II 真刷再觀察(非阻擋、誠實揭示)。
4. **雙扣防線盤點(縮窗只影響第 5 層)**:per-order 鎖(同單)/ cart_session_id dedup(同 cart 異單)/ confirm 金額比對 / settleCharge Record 對帳 —— 皆獨立於 user_in_flight 窗、不受縮窗影響。user_in_flight 窗是「同 user 異單(不同 cart)」UX 節流 + 第 5 層;縮 pending 部分降低此特定場景防護、charged 部分(真扣款已知)完整保留。
5. **memory `feedback_adversarial-timeline-self-review-before-codex`**:殘餘窄縫不自宣接受 → §3.3 誠實揭示、Sean 拍縮窗時已知方向、codex K1 複核後若仍存疑再 raise Sean 終認。

---

## 4. 測試

### 4a. MCP 交易模擬(此 migration 未 db push、行為唯一證據;memory `reference_supabase-rls-schema-test-txn-simulation`)
BEGIN + 套 S4 CREATE OR REPLACE + synthetic attempts + ROLLBACK 零留痕:
- pending 2 分前 → 卡(user_in_flight);pending 4 分前 → 放行(3 分窗過)。
- charged 5 分前 → 卡;charged 11 分前 → 放行(10 分窗)。
- paid(order paid)→ 不卡(payment_status 排除);failed → 不卡(status 排除)。
- 同單 order_locked、null/不存在 order fail-closed 等既有回歸不退化。

### 4b. 單元(若 adapter/use-case 有窗語意斷言)
charge-actions.test.ts 文案斷言(L249/L378)同步;PgChargeAttemptAdapter / confirm-payment 若有 user_in_flight 測則對齊。

---

## 5. db push

migration 入 **S6 db push bundle**(與 S2b 20260621120000 等一起推);在那之前正式仍 10 分鐘 IN 版(正式結帳未開、不影響)。本機/驗證走 MCP 交易模擬。

---

## 6. 鐵則 / 風險 / rollback

- **鐵則 8**(SQL migration)+ **鐵則 12**(payment 鎖、雙扣)→ 本 plan + codex K1 + Sean 批 + 執行 session + codex K2 + sign-off + MCP 模擬。
- **風險**:§3 殘餘窄縫(pending-已授權多重失效雙扣)— 誠實揭示、機率極低、Phase II 觀察。
- **rollback**:forward CREATE OR REPLACE、rollback 回 10 分鐘 IN 版;無資料遷移、無新欄、無新 RPC、無 env。
- **不動**:begin 其他 predicate / markCharged / markFailed / settleCharge / 其他雙扣防線。

## 7. 驗收(yes/no)

1. 三綠(typecheck+lint+build+full vitest,含文案測試更新)。
2. MCP 交易模擬 pending 3 分 / charged 10 分 / paid 不卡 / failed 不卡 全 PASS + 零留痕。
3. begin_charge_attempt diff 僅 per-user 閘 predicate + COMMENT;其他 SQL 逐字不動(diff 證)。
4. 文案 chargeFailedWait 去寫死「10 分鐘」、inFlight 不動。

## 禁止清單(基線)

不改本 plan §2 明列範圍外檔 / 不動 begin 其他 predicate·markCharged·markFailed·settleCharge / 不弱化 charged 10 分窗(雙扣防護)/ 不變 env·deployment / 不用 git add .·-A / 不自動 push·merge / 不動 .env* / migration 不單推(入 S6 bundle)/ 不擴到 sweeper 頻率調整(STUCK_AGE_SECONDS=S6 範圍)

— 禁止清單結束 —
