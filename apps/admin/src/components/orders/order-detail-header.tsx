// order-detail-header.tsx — 訂單明細的標頭區(2026-08-24 拆檔片,自 `order-detail.tsx`
// 純搬移;該檔 961 行 > 400,鐵則 6)。
//
// 🔴 內容 = 片2 標頭列(單號/付款 chip/客人入口/金額/時間/已取消/「訂單明細」列印鈕)
//    + `OrderFocalRow` 焦點列 + 已取消橫幅。**兩個視圖(面板/整頁)共用**,經 `OrderDetail`
//    的 `header` prop 進 `OrderDetailTabs` —— 呼叫端只有 `order-detail.tsx` 一個。
// 🔴 搬移片零行為改動;各段註解逐字原樣。守門三支跟著改讀本檔
//    (order-detail-header.test.tsx / order-detail-print-entry.test.ts / picking page.test.tsx)。

import Link from 'next/link';
import type { AdminOrderDetail } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
// 片2 標頭列:兩個標籤表都是**既有的**,本片零新增詞彙(理由見 `OrderHeadChip` 那段)。
import { PAYMENT_STATUS_LABEL, formatOrderAmount } from '../../lib/orders/order-list-view';
// 🔴 2026-08-27 `#OD-FIX-01`:焦點列抽成自己的檔(Sean 拍乙)——
//    它與那三張資訊卡不是同一種東西, 留在同一支檔會讓人以為共用 `SPEC`。
import { OrderFocalRow } from './order-focal-row';
import type { PaymentListData } from './payment-list';

/**
 * 片2:標頭的付款狀態 chip(設計稿 §1 那顆紅色 `[未收齊]`)。
 *
 * 🔴🔴 **字面用既有的 `PAYMENT_STATUS_LABEL`,【不是】設計稿的「未收齊」—— 這是刻意的偏離。**
 *    設計稿寫「未收齊」,而 `partiallyPaid` 這一格的字面 **Sean 2026-08-18 才剛拍板過**
 *    (`Q3` = 「已收訂金」,`order-list-view.ts:170-176` 逐字記著理由:
 *     ~~付款確認中~~ 讀起來像「錢在路上」⇒ 員工不會去催尾款)。
 *    ⇒ 在**同一張畫面**上,標頭寫「未收齊」而下方付款卡寫「已收訂金」= 兩個詞指同一件事,
 *      那正是他抱怨過的「同一張單畫面講三句相反的話」。
 *    ⇒ **本片不引入第六個詞。** 要不要改成「未收齊」是 Sean 的題(已回報主視窗),
 *      改的話是**一行**的事,而且要**兩處一起改**。
 *
 * 🔴 **顏色的判準是「還欠不欠錢」,不是 enum 名字**:`unpaid` 與 `partiallyPaid` 都還欠錢 ⇒ 紅;
 *    其餘(含 `refunded` / `partiallyRefunded`)不紅 —— 退款單不該掛一顆催款色的 chip。
 *    ⚠️ 這個判準與 `order-edit-pay-axis.ts` 的三值軸**同語意但不共用**:那支服務改單矩陣、
 *       本處只決定一個顏色。**不要把顏色接到那支上去**,它的 `refunded ⇒ paid` 是為了
 *       「別讓改單以為這張單沒收過錢」,拿來決定顏色會是巧合對、不是同一個問題。
 */
function OrderHeadChip({ detail }: { detail: AdminOrderDetail }) {
  const owing = detail.paymentStatus === 'unpaid' || detail.paymentStatus === 'partiallyPaid';
  return (
    <span
      // 🔴 `shrink-0`(`W6-019` M1):它在標頭那一列裡,而**沒有它的東西會被【安靜壓扁】而不是溢出**。
      //    壓扁不像壞掉、像設計 ⇒ 連「拿去真瀏覽器給人看」那道驗證都騙得過去。
      /* 🔴 2026-08-23 夜:`rounded-md` → `rounded-full`。**依據是量到的,不是「圓角比較好看」**:
         線A 用 `tool-final-css.py`(五個世界自檢全 PASS)量 OD 產物的**頂層最終值**
         ⇒ `.od-pill` = `9999px`。而 Sean 同日逐字「都依照OD」「去看OD長怎樣,就怎樣」。
         📌 **這一格原本準備用「去數全樹那 18 處」來決定** —— 而真權威一直都在,只是沒有人去量它。
            **去數分母,是沒有真權威時才做的事。** */
      className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        owing ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
      }`}
    >
      {PAYMENT_STATUS_LABEL[detail.paymentStatus]}
    </span>
  );
}

/**
 * 標頭整塊。props 是 `OrderDetail` 同名 props 的直傳,完整語意(fail-closed 立場、
 * `customerHref` 為 `null` 不渲染入口、`payments` 必填無預設)寫在 `order-detail.tsx` 的
 * props 型別上 —— 那裡是唯一權威,本檔不抄第二份。
 */
export function OrderDetailHeader({
  detail,
  customerHref,
  payments,
}: {
  detail: AdminOrderDetail;
  customerHref: string | null;
  payments: PaymentListData;
}) {
  const cancelled = detail.cancelledAt !== null;
  return (
        <div className='space-y-4'>
          {/* ═══ 片2 標頭列 —— **單列**(逐字搬設計稿 `.hdr`)═══════════════════════
              **來源**:OD 專案 `pcm-admin-order-ui` / `overview-desktop.html`
              (`/Users/sean_1/Library/Application Support/Open Design/namespaces/release-stable/
                data/projects/pcm-admin-order-ui/overview-desktop.html`,**mtime 2026-08-13 16:16**)。
              ⚠️ **可能存在更新的一版而我們沒找到** —— Sean 提過有一份「昨天改過」的 artifact,
                 主視窗已去問他;**在他回答之前照這一份做**。搬的是哪一份、哪一天,寫在這裡不寫在別處。

              **設計稿逐字(`:1105-1118`)**,由左到右:
                單號 · 付款 chip · 客人入口 · **金額** · 下單時間 · (彈性空白) · 狀態 chip · ⋯ · ✕
              **版面(`:219`)**:`height:38px; flex:0 0 38px; display:flex; align-items:center; gap:9px; padding:0 12px`

              🔴🔴 **上一版我把它做成【兩列】,那是錯的,而根因值得留**:
                 我照的是 `MAIN-057 §1` 的 **ASCII 轉錄**,那張圖長兩行 ⇒ 我把它讀成設計。
                 **而 ASCII 轉錄天生表達不了「這是換行」還是「這只是排不下才折」。**
                 設計稿真正有 `flex-wrap:wrap` 的那一版在 `:553` 的 `@container (max-width:520px)`,
                 而那個 media query 上方註解逐字「**手機 ≤520:標題列合併**」
                 ⇒ **我把手機版的形狀套到桌機了**;面板固定 720 ⇒ **永遠不會命中 ≤520**。
                 (Sean `A2` 拍板「員工用電腦」⇒ 桌機那一列才算數。)

              ✅ **裝得下,是量到的不是推的**:直接把設計稿當成能跑的 HTML 起 server 渲染,
                 量它自己的 `.hdr` ⇒ **設計稿自己的面板是 674px(比我們鎖的 720 還窄)**、
                 `flex-wrap: nowrap`、實測高 36px、**不換行**;
                 餵最壞資料(長客名 + 七位數金額 + 長狀態)⇒ **彈性空白仍剩 120px**。
                 ⚠️ 量具自檢:我第一把尺 `scrollWidth - clientWidth` 是**瞎的** ——
                    flex 子元素預設 `flex-shrink:1` ⇒ 它們互相壓縮、不產生溢出 ⇒ 兩個世界印同一個 0。
                    改量**彈性空白**才會動(荒謬長字 ⇒ 0 / 正常 ⇒ 119)。

              🔴 **`✕` 不在本元件**:關閉是**面板才有**的動作,而本元件同時被整頁版渲染。
                 關閉連結由 `order-detail-route.tsx` 的 `BackLink` 畫、文案由各呼叫端傳。
                 ⚠️ 已知偏離:設計稿的 `✕` 在**同一列最右**,而 `BackLink` 是**上方自成一行**。
                 要同列得讓本元件收 `closeSlot` prop、兩個呼叫端各傳一份 ⇒ 跨元件手術,不屬本片。

              🔴 **設計稿有、本片【刻意不做】的一顆**:`:1116` 的 `⋯ 更多操作`。
                 理由:**它是一個沒有行為的入口,做了會是死按鈕。**
                 (與 Sean 2026-08-19 對包裹卡那四顆鈕拍「甲 = 不做」同一個理由。)
                 ⚠️ **不寫成 TODO** —— TODO 讀起來像「快做了」,而它其實在等一個功能決定。

              🔴 **本片【拿掉】了上一版自己加的「發票」那一格**:設計稿標頭沒有它,
                 而它與兩列標頭**同一個根因**(從 ASCII 推的)。鐵則 1:不反向遷就。
                 ⚠️ 「標頭要不要顯示發票狀態」已列進 Sean 的肉眼題清單,**不是消失**。
                 📎 而背景要一起帶:正式庫 19 張單**零張有發票**、三個欄位全空、零流程在填
                    ⇒ **發票是【流程的缺口】,不是【標頭少一格】。不要用一個欄位替一個不存在的流程作代表。**

              🔴🔴 **本片改的是【兩個視圖共用】的標頭 ⇒ 整頁版 `/orders/[id]` 也跟著變,
                 而【沒有人看過整頁版的畫面】** —— 已列進交件檔「需肉眼驗」清單,不要當成已驗。 */}
          {/* 逐字搬 `:219`:`gap:9px` / `height:38px` / `align-items:center` / **`nowrap`**。
              **不換算成 Tailwind 級距**(鐵則 1 禁翻譯)⇒ 用 `gap-[9px]` / `h-[38px]`。
              `min-w-0` 給下面的客人入口截字用:沒有它,長名字會把整列撐開而不是自己截。

              🔴🔴 **這一列每一顆都要 `shrink-0`,唯一的例外是客人名(`W6-019` M1)**:
                 flex 子元素**預設 `flex-shrink:1`** ⇒ 空間不足時它們**安靜地互相壓扁,而不是溢出**。
                 · 而 spacer 的 `flex-basis` 是 0 ⇒ **它本來就沒東西可縮** ⇒ 壓力全落到別人身上。
                 · 更糟的是 **spacer 量到 0 之後【飽和】** ⇒ 分不出「剛好到邊」與「chip 和按鈕已經被壓爛」
                   ⇒ **我用來判斷『裝不裝得下』的那把尺,在最需要它的時候失去判別力。**
                 🔴 **而它會連下一道驗證一起騙過去**:我把長相交給「真瀏覽器 + Sean 的眼睛」,
                    而**一列安靜壓縮的版面,在瀏覽器裡看起來就是「裝得下」——壓扁不像壞掉,像設計。**
                 ⇒ 修完之後唯一可縮的只剩客人名(它 `truncate` 是設計好的),再不夠就**看得見地溢出**。 */}
          {/* 🔴 FIX-72②(OD,OPEN-05):**窄的時候要換行,而不是把整頁撐開。**
              OD 實量 820px 視窗:內容寬 686 / 需要 728 ⇒ 舞台出現橫捲;
              面板版早在 FIX-18 做過同一件事,**整頁版漏了**。
              🔴 **`flex h-[38px] flex-nowrap` 這串字面【刻意原封不動】**:桌機那一列的形狀
                 是量出來的(設計稿自己的面板 674px、`nowrap`、實測高 36px、彈性空白仍剩 120px),
                 本片**沒有推翻它** —— 只是在**容器真的裝不下**的時候放開。
                 ⚠️ 順帶:`order-detail-header.test.tsx` 用 `indexOf('flex h-[38px] flex-nowrap')`
                    當標頭那一列的定位錨。**它守的東西沒變,所以錨也不該被弄丟。**
              🔴 **用【容器】查詢不是 media query**:面板被拖窄而視窗很寬是桌機常態,
                 media query 在那時候不會生效 —— FIX-18 逐字記過這一格:
                 「FIX-13 只處理了『視窗窄』…面板被拖窄但視窗很寬(桌機常態)媒體查詢不會生效」。
              🔴 **門檻 820px 是抄 OD 的,不是我挑的**。他的規則逐字:
                 `@container (max-width:820px){[data-od-id="panel-header"] .flex-nowrap{flex-wrap:wrap;height:auto;row-gap:4px}}`
                 —— 而 820 是 FIX-08 v16 **量出來的**(6 欄列最少 722px + 卡片與分頁區內距 64 = 786;
                 面板 760 時仍走寬版就會把小計切掉)。
                 ⚠️ **我第一版寫 `@max-2xl`(672px),那是我自己挑的、比量到的門檻低 148px**
                    ⇒ 面板寬落在 672–820 之間時抬頭仍然 `nowrap`、仍然會溢出。**已改成逐字的 820。**
                    🔴 判別句:**這個數字是量到的,還是我挑一個看起來差不多的?**
              ⚠️ **`@max-[…]` 這個變體本 repo 之前零使用** ⇒「Tailwind 編不編得出來」是真問題,不是形式。
                 已對**真 build 產物**驗過,規則原文抄在交件檔裡。 */}
          <div className='flex h-[38px] flex-nowrap items-center gap-[9px] @max-[820px]:h-auto @max-[820px]:flex-wrap @max-[820px]:gap-y-[4px]'>
            <h1 className='shrink-0 text-2xl font-semibold'>{detail.displayId}</h1>
            <OrderHeadChip detail={detail} />
            {/* 🔴 入口位置照 OD `overview-desktop.html:1109-1112` 逐字:「客人明細的入口。
                **做在標題列的名字上**,因為那是『這張單是誰的』唯一會被讀的位置,
                員工要查電話/地址時眼睛本來就落在這裡。一下就開,不用先跳到客戶頁再搜尋。」
                ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
                   這一句退場文案是**我自己決定的**,OD 沒有畫這個狀態。 */}
            {/* A9w1:整單九碼彙總 badge 退場。付款軸(三軸的訂單層)在下方「付款」卡的付款狀態,
                訂貨/到貨在品項列 —— 不另補一顆彙總 badge,那正是九碼被退場的東西。 */}
            {/* 🔴 `rounded-md` 不是 `rounded-full`:Sean 2026-08-16 拍板「狀態膠囊改方角,
                全站統一、沒有例外要記」(memory `project_0816-sean-morning-13-rulings.md:22` Q5、
                `project_0816-evening-five-rulings.md:33` 再確認)。
                ⚠️ **這一顆是漏網的** —— 列表那邊 08-16 已改(`orders-table.tsx` 的 `rounded-full` 現為 0),
                   而本檔這顆沒跟上,且 `design-tokens.test.ts` **沒有任何一條在管 `rounded-full`**
                   (STATUS.md Blocker 欄逐字記著這件事)⇒ 它不是被放行,是**根本沒有那道門**。
                   本片只改我正在動的這一顆,**不順手掃全樹的 18 處**(那是另一片、要自己的分母)。
                🔴 **2026-08-23 晚:上面整段的【前提】被 Sean 自己推翻了(原句不改,加註)** ——
                   他逐字裁「乙 不算了 —— 照 OD 新稿,**全部圓角**」,線A 已把 `--radius` 由 0 改成 8px、
                   四階 xs2/sm4/md6/lg8/xl12。
                   ⇒ **這顆 chip 的 `rounded-md` 現在是 6px,不再是方角** —— 而**我一個字都沒改它**。
                   🔴 **這一格最值得記的形狀**:同一串 class、同一個檔、零 diff,而**畫出來的東西變了**,
                      **且沒有任何測試會紅** —— 值住在別人的 token 裡。
                      ⇒ 「我確認過這個 class」不等於「我確認過它會畫出什麼」。
                   ✅ **2026-08-23 夜已決:改回 `rounded-full`(見上方那段的量測出處)。**
                      🔴 **而 08-16 那條「狀態膠囊改方角、全站統一沒有例外」現在【整條作廢】** —— 不是只有這一顆。
                      🔴🔴 **⚠️ 我在這裡寫過一句「列表方角、明細圓角,兩邊不一致」—— 那是【錯的】,而錯法值得留。**
                         我從「**我改不到 `order-list-view.ts`**」推出「**那支檔沒被改**」,
                         中間少了一步:**有沒有別人用別的路做到同一個效果?**
                         實查(我自己 grep,不是聽來的):
                           · `order-list-view.ts:213` `STATUS_CAPSULE = 'inline-flex px-2 py-0.5 text-xs font-medium'`
                             ⇒ **它本來就沒有任何 `rounded-*`**,形狀從來不是它給的
                           · `globals.css:1956-1959` `.cap-n,.cap-y,.cap-bl,.cap-g,.cap-risk{border-radius:9999px!important…}`
                             ⇒ **列表膠囊今天已經是圓的**(線A 搬 OD 樣式時一起進來)
                         ⇒ **兩邊一致,而且不需要動 `order-list-view.ts` —— 那條路是空的。**
                         📌 判別句:**檔案歸屬答的是「誰動了哪支檔」,答不出「這個效果現在是什麼」。**
                      ⚠️ 而**本檔這顆 chip 不吃 `.cap-*`**(它有自己的一串 Tailwind)⇒ 上面那行 `rounded-full` 仍然要自己寫。
                      📌 「全樹 18 處」那個分母**始終沒有人數過**,而它現在也不需要了:
                         真權威是 OD 產物的最終值,逐個元件去量,不是數我方有幾處。 */}
            {/* 🔴 客人入口 —— OD `:1110-1111` 逐字:「客人明細的入口。**做在標題列的名字上**,
                因為那是『這張單是誰的』唯一會被讀的位置,員工要查電話/地址時眼睛本來就落在這裡。」
                設計稿的形狀是 `<button class="cus cuslink">${o.cus}<span class="ci">›</span></button>`(`:1112`)。
                ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
                   **這句退場文案是我自己決定的,OD 沒有畫這個狀態。**
                🔴 `truncate` + `min-w-0`:長名字自己截,不要把整列撐開(`.cuslink` 在設計稿裡也不吃固定寬)。 */}
            {customerHref !== null && (
              <Link
                href={customerHref}
                className='text-primary hover:bg-muted inline-flex min-w-0 shrink items-center gap-0.5 truncate rounded-md px-1.5 py-0.5 text-[13px]'
              >
                <span className='truncate'>{detail.customer.name ?? '客人明細'}</span>
                <span aria-hidden='true' className='text-muted-foreground shrink-0'>
                  ›
                </span>
              </Link>
            )}
            {/* 🔴 金額 —— 設計稿 `:1113` 逐字 `<span class="amt">NT$ ${money(tot)}</span>`。
                **上一版沒做也沒揭露**(`W4-004` 判「這是漏,不是偏離」)。
                ⚠️ **這裡帶 `NT$`,而頭條那三格不帶** —— 那**不是不一致**:
                   Sean 2026-08-16 拍過「頭條速覽不用 NT」而「明細表底部的總計是正式金額、帶 NT$」
                   (`Q-A216-F4` 拍乙「留著」);**而設計稿這一格自己就寫著 `NT$`** ⇒ 兩個來源同向。 */}
            <span className='shrink-0 text-[13px] tabular-nums'>
              NT$ {formatOrderAmount(detail.total.amount)}
            </span>
            {/* 下單時間 —— 設計稿 `:1114` `<span class="dt">${o.d} 14:05</span>`。 */}
            <span className='text-muted-foreground shrink-0 text-[13px]'>
              {formatOrderDateTime(detail.createdAt)}
            </span>
            {/* 🔴 彈性空白 —— 設計稿 `:1115` `<span class="sp"></span>`,它把右邊那組推到最右。
                **它就是我用來量「裝不裝得下」的那一格**:它的寬度 >0 代表還有餘裕、=0 代表擠到底了。 */}
            <span className='flex-1' />
            {/* ⚠️ **這一顆跟著上面那顆一起改 `rounded-full`,而依據弱一階,明說**:
                線A 量到的是 `.od-pill`,**他沒有給我「已取消」這一顆在 OD 的 selector**。
                我是**從「同一列、同一串 class、同一種狀態膠囊」推的** ——
                只改其中一顆會讓同一列出現兩種形狀,那比兩顆都推錯更難看。
                🔴 **這是推的不是量的**,若之後量到 OD 這顆是別的值,改它一個字即可。 */}
            {cancelled && (
              <span className='bg-destructive/10 text-destructive inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium'>
                已取消
              </span>
            )}
            {/* #10 片1:揀貨單入口。**開新分頁**(`target='_blank'`)—— 員工按了列印之後要回到這張單
                繼續做事,把工作面換掉再叫他按上一頁是多一步。
                🔴 `rel='noopener'`:`target='_blank'` 預設會把 `window.opener` 交給新分頁。
                   這裡兩邊同源、風險低,但這是**寫一次就不用再想**的東西。
                🔴 **已取消就不給入口**(R1 must-fix 3)。第一版我無條件渲染,而 `:312` 的「已取消」
                   badge 明明就守著同一顆 `cancelled` —— 同一列裡一個守、一個不守。
                ⚠️ **但這裡只是 UX,不是守門**:網址可以被貼、被書籤、或分頁開著時訂單才被取消,
                   那些路徑全部繞過這顆鈕。真正的守門在 `components/print/picking-doc.tsx`
                   (已取消 ⇒ 不印品項表)。**兩層都要,少了下面那層這顆鈕等於零。**
                📍 位置在 `ml-auto` 的日期**之前**(nit-12):放後面會被推到整列最尾端、
                   與 `:300` 的客人入口分兩側,員工要找兩個地方。 */}
            {!cancelled && (
              <Link
                href={`/print/orders/${detail.id}/picking`}
                target='_blank'
                rel='noopener'
                className='border-border bg-card hover:bg-muted text-foreground inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-sm'
              >
                訂單明細
              </Link>
            )}
          </div>
          {/* 🔴 片4b:`payments` 是頭條「已收」的來源 —— 傳的是**原始 `PaymentListData`**,
              不是算好的金額。理由:元件內部要吃 `toPaymentSummary()`(與付款卡同一支函式),
              `unknown` 那態才畫得出「未知」而不是一個假的 0。 */}
          <OrderFocalRow detail={detail} payments={payments} />
          {cancelled && (
            <div className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
              <span className='text-destructive font-medium'>
                已取消({detail.cancelledAt ? formatOrderDateTime(detail.cancelledAt) : '—'})
              </span>
              {detail.cancelledReason && (
                <span className='text-muted-foreground ml-2'>原因:{detail.cancelledReason}</span>
              )}
            </div>
          )}
        </div>
  );
}
