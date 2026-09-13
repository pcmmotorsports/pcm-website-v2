import type { AdminOrderDetailItem } from '@pcm/domain';

import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { listSuppliers } from '../../lib/supplier';
import { buildSupplierChoices } from '../../lib/orders/procurement-suppliers';
import { nextStepStubAction } from '../../lib/orders/next-step-stub-action';
import { ItemProcurementForm } from './item-procurement-form';

// next-step-procurement-body.tsx — 列表「下一步 = 跟供應商下訂」彈窗的【內容】(P-e-2,2026-09-13)。
//
// 🔴🔴 **`?next=<單號>&do=order` 打開的是【表單】,不是動作。** 貼一個網址不會寫進任何東西;
//    寫入只發生在他按下「確認」那一刻。（`docs/plans/2026-09-13-next-step-button-write-plan.md` §0）
//
// ── 形狀(規格 `規格-側欄與訂單明細容器-v1.md` §3-f-2 七條)─────────────────────
//   ③ 內容只放這個動作要輸入的格子 ⇒ 每一樣一份 `ItemProcurementForm`,**沒有**採購歷史、到貨列、摘要句。
//   ① 網址驅動、server 端渲染 ⇒ 本檔是 server component,**自己 await 資料**(殼與 page 都不必先撈)。
//
// 🔴 **復用明細頁那份表單,不重寫**:`ItemProcurementForm` 原樣,只多傳 `action`。
//    兩份同樣的表單是第二份真相 —— 明細頁與彈窗印出不同的欄位是最難查的那種。
// 🔴 **零寫入(P-e-2)**:`action={nextStepStubAction}`,接線(P-e-3)= 把這個 prop 拿掉。
//    守門 `next-step-bodies.test.ts`:本檔不准 import `procurement-actions`。
//
// ⚠️ **一張單多樣 ⇒ 多份表單**(Sean:多樣每樣一列各自填)。`orderNextStep` 判「下訂」是看**整張單**
//    的貨品軸(`none` = 沒有任何一樣訂過),而這裡把**每一樣**都列出來 —— 已經訂過的那幾樣表單照樣出現,
//    因為 `admin_upsert_item_procurement` 本來就是 upsert,再送一次是「改」不是「重複下訂」。

function itemLabel(item: AdminOrderDetailItem): string {
  const name = item.title ?? item.variantSku;
  return item.brand ? `${item.brand} · ${name}` : name;
}

export async function NextStepProcurementBody({
  orderId,
  returnTo,
}: {
  orderId: string;
  /** 動作做完回哪裡 = 列表自己(不帶 `next`/`do`);由 page 算好傳進來,action 端仍會過 `parseOrderReturnTo`。 */
  returnTo: string;
}) {
  const [detail, suppliers] = await Promise.all([
    getAdminOrderRepository().findAdminOrderDetail(orderId),
    listSuppliers(),
  ]);
  if (!detail) {
    return <p className='text-muted-foreground text-sm'>找不到這張單。請關掉重新整理再試。</p>;
  }
  const items = detail.items;
  if (items.length === 0) {
    return <p className='text-muted-foreground text-sm'>這張單沒有品項,沒有東西可以下訂。</p>;
  }
  return (
    <div className='next-step-body space-y-3' data-testid='next-step-procurement-body'>
      {items.map((item) => {
        const rows = item.procurements ?? [];
        return (
          <section key={item.id} className='rounded-md border p-3'>
            <h3 className='text-sm font-medium'>
              {itemLabel(item)}
              <span className='text-muted-foreground ml-2 text-xs tabular-nums'>×{item.quantity}</span>
            </h3>
            <ItemProcurementForm
              orderId={detail.id}
              returnTo={returnTo}
              orderItemId={item.id}
              procurements={rows}
              supplierChoices={buildSupplierChoices(suppliers, rows)}
              truncated={item.procurementTruncated || detail.itemsTruncated}
              action={nextStepStubAction}
            />
          </section>
        );
      })}
    </div>
  );
}
