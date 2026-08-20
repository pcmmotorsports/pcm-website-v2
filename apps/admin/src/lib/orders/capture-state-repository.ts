import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { CaptureInput, CaptureState, ChargeAttemptStatus } from './capture-state-view';

// capture-state-repository.ts — 把「這張單的刷卡授權現在是什麼狀態」讀出來(W4-Q 第二半)
//
// 🔴 **本檔【刻意】拆成兩層,而那不是潔癖,是為了一個還沒有答案的問題**:
//    plan `W4-030` 驗收 ☐6 到落筆這一刻**仍未實測** —— 「後台的 service_role 讀不讀得到
//    `payment_charge_attempts`」。我從 `20260612150000:120-121` 的 `GRANT SELECT` 推斷它可以,
//    **而那是讀出來的,不是量到的**(那一發已寫成 `~/pcm-mailbox/W4-037`,等 Sean 在場跑)。
//    ⇒ 若實測不成立 ⇒ 要改走新 RPC ⇒ **鐵則 12③ 命中、片型跳一級、重提 plan**。
//    ⇒ ⇒ 所以:
//      · `parseCaptureRow`(下半)**兩條路都要用** —— 不論資料從表來還是從 RPC 來,形狀驗證一樣
//      · `getOrderCaptureState`(上半)**只有「直接讀表」那條路要用**
//    **拆開之後,☐6 若失敗,要丟掉的只有上半。**
//
// ── 🔴🔴 **本模組在 `☐5` 未達成的情況下就進版了 —— 這不是漏掉,是閘搬家了** ──────────
//   plan `W4-030` 原本寫:「☐5(要貼得出一筆 `capture_state` 真的從 authorized 變成 captured
//   的實測輸出)貼不出來 ⇒ **不 commit**」。
//   ⇒ 而 ☐5 擋的是「**這一格顯示出來的值可不可信**」,**而本檔不渲染任何東西** ——
//     它解析、驗形狀、讀一列。**把一個防止畫面說謊的閘套在一支不畫畫面的檔上,是把它用寬了。**
//   ⇒ 🔴 而用寬的閘會付出兩種代價:①擋住不該擋的 ②**讓人學會鬆它,而鬆的那一次可能是對的那一次**。
//
//   ⇒ ⇒ **所以 ☐5 沒有取消,它搬到【顯示片】去,而且變嚴**:
//   ```
//   舊:☐5 貼不出來 ⇒ 這一片不 commit          ← 需要有人記得
//   新:☐5 貼不出來 ⇒ 那一格【不准渲染成肯定句】 ← **不需要任何人記得**
//       而它不是承諾,是 `capture-state-view.ts` 已經寫好的那道新鮮度閘:
//       `now() - capture_state_read_at > CAPTURE_STALE_AFTER_MS` ⇒ 改印「尚未查詢」
//       ⇒ 重讀那條路沒開 ⇒ read_at 停在授權那一刻 ⇒ 年齡無上限地長 ⇒ **自動閉嘴**
//   ```
//
//   ### 🔴 **給【接上畫面的那個人】(就是你,如果你正在把這支接到訂單明細)**
//   **在你貼得出一筆 `capture_state` 真的變過的實測輸出之前,那一格只能印「尚未查詢」,不准印肯定句。**
//   那一發 SQL 在 plan `W4-030` §1;而新鮮度閘會替你擋住 —— **但不要因此就把它拆掉。**
//
// ── 🔴 為什麼查詢限定在三個 status,而且只取一列 ─────────────────────────────
//   `payment_charge_attempts_order_lock_idx` 是 **UNIQUE 部分索引**,而它的述詞在
//   `20260624120000:61-64` 被加寬過 ⇒ 現行是 `WHERE status IN ('pending','charged','released')`
//   ⇒ **那三態【合計】每張單至多一列**(DB 保證,不是慣例)。
//   ⚠️ 而 `failed` **不在索引裡** ⇒ 同一張單可以有很多筆 failed(重試的歷史)。
//   ⇒ 顯示層要的是「**現在這一筆**」,不是歷史 ⇒ 查詢刻意排除 failed。
//   🔴 **而這代表一件事要講清楚**:`#781` ② 那個情境(`status ∈ {released,failed}` 且已請款)
//      本查詢**只看得到 released 那一半**。failed 的那一半要另一條查詢,而**本片不做**
//      —— 因為 failed 可以有很多筆,「要顯示哪一筆」是一個還沒有人回答的問題。
//      ⇒ 不要把本檔讀成「`#781` ② 已經完整覆蓋」。

/** 讀取失敗(權限 / 連線 / 形狀不符)。**這不是「這張單沒有刷卡紀錄」。** */
export class CaptureStateShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureStateShapeError';
  }
}

const CAPTURE_STATES: readonly string[] = ['authorized', 'captured', 'unknown'];
const ATTEMPT_STATUSES: readonly string[] = ['pending', 'charged', 'failed', 'released'];

/**
 * 逐欄驗形狀,**不得寬容**。
 *
 * 🔴 少一個欄位 / 值不在值域 ⇒ **拋**,由呼叫端顯示「讀取失敗」。
 *    靜默補預設值會讓「讀錯」長得跟「真的是 unknown」一模一樣 —— 而那兩者對值班的意思完全不同
 *    (前者要去看我們自己的程式,後者要去等銀行)。
 *
 * 🔴 **值域在這裡再驗一次,而 DB 已經有 CHECK 了** —— 那不是重複:
 *    DB 的 CHECK 管的是「寫進去的東西」,這裡管的是「**讀回來的東西真的是那張表**」。
 *    哪天有人把這個查詢指到別的來源(view / RPC / mock),**這一格是唯一會紅的地方**。
 */
export function parseCaptureRow(raw: unknown): CaptureInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CaptureStateShapeError('payment_charge_attempts:回來的不是物件');
  }
  const r = raw as Record<string, unknown>;

  const captureState = r.capture_state;
  if (typeof captureState !== 'string' || !CAPTURE_STATES.includes(captureState)) {
    throw new CaptureStateShapeError(
      `payment_charge_attempts:capture_state 不在值域(收到 ${JSON.stringify(captureState)})`,
    );
  }

  const status = r.status;
  if (typeof status !== 'string' || !ATTEMPT_STATUSES.includes(status)) {
    throw new CaptureStateShapeError(
      `payment_charge_attempts:status 不在值域(收到 ${JSON.stringify(status)})`,
    );
  }

  // 🔴 `null` 與 `undefined` 分開處理:前者是「欄位在、值是 NULL」,後者是「**鍵根本不存在**」
  //    ⇒ 後者代表欄位被改名或沒回來 ⇒ 拋。收斂成 null 的話,哪天欄位改名,
  //      每一筆都會靜默畫成「尚未查詢」而**全綠**。
  const readAtRaw = r.capture_state_read_at;
  if (readAtRaw === undefined) {
    throw new CaptureStateShapeError('payment_charge_attempts:缺 capture_state_read_at 這個鍵');
  }
  let readAt: Date | null = null;
  if (readAtRaw !== null) {
    if (typeof readAtRaw !== 'string') {
      throw new CaptureStateShapeError('payment_charge_attempts:capture_state_read_at 不是字串或 null');
    }
    const d = new Date(readAtRaw);
    if (Number.isNaN(d.getTime())) {
      throw new CaptureStateShapeError(
        `payment_charge_attempts:capture_state_read_at 不是合法時間(${readAtRaw})`,
      );
    }
    readAt = d;
  }

  const bankTxnRaw = r.bank_transaction_id;
  if (bankTxnRaw === undefined) {
    throw new CaptureStateShapeError('payment_charge_attempts:缺 bank_transaction_id 這個鍵');
  }
  if (bankTxnRaw !== null && typeof bankTxnRaw !== 'string') {
    throw new CaptureStateShapeError('payment_charge_attempts:bank_transaction_id 不是字串或 null');
  }

  // 🔴 成對約束在 DB 那邊已經有(`20260820040000:77-80`:state 不是 unknown ⟺ read_at 非 NULL),
  //    而這裡**不重驗它** —— 重驗會讓「DB 的約束壞了」與「我讀錯來源了」變成同一個錯誤訊息。
  //    ⇒ 顯示層(`deriveCaptureDisplay`)對 `readAt === null` 已經有明確處理,不靠這裡擋。
  return {
    captureState: captureState as CaptureState,
    readAt,
    status: status as ChargeAttemptStatus,
    hasBankTxn: bankTxnRaw !== null,
  };
}

/**
 * 讀這張單「現在那一筆」刷卡授權。
 *
 * 🔴 **三個回傳意義不同,呼叫端必須分開處理**(形狀照 `payment-repository.listOrderPayments`):
 *   · `null`  = 這張單**沒有** active 的刷卡授權(現金單、或刷卡失敗後沒有重試成功的);
 *   · 物件    = 有一筆,值已驗過形狀;
 *   · `throw` = **沒讀到**(權限 / 連線 / 形狀不符)—— 這**不是**「沒有刷卡」。
 *
 * 三者若被畫成同一格空白,員工會把「我們讀不到」看成「這張單沒刷卡」。
 *
 * ⚠️ **本函式依賴 ☐6(service_role 對該表的 SELECT),而 ☐6 到落筆這一刻未實測。**
 *    若它回權限錯誤(42501)⇒ 那不是 bug,是 ☐6 不成立 ⇒ 見本檔頭。
 */
export async function getOrderCaptureState(orderId: string): Promise<CaptureInput | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('payment_charge_attempts')
    .select('capture_state, capture_state_read_at, status, bank_transaction_id')
    .eq('order_id', orderId)
    // 見檔頭:這三態合計每張單至多一列(UNIQUE 部分索引保證);failed 刻意排除。
    .in('status', ['pending', 'charged', 'released'])
    .maybeSingle();

  if (error) {
    throw new CaptureStateShapeError(
      `payment_charge_attempts 讀取失敗(${String(error.code ?? 'no-code')}):${String(
        error.message ?? '',
      ).slice(0, 200)}`,
    );
  }
  if (data === null) return null;
  return parseCaptureRow(data);
}
