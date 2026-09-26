// 退貨收回(第 2 片):訂單詳情「收款 · 退款」分頁的「退貨」區塊。
// 計畫 docs/plans/2026-09-27-order-returns.md §三;資料庫 20260927010000。
// OD 稿 pcm-524f 沒有退貨畫面(2026-09-27 查), 外框照同分頁既有卡片(`bg-card rounded-lg border p-4`)。
// 🔴 退貨紀錄讀不到(returns = null)⇒ 不顯示任何表單:可退數量要靠退貨紀錄算, 讀不到就算不出來。
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import {
  RETURN_CONDITION_LABEL,
  RETURN_REASON_LABEL,
  RETURN_STATUS_LABEL,
  returnableByItem,
  suggestReturnRefund,
  type OrderReturnRow,
} from '../../lib/orders/return-view';
import { returnRefundHref } from '../../lib/orders/return-action-state';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { ReturnReceiveForm, ReturnRegisterForm, ReturnVoidForm, type ReturnFormItem } from './order-return-forms';

export type ReturnSectionItem = {
  id: string;
  title: string | null;
  variantSku: string;
  spec: Record<string, string> | null;
  /** 當初成交單價(第 3 片建議退款金額用) */
  unitPrice: { amount: number };
  quantitySummary: { shippedQuantity: number } | null;
};

export type ReturnTokens = {
  register: string;
  perReturn: Record<string, { receive: string; void: string }>;
};

const itemLabel = (it: ReturnSectionItem) => it.title ?? it.variantSku;
const specLabel = (it: ReturnSectionItem) =>
  it.spec ? Object.entries(it.spec).map(([k, v]) => `${k}: ${v}`).join(' · ') : null;

export function OrderReturnSection({
  orderId,
  returnTo,
  items,
  returns,
  tokens,
  discountTotal = 0,
}: {
  orderId: string;
  returnTo: string;
  items: readonly ReturnSectionItem[];
  /** 訂單折扣總額(整數元);> 0 時建議退款金額旁提醒員工自行扣(第 3 片審查建議 3)。 */
  discountTotal?: number;
  /** null = 退貨紀錄載入失敗 */
  returns: readonly OrderReturnRow[] | null;
  tokens: ReturnTokens;
}) {
  const byId = new Map(items.map((it) => [it.id, it]));
  return (
    <section className='bg-card text-card-foreground space-y-4 rounded-lg border p-4' data-testid='order-return-section'>
      <h2 className='font-semibold'>退貨</h2>
      {returns === null ? (
        <p className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm'>
          退貨紀錄載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </p>
      ) : (
        <ReturnBody
          orderId={orderId}
          returnTo={returnTo}
          items={items}
          byId={byId}
          returns={returns}
          tokens={tokens}
          discountTotal={discountTotal}
        />
      )}
    </section>
  );
}

function ReturnBody({
  orderId,
  returnTo,
  items,
  byId,
  returns,
  tokens,
  discountTotal,
}: {
  discountTotal: number;
  orderId: string;
  returnTo: string;
  items: readonly ReturnSectionItem[];
  byId: Map<string, ReturnSectionItem>;
  returns: readonly OrderReturnRow[];
  tokens: ReturnTokens;
}) {
  const counts = returnableByItem(
    items.map((it) => ({ id: it.id, shippedQuantity: it.quantitySummary?.shippedQuantity ?? 0 })),
    returns,
  );
  // 審查 C1:已登記退貨多於已出貨(退貨登記之後包裹被作廢出貨)⇒ 標出來, 請員工先核對。
  const over = items.filter((it) => (counts.get(it.id)?.returnable ?? 0) < 0);
  const registerItems: ReturnFormItem[] = items
    .filter((it) => (counts.get(it.id)?.returnable ?? 0) > 0)
    .map((it) => ({ id: it.id, label: itemLabel(it), spec: specLabel(it), max: counts.get(it.id)!.returnable }));
  const anyShipped = items.some((it) => (it.quantitySummary?.shippedQuantity ?? 0) > 0);

  return (
    <>
      {over.length > 0 && (
        <div role='alert' className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm'>
          <p className='font-semibold'>已登記退貨的數量多於目前已出貨的數量</p>
          <p className='mt-1 text-xs'>
            可能是出貨紀錄被作廢了。請先核對出貨與退貨紀錄。還在「退貨中」的登記可以作廢；已收回的無法作廢，請聯絡系統管理員。
          </p>
          <ul className='mt-1 list-disc pl-4 text-xs'>
            {over.map((it) => {
              const c = counts.get(it.id)!;
              return (
                <li key={it.id}>
                  {itemLabel(it)}：已出貨 {c.shipped} 件、已登記退貨 {c.taken} 件
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {returns.length > 0 && (
        <ul className='space-y-3'>
          {returns.map((r) => (
            <ReturnCard
              key={r.id}
              r={r}
              orderId={orderId}
              returnTo={returnTo}
              byId={byId}
              tokens={tokens.perReturn[r.id]}
              discountTotal={discountTotal}
              refund={suggestReturnRefund(
                r,
                items.map((it) => ({ id: it.id, shippedQuantity: it.quantitySummary?.shippedQuantity ?? 0, unitPrice: it.unitPrice.amount })),
                returns,
              )}
            />
          ))}
        </ul>
      )}

      {registerItems.length > 0 ? (
        <ReturnRegisterForm orderId={orderId} returnTo={returnTo} serverToken={tokens.register} items={registerItems} />
      ) : (
        <p className='text-muted-foreground text-sm'>
          {anyShipped
            ? '已出貨的品項都已登記退貨，沒有可以再登記的數量。'
            : '這張訂單還沒有已出貨的品項，出貨後才能登記退貨。'}
        </p>
      )}
    </>
  );
}

function ReturnCard({
  r,
  orderId,
  returnTo,
  byId,
  tokens,
  refund,
  discountTotal,
}: {
  discountTotal: number;
  r: OrderReturnRow;
  orderId: string;
  returnTo: string;
  byId: Map<string, ReturnSectionItem>;
  tokens: { receive: string; void: string } | undefined;
  refund: ReturnType<typeof suggestReturnRefund>;
}) {
  const reason = r.reasonCode === 'other' ? r.reasonDetail ?? RETURN_REASON_LABEL.other : RETURN_REASON_LABEL[r.reasonCode];
  const detail = r.reasonCode !== 'other' && r.reasonDetail ? `（${r.reasonDetail}）` : '';
  const formItems: ReturnFormItem[] = r.items.map((ri) => {
    const it = byId.get(ri.orderItemId);
    return { id: ri.orderItemId, label: it ? itemLabel(it) : '（品項已不在這張訂單）', spec: it ? specLabel(it) : null, max: ri.quantity };
  });
  return (
    <li className='rounded-md border p-3 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className={r.status === 'registered' ? 'font-semibold text-amber-700 dark:text-amber-400' : 'font-semibold'}>
          {RETURN_STATUS_LABEL[r.status]}
        </span>
        <span className='text-muted-foreground text-xs'>
          {formatOrderDateTime(r.registeredAt)} {r.registeredBy} 登記
        </span>
      </div>
      <p className='mt-1'>
        原因：{reason}
        {detail}
      </p>
      {r.trackingNumber && <p className='text-muted-foreground text-xs'>客人寄回的物流單號：{r.trackingNumber}</p>}
      {r.note && <p className='text-muted-foreground text-xs'>備註：{r.note}</p>}
      <table className='mt-2 w-full text-sm'>
        <thead className='text-muted-foreground text-xs'>
          <tr>
            <th className='py-1 text-left font-medium'>品項</th>
            <th className='py-1 text-right font-medium'>登記數量</th>
            {r.status === 'received' && <th className='py-1 text-right font-medium'>實收</th>}
            {r.status === 'received' && <th className='py-1 text-right font-medium'>狀況</th>}
          </tr>
        </thead>
        <tbody>
          {r.items.map((ri, i) => (
            <tr key={ri.orderItemId} className='border-t'>
              <td className='py-1 pr-2'>{formItems[i]!.label}</td>
              <td className='py-1 text-right tabular-nums'>{ri.quantity} 件</td>
              {r.status === 'received' && <td className='py-1 text-right tabular-nums'>{ri.receivedQuantity ?? 0} 件</td>}
              {r.status === 'received' && <td className='py-1 text-right'>{ri.condition ? RETURN_CONDITION_LABEL[ri.condition] : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {r.status === 'received' && r.receivedAt && (
        <p className='text-muted-foreground mt-1 text-xs'>
          {formatOrderDateTime(r.receivedAt)} {r.receivedBy} 確認收到{r.receiveNote ? `。收件備註：${r.receiveNote}` : ''}
        </p>
      )}
      {refund && <ReturnRefundHint refund={refund} returnTo={returnTo} byId={byId} discountTotal={discountTotal} />}
      {r.status === 'voided' && r.voidedAt && (
        <p className='text-muted-foreground mt-1 text-xs'>
          {formatOrderDateTime(r.voidedAt)} {r.voidedBy} 作廢。原因：{r.voidReason}
        </p>
      )}
      {r.status === 'registered' && tokens && (
        <div className='mt-3 flex flex-wrap items-start gap-2'>
          <ReturnReceiveForm orderId={orderId} returnId={r.id} returnTo={returnTo} serverToken={tokens.receive} items={formItems} />
          <ReturnVoidForm orderId={orderId} returnId={r.id} returnTo={returnTo} serverToken={tokens.void} />
        </div>
      )}
    </li>
  );
}

/** 第 3 片:已收回的退貨 ⇒ 建議退款金額 + 「為這筆退貨登記退款」(連到同頁退款區塊並預填)。 */
function ReturnRefundHint({
  refund,
  returnTo,
  byId,
  discountTotal,
}: {
  discountTotal: number;
  refund: NonNullable<ReturnType<typeof suggestReturnRefund>>;
  returnTo: string;
  byId: Map<string, ReturnSectionItem>;
}) {
  const name = (id: string) => {
    const it = byId.get(id);
    return it ? itemLabel(it) : '品項';
  };
  const lines = refund.lines.filter((l) => l.quantity > 0);
  if (refund.amount <= 0 || lines.length === 0) {
    return (
      <p className='border-destructive/30 bg-destructive/5 text-destructive mt-2 rounded-md border px-3 py-2 text-xs'>
        目前的已出貨數量不足，算不出建議退款金額。請先核對出貨與退貨紀錄；確定要退款時，請直接在下方退款區塊輸入金額。
      </p>
    );
  }
  const breakdown = lines.map((l) => `${name(l.orderItemId)} ${l.quantity} 件 × NT$ ${formatOrderAmount(l.unitPrice)}`).join('、');
  const reason = `退貨退款：${lines.map((l) => `${name(l.orderItemId)} ${l.quantity} 件`).join('、')}`.slice(0, 200);
  return (
    <div className='bg-muted/40 mt-2 space-y-1 rounded-md border px-3 py-2 text-sm'>
      <p>
        建議退款金額 NT$ {formatOrderAmount(refund.amount)}（{breakdown}）
      </p>
      <p className='text-muted-foreground text-xs'>
        依實收數量 × 當初成交單價計算，運費由公司吸收不另計。送出前可以修改金額。
        {discountTotal > 0 &&
          ` 這張訂單有折扣 NT$ ${formatOrderAmount(discountTotal)}，建議金額沒有扣掉折扣，請自行判斷要扣多少。`}
        {refund.capped && ' 有品項的實收數量多於目前可退的已出貨數量，已按已出貨數量計算。'}
      </p>
      <a
        href={returnRefundHref(returnTo, refund.amount, reason)}
        className='text-primary inline-block text-sm font-medium underline underline-offset-2'
      >
        為這筆退貨登記退款
      </a>
    </div>
  );
}
