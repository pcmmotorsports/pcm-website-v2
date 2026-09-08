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

/**
 * 短時點(#437 ②:精簡單行用 `08/11 02:10`)。
 *
 * 🔴 **刻意不帶年份**:單行是給「一眼掃過去」用的,年份在那個情境是雜訊。
 *    要看完整時點的人會點開,那裡有 `formatTaipei` 的完整字面 ⇒ 資訊沒有消失、只是分層。
 * 🔴 解析失敗同樣回 `null`,不 fallback —— 理由與 `formatTaipei` 同一條。
 */
export function formatTaipeiShort(iso: string): string | null {
  const full = formatTaipei(iso);
  if (full === null) return null;
  // full = `YYYY-MM-DD HH:mm` ⇒ 取 `MM/DD HH:mm`。從已驗過的字面切,不另開一組 Intl 設定
  // (兩組設定會各自漂;這裡多一份格式就是多一個要對齊的字面)。
  const [date, time] = full.split(' ');
  const parts = (date ?? '').split('-');
  const mo = parts[1];
  const d = parts[2];
  if (mo === undefined || d === undefined || time === undefined) return null;
  return `${mo}/${d} ${time}`;
}

/** 金額顯示。整數元 ⇒ 千分位 + 元;**沖銷列保留負號原樣**,不取絕對值。 */
export function formatAmount(amount: number): string {
  return `${amount.toLocaleString('zh-TW')} 元`;
}

/**
 * 精簡單行用的金額(#437 ②:Sean 逐字 `340元`,無空格)。
 *
 * ⚠️ 與 `formatAmount` **刻意不合併**:展開區沿用有空格那份,單行用這份 ——
 *    Sean 肉眼驗給的字面就是無空格,合併等於替他決定另一種。
 */
export function formatAmountCompact(amount: number): string {
  return `${amount.toLocaleString('zh-TW')}元`;
}

/**
 * 卡頂彙總三態(#437 ④;Sean 08-12 肉眼驗拍板,`Q-溢收=A` 只標不擋)。
 *
 * 🔴 `rows === null` = **讀不到**(`unreadable` / `order_not_found`)⇒ 回 `unknown`,
 *    **不得**拿 0 當已收去算 —— 那會在讀取失敗時畫出「還差 <全額> 元」,
 *    而員工看到的會是一句他無法分辨真假的催款訊息。同一條理由已經寫在
 *    `payment-list.tsx` 的「讀不到時不可顯示 0 筆」,這裡是它在金額面的同族。
 *
 * 🔴 **單位**:`orders` 金額與 `order_payments.amount` **都是整數元**(非分)——
 *    前者見 `order-list-view.ts:675` 逐字(migration `20260604120000`「金額一律 integer 元位」),
 *    後者見 `order_payments.amount` 欄 COMMENT 逐字「整數元、非零」⇒ 直接相減,零換算。
 *
 * 🔴 **只標不擋**:溢收在業務上是合法的(收兩筆定金、客人多匯),DB 的 G3 也只擋 <= 0、不擋超額
 *    (`20260810200000:168`)⇒ 這裡只負責讓它**看得見**,不做任何阻擋。
 */
export type PaymentSummary =
  | { kind: 'unknown' }
  | { kind: 'settled'; due: number; received: number }
  | { kind: 'short'; due: number; received: number; gap: number }
  | { kind: 'over'; due: number; received: number; excess: number };

/**
 * 三態分類 —— `toPaymentSummary` 與 `toReceivedNetSummary` **共用同一條算式**。
 *
 * 🔴 **抽出來的理由不是省行數,是「兩個口徑會漂」**:淨額那條路要重新分類一次
 *    (`settled` / `short` 由**淨額**決定,見 `toReceivedNetSummary`),各寫一份的話
 *    改了其中一邊,畫面上會出現「已收 600」配「已收足」—— 那正是本片在修的那個 bug。
 */
function classifyReceived(due: number, received: number): PaymentSummary {
  if (received === due) return { kind: 'settled', due, received };
  if (received < due) return { kind: 'short', due, received, gap: due - received };
  return { kind: 'over', due, received, excess: received - due };
}

export function toPaymentSummary(
  amountDue: number,
  rows: readonly OrderPaymentRow[] | null,
): PaymentSummary {
  if (rows === null) return { kind: 'unknown' };
  return classifyReceived(amountDue, sumReceived(rows));
}

/**
 * 帳本已退總額(**含尚未確定出款的 `processing`**)= `orders.total` − 帳本未登記額;算不出來回 `null`。
 *    🔴 **名字比它裝的東西窄, 而這裡把差額寫出來**(codex R3 must-fix):
 *    它**不等於**「已經確定移動出去的錢」—— 見下方「含發起中」那段。
 *
 * 🔴 **為什麼是相減、不是自己 SUM 兩張表**:`pcm_order_refundable_remaining` 的本體
 *    (最新代 `20260820100000:224-264`,`CREATE OR REPLACE FUNCTION` 到收尾 `$$;`)已經把三段全扣過
 *    —— `order_refunds`(`:237` 逐字 `status IN ('processing', 'confirmed')`)、更正成
 *    `money_moved` 的 failed 列、以及 `order_manual_refunds`(**含 `AND m.voided_at IS NULL`**
 *    ⇒ 已作廢的不算)。⇒ 不必自己查第二次。
 *    🛑 而自己 SUM 會被守門 `refund-remaining-single-source.test.ts` 的「TS 層自己聚合」
 *       那一格紅。⚠️ **而它的失敗訊息講的是【它自己那個受詞】, 不是本函式的**
 *       (codex R3 must-fix 更正我第一版的照抄):那句「報出的數比實際多 ⇒ 重複退款」說的是
 *       **可退款餘額**;漏算 `money_moved` 讓**已退款額偏少**、讓**可退餘額偏多**,
 *       而**偏多的那個才會導致重複退款**。📌 本函式只餵顯示, 不餵任何退款動作
 *       ⇒ **它算錯不會直接多退一次錢, 它會讓畫面上的已收偏高。**
 *
 * 🔴🔴 **而這【不是】純算術恆等式 —— 它是【跨兩個快照】的相減。**
 *    ⛔ ~~上一版逐字寫「相減是純算術恆等式」~~ **那半是推的**
 *       (code-reviewer 2026-09-08 must-fix;舊字面留刪除線, 讓照它推理的人同一發撞到訂正)。
 *    ✅ **而同一句的後半「零新查詢」仍然成立, 不要一起劃掉**(codex R3 must-fix:我作廢過頭)——
 *       改動前就已經在呼叫同一支 RPC, 本片只改了**等待順序**, 沒有多打一趟。
 *    🔬 兩個讀數來自**兩支不同的查詢**:`orderTotal` 來自 `findAdminOrderDetail`,
 *       而 RPC 內部用的是**它自己那一刻**的 `o.total`(`20260820100000:231` 逐字 `SELECT o.total::bigint`)。
 *    🛑 反例:頁面載入中另一個後台視窗改了品項金額、`orders.total` 由 1,200 調成 1,400
 *       ⇒ detail 讀到 1,200、RPC 用 1,400 ⇒ **已退算多、已收算少**;反過來(total 調降)
 *       ⇒ **已收比事實多**。⚠️ 而下面那格「已退為負 ⇒ null」**擋不到它**(算出來仍是正的)。
 *    ⚠️ 本片的讀取時序改動(`order-detail-route.tsx`)把這兩個讀數的時間差**加大了**。
 *    📌 **要真的關掉它, 需要讓 total 與未登記額【同一次讀出來】** —— 那超出本片範圍。
 *       🛑 **落板文字已交 `-ship`(`~/pcm-mailbox/落板文字-NETRECEIVEDLEFTOVERS…`), 而板上還沒有那個錨**
 *       ⛔ ~~「已落板列」~~(codex R3 must-fix:**那句是假的**, 我把「交出去了」寫成「落了」)。
 *
 * ⚠️ **「已退」含【發起中】** —— RPC 第一段扣的是 `processing` 與 `confirmed` 兩態。
 *    ⛔ ~~上一版寫「退款一按下去、錢還沒真的出去,『已收』就會掉」~~ **兩處不準**
 *       (codex R3 must-fix):① 按下去**不必然**建得出列;要**成功建出一列 `processing`**、
 *       而且**頁面重新讀過**, 已收才會掉。② `processing` **不等於**「錢還沒出去」——
 *       它也可能是**金流已經受理、只是本地 finalize 沒完成**。
 *    ✅ 準確講法:**一旦帳本上出現一列 `processing`, 下一次重讀這一頁, 已收就會少掉那一筆。**
 *    🔵 **它是一個新的畫面語意, 沒有人拍過** ⇒ 寫在這裡, 不要讓下一個人以為
 *       「已退」只算錢真的出去的那些。
 *
 * 🔴 **這個數只涵蓋【我們記過的退款】, 而它【沒有固定方向】** —— 兩邊都要寫
 *    (codex R3 must-fix 打掉我原本那句單向的話):
 *    ⛔ ~~「真實已退 ≥ 本函式回的值 ⇒ 淨額 ≥ 真實淨額 ⇒ 會讓人以為錢比實際多」~~ **不保證**。
 *    🔽 **偏低的那一側**:Sean 直接在 TapPay Portal 退的錢不在帳本裡
 *       (措辭鐵律逐字在 `lib/payment/refund-ledger-view.ts` 檔頭)⇒ 已退算少 ⇒ **已收偏高**。
 *    🔼 **偏高的那一側**:`processing` 那些**還沒確定出款** ⇒ 已退算多 ⇒ **已收偏低**。
 *    📌 ⇒ **兩個方向都可能, 不要拿它當任何一邊的保證。**
 *
 * 🔴 **三格 fail-closed,全部回 `null`(⇒ 顯示端印「未知」,不印一個數字)**:
 *    ① `unregisteredFailed` ⇒ 讀取失敗。既有語意見 `order-detail.tsx` 搜 `fail-closed`。
 *    ② `unregisteredAmount == null` ⇒ 查無訂單(`getLedgerUnregisteredAmount` 的函式語意)。
 *    ③ 🔴 **算出來是負的** ⇒ 那代表未登記額 > 訂單總額,是一個**不該存在**的狀態。
 *       不擋的話它會**加大**已收(`received − 負數`)⇒ 往「已收比事實多」那個方向再推一次。
 *       ⚠️ 這一格**沒有實例**,是照方向擋的;真撞到它畫面會印「未知」而不是一個更好看的數字。
 */
export function refundedTotalFromUnregistered(
  orderTotal: number,
  unregisteredAmount: number | null | undefined,
  unregisteredFailed: boolean | undefined,
): number | null {
  if (unregisteredFailed === true) return null;
  if (unregisteredAmount === null || unregisteredAmount === undefined) return null;
  const refunded = orderTotal - unregisteredAmount;
  return refunded < 0 ? null : refunded;
}

/**
 * 「已收」扣掉退款之後的**淨額**摘要 —— Sean 2026-09-08 拍【乙】
 * (memory `project_0908-received-shows-net-after-refund`;他親眼在畫面上看到的)。
 *
 * 🔴 **不只換數字,`kind` 也要跟著重算** —— 這就是本片在修的 bug(X5F8WG ④):
 *    「已收足」是 `kind === 'settled'` 印的(`payment-list.tsx` 搜 `已收足`),而 `kind`
 *    原本由**未扣退款的** received 算 ⇒ 一張「收 600、退 600」的單會同時畫出
 *    **「已收 0」與「已收足」**。同理 `short` 的「還差 X」也會是舊口徑。
 *
 * 🔴🔴 **副作用:一張全額退款的單, 畫面會說「還差 <全額>」—— 而【沒有人拍過那句話】。**
 *    (code-reviewer 2026-09-08 must-fix:它是本片產生的**第三個**畫面陳述, 不在 Sean 的
 *     「已收顯示淨額」也不在主視窗的「已收足不得與已收 0 並存」的射程裡。)
 *    ⚠️ **下面這個形狀是【碼上推得】的, 不是量到的**(codex R3 must-fix):
 *       算式與元件分支我逐條核過, 而**沒有任何一格 fixture 同時設成「已取消 + 已退款」**
 *       ⇒ 「chip 同時是已退款」那半**沒有被渲染出來看過**。
 *    🔬 形狀:付 1,200 → 取消 → 全額退 1,200 ⇒ 淨額 0, 而 `due` 仍是 `orders.total`
 *       (取消**不會**把 `orders.total` 歸零)⇒ `kind='short'` / `gap=1200`
 *       ⇒ 頭條印「尾款 1,200」(還是強調色)、付款卡印「還差 1,200 元」,
 *       而標頭的付款狀態 chip 同時是「已退款」。
 *    🛑 **改前是「尾款 0 / 已收足」, 改後是「還差 1,200」—— 兩個都不對, 而錯法不同。**
 *    📌 **本片【不自己選一個】** —— 那要 Sean 拍(選項大致是:①`due` 對已取消單歸零
 *       ②已取消單不印尾款/還差 ③維持現況;codex R3 補一個明顯的第四案:
 *       ④保留原總額而換一組專屬字面, 不再叫「尾款/還差」)。
 *       **已端上去**;⛔ ~~已落板列~~ ⇒ ✅ **落板文字已交 `-ship`, 板上尚未有該錨**。
 *       ⇒ 📌 `refund-wiring.test.tsx` 把「還差 1,200」釘成期望值, **那是釘住【現況】,
 *          不是宣稱它對** —— 拍板下來要改的就是那一格。
 *
 * ⚠️ **射程**:只給【顯示「已收」的那兩處】(頭條 `order-focal-row` / 付款卡 `payment-list`)。
 *    出貨區那兩處(`shipment-section` / `lib/shipping/shipment-balance-warning`)語意是
 *    **「還欠多少」**,吃的是未扣退款的 `toPaymentSummary`,**本片一個字都不動**
 *    —— 那超出 Sean 的拍板範圍,而它會安靜地生效。
 */
export function toReceivedNetSummary(
  summary: PaymentSummary,
  refundedTotal: number | null,
): PaymentSummary {
  if (summary.kind === 'unknown') return summary;
  if (refundedTotal === null) return { kind: 'unknown' };
  return classifyReceived(summary.due, summary.received - refundedTotal);
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
  /** 精簡單行用的短時點(#437 ②);無法判讀時為 `null`,由呼叫端兜字。 */
  receivedAtShort: string | null;
  /** 精簡單行用的金額(無空格,Sean 逐字)。 */
  amountLabelCompact: string;
  /** 憑證:匯款單號或卡片交易序號,兩個都沒有時為 `null`。 */
  referenceLabel: string | null;
  payerNote: string | null;
  isReversal: boolean;
  reversalReason: string | null;
  /**
   * **這一列已經被別的列沖銷掉了**(#372-A12)。
   * 🔴 與 `isReversal` 方向相反,別混:`isReversal` = 我**是**一列沖銷紀錄;
   *    `isReversed` = 我**被**沖銷了。同一列兩者可以同時為真(沖銷之沖銷)。
   */
  isReversed: boolean;
  /**
   * **這一列的形狀准不准沖銷**(#372-A12)。
   *
   * 🔴 名字刻意帶 `ByRow`:它只答「列層准不准」,**答不了「這次呼叫會不會成功」**——
   *    G1 隔離閘(`20260812150000:366-368`,P8C01)、G2 actor 失效(`:371-376`,P2B42)、
   *    無 EXECUTE 權限(42501)都會在同一列上把一次合法呼叫打掉。
   *    叫 `canReverse` 就是宣稱了它證明不了的事。
   */
  canReverseByRow: boolean;
};

/**
 * 「哪些列已經被沖掉了」——一次掃出來,不要每列各掃一遍。
 *
 * 🔴 判準是 `reversesPaymentId` 這個**具名欄位**,不是金額正負:
 *    沖銷之沖銷的金額可以是正的(同本檔 :28-32 已經立過的那條)。
 */
export function reversedPaymentIds(rows: readonly OrderPaymentRow[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.reversesPaymentId !== null) ids.add(r.reversesPaymentId);
  }
  return ids;
}

/**
 * @param reversedIds `reversedPaymentIds(rows)` 的結果。
 *   🔴 **必填,不給預設值**:預設空集合的話,呼叫端忘了傳 = 每一列都被算成「還沒被沖」
 *   ⇒ 已沖銷的列會再長出一顆沖銷鈕,而 UI 層完全沒有訊號(DB 的 G8 才會擋)。
 *   讓它在型別層就必須傳,忘記=編譯不過。
 */
export function toPaymentListEntry(
  row: OrderPaymentRow,
  reversedIds: ReadonlySet<string>,
): PaymentListEntry {
  const isReversed = reversedIds.has(row.id);
  return {
    isReversed,
    // 🔴 兩個條件都是 RPC 會硬拒的(卡軌 `:407-410` / 已被沖銷 `:414-422`)⇒ 這裡先擋是體驗層,
    //    真正擋住的是 DB。**刻意不看 `isReversal`**:沖銷列本身仍可沖
    //    (誤沖的更正方式就是沖銷之沖銷,Sean 2026-08-10 拍板)。
    canReverseByRow: row.rail !== 'card' && !isReversed,
    id: row.id,
    railLabel: railLabel(row.rail),
    amountLabel: formatAmount(row.amount),
    receivedAtDisplay: formatTaipei(row.receivedAt),
    createdAtDisplay: formatTaipei(row.createdAt),
    actorLabel: actorLabel(row.actor),
    receivedAtShort: formatTaipeiShort(row.receivedAt),
    amountLabelCompact: formatAmountCompact(row.amount),
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
 * ⚠️ ~~本片(§8 主視窗裁 A)不顯示這個數字 —— 畫面上要不要出現是第二段的事。~~
 *    **#437 起已經顯示了**(卡頂彙總行的「已收 Y」與三態都由 `toPaymentSummary` 走這支算)。
 *    那句話寫的是 B2-a 當下的事實,第二段就是這片 ⇒ 同批更新,不留過期字面。
 */
export function sumReceived(rows: readonly OrderPaymentRow[]): number {
  return rows.reduce((acc, r) => acc + r.amount, 0);
}
