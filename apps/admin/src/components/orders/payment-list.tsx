import {
  formatAmount,
  reversedPaymentIds,
  toPaymentListEntry,
  toPaymentSummary,
  toReceivedNetSummary,
  type OrderPaymentRow,
  type PaymentSummary,
} from '../../lib/orders/payment-list-view';
import { PaymentReverseButton } from './payment-reverse-button';

// payment-list.tsx — M-4b E10 #15-B2-a:訂單收款列表(server-render、唯讀)。
// 語意全在 `lib/orders/payment-list-view.ts`,本檔只排版(同 A10a 的 notes-timeline 分工)。
//
// 🔴 **文案為暫定稿**,待 Sean 肉眼驗後定案(鎖結構不鎖字)。
// 本片(§8 主視窗裁 A)**只做「列出來」**:不算已收小計、不顯示結清狀態、不做沖銷入口。

/**
 * 三態必須分開畫。
 *
 * 🔴 `unreadable` 那格**排在最前面**,理由與 #328 逐字同款:
 *    「讀取失敗」與「真的沒有收款」的輸入**長得一模一樣**(都是沒有列可畫)——
 *    順序寫反就等於把讀取失敗顯示成「這單沒收過錢」,而員工會照著再登一次 ⇒ **重複入帳**。
 */
export type PaymentListData =
  | { status: 'ok'; rows: readonly OrderPaymentRow[] }
  /** RPC 回 SQL NULL = 這張訂單不存在(不是「沒有收款」)。 */
  | { status: 'order_not_found' }
  /** 讀取失敗:權限 / 連線 / 形狀不符。**不知道有沒有**,不是「沒有」。 */
  | { status: 'unreadable' };

/**
 * 一筆收款 = **精簡單行 + 點開才看得到的細節**(#437 ②,Sean 肉眼驗拍板)。
 *
 * 🔴 收合用原生 `<details>/<summary>`,不自己做狀態:鍵盤可及、螢幕閱讀器認得、
 *    server 元件零 JS —— 這族需求正是原生元素本來就在做的事。
 * 🔴 **單行上保留的三件**:軌別、時點、金額 —— 少了任何一件,員工要對帳就得逐筆點開,
 *    那等於把「精簡」做成「藏起來」。
 * 🔴 **沖銷徽章留在單行上**(不收進細節):沖銷列的金額是負數,
 *    看到 `-340元` 卻沒有任何標記時,最省力的解讀是「畫錯了」。
 */
function Row({
  row,
  reversedIds,
  orderId,
  returnTo,
}: {
  row: OrderPaymentRow;
  reversedIds: ReadonlySet<string>;
  orderId: string;
  returnTo: string;
}) {
  const e = toPaymentListEntry(row, reversedIds);
  return (
    <li className='border-t text-sm first:border-t-0'>
      <details className='group'>
        <summary className='flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 py-3 marker:text-xs'>
          <span className='bg-muted text-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium'>
            {e.railLabel}
          </span>
          {/* 🔴 沖銷只認具名旗標,不看金額正負(沖銷之沖銷可為正額)。 */}
          {e.isReversal && (
            <span className='bg-destructive/10 text-destructive inline-flex rounded-full px-2 py-0.5 text-xs font-medium'>
              沖銷更正
            </span>
          )}
          {/* 🔴 「已沖銷」要看得見(#372-A12 留痕):沒有標記的話,員工分不出
              「這筆還在」與「這筆已經被沖掉、下面那列負數就是它的沖銷紀錄」。 */}
          {e.isReversed && (
            <span className='bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium'>
              已沖銷
            </span>
          )}
          {/* 對帳看 received_at(欄 COMMENT 逐字);登錄時點收進細節區,兩者不可混用。 */}
          <span className='text-muted-foreground text-xs'>
            {e.receivedAtShort ?? '(時間無法判讀)'}
          </span>
          {/* 金額保留正負號原樣:沖銷列的負號本身就是資訊。 */}
          <span className='ml-auto font-medium tabular-nums'>{e.amountLabelCompact}</span>
        </summary>

        <div className='text-muted-foreground space-y-1 pb-3 pl-4 text-xs'>
          <p>收款於 {e.receivedAtDisplay ?? '(時間無法判讀)'}</p>
          <p>
            {e.actorLabel} 登錄於 {e.createdAtDisplay ?? '(時間無法判讀)'}
          </p>
          {e.referenceLabel !== null && <p>憑證 {e.referenceLabel}</p>}
          {e.reversalReason !== null && <p className='break-words'>沖銷原因:{e.reversalReason}</p>}
          {e.payerNote !== null && (
            <p className='text-foreground whitespace-pre-wrap break-words'>{e.payerNote}</p>
          )}

          {/* 🔴 card 列沒有鈕,但**不能零解釋**:正式站的歷史收款列是 card 佔多數
              (`payment-list-view.ts:38-40` 記著 2026-08-11 實查 6 列全是 card)⇒
              一個「別人有、我這列沒有」的空白會被讀成壞了。 */}
          {row.rail === 'card' && <p>刷卡收款的更正走 TapPay 退款,不在這裡沖銷。</p>}

          {e.canReverseByRow && (
            <PaymentReverseButton
              paymentId={row.id}
              orderId={orderId}
              returnTo={returnTo}
              isReversal={e.isReversal}
            />
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * 卡頂彙總行(#437 ④)。
 *
 * 🔴 `unknown` 那格**不畫任何金額** —— 讀不到明細時算出來的「已收」必然是假的,
 *    而它會被畫成一句員工無法分辨真假的催款訊息(「還差 <全額> 元」)。
 *    與下面「讀不到時不可顯示 0 筆」是同一條規則的金額版。
 * 🔴 溢收**只標不擋**(Sean `Q-溢收=A`):收兩筆定金、客人多匯都是合法情境,
 *    DB 的 G3 也只擋 <= 0、不擋超額。這裡的職責到「看得見」為止。
 *
 * 🔴🔴 **2026-09-05 Sean 拍 `Q-多匯 = 乙`(逐字)**:
 *    他看到的選項字面 = `甲 = 自動已付款 + 多付開待退款 / 乙 = 狀態不動只標「多付, 待人工」`
 *    ⇒ 他選【乙】⇒ **payment_status 不翻, 而單上要標「待人工」。**
 *    📎 `~/pcm-mailbox/Sean拍板-20260905.md:128`(引用抄題目文字, 不抄摘要)
 * 🛑 **而我【加】不【換】** —— 「溢收 N 元」那個字串是他 **2026-08-12 肉眼驗拍板**的
 *    (`Q-溢收=A`, 同一份紀錄還逐字寫著「❌ 不要照 OD 補溢收處理下拉」)。
 *    ⇒ 📌 **兩板相容:舊的說【多少錢】, 新的說【要人處理】。換掉舊字面等於推翻一個他驗過的東西。**
 * ⚠️ 而「待人工」三個字**照他看到的選項字面**, 不是「待人工處理」——
 *    那兩個字是我在轉述時加的, 已訂正(板列與 memory 留刪除線)。
 */
/**
 * 🔴🔴 **`cancelled` 只關掉「還差 X 元」那一顆**(Sean 2026-09-08 拍【乙】,
 *    經主視窗 A 轉;完整理由與「兩個都不對而錯法不同」寫在 `order-focal-row.tsx` 的同一格旁邊)。
 * 🛑 **它不動任何金額** —— `summary.due` / `received` / `gap` 一個字都沒變,
 *    只是不把 `gap` 畫出來。⇒ 要是哪天發現「不動金額做不到」, 那是停下來回報的訊號。
 * 🔵 **「已收足」與「溢收」刻意不藏** —— 拍板逐字只點名「尾款」與「還差 X 元」兩格。
 *    📌 而一張已取消且全額退款的單, 淨額 0 ⇒ `kind='short'` ⇒ 它本來就走「還差」那條
 *    ⇒ 藏掉之後那一格什麼都不印, **不會冒出一句「已收足」**。
 *    🔬 這句釘在 `app/orders/[id]/refund-wiring.test.tsx`(真渲染), 不是靠這段註解成立。
 */
/**
 * ⟦Q1 甲⟧(Sean 2026-09-16)「取消完顯示『多收 5,080 待退』，退完顯示『已收足』，另外加一行『待退款 X 元（已開，尚未退）』」:
 *   · `cancelAdjusted` = 應收因取消而變少 ⇒ 多收的那段是取消造成的 ⇒ 印「多收 X 待退」,不印「溢收 / 多付, 待人工」
 *     (那兩個是客人多匯的拍板,Sean 09-05)。
 *   · `nothingCollected` = 一毛都沒收過 ⇒ 整單取消的未付單應收 0 / 已收 0,不印「已收足」(沒有東西被收足)。
 */
function SummaryLine({
  summary,
  cancelled,
  cancelAdjusted,
  nothingCollected,
}: {
  summary: PaymentSummary;
  cancelled: boolean;
  cancelAdjusted: boolean;
  nothingCollected: boolean;
}) {
  if (summary.kind === 'unknown') {
    return (
      <p className='text-muted-foreground mb-3 text-xs'>
        已收金額<strong>未知</strong>(收款或退款明細沒載入)—— 不是「還沒收到錢」。
      </p>
    );
  }
  return (
    <p className='mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs'>
      <span className='text-muted-foreground tabular-nums'>
        應收 {formatAmount(summary.due)} / 已收 {formatAmount(summary.received)}
      </span>
      {summary.kind === 'settled' && !nothingCollected && (
        <span className='inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800'>
          已收足
        </span>
      )}
      {summary.kind === 'short' && !cancelled && (
        <span className='text-foreground font-medium tabular-nums'>
          還差 {formatAmount(summary.gap)}
        </span>
      )}
      {summary.kind === 'over' && cancelAdjusted && (
        <span className='text-destructive font-medium tabular-nums'>
          多收 {summary.excess.toLocaleString('zh-TW')} 待退
        </span>
      )}
      {summary.kind === 'over' && !cancelAdjusted && (
        <>
          <span className='text-destructive font-medium tabular-nums'>
            溢收 {formatAmount(summary.excess)}
          </span>
          {/* 🔴 Sean 2026-09-05 `Q-多匯 = 乙`:狀態不翻, 而單上要標「待人工」。
              🔵 與左邊那格分開一個 <span> —— 它們是兩個不同的事實
              (多少錢 / 誰要處理), 而合成一句話會讓下一個人以為只有一個拍板。 */}
          <span className='inline-flex rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900'>
            多付, 待人工
          </span>
        </>
      )}
    </p>
  );
}

/**
 * @param children 片2a 起:登錄表單塞進**同一張卡**的下半(Sean 拍板 Q-D2=A + H6②)——
 *   員工看完「已經有哪幾筆」下一個動作就是登錄,兩者分卡會出現「看一張、填另一張」的斷點。
 *   🔴 本元件仍然只排版:表單自己的狀態機在 `payment-record-form.tsx`,這裡不知道它的存在。
 */
export function PaymentList({
  data,
  amountDue,
  amountUncomputable = false,
  refundedTotal,
  cancelled,
  orderId,
  returnTo,
  children,
  layout = 'page',
  renderForm,
  cancelledUnknown = false,
  cancelAdjusted = false,
  openPendingRefund = null,
}: {
  /** ⟦Q1 甲⟧ 應收因取消而變少(`orderAmountDue(detail) !== detail.total.amount`)⇒ 多收印「多收 X 待退」。 */
  cancelAdjusted?: boolean;
  /** ⟦Q1 甲⟧ 未結待退款合計;> 0 才印「待退款 X 元（已開，尚未退）」,`null` = 讀不到 ⇒ 不印。 */
  openPendingRefund?: number | null;
  /** dialog:取消狀態讀不到(明細那發失敗)⇒ 不能當成沒取消,「尾」那半不印(codex B17 R2 must-fix ①)。 */
  cancelledUnknown?: boolean;
  /** dialog 版面:表單由這裡渲染,帶上「這張單已收的」摘要(從本元件手上那份 `summary` 算,不另開呼叫端)。 */
  renderForm?: (receivedNote: string | undefined, historySlot: React.ReactNode) => React.ReactNode;
  /**
   * 🆕 B17(2026-09-14)稿 v22 彈窗 1:`dialog` = 表單在上、收款列收進「已登的收款 N 筆(沖銷在這裡)」摺疊在下,
   * 沒有卡片殼、沒有「收款」小標、沒有彙總行(那句進了確認勾)。明細頁不傳 ⇒ 零變化。
   */
  layout?: 'page' | 'dialog';
  data: PaymentListData;
  /** 這張單的應收總額(整數元,同 `order_payments.amount` 單位;#437 ④ 的彙總行用)。 */
  amountDue: number | null;
  /**
   * 🔴🔴 **[R1 M1 / C5,2026-09-16 Sean 拍乙]** `true` = **系統算不出**這張單取消後還該收多少,
   *    **不是**「讀不到」。兩者都會讓 `amountDue` 是 `null` ⇒ `toPaymentSummary` 都回 `unknown`
   *    ⇒ 不分開的話,這一態會印「(收款紀錄讀不到)請重新整理」——
   *    🛑 **而重整幾次都不會變。** 那句話對這種單是死路。
   * 🔵 收款列表本身在這一態是**好的**(`data.status` 仍可能是 `ok`)⇒ 只換彙總那一句,不動列表。
   */
  amountUncomputable?: boolean;
  /**
   * 🔴 帳本已退總額(`refundedTotalFromUnregistered` 算的;**含尚未確定出款的 `processing`**);`null` = 算不出來 ⇒ 彙總行印「未知」。
   *
   * 🔴 **這一格跟頭條一起改, 不是只改頭條**(主視窗 `-1a` 2026-09-08 裁, 逐字理由:
   *    「同一個詞在同一頁不能有兩個意思」)—— 本卡的「已收 Y」與頭條的「總額 / 已收」
   *    在**同一頁**上、兩邊都寫「已收」。只改其中一處 = 製造本 bug 的同一個形狀。
   */
  refundedTotal: number | null;
  /**
   * 🔴 這張單已取消嗎(`detail.cancelledAt !== null`)。**只關掉「還差 X 元」那一顆**,
   *    金額一個字都不動 —— 理由與「兩個都不對而錯法不同」寫在 `order-focal-row.tsx` 的同一格旁邊。
   * 🔵 判準與 `order-detail-header.tsx` 逐字同一個, 不另立一套「算不算取消」的定義。
   * ⚠️ **只涵蓋整單取消** —— 部分取消不寫 `cancelled_at`
   *    (`supabase/migrations/20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql:522,528,530`:
   *     只在 `v_closed`= 每一項都取消光 時才寫;同檔 `:379` 有一道閘把
   *     「部分取消卻有 cancelled_at」判為病理)。
   */
  cancelled: boolean;
  /** #372-A12:沖銷 action 要用(revalidate 這張單 + 寫 log)。 */
  orderId: string;
  /** #372-A12:沖銷後要重取的那條路由(面板版帶 `?panel=…`)。 */
  returnTo: string;
  children?: React.ReactNode;
}) {
  const grossSummary: PaymentSummary = toPaymentSummary(
    amountDue,
    // 🔴 只有 `ok` 才交得出 rows;其餘兩態一律傳 `null` ⇒ 彙總行畫「未知」而不是算出一個假數字。
    data.status === 'ok' ? data.rows : null,
  );
  // 🔴 淨額:「已收」扣掉帳本已退(Sean 2026-09-08 拍【乙】)。
  //    **`kind` 也跟著重算** ⇒ 下面那顆「已收足 / 還差 X / 溢收 X」讀的是同一個口徑。
  const summary: PaymentSummary = toReceivedNetSummary(grossSummary, refundedTotal);
  if (layout === 'dialog') {
    const rows = data.status === 'ok' ? data.rows : null;
    let receivedNote: string | undefined;
    if (rows !== null && summary.kind !== 'unknown') {
      // 🔴 codex R1 must-fix ①②③:金額與結清狀態一律沿用 `summary`(它已扣退款、含沖銷抵銷);
      //    「還沒登過」只在【一筆原始紀錄都沒有】時才印(收→沖→再沖之後 live 為空但錢在);
      //    「最近收款日」自己排序取最新,不依賴 RPC 回列的順序;已取消的單不印「尾」。
      const reversed = reversedPaymentIds(rows);
      const live = rows.filter((r) => !r.isReversal && !reversed.has(r.id));
      const newest = [...live].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
      const when = newest ? toPaymentListEntry(newest, reversed).receivedAtShort : null;
      const received = summary.received.toLocaleString('zh-TW');
      const tail = cancelledUnknown
        ? ' · 取消狀態讀不到,尾款先不算'
        : cancelled
        ? ' · 已取消'
        : summary.kind === 'short'
          ? ` · 尾款 NT$${summary.gap.toLocaleString('zh-TW')}`
          : summary.kind === 'over'
            ? ` · 多收 ${summary.excess.toLocaleString('zh-TW')}`
            : ' · 已收足';
      receivedNote =
        rows.length === 0
          ? cancelledUnknown ? '還沒登過 · 取消狀態讀不到,尾款先不算' : cancelled ? '還沒登過 · 已取消' : `還沒登過 · 尾款 NT$${summary.due.toLocaleString('zh-TW')}`
          : `${when ? `最近 ${when} · ` : ''}累計收 ${received}${tail}`;
    }
    // 稿:摺疊「已登的收款」在說明句與 [取消][確認] 之間 ⇒ 這一塊交給表單塞在它的 footer 前面
    //    (裡面沒有 <form>:沖銷是 client island 的 button,不是表單 ⇒ 放進表單裡合法)。
    const history = (
      <details className='pcm-paylist-hist'>
        <summary>已登的收款 {rows === null ? '?' : rows.length} 筆(沖銷在這裡)</summary>
        {data.status === 'unreadable' ? (
          <p className='mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800'>
            這一單的收款紀錄沒有載入(讀取失敗)—— 這<strong>不是</strong>「沒有收過款」,是「不知道有沒有」。
            <strong>在這之前不要據此再登錄一筆收款</strong>,那會變成重複入帳。
          </p>
        ) : data.status === 'order_not_found' ? (
          <p className='mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800'>查不到這張訂單 —— 收款紀錄無從查起。</p>
        ) : data.rows.length === 0 ? (
          <p className='text-muted-foreground py-2 text-xs'>尚未登錄任何收款。</p>
        ) : (
          <ul>
            {(() => {
              const reversedIds = reversedPaymentIds(data.rows);
              return data.rows.map((row) => (
                <Row key={row.id} row={row} reversedIds={reversedIds} orderId={orderId} returnTo={returnTo} />
              ));
            })()}
          </ul>
        )}
        {/* 稿的第四句:住在沖銷那一格 */}
        <p className='text-muted-foreground text-xs'>
          沖銷之後這張單<strong>可能會退回「還沒收」</strong>,因為系統會重算一次收了多少。
        </p>
      </details>
    );
    return (
      <div className='pcm-paylist'>
        {amountUncomputable ? (
          // 🔴 [R1 M1] 算不出來 ≠ 讀不到:這一種重整幾次都不會變,他要的是人工計算。
          <p className='text-destructive text-xs'>
            系統<strong>算不出</strong>這張單取消後還該收多少 ⇒ 應收金額不可採信,請人工計算。
          </p>
        ) : summary.kind === 'unknown' ? (
          // 讀不到明細時「已收」不能算 ⇒ 印「未知」而不是一個假的 0(與 page 版面 SummaryLine 同一條規則);表單那半自己會鎖。
          <p className='text-destructive text-xs'>這張單收了多少現在是<strong>未知</strong>(收款紀錄讀不到)。</p>
        ) : null}
        {renderForm ? renderForm(receivedNote, history) : <>{children}{history}</>}
      </div>
    );
  }
  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        {/* #437 ①:Sean 肉眼驗後定案「收款」(原「已登錄的收款」;鎖結構不鎖字那條在此結案)。 */}
        <h2 className='text-muted-foreground text-xs font-medium'>收款</h2>
        {/* 🔴 讀不到時**不可**顯示「0 筆」—— 那是這一族最短的一句謊話。 */}
        <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
          {data.status === 'ok' ? `${data.rows.length} 筆` : '筆數未知'}
        </span>
      </div>

      {amountUncomputable ? (
        // 🔴 [R1 C5] 這一態 `summary.kind` 也是 `unknown`,而 `SummaryLine` 對 unknown 印的是
        //    「(收款或退款明細沒載入)」—— **那是錯的理由**,員工會去重整。⇒ 這裡先接走。
        <p className='text-destructive mb-3 text-xs'>
          系統<strong>算不出</strong>這張單取消後還該收多少 ⇒ 應收金額不可採信,請人工計算。
        </p>
      ) : (
        <SummaryLine
          summary={summary}
          cancelled={cancelled}
          cancelAdjusted={cancelAdjusted}
          nothingCollected={grossSummary.kind !== 'unknown' && grossSummary.received === 0}
        />
      )}
      {openPendingRefund !== null && openPendingRefund > 0 && (
        <p className='text-muted-foreground mb-3 text-xs tabular-nums'>
          待退款 {formatAmount(openPendingRefund)}（已開，尚未退）
        </p>
      )}

      {data.status === 'unreadable' ? (
        <p className='mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800'>
          這一單的收款紀錄沒有載入(讀取失敗)—— 這<strong>不是</strong>「沒有收過款」,是「不知道有沒有」。
          請重新整理;若仍相同,請通知系統維護。
          <strong>在這之前不要據此再登錄一筆收款</strong>,那會變成重複入帳。
        </p>
      ) : data.status === 'order_not_found' ? (
        <p className='mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800'>
          查不到這張訂單 —— 收款紀錄無從查起。請重新整理確認訂單還在。
        </p>
      ) : data.rows.length === 0 ? (
        <p className='text-muted-foreground py-2 text-sm'>尚未登錄任何收款。</p>
      ) : (
        <ul>
          {/* 🔴 一次算好整組「誰被沖掉了」再逐列問,不要每列各掃一遍(N² 之外,
              更重要的是單一真相:兩處各算一次就會漂)。 */}
          {(() => {
            const reversedIds = reversedPaymentIds(data.rows);
            return data.rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                reversedIds={reversedIds}
                orderId={orderId}
                returnTo={returnTo}
              />
            ));
          })()}
        </ul>
      )}

      {children}
    </section>
  );
}
