import type { AdminOrderDetailItem } from '@pcm/domain';

import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { nextStepStubAction } from '../../lib/orders/next-step-stub-action';
import { ReceiptRecordForm } from './receipt-record-form';

// next-step-receipt-body.tsx — 列表「下一步 = 到貨登記」彈窗的【內容】(P-e-2,2026-09-13)。
//
// 🔴🔴 **`?next=<單號>&do=receipt` 打開的是【表單】,不是動作。** 貼一個網址不會寫進任何東西;
//    寫入只發生在他按下「確認」那一刻。(`docs/plans/2026-09-13-next-step-button-write-plan.md` §0)
//
// ── 形狀(規格 §3-f-2 七條)────────────────────────────────────────────────
//   ③ 只放要輸入的格子 ⇒ 每一筆**還有餘量、沒作廢**的採購一份 `ReceiptRecordForm`;
//      沒有到貨歷史、沒有摘要句。
//   ① server component,自己 await。
//
// 🔴 **復用明細頁那份表單,不重寫**(`ReceiptRecordForm` 原樣 + `action`)。
// 🔴 **零寫入(P-e-2)**:`action={nextStepStubAction}`;守門 `next-step-bodies.test.ts`。
//
// 🔴 **作廢的採購不列**:`item-procurement-rows.tsx:145` 逐字 `const voided = p.voidedAt != null`,
//    而 `types.ts:1001` 警告「任何 find/some/length 只要不帶 voidedAt === null 就可能命中作廢那列」。
//    這裡列的是**表單**,列到作廢那筆 = 讓員工把到貨掛在一筆已作廢的採購上(plan §3 那個並發殘餘風險的**單機版**)。
// 🔴 **餘量為 0 的也不列**:「已到齊」不是一個要輸入的格子。
// ⚠️ 而**整張單一筆都沒得登記**時要說一句,不能空白 —— 空白與「壞了」長得一樣。

function itemLabel(item: AdminOrderDetailItem): string {
  const name = item.title ?? item.variantSku;
  return item.brand ? `${item.brand} · ${name}` : name;
}

export async function NextStepReceiptBody({
  orderId,
  returnTo,
}: {
  orderId: string;
  /** 動作做完回哪裡 = 列表自己(不帶 `next`/`do`);action 端仍會過 `parseOrderReturnTo`。 */
  returnTo: string;
}) {
  const detail = await getAdminOrderRepository().findAdminOrderDetail(orderId);
  if (!detail) {
    return <p className='text-muted-foreground text-sm'>找不到這張單。請關掉重新整理再試。</p>;
  }
  const rows = detail.items.flatMap((item) =>
    (item.procurements ?? [])
      .filter((p) => p.voidedAt === null)
      .map((p) => ({ item, p, remaining: Math.max(0, p.allocatedQuantity - p.receivedQuantity) }))
      .filter((r) => r.remaining > 0),
  );
  if (rows.length === 0) {
    return (
      <p className='text-muted-foreground text-sm' data-testid='next-step-receipt-empty'>
        這張單沒有還在等的採購 —— 沒訂過,或全部到齊了。要下訂請按「跟供應商下訂」。
      </p>
    );
  }
  return (
    <div className='space-y-4' data-testid='next-step-receipt-body'>
      {rows.map(({ item, p, remaining }) => (
        <section key={p.id} className='rounded-md border p-3'>
          <h3 className='text-sm font-medium'>
            {itemLabel(item)}
            <span className='text-muted-foreground ml-2 text-xs'>
              {p.supplierLabel ?? '供應商未知'} · 還差 <span className='tabular-nums'>{remaining}</span> 件
            </span>
          </h3>
          <ReceiptRecordForm
            orderId={detail.id}
            orderItemId={item.id}
            procurementId={p.id}
            returnTo={returnTo}
            remaining={remaining}
            action={nextStepStubAction}
          />
        </section>
      ))}
    </div>
  );
}
