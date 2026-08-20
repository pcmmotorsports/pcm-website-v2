/**
 * @module @pcm/use-cases/recheck-capture-state — 請款狀態重讀(M-4b、backlog `#785`)
 *
 * ## 為什麼需要它
 * `capture_state` 只在**授權當下**被寫一次(`settlePaid` 內),而銀行是 21 小時後才請款
 * ⇒ 沒有任何路徑會再寫它。成因:`settle-charge.ts:70` 的 paid 短路在 Record 查詢**之前** return,
 * 而 `settleCharge` 的生產 caller 恰 4 條、全部走同一支函式。
 *
 * ## 🔴 這是【新造一條路】,不是掛在既有 sweeper 上
 * 既有五個反覆問的入口,**沒有一個會重問 TapPay 一張 paid 單**(W5 對抗審查 2026-08-20 量測)。
 * ⇒ 本 use-case **不動那個短路** —— 短路存在的理由是 TapPay rate limit(`settle-charge.ts:66` 逐字),
 * 而本路徑自己節流(`limit` 寫在 SQL 的 `LIMIT` 裡,不是靠集合天然小)。
 *
 * ## 排空與重試
 * 述詞 `capture_state = 'authorized'` 是**天然待辦集合**:成功一列就翻成 `captured` ⇒ 集合自己排空。
 * 排序 `capture_state_read_at ASC` = 最久沒問的先問。
 *
 * ## ⚠️⚠️ 已知飢餓面(W5 對抗審查 R1 MF-1;2026-08-20 拋棄式 PG 實測,**原註解為假**)
 * ~~「問過就排到隊尾,失敗的不會霸佔每一輪」~~ ⇒ **假的,更正保留**:
 * 下面兩條失敗路徑都是**零寫入的 `continue`** ⇒ `capture_state_read_at` **不會被更新**
 * ⇒ 一列若 Record **持續**失敗(例:TapPay 不認得那個 `recTradeId` —— 那是**永久條件**),
 * 它會保持最舊的 `read_at` ⇒ **每一輪都排在隊首**。
 * 實測:三列同時 `authorized`,只有一列一直不被寫 ⇒ 第一/二/三輪的隊首**都是它**。
 * - **後果**:若永久失敗的列數 ≥ `limit`,真正會成功的列**排不進來**。
 * - **邊界**:它自己會結束 —— 超過 `cutoffDays` 就退出集合 ⇒ 是「≤cutoff 天的飢餓」,不是永久。
 * - **為什麼不寫 `'authorized'` 充數來刷新 `read_at`**:那會讓 `read_at` 說謊 ——
 *   它答的是「這個值是什麼時候**確立**的」,而讀失敗時我們什麼都沒確立。
 * - 🔴 **要根治需要一個「上次嘗試時刻」欄(= 一次 schema)** ⇒ 那是一個取捨,不是我可以順手做的決定。
 *   ⇒ 本版的處置是**讓它看得見**:回傳帶 `leadingFailures`(在第一次成功之前連續失敗了幾列),
 *   而不是只回一個每輪都一樣、看起來像「有在重試」的固定數字。
 *
 * ## 殘留狀態(不是缺陷,是事實)
 * 「超過 cutoff 而仍 `authorized` = **我們停止問了**」—— 顯示層要講清楚(backlog `#781`)。
 *
 * ## 🔴 每一輪都產生分母
 * `recordCalls` / `recordFailures` 進回傳,因為「既有量沒撞到 rate limit」目前是**推的、沒量過**
 * (`docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md:234` 逐字只給「綠界類比」,沒有 TapPay 的數字)。
 * ⇒ 這一欄讓下一個人有分母,而不是再推一次。
 */
import type { IChargeAttemptStore, ITapPayAdapter } from '@pcm/ports';

export type RecheckCaptureStateDeps = {
  attempts: IChargeAttemptStore;
  tappay: ITapPayAdapter;
};

export type RecheckCaptureStateInput = {
  /** 只看這麼多天內建立的 attempt。<=0 ⇒ RPC 回空集合(fail-closed)。 */
  cutoffDays: number;
  /** 單輪上限(節流;寫進 SQL 的 LIMIT)。 */
  limit: number;
};

export type RecheckCaptureStateResult = {
  /** 這一輪撈到幾列候選。 */
  scanned: number;
  /** 打了幾發 Record(= 分母)。 */
  recordCalls: number;
  /** 其中幾發失敗(throw / 形狀異常;= 分子)。 */
  recordFailures: number;
  /** 讀到 is_captured=true 且成功寫入的列數。 */
  captured: number;
  /** 讀到仍未請款、成功寫入的列數(值不變,只更新 read_at ⇒ 排到隊尾)。 */
  stillAuthorized: number;
  /** 寫入失敗或回 false 的列數(該列維持 authorized、下輪會再被撈到)。 */
  writeFailures: number;
  /**
   * 🔴 **隊首連續失敗數**:候選是 `read_at ASC` 排的 ⇒ 索引就是「有多舊」;
   * 本欄 = **在第一次成功之前**連續失敗了幾列。
   *
   * 它存在的唯一理由是讓**飢餓看得見**:`recordFailures` 每輪都是同一個數字時,
   * 「同幾列一直卡在隊首」與「每輪散落幾個新失敗」在數字上長得一樣 —— 而處置完全不同。
   * `leadingFailures` 持續 > 0 且接近 `limit` ⇒ 隊首被卡住(見檔頭「已知飢餓面」)。
   *
   * ⚠️ **它答不出「是不是同一批列」** —— 我們沒有跨輪狀態。要精確答那個,
   * 需要一個「上次嘗試時刻」欄(= 一次 schema)。**本欄是訊號,不是證明。**
   */
  leadingFailures: number;
};

/**
 * 掃一輪:撈候選 → 逐列問 Record → 寫回 capture_state。
 *
 * 🔴 **順序處理、不併發**:對齊 `settle-sweep` 的既有預算(`route.ts:65` 逐字「單輪最壞 =
 * (inbox 50 + stuck 50)× ~500ms ≈ 50s < maxDuration 60s」)。limit=25 ⇒ 最壞 ~12.5s。
 * 在沒有量過延遲之前不加併發到打錢那家 API 的路徑上。
 *
 * 🔴 **任何單列失敗都不中止整輪** —— 一列問不到不該讓其餘的也問不到;
 * 而失敗的列**維持 authorized** ⇒ 下一輪還會被撈到(且因 read_at 已更新而排到隊尾)。
 */
export async function recheckCaptureState(
  deps: RecheckCaptureStateDeps,
  input: RecheckCaptureStateInput,
): Promise<RecheckCaptureStateResult> {
  const { attempts, tappay } = deps;
  const result: RecheckCaptureStateResult = {
    scanned: 0,
    recordCalls: 0,
    recordFailures: 0,
    captured: 0,
    stillAuthorized: 0,
    writeFailures: 0,
    leadingFailures: 0,
  };

  const candidates = await attempts.listForCaptureRecheck(input.cutoffDays, input.limit);
  result.scanned = candidates.length;

  // 🔴 候選是 `read_at ASC` 排的 ⇒ **索引就是「有多舊」**。
  //    在**第一次成功之前**連續失敗了幾列 = 隊首被卡住的深度(見檔頭「已知飢餓面」)。
  //    這是單輪內的訊號,不是跨輪追蹤 —— 誠實邊界寫在 `leadingFailures` 的 JSDoc。
  let seenSuccess = false;

  for (const c of candidates) {
    let isCaptured: boolean;
    result.recordCalls += 1;
    try {
      const record = await tappay.recordQuery({ recTradeId: c.recTradeId });
      const tr = record.records[0];
      if (record.numberOfTransactions !== 1 || record.records.length !== 1 || tr === undefined) {
        // 🔴 不是恰一筆就當作沒讀到 —— 不猜、不採信第一筆。該列維持 authorized、下輪再來。
        result.recordFailures += 1;
        if (!seenSuccess) result.leadingFailures += 1;
        continue;
      }
      isCaptured = tr.isCaptured;
    } catch {
      // 連線 / 格式 / 非 2xx —— 全部算失敗,不中止整輪。
      result.recordFailures += 1;
      if (!seenSuccess) result.leadingFailures += 1;
      continue;
    }

    try {
      const persisted = await attempts.recordCaptureState(
        c.attemptId,
        c.orderId,
        isCaptured ? 'captured' : 'authorized',
      );
      if (!persisted) {
        // 雙鍵不符 / 查無(例:列被刪)⇒ 記一筆,不中止。
        result.writeFailures += 1;
      } else if (isCaptured) {
        result.captured += 1;
        seenSuccess = true;
      } else {
        result.stillAuthorized += 1;
        seenSuccess = true;
      }
    } catch {
      result.writeFailures += 1;
    }
  }

  return result;
}
