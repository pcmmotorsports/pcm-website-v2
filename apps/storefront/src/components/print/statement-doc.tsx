import type { MemberOrderDetail } from '@pcm/domain';
import { stripPictographs } from '@/lib/print/strip-pictographs';
import { LOGO_DATA_URI, QR_DATA_URI } from './print-assets';
import { StatementPrintButton } from './statement-print-button';
import {
  CONTACT_EMAIL,
  CONTACT_PHONE,
  LEGAL_NAME,
  LEGAL_NAME_EN,
  STORE_ADDRESS,
  TAX_ID,
} from '@/lib/site-config';

// 客人的「訂單明細 / 對帳單」紙面(片 B)。
//
// 🔴 **真權威 = 後台那張紙**,不是我重新設計的:Sean 2026-08-30 拍 `Q-容差 = 甲`,
//    逐字「客人下載的明細 = 後台那張,一模一樣」
//    (`~/pcm-mailbox/等Sean決策-20260829.md:3081` 起那一節,04:2x 十一題那批第 4 題)。
//    ⇒ 本檔的每一塊都對著 `apps/admin/src/components/print/picking-doc.tsx` 抄結構與 class,
//      **不自創任何 `pd-*` class**(`statement-doc-classes.test.ts` 會把自創的抓出來)。
//
// 🔴 **為什麼不是直接 import 後台那支元件**:它吃 `AdminOrderDetail`,而這一頁只拿得到
//    `MemberOrderDetail` —— **兩個型別的欄位不一樣,而那個差是刻意的**(見下面那一格)。
//    共用的三個檔(`print-a4.css` / `print-assets.ts` / `strip-pictographs.ts`)是逐位元組副本,
//    由 `admin-copy-drift.test.ts` 釘住。
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **「一模一樣」與後台那張的【全部】偏離 —— 共 9 處,一張清單**
//
// ⛔ ~~原本這一段寫「有【一格】做不到」~~ 🛑 **那句話是錯的,而它錯的方式最貴**
//    (code-reviewer R1 must-fix,2026-08-30):實際有 9 處(R1 報 7、R2 找到第 8、R3 找到第 9),而**每一處在【它自己的位置】
//    都寫了理由** ⇒ 逐塊看的人不會發現;而**下一個人要回答「這兩張一不一樣」時,
//    讀的是這一段** —— 它說一格。
//    📌 **⇒ 分散的誠實加起來,不等於一句集中的誠實。**
//
//  ① 🔴 **品項表少「狀態」欄**(後台印「未到貨 N」/「數量資料尚未就緒」)⇒ 六欄變五欄。
//     理由**不是**「型別裡沒有」——那是症狀。真正的理由在
//     `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:420-421` 逐字:
//       「本表帶的是營運內部數量事實(已訂/已到貨/已取消),**絕不可**被搬進 storefront 的
//        任何投影 —— **客人看得到「已向上游訂了幾件」等於看得到採購節奏**。」
//     ✅ **而它有一道【活的】守門,不是只有一句註解**:
//        `SupabaseOrderAdapter.test.ts:2707` 的 forbidden-token 格斷言
//        `MEMBER_ORDER_DETAIL_SELECT` **不得含** `order_item_quantity_summary`
//        (同格自帶負對照 `toContain('brands(name)')` ⇒ 那把尺不是恆真)。
//     ⇒ **要把狀態欄補回來,第一件事是讓那格守門變紅** ⇒ 需要新拍板,不是本片能做的。
//     🛑 **而為什麼不印一個空白的狀態欄**(那樣版面才真的一模一樣):後台那張在**全部到貨**時
//        那一欄也是空的 ⇒ 一整欄空白會被讀成「都到貨了」,而我們其實是**不知道**。
//        ⇒ **不知道印成空白 = 印一句我們沒有的保證。**
//  ② 同一個資料源 ⇒ **「品項合計」右半「M 項未到貨」也不印**(連同分隔的全形空格)。
//  ③ **客戶姓名改讀收件快照**:後台取 `detail.customer.name`,而客人側投影刻意不帶 `customers(`
//     (同一格 forbidden-token 守門)⇒ 取 `shippingAddress.name`。同一個人、不同來源。
//  ③' 🔴 **電話也是,而它比姓名多一格**(R3 抓到,而這是這張清單第三次被指出不完整):
//     後台 `picking-doc.tsx:296` 是 `customer.phone ?? shippingAddress?.phone ?? '—'`(**兩層退版**),
//     這裡只有 `addr.phone` 一層 —— 同樣是被 `customers(` 那道邊界逼出來的。
//     ⇒ **客人會員檔電話 ≠ 收件快照電話時,兩張紙會印不同號碼。**
//     📌 而這一格值得停一秒:**清單的全部價值就在「全部」二字** ——
//        它被指出不完整三次(R1 說 1⇒7、R2 說 7⇒8、R3 說 8⇒9),
//        而每一次漏掉的那一處,在【它自己的位置】都寫著理由。
//     ⇒ **分散的誠實加起來不等於一句集中的誠實,而我已經證明了三次。**
//  ④ **已取消的單:照印,不整幅阻印。** 後台那張走 `BlockedSheet`,理由是「員工會照著去倉庫
//     揀一批不該出的貨」—— 那是一個**實體動作**的守門,而客人這一側沒有那個動作
//     ⇒ 照抄會變成「你自己的訂單記錄不給你看」。⇒ 單子照印,而取消印在紙上。
//  ⑤ **讀不到品項:印一句話,不整幅阻印**(同 ④ 的理由);且**金額與 LINE 聯絡區照印** ——
//     一句「請與客服聯絡」旁邊沒有客服,是 R1 抓到的。
//  ⑥ **`itemsTruncated` 沒有頁首警示 Alert。** 後台那兩條 Alert 寫給員工看
//     (「不要拿這張去揀貨」「請回報」)⇒ 對客人沒有意義。表身的佔位列與截斷帶**都在**。
//  ⑦ **列印鈕在紙的最上面、且文案不同**(後台「列印」/ 這裡「列印 / 儲存成 PDF」)——
//     客人要的是後者那個動作,而它是甲案的整個重點。
//  ⑧ **列印鈕的【顯示條件】也不同**(R2 抓到 —— ⑦ 原本只寫了位置與文案,漏了這一半):
//     後台 `picking-doc.tsx:213` 在「已取消 / 截斷 / 空清單」三種狀態**不渲染**那顆鈕,
//     理由是「不再遞刀」—— 印出一張看起來正常的紙,員工就會拿去倉庫做一個實體動作。
//     🛑 **而客人這一側三種狀態下鈕都在,那是刻意的**:同 ④⑤ 的理由 ——
//        客人按下去只會拿到**他自己那張單的現況**,沒有任何實體動作被觸發;
//        而那三種狀態的紙上**都印著它自己是哪一種**(取消日期 / 截斷帶 / 那句話)。
//     📌 **⇒ 後台那道守門守的是【員工會照著做】,而這一側沒有人會照著做。**
//
// ⚠️ **而沒有任何一道守門把這一頁綁在 `picking-doc.tsx` 上**(R1 nit,照實寫):
//    checksum 那格比的是三個共用檔,`masthead-parity` 比的是抬頭四行 ——
//    **版面本體的「一模一樣」今天靠的是這張清單與人的眼睛,不是機器。**
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **這張紙【不印付款資訊】—— 那是 Sean 2026-08-30 的拍板, 不是漏做。**
//
//    題目與他的原話逐字:
//      Q: 客人那張訂單明細,要不要印付款資訊(付了沒 / 怎麼付的 / 哪天付的)?
//      A: 乙   (= 不印, 維持現況)
//
//    🛑 **為什麼這一句要寫在這裡**:`MemberOrderDetail` **有** `paymentStatus` / `paymentMethod`
//       / `paidAt` 三個欄位(`packages/domain/src/order/types.ts:1712-1730`), 而這支檔一個都沒讀
//       ⇒ **下一個開這支檔的人會看到「型別上有、紙上沒有」, 而那個形狀長得就像沒做完。**
//       ⇒ 他會「順手補上」, 而那是在推翻一個他不知道存在的拍板。
//
//    ⚠️ **而代價 Sean 是知情地接受的, 照實寫**(這一格是 R3 用「災難日可用性」角度挖出來的):
//       **未付款的單與已付清的單, 印出來是【同一張紙】** ——
//       客人拿這張去對帳 / 信用卡爭議時, 「付了沒、哪天付的」正是他要的那一格。
//       📌 `types.ts:1722-1727` 那段自己就寫著「**客人沒有第二個來源可以對**」。
//
//    🔵 **而它【不算】對「一模一樣」的偏離** —— 後台那張也不印(當場量,
//       `picking-doc.tsx` 剝掉註解後 `paymentStatus`/`paymentMethod`/`paidAt`/`付款` **各 0 命中**;
//       正對照 `displayId` ⇒ 5)⇒ **兩張紙在這一格本來就一致**, 所以它不進下面那張偏離清單。
// ═══════════════════════════════════════════════════════════════════════════

/** 金額字面 —— 與後台 `lib/orders/order-list-view.ts:986` 逐字同義(`toLocaleString('en-US')`)。 */
function amt(amount: number): string {
  return amount.toLocaleString('en-US');
}

/** 日期時間 —— 與後台 `lib/orders/order-detail-view.ts:84-93` 逐字同義(台北時區、`YYYY-MM-DD HH:mm`)。 */
function dt(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const time = date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} ${time}`;
}

// 抬頭那三行 —— **從 `site-config.ts` 衍生,不硬寫**。
//
// 🔴 **為什麼不照抄後台那份**:後台 `print-masthead.tsx:64-67` 是把同一組登記資料**硬寫第二份**,
//    而那支檔自己的註解逐字承認那是刻意的、且代價是「**它們會各自漂**」——
//    理由是「`site-config.ts` 在 storefront 這個 app,admin 不 import 它(跨 app 依賴 = 另一件事)」。
//    ✅ **而我【就在】storefront** ⇒ 那個理由對這一側不成立 ⇒ 這裡走單一真相。
//    📌 而 `site-config.ts:4` 逐字寫著「**此處為唯一真相,勿在各元件重複硬寫**」,
//       後台那份註解也自陳那句話「那一邊要補的那一行歸 storefront」—— 這就是那一行。
//
// 🔴 **而這不是我自己想到的,是一道守門把我攔下來的**:第一版我照抄了後台那四個常數,
//    `lib/site-config-wiring.test.ts:449`「白名單以外的檔不得出現門市地址字面」**當場紅**,
//    而它的錯誤訊息自己就寫了修法(「要嘛改成從 `STORE_ADDRESS` 衍生」)。
//
// 🔴 **一個字都不准正規化**:全形空格 `　`(U+3000)、`LTD` 後面沒有句點
//    (Sean 逐字「好啦～沒句點,抱歉」)、`+886` 不改 `0`。
// 🔴 **值算在常數裡、不放進 JSX 文字節點** —— 這三行含 U+3000,而 JSX 會在換行邊界做 `\s` trim,
//    `\s` 在 JS 裡**吃得掉 U+3000** ⇒ 格式化工具改一次排版就可能把分隔空格吃掉,而沒有人會發現。
const ISSUER_NAME = LEGAL_NAME;
const ISSUER_LINE1_REST = `　${LEGAL_NAME_EN}　統一編號 ${TAX_ID}`;
const ISSUER_LINE2 = `${STORE_ADDRESS.region}${STORE_ADDRESS.locality}${STORE_ADDRESS.street}`;
// ⚠️ **電話這一格與後台那份差【一個字元】**:`site-config.ts:22` 的 `CONTACT_PHONE` 是
//    `+886-930-531-867`(連字號),而紙上那份是 `+886 930-531-867`(空格)。
//    ⇒ 只換那一個分隔符、**號碼一位數都不動**,讓兩張紙的抬頭逐字相同。
//    🔴 而這個差本身是既有缺口(後台 `print-masthead.tsx` 註解已立案 `#602`)——
//       `masthead-parity.test.ts` 會盯著它,兩邊誰先改都會紅。
const ISSUER_LINE3 = `${CONTACT_PHONE.replace('-', ' ')}　${CONTACT_EMAIL}　LINE @pcmmoto`;

function StatementMasthead() {
  return (
    <header className='pd-masthead'>
      <div className='pd-brand'>
        {/* 三色條 = 三條 border-left(CSS 畫的),純裝飾 ⇒ 對讀屏隱藏。 */}
        <div className='pd-mstripe' aria-hidden='true'>
          <i />
          <i />
          <i />
        </div>
        {/* 🔴 LOGO 走 `LOGO_DATA_URI`,**不得改成 `<img src="/…">` 或 background-image**:
            Sean 2026-08-23 實印,用 background 畫的四樣全不見,而同張紙的文字與框線都在。
            走 data URI 的另一個好處是它不是一個「要去拿」的東西 ⇒ 不會被任何 redirect 吃掉。 */}
        <img className='pd-logo' alt='PCM MOTOR PARTS' src={LOGO_DATA_URI} />
      </div>
      <div className='pd-issuer'>
        <div className='pd-i1'>
          <b>{ISSUER_NAME}</b>
          {ISSUER_LINE1_REST}
        </div>
        <div className='pd-i2'>{ISSUER_LINE2}</div>
        <div className='pd-i2'>{ISSUER_LINE3}</div>
      </div>
    </header>
  );
}

export function StatementDoc({ order }: { order: MemberOrderDetail }) {
  const addr = order.shippingAddress;

  return (
    /* 🔴 `print-sheet` 與 `pd-sheet` 都要在,而它們做的是**兩件不同的事**:
       · `pd-sheet` ⇒ `print-a4.css:277` 起那組 `--pd-*` 變數與字級(不加的話所有 `pd-*` 子類
         都落在沒有變數的世界裡,畫面看起來「有排版但顏色字級全錯」)
       · `print-sheet` ⇒ `@media print` 裡的 `padding:0` + `min-height:250mm`
         (讓紙面邊界**只由** `@page` 決定,不然會內縮兩次)
       `stmt-page` 是螢幕上的容器,對應後台那張紙的 Tailwind `mx-auto max-w-3xl p-6 space-y-4`。 */
    <div data-slot='statement-doc' className='print-sheet pd-sheet stmt-page'>
      {/* 螢幕上才有的列印鈕。**紙上不准有它** —— `statement.css` 的 `@media print` 收掉。 */}
      <div className='stmt-actions'>
        <StatementPrintButton />
      </div>

      <StatementMasthead />

      <div className='pd-doctitle'>
        {/* 抬頭逐字照後台那張(`picking-doc.tsx` 的 `<h1>訂單明細</h1>` + `.pd-en`)。
            🛑 **不要接成「發票」** —— 稿 `:193` 是 2026-08-07 的拍板:
               這一頁 = 訂單明細 / 對帳單,發票走財政部電子發票平台與載具,是另一條路。
               稿上刻意不出現「下載發票」四個字,免得網站端誤接成開立發票。 */}
        <h1>訂單明細</h1>
        <div className='pd-en'>Order Detail</div>
        {/* 🔴 後台那張這裡用 Tailwind `text-xl font-semibold tabular-nums`,
            而 **storefront 沒有 Tailwind** ⇒ 照抄過來會是一個沒有樣式的裸 span。
            ⇒ 換成 `stmt-docid`,而它的三個宣告是**照 Tailwind 的計算值抄的**(見 `statement.css`)。 */}
        <span className='stmt-docid'>{order.displayId}</span>
      </div>

      <section className='pd-info'>
        <div className='pd-col'>
          <span className='pd-label'>客戶</span>
          {/* 🔴 三格都取**收件快照**(`orders.shipping_address_snapshot`),不 join 客戶資料:
              客人搬家後 join 出來是**新地址**,那不是這張單寄去的地方。
              ⚠️ 缺值印 `—`、不得不印 —— 收件人那格缺值是異常,要看得出來
              (`packages/domain/src/order/types.ts:1746` 逐字)。
              📌 後台那張的姓名取 `detail.customer.name`,而客人側投影**刻意不帶 `customers(`**
                 (同一格 forbidden-token 守門)⇒ 這裡取快照上的姓名。同一個人、不同來源。 */}
          <div className='pd-field'>
            <div className='k'>姓名</div>
            <div className='v big'>{stripPictographs(addr.name) ?? '—'}</div>
          </div>
          <div className='pd-field'>
            <div className='k'>電話</div>
            <div className='v code'>{addr.phone ?? '—'}</div>
          </div>
          <div className='pd-field'>
            <div className='k'>地址</div>
            <div className='v addr'>{addr.line ?? '—'}</div>
          </div>
        </div>
        <div className='pd-col'>
          <span className='pd-label'>單據</span>
          <div className='pd-field'>
            <div className='k'>訂單編號</div>
            <div className='v big code'>{order.displayId}</div>
          </div>
          <div className='pd-field'>
            <div className='k'>下單</div>
            <div className='v'>{dt(order.createdAt)}</div>
          </div>
          {/* 🔴 截斷時這個數字**只是已載入的子集**,而它讀起來像總數
              ⇒ 那句限定跟著搬過來(後台那張同款,codex 舊 finding)。 */}
          <div className='pd-field'>
            <div className='k'>品項數</div>
            <div className='v'>
              {order.items.length} 項{order.itemsTruncated && '(清單沒載完)'}
            </div>
          </div>
          <div className='pd-field'>
            <div className='k'>訂單金額</div>
            <div className='v big code'>{amt(order.total.amount)}</div>
          </div>
          {/* 🔴 **這一格後台那張沒有,而它必須在。**
              後台對已取消的單是**整幅阻印**(`BlockedSheet`),理由是「印出一張看起來正常的紙,
              員工就會照著去倉庫揀一批不該出的貨」—— 那是一個**實體動作**的守門。
              🛑 而客人這一側**沒有那個動作** ⇒ 照抄「整幅阻印」會變成
                 **「你自己的訂單記錄不給你看」**,那是把一個倉庫守門套到一個對帳單上。
              ⇒ 處置:單子照印(它是他的記錄),而**取消這件事印在紙上**、不藏。 */}
          {order.cancelledAt !== null && (
            <div className='pd-field' data-slot='statement-cancelled'>
              <div className='k'>狀態</div>
              <div className='v big'>已於 {dt(order.cancelledAt)} 取消</div>
            </div>
          )}
        </div>
      </section>

      {order.items.length === 0 ? (
        /* 🔴 空清單不印一張只有表頭的空表格 —— 那看起來像「這張單沒有東西」,
           而它其實可能是資料讀取出問題。⇒ 印一句話,說清楚是哪一種。
           ⛔ ~~原本這裡用 `.pd-dim`~~ ⇒ **那是 8pt + 灰**(`print-a4.css:811`)
              ⇒ 這張紙上**最重要的一句話會用最小最淡的字印**(R1 nit)⇒ 換成 `.stmt-notice`。 */
        <p className='stmt-notice' data-slot='statement-no-items'>
          這張單目前讀不到任何品項(可能是資料讀取出問題)。請重新整理;仍然一樣請與客服聯絡。
        </p>
      ) : (
        <>
          {/* 🔴🔴 **`<table>` / `<thead>` 這個結構不得改成 div 排版** ——
              跨頁時第 2 頁上緣會自動重複欄名,靠的是瀏覽器對 `<thead>` 的原生行為
              (後台那張 2026-08-15 用真瀏覽器 + 真 A4 分頁量過,含負向對照)。
              改成 div 之後**畫面上看起來一模一樣**,而紙的第 2 頁會少一排欄名。
              ⚠️ 這裡刻意**不加** `print:table-header-group` —— 那等於 UA 預設,
                 是一條永遠不會失效的字面,而紅不起來的守門比沒有更糟。 */}
          <section className='pd-items'>
            {/* 🔴 **~~`<span>本訂單全部品項</span>`~~ 拿掉 —— Sean 2026-08-30 拍板。**
                他的原話逐字(我問「客人那張也一起拿掉嗎」):「**要 拿掉,**
                **但是我的認定,訂單明細=客人看到的那張,是一樣的東西。**」
                🔴 **判準是「它是不是一句【解釋排版/範圍】的小字」, 不是「它在哪張紙上」** ——
                   `品項明細` 這個**標題**留著(那是這一區叫什麼),
                   走的是後面那句**解釋這一區母體是什麼**的話。
                📌 他更早的原話:「**我不要這些奇怪標語**」「**太多標語了, 真的很奇怪**」。 */}
            <h2 className='pd-sech'>品項明細</h2>
            <table>
              {/* 欄寬逐字照後台那張,**扣掉「狀態」那一欄的 20mm**(檔頭那一大段講了為什麼)。 */}
              <colgroup>
                <col style={{ width: '38mm' }} />
                <col />
                <col style={{ width: '14mm' }} />
                <col style={{ width: '24mm' }} />
                <col style={{ width: '24mm' }} />
              </colgroup>
              <thead>
                {/* 🔴 **~~`<tr className='pd-contbar'>` 續頁抬頭整列~~ 拿掉 —— 同一個拍板。**
                    後台那張同日已拿掉(`2370d745`), 而 Sean 說客人那張「要 拿掉」。
                    🛑 **代價照實寫**:**續頁上認不出這是哪一單**。他拍後台那張時已被告知這個代價,
                       而這一張是他自己說「是一樣的東西」⇒ **不要因為「這張是給客人的、更需要編號」
                       而替他保留** —— 那是替他改板。要保留請回去問他。
                    🔵 而那一列裡的 `<i>續頁欄名重複</i>` 那六個字**一直印在紙上**
                       (`print-a4.css` 的 `.pd-contbar th i` 只有 `float`/`font-style`/`color`/
                       `font-weight`, **零隱藏** —— 出貨線的 code-reviewer 開 CSS 查出來的)
                       ⇒ 它正是 Sean 說的那種「奇怪標語」, 跟著整列一起走是對的。
                    ⚠️ **而 `<thead>` 這個結構仍然不得改成 div** —— 跨頁欄名重複靠的是它。
                       走掉的只有 `.pd-contbar` 那一列, 下面 `.pd-colhead` 那一列**還在**。 */}
                <tr className='pd-colhead'>
                  <th>料號</th>
                  <th>品名 / 規格</th>
                  <th className='pd-num'>數量</th>
                  <th className='pd-num'>單價</th>
                  <th className='pd-num'>小計</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} data-slot='statement-item'>
                    <td className='pd-sku'>{item.variantSku}</td>
                    <td className='pd-name'>
                      {stripPictographs(item.title) ?? '—'}
                      {item.spec && (
                        <span className='pd-spec'>
                          {Object.entries(item.spec)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className='pd-num'>{item.quantity}</td>
                    <td className='pd-num'>{amt(item.unitPrice.amount)}</td>
                    <td className='pd-num pd-strong'>{amt(item.lineTotal.amount)}</td>
                  </tr>
                ))}
                {/* 🔴 清單沒載完 ⇒ **表【自己】要說它沒有結尾**,不是只在表尾講一句。
                    `? ? ? ?` 是刻意的 —— 上游只給布林,**印任何具體數字就是編的**。 */}
                {order.itemsTruncated && (
                  <>
                    <tr className='pd-wait'>
                      <td className='pd-sku'>? ? ? ?</td>
                      <td className='pd-name'>
                        未載入的品項 —— 這一列不在這張紙上
                        <span className='pd-spec'>系統一次只列得出 200 項,這張單超過了</span>
                      </td>
                      <td className='pd-num'>?</td>
                      <td className='pd-num'>?</td>
                      <td className='pd-num'>?</td>
                    </tr>
                    <tr data-slot='statement-truncated-band' className='pd-wait'>
                      <td className='pd-state' colSpan={5}>
                        以上不是全部。還缺幾列 —— 系統也不知道,所以這張表沒有結尾。
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </section>

          <div className='pd-totals'>
            <div className='pd-primary'>
              <span className='pd-label'>品項合計</span>
              {/* 🔴 後台那張這裡是 `共 N 項　／　M 項未到貨`(全形空格 U+3000)。
                  **「M 項未到貨」跟著狀態欄一起不印**(同一個資料源、同一道守門)
                  ⇒ 這裡只留左半。⚠️ 分隔的全形空格也一起沒了,因為右半不在。 */}
              <div className='n'>共 {order.items.length} 項</div>
            </div>
          </div>

        </>
      )}

      {/* 🔴 **聯絡方式與金額表【不在】上面那個三元運算子裡面 —— 那是 R1 nit 的修法。**
          原本它們住在「有品項」那一支 ⇒ **讀不到品項時整塊消失**
          ⇒ 一句「請與客服聯絡」旁邊沒有客服,而那正是最需要它的那一張紙。
          ⚠️ 而金額欄位來自 `orders` 自己(不是品項加總)⇒ 品項讀不到時它們**仍然是對的**。 */}
        <div className='pd-bottom'>
          <div className='pd-foot'>
            <section className='pd-contact'>
              {/* 🔴 `src` 走內嵌常數、不是一個網址 —— 同 LOGO 那格的理由。 */}
              <img className='pd-qr' alt='LINE 官方帳號 QR Code' src={QR_DATA_URI} />
              <div className='pd-ctxt'>
                <div className='pd-ch'>加入官方 LINE 帳號</div>
                <div className='pd-cu'>lin.ee/egsf1Jy</div>
                <div className='pd-cp'>
                  收到商品後有任何問題（缺件、外觀損傷、規格不符），請掃描左方 QR Code
                  加入官方 LINE 帳號，並提供本單上的訂單編號。
                </div>
              </div>
            </section>
            <section className='pd-money'>
              <h2>
                金額<span>新臺幣</span>
              </h2>
              <table>
                <tbody>
                  <tr>
                    <td className='k'>小計</td>
                    <td className='v'>{amt(order.subtotal.amount)}</td>
                  </tr>
                  <tr className='line'>
                    <td className='k'>運費</td>
                    <td className='v'>{amt(order.shippingFee.amount)}</td>
                  </tr>
                  {/* 🔴 有折扣才印這一列 —— 沒有時印一列 `0` 會讓客人以為我們算了一筆折扣給他。 */}
                  {order.discountTotal.amount > 0 && (
                    <tr className='line'>
                      <td className='k'>折扣</td>
                      {/* 🔴 負號用 **ASCII `-`**,不是 `−`(U+2212):那個字元在單色印表機
                          與缺字型的環境下不保證印得出來(後台那張被守門抓過一次)。 */}
                      <td className='v'>-{amt(order.discountTotal.amount)}</td>
                    </tr>
                  )}
                  <tr className='grand'>
                    <td className='k'>訂單金額</td>
                    <td className='v'>{amt(order.total.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>
    </div>
  );
}
