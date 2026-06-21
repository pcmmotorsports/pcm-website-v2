# 2026-06-21 M-3 3DS-S2b:輪詢端點主動 settleCharge + durable per-order throttle(正式 slice plan)

> 真權威鏈:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > `CLAUDE.md` > 本 plan。
> 設計權威:設計包 `docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md` §5.1;S2 plan `docs/specs/2026-06-21-m3-3ds-s2-callback-polling-plan.md` §⑦ Q1=B;kickoff `docs/handoff/2026-06-21-s2b-kickoff.md`。
> 流程:本 plan → **codex 關卡1(read-only、零留痕)** → 自修 → **Sean 最終批准**(鐵則 8+12)→ 才動 code。
> Sean 已拍:**甲=做完整版** / **Q2=A(先不 db push、MCP 交易模擬驗)** / **Q3=A(throttle 10 秒)**。

---

## ① 任務目標(1-2 句)

輪詢端點 `GET /api/orders/[orderId]/payment-status` 在 own-only 歸屬閘**後**、訂單仍 pending 時,過 **durable per-order throttle 閘**後主動呼一次 `settleCharge`(= callback/webhook/sweeper 三路共呼模型的**第四路 caller**,**不改 settleCharge 內部一字**),達成設計包 §5.1「下單完幾秒無感自動成立」。throttle 防會員 spam(多分頁/狂重整)打爆 TapPay Record 查詢額度。

## ② 前置檢查(已驗)

- branch=`m3-3ds-s2` / 樹乾淨(本 plan + kickoff handoff untracked 屬正常)/ HEAD=`e7ff4eb`(=dev tip、S2 A 版)。✅
- worktree node_modules 就緒(S2 跑過三綠)。三綠 = worktree 根 `pnpm typecheck` / `pnpm lint` / `pnpm test`(vitest 從根、include `{packages,apps}/**`)。

## ③ 執行模式

mode B / conductor: main session / subagent_chain: `code-reviewer`(commit 前必跑)/ fix_attempt_max: 2 / `/slice-checkpoint`: 跑 / `/codex-review`: **觸發**(鐵則 8 跨層 ports+adapters + schema migration + 鐵則 12 payment 讀路徑 + **會員可觸發 settleCharge 入口** → codex 雙關卡必跑、重點審本片)。

## ④ Manifest Impact + Review 觸發

- 動到 storefront 元件:`apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts`(端點:pending 路徑加 throttle-gated settleCharge)。
- 新增跨層:`packages/ports/src/IPollSettleThrottle.ts`(新窄 port)+ `packages/adapters/src/payment/PgPollSettleThrottleAdapter.ts`(新 adapter)+ `apps/storefront/src/lib/payment/composition.ts`(新 `getPollSettleThrottle()` factory)。
- 新 migration:`supabase/migrations/20260621120000_m3_3ds_s2b_poll_settle_throttle.sql`(ALTER 加欄 + 新窄權 RPC + GRANT + assert)。
- 對應 design 源:design **無** 3DS 輪詢/異步結算態(submitOrder 為 setTimeout 假同步)→ S2b 全 net-new、權威=設計包 §5.1/§5.5。
- 業務 override:`design-storefront-manifest.yaml` `checkoutCallbackPolling` 欄 `storefront_value` 由「🔴 不呼 settleCharge 只讀狀態」改述「B:輪詢主動呼 settleCharge + durable throttle、不改 settleCharge 內部」;`decision_source`/`reason` 同步。CheckoutPage `component`/`last_modified_date` 追述 S2b。
- review_triggers:`slice_review` / `code_review` / `security_review_required` / `codex_review_required`。

---

## ⑤ 🔴 為什麼動 migration(鐵則 8 必交代「要改什麼、為什麼、影響面、rollback」)

### 5.1 kickoff 要求驗證的衝突 — 結論:重用 4a-2 sweeper 欄位**不安全**

kickoff §5 候選 = 重用 `payment_charge_attempts.next_settle_at` / `settle_attempt_count`(4a-2 sweeper 已用、durable)。逐條驗證後**確認衝突、不可重用**:

1. **`settle_attempt_count` = sweeper ceiling 計數器**(claim 唯一遞增點、滿 8 → `needs_manual_review` 轉人工)。輪詢端點若遞增它 → **會員狂重整可把自己 pending 單灌到 ceiling → 被 4a-2 `expire_stuck_attempts_at_ceiling` 誤標 needs_manual_review**(durable 假人工告警、真傷害,可達)。
2. **`next_settle_at` = sweeper lease/退避排程**(claim 設 +5min lease、mark 設 `2^(count-1)` 退避封頂 16min)。輪詢端點若拿來當「最近 N 秒結算過」throttle 寫入 → 踩亂 sweeper 的 lease/退避語意(兩者語意不同:throttle=「最近放行過、N 秒內別再打 Record」;sweeper=「下次該重試的時點」)。
3. **窄權角色硬限制**:`payment_confirmer` 對 `payment_charge_attempts` **零表/欄層 grant**(4a-2 §8 role-hygiene assert 強制 `role_table_grants=0` / `role_column_grants=0`),只能執行 owner-run 的 SECURITY DEFINER RPC。**現有 RPC 全綁死 sweeper 語意**(claim 必 +1、mark 需 token guard)→ 無一支可挪作 throttle。**即使「只想借 `next_settle_at`」也得新寫一支 RPC = 仍是 migration**。

➡️ **安全的 durable throttle 沒有「不動 migration」的路**(in-memory 在 serverless 多實例不可靠、kickoff §5 已排除)。最乾淨 = **新加一個獨立欄 + 一支獨立窄權 RPC**,與 sweeper 欄位**零語意重疊**、不互踩。

### 5.2 替代方案(已評估、不採)

- **重用 `next_settle_at`(借欄不借語意)**:仍需新 RPC(理由 5.1.3)且與 sweeper 共用同欄→未來維護混淆 + codex 語意審查負擔。**獨立欄完勝**(加法、零重疊、可讀)。
- **退回 Q1=A 只讀**(乙)= Sean 已否決(要「幾秒無感」)。

### 5.3 影響面 / Rollback

- 影響面:見 ⑦ 檔清單(~10 檔;純加法、forward-only;`settle-charge.ts` git diff 須空)。
- Rollback:migration forward-only(逆序手動段在檔尾:`DROP FUNCTION` + `ALTER ... DROP COLUMN`);程式 `git revert <commit>`(刪新 port/adapter/factory、還原端點 pending 路徑、還原 manifest 段)。**Q2=A:本 slice 不 db push**(正式結帳 flag 鎖、RPC 正式環境暫不用;正式暫無此 RPC 時端點 fail-closed〔見 §6.4〕退回 A 版行為、零安全風險)。db push 留 S6 開正式結帳時統一評估。
- 🔴 **誠實揭示(codex 關卡1 r1 consider #2)**:正式暫無此 RPC 時,**並非完全等同 A 版** —— 每次 unpaid poll 會多打一支「會失敗的 throttle DB RPC」(fail-closed skip、不打 Record、不偽 paid)。**評估後接受、不加 feature gate**:正式結帳受 flag 鎖死(`isThreeDSEnabled` 僅 sandbox/staging),正式環境**無真 3DS pending 單**(同步刷卡 status 75 必失敗、無 pending 3DS attempt)→ 此端點在 S6 開放結帳(=同時 db push)前**幾無真流量** → 理論噪音、非實際成本;加 flag 反增 scope+複雜度,不值。

---

## ⑥ 執行步驟

### 6.1 migration `20260621120000_m3_3ds_s2b_poll_settle_throttle.sql`

```sql
-- M-3 3DS-S2b:per-order poll-settle throttle — 防會員輪詢 spam 打爆 TapPay Record。
-- 鐵則 8(ALTER + 新 RPC + GRANT)+ 鐵則 12(payment 對帳路徑、窄權、零 PII、fail-closed)。
-- 🔴 獨立於 4a-2 sweeper 的 next_settle_at/settle_attempt_count(零語意重疊;理由見 plan §5.1)。

-- 1. throttle 欄(NULL=從未放行、立即可放行)
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN last_poll_settle_at timestamptz;

-- 2. claim_order_poll_settle:原子 throttle claim。
--    放行(窗內未放行過 + 閘全過)→ set last_poll_settle_at=now() 回 true(caller 可呼 settleCharge);
--    否則 → 回 false(caller skip settleCharge、只讀狀態回)。
--    🔴 並發安全(多分頁同時打):UPDATE 取 row lock 序列化;第二個 unblock 後 Postgres
--       對更新後 tuple 重評 WHERE(READ COMMITTED EvalPlanQual)→ last_poll_settle_at 已=now()
--       → throttle 條件 false → 0 rows → EXISTS false → 被 throttle。原子、不雙放行。
--    🔴 fail-closed:p_throttle_seconds<0 → 條件恆 false → 0 rows → false(不誤放行)。
--    🔴 閘**完全對齊** 4a-2 claim_stuck_unsettled_attempts(codex 關卡1 r1 must-fix #1/#2 + r2 consider 折入):
--       ① JOIN orders + o.payment_status='unpaid' —— 防 partiallyPaid/refunded active attempt 被輪詢
--          觸發 settleCharge 副作用(markCharged/markFailed)而干擾 4a-2 flag_non_unpaid_active 的「唯一回收路徑」;
--          且 paid 單由此閘 + 端點短路 + settleCharge step2 三重 backstop。
--       ② needs_manual_review=false —— 4a-2 把它當「停止自動 retry」durable 旗標(claim/mark 皆閘之);
--          否則會員可用輪詢繞過 ceiling/manual 轉出、成第四路 Record caller 無界打 Record。
--       ③ settle_attempt_count<8(ceiling)—— r2 consider:封掉「count 已達 ceiling、manual 尚未設」窄窗/orphan
--          (poll 仍每 10s 呼 settleCharge)。輪詢窗內 count 恆=0(sweeper 10min age-gate)→ 永不誤擋合法結算、純縱深。
CREATE OR REPLACE FUNCTION public.claim_order_poll_settle(
  p_order_id         uuid,
  p_throttle_seconds integer
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    UPDATE public.payment_charge_attempts a
       SET last_poll_settle_at = pg_catalog.now()
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.order_id = p_order_id
       AND a.status IN ('pending', 'charged')
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.needs_manual_review = false
       AND a.settle_attempt_count < 8
       AND p_throttle_seconds >= 0
       AND (a.last_poll_settle_at IS NULL
            OR a.last_poll_settle_at
               <= pg_catalog.now() - pg_catalog.make_interval(secs => p_throttle_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$fn$;

COMMENT ON FUNCTION public.claim_order_poll_settle(uuid, integer) IS
  'M-3 3DS-S2b:per-order poll-settle throttle。窗內未放行 + status IN(pending,charged) + order unpaid + 非 manual + settle_attempt_count<8 + p_throttle_seconds>=0 → set last_poll_settle_at=now() 回 true(caller 可呼 settleCharge);否則 false(skip)。原子(row lock + EvalPlanQual 重評)。閘完全對齊 4a-2 claim_stuck_unsettled_attempts(unpaid + 非 manual + ceiling)。Record 限流、不誤觸發非 unpaid 結算、不繞 sweeper ceiling。只 payment_confirmer 可呼。';

-- 3. 權限:全 REVOKE 再精準 GRANT payment_confirmer(對齊 4a-2)
REVOKE ALL ON FUNCTION public.claim_order_poll_settle(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_order_poll_settle(uuid, integer) TO payment_confirmer;

-- 4. fail-closed assert:EXECUTE 矩陣(payment_confirmer=true、其餘 false)
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.claim_order_poll_settle(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '3DS-S2b claim_order_poll_settle EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;

-- 5. role-hygiene 回歸 assert:payment_confirmer 全域表/欄層零權限(ALTER 加欄勿洩 grant;對齊 4a-2 §8)
DO $$
DECLARE v_tbl integer; v_col integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_tbl FROM information_schema.role_table_grants  WHERE grantee = 'payment_confirmer';
  SELECT pg_catalog.count(*) INTO v_col FROM information_schema.role_column_grants WHERE grantee = 'payment_confirmer';
  IF v_tbl <> 0 OR v_col <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破、ALTER 加欄洩 grant)— 拒繼續';
  END IF;
END
$$;

-- Rollback(Supabase forward-only、逆序手動):
--   DROP FUNCTION IF EXISTS public.claim_order_poll_settle(uuid, integer);
--   ALTER TABLE public.payment_charge_attempts DROP COLUMN IF EXISTS last_poll_settle_at;
```

### 6.2 新窄 port + adapter(最小爆炸半徑、不污染 IChargeAttemptStore)

- **為何獨立 port**:`IChargeAttemptStore` 有 2 impl(`PgChargeAttemptAdapter`/`ChargeAttemptStoreWithFallback`)+ `SupabaseChargeAttemptFallbackAdapter` + use-cases 多處 mock;加方法 = 全部被迫實作 + 改測。throttle 與 charge 簿記語意正交 → **獨立窄 port** 最小 surface。
- `packages/ports/src/IPollSettleThrottle.ts`:
  ```ts
  import type { OrderId } from '@pcm/domain';
  export interface IPollSettleThrottle {
    /** 原子 per-order throttle:窗內未放行→set+回 true(caller 可呼 settleCharge);否則 false(skip)。 */
    claimPollSettle(orderId: OrderId, throttleSeconds: number): Promise<boolean>;
  }
  ```
  `packages/ports/src/index.ts` 加 export。boundary 2(ports→只 domain)✅。
- `packages/adapters/src/payment/PgPollSettleThrottleAdapter.ts`:`implements IPollSettleThrottle`;`import 'server-only'`;reuse `buildPgConfig`(同 `PgChargeAttemptAdapter`、CA 縱深 + session pooler);per-request `new Client()` + `finally end()`;呼 `SELECT public.claim_order_poll_settle($1::uuid, $2::integer) AS result`;parse:非 boolean → throw 通用 parse error(零 pg 原文);`run<T>` 連線生命週期 + `sanitizeError` 對齊既有 adapter pattern。
- 🔴 **匯出只加在 `packages/adapters/src/server.ts`(server-only subpath)**(codex 關卡1 r1 consider #1;持 `PAYMENT_CONFIRMER_DB_URL` raw DB credential、敏感度 ≥ service_role、pg 不進 root barrel/client bundle;對齊既有 `PgChargeAttemptAdapter`/`PaymentConfirmerAdapter` 匯出處)。**不新增/不使用 `payment/index.ts` public barrel、不碰 root `index.ts`**。boundary 4(adapters→domain+ports,pg SDK 不擋)✅。

### 6.3 composition factory

`apps/storefront/src/lib/payment/composition.ts` 加:
```ts
export function getPollSettleThrottle(): IPollSettleThrottle {
  return new PgPollSettleThrottleAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'));
}
```
lazy(對齊既有 factory;sweeper N2 不變式「factory 必 lazy」)。同窄權鑰 `PAYMENT_CONFIRMER_DB_URL`、零新密鑰。

### 6.4 端點 `payment-status/route.ts`(pending 路徑加 throttle-gated settleCharge)

- 抽 own-only 讀為 helper `readOwnPaymentStatus(supabase, orderId, userId): PaymentStatus | null | 'error'`(回 **raw** `payment_status`〔'unpaid'|'paid'|'partiallyPaid'|'refunded'〕/ null=查無/非本人 / 'error'=DB 錯;DRY、呼兩次)。
- `const POLL_SETTLE_THROTTLE_SECONDS = 10;`(Sean Q3=A)。
- 🔴 **settle 閘 = raw `payment_status === 'unpaid'`(非 `!== 'paid'`;codex 關卡1 r1 must-fix #1 折入)**:只有 unpaid 單進 throttle+settle;partiallyPaid/refunded 不觸發 settle(對齊 RPC §6.1 的 unpaid 閘、不干擾 4a-2 回收路徑)。回應對外仍只折成 paid|pending(不洩 raw 態)。
- 流程:
  ```
  1. UUID gate(非 UUID → 400)                                    [同 A]
  2. createServerSupabaseClient throw → 500                        [同 A]
  3. getUser:throw/無 → 401                                       [同 A]
  4. s1 = readOwnPaymentStatus(...)  // 🔴 own-only 安全閘(嚴格)
     - 'error' → 500 / null → 404(偽造他人 orderId、不呼 throttle/settle)/ 'paid' → 回 {status:'paid'}
  5. s1 === 'unpaid' → throttle-gated settle(fail-closed,全包 try/catch、不 500 不偽;
       partiallyPaid/refunded 跳過 settle、直接走步驟6 折 pending):
       try {
         if (await getPollSettleThrottle().claimPollSettle(orderId, POLL_SETTLE_THROTTLE_SECONDS)) {
           await settleCharge(getSettleChargeDeps(), { orderId });  // cookieless 主軌、與 callback page L124 同呼法
         }
       } catch { /* throttle RPC throw / settleCharge throw → skip、fail-closed */ }
  6. s2 = readOwnPaymentStatus(...)  // 重讀反映 settle 後狀態(settle confirm 交易性、orders→paid 已 commit)
     const status = s2 === 'paid' ? 'paid' : 'pending';  // s2 'error'/null/非 paid → pending(fail-closed、客人續輪詢)
     return {status}
  ```
- 🔴 第一讀(步驟4)維持嚴格 404/401/500 own-only 安全閘;第二讀(步驟6)post-settle 純反映、'error'/notfound 一律 fail-closed→pending(不在 settle 後 500、客人續輪詢無害)。
- 🔴 `settleCharge` 回值(displayId/金額/outcome)**絕不入回應**;回應永遠只 `{status:'paid'|'pending'}`(零金額/零 displayId/零 PII)。狀態 100% 由重讀 `orders.payment_status` 反映。
- client `PollOrderStatus.tsx` **不改**(仍輪詢同端點、讀 `{status}`、paid→`router.refresh()`);callback `page.tsx` **不改**(B 只動端點)。
- 🔴 **字面 vs 事實(codex 關卡1 r2 nit)**:端點檔頭 L14 現寫「不呼叫 settleCharge」、L17-18/L22-23 述 S2 default A —— 實作時**必同步改檔頭註解**反映 B(輪詢 throttle-gated 呼 settleCharge);否則下輪審查字面 vs 事實誤判(鐵則 11)。

### 6.5 測試(§⑧ 細化)

- 端點:unpaid → 呼 settleCharge(spy 證);paid → 不呼(短路直接回 paid);**partiallyPaid/refunded → 不呼 settleCharge(只折 pending 回;codex r1 must-fix #1)**;**throttle 窗內第二次輪詢 → claimPollSettle 回 false → settleCharge 不被二次呼(spy 證)**;偽造他人 orderId → 404 且 throttle/settle 皆未呼;settleCharge throw → `{status:'pending'}`(不 500 不偽 paid);throttle RPC throw → fail-closed skip → 仍只讀狀態回 {status};回應只 `{status}`(零金額/零 PII 斷言);settle 後重讀 paid → 回 paid。
- migration RPC 閘(MCP 模擬、§6.6):**`needs_manual_review=true` → claim 回 false(不放行;codex r1 must-fix #2)**;**order 非 unpaid(paid/partiallyPaid/refunded)→ claim 回 false**;**`settle_attempt_count>=8`(ceiling)→ claim 回 false(codex r2 consider)**。
- `PgPollSettleThrottleAdapter`:RPC 回 true/false 正確映;非 boolean → throw parse error;連線層 throw → sanitizeError 通用(零 pg 原文)。
- 動共用 adapter/port → 跑**完整 `pnpm test`**(非子集;memory `run-full-vitest-after-shared-component-change`)。

### 6.6 MCP 交易模擬驗 `claim_order_poll_settle`(Q2=A、零 db push、零留痕)

本機無本地 Supabase 棧 → 用 MCP `execute_sql` 交易內驗(對齊 4a-2):`BEGIN` + S2b DDL(ALTER + RPC + grant)+ synthetic orders/attempts + `DO` 斷言:
- 首呼回 true + `last_poll_settle_at` set;**窗內第二呼回 false**(throttle 生效);窗外(模擬 `last_poll_settle_at` 退到 now()-11s)再呼回 true。
- 並發語意:同 attempt 兩語句序列化、只一個 true(以「先 set 後第二語句重評 WHERE→false」等價論證 + 單連線序列重現)。
- `p_throttle_seconds=-1` → false(fail-closed);無 active attempt(status=failed/查無)→ false。
- `has_function_privilege` 矩陣唯 payment_confirmer;`role_table_grants`/`role_column_grants`(payment_confirmer 全域)=0。
- 跑後 `information_schema` 驗零留痕 + `ROLLBACK`;只查 count/欄名/布林、不取金額。
- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer literal 實呼於 pooled MCP 必斷線(memory `pooled-mcp-set-role-secdef-terminates`)→ 等價證據 = has_function_privilege 矩陣 + owner-run + search_path='' caller 一致 + 全域 grants=0;真連線 round-trip 留正式 db push 後(S6)。

---

## ⑦ 影響面(檔清單)

| 動作 | 檔 |
|---|---|
| 新 | `supabase/migrations/20260621120000_m3_3ds_s2b_poll_settle_throttle.sql` |
| 新 | `packages/ports/src/IPollSettleThrottle.ts` |
| 改 | `packages/ports/src/index.ts`(export 新 port) |
| 新 | `packages/adapters/src/payment/PgPollSettleThrottleAdapter.ts` |
| 改 | `packages/adapters/src/server.ts`(server-only subpath export 新 adapter;**不碰 root barrel**) |
| 改 | `apps/storefront/src/lib/payment/composition.ts`(`getPollSettleThrottle()`) |
| 改 | `apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts`(pending 路徑) |
| 新/改 | `payment-status/route.test.ts`(throttle/settle 測)+ `PgPollSettleThrottleAdapter.test.ts` |
| 改 | `docs/design-storefront-manifest.yaml`(checkoutCallbackPolling override + CheckoutPage 追述) |
| 改 | `STATUS.md`(7 欄、同 commit) |
| 新 | 本 plan |

`settle-charge.ts` / `PollOrderStatus.tsx` / `callback/page.tsx` **不動**(紅線)。端點 ~95→~140 行(<400、鐵則 6 OK)。

## ⑧ 對抗時序自審(送 codex 前;memory `adversarial-timeline-self-review-before-codex`)

| 中間態 × 並發 | 行為 | 安全? |
|---|---|---|
| 多分頁同時打同單 pending | row lock 序列化、只一個 claimPollSettle=true → 只一次 settle/Record | ✅ 不雙放行 |
| 會員 100 分頁狂輪詢 | per-order durable throttle:每單每窗(10s)最多放行 1 次 → 輪詢窗 51s 最多 ~5 次 Record,**與分頁/請求數無關** | ✅ spam 擋死 |
| 偽造他人 orderId | 第一讀 own-only(RLS + `.eq customer_user_id`)→ 404 早返,throttle/settle 皆未呼 | ✅ IDOR 守 |
| settleCharge throw(連線/Record) | 端點 try/catch 吞 → fail-closed skip → 重讀回 pending(不 500、不偽) | ✅ |
| throttle RPC throw(正式無此 RPC) | 端點 try/catch 吞 → skip settle → 只讀狀態回 = 退回 A 版行為 | ✅ Q2=A 不 db push 安全 |
| settle 放行後並發 webhook 也 settle | settleCharge 冪等(Record 權威 + markCharged/confirm 冪等)→ 不雙扣 | ✅ |
| 重讀(步驟6)時 db error | fail-closed → pending(客人續輪詢) | ✅ |
| order 已 paid(端點短路前) | 端點第一讀 `=== 'paid'` 直接回 paid + RPC unpaid 閘 + settleCharge step2 三重 backstop(不打 Record) | ✅ |
| partiallyPaid/refunded active attempt(Phase 1 不可達) | 端點 settle 閘 raw `=== 'unpaid'` → 不呼;RPC unpaid 閘 → 不放行 → **不觸發 settleCharge 副作用**(不干擾 4a-2 flag_non_unpaid_active 回收路徑;codex r1 must-fix #1) | ✅ |
| attempt 已 needs_manual_review(ceiling/anomaly 後) | RPC `needs_manual_review=false` 閘 → 不放行 → 會員不可用輪詢繞過 manual 當第四路 Record caller(codex r1 must-fix #2) | ✅ |

**殘餘風險**:無自宣接受項;throttle 窗 10s 的「Record 額度 vs 成立即時性」權衡 = Sean Q3=A 拍板,非殘餘風險。

## ⑨ 驗收條件(yes/no)

- [ ] own-only 閘在 settleCharge 呼叫前;偽造他人單 → 404 且不呼 throttle/settle;未登入 → 401;非 UUID → 400。
- [ ] durable per-order throttle 真防 Record 放大(測證、非 in-memory);窗內 skip settleCharge、只讀 status。
- [ ] 回應仍只 `{status}`、零金額/零 PII;fail-closed 不偽 paid/不偽 failed(settleCharge/throttle throw → pending、不 500)。
- [ ] `settle-charge.ts` 內部零變更(git diff 空)。
- [ ] migration EXECUTE 矩陣 + role-hygiene assert 過;MCP 交易模擬驗 throttle 行為 + 零留痕。
- [ ] 三綠(typecheck+lint+build)+ 完整 `pnpm test` 綠(含新測)。
- [ ] manifest `checkoutCallbackPolling` override 更述 B + throttle;`design-mirror --validate` PASS;STATUS 7 欄同步。
- [ ] code-reviewer PASS + codex 雙關卡 PASS。
- [ ] Q2=A:不 db push;rollback 段在 migration 檔尾。

---

## ⑩ 給 codex 關卡1 的脈絡(codex 無 repo、自帶摘錄)

**PCM 鐵則摘錄(相關項)**:
- 鐵則 8:跨 3+ 檔 / 動 schema·API·共用元件 / 動 Prisma·Medusa·migration → 先 plan 等批(本 plan 即是)。
- 鐵則 12:動 security/RLS/GRANT/migration/payment/order → 產 review packet + codex 雙關卡。
- Server 端鐵則:會員等級/金額 server 重查、不信 client;經銷價絕不傳一般會員瀏覽器;金額用整數/Decimal、禁 number 處理價格;敏感資訊 `.env.local` only。

**eslint boundaries(7 條、`eslint.config.js`;memory `codex-k1-feed-boundaries-config`)**:
1. domain→不可 import 其他 element;2. ports→只可 domain;3. use-cases→只可 domain+ports;4. adapters→只可 domain+ports(外部 SDK 不擋);6. ui→不可 import 其他;7. schemas→不可 import 其他。
→ 本片新檔:`IPollSettleThrottle`(ports→domain `OrderId`)✅;`PgPollSettleThrottleAdapter`(adapters→ports+domain+pg SDK)✅;composition/route 在 storefront app(非 boundaries element)✅。**無 layer 違規**。

**既有不變式(本片須守不破)**:
- `settle-charge.ts` 對帳脊椎零變更(classifyRecordStatus 0/1→paid_candidate、recordMatchesOrder 識別/金額/弱識別窗、缺陷 A/C)。
- `payment_confirmer` 窄權:零表/欄 grant、只 owner-run SECURITY DEFINER RPC + search_path=''(新 RPC 守同 pattern + 同 assert)。
- composition factory lazy(N2 sweeper 不變式)。
- 端點 fail-closed + null body 錯誤碼 + no-store(S2 既有)。

**codex 關卡1 r1 findings 處置(本 r2 plan 已折入)**:
- [must-fix #1] throttle RPC 加 `orders` join + `payment_status='unpaid'` 閘 + 端點 settle 閘改 raw `=== 'unpaid'`(§6.1/§6.4)→ 已修。
- [must-fix #2] throttle RPC 加 `needs_manual_review=false` 閘(§6.1)→ 已修。
- [consider #1] adapter 匯出只加 `packages/adapters/src/server.ts`、不碰 public barrel(§6.2/⑦)→ 已修。
- [consider #2] 正式無 RPC 的 DB 噪音 → 文件化接受、不加 flag(§5.3)→ 已述。

**codex 關卡1 r2 = PASS-with-comments(無新 must-fix);comments 已折入**:
- [consider] RPC 加 `settle_attempt_count < 8` ceiling 閘 → 已加(§6.1,四閘完全對齊 4a-2 claim)。
- [nit] 端點檔頭「不呼叫 settleCharge」註解實作時同步改 → 已記入 §6.4。

→ codex 雙輪硬上限達標(r1 FAIL → 折入 → r2 PASS-with-comments → comments 折入)。待 Sean 最終批准後實作。

---

## 禁止清單(基線)

不改 settleCharge 成立邏輯(`settle-charge.ts` 零變更)/ 不改 scope 外檔 / 不動 env·deployment·vercel.json / 端點回應不含任何金額/價格/經銷欄 / **本 slice 不 db push(Q2=A)** / 不用 `git add .` · `-A`(精準 add)/ 不自動 push / 不 merge dev / 不動 `.env*` / 不開 prod checkout flag / 不繞 design-mirror。
— 禁止清單結束 —
