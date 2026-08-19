import { isUuid } from '../../../lib/orders/note-action-state';
import {
  buildPanelCloseHref,
  buildPanelSelfHref,
  buildCustomerPanelHref,
  readOpenCustomerPanelId,
  readOpenPanelOrderId,
} from '../../../lib/orders/order-list-view';
import { loadCustomerDetail } from '../../../lib/customers/load-customer-detail';
import { CustomerPanel } from '../../../components/customers/customer-panel';
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

  // 🔴 兩種情況都回 `null` = 「這個 URL 沒有面板要開」,殼那邊靠 CSS `:has()` 把面板欄與把手一起收起來:
  //    ① 沒帶 `panel` ⇒ 這就是關閉面板的機制本身;
  //    ② 帶了但不是 UUID 形狀 ⇒ **不打 DB、也不 `notFound()`**。手打一條爛網址不該讓畫面被吃掉半邊,
  //       更不該把整頁打成 404(在平行路由槽裡呼叫 `notFound()` 會炸掉的是**整個頁面**,
  //       員工手上的列表會整片消失 —— 主視窗 2026-08-10 裁⑤「notFound 面板自理」)。
  // 🔴 #350d:判準搬進 `readOpenPanelOrderId` —— **列表要停畫自己那條橫幅時問的是同一支**。
  //    兩邊各判一次的話,`?panel=not-a-uuid&r=saved` 會變成「面板不開 + 列表也停畫」= 零橫幅。
  const panelId = readOpenPanelOrderId(raw);
  if (!panelId) return null;

  /**
   * 🔴 OD 片 3b:**客人卡蓋掉訂單面板**(需求檔 §0-J J-4;Sean 2026-08-13 逐字
   * 「點客人變成看向訂單一樣,然後再點訂單或者回去變成看訂單」)。
   *
   * 位置在 `panelId` 閘之後:**`panel` 仍然必須是合法 UUID**,`?customer=<id>` 單獨出現不開任何東西
   * —— 客人卡是「蓋在某張訂單的面板上」,不是獨立視圖。
   * 「回訂單」= `buildPanelSelfHref`(它會剝掉 `customer` 再把 `panel` 加回去)
   * ⇒ **結構上必然回到原本那張單**,不靠瀏覽器歷史。
   *
   * 🔴 **lazy 不是平行路由天然給的,是這個 early return 給的**:沒帶 `customer` 時
   * `loadCustomerDetail` 一次都不會被呼叫(守門:`order-panel-wiring.test.ts` 有一格
   * 斷言未帶 param 時五路 repository **零呼叫**)。
   *
   * ⚠️ 有 `customer` 時**訂單面板整棵樹都不渲染** —— 連同 8 支表單的未送出內容一起消失。
   * Sean 2026-08-13 **知情拍板接受**(逐字「a」,問題含那張 8 支表單清單);已立案 `#467`。
   */
  const customerId = readOpenCustomerPanelId(raw);
  if (customerId) {
    return (
      <div className='@container panel-width-locked sticky top-0 max-h-svh space-y-4 overflow-y-auto border-l p-4'>
        <CustomerPanel
          data={await loadCustomerDetail(customerId)}
          backHref={buildPanelSelfHref(raw, panelId)}
          fullPageHref={`/customers/${customerId}`}
          orderHref={(orderId) => buildPanelSelfHref(raw, orderId)}
        />
      </div>
    );
  }

  // 🔴🔴 **#350d C2:`r` 歸誰,用 `panel` 的有無判定 —— 有 `panel` ⇒ 是面板的結果碼。**
  //    ⇒ 面板**畫**通用 `ResultBanner`(`showResultBanner` 不再傳 false),
  //      而 `app/orders/page.tsx` 在面板開著時**停畫**自己那條。
  //    🔴 這兩半**必須同片**(契約 §2 硬條件 2):翻早了 = 兩條橫幅(C2 存在的理由被打破);
  //      翻晚了 = 零橫幅(動作做完什麼都沒說)。守門 = `order-panel-wiring.test.ts` 的
  //      「有 panel 時列表零、面板恰一」正負兩格。
  //    ⚠️ #350c 這裡原本寫「面板若也畫一份,員工會同時看到兩條橫幅」—— 那句在 #350c 是對的
  //      (當時 action 全部導去整頁版,panel URL 上的 `r` 只可能是**列表**的碼);
  //      #350d 讓面板裡的動作把 `r` 帶回面板 URL 之後,擁有權就換手了。
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
    // 🔴 片2:設計稿 §1 標頭右上角是一顆 `✕`。**只改面板這一邊的文案** ——
    //    整頁版走 `app/orders/[id]/page.tsx`,它傳自己的 label、不受本行影響。
    //    ⚠️ **`✕` 後面留著「關閉」兩個字是刻意的**:純符號連結對螢幕閱讀器只會唸出
    //       一個標點,而這是員工離開這張單的唯一出口。要做成純圖示得補 `aria-label`,
    //       那要動 `BackLink` 的介面(它現在只收 `{href,label}`)⇒ 不屬本片體積。
    back: { href: buildPanelCloseHref(raw), label: '✕ 關閉' },
    // 🔴 #350d:`return_to` = **面板自己這個視圖**,不是 `back.href`(那是「關閉」連結,
    //    拿它當 return_to 等於動作做完把面板關掉;契約字面更正見 `D-420-NOTE` §1)。
    returnTo: buildPanelSelfHref(raw, panelId),
    missing: 'inline',
    // OD 片 3b:面板版的入口 = **同一個面板網址再加 `customer`** ⇒ 客人卡蓋上來、`panel` 還在。
    buildCustomerHref: (customerId) => buildCustomerPanelHref(raw, panelId, customerId),
  });

  return (
    // 🔴 `sticky` + `max-h-svh` + `overflow-y-auto` = **面板自己捲**,document 捲動不動。
    //    350b 檔頭記過:給整列高度再加 overflow 會把**全站**的捲動模型換掉,連訂單列表的
    //    非 portal 下拉都會被裁。這裡的 scroll container 只有面板自己。
    //    ⚠️ 誠實界線(兩條,日後往面板裡塞浮動 UI 的人要一起看):
    //    ① `overflow-y-auto` 定義上就是 scroll container ⇒ 非 portal 的 `absolute` 下拉會被裁,
    //       解法是 portal。**這條沒有被證偽、也沒有被證實** —— 下面 ② 那把尺對它**沒有判別力**
    //       (它量元素自己的框,而被裁與沒被裁在那個數字上一樣)⇒ **當它仍然成立,不要順手一起劃掉。**
    //    ② 🔴 **這裡原本寫「`container-type: inline-size` 帶 `contain: layout` ⇒ 本 div 成為
    //       `position: fixed` 子孫的 containing block」——【假的】,2026-08-19 跨引擎實測證偽。**
    //       量具 = W2 `scripts/containment-probe.mjs`,可重跑:`node scripts/containment-probe.mjs webkit|chromium`。
    //       量到:本 div 的**真實 class 完整組合**下,`fixed` 子孫**沒有被困住**;而正對照
    //       `contain: layout` / `transform` / `filter` **三個都真的困住** ⇒ 「沒困住」不是「我量不到」。
    //       WebKit(Safari 26.4 引擎)與 Chromium **逐格相同**。
    //       ⚠️ **射程**:那是 Playwright 的 webkit build、**不是 `Safari.app`** ⇒ 只能寫
    //          「Safari 引擎上不成立」,**不能寫「在 Sean 的 Safari 上驗過」**;未測 Firefox 與手機瀏覽器。
    //       ⇒ `shipment-dialog.tsx` 那種 `fixed inset-0` 覆蓋層從面板裡開**會正常蓋滿視窗**,
    //          **這裡不需要 portal**(② 不需要;① 仍然需要)。
    //       🔴 **而這句假宣稱當初引用了 `code-reviewer 2026-08-10 nit-10` ⇒ 它是審查通過的產物。**
    //          推理鏈「container-type ⇒ 帶 contain: layout ⇒ 依 CSS Containment 成為 containing block」
    //          **每一步都查得到出處,而瀏覽器不這樣做** ⇒ 審查者與作者共用同一條推理鏈,沒有人去按一下。
    // 🔴 `@container`:讓 `order-detail.tsx` 的欄數看**面板寬度**而不是視窗寬度
    //    (主視窗 2026-08-10 裁④);沒有它,1920 螢幕上的 576px 面板會硬排四欄。
    /* 🔴 `panel-width-locked` = **訂單編輯面板固定 720px**(Sean 2026-08-19 拍「甲」)。
        🔴 **順序不可換:`@container` 必須是第一個 token** —— `order-panel-wiring.test.ts`
           的「守門 6」斷言的是 `className='@container` 這個**字面前綴**,把標記寫在它前面
           會讓那格當場紅(本片第一版就是這樣被它抓到的)。**那道守門沒有錯,不要去改它。**
        規則本體在 `globals.css`(`:has()`,零 JS)。
        🔴🔴 **接點有【兩個】,不是一個**(2026-08-19 W4 審查 F1;我上一版寫「唯一的接點」**不實**):
           ① class 名本身 ② `.workspace-panel > .panel-width-locked` 的**直接子代關係**。
           ⇒ 有人在 `workspace-shell.tsx:154` 把 `{panel}` 多包一層(error boundary / 捲動容器 /
             `<Suspense>`),class 名一個字沒動、**規則卻不再匹配** ⇒ 面板安靜退回可拖的 cookie 寬度。
           ⇒ **兩個接點都要釘**,
        `workspace-shell.test.ts` 兩邊對照釘死 —— 同 `workspace-panel` 三兄弟的既有慣例。
        🔴 **為什麼標記在這裡、而不是去改殼或 `workspace-panel.ts`**:
           Sean 被問的、他答的都是**訂單編輯面板**的寬度。殼是共用基礎設施
           (`workspace-shell.tsx:16-17` 逐字「面板是共用基礎設施,不是訂單專屬」),
           改殼 = 替他決定一件他沒有被問過的事(主視窗 2026-08-19 裁甲,邊界寫在
           `~/pcm-mailbox/MAIN-057…md` §5①)。
        ⚠️ **客人卡那條路(上面那個 return)也帶同一個標記,而那是刻意的**:
           客人卡是「蓋在某張訂單的面板上」(本檔 `:63-66` 逐字),不是獨立視圖
           ⇒ 少了它,點「客人明細」面板會從 720 跳回 cookie 寬度、關掉再跳回來。 */
    <div className='@container panel-width-locked sticky top-0 max-h-svh space-y-4 overflow-y-auto border-l p-4'>
      {/* 🔴 片2:BMW M 三色條,設計稿 §1 逐字「頂端有 BMW M 三色條(藍→紫→紅)橫貫整個面板寬」。
          漸層本體是既有的 `.m-stripe`(`globals.css`),那裡寫了為什麼三個色停是硬寫 hex 不是 token。
          · `-mx-4 -mt-4` 把它推出容器的 `p-4` ⇒ 才真的「橫貫整個面板寬」;沒有它會左右各短 16px。
          · `h-1` = 4px,照 OD `hr.m-stripe{height:4px}`,與側欄那條同高。
          · `aria-hidden`:它是裝飾,OD 逐字「全系統唯一的裝飾元素」⇒ 不該被唸成一個東西。
          ⚠️ **只加在面板版** —— 設計稿講的是面板的頂端;整頁版沒有這條,本片不動它。 */}
      <div aria-hidden className='m-stripe -mx-4 -mt-4 h-1' />
      {body}
    </div>
  );
}
