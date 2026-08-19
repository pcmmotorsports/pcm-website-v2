import { Fragment } from 'react';
import type { AdminOrderDetail, AdminOrderDetailItem, AdminOrderItemProcurement } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import {
  buildSupplierChoices,
  type SupplierOption,
} from '../../lib/orders/procurement-suppliers';
import { REPLY_STATUS_LABEL, unsourcedQuantity } from '../../lib/orders/procurement-view';
import { ItemProcurementForm } from './item-procurement-form';

// M-4b E10 A10b:訂單明細的採購區塊(server-render 清單 + 每個品項一份表單)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 🔴 **內部資料**:供應商身分 / 單號 / 異常原因是 service_role only
//    (`20260729020000:16-18`「一個 byte 都不能進 orders / order_items」)⇒ 本元件**只**能出現在
//    admin 明細頁(SSO 閘後);絕不可被搬進 storefront 的任何頁面。
// ⚠️ **「server-render」不等於資料沒進瀏覽器**(關卡2 codex nit,誠實更正):本元件把整個
//    `procurements` 當 props 傳給 client 元件 `ItemProcurementForm` ⇒ 它會被序列化進 RSC payload、
//    真的到了瀏覽器。可接受的理由是**這一頁本來就在 SSO 閘後、只有員工看得到**,
//    不是「它沒離開伺服器」。真正的邊界是 storefront 零投影(A9a-2 守門測試盯著三條列表投影)。

import { TruncationWarning, UnreadableWarning } from './item-procurement-warnings';
import { ProcurementRows } from './item-procurement-rows';

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
function UnsourcedNotice({ item }: { item: AdminOrderDetailItem }) {
  const unsourced = unsourcedQuantity(item.quantitySummary);

  if (unsourced === null) {
    return (
      <p className='text-muted-foreground mb-2 text-xs'>
        這個品項的數量資料還沒就緒,暫時算不出「還有幾件沒有登記來源」。
      </p>
    );
  }
  if (unsourced === 0) return null;

  return (
    <p
      role='status'
      className='mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      這個品項還有 <strong>{unsourced}</strong> 件沒有登記來源。請在下面補上要向誰訂
      (或選「店內現貨」),再登錄到貨。
    </p>
  );
}

/** 一列大約放得下的原因長度;超過就收進 `<details>`(數字是估的,見 `VoidReasonCell`)。 */
export function ItemProcurementSection({
  detail,
  returnTo,
  suppliers,
  suppliersFailed,
}: {
  detail: AdminOrderDetail;
  /**
   * #350d-3 C1:動作做完回哪裡 = **這個視圖自己的網址**。值不可信任:action 端一律再過
   * `parseOrderReturnTo`(站內白名單 + 剝一次性參數 + §6-1 同單比對)。
   */
  returnTo: string;
  /** S3a 讀模型(啟用中、zh-TW 排序);載入失敗時傳空陣列 + suppliersFailed */
  suppliers: readonly SupplierOption[];
  /** 供應商清單載入失敗 —— 🔴 不可靜默:選單空掉會讓員工以為「這家不存在」 */
  suppliersFailed: boolean;
}) {
  return (
    <section className={CARD}>
      <h2 className='text-muted-foreground mb-3 text-xs font-medium'>採購(向供應商訂貨)</h2>

      {detail.itemsTruncated && <TruncationWarning scope='order' />}

      {suppliersFailed && (
        <div
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border p-2.5 text-xs'
        >
          {/* 🔴 `#476` 片3:原字面是「已經用過的供應商」,而片3 之後有一格例外
              (**已停用 × 只剩作廢列** ⇒ 不列)⇒ 補「而且沒被作廢的」,否則這句是謊話。
              ⚠️ 兩關審查抓到的字面,不是我自己想到要改的。 */}
          供應商清單載入失敗,選單只會列出這張單已經用過、而且沒被作廢的供應商。請重新整理;
          在清單載入成功之前不要新增供應商,避免建立重複的資料。
        </div>
      )}

      <div className='space-y-4'>
        {detail.items.map((item) => {
          // 🔴 兩個旗標要一起讀(A9a-2 domain 註解):品項本身被截掉時,per-item 旗標會
          //    連同品項一起消失 ⇒ 外層為 true 時,每個品項都當作不可信。
          // 🔴 `#646`:三個狀態,而它們的【對員工的指示】不一樣,所以要分開算。
          //    · unreadable ⇒ 讀不到（暫時的）⇒ 重整真的可能會好
          //    · truncated  ⇒ 觸及固定上限     ⇒ 重整永遠不會好
          //    · blocked    ⇒ 兩者皆不得編輯（fail-closed 立場【沒有】變鬆:
          //      舊版 missing 會翻成 truncated=true 而擋住,拆開之後由 unreadable 接手擋)
          const unreadable = item.procurements === null;
          const rows = item.procurements ?? [];
          const truncated = item.procurementTruncated || detail.itemsTruncated;
          const blocked = unreadable || truncated;
          return (
            <div key={item.id} className='rounded-md border p-3'>
              <div className='mb-2 flex flex-wrap items-baseline gap-2'>
                <span className='text-sm font-medium'>{item.title ?? item.variantSku}</span>
                <span className='text-muted-foreground text-xs'>{item.variantSku}</span>
                <span className='text-muted-foreground ml-auto text-xs'>
                  訂單數量 {item.quantity}
                </span>
              </div>

              {/* 🔴 `#646`:兩個欄位回答兩個不同的問題,四種組合各有各的話要說。
                  `procurements === null` = 我手上沒有這份清單;`procurementTruncated` = 這是不是固定限制。
                  ⇒ 「沒讀到 + 固定」(品項落在 200 之外,`merge-detail-items.ts` 那條路)
                    **不可以叫員工重新整理** —— 重整永遠不會改變。 */}
              {/* 🔴🔴 `#646` 關卡2 codex 兩輪的結論:**「讀不到」這一種,我們沒有證據說它是哪個世界。**
                  第一版 `fixed={truncated}`(吃訂單層旗標)⇒ 把暫時的說成固定 —— MF2。
                  第二版改吃 `item.procurementTruncated` ⇒ 而那一欄可能是 `mergeDetailItems`
                  拿**訂單層**事實填的 ⇒ 繞一圈同一個病復發 —— codex round2。
                  ⇒ **不宣稱。** 這裡用條件句,而條件句在這裡是【證據到此為止】,不是偷懶。 */}
              {unreadable && <UnreadableWarning />}
              {!unreadable && item.procurementTruncated && !detail.itemsTruncated && (
                <TruncationWarning scope='item' />
              )}

              {/* 🔴 片1(Sean 2026-08-18 拍板 `08 訂單頁先批第一刀 = 甲`):
                  **零採購列的品項不再攤開一整組空白表單**,收進原生 `<details>`。
                  **為什麼**:一個什麼事都還沒發生的品項,原本佔 **475 px / 17 個表單控制項** ——
                  那個成本**與它有沒有事要做無關**。量測、環境限定與完整數字:
                  `docs/specs/2026-08-18-m4b-order-detail-product-card-plan.md` §2-b/§2-c、驗收 #4。

                  🔴 **條件是「零列【而且】沒被截斷」**:截斷時 `procurements` 也可能是空的,
                     而那是「**沒撈到**」不是「**沒有**」—— 兩者的下一步相反(下訂 vs 重整)。
                     ⚠️ **`truncated` 兩半都要**(`item.procurementTruncated || detail.itemsTruncated`):
                     `procurements: []` + `procurementTruncated: true` + `itemsTruncated: false`
                     是**真的生產路徑**(`merge-detail-items.ts:97-100`,品項落在 `ORDER_ITEMS_EMBED_LIMIT`
                     之外時逐字如此)⇒ **只擋訂單層那半會漏掉 Sean 那張 200 品項的單。**

                  🔴 **文案逐字取自 OD 定案稿** `pcm-admin-order-ui` / `overview-desktop.html:1061-1062`。
                     ⚠️ **形狀是【改過的】,不是照搬**:OD 那塊 tip 住在 `.segbody` 裡、CTA 是真 `<button>`,
                     開合器是另一顆 `.seghd`。本片**把 tip 本身變成開合器、CTA 變成 `<span>`** ——
                     ~~因為片 2/3(商品卡外殼與三段接線)**Sean 沒批**,那兩層還不存在。~~
                     🔴🔴 **2026-08-19 更正:上面那句已過期。Sean 【批了商品卡外殼】。**
                     依據:他當天看了**兩張真畫面**(卡片版 vs 表格展開列,同一張單、同一批資料、
                     真後台真樣式)之後逐字選 **「甲 = 卡片版(看得完整,但佔高度)」**。
                     ⇒ 這一裁**解掉了一個權威衝突**:`MAIN-057 §0.5` 記著他點頭「三件事收在同一張卡」,
                       而本行說「沒批」—— 兩份都寫過,而**沒有人知道他當初點頭涵蓋到哪裡**。
                       **他看圖之後自己選了,那個衝突不必再考證。**
                     ⚠️ **這一裁的邊界(不要讀寬)**:
                       ✅ 涵蓋 —— 採購資訊**收在卡片裡**這個形狀。
                       ❌ 不涵蓋 —— 卡片長什麼樣(圓角/間距/字級/收合行為)。**他看的是原型不是定稿。**
                       ❌ 不涵蓋 —— 他「接受了那個高度」這件事**是他知情選的**:括號是他自己講的
                          「看得完整,**但佔高度**」⇒ 🔴 **「三個品項佔半個畫面」不是待修的缺陷,
                          是他接受的取捨。不要為了省高度去砍資訊 —— 那會把他選甲的理由做掉。**
                     ⇒ **不要把這裡讀成「OD 就是這樣畫的」。** `▾` 是照 OD `:1042` 補回來的。

                  🔴🔴 **交棒給片 2/3 的一個地雷**:收合區內有 7 個 `required` 與 1 個 `<form>`,
                     而**唯一的送出鈕也在收合區內** ⇒ 今天產不出「送不出去又看不到錯在哪」那個死結。
                     **但只要有人照 OD 把 CTA 做成 `<details>` 外面的真 `<button>`(OD 正是那樣畫的),
                     或加任何 `form=` 的外部送出鈕,這條當場活過來。** 動它之前先想這件事。 */}
              {/* 🔴 `#646`:條件用 `blocked` 不是 `truncated` —— 讀不到時**不得**走這條路。
                  走了的話畫面會說「還沒跟任何供應商訂」,而真相是「我沒讀到」
                  ⇒ 那正是本片在修的病(「沒撈到」被講成「沒有」)。
                  舊版靠 missing 會翻成 truncated 才擋住,拆開之後這裡要自己擋。 */}
              {rows.length === 0 && !blocked ? (
                <details className='group'>
                  {/* 🔴 `UnsourcedNotice` 在這條路上**刻意不渲染**:它逐字說「請在下面補上要向誰訂」,
                      而「下面」現在是收起來的;件數也已經在卡頭的「訂單數量」那格。
                      ⇒ 兩塊琥珀框說同一件事 = Sean 這輪「**變少了沒有**」那個判準的反面。
                      **唯一保留的是它獨有的資訊**(自有庫存要選「店內現貨」),併進下面這一句。
                      ⚠️ 數量摘要**讀不到**時仍然要渲染它 —— 那句講的是「算不出來」,不是重複。 */}
                  <summary className='flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'>
                    <span className='transition-transform group-open:rotate-90'>▸</span>
                    <span>
                      還沒跟任何供應商訂,所以也還不能出貨。
                      <span className='text-muted-foreground ml-1'>(自有庫存選「店內現貨」)</span>
                    </span>
                    <span className='border-primary text-primary ml-auto rounded-md border px-2.5 py-1 font-medium'>
                      ＋ 跟供應商下訂
                    </span>
                  </summary>
                  <div className='mt-3'>
                    {unsourcedQuantity(item.quantitySummary) === null && (
                      <UnsourcedNotice item={item} />
                    )}
                    <ItemProcurementForm
                      orderId={detail.id}
                      returnTo={returnTo}
                      orderItemId={item.id}
                      procurements={rows}
                      supplierChoices={buildSupplierChoices(suppliers, rows)}
                      truncated={blocked}
                    />
                  </div>
                </details>
              ) : (
                <>
                  <UnsourcedNotice item={item} />

                  <ProcurementRows
                    item={item}
                    rows={rows}
                    unreadable={unreadable}
                    orderId={detail.id}
                    returnTo={returnTo}
                    truncated={blocked}
                  />

                  <ItemProcurementForm
                    orderId={detail.id}
                    returnTo={returnTo}
                    orderItemId={item.id}
                    procurements={rows}
                    supplierChoices={buildSupplierChoices(suppliers, rows)}
                    truncated={blocked}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
