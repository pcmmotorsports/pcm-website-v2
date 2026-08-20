import type { IEmailOutbox, IIneligibleOrderEmailScanner } from '@pcm/ports';

/**
 * applyOrderIneligibleGate:寄送前 ineligible gate(M-4a E2a-2、W3-G 拆出)。
 *
 * 獨立 cron route,不掛在 email-sweep route 裡 —— 與 `sweepEmailOutbox` 分屬不同 use-case、
 * 不同 route,鏡像 E2a-2 另一半 `checkAnomalyAlerts`「不可放進 sweeper 自我監看」的既有先例。
 *
 * 🔴🔴 **本片【縮小】寄出不合格信的窗口,沒有【關閉】它**(2026-08-20 codex 關卡2 R2 + W5 獨立
 * 盲審交叉命中、主視窗裁定)。唯一不 race 的位置是寄送路徑本身(`sweep-email-outbox.ts`),而那條
 * 邊界被拍板釘住(該檔測試的預設 mock 對 `markSkippedOrderIneligible` 寫死 reject,是邊界的證人,
 * 本片刻意不碰)。⇒ 只要 `applyOrderIneligibleGate` 與 `sweepEmailOutbox` 是兩支各自獨立的 cron,
 * 兩者之間就沒有誰先誰後的保證。**殘留 race**:本片的 `scanner` 看到某列該擋 → 呼叫
 * `claimById` 之前,`sweepEmailOutbox` 的 `claimDue` 可能已搶先認領那一列 → 本片 `claimById`
 * 拿到 null(見下方 `raceLost`)→ 而搶到的那一邊接下來會真的呼叫 `sender.send()`。
 * 真正關閉這個窗口需要把合格性檢查放進 `sweep-email-outbox.ts` 本身,那是 E2a-b 的邊界、需要
 * Sean 拍板(見 `apps/storefront/src/app/api/cron/order-ineligible-gate/route.ts` 檔頭)。
 *
 * 🔴 **為什麼不接進 `sweepEmailOutbox`**:plan `:362` 早已把 ineligible gate 歸給 E2a-2、
 * 不是 E2a-b;`sweep-email-outbox.test.ts` 的預設 mock 是邊界的證人,本片刻意不碰那支檔案。
 *
 * 🔴 **只碰「訂單已不合格」的候選,絕不碰合格的列**:`IIneligibleOrderEmailScanner` 已經在
 * 唯讀查詢裡把合格的排除掉,本 use-case 對每一筆候選各自 `claimById` + `markSkippedOrderIneligible`
 * ——不 `claimDue`、不批次認領。合格的列完全不會被本片碰到,原樣留給 `sweepEmailOutbox` 認領寄送。
 *
 * 失敗語意(鏡像 `enqueueOrderCreatedEmails`,但 `raceLost` 的定性與其他片不同,見下方欄位註解):
 * - 單筆失敗(claim 或 mark throw)⇒ `errors` +1、不中斷整輪;下一輪會再撈到(候選仍是
 *   pending/failed,除非中間被 sweeper 認領了 —— 那種情況落 `raceLost`,不是 errors)。
 * - `claimById` 拿不到(null)或 `markSkippedOrderIneligible` 回 false(世代柵欄沒對上)
 *   ⇒ `raceLost` +1。**這不是「安全」,是「未知」** ——見下方欄位註解與上面的殘留 race 說明。
 *
 * PII(鏡像既有片):result 只有數字,零 email/orderId 進 log。
 *
 * @see docs/specs/2026-07-16-m4a-email-notify-plan.md §4.1(:329)/ E2a-2 表列(:362)
 * @see packages/use-cases/src/sweep-email-outbox.test.ts:53(邊界的證人,不要動它)
 */
export type ApplyOrderIneligibleGateDeps = {
  outbox: IEmailOutbox;
  scanner: IIneligibleOrderEmailScanner;
};

/** 參數由 route 顯式注入(鏡像既有片慣例、不設預設值)。limit = 單輪掃描上限。 */
export type ApplyOrderIneligibleGateOptions = {
  limit: number;
};

/** counts-only(零 PII)。 */
export type ApplyOrderIneligibleGateResult = {
  /** scanner 回的候選數(訂單已不合格的 due 列)。 */
  scanned: number;
  /** 成功標記 `skipped_order_ineligible` 的筆數。 */
  markedIneligible: number;
  /**
   * 🔴 claim 拿不到或 mark 世代柵欄沒對上 —— **這是「未知」,不是「安全」**(2026-08-20 裁定,
   * 見檔頭殘留 race 說明)。本 use-case 無法分辨兩種情況:①該列已被 sweeper 認領且即將/已經
   * 寄出(違反本片存在的理由)②該列已被其他來源正常結案(sent/failed/lease 回收)。
   * ⇒ 這個數字是這道 gate 殘留 race 的**分母**,route 必須把它原樣回報、不得吞掉或折算成「安全」。
   */
  raceLost: number;
  /** claim 或 mark 本身 throw;下一輪會再撈到(除非中途被送出,那時已轉 raceLost)。 */
  errors: number;
};

export async function applyOrderIneligibleGate(
  deps: ApplyOrderIneligibleGateDeps,
  options: ApplyOrderIneligibleGateOptions,
): Promise<ApplyOrderIneligibleGateResult> {
  const candidates = await deps.scanner.listDueIneligible(options.limit);

  const result: ApplyOrderIneligibleGateResult = {
    scanned: candidates.length,
    markedIneligible: 0,
    raceLost: 0,
    errors: 0,
  };

  for (const candidate of candidates) {
    try {
      const claimed = await deps.outbox.claimById(candidate.id);
      if (claimed === null) {
        result.raceLost += 1;
        continue;
      }
      const owned = await deps.outbox.markSkippedOrderIneligible(claimed.id, claimed.attempts);
      if (owned) {
        result.markedIneligible += 1;
      } else {
        result.raceLost += 1;
      }
    } catch {
      // 🔴 零 PII:連錯誤物件都不接住(可能帶著 orderId/PostgREST 訊息)。
      result.errors += 1;
    }
  }

  return result;
}
