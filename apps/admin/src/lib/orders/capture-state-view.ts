// capture-state-view.ts — 「錢真的進來了沒」在後台要顯示成什麼(W4-Q,plan `W4-030`)
//
// 🔴 **本檔零 DB 存取、零 import 型別檔** —— 它是純函式,吃一個已經取好的物件、吐要顯示的東西。
//    分成兩片的理由是**量到的**,不是潔癖:`capture_state` 欄在
//    `packages/adapters/src/supabase/database.types.ts` 的命中數 = **0**
//    (正向對照:同表既有欄 `rec_trade_id` = 39)⇒ 那支 migration(`20260820040000`)
//    **還沒 apply**,生成型別裡沒有這三個欄 ⇒ 現在寫讀取路徑會撞上「型別跑在 apply 前面」。
//    ⚠️ 而那支型別檔**此刻正被別的窗改著**(`git status` = ` M`,W2 手補 `order_manual_refunds`)
//    ⇒ 兩個人同時手補同一支共用檔 = 誰後 commit 誰帶走對方的 WIP。**所以本片不碰它。**
//
// ── 🔴 這一格為什麼需要一道「新鮮度閘」而不是直接把值印出來 ──────────────────
//   `capture_state` 只在**授權當下**被寫一次,而授權當下 `is_captured` 幾乎必然是 false
//   ⇒ 存下來的是 `'authorized'`(出處:`20260820040000` 檔頭逐字)。
//   而銀行真正請款可能是**幾小時到一天以後**(2026-08-20 實測有一筆隔 21 小時),
//   **沒有任何路徑會回頭改寫它** —— 重讀那條路(backlog `#785`)要另外開。
//   ⇒ 若照字面印出來,員工看到的會是**每一張刷卡單都永遠寫著「已授權」**,
//     他會等一個不會來的值,然後學會「這一格不用看」。
//
//   ⇒ ⇒ 所以判準**不是**「這個值是什麼」,是「**這個值還新不新**」:
//        重讀沒開 ⇒ `read_at` 停在授權那一刻 ⇒ 年齡無上限地長 ⇒ **過門檻自動閉嘴**
//        重讀開了 ⇒ `read_at` 每輪更新        ⇒ 年齡有上限        ⇒ **自動開口**
//   🔴 **它不依賴部署順序,也不依賴任何人記得先做哪一步。** 順序錯的後果是「太安靜」,
//      而太安靜是安全的那一邊 —— 員工去問人,不會被一個過期的肯定句騙。
//
//   📌 這道閘成立的基礎是 **schema 保證**、不是慣例:`20260820040000:77-80` 的 pair CHECK 逐字
//      `capture_state <> 'unknown'` ⟺ `capture_state_read_at IS NOT NULL`
//      ⇒ **只要值不是 unknown,就一定答得出「這是什麼時候讀的」。**

/** `payment_charge_attempts.capture_state` 的值域(`20260820040000:73`)。 */
export type CaptureState = 'authorized' | 'captured' | 'unknown';

/** `payment_charge_attempts.status` 的值域(`20260624120000:46` 加了 `released` 之後的現行四值)。 */
export type ChargeAttemptStatus = 'pending' | 'charged' | 'failed' | 'released';

/**
 * 顯示這一格需要的**全部**輸入。刻意不吃整個 attempt 列 —— 多吃一個欄位,
 * 就多一個「哪天它改名了而這裡靜靜壞掉」的面。
 */
export type CaptureInput = {
  captureState: CaptureState;
  /** `capture_state_read_at`;pair CHECK 保證 `captureState !== 'unknown'` 時它非 null。 */
  readAt: Date | null;
  status: ChargeAttemptStatus;
  /**
   * `bank_transaction_id` 是否為 null。**null = 直刷單**(backlog `#781` 的判別欄)。
   * ⚠️ `#781` 自己標的限定,照抄不升級:這是【現在】的分母 —— 那一欄目前只有一個寫入者
   * (`record_charge_bank_txn`,而它只寫仍 pending 的列)。哪天多一個寫入者,
   * 這個判別會失效而**不會有東西紅**。
   */
  hasBankTxn: boolean;
};

export type CaptureDisplay =
  /** 不顯示這一格(直刷單以外的「我們沒有可信的話可以說」也走這條)。 */
  | { kind: 'hidden'; reason: 'no-capture-concept' }
  /** 顯示一句中性的話,**不下肯定句**。 */
  | { kind: 'pending'; text: string }
  /** 顯示一句肯定句。 */
  | { kind: 'settled'; text: string }
  /** 需要人去看一眼,但**不是錯誤**。 */
  | { kind: 'attention'; text: string };

/**
 * 值過期多久之後就不再下肯定句。
 *
 * 🔴 **這個數字調錯的方向是「變安靜」,不是「說謊」** —— 太小 ⇒ 該說的時候閉嘴(員工去問人);
 *    太大 ⇒ 拿一個舊值當現況。所以寧可偏小。
 * 24 小時的理由:它要**大於**「當天請款」這個真實節奏(2026-08-20 實測有一筆隔 21 小時),
 * 否則正常的單子會整批變安靜、這一格等於沒做。
 * ⚠️ 這是**顯示常數**,不是 Sean 要拍的板 —— 他要答的是「多久重讀一次」,而那在 `#785`、不在本片。
 */
export const CAPTURE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * 三態的字面。
 * 🔴 **與 `PAYMENT_STATUS_LABEL` 並列、刻意不合併** —— 付款狀態講的是「這張單收到錢沒」,
 *    本表講的是「刷卡那筆授權有沒有變成真的入帳」。**合成一張表會讓兩個軸互相污染。**
 *
 * 🔴 `authorized` 那句**必須自帶「不用處理」** ——
 *    畫面上會同時出現「付款狀態:已付款」與「入帳:尚未撥款」,**兩句都是真的**,
 *    而合起來讀出來的第三個意思是「這張單有問題」。而它**沒有問題**。
 *    沒有那句,員工會去追一件沒有東西可追的事,追完一次就再也不看這一格。
 *    📌 前例:`#494` 就是因為四種付款狀態**共用一句話**、被 Sean 自己讀到才改的
 *       (`cancel-review-section.test.tsx:139-141`)⇒ **這一族我們已經摔過一次。**
 *
 * ⚠️ 兩條硬約束(`R-015-STOP.md:20` 與 `docs/reference/tappay-reference.md`):
 *    **不寫時長、不寫時點** —— 入帳時間只能講條件。下面三句都遵守。
 */
export const CAPTURE_STATE_LABEL: Record<CaptureState, string> = {
  captured: '錢已入帳',
  authorized: '已授權,銀行尚未撥款(正常,不用處理)',
  unknown: '尚未查詢',
};

/** 直刷單:**永久**沒有請款狀態,而那與「還在查」完全不同(`#781` ①)。 */
export const CAPTURE_NO_CONCEPT_TEXT = '此付款方式無請款狀態';

/** 錢已請款、而這次嘗試已被放行重刷(`#781` ②)。**不是錯誤。** */
export const CAPTURE_NEEDS_MANUAL_TEXT = '需人工結案:錢已請款、而這次嘗試已被放行重刷';

/**
 * 這一格要顯示什麼。
 *
 * 判斷順序是**有意義的**,不是隨手排的:
 *   ① 直刷單 —— 它連「請款」這個概念都沒有,後面每一格都不適用
 *   ② 已放行/失敗卻已請款 —— 錢的狀態與嘗試的狀態互相矛盾,要人看一眼
 *   ③ 沒讀過 —— 沒有值可以講
 *   ④ 值太舊 —— 有值,但我們沒有把握它還成立 ⇒ **不下肯定句**
 *   ⑤ 值是新的 —— 照字面講
 *
 * 🔴 ④ 排在 ⑤ 之前是這支函式的**全部重點**。把它們對調,這一格就變成「永遠顯示已授權」。
 */
export function deriveCaptureDisplay(input: CaptureInput, now: Date): CaptureDisplay {
  // ① 直刷單:`#781` ① 明文要求**不得**顯示「查詢中/處理中/—」。
  if (!input.hasBankTxn) {
    return { kind: 'hidden', reason: 'no-capture-concept' };
  }

  // ② `#781` ②:錢已請款,而這次嘗試已被放行重刷。讀起來像資料錯,而它是真的。
  if (input.captureState === 'captured' && (input.status === 'released' || input.status === 'failed')) {
    return { kind: 'attention', text: CAPTURE_NEEDS_MANUAL_TEXT };
  }

  // ③ 從來沒有任何一條路查過它。
  if (input.captureState === 'unknown' || input.readAt === null) {
    return { kind: 'pending', text: CAPTURE_STATE_LABEL.unknown };
  }

  // ④ 🔴 新鮮度閘:值在,而它太舊 ⇒ 退回中性句,**不下肯定句**。
  if (now.getTime() - input.readAt.getTime() > CAPTURE_STALE_AFTER_MS) {
    return { kind: 'pending', text: CAPTURE_STATE_LABEL.unknown };
  }

  // ⑤ 值是新的,照字面講。
  return {
    kind: input.captureState === 'captured' ? 'settled' : 'pending',
    text: CAPTURE_STATE_LABEL[input.captureState],
  };
}
