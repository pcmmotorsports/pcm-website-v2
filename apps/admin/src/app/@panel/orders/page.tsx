import { isUuid } from '../../../lib/orders/note-action-state';
import { ORDER_PANEL_PARAM, buildPanelCloseHref } from '../../../lib/orders/order-list-view';
import { OrderDetailRoute } from '../../../components/orders/order-detail-route';
import {
  CANCEL_REQUEST_TOKEN_PARAM,
  CANCEL_RESULT_PARAM,
} from '../../../lib/orders/cancel-action-state';

// app/@panel/orders/page.tsx — #350c:訂單詳情的**右側面板版**。
//
// 🔴🔴 **為什麼是 searchParams 驅動,不是 intercepting route**(主視窗 2026-08-10 裁 A 案):
//    v1 走過攔截路由,真瀏覽器實測「面板開著時軟導航回列表 ⇒ URL 回列表但**面板黏著不放、
//    還顯示舊那張單**」,而 Next 文件的兩種標準修法(槽 catch-all、槽精確空頁)實測**皆無效**
//    (`D-403-Q` §① 有五格實測表)。改成本檔這種「槽頁被 URL 配對到、自己讀 param 決定開不開」
//    之後,**URL 一變本檔就重算** ⇒ 沒有任何狀態可以黏。
//
// 🔴 本檔沒有 `'use client'`:面板內容與整頁版一樣是 server component
//    (PII 白名單投影 + 五支 server action 全部留在 server,鐵則 12 ②)。
export const dynamic = 'force-dynamic';

// 🔴🔴 **錢**:面板裡的退款表單是在 `/orders?panel=<id>` 這個 URL 上送出的
//    ⇒ 那個 POST 吃的是 `/orders` 這條 segment 的函式時限。理由全文在
//    `app/orders/[id]/page.tsx:16-38`(adapter 30s 硬逾時、砍在 fetch 中途 = 錢可能已動)。
//    ⚠️ **誠實界線**:「slot 頁與 page 頁誰的 segment config 真的管轄那個 POST」我**沒有實測**;
//    三處(本檔 / `app/orders/page.tsx` / `app/orders/[id]/page.tsx`)宣告同一個值
//    ⇒ 不論答案是哪一個都對。**這是繞過未知,不是解答未知。**
export const maxDuration = 60;

// 🔴 關閉連結的建構在 `lib/orders/order-list-view.ts` 的 `buildPanelCloseHref`,**不在本檔**:
//    page 模組不能隨便多開具名 export ⇒ 留在這裡的話沒有任何測試碰得到它。
//    codex 關卡2(2026-08-10)就是這樣擊破的:把它改成固定回 `/orders`(關面板 = 篩選全洗掉),
//    當時六組守門全綠。搬走之後 `order-list-view.test.ts` 直接測它本人。

export default async function OrderPanelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const panelId = typeof raw[ORDER_PANEL_PARAM] === 'string' ? raw[ORDER_PANEL_PARAM] : undefined;

  // 🔴 兩種情況都回 `null` = 「這個 URL 沒有面板要開」,殼那邊靠 CSS `:has()` 把面板欄與把手一起收起來:
  //    ① 沒帶 `panel` ⇒ 這就是關閉面板的機制本身;
  //    ② 帶了但不是 UUID 形狀 ⇒ **不打 DB、也不 `notFound()`**。手打一條爛網址不該讓畫面被吃掉半邊,
  //       更不該把整頁打成 404(在平行路由槽裡呼叫 `notFound()` 會炸掉的是**整個頁面**,
  //       員工手上的列表會整片消失 —— 主視窗 2026-08-10 裁⑤「notFound 面板自理」)。
  if (!panelId || !isUuid(panelId)) return null;

  // 🔴 **面板不顯示「通用」`ResultBanner`**(code-reviewer 2026-08-10 nit-6):
  //    `r` 是列表層與整頁詳情共用的命名空間 ⇒ 面板若也畫一份,員工會同時看到兩條橫幅。
  //    ⇒ 用 `showResultBanner={false}` 明確關掉那一份,**而不是靠不傳 `r` 來達成**。
  // 🔴🔴 **A13b D6-a R2 codex must-fix:`r`/`rt` 必須原封傳進去。**
  //    我上一版寫「面板版不接結果碼、今天不可構造」——**那句不實**:
  //    action 全部 redirect 去整頁版只說明**網址怎麼被產生**,不說明**網址怎麼被到達**。
  //    員工用書籤 / 手打 / 上一頁開 `/orders?panel=<未付款單>&r=order_cancel_retry&rt=<uuid>`
  //    就到得了 ⇒ 當時 `cancelFormsAllowedOnResultPage(undefined)` 恆 true
  //    ⇒ **面板不顯示結果、取消表單卻開著**(fail-open,與整頁版那個 narrowing bug 同型)。
  //    ⇒ 現在原封轉:取消面板照常顯示、結果頁閘照常生效。
  const resultCode = raw[CANCEL_RESULT_PARAM];
  const requestToken = raw[CANCEL_REQUEST_TOKEN_PARAM];
  const correctNoteId =
    typeof raw.correct === 'string' && isUuid(raw.correct) ? raw.correct : null;

  // 🔴 `await` 它、不要當成 JSX 子元素(理由同 `app/orders/[id]/page.tsx`:async server component
  //    沒被 await 的話,`await Page(...)` 拿到的樹裡它還沒解析,測試會 render 出空字串且不報錯)。
  const body = await OrderDetailRoute({
    id: panelId,
    resultCode,
    requestToken,
    correctNoteId,
    back: { href: buildPanelCloseHref(raw), label: '← 關閉,回訂單列表' },
    missing: 'inline',
    showResultBanner: false,
  });

  return (
    // 🔴 `sticky` + `max-h-svh` + `overflow-y-auto` = **面板自己捲**,document 捲動不動。
    //    350b 檔頭記過:給整列高度再加 overflow 會把**全站**的捲動模型換掉,連訂單列表的
    //    非 portal 下拉都會被裁。這裡的 scroll container 只有面板自己。
    //    ⚠️ 誠實界線(兩條,日後往面板裡塞浮動 UI 的人要一起看):
    //    ① `overflow-y-auto` 定義上就是 scroll container ⇒ 非 portal 的 `absolute` 下拉會被裁;
    //    ② `@container` 的 `container-type: inline-size` 帶 `contain: layout`
    //       ⇒ 這個 div 同時成為 `position: fixed` 子孫的 **containing block**
    //       (code-reviewer 2026-08-10 nit-10)⇒ `shipment-dialog.tsx` 那種 `fixed inset-0`
    //       覆蓋層若進到面板裡,會被**困在面板內**而不是蓋滿視窗。兩條的解法都是 portal。
    // 🔴 `@container`:讓 `order-detail.tsx` 的欄數看**面板寬度**而不是視窗寬度
    //    (主視窗 2026-08-10 裁④);沒有它,1920 螢幕上的 576px 面板會硬排四欄。
    <div className='@container sticky top-0 max-h-svh space-y-4 overflow-y-auto border-l p-4'>
      {body}
    </div>
  );
}
