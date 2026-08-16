// order-detail-items-table.tsx — 訂單明細頁的「品項」表格(M-4b E10 #13 片1c-2 版面片抽出)。
//
// 🔴 **為什麼在這一片抽**(鐵則 6:>400 行預設拆,不拆要寫理由):
//    `order-detail.tsx` **本片開工時 582 行**(`git show <本片前的 HEAD>:…|wc -l`,可驗);
//    接上展開列之後 600 行(**那個 600 沒有進 git**,任何人回頭量都量不到、別拿它當基準);
//    把這一塊抽走之後 **404 行**。
//    ⚠️ **404 仍然 > 400** —— 抽這一塊**沒有讓它達標**,只是把最大的一塊搬到它自己的檔。
//    下一塊(客戶資訊 / 收件與出貨 / 付款 / 發票四張卡 + `Field`)**留給另一片**,
//    前提是先查 `Field` 是不是只有那四張卡在用(**我沒查**)。
//
// 🔴🔴 **這個「寫理由」是【有期限的】,不是永久豁免**(主視窗 2026-08-16 裁):
//    現在 404 行、距 400 只有 **4 行** ⇒ **下一次任何人動 `order-detail.tsx`,
//    先抽下一塊再改,不得再走「寫理由」這條路徑。**
//    理由:那條路徑用第二次就變成慣例,而**慣例不會有人回頭檢查**。
//    ⚠️ 下一塊的前提仍是先查 `Field` 有沒有別的使用者(`grep "<Field"` 別檔 23 處命中,未分類)。
//
// 📎 旁證(主視窗 2026-08-16 量):`apps/admin/src/components` 底下 >400 行的**非測試**檔共 5 支 ——
//    741 `ui/sidebar.tsx` / 538 `orders/orders-table.tsx` / 463 `orders/shipment-dialog.tsx` /
//    404 本檔的來源 `orders/order-detail.tsx` / 403 `orders/item-procurement-form.tsx`。
//    ⇒ 「>400 就必拆」**不是本 repo 的實際共識**(403 那支沒有人管);
//      本片是這一輪**唯一主動減了 178 行**的。
//
// 🔴 **為什麼不是「另開一片專門拆檔」**:那條規矩的理由是「拆檔會蓋掉真正的改動」,
//    而**本片就是在改這一塊** ⇒ 兩者不再混淆,那個理由在這裡不成立。
//    ⇒ commit body 分兩段講(版面改動 / 抽檔),讓 reviewer 分得出哪些行是哪一件。
//
// 🔴 **本檔仍是 server component**(無 `'use client'`)——
//    唯一的 client 島是 `item-amount-row.tsx`,它只握「展開誰」那個狀態。

import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import type { PaymentListData } from './payment-list';
import { ItemAmountRow, ItemAmountRowGroup } from './item-amount-row';

export function ItemAxisCell({ summary }: { summary: AdminOrderItemQuantitySummary | null }) {
  // 型別是 `| null`,但這裡刻意用 falsy 判斷。
  // ⚠️ **2026-08-10 更正**(A13b D6-a R2 codex):原本寫「投影退版時這一欄會是 `undefined`」——
  //    **那句沒有依據**,`mappers/order.ts:542-544` 的 `mapQuantitySummary` 回 `| null`、
  //    產不出 `undefined`。falsy 判斷保留的理由只有「防手寫物件」與「兩種缺值處置相同」,
  //    不是在接住一個已知的產線值。(`cancel-view.ts` 同族註解已同步收窄。)
  if (!summary) {
    return <span className='text-muted-foreground text-xs'>數量資料尚未就緒</span>;
  }
  return (
    <div className='text-xs leading-5'>
      <div>
        訂貨{' '}
        <span className='tabular-nums'>
          {summary.orderedQuantity}/{summary.quantity}
        </span>
      </div>
      <div>
        到貨{' '}
        <span className='tabular-nums'>
          {summary.instockQuantity}/{summary.quantity}
        </span>
      </div>
      {summary.cancelledQuantity > 0 && (
        <div className='text-destructive'>
          已取消 <span className='tabular-nums'>{summary.cancelledQuantity}</span>
        </div>
      )}
    </div>
  );
}

/**
 * 🔴 **改金額能不能開放,在這裡先判一次**(R3/fable F2)。
 *
 * **為什麼要在 UI 判**:house 工作流**收款排第一**(Sean 2026-08-12 拍板)
 * ⇒ 員工手上的單**多半已收款** ⇒ 若每張單每個品項都給一個可以按的框,
 * **這個表單最常見的使用結果就是「被拒絕 + 一句模糊文案」**。
 * ⇒ 違反 Sean 2026-08-11 常設驗收「**不用人教能做對**」。
 *
 * 🔴 **disabled + 就地寫明原因,不是隱藏** —— 隱藏會讓員工找不到而懷疑自己。
 *
 * ⚠️ **這是 advisory,不是保證**(同 `cancellationPaymentTrace` 那段的處置):
 * 讀到這個判斷與員工按下去之間,隨時可能多一筆收款。
 * **權威永遠是 RPC 在交易內的重查**(`20260815040000:388`)⇒ **RPC 回拒是正常路徑**,
 * 由 banner 兜底,不是「不該發生」的例外。
 */
export function resolveAmountEditBlock(
  detail: AdminOrderDetail,
  payments: PaymentListData,
): string | null {
  // 🔴 讀不到收款時 **fail-closed**:`'unreadable'` 的語意是「**不知道有沒有**」,不是「沒有」。
  if (payments.status === 'unreadable') {
    return '付款紀錄讀取不完整,暫時不開放改金額。請重新整理;若持續如此請找系統維護。';
  }
  if (payments.status === 'order_not_found') {
    return '讀不到這張訂單的收款紀錄,暫時不開放改金額。';
  }
  if (payments.rows.length > 0) {
    // RPC `:388` 逐字:有**任何一列**收款就拒(不使用任何金額口徑)。
    return '這張單已經有收款紀錄,不開放改金額。需要調整請走退款流程,或告知系統維護。';
  }
  if (detail.discountTotal.amount !== 0) {
    // RPC `:398`:本功能尚未處理折扣單的改價(母 plan 已知限制 L2)。
    return '這張單有折扣,目前還不支援改金額。請告知系統維護。';
  }
  return null;
}

/**
 * 🔴 品項表的欄數。**展開列的 `colSpan` 與表頭欄數必須一致** ——
 * 不一致時瀏覽器會靜默把版面畫歪(不會有任何東西紅)⇒ 抽成常數,並由測試釘住它等於表頭 `<th>` 數。
 */
export const ITEMS_TABLE_COLSPAN = 6;

export function ItemsTable({
  detail,
  payments,
}: {
  detail: AdminOrderDetail;
  payments: PaymentListData;
}) {
  const amountEditBlock = resolveAmountEditBlock(detail, payments);
  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';
  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>品項</th>
            <th className={TH}>SKU</th>
            <th className={`${TH} text-right`}>數量</th>
            <th className={`${TH} text-right`}>單價</th>
            <th className={`${TH} text-right`}>小計</th>
            {/* 取消那一列只在 >0 時出現(0 件取消是常態、每列印一個 0 是噪音),欄名仍列出來 */}
            <th className={TH}>訂貨 · 到貨 · 取消</th>
          </tr>
        </thead>
        <ItemAmountRowGroup>
        <tbody>
          {detail.items.map((item) => (
            // 🔴 #13 片1c-2 版面片:改金額的表單**移出單價格、展開成跨欄的一列**。
            //    那六格的內容仍在**這裡(server)**算好、當 ReactNode 傳進去;
            //    `ItemAmountRow` 只握「展開誰」那個 client state ⇒ **本檔仍是 server component**。
            <ItemAmountRow
              key={item.id}
              rowClassName='border-t'
              colSpan={ITEMS_TABLE_COLSPAN}
              priceCellClassName={`${TD} text-right tabular-nums whitespace-nowrap`}
              before={
                <>
                  <td className={TD}>
                    <div>{item.title ?? '—'}</div>
                    {item.spec && (
                      <div className='text-muted-foreground mt-0.5 text-xs'>
                        {Object.entries(item.spec)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                    {item.variantSku}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{item.quantity}</td>
                </>
              }
              priceText={<>NT$ {formatOrderAmount(item.unitPrice.amount)}</>}
              after={
                <>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                    NT$ {formatOrderAmount(item.lineTotal.amount)}
                  </td>
                  {/* A9w1:九碼下拉退場 → 三軸數量(唯讀;訂貨的「改」在下方採購區塊 A10b) */}
                  <td className={`${TD} whitespace-nowrap`}>
                    <ItemAxisCell summary={item.quantitySummary} />
                  </td>
                </>
              }
              // 🔴 版本用**訂單層**的 `detail.version`,不是品項的 —— RPC 的樂觀鎖比 `v_ord.version`,
              //    而 `AdminOrderDetailItem` 自 A9w3 起就沒有 version 欄。
              orderId={detail.id}
              expectedVersion={detail.version}
              orderItemId={item.id}
              currentUnitPrice={item.unitPrice.amount}
              returnTo={`/orders/${detail.id}`}
              // 🔴 **重構時最容易掉的就是這一行** —— 它是 `unreadable` 的 fail-closed 出口。
              blockedReason={amountEditBlock}
            />
          ))}
        </tbody>
        </ItemAmountRowGroup>
        <tfoot className='border-t text-sm'>
          <tr>
            <td colSpan={4} className='text-muted-foreground px-3 py-1.5 pt-3 text-right'>
              小計
            </td>
            <td className='px-3 py-1.5 pt-3 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.subtotal.amount)}
            </td>
            <td />
          </tr>
          <tr>
            <td colSpan={4} className='text-muted-foreground px-3 py-1.5 text-right'>
              運費
            </td>
            <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.shippingFee.amount)}
            </td>
            <td />
          </tr>
          {detail.discountTotal.amount > 0 && (
            <tr>
              <td colSpan={4} className='text-muted-foreground px-3 py-1.5 text-right'>
                折扣
              </td>
              <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
                −NT$ {formatOrderAmount(detail.discountTotal.amount)}
              </td>
              <td />
            </tr>
          )}
          <tr className='border-t font-medium'>
            <td colSpan={4} className='px-3 py-2 text-right'>
              總計
            </td>
            <td className='px-3 py-2 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.total.amount)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

