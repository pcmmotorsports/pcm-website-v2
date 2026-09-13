import type { AdminOrderDetailItem } from '@pcm/domain';

import { getAdminOrderRepository } from '../../lib/orders/order-repository';
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
// 🏁 **P-e-3(2026-09-13):接線 = 拿掉 `action={nextStepStubAction}`** ⇒ `ReceiptRecordForm` 走預設 = 明細頁那支 `recordItemReceiptAction`。
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

/** B14 表格的表頭(B9 多單版由 page 印一次、body 不印;單張單 body 自己印)。 */
export function ReceiptTableHeader({ withOrderNo = false }: { withOrderNo?: boolean }) {
  return (
    <div
      className='text-muted-foreground grid border-b text-[12px] leading-[1.4]'
      /* 🔴 與 `receipt-record-form.tsx` 表格列**同一串**(那支是 'use client',這裡 import 不了它的函式 ⇒ 兩處字面,`next-step-bodies.test.ts` 釘住一致)。 */
      style={{ gridTemplateColumns: withOrderNo ? 'auto 1fr 1fr 2fr auto auto auto' : '1fr 1fr 2fr auto auto auto' }}
      data-testid='receipt-table-header'
    >
      {withOrderNo && <span className='px-2 py-1'>單號</span>}
      <span className='px-2 py-1'>廠牌</span>
      <span className='px-2 py-1'>料號</span>
      <span className='px-2 py-1'>物品名稱</span>
      <span className='px-2 py-1 text-right'>訂</span>
      <span className='px-2 py-1'>到貨幾件</span>
      <span className='px-2 py-1' aria-hidden='true' />
    </div>
  );
}

export async function NextStepReceiptBody({
  orderId,
  returnTo,
  onlyItemIds,
  withOrderNo = false,
  header = true,
}: {
  orderId: string;
  /** 動作做完回哪裡 = 列表自己(不帶 `next`/`do`);action 端仍會過 `parseOrderReturnTo`。 */
  returnTo: string;
  /** B9 批次列:只列勾到的這幾樣(`?items=`);沒給 = 整張單(列上那顆鈕)。 */
  onlyItemIds?: readonly string[];
  /** B9 多單版:稿「到貨表多一欄單號」。 */
  withOrderNo?: boolean;
  /** 多單版 page 只印一次表頭 ⇒ 傳 false。 */
  header?: boolean;
}) {
  const detail = await getAdminOrderRepository().findAdminOrderDetail(orderId);
  if (!detail) {
    return <p className='text-muted-foreground text-sm'>找不到這張單。請關掉重新整理再試。</p>;
  }
  const items = onlyItemIds ? detail.items.filter((it) => onlyItemIds.includes(it.id)) : detail.items;
  /* 🔴 codex R1 nit(P-e-3):可操作集合要與明細頁同一份。明細頁(`item-procurement-rows.tsx:211`)在
     `truncated || voided` 時不給到貨入口,而 `truncated` 是 `item-procurement-section.tsx:245` 的
     `blocked = unreadable || truncated`。⇒ 這裡同一條:採購讀不到 / 被截斷的品項**整項不列**
     (列出一部分等於讓員工對著一份不完整的清單做事)。 */
  const rows = items.flatMap((item) =>
    item.procurements === null || item.procurementTruncated || detail.itemsTruncated
      ? []
      : item.procurements
      .filter((p) => p.voidedAt === null)
      .map((p) => ({ item, p, remaining: Math.max(0, p.allocatedQuantity - p.receivedQuantity) }))
      .filter((r) => r.remaining > 0),
  );
  if (rows.length === 0) {
    return (
      <p className='text-muted-foreground text-sm' data-testid='next-step-receipt-empty'>
        {withOrderNo ? `單號 ${detail.displayId}:` : ''}
        {onlyItemIds ? '勾到的這幾樣' : '這張單'}沒有還在等的採購 —— 沒訂過,或全部到齊了。要下訂請按「跟供應商下訂」。
      </p>
    );
  }
  /* 🎨 B14(稿 v22 彈窗 8,800 寬):一張表 —— 廠牌 / 料號 / 物品名稱 / 訂 / 到貨幾件(+ 全到勾),下面 什麼時候到的 · 溢收 · 備註 · 確認。
     🔴 一筆採購 = 一張表單(`recordItemReceiptAction` 一次一筆,零新寫入路)⇒ 多筆時第二行會逐列重複;
        一筆(絕大多數)長得跟稿一模一樣。多筆時每列上方帶供應商與還差幾件,兩張表單才分得開。
     ⚠️ 稿的摺疊「已登的到貨(撤銷在這裡)」沒做:撤銷要撈這張單的到貨紀錄(明細頁 `item-procurement-rows.tsx` 那條),另一片。 */
  return (
    <div className='next-step-body' data-testid='next-step-receipt-body'>
      {/* 欄寬 inline style(同 receipt-record-form 那一列;`.next-step-body .grid` 會壓 utility)。 */}
      {header && <ReceiptTableHeader withOrderNo={withOrderNo} />}
      {rows.map(({ item, p, remaining }) => (
        <div key={p.id} data-testid='receipt-row'>
          {rows.length > 1 && (
            <p className='text-muted-foreground px-2 pt-2 text-[12px] leading-[1.4]'>
              {itemLabel(item)} · {p.supplierLabel ?? '供應商未知'} · 還差 <span className='tabular-nums'>{remaining}</span> 件
            </p>
          )}
          <ReceiptRecordForm
            orderId={detail.id}
            orderItemId={item.id}
            procurementId={p.id}
            returnTo={returnTo}
            remaining={remaining}
            variant='table'
            row={{
              orderNo: withOrderNo ? detail.displayId : undefined,
              brand: item.brand,
              sku: item.variantSku,
              title: item.title,
              ordered: p.allocatedQuantity,
            }}
          />
        </div>
      ))}
    </div>
  );
}
