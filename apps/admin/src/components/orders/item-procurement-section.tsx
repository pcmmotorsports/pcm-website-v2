import { Fragment } from 'react';
import { DetailsScrollOnOpen } from './danger-zone-details';
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

/**
 * 🔴🔴 **片7(2026-08-19):採購從「獨立一張卡」搬進【每個商品自己的卡片展開區】。**
 *
 * **依據**:Sean 2026-08-19 看兩張真畫面後逐字選「**甲 = 卡片版(看得完整,但佔高度)**」;
 * 而那一裁的邊界(不要讀寬)已經寫在下方 `#646` 那段註解裡 —— ✅ 涵蓋「採購資訊收在卡片裡」
 * 這個**形狀**;❌ 不涵蓋卡片長什麼樣。
 *
 * ⇒ 本檔因此拆成**兩個**匯出,而拆法是照「這句話是對誰說的」分的:
 *   · `ItemProcurementOrderNotices` —— **對整張單說的**(品項被截斷 / 供應商清單載入失敗)
 *   · `ItemProcurementBlock`        —— **對某一個品項說的**(採購列 + 登錄表單)
 * 🔴 **訂單層那兩則不可以跟著搬進卡片裡** —— 它們一旦被複製到每一張卡,同一句警告會出現 N 次,
 *    而「供應商清單載入失敗」講的是**整個選單**壞了,不是這一項的事。
 * ⚠️ **也不可以就這樣丟掉**:`suppliersFailed` 那則是 `#476` 片3 兩關審查改過字面的東西,
 *    沒有它,員工會以為「這家供應商不存在」而去新增一筆重複資料。
 *
 * 🔴 **品項標題那一列(品名 / 料號 / 訂單數量)在本檔【刪掉了】** —— 不是漏搬:
 *    卡片本身的那一行已經有品名、料號與數量(`order-detail-items-table.tsx` 的六格),
 *    留著會變成同一張卡裡上下兩行講同一件事。
 */
export function ItemProcurementOrderNotices({
  detail,
  suppliersFailed,
}: {
  detail: AdminOrderDetail;
  /** 供應商清單載入失敗 —— 🔴 不可靜默:選單空掉會讓員工以為「這家不存在」 */
  suppliersFailed: boolean;
}) {
  if (!detail.itemsTruncated && !suppliersFailed) return null;
  return (
    <>
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
    </>
  );
}

/** 一列大約放得下的原因長度;超過就收進 `<details>`(數字是估的,見 `VoidReasonCell`)。 */
export function ItemProcurementBlock({
  detail,
  item,
  returnTo,
  suppliers,
}: {
  detail: AdminOrderDetail;
  /** 🔴 這一張卡對應的那個品項 —— 由 `ItemsTable` 在 `map` 裡傳進來。 */
  item: AdminOrderDetailItem;
  /**
   * #350d-3 C1:動作做完回哪裡 = **這個視圖自己的網址**。值不可信任:action 端一律再過
   * `parseOrderReturnTo`(站內白名單 + 剝一次性參數 + §6-1 同單比對)。
   */
  returnTo: string;
  /** S3a 讀模型(啟用中、zh-TW 排序);載入失敗時傳空陣列 + suppliersFailed */
  suppliers: readonly SupplierOption[];
}) {
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
    <div className='mt-1'>
      {/* 🔴 標題字面**逐字沿用**搬家前那張卡的 h2(「採購(向供應商訂貨)」)——
          不是為了讓既有守門繼續綠,是因為**員工看到的字不該因為版面搬家而換掉**。
          ⚠️ 而它從 `<h2>`(一張卡的標題)降成 `<h3>`:它現在住在商品卡裡面,
             不再是頁面層級的一個區塊 ⇒ 標題層級要跟著,否則螢幕閱讀器的大綱會多出 N 個同級標題。 */}
      <h3 className='text-muted-foreground mb-2 text-xs font-medium'>採購(向供應商訂貨)</h3>
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
                <DetailsScrollOnOpen className='group'>
                  {/* 🔴 `#701`:換掉原生 `<details>` 的唯一理由是**展開之後那塊會長在畫面外**
                      —— 使用者按下去,視野裡一格都沒變 ⇒ 讀成「沒反應」。
                      本檔是 **server component**、掛不了 `onToggle` ⇒ 借那支 client 殼,
                      而 `<summary>` 與所有 class **原封不動**(改 JSX 結構的風險大於收益)。
                      ⚠️ **這一發沒有真瀏覽器證據** —— 見 `danger-zone-details.tsx` 檔頭那段證據降級。 */}
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
                </DetailsScrollOnOpen>
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

                  {/* 🔴🔴 **片17(2026-08-19):這份表單改成【預設收起】,而它是量出來的不是版面偏好。**
                      真瀏覽器實量(720×900 面板、12 品項/其中 8 項有採購):
                      ```
                      面板 scrollHeight 6,241 px ⇒ 要捲 6.9 個螢幕；商品區 4,817 px = 全面板 77%
                      展開的卡 536 px / 收起的卡 90 px ⇒ 打開一張的代價 446 px ≈ 半個螢幕
                      而那 446 px 裡幾乎全是【這一份空表單】：供應商下拉／訂購數量／預計到貨日／
                      聯絡管道／供應商單號／送出採購的時間／回覆狀態 5 顆 radio／異常原因 textarea／送出鈕
                      —— 採購那一列【真資料】只佔約 1 行
                      ```
                      ⇒ 螢幕上同時攤著 **8 份一模一樣的空表單**。
                      🔴 **而 Sean 的原話是「看得完整,但佔高度」——【看】不是【填】。**
                         我們給他的不是「看得完整」,是 8 份等他填的表單。
                      ⇒ 主視窗 2026-08-19 裁:表單收起、**卡片自動展開那條加裁不動**
                         (`stuck || hasProcurementRows` 一個字沒改)。

                      📌 **這不是新設計** —— 上面 `rows.length === 0` 那條分支**本來就是這樣做的**
                         (同一支 `<details>`、同一種 summary)。本片只是把 A 的做法套到 B。

                      🔴 **字面「再跟一家」是 DB 釘死的,不是文案選擇**(W3 給的證據,比設計稿硬):
                         `20260729020000_m4b_e10_a2_order_item_procurement.sql:69-70`
                         `UNIQUE (order_item_id, supplier_canonical_key)`,註解逐字「同一品項同一家供應商只有一列」
                         ⇒ 有採購列時,員工唯一做得到的動作就是「**再**跟**一家**」。
                      ⚠️ **已知這個字面略窄**(W3 指出):實際索引是
                         `UNIQUE (order_item_id, supplier_id) WHERE voided_at IS NULL`(部分索引)
                         ⇒ **作廢之後可以再向同一家下訂**,那時「再跟一家」讀起來會有點怪。
                         **判不值得為這個邊界改字面** —— 講清楚要多一個狀態,而那是把成本加回去。 */}
                  {/* 🔴🔴 **只有「真的有採購列」時才收合** —— 這個條件是被三格既有守門逼出來的,
                      而它們是對的:
                      本分支同時服務**三種**狀態,而只有第一種是我量到的那個問題:
                      ```
                      rows.length > 0            有採購列        ← 我量到的 8 張卡，446px 全在這裡
                      rows.length === 0 且 blocked  清單被截斷    ← fail-closed：「沒撈到」不是「沒有」
                      rows.length === 0 且 unreadable 讀不到      ← 同上
                      ```
                      🔴 後兩種**一個字都不動**:它們的畫面是「請重整/找工程師」,
                         而**在一個講「我讀不到」的區塊裡再收起一個表單,是把兩層不確定疊起來**。
                      ⚠️ 我第一版無條件收合 ⇒ `item-procurement-section.test.tsx` 三格當場紅
                         (`零採購列但被截斷` / `讀不到採購` / `剛好在門檻上`)。
                         🔴 **而我沒有去改那三格的期望值** —— 它們釘的是「截斷時不得收合成『還沒訂』」,
                            那個意圖是對的,紅的是**我的條件太寬**。**改的是我,不是尺。**
                      📌 順帶:這個條件也讓字面問題自己消失 —— 「**再**跟一家」只在真的有列時才出現。 */}
                  {rows.length > 0 ? (
                    <DetailsScrollOnOpen className='group mt-3'>
                      <summary className='flex cursor-pointer flex-wrap items-center gap-2 text-xs'>
                        <span className='transition-transform group-open:rotate-90'>▸</span>
                        <span className='border-primary text-primary rounded-md border px-2.5 py-1 font-medium'>
                          ＋ 再跟一家供應商下訂
                        </span>
                      </summary>
                      <div className='mt-3'>
                        <ItemProcurementForm
                          orderId={detail.id}
                          returnTo={returnTo}
                          orderItemId={item.id}
                          procurements={rows}
                          supplierChoices={buildSupplierChoices(suppliers, rows)}
                          truncated={blocked}
                        />
                      </div>
                    </DetailsScrollOnOpen>
                  ) : (
                    <ItemProcurementForm
                      orderId={detail.id}
                      returnTo={returnTo}
                      orderItemId={item.id}
                      procurements={rows}
                      supplierChoices={buildSupplierChoices(suppliers, rows)}
                      truncated={blocked}
                    />
                  )}
                </>
              )}
    </div>
  );
}
