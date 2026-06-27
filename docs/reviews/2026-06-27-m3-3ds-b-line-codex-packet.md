# Codex Review Packet — M-3 3DS 乙路 B 線(12h 孤兒收尾 B1a + B1b)

> **狀態:** codex K2 月牆(~2026-07-25 重置)期間以 adversarial-reviewer + code-reviewer 當審查關卡;本 Packet 供月牆解除後 codex **跨模型補審**。自帶規則摘錄 + code 摘錄,codex 無需 repo。
> **§14 步34-36 整體最終 Packet。** B1a `8197fca` + B1b `4866817`(worktree `m3-3ds-yi-r1`、未 push、未 db push、`TAPPAY_3DS_ENABLED` 全程 false)。
> **真權威:** `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §8 / §9 B1a·B1b / §14 步30·33(canonical round11 PASS)。

---

## 0. PCM 規則摘錄(codex 審查依據)

- **鐵則 8**:動 schema/API/共用元件先有 plan;B1a/B1b 由 canonical(round11 PASS)滿足、無需新 plan。
- **鐵則 12**:動 migration/payment/雙扣/GRANT/RLS → K2 + Packet。本片命中(B1a migration+GRANT、B1b 對帳路徑)。
- **SECDEF 硬化(round8 一):** 所有 SECURITY DEFINER RPC 一律 `SET search_path='' + 全識別子 schema-qualified`;EXECUTE 矩陣同時驗 `has_function_privilege` 與負向角色。
- **Server 端鐵則:** 會員/金額驗證在 server;金額用整數;敏感資訊不入 client;經銷價不外洩(本片不涉價格)。
- **payment_confirmer** = server-only 窄權 DB 角色,零 table/column 直接權限,只透過 SECDEF RPC 寫。
- **字面 vs 事實:** commit/註解不得誇大;未實測/未 live 須誠實標記。

---

## 1. B 線是什麼(背景)

客人放棄付款、沒重刷 → 留 `status='pending'` 未付款孤兒單。現行 sweeper(3DS-4a-2 `claim_stuck_unsettled_attempts`)重試 8 次後把孤兒轉 `needs_manual_review=true`,**退出一般掃描**(claim_stuck 濾 `needs_manual_review=false`)。若無 B1 → 孤兒永遠卡 manual queue 無人再確認。

**B1 = 專用人工列再確認路徑:** 受 `age≥12h + order unpaid + 獨立 throttle` 限制、**可涵蓋 manual=true、繞 sweeper ceiling**,定期低頻再確認;但 **不清 `needs_manual_review`**。拆 **B1a(claim/throttle migration + RPC)+ B1b(adapter/use-case/tests)**。

---

## 2. B1a — `claim_expired_pending_attempts` migration(`20260627120000`)

新增 1 欄 `last_expired_settle_at timestamptz`(B1 專屬 durable throttle、與 sweeper `next_settle_at` 分軌、nullable 不回填不長鎖)+ 1 SECDEF RPC:

```sql
CREATE OR REPLACE FUNCTION public.claim_expired_pending_attempts(p_limit integer)
RETURNS TABLE(attempt_id uuid, order_id uuid, needs_manual_review boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $body$
  WITH claimed AS (
    SELECT a.id FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.status='pending'                                  -- 隱含排除 released/charged/failed
       AND o.payment_status='unpaid'::public.payment_status    -- order 已 paid 不處理
       AND a.created_at < pg_catalog.now() - interval '12 hours'
       AND (a.last_expired_settle_at IS NULL
            OR a.last_expired_settle_at < pg_catalog.now() - interval '6 hours')
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED                               -- 只鎖 a(對齊 4a-2 精化C、不鎖 join orders)
     LIMIT LEAST(GREATEST(p_limit,1),1000)                     -- p_limit 安全上下界
  )
  UPDATE public.payment_charge_attempts a SET last_expired_settle_at = pg_catalog.now()
    FROM claimed WHERE a.id = claimed.id
  RETURNING a.id, a.order_id, a.needs_manual_review;
$body$;
-- ACL: REVOKE ALL FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE TO payment_confirmer;
-- + has_function_privilege 矩陣 assert(唯 payment_confirmer)+ role_table/column_grants(payment_confirmer)=0 assert
```

**與 sweeper 的關鍵差異(canonical §8、codex 請重點核):** ① 不濾 `needs_manual_review`(manual=T/F 都進) ② 不濾 `settle_attempt_count`(繞 ceiling) ③ throttle 用 `last_expired_settle_at`(非 next_settle_at) ④ 只蓋 throttle 戳、不清 manual/不動 count/next_settle_at。

**throttle 6h = 本片設計判斷**(canonical 僅定性「durable throttle 防熱迴圈」未硬指定數值);forward-only 可調、已揭示。

**DDL MCP 模擬(BEGIN…ROLLBACK、零留痕):** claim 層 9 案 PASS(eligible{pending+unpaid+age≥12h+throttle到期、manual=T/F}全 claim;ineligible{order paid/age<12h/released/charged/failed/throttle未到}全否決)+ ACL 矩陣 + role-hygiene grants=0 + throttle 擋 re-claim + 結構(SKIP LOCKED/FOR UPDATE OF a/LEAST·GREATEST·1000)+ 對 prod 真孤兒免疫的作用域斷言;零留痕後驗 column/function/synthetic/pc 表權限皆 0。

**誠實揭示(codex 請評充分性):**
- F1:**「真雙連線平行 claim」未以兩條真連線實測**(pooled MCP 單連線限制)→ 靠 `FOR UPDATE OF a SKIP LOCKED` 結構 + 與 round11-PASS 的 4a-2 claim 同構 + PG row-lock 原語覆蓋;真連線實證留 §14 步18/步32(db push 後雙 psql gate)。
- F2:**claim-then-paid TOCTOU 窄窗**(claim 不鎖 order;CTE 讀 order=unpaid 後、同語句 UPDATE 蓋戳前並發 confirm 翻 paid → claim 可能交出剛 paid 的 attempt)。**不致雙扣**:B1b 複用 settleCharge,其 step2 order-paid 短路把已付款單擋在 Record 再 settle 前(冪等)。同 statement 共用快照故 EXISTS-in-UPDATE 無法消窗;鎖 order 會阻塞結算(4a-2 精化C 刻意不鎖)→ 故維持不鎖 + caller 短路兜底(對齊 4a-2 精化B 揭示)。
- §8 案 ①-⑤ 的「Record 5/4/unreachable→failed/維持 pending」是 B1b use-case 行為、本片 claim migration 不涵蓋。

**真實發現:** 模擬時全域 eligible=4(synthetic 3 + **1 筆 prod 真實 pending/unpaid/12h+ 孤兒**)= B1 真實目標(正常放棄結帳、非雙扣)。

---

## 3. B1b — `reconfirmExpiredOrphans` use-case + 接線(純 TS、無 migration)

```ts
export async function reconfirmExpiredOrphans(deps, opts): Promise<ReconfirmExpiredOrphansResult> {
  const { attempts } = deps;
  const concurrency = Number.isFinite(opts.concurrency) && opts.concurrency >= 1 ? Math.floor(opts.concurrency) : 1;
  const result = { claimed:0, settled:0, noAttempt:0, pending:0, errors:0 };
  let orphans = [];
  try { orphans = await attempts.claimExpiredPendingAttempts(opts.limit); }
  catch { result.errors++; return result; }          // claim 失敗→空、下輪重來(throttle 未蓋)
  result.claimed = orphans.length;
  await runBounded(orphans, concurrency, async (o) => {
    try {
      const outcome = await settleCharge(deps, { orderId: o.orderId });   // 🔴 複用對帳脊椎、不 bypass
      if (outcome.kind === 'pending') result.pending++;                   // 維持、不 markSettleRetry
      else if (outcome.kind === 'no_attempt') result.noAttempt++;
      else result.settled++;                                              // paid / failed
    } catch { result.errors++; }                                          // fail-closed、不中斷整批
  });
  if (result.errors > 0) console.error('[reconfirmExpiredOrphans] ...', { ...result });
  return result;
}
```

- **port** `IChargeAttemptStore.claimExpiredPendingAttempts(limit)`;**adapter** `PgChargeAttemptAdapter` 走 raw pg `SELECT attempt_id, order_id, needs_manual_review FROM public.claim_expired_pending_attempts($1::integer)` + `parseExpiredOrphan` fail-closed 形狀驗(對齊既有 `claimStuckUnsettled`/`parseStuckAttempt`;**raw pg 不依賴 database.types.ts 生成型別 → 可在 B1a RPC 未 db push 下實作**);**WithFallback** 主軌-only 委派。
- **🔴 F2 不變式(codex 請重點核):** B1b 唯二 mutating 呼叫 = `claimExpiredPendingAttempts` + `settleCharge`,**未 bypass 直呼 Record/markCharged/markFailed/markSettleRetry**。`settleCharge` step2:`if (attempt.orderPaymentStatus === 'paid') return { kind:'paid', idempotent:true }`(嚴格 ===、在 Record 之前)。claim RPC 不回 payment_status → B1b 不帶 stale 值、settleCharge 自重讀 `findActiveByOrderId`。第三層 = R1b2 `mark_charge_attempt_failed` order-paid guard(`FOR UPDATE` 鎖 order)。**三層防雙扣/防誤標 failed。**
- **不呼 markSettleRetry**(throttle 走 B1a `last_expired_settle_at` 分軌、不碰 sweeper next_settle_at/ceiling);**不清 manual**(settleCharge pending 路徑天然不動)。

**測試:** 完整 vitest 140 檔 1497 passed(**net +18 = 1497−1479**〔pivot A merged 態〕;breakdown 為 it/it.each rows 合計:use-case 12〔8 it + it.each 4 rows:不呼 markSettleRetry/不動 manual/claim·單筆 throw fail-closed/outcome 映射含 no_attempt 單列/concurrency NaN·0·負→1/orderId from DB〕+ adapter 5〔SETOF map + 空 + it.each 3 形狀〕+ WithFallback 1 = 18;另 4 既有 stub 補新 port 方法 mock=零行為變更不計新測)。

---

## 4. 審查結果(adversarial-reviewer + code-reviewer、月牆替身)

| 片 | code-reviewer | adversarial-reviewer |
|---|---|---|
| B1a | PASS-WITH-NITS 0 must-fix(3 nit commit body 措辭已落實) | PASS-WITH-NITS:F1 真雙連線誠實標記 + F2 TOCTOU 揭示已落實、F3(throttle 不永久卡/不熱迴圈)/F4(role-hygiene 時序)證正確 |
| B1b | PASS-WITH-NITS 0 must-fix(nit adapter 408 行屬 adapter 非元件有先例/runBounded 刻意複製;F2 不變式守住) | PASS-WITH-NITS 0 must-fix(8 攻擊向量全擋、F2 三層防線逐 file:line;C1 route 後續片、N1 no_attempt 計入 settled→已修 noAttempt、N2 runBounded 重複) |

**🔴 codex 請特別複核(adversarial 同模型模擬非真跨模型):**
1. **F2 claim-then-paid TOCTOU** 在 money 域的三層防線是否真無破口(尤其 settleCharge 短路 × R1b2 鎖序 attempt→order 的活鎖/死鎖窮舉)。
2. **B1a SECDEF + ACL + SKIP LOCKED 原子性** 是否與 round11-PASS 的 4a-2 真等價。
3. **B1 vs sweeper claim 集重疊**(非 disjoint;throttle **欄**分軌、但 eligibility 集合重疊:一筆 pending+unpaid+age+雙 throttle 到期+manual=false+count<8 同時符合 claim_stuck 與 claim_expired)。B1 cron 與 sweeper cron 同跑撞同 attempt **無雙扣**,靠三道結構鎖:① per-order 唯一 active index(一單至多一 active attempt)② settleCharge 不對 TapPay 發新 charge(只 recordQuery 讀 + markCharged + confirm、雙扣 sink 在 charge initiation 兩 cron 都不碰)③ markCharged/confirm `FOR UPDATE` 序列化 + 冪等(第一條收斂、第二條 no-op)。殘餘 = 多打一次唯讀 Record + 多蓋一次 throttle 戳(無害)。codex 請窮舉確認。

---

## 4.5 整體最終複審(§14 步35、adversarial-reviewer)— ✅ F-INT1 已 defer #253

整體複審 = **PASS-WITH-NITS**(0 must-fix);跨片整合逐字一致、Packet/STATUS 誠實度核實、雙扣面三道結構鎖守住(0 deletions)。抓到 1 個 slice 級未見的 **spec 缺口(F-INT1、MEDIUM)→ Sean 2026-06-27 拍 defer + 編號 backlog #253**(canonical §8 defer 契約滿足):

- **F-INT1**:canonical §8 行280 case ④「manual=F + Record 4 → 維持 pending **並進 manual**」要求 B1 把「manual=false 的 12h+ 孤兒、再確認仍 pending」**升級** needs_manual_review=true(進人工 queue)。**B1b 未做此升級**(pending 分支只 tally、不寫 manual)。⚠️ canonical 用詞自相矛盾:行278「原本 false **可**標 true」(permissive)vs 行280 case ④「並進 manual」(mandatory)。
  - **實務影響 LOW**:既有 sweeper(`claim_stuck_unsettled_attempts`)本就處理 manual=false 孤兒、約 8 個掃描週期達 ceiling 後 `mark_attempt_settle_retry` 標 manual=true → manual=false 孤兒**仍會被升級、只是由 sweeper 非 B1**。B1 主目標(sweeper 放棄的 manual=TRUE 孤兒)已覆蓋。
  - **處置:Sean 2026-06-27 拍 B = defer → backlog #253**(B1 主目標已覆蓋、sweeper 兜底 manual=false 升級、canonical 用詞矛盾;開 prod flag 前評估補)。merge 不再 hold。

## 5. Rollout 狀態(開 prod flag 前 gate)

- B1a 未 db push(§14 步31 = Sean);B1b 純 TS;`TAPPAY_3DS_ENABLED` 全程 false;**未 push**。
- 開 flag 前 gate(不變):#252(R3 gating begin-dedup 兜底)+ #250(雙扣 anomaly 主動告警)+ #241(同意 checkbox server 驗)+ **B 線 route 後續片**(reconfirmExpiredOrphans 目前無 caller、cron route = canonical §9 後續)+ adapter 408 行下次動評估抽 sweeper-family。
- B1 defer 契約:B1a/B1b 已完成(非 defer);db push + flag-on 後 B1 cron 上線將自動再確認 12h 孤兒。

— END —
