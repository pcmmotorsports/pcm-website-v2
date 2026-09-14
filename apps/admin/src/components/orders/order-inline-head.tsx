import Link from 'next/link';
import type { AdminOrderDetail, MemberTier } from '@pcm/domain';
import './order-inline-head.css';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { listOrderPayments } from '../../lib/orders/payment-repository';
import { sumReceived } from '../../lib/orders/payment-list-view';
import { listOrderEmailLog } from '../../lib/orders/email-log-repository';
import { toEmailLogEntry } from '../../lib/orders/email-log-view';
import { loadOrderShipments } from '../../lib/shipping/order-shipments';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { INVOICE_STATUS_LABEL } from '../../lib/orders/order-list-view';
import { NOTE_CHANNEL_LABEL } from '../../lib/orders/note-timeline';
import { TIER_LABEL, formatCustomerDate } from '../../lib/customers/customer-list-view';
import { ResultBanner } from './result-banner';

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
}: {
  id: string;
  links: InlineHeadLinks;
  /** 結帳當下會員等級:明細投影沒有它,列表那列(`AdminOrderSummary.tierAtCheckout`)有 ⇒ 由呼叫端傳。 */
  tier: MemberTier | null;
  /** URL 的 `?r=` 原封轉入(同 `OrderDetailRoute` 的理由:不在頁層先 narrow)。展開時橫幅由這裡畫、列表停畫。 */
  resultCode: string | string[] | undefined;
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
  if (detail === null) {
    return (
      <div className='order-inline-head' data-testid='order-inline-head'>
        <ResultBanner code={bannerCode} />
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
  const who = [ship.name, ship.phone].filter((s) => s && s.trim() !== '').join(',');
  const tierLabel = tier === null ? null : TIER_LABEL[tier];
  const mmdd = (iso: string) => formatCustomerDate(iso).slice(5).replace('-', '/');

  return (
    <div className='order-inline-head' data-testid='order-inline-head'>
      <ResultBanner code={bannerCode} detail={{ orderCreatedMmDd: mmdd(d.createdAt) }} />
      <div className='oih-line'>
        <span className='oih-k'>單號</span>
        <b className='font-mono'>{d.displayId}</b>
        {cancelled ? <span className='cap-n'>已取消</span> : null}
        {outOfStock ? <span className='cap-y'>缺貨</span> : null}
        <span className='oih-k'>收件</span>
        <span className='oih-ell'>
          {who || <span className='oih-muted'>未填</span>}
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
          {shipments.map((g, i) => (
            <span key={g.shipment.id}>
              {i > 0 ? <span className='oih-muted'> / </span> : null}
              {g.shipment.carrierCode}{' '}
              {g.shipment.trackingNumber ? <span className='oih-trk'>{g.shipment.trackingNumber}</span> : <span className='oih-muted'>還沒有單號</span>}
            </span>
          ))}
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
