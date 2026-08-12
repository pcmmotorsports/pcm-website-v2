import {
  formatAmount,
  reversedPaymentIds,
  toPaymentListEntry,
  toPaymentSummary,
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
 */
function SummaryLine({ summary }: { summary: PaymentSummary }) {
  if (summary.kind === 'unknown') {
    return (
      <p className='text-muted-foreground mb-3 text-xs'>
        已收金額<strong>未知</strong>(明細沒載入)—— 不是「還沒收到錢」。
      </p>
    );
  }
  return (
    <p className='mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs'>
      <span className='text-muted-foreground tabular-nums'>
        應收 {formatAmount(summary.due)} / 已收 {formatAmount(summary.received)}
      </span>
      {summary.kind === 'settled' && (
        <span className='inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800'>
          已收足
        </span>
      )}
      {summary.kind === 'short' && (
        <span className='text-foreground font-medium tabular-nums'>
          還差 {formatAmount(summary.gap)}
        </span>
      )}
      {summary.kind === 'over' && (
        <span className='text-destructive font-medium tabular-nums'>
          溢收 {formatAmount(summary.excess)}
        </span>
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
  orderId,
  returnTo,
  children,
}: {
  data: PaymentListData;
  /** 這張單的應收總額(整數元,同 `order_payments.amount` 單位;#437 ④ 的彙總行用)。 */
  amountDue: number;
  /** #372-A12:沖銷 action 要用(revalidate 這張單 + 寫 log)。 */
  orderId: string;
  /** #372-A12:沖銷後要重取的那條路由(面板版帶 `?panel=…`)。 */
  returnTo: string;
  children?: React.ReactNode;
}) {
  const summary: PaymentSummary = toPaymentSummary(
    amountDue,
    // 🔴 只有 `ok` 才交得出 rows;其餘兩態一律傳 `null` ⇒ 彙總行畫「未知」而不是算出一個假數字。
    data.status === 'ok' ? data.rows : null,
  );
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

      <SummaryLine summary={summary} />

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
