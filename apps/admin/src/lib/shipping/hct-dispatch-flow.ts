import { HCT_DISPATCH_MAX_ROWS, type HctDispatchOutcome } from './hct-client';

// hct-dispatch-flow.ts — 把派遣的回答翻成「這一箱接下來要做什麼」(⟦ship-DISPATCHORDER⟧ 片二)。
//
// 🔴🔴 **本檔存在的理由是 plan §3:逐箱各自結算, 而理由不是偏好, 是【失敗方向的可補性】**:
//    ```
//    可補   車叫了而沒標出貨  ⇒ 貨還在我們手上, 員工再按一次
//    不可補 標了而車沒叫       ⇒ 客人收到「已出貨」而貨不會走
//    不可補 信寄了而車沒叫     ⇒ 同上, 而且更早
//    ```
//    ⇒ ✅ **所以順序是【先叫車, 那一箱成功才標出貨+寄信】**, 而失敗那箱**原封不動**。
//
// 🛑 **而丙的殘餘要寫出來, 不能假裝沒有**:單一箱在「API 回成功」與「DB 標出貨」之間掛掉
//    ⇒ **車叫了而沒標** ⇒ 📌 **那一箱在畫面上看起來還沒出貨, 而司機會來收它。**
//    ⇒ 而處置是 `needs_human` —— **不是自動再打一發**:
//      「已經派遣過的箱再派遣一次會怎樣」V15 §8 沒寫、我沒問、也沒試(plan §7-1)
//      ⇒ 🎯 **在那件事有答案之前, 寧可要一個人看一眼。**
//
// 🔵 **本檔零 DB、零網路** —— 抄 `hct-submit-flow.ts` 那條分界線:
//    決定住在這裡、副作用住在 action ⇒ 每一條路都用假 client 驗得完。

/** 那一箱接下來要做什麼。 */
export type DispatchPlanRow =
  /** ✅ 車叫到了 ⇒ 標出貨(而寄信是標出貨的下游, 不是本檔再做一次的事)。 */
  | { action: 'mark_shipped'; epino: string; edelno: string }
  /** 🔵 新竹明白地拒絕了這一箱 ⇒ **原封不動**, 把話原樣給員工看。 */
  | { action: 'leave_alone'; epino: string; message: string }
  /**
   * 🔴 **不確定** ⇒ 不標、也不重打。
   *    📌 這一格與 `leave_alone` 的差別是**要不要有人去看**:
   *      拒絕是一個答案, 不確定不是。
   */
  | { action: 'needs_human'; epino: string; reason: string };

export type DispatchPlan =
  | { kind: 'plan'; rows: readonly DispatchPlanRow[] }
  /**
   * 🛑 **整包不確定 ⇒ 一箱都不動。**
   *    ⚠️ 而它**不代表沒有一箱叫到車** —— 📌 **可能全部都叫到了, 而我們沒收到回答。**
   *    ⇒ 那正是「要人看一眼」最強的一種, 所以它連 rows 都不給:沒有東西可以逐箱處理。
   */
  | { kind: 'all_unknown'; reason: string; evidence?: string }
  | { kind: 'disabled' };

/** 把 client 的回答翻成計畫。**純函式** —— 同樣的輸入永遠同樣的輸出。 */
export function planFromDispatch(out: HctDispatchOutcome): DispatchPlan {
  if (out.kind === 'disabled') return { kind: 'disabled' };
  if (out.kind === 'unknown') {
    return out.evidence === undefined
      ? { kind: 'all_unknown', reason: out.reason }
      : { kind: 'all_unknown', reason: out.reason, evidence: out.evidence };
  }
  return {
    kind: 'plan',
    rows: out.rows.map((r): DispatchPlanRow => {
      if (r.kind === 'dispatched') return { action: 'mark_shipped', epino: r.epino, edelno: r.edelno };
      if (r.kind === 'rejected') {
        // 🔴 `ErrMsg` 可能是空的(規格第 26-27 頁有些項目連原因欄都空)⇒ 給一句說得出「沒說」的話,
        //    而不是一個空白 —— 📌 空白會被讀成「沒問題」。
        return {
          action: 'leave_alone',
          epino: r.epino,
          message: r.errMsg === '' ? '新竹拒絕了這一箱, 而它沒有給原因' : r.errMsg,
        };
      }
      return { action: 'needs_human', epino: r.epino, reason: r.reason };
    }),
  };
}

/**
 * 這一批箱子按得下去嗎。**在按下去【之前】問** —— plan §4 逐字:
 * 「不要按下去才失敗, 那會讓員工在一個他無法預測的地方撞牆。」
 *
 * 🛑 **本函式不是安全網** —— 它省一次來回、給人看得懂的話;
 *    真正擋得住的是 `dispatchOrder` 自己那兩道 throw 與那道閘。
 */
export type DispatchEligibility = { ok: true } | { ok: false; message: string };

export function canDispatch(boxes: readonly {
  readonly epino: string;
  /** 我們庫裡的狀態。只有 `submitted`(託運單已經在新竹那邊)叫得動。 */
  readonly hctStatus: 'draft' | 'submitted' | 'failed' | 'unknown';
  /** 那張託運單在新竹建檔的時間。 */
  readonly submittedAt: Date | null;
  /** 已經派遣過了嗎。🔴 **擋住**(plan §3-a 定案:重複派遣的行為未知)。 */
  readonly alreadyDispatched: boolean;
}[], now: Date): DispatchEligibility {
  if (boxes.length === 0) return { ok: false, message: '沒有選到任何一箱' };
  if (boxes.length > HCT_DISPATCH_MAX_ROWS) {
    return { ok: false, message: `一次最多 ${HCT_DISPATCH_MAX_ROWS} 箱, 你選了 ${boxes.length} 箱` };
  }
  for (const b of boxes) {
    if (b.alreadyDispatched) {
      return { ok: false, message: `箱 ${b.epino} 已經叫過車了 —— 再叫一次會怎樣我們沒有問過新竹, 所以擋住` };
    }
    if (b.hctStatus !== 'submitted') {
      return { ok: false, message: `箱 ${b.epino} 的託運單還沒在新竹那邊建好(現在是 ${b.hctStatus})` };
    }
    if (b.submittedAt === null) {
      return { ok: false, message: `箱 ${b.epino} 沒有建檔時間 ⇒ 我們判不出它在不在 30 天內` };
    }
    // 🔴 V15 §8 逐字:「派遣條件: 需為 **30 天內**使用同一個 company 上傳的資料。」
    //    ⚠️ 邊界(剛好第 30 天)規格沒寫 ⇒ **取嚴的那一邊**:超過 30 天就擋。
    //      📌 擋錯的代價是員工多問一句;放行錯的代價是他按下去撞一個看不懂的牆。
    if (now.getTime() - b.submittedAt.getTime() > DISPATCH_WINDOW_MS) {
      return { ok: false, message: `箱 ${b.epino} 的託運單超過 30 天了 —— 新竹只收 30 天內的` };
    }
  }
  return { ok: true };
}

const DISPATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
