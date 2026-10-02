// email-copy-preview.ts —— 信件文字第 3 片:後台「信件文字」頁的預覽。
// 用寄信同一支組信程式(buildEmailContentForPreview)+ 一組固定的範例訂單, 套上員工的草稿字。
// 預覽看到的 = 客人收到的(純文字、HTML、LINE 推播三份)。範例資料是假的, 只用來看排版與文字。
import type { ClaimedEmailJob, PaidEmailContext, ShippedEmailContext } from '@pcm/ports';
import { EMAIL_COPY, withEmailCopyOverrides, type EmailCopyKey } from './email-copy-catalog';
import { paidEmailOrderUrl, renderPaidEmailHtml } from './paid-email-html';
import { stripLineInviteForLinePush } from './order-email-copy';
import { buildEmailContentForPreview } from './sweep-email-outbox';

const SITE = 'https://www.pcmmotorsports.com';
const ID = 'PCM-2026-0001';

type Sample = {
  id: string;
  label: string;
  job: Omit<ClaimedEmailJob, 'id' | 'orderId' | 'dedupKey' | 'recipientEmail' | 'attempts' | 'maxAttempts' | 'requestId' | 'handedToProviderAt' | 'channel'>;
  shipped?: ShippedEmailContext;
  paid?: PaidEmailContext;
  /** 單號更正信:寄出前比對讀到的查詢頁網址。 */
  correctedTrackingPageUrl?: string;
};

const m = (n: number) => n as PaidEmailContext['total'];
const PAID: PaidEmailContext = {
  orderDisplayId: ID,
  lines: [{ title: 'Akrapovic Slip-On 鈦合金排氣管', variantSku: 'S-Y10SO18-HAPT', quantity: 1, lineTotal: m(38000) }],
  linesTruncated: false,
  subtotal: m(38000),
  shippingFee: m(0),
  discountTotal: m(0),
  total: m(38000),
  taxTotal: m(0),
};
const SHIPPED: ShippedEmailContext = {
  orderDisplayId: ID,
  shipmentReference: 'BCDF23',
  carrierName: '新竹物流',
  trackingNumber: '6812345678',
  trackingPageUrl: 'https://www.hct.com.tw/search/searchgoods_n.aspx',
  trackingCorrectedAt: null,
  lines: [{ title: 'Akrapovic Slip-On 鈦合金排氣管', quantity: 1 }],
  linesTruncated: false,
  orderHasUnshippedItems: true,
  recipientName: '王小明',
  recipientAddress: '台北市中山區南京東路 100 號',
  recipientPhone: '0912345678',
};
const CREATED = '2026-10-02T02:00:00.000Z';

/** 預覽可選的範例信。同一種信的不同情況(例如全額或部分退款)各一封, 因為印的句子不一樣。 */
const SAMPLES: readonly Sample[] = [
  { id: 'paid', label: '付款成功信', paid: PAID, job: { eventType: 'order_created', subject: `PCM 訂單 ${ID} 付款成功通知`, payload: { event_version: 1, display_id: ID, paid_at: CREATED } } },
  { id: 'bank_created', label: '匯款單成立信', job: { eventType: 'bank_order_created', subject: `訂單 ${ID} 已成立,請於期限內完成匯款`, payload: { display_id: ID, total: 38000, balance_due: 38000, created_at: CREATED } } },
  { id: 'bank_changed', label: '匯款金額變更信', job: { eventType: 'bank_order_amount_changed', subject: `訂單 ${ID} 應付金額已更新`, payload: { display_id: ID, total: 30000, balance_due: 30000, created_at: CREATED } } },
  { id: 'shipped', label: '出貨信(有追蹤碼、還有商品沒出)', shipped: SHIPPED, job: { eventType: 'order_shipped', subject: `PCM 訂單 ${ID} 出貨通知(包裹 BCDF23)`, payload: { event_version: 1, display_id: ID, shipment_reference: 'BCDF23', shipped_at: CREATED } } },
  { id: 'shipped_pickup', label: '出貨信(自取或自送, 沒有追蹤碼)', shipped: { ...SHIPPED, carrierName: null, trackingNumber: null, trackingPageUrl: null, orderHasUnshippedItems: false }, job: { eventType: 'order_shipped', subject: `PCM 訂單 ${ID} 出貨通知(包裹 BCDF23)`, payload: { event_version: 1, display_id: ID, shipment_reference: 'BCDF23', shipped_at: CREATED } } },
  { id: 'tracking_corrected', label: '貨運單號更正信', correctedTrackingPageUrl: 'https://www.hct.com.tw/search/searchgoods_n.aspx', job: { eventType: 'shipment_tracking_corrected', subject: `PCM 訂單 ${ID} 貨運單號更正(包裹 BCDF23)`, payload: { event_version: 1, display_id: ID, shipment_reference: 'BCDF23', tracking_number: '6812345679' } } },
  { id: 'unpaid_cancelled', label: '未付款取消信', job: { eventType: 'order_unpaid_cancelled', subject: `PCM 訂單 ${ID} 已取消`, payload: { display_id: ID, cancelled_reason: '依您要求取消' } } },
  { id: 'cancelled_full', label: '已付款取消信(全額退款)', job: { eventType: 'order_cancelled', subject: `PCM 訂單 ${ID} 已取消`, payload: { display_id: ID, cancelled_reason: '依您要求取消', refund_kind: 'full', refunded_amount: 38000 } } },
  { id: 'cancelled_partial', label: '已付款取消信(部分退款)', job: { eventType: 'order_cancelled', subject: `PCM 訂單 ${ID} 已取消`, payload: { display_id: ID, cancelled_reason: '依您要求取消', refund_kind: 'partial', refunded_amount: 8000 } } },
  { id: 'refund_active', label: '部分退款信(訂單還在, 刷卡退回)', job: { eventType: 'order_partially_refunded', subject: `PCM 訂單 ${ID} 已退款`, payload: { event_version: 2, display_id: ID, refunded_amount: 8000, refunded_at: CREATED, order_state: 'active', refund_source: 'card' } } },
  { id: 'refund_full', label: '部分退款信(這筆退完已全數退回)', job: { eventType: 'order_partially_refunded', subject: `PCM 訂單 ${ID} 已退款`, payload: { event_version: 2, display_id: ID, refunded_amount: 8000, refunded_at: CREATED, order_state: 'fully_refunded', refund_source: 'card' } } },
  { id: 'refund_cancelled', label: '部分退款信(已取消的訂單又退一筆)', job: { eventType: 'order_partially_refunded', subject: `PCM 訂單 ${ID} 已退款`, payload: { event_version: 2, display_id: ID, refunded_amount: 8000, refunded_at: CREATED, order_state: 'cancelled', refund_source: 'manual' } } },
  { id: 'partially_cancelled_overpaid', label: '部分取消信(客人多付了)', job: { eventType: 'order_partially_cancelled', subject: `PCM 訂單 ${ID} 部分商品已取消`, payload: { display_id: ID, cancelled_items: [{ title: '碳纖維隔熱片', quantity: 1 }], effective_subtotal: 30000, effective_shipping_fee: 0, remaining_receivable: 30000, paid_total: 38000 } } },
  { id: 'partially_cancelled_unpaid', label: '部分取消信(還沒付款)', job: { eventType: 'order_partially_cancelled', subject: `PCM 訂單 ${ID} 部分商品已取消`, payload: { display_id: ID, cancelled_items: [{ title: '碳纖維隔熱片', quantity: 1 }], effective_subtotal: 30000, effective_shipping_fee: 0, remaining_receivable: 30000, paid_total: 0 } } },
  { id: 'partially_cancelled_exact', label: '部分取消信(付的剛好)', job: { eventType: 'order_partially_cancelled', subject: `PCM 訂單 ${ID} 部分商品已取消`, payload: { display_id: ID, cancelled_items: [{ title: '碳纖維隔熱片', quantity: 1 }], effective_subtotal: 30000, effective_shipping_fee: 0, remaining_receivable: 30000, paid_total: 30000 } } },
  { id: 'partially_cancelled_short', label: '部分取消信(還差一些)', job: { eventType: 'order_partially_cancelled', subject: `PCM 訂單 ${ID} 部分商品已取消`, payload: { display_id: ID, cancelled_items: [{ title: '碳纖維隔熱片', quantity: 1 }], effective_subtotal: 30000, effective_shipping_fee: 0, remaining_receivable: 30000, paid_total: 20000 } } },
  { id: 'return_received', label: '退貨收回信', job: { eventType: 'order_return_received', subject: `我們已收到您寄回的商品(訂單 ${ID})`, payload: { display_id: ID, received_items: [{ title: '碳纖維隔熱片', quantity: 1 }] } } },
];

export const EMAIL_PREVIEW_SAMPLES: readonly { id: string; label: string }[] = SAMPLES.map(({ id, label }) => ({ id, label }));

export type EmailCopyPreview = { subject: string; text: string; html: string; lineText: string };

function sampleJob(s: Sample): ClaimedEmailJob {
  return {
    ...s.job,
    id: 'preview',
    orderId: 'preview',
    dedupKey: 'preview',
    recipientEmail: 'preview@example.com',
    attempts: 1,
    maxAttempts: 5,
    requestId: null,
    handedToProviderAt: null,
    channel: 'email',
  };
}

/** 用員工的草稿字組出一封範例信。sampleId 不認得 ⇒ null。 */
export function renderEmailCopyPreview(
  sampleId: string,
  overrides: ReadonlyMap<EmailCopyKey, string>,
): EmailCopyPreview | null {
  const s = SAMPLES.find((x) => x.id === sampleId);
  if (s === undefined) return null;
  const job = sampleJob(s);
  return withEmailCopyOverrides(overrides, () => {
    const content = buildEmailContentForPreview(job, s.shipped ?? null, s.paid ?? null, SITE, s.correctedTrackingPageUrl ?? null);
    const html =
      s.paid !== undefined
        ? renderPaidEmailHtml(s.paid, { orderUrl: paidEmailOrderUrl(SITE, s.paid.orderDisplayId) })
        : (content.html ?? '');
    return { subject: job.subject, text: content.text, html, lineText: stripLineInviteForLinePush(content.text) };
  });
}

/**
 * 這封範例信用到哪幾句:每一句換成一個記號再組一次, 看記號有沒有出現。
 * 後台用它決定「這一句預設要看哪一封範例」, 以及提醒「這封範例沒有用到這一句」。
 */
export function emailCopyKeysInSample(sampleId: string): EmailCopyKey[] {
  const keys = Object.keys(EMAIL_COPY) as EmailCopyKey[];
  const used: EmailCopyKey[] = [];
  for (const key of keys) {
    const marker = `⟪${key}⟫`;
    const out = renderEmailCopyPreview(sampleId, new Map([[key, marker]]));
    if (out !== null && (out.text.includes(marker) || out.html.includes(marker))) used.push(key);
  }
  return used;
}
