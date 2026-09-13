import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { InvoiceCheatSheetPanel } from './invoice-cheatsheet-panel';
import { NextStepDialog } from './next-step-dialog';

// invoice-cheatsheet-dialog.tsx — `?invoice=<id>` ⇒ 發票小抄彈窗(server component)。
//
// 🔴 **殼借 `NextStepDialog`(施工窗 P-e-1), 一個字沒改**:開 / 關 / 焦點 / 網址那四件它做對了,
//    再寫一個殼 = 第二份實作。它「不知道裡面是什麼」正是它能被借的理由。
// 🔴 **這一支是 server component** —— 它撈明細(`findAdminOrderDetail`)再把 `detail` 餵給 panel;
//    殼是 client(要 `showModal()`), panel 是 client(二聯 / 三聯的 useState)。三層分工:
//      page(server, 解析網址)→ 本檔(server, 撈資料)→ 殼(client)→ panel(client)
// 🔴 **只開表單不寫入**(`ORDER_INVOICE_PARAM` docstring):貼這條網址不會改任何東西。
//
// 🔵 兩個頁都掛它(列表就地展開 `orders/page.tsx` + 整頁 `orders/[id]/page.tsx`):
//    明細裡那顆「開發票小抄」連結是 `buildInvoiceHref(returnTo, id)`, 而 `returnTo` 在兩頁各是
//    「這個視圖自己的網址」⇒ 兩頁**都要**會認 `?invoice=`, 否則整頁版那顆連結是死的。

export async function InvoiceCheatSheetDialog({
  orderId,
  closeHref,
  returnTo,
}: {
  /** 已過 uuid 閘(page 層)。 */
  orderId: string;
  /** 關掉之後去哪 = 同一頁、不帶 `invoice`。 */
  closeHref: string;
  /** panel 那張 form 的 return_to = 這個視圖自己(含 `open=` 等), 動作做完那張單還開著。 */
  returnTo: string;
}) {
  let detail = null;
  try {
    detail = await getAdminOrderRepository().findAdminOrderDetail(orderId);
  } catch (e) {
    // 讀不到 ⇒ 印一句, 不炸整頁(同 `orders/page.tsx` 對 `open=` 存在檢查的態度)。
    console.error('[admin/orders] invoice= 撈明細失敗', e);
  }
  // `inlineCancel` 只在 panel 真的畫出來時給:讀不到那一句沒有表單、沒有自己的取消 ⇒ 殼要畫它的 footer,
  // 不然那個彈窗一顆鈕都沒有(1440 真瀏覽器撞到:probe 的表缺 `orders.invoice_issued_at` 就是這一態)。
  return (
    <NextStepDialog
      // 🔬 v20 稿標題列「發票 · 單號 · 客人」;撈不到明細時只剩「發票」(下面那句 alert 會說原因)。
      title={detail === null ? '發票' : `發票 · ${detail.displayId} · ${detail.customer.name ?? '—'}`}
      closeHref={closeHref}
      inlineCancel={detail !== null}
    >
      {detail === null ? (
        <p role='alert' className='text-destructive text-sm'>
          找不到這張單, 或讀取失敗。請關掉重新整理;還是一樣就通知系統維護。
        </p>
      ) : (
        <InvoiceCheatSheetPanel detail={detail} returnTo={returnTo} />
      )}
    </NextStepDialog>
  );
}
