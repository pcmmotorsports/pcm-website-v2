import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminOrderDetail } from '@pcm/domain';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { isOrderId } from '../../lib/orders/order-detail-view';
import { isRefundUiEnabled } from '../../lib/payment/refund-ui-flag';
import {
  getLedgerUnregisteredAmount,
  listOrderRefunds,
  type OrderRefundRow,
} from '../../lib/payment/refund-read';
import { listSuppliers } from '../../lib/supplier';
import { OrderDetail } from './order-detail';
import { ResultBanner } from './result-banner';

// order-detail-route.tsx — #350c:訂單明細的**載入 + 組裝**,兩個消費者共用。
//
// 🔴 為什麼抽出來:面板版(`app/@panel/orders/page.tsx`)與整頁版(`app/orders/[id]/page.tsx`)
//    要跑**完全相同**的三路 `Promise.allSettled` 與四組容錯旗標。複製一份 = 兩邊會慢慢分岔,
//    而分岔的其中一條是**退款入口的 fail-closed 判斷**(帳本讀不到就不准按退款)——
//    那不是可以有兩個版本的東西。
//
// 🔴 本檔**沒有 `'use client'`**:它與 `OrderDetail` 一樣是 server component
//    (PII 白名單投影 + server action 全部留在 server,鐵則 12 ②)。
//
// 🔴 `missing` 是兩個消費者**唯一**的行為差異(主視窗 2026-08-10 裁⑤「notFound 面板自理」):
//    整頁版查無 → `notFound()`(整頁 404,既有行為);
//    面板版查無 → **面板內一句話**,不得 `notFound()` —— 在平行路由槽裡呼叫它會把
//    **整個頁面**打成 root 404,員工手上的列表會整片消失,只因為某張單被刪了。

/** 讀取失敗(非查無)的共用文案 —— 兩個消費者都用這一份,不各寫一句。 */
const LOAD_FAILED_TEXT = '訂單明細載入失敗,請稍後再試或聯絡系統維護。';

export async function OrderDetailRoute({
  id,
  resultCode,
  correctNoteId,
  back,
  missing,
}: {
  id: string;
  resultCode: string | undefined;
  correctNoteId: string | null;
  /** 返回連結:整頁版 = 回列表;面板版 = 關閉面板(同一份列表 href、不帶 `panel`)。 */
  back: { href: string; label: string };
  missing: 'not-found' | 'inline';
}) {
  // id 形狀守門:非 UUID 不打 DB(路由參數不透傳查詢)。
  if (!isOrderId(id)) {
    if (missing === 'not-found') notFound();
    return <PanelMessage text='找不到這張訂單。' back={back} />;
  }

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 依 `missing` 分流。
  // A10b:供應商選單與明細**各自容錯** —— 供應商壞掉不該讓整頁看不了,但也**不得靜默**:
  // 空選單會讓員工以為「這家不存在」而去建重複的供應商,而供應商不可刪除(`lib/supplier.ts:22-26`)。
  let detail: AdminOrderDetail | null = null;
  let suppliers: SupplierOption[] = [];
  let suppliersFailed = false;
  let loadFailed = false;
  // M-3 RW3:退款帳本(獨立容錯,不靜默 —— 藏掉 processing 滯留列比整頁掛掉更糟)。
  // 🔴 兩種讀取健康各自成旗標(codex MF2):任一失敗 ⇒ 退款發起入口 fail-closed
  //    (order-detail 掛載閘),不只顯示警告 —— 看不見帳本現況時放人按退款=盲飛。
  let refunds: OrderRefundRow[] = [];
  let refundsFailed = false;
  let refundsTruncated = false;
  let refundUnregisteredAmount: number | null = null;
  let refundUnregisteredFailed = false;
  const [detailSettled, suppliersSettled, refundsSettled] = await Promise.allSettled([
    (async () => getAdminOrderRepository().findAdminOrderDetail(id))(),
    (async () => listSuppliers())(),
    (async () => listOrderRefunds(id))(),
  ]);
  if (detailSettled.status === 'fulfilled') {
    detail = detailSettled.value;
  } else {
    console.error('[admin/order-detail] 訂單明細載入失敗', detailSettled.reason);
    loadFailed = true;
  }
  if (suppliersSettled.status === 'fulfilled') {
    suppliers = suppliersSettled.value;
  } else {
    console.error('[admin/order-detail] 供應商清單載入失敗(採購選單只剩既有供應商)', suppliersSettled.reason);
    suppliersFailed = true;
  }
  if (refundsSettled.status === 'fulfilled') {
    refunds = refundsSettled.value.rows;
    refundsTruncated = refundsSettled.value.truncated;
    // 有帳本列才查未登記額(零列時該數=訂單總額,無資訊、省一趟)。
    if (refunds.length > 0) {
      try {
        refundUnregisteredAmount = await getLedgerUnregisteredAmount(id);
      } catch (error) {
        // 🔴 失敗≠查無(codex MF2):壓成 null 會顯示成普通「查無」被照著操作。
        console.error('[admin/order-detail] 帳本未登記額查詢失敗(顯錯誤態+入口 fail-closed)', error);
        refundUnregisteredFailed = true;
      }
    }
  } else {
    console.error('[admin/order-detail] 退款帳本載入失敗(區塊顯示警告、入口 fail-closed)', refundsSettled.reason);
    refundsFailed = true;
  }

  if (!loadFailed && detail === null) {
    if (missing === 'not-found') notFound();
    return <PanelMessage text='找不到這張訂單(可能已被刪除)。' back={back} />;
  }

  return (
    <>
      <BackLink back={back} />

      <ResultBanner code={resultCode} />

      {loadFailed || detail === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          {LOAD_FAILED_TEXT}
        </div>
      ) : (
        <OrderDetail
          detail={detail}
          correctNoteId={correctNoteId}
          suppliers={suppliers}
          suppliersFailed={suppliersFailed}
          refundEnabled={isRefundUiEnabled()}
          refunds={refunds}
          refundsFailed={refundsFailed}
          refundsTruncated={refundsTruncated}
          refundUnregisteredAmount={refundUnregisteredAmount}
          refundUnregisteredFailed={refundUnregisteredFailed}
        />
      )}
    </>
  );
}

function BackLink({ back }: { back: { href: string; label: string } }) {
  return (
    <Link
      href={back.href}
      className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
    >
      {back.label}
    </Link>
  );
}

function PanelMessage({ text, back }: { text: string; back: { href: string; label: string } }) {
  return (
    <>
      <BackLink back={back} />
      <div className='text-muted-foreground rounded-lg border p-6 text-sm'>{text}</div>
    </>
  );
}
