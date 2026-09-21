import type { ReactNode } from 'react';
import type { AdminOrderDetailItem } from '@pcm/domain';

import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { listSuppliers } from '../../lib/supplier';
import { buildSupplierChoices } from '../../lib/orders/procurement-suppliers';
import { ItemProcurementForm } from './item-procurement-form';
import { ProcurementVoidButton } from './procurement-void-button';

// next-step-procurement-body.tsx — 列表「下一步 = 跟供應商下訂」彈窗的【內容】(P-e-2,2026-09-13)。
//
// 🔴🔴 **`?next=<單號>&do=order` 打開的是【表單】,不是動作。** 貼一個網址不會寫進任何東西;
//    寫入只發生在他按下「確認」那一刻。（`docs/plans/2026-09-13-next-step-button-write-plan.md` §0）
//
// ── 形狀(規格 `規格-側欄與訂單明細容器-v1.md` §3-f-2 七條)─────────────────────
//   ③ 內容只放這個動作要輸入的格子 ⇒ 每一樣一份 `ItemProcurementForm` **compact**(稿 v22 那四格:供應商 / 訂購數量 /
//      供應商單號 / 預計到貨日;其餘欄位 hidden 原值帶著走),沒有採購歷史、到貨列、摘要句。
//      Sean 2026-09-13 晚逐字「彈窗也要變得跟新版一樣,小小的,不用這麼巨大」—— 第一版復用整份表單,3 樣疊到 1003px。
//   ① 網址驅動、server 端渲染 ⇒ 本檔是 server component,**自己 await 資料**(殼與 page 都不必先撈)。
//
// 🔴 **復用明細頁那份表單,不重寫**:`ItemProcurementForm` 原樣,只多傳 `action`。
//    兩份同樣的表單是第二份真相 —— 明細頁與彈窗印出不同的欄位是最難查的那種。
// 🏁 **P-e-3(2026-09-13):接線 = 把 `action={nextStepStubAction}` 那個 prop 拿掉** ⇒ `ItemProcurementForm` 走它的預設
//    = 明細頁那支 `upsertItemProcurementAction`。**同一支 action、同一份表單元件、同一組欄位** —— 沒有第二條寫入路。
//    守門 `next-step-bodies.test.ts`:本檔不准 import `procurement-actions`。
//
// ⚠️ **一張單多樣 ⇒ 多份表單**(Sean:多樣每樣一列各自填)。`orderNextStep` 判「下訂」是看**整張單**
//    的貨品軸(`none` = 沒有任何一樣訂過),而這裡把**每一樣**都列出來 —— 已經訂過的那幾樣表單照樣出現,
//    因為 `admin_upsert_item_procurement` 本來就是 upsert,再送一次是「改」不是「重複下訂」。

function itemLabel(item: AdminOrderDetailItem): string {
  const name = item.title ?? item.variantSku;
  return item.brand ? `${item.brand} · ${name}` : name;
}

type Parts = { rows: ReactNode; folds: ReactNode };
type Props = {
  orderId: string;
  /** 動作做完回哪裡 = 列表自己(不帶 `next`/`do`);由 page 算好傳進來,action 端仍會過 `parseOrderReturnTo`。 */
  returnTo: string;
  /** B9 批次列:只列勾到的這幾樣(`?items=`);沒給 = 整張單(列上那顆鈕)。 */
  onlyItemIds?: readonly string[];
  /** B9 多單版:每一樣前面印單號,兩張單的表單才分得開。 */
  withOrderNo?: boolean;
};

/**
 * 整個 body = `<>{rows}{folds}</>`。
 * 🔴 B9-b:page 把 `rows` 包進 `NextStepBatchForm`(一張 form),`folds`(作廢摺疊,每筆自帶 form、各自送、各自冪等鍵)
 *    放在那張 form **外面** —— 包進去 = 巢狀 form,HTML 不允許,瀏覽器會把內層拆掉(主視窗 2026-09-14 合體抓到)。
 *    一次 `findAdminOrderDetail`,兩塊共用。
 */
export async function NextStepProcurementBody(props: Props) {
  const { rows, folds } = await loadNextStepProcurementParts(props);
  return (
    <>
      {rows}
      {folds}
    </>
  );
}

export async function loadNextStepProcurementParts({ orderId, returnTo, onlyItemIds, withOrderNo = false }: Props): Promise<Parts> {
  const [detail, suppliers] = await Promise.all([
    getAdminOrderRepository().findAdminOrderDetail(orderId),
    listSuppliers(),
  ]);
  if (!detail) {
    return { rows: <p className='text-muted-foreground text-sm'>找不到這張單。請關掉重新整理再試。</p>, folds: null };
  }
  const items = onlyItemIds ? detail.items.filter((it) => onlyItemIds.includes(it.id)) : detail.items;
  if (items.length === 0) {
    return {
      rows: (
        <p className='text-muted-foreground text-sm'>
          {withOrderNo ? `單號 ${detail.displayId}:` : ''}
          {onlyItemIds ? '勾到的品項不在這張單上了。關掉重新整理再勾一次。' : '這張單沒有品項,沒有東西可以下訂。'}
        </p>
      ),
      folds: null,
    };
  }
  const rows = (
    <div className='next-step-body space-y-3' data-testid='next-step-procurement-body'>
      {items.map((item) => {
        /* 🔴🔴 **codex R1 must-fix M1(P-e-3,2026-09-13):封鎖條件要與明細頁【逐字相同】。**
           明細頁(`item-procurement-section.tsx:135`)是 `blocked = unreadable || truncated`,而本檔第一版
           把 `procurements === null`(投影**讀不到**)靜靜轉成 `[]`、只擋 truncated
           ⇒ 讀不到採購時,彈窗會用**空資料**初始化表單 ⇒ 員工選了既有供應商送出,`stale=0` 過得了 action、
             `preserveOptionalFields=false` 讓**空白的單號 / 異常原因 / 預計到貨日覆蓋既有值**。
           📌 「讀不到」與「真的沒有」在 `?? []` 之後長得一樣 —— 而只有前者會蓋掉別人填過的東西。 */
        const unreadable = item.procurements === null;
        const rows = item.procurements ?? [];
        const truncated = item.procurementTruncated || detail.itemsTruncated;
        return (
          <section key={item.id} className='rounded-md border p-3'>
            <h3 className='text-sm font-medium'>
              {withOrderNo && <span className='mr-2 font-mono text-xs font-bold'>{detail.displayId}</span>}
              {itemLabel(item)}
              <span className='text-muted-foreground ml-2 text-xs tabular-nums'>×{item.quantity}</span>
            </h3>
            {unreadable ? (
              <p className='text-muted-foreground mt-2 text-xs' data-testid='next-step-procurement-unreadable'>
                這個品項的採購資料載入失敗，暫時無法下訂。請關閉視窗並重新整理；若仍無法載入，請開啟訂單明細查看。
              </p>
            ) : (
              <ItemProcurementForm
                orderId={detail.id}
                returnTo={returnTo}
                orderItemId={item.id}
                procurements={rows}
                supplierChoices={buildSupplierChoices(suppliers, rows)}
                truncated={truncated}
                compact
                defaultAllocatedQuantity={item.quantity}
                batchRowId={item.id}
              />
            )}
          </section>
        );
      })}
    </div>
  );
  const folds = (
    <div className='next-step-body'>
      {/* 🆕 稿 v22 彈窗 7 的摺疊「已下的採購(作廢在這裡)」(2026-09-14):每一筆【生效中】的採購一列,內摺 作廢 → 理由 + 紅鈕。
          🔴 這是 `admin_void_item_procurement` 的第一條呼叫路(action 檔頭有那段 plan);列的資料就是上面表單已經在用的
             `item.procurements`(同一次 findAdminOrderDetail),讀不到 / 被截斷的品項不列(列一半會讓員工對著不完整的清單作廢)。
          🔴 已作廢的不列(它們不是「已下的採購」);有到貨的照列 —— 按下去 RPC 會回 HAS_RECEIPTS_UNDO_FIRST、零寫入,鈕上那句話告訴他先撤到貨。 */}
      {(() => {
        const active = items.flatMap((item) =>
          item.procurements === null || item.procurementTruncated || detail.itemsTruncated
            ? []
            : item.procurements.filter((p) => p.voidedAt === null).map((p) => ({ item, p })),
        );
        return (
          <details className='border-t pt-2' data-testid='next-step-procurement-voids'>
            <summary className='cursor-pointer text-[12.5px] leading-[1.4] font-semibold'>已下的採購(作廢在這裡)</summary>
            {detail.itemsTruncated && (
              <p className='text-destructive mt-2 text-[12.5px] leading-[1.4]'>這張單品項太多,這裡只列得出前面的;完整的採購請進明細頁看。</p>
            )}
            {active.length === 0 ? (
              <p className='text-muted-foreground mt-2 text-[12.5px] leading-[1.4]'>
                {detail.itemsTruncated || items.some((it) => it.procurements === null || it.procurementTruncated)
                  ? '部分採購資料無法完整載入，目前無法確認所有採購紀錄。需要作廢採購時，請開啟訂單明細處理。'
                  : '這張單目前沒有生效中的採購。'}
              </p>
            ) : (
              <ul className='mt-2 space-y-1.5 text-[12.5px] leading-[1.4]'>
                {active.map(({ item, p }) => (
                  <li key={p.id} className='flex flex-wrap items-baseline gap-x-2' data-testid='procurement-void-row'>
                    <span>{itemLabel(item)}</span>
                    <span className='text-muted-foreground'>
                      {p.supplierLabel ?? '供應商未知'} · 訂 <span className='tabular-nums'>{p.allocatedQuantity}</span> · 到 <span className='tabular-nums'>{p.receivedQuantity}</span>
                    </span>
                    <ProcurementVoidButton
                      procurementId={p.id}
                      orderId={detail.id}
                      returnTo={returnTo}
                      doneHref={returnTo}
                      label={`${p.supplierLabel ?? '供應商未知'} ${p.allocatedQuantity} 件`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </details>
        );
      })()}
    </div>
  );
  return { rows, folds };
}
