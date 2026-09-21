import Link from 'next/link';
import { OrderCopyButton } from './order-copy-button';
import type { AdminOrderDetail, MemberTier } from '@pcm/domain';
import './order-inline-head.css';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { listOrderPayments } from '../../lib/orders/payment-repository';
import { sumReceived } from '../../lib/orders/payment-list-view';
import { listOrderEmailLog } from '../../lib/orders/email-log-repository';
import { toEmailLogEntry } from '../../lib/orders/email-log-view';
import { loadOrderShipments } from '../../lib/shipping/order-shipments';
import { carrierLabelOf } from '../../lib/shipping/carrier-label';
// 🔴 單號的優先序(人手填的 `tracking_number` 蓋過新竹配的 `hct_request_id`)**只住在那一支**,
//    本檔不自己判 —— 2026-09-16 Sean 真後台撞到:這裡只讀 trackingNumber ⇒ 走新竹時印「還沒有單號」,
//    而新竹早就配好號了(箱 45NJ3Y:tracking_number NULL / hct_request_id 8947081975)。
import { shipmentListTracking } from '../../lib/shipping/shipment-list-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { INVOICE_STATUS_LABEL } from '../../lib/orders/order-list-view';
import { NOTE_CHANNEL_LABEL } from '../../lib/orders/note-timeline';
import { TIER_LABEL, formatCustomerDate } from '../../lib/customers/customer-list-view';
import { ResultBanner } from './result-banner';
import { CancelResultPanel, isCancelPanelResultCode } from './cancel-result-panel';
import { getSessionActor } from '../../lib/session/actor';

// order-inline-head.tsx — 訂單列表「點列展開」= 編輯模式的【標題列】(稿 OD pcm-524f orders-admin-v22 `openDet()`:
// `tr.edithead` 插在那張單的列【上方】,三行:①單號 · 收件 · 發票 · 通知信 · 已收 ②備註 ③六顆鈕;整組外面 1px 框)。
// 商品就是列表原本的那幾列 —— 這裡**沒有第二張商品表**(稿 CSS 的 tr.detrow / .det / .itbl 是死碼,主視窗 09-14 盤過)。
// Sean 拍板:白底 + 1px 淺框(--input)+ 標題列淡底(--secondary);不要 ✕;同一數字不印兩次;鈕上不要技術字;
// 取消只在這裡的動作列;展開就看到 最新一則備註 / 貨運單號可框選 / 缺貨·寄失敗。
//
// 🔴 **零新寫入路**:每顆鈕都連到網址彈窗。已接上:收款 `?pay=` · 發票 `?invoice=`。
//    六顆全接上(收款 `?pay=` / 發票 `?invoice=` / 退款取消 `?cancel=` / 備註 `?note=` / 編輯個資 `?edit=` / 更多 `?more=`);一律真連結。
// 🔴 資料:明細一發(`findAdminOrderDetail`,備註 / 收件 / 發票都在裡面)+ 收款 / 通知信 / 出貨各一發(三者都印在標題列上)。
//    每支各自容錯:讀不到印「讀不到」,不印成「沒有」。`OrderDetailRoute` 一個字不動(整頁還在用)。

export type InlineHeadLinks = {
  pay: string;
  invoice: string;
  cancel: string;
  note: string;
  edit: string;
  more: string;
};

// 🔴 2026-09-14:六顆鈕的彈窗全部上線了(A 窗的 ?cancel= / ?note= / ?edit= / ?more= 那一輪進 dev,收款 / 發票更早)
//    ⇒ `WIRED` 那張全 false 的過渡表拿掉、`Act` 的灰態拿掉,六顆一律真連結。哪顆之後又要停用,直接不畫那顆,不要復活假灰鈕。
const NOTE_TYPE_LABEL = { internal: '內部', contact_log: '聯繫', customer_notified: '已告知客人' } as const;

export async function OrderInlineHead({
  id,
  links,
  tier,
  resultCode,
  markReason,
  requestToken,
}: {
  id: string;
  links: InlineHeadLinks;
  /** 結帳當下會員等級:明細投影沒有它,列表那列(`AdminOrderSummary.tierAtCheckout`)有 ⇒ 由呼叫端傳。 */
  tier: MemberTier | null;
  /** URL 的 `?r=` 原封轉入(同 `OrderDetailRoute` 的理由:不在頁層先 narrow)。展開時橫幅由這裡畫、列表停畫。 */
  resultCode: string | string[] | undefined;
  /** URL 的 `?mr=` 原封轉入:第二條路被拒時的原因碼(面板那側白名單查表)。 */
  markReason: string | string[] | undefined;
  /** URL 的 `?rt=` 原封轉入:取消結果面板拿它對帳本。 */
  requestToken: string | string[] | undefined;
}) {
  const bannerCode = typeof resultCode === 'string' ? resultCode : undefined;
  let detail: AdminOrderDetail | null = null;
  let detailFailed = false;
  try {
    detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  } catch (e) {
    console.error('[admin/orders] 就地展開:明細讀不到', e);
    detailFailed = true;
  }
  // 🔴 2026-09-15 路 4 走查:在列表裡取消一張單 ⇒ 導回 `open=A&r=order_cancelled&rt=…` 而 A 還在這一頁
  //    ⇒ 頁尾那份面板只畫「不在這一頁」、`ResultBanner` 刻意不收成功碼 ⇒ 員工什麼都看不到。
  //    這裡補畫同一顆面板(同 `OrderDetailRoute`:讀失敗 ⇒ null ⇒ 面板自己 fail-closed 說「讀不到」)。
  const cancelPanel = isCancelPanelResultCode(bannerCode) ? (
    <CancelResultPanel
      resultCode={bannerCode}
      markReason={markReason}
      requestToken={requestToken}
      actor={(await getSessionActor())?.id ?? null}
      cancellations={detail?.cancellations ?? null}
      cancellationsTruncated={detail?.cancellationsTruncated ?? true}
      orderCancelledAt={detail?.cancelledAt ?? null}
      orderPaymentStatus={detail?.paymentStatus ?? null}
    />
  ) : null;
  if (detail === null) {
    return (
      <div className='order-inline-head' data-testid='order-inline-head'>
        <ResultBanner code={bannerCode} />
        {cancelPanel}
        <div className='oih-line'>
          <span className={detailFailed ? 'oih-bad' : 'oih-muted'}>
            {detailFailed ? '這張單現在讀不到,請重新整理。' : '找不到這張單,它可能剛被刪掉。'}
          </span>
        </div>
      </div>
    );
  }
  const d = detail;
  const items = d.items ?? [];

  const [paymentsS, emailS, shipS] = await Promise.allSettled([
    listOrderPayments(id),
    listOrderEmailLog(id),
    loadOrderShipments(new Map(items.map((it) => [it.id, it.title]))),
  ]);
  const payments = paymentsS.status === 'fulfilled' ? paymentsS.value : null;
  const received = payments === null ? null : sumReceived(payments);
  const lastPaidAt = payments && payments.length > 0 ? [...payments].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!.receivedAt : null;
  const mails = emailS.status === 'fulfilled' ? emailS.value.map(toEmailLogEntry) : null;
  const mailFailed = mails?.filter((m) => m.isDead).length ?? 0;
  const shipments = shipS.status === 'fulfilled' && shipS.value !== null ? shipS.value.filter((g) => g.shipment.voidedAt === null) : null;

  const outOfStock = items.some((it) => it.procurements?.some((p) => p.replyStatus === 'out_of_stock'));
  // `?? []`:型別上 notes 必有,而測試 fixture 常是半張 detail ⇒ 缺就當沒備註,不炸整列。
  const note = [...(d.notes ?? [])].filter((n) => n.deletedAt === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const l4 = (d.displayId ?? '').slice(-4);
  const cancelled = d.cancelledAt !== null;
  const ship = d.shippingAddress ?? { name: null, phone: null, line: null };
  const tierLabel = tier === null ? null : TIER_LABEL[tier];
  const mmdd = (iso: string) => formatCustomerDate(iso).slice(5).replace('-', '/');

  return (
    <div className='order-inline-head' data-testid='order-inline-head'>
      <ResultBanner code={bannerCode} detail={{ orderCreatedMmDd: mmdd(d.createdAt) }} />
      {cancelPanel}
      <div className='oih-line'>
        <span className='oih-k'>單號</span>
        <b className='font-mono'>{d.displayId}</b>
        {cancelled ? <span className='cap-n'>已取消</span> : null}
        {outOfStock ? <span className='cap-y'>缺貨</span> : null}
        <span className='oih-k'>收件</span>
        <span className='oih-ell'>
          <OrderCopyButton text label='複製姓名' value={ship.name ?? ''} />
          {'，'}
          <OrderCopyButton text label='複製電話' value={ship.phone ?? ''} />
          {tierLabel ? <span className='oih-tier'>{tierLabel}</span> : null}
        </span>
        <span className='oih-k'>發票</span>
        <span className='oih-muted'>
          {INVOICE_STATUS_LABEL[d.invoiceStatus] ?? '未開立'}
          {d.invoiceNumber ? ` ${d.invoiceNumber}` : ''}
          {' · 通知信 '}
          {mails === null ? <span className='oih-bad'>讀不到</span> : `${mails.length} 筆`}
          {mailFailed > 0 ? <> · <b className='oih-bad'>{mailFailed} 封寄失敗</b></> : null}
        </span>
        <span className='oih-k'>已收</span>
        <span>
          {received === null ? (
            <span className='oih-bad'>讀不到</span>
          ) : received === 0 ? (
            <span className='oih-muted'>0 筆</span>
          ) : (
            <>{lastPaidAt ? `${mmdd(lastPaidAt)} 收 ` : ''}{received.toLocaleString('zh-TW')}</>
          )}
        </span>
      </div>
      <div className='oih-line oih-wrap oih-recipient'>
        <span className='oih-k'>地址</span>
        <OrderCopyButton text label='複製地址' value={ship.line ?? ''} />
        <OrderCopyButton label='複製收件資料' value={[ship.name ?? '', ship.phone ?? '', ship.line ?? ''].join(',')} />
      </div>
      <div className='oih-line oih-notel'>
        <span className='oih-k'>備註</span>
        {note ? (
          <>
            <span className='oih-ell oih-note'>{note.body}</span>
            <span className='oih-muted oih-small'>
              — {note.author} · {NOTE_TYPE_LABEL[note.noteType]}{note.channel ? ` · ${NOTE_CHANNEL_LABEL[note.channel]}` : ''} · {formatOrderDateTime(note.occurredAt ?? note.createdAt)}
            </span>
          </>
        ) : (
          <span className='oih-muted'>沒有備註</span>
        )}
      </div>
      {shipments === null ? (
        <div className='oih-line oih-notel'><span className='oih-k'>出貨</span><span className='oih-bad'>讀不到</span></div>
      ) : shipments.length > 0 ? (
        <div className='oih-line oih-notel oih-wrap'>
          <span className='oih-k'>出貨</span>
          {shipments.length > 1 ? <span className='oih-muted'>{shipments.length} 箱:</span> : null}
          {shipments.map((g, i) => {
            // 🔵 2026-09-16:優先序交給共用那支;**空值的用詞沿用本頁原本那句**「還沒有單號」。
            const trk = shipmentListTracking(
              { trackingNumber: g.shipment.trackingNumber, hctRequestId: g.hctRequestId },
              '還沒有單號',
            );
            return (
              <span key={g.shipment.id}>
                {i > 0 ? <span className='oih-muted'> / </span> : null}
                {/* 2026-09-14 走查:這裡原本印代碼 `hct`, 員工看到的要是「新竹物流」;未知代碼照印原字 */}
                {carrierLabelOf(g.shipment.carrierCode)}{' '}
                {trk.note === null ? (
                  trk.text === '還沒有單號' ? (
                    <span className='oih-muted'>{trk.text}</span>
                  ) : (
                    <span className='oih-trk'>{trk.text}</span>
                  )
                ) : (
                  <>
                    <span className='oih-trk'>{trk.text}</span>
                    {/* 🔴 「這個號碼是新竹配的」要說出來 —— 員工手填的與系統配的不是同一件事 */}
                    <span className='oih-muted'>({trk.note})</span>
                  </>
                )}
              </span>
            );
          })}
        </div>
      ) : null}
      <div className='oih-line oih-acts2'>
        <span className='oih-acts'>
          {!cancelled ? <Link href={links.pay} className='oih-p'>新增收款</Link> : null}
          {!cancelled ? (
            <Link href={links.cancel} className='oih-d'>
              退款 / 取消 <span className='oih-l4'>末四碼 {l4}</span>
            </Link>
          ) : null}
          <Link href={links.edit}>編輯個資</Link>
          <Link href={links.invoice}>發票登記</Link>
          <Link href={links.note}>備註與客人聯繫</Link>
          <Link href={links.more}>更多</Link>
        </span>
      </div>
    </div>
  );
}
