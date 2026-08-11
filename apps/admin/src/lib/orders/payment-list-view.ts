// payment-list-view.ts — M-4b E10 #15-B2-a:收款列表的**語意層**(純函式、零 I/O)。
//
// 分工同 A10a(`note-timeline.ts` + `notes-timeline.tsx`):語意計算全在本檔、元件只排版。
// 突變靶釘在本檔。
//
// 🔴 **文案為暫定稿**,待 Sean 肉眼驗後定案(鎖結構不鎖字)。
//    ⚠️ 定案時要處理一件事:`ACTOR_LABELS` 是**第二份**字面 ——
//    同一個身分在 `public.staff.label` 已經有一份(`20260811050000:75-76` 逐字
//    `('op4_backfill', 'OP4 歷史回填(系統)')`,與下面這份措辭本來就不同)。
//    兩份會漂,而且漂了沒有任何守門會叫。**定案時二選一**:對齊字面,
//    或改讓 RPC 直接回 `staff.label`(來源唯一,本檔這張表就整個刪掉)。

/** RPC `admin_list_order_payments` 一列的形狀(B1 `20260811090000` 的 12 個鍵)。 */
export type OrderPaymentRow = {
  id: string;
  rail: string;
  /** 🔴 **整數元**(`order_payments.amount` 欄 COMMENT 逐字:「整數元、非零」)⇒ 全程零換算。 */
  amount: number;
  receivedAt: string;
  createdAt: string;
  actor: string;
  bankReference: string | null;
  recTradeId: string | null;
  payerNote: string | null;
  reversesPaymentId: string | null;
  reversalReason: string | null;
  /**
   * 🔴 **判斷沖銷只准看這一格,不准看金額正負**:
   * 「沖銷之沖銷」的金額可以是正的(`20260810100000` 檔頭逐字:500−500+500=500)
   * ⇒ 看正負會把一筆沖銷畫成收款。
   */
  isReversal: boolean;
};

/**
 * 軌別對照。
 *
 * 🔴 **必須涵蓋 `card`** —— 正式站現況 6 列**全部**是 card(2026-08-11 實查),
 *    而手動收款表單明文拒收 card(RPC `20260810200000:162-166`)
 *    ⇒ 「本表單做不出來的軌」照樣會出現在列表裡。漏了它 = 全部畫成空白。
 */
const RAIL_LABELS: Record<string, string> = {
  card: '信用卡',
  bank_transfer: '銀行匯款',
  cash: '現金',
};

/**
 * 登錄者對照。
 *
 * 🔴 `actor` 欄裡**住著機器身分**(欄 COMMENT 逐字):
 *    `op4_backfill` = OP4 歷史回填、`payment_confirmer` = OP3 卡軌自動落帳、其餘為真人。
 *    直接把代號印給員工看 = 給他一個看不懂的內部字串。
 */
const ACTOR_LABELS: Record<string, string> = {
  op4_backfill: '系統回填(歷史資料)',
  payment_confirmer: '刷卡自動入帳',
};

/**
 * 查表,查不到就**誠實回原值**。
 *
 * 🔴 兩件事都不能做:
 *  ① 不得回空字串 —— 空白會被讀成「沒有這個資訊」,而事實是「有,只是我們沒有對照」。
 *  ② 必須用 `Object.hasOwn` —— `obj[使用者資料]` 會取到原型鏈屬性(`constructor`/`toString`…)
 *    且 truthy,畫出一坨看不懂的東西(memory `js-index-lookup-hits-prototype-chain`,本 repo 中過 6 頁)。
 */
export function labelOrRaw(table: Record<string, string>, key: string): string {
  // 🔴 **兩道都要,而且不可互相取代**:
  //  · `Object.hasOwn` 擋原型鏈 —— 少了它,`key='constructor'` 會取到一個**函式**;
  //    那不是 `undefined`,所以下面的 `??` **接不住**,會把一坨東西畫到畫面上。
  //  · `?? key` 是型別層需要(`noUncheckedIndexedAccess` 下索引取值是 `string | undefined`,
  //    TS 不會因為 `hasOwn` 就收斂),同時也是執行期的最後一道。
  if (!Object.hasOwn(table, key)) return key;
  return table[key] ?? key;
}

export const railLabel = (rail: string): string => labelOrRaw(RAIL_LABELS, rail);
export const actorLabel = (actor: string): string => labelOrRaw(ACTOR_LABELS, actor);

/**
 * 時間顯示(固定 Asia/Taipei)。
 *
 * 🔴 **不得直接印 RPC 回來的字串**:`timestamptz` 進 jsonb 的字面**受 session `TimeZone` 影響**
 *    ⇒ 同一個時點在不同連線下的字面可能不同(關卡2 nit)。這裡一律自己格式化。
 * 🔴 解析失敗回 `null` ⇒ 由呼叫端顯示「時間無法判讀」,**不要 fallback 成今天**
 *    (那會讓一筆壞資料看起來像剛剛才收的款)。
 */
export function formatTaipei(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(t));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const h = get('hour');
  const mi = get('minute');
  if (y === '' || mo === '' || d === '' || h === '' || mi === '') return null;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/** 金額顯示。整數元 ⇒ 千分位 + 元;**沖銷列保留負號原樣**,不取絕對值。 */
export function formatAmount(amount: number): string {
  return `${amount.toLocaleString('zh-TW')} 元`;
}

export type PaymentListEntry = {
  id: string;
  railLabel: string;
  amountLabel: string;
  /** 收到錢的時點(對帳看這欄,欄 COMMENT 逐字);無法判讀時為 `null`。 */
  receivedAtDisplay: string | null;
  /** 登錄進系統的時點 —— 與 `receivedAt` **意義不同,不可混用**。 */
  createdAtDisplay: string | null;
  actorLabel: string;
  /** 憑證:匯款單號或卡片交易序號,兩個都沒有時為 `null`。 */
  referenceLabel: string | null;
  payerNote: string | null;
  isReversal: boolean;
  reversalReason: string | null;
};

export function toPaymentListEntry(row: OrderPaymentRow): PaymentListEntry {
  return {
    id: row.id,
    railLabel: railLabel(row.rail),
    amountLabel: formatAmount(row.amount),
    receivedAtDisplay: formatTaipei(row.receivedAt),
    createdAtDisplay: formatTaipei(row.createdAt),
    actorLabel: actorLabel(row.actor),
    // 匯款軌看單號、卡軌看交易序號;兩個都空 = 這筆沒有可對的憑證(誠實回 null,不編一個)。
    referenceLabel: row.bankReference ?? row.recTradeId ?? null,
    payerNote: row.payerNote,
    isReversal: row.isReversal,
    reversalReason: row.reversalReason,
  };
}

/**
 * 已收合計。
 *
 * 🔴 **`SUM(amount)` 就是「已收」** —— 沖銷列是被沖列金額的反號,直接加總即可
 *    (`order_payments.amount` 欄 COMMENT 逐字:「⇒『已收』= SUM(amount)」)。
 *    **不要**把沖銷列濾掉再加,那會把被沖掉的那筆重複算進去。
 *
 * ⚠️ 本片(§8 主視窗裁 A)**不顯示**這個數字 —— 這支只給測試與 B2-b 用,
 *    畫面上要不要出現是第二段的事。留在這裡是因為它是**語意**,不是排版。
 */
export function sumReceived(rows: readonly OrderPaymentRow[]): number {
  return rows.reduce((acc, r) => acc + r.amount, 0);
}
