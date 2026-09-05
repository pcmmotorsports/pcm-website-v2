// hct-submit-flow.ts — 把片 B 的三態接到片 C-1 的 RPC(⟦ship-HCTAPI⟧ 片 C-2)。
//
// 🔴🔴 **本檔【不自己決定重送】** —— 那個規則住在 DB(`admin_record_hct_submit`)。
//    📌 理由:**TS 這一層可以被繞過**(有人直接呼叫 RPC、或另一支碼繞過本檔),
//      而 DB 那一層是**每一條路都會經過的地方**。
//    ⇒ 🎯 **所以本檔的工作不是「擋」, 是【把該擋的送到擋得住的那一層去】** ——
//      並且**在送之前先問一次**, 免得每一次都靠 DB 丟例外來告訴我們一件我們早就知道的事。
//
// 🛑 **而那兩層的分工要寫清楚, 否則下一個人會以為 TS 這層是安全網**:
//    · TS(本檔)= **省一次來回 + 給人看得懂的訊息**
//    · DB(C-1)  = **不可繞過的那一道**
//    ⇒ 🔴 **本檔的判斷若與 DB 不一致, 以 DB 為準** —— 而那正是為什麼本檔的每一格
//      都有一個 DB 側的對應例外。

import {
  queryEdelno,
  submitTransData,
  type HctClientDeps,
  type HctSubmitOutcome,
} from './hct-client';
import type { HctTransDataFields } from './hct-trans-data';

/** DB 收得下的三個狀態(`admin_record_hct_submit` 的 `p_status` 值域)。 */
export type HctRecordStatus = 'submitted' | 'failed' | 'unknown';

/** 這張箱在我們庫裡現在的狀態(呼叫端從 `shipments.hct_status` 讀來)。 */
export type HctCurrentStatus = 'draft' | 'submitted' | 'failed' | 'unknown';

export type SubmitDecision =
  | { action: 'submit' }
  /** 🔵 `unknown` ⇒ **先查, 不重送**。 */
  | { action: 'query_first' }
  | { action: 'refuse'; reason: string };

/**
 * 送之前先問:**這張箱現在該不該送?**
 *
 * 🔴 **`unknown` ⇒ `query_first`, 而【絕不】是 `submit`。**
 *    「查無」有**兩個世界**:①那張單真的沒進去 ②新竹的查詢與建單不同步。
 *    ⇒ 🛑 **而我們分不出來** —— 規格對 `QueryEDELNO` 的錯誤只給了一個 `"查無資料"` 字串, 沒有清單。
 *    ⇒ 📌 **在分不出來的時候重送, 等於用一個我們沒有的知識去做一個不可回收的動作。**
 *
 * 🔴 **`submitted` ⇒ 拒。** 在新竹那端「同日重送」被規格(第 8 頁)逐字定義成**更正**
 *    ⇒ 🎯 **重送不是重送, 是改掉那張單** —— 而那是另一個動作, 不在本片。
 *
 * ✅ **`failed` ⇒ 可以送。** 它**明確被拒**, 那張單沒有進去 —— 這是三態裡唯一安全可重試的。
 */
export function decideSubmit(current: HctCurrentStatus): SubmitDecision {
  switch (current) {
    case 'draft':
    case 'failed':
      return { action: 'submit' };
    case 'unknown':
      return { action: 'query_first' };
    case 'submitted':
      return {
        action: 'refuse',
        reason:
          '這張單已經送成功過了。在新竹那端「同日重送」是【更正】不是重試,' +
          ' 而更正要帶新竹貨號走另一條流程。',
      };
  }
}

export type FlowResult =
  /** 送出去了, 而結果已經交給呼叫端寫進 DB。 */
  | { kind: 'recorded'; status: HctRecordStatus; requestId: string | null; raw: unknown }
  /** 🔴 `R`(修改成功)—— 貨號是真的, 而它同時是一個要人看的訊號。 */
  | { kind: 'amended'; requestId: string; raw: unknown; reason: string }
  /** 查到貨號 ⇒ **補記一個已經發生的事實**(不是重送)。 */
  | { kind: 'recovered'; requestId: string; raw: unknown }
  /**
   * 🔴 查無 ⇒ **停下來給人看。**
   * 🛑 **不自動重送** —— 理由在 `decideSubmit` 的 docstring。
   */
  | { kind: 'needs_human'; reason: string }
  | { kind: 'refused'; reason: string }
  /** 閘關著 ⇒ 一發請求都沒打。**預期的安全態**, 不是錯誤。 */
  | { kind: 'disabled' };

export type RunHctSubmitInput = {
  deps: HctClientDeps;
  current: HctCurrentStatus;
  fields: HctTransDataFields;
  /** 我方單號 —— `queryEdelno` 用它去問。 */
  epino: string;
};

/**
 * 一張箱的完整流程:**決定 ⇒(查 or 送)⇒ 回一個【呼叫端可以直接落庫】的結果。**
 *
 * 🛑 **本函式【不寫 DB】** —— 它回結果, 由呼叫端交給 `admin_record_hct_submit`。
 *    📌 那個分界是刻意的:**本檔零 DB 依賴 ⇒ 它的每一條路都用假 client 驗得完。**
 */
export async function runHctSubmit(input: RunHctSubmitInput): Promise<FlowResult> {
  const decision = decideSubmit(input.current);

  if (decision.action === 'refuse') {
    return { kind: 'refused', reason: decision.reason };
  }

  if (decision.action === 'query_first') {
    const q = await queryEdelno(input.deps, input.epino);
    if (q.kind === 'disabled') return { kind: 'disabled' };
    if (q.kind === 'found') return { kind: 'recovered', requestId: q.edelno, raw: q.raw };
    // 🔴 `not_found` 與 `unknown` **都停下來** —— 而它們停的理由不同, 所以訊息不同。
    //    🛑 而**都不重送**:兩者都代表「我們仍然不知道那張單在不在新竹那邊」。
    return {
      kind: 'needs_human',
      reason:
        q.kind === 'not_found'
          ? '新竹查不到這張單的貨號。而「查無」有兩個世界(真的沒進去 / 新竹的查詢與建單不同步),' +
            ' 我們分不出來 ⇒ 不自動重送, 請人確認。'
          : `查詢本身沒有拿到答案(${q.reason})⇒ 我們對這張單的狀態仍然一無所知, 不重送。`,
    };
  }

  const out: HctSubmitOutcome = await submitTransData(input.deps, input.fields);
  switch (out.kind) {
    case 'disabled':
      return { kind: 'disabled' };
    case 'submitted':
      return { kind: 'recorded', status: 'submitted', requestId: out.edelno, raw: out.raw };
    case 'amended':
      // 🔴🔴 codex must-fix ④b:`R` = 新竹那邊**本來就有一張**, 我們把它【更正】掉了。
      //    規格第 8 頁逐字「當日重複上傳, 視同【更正】資料內容」。
      //    ⇒ 📌 **那不是一次乾淨的新增, 是一個「我們的狀態與新竹不同步」的訊號** ——
      //      我們以為自己是第一次送, 而它說「你之前送過」。
      //    ⇒ 貨號要記(那張單是真的), 而**要有人看一眼** ⇒ 走 needs_human 而不是靜靜地成功。
      //    ⚠️ 呼叫端仍要把 `submitted` + 貨號寫進去 —— 那張單存在是事實, 不記才是錯的。
      return {
        kind: 'amended',
        requestId: out.edelno,
        raw: out.raw,
        reason:
          '新竹回「修改成功」而不是「新增成功」⇒ 它那邊【本來就有一張】這個訂單編號的單,' +
          ' 我們剛剛把它更正掉了。貨號已記, 而請人確認那張單的內容是不是我們要的。',
      };
    case 'rejected':
      // 🔵 明確被拒 ⇒ `failed`。而 `errMsg` 進 raw, 讓人看得到新竹說了什麼。
      return { kind: 'recorded', status: 'failed', requestId: null, raw: out.raw };
    case 'unknown':
      // 🔴 **這裡【不能】回 failed。** 一個回 failed 的結果會讓下一個人重送,
      //    而重送在新竹那端是【更正】⇒ 而更正要帶我們沒有的貨號。
      return {
        kind: 'recorded',
        status: 'unknown',
        requestId: null,
        raw: { flowReason: out.reason },
      };
  }
}
