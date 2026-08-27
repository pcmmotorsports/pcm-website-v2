// order-detail-summary-cards.tsx — 訂單明細頁上方的三張摘要卡(客戶 / 付款 / 發票)。
//
// 🔴 **片14(2026-08-19)拿掉了「收件與出貨」那一張**,~~原本是四張~~。
//    拿掉的**條件**是它 4 個欄位全部先有了家,不是因為設計稿沒畫它:
//      收件人 / 電話 / 地址 → `shipment-section.tsx` 的「收件人資訊」一行(確認稿 `:345`/`:543`)
//      出貨方式             → 同檔「出貨」標題旁(確認稿 `:343`)
//    ⇒ **先給家、再搬走**;順序反過來會有一個「資訊已消失、新家還沒蓋好」的中間狀態。
// 🔴 **另外三張卡刻意留著**:它們有 8 個欄位在確認稿上**沒有落點**
//    (客人電話/Email、出貨狀態、來源·管道、付款時間、發票需求型式/統編/載具)。
//    而那份稿 `:78` 自己標了覆蓋率「repo 有幾個 / 這張稿畫了幾個」⇒ 九塊合計 **24 / 8**,
//    `:490` 逐字「稿上沒畫,不代表後台比較陽春」。
//    ⇒ **稿答得出【它畫了什麼】,答不出【該不該有】。** 要不要拿掉那三張=待 Sean 拍板,不自決。
//
// 🔴 **為什麼抽出來**(鐵則 6):`order-detail.tsx` 卡在 404 行、距 400 只有 4 行。
//    我在 `#13 片1c-2` 的檔頭立過一條**有期限的**約定:
//    「下一次任何人動 `order-detail.tsx`,**先抽下一塊再改**,不得再走『寫理由』那條路徑。」
//    `#520` 的修法會動那支檔 ⇒ **那條約定生效,所以先做結構、再改行為。**
//
// 🔴🔴 **本檔是【純搬家】:零行為改變。**
//    四張卡的 JSX、`Field`、四個 class 常數逐行照抄,只把縮排往左移兩格
//    (原本多包在 `order-detail.tsx` 的 return 裡一層)。
//    ⚠️ 抽的時候差一點掉一件:那段 `#350c` 的註解**開頭留在原檔、續行被抽走** ——
//       半截註解讓 JSX 直接壞掉。**抽取最容易掉的不是 code,是跨行的註解與 `use client` 邊界。**
//
// ⚠️ **`@container` 的前提沒有變,而它是承重的**:欄數看的是**容器寬度**不是視窗寬度
//    ⇒ **兩個消費者(整頁 / 面板)的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、
//    一律退回 1 欄。那件事釘在 `order-panel-wiring.test.ts`,**本檔沒有把它帶過來,也不該帶** ——
//    它守的是消費者那一側。
//
// 📎 `Field` 與四個常數**只有本檔在用**(抽取前實查:`order-detail.tsx` 內 17 次、
//    全 repo 零外部 import)⇒ 一起搬,不留在原檔當孤兒。

import type { AdminOrderDetail } from '@pcm/domain';

import {
  PAYMENT_STATUS_LABEL,
  GOODS_AXIS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
  INVOICE_STATUS_LABEL, // A11a-5 起共用(原在 order-detail-view.ts,依該檔頭宣告的慣例搬來)
} from '../../lib/orders/order-list-view';
import {
  orderDetailGoodsAxis,
  goodsAxisProgressNote,
} from '../../lib/orders/order-status-axes';
import { customerEmailDisplay } from '../../lib/customers/customer-list-view';
import { AtomicFieldValue } from './atomic-field-value';
import {
  invoiceTypeLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';

/* ═══ BMW M 片4a:摘要卡改成 OD 的「髮絲線格」+ 小標字體 ═══════════════════════════
   **逐字搬 OD `overview-desktop-bmw-m.html:251-257` 的 `.specs` / `.spec` / `.spec .l`。**

   🔴 **分隔線是【格線縫隙透出底色】,不是每張卡自己畫框**:
      OD `:251-252` = `gap:1px; background:var(--border); border:1px solid var(--border)`
      + `:253` `.spec{background:var(--surface)}` ⇒ **1px 的縫讓容器底色透出來當線。**
      我方對應 = 容器 `gap-px bg-border border`、每格 `bg-card`(見下方 grid)。
      ⚠️ **這不是「把 gap-4 改小」** —— 舊版是四張**浮著的卡**(各自有框、中間 16px 空隙),
         新版是**一塊被切成四格的面板**。**視覺分組的語意變了**,而那正是 BMW M 的樣子。
   ⚠️ **`rounded-lg` 一併拿掉**:片1 已把 `--radius-lg` 釘成 0 ⇒ **它今天就已經是方角、拿掉零視覺差**;
      留著只會讓下一個人以為這裡還有圓角。**這是清掉一個誤導字面,不是改外觀。**
      🔴🔴 **2026-08-23 晚:上面那句「拿掉零視覺差」現在是【假的】(原句不改,加註)。**
         Sean 逐字裁「乙 不算了 —— 照 OD 新稿,**全部圓角**」,線A 把 `--radius-lg` 從 0 改成 **8px**。
         ⇒ 當初「拿掉它零視覺差」成立,是因為**那個 token 當時是 0**;token 一變,
           **這幾張卡就與其他有圓角的卡不一致了,而拿掉的那一行不會自己回來。**
         🔴 **判別句**:寫「拿掉這個等於沒差」時,先問**那個「沒差」是恆真的,還是靠某個值目前剛好是 0?**
           靠值 ⇒ 那不是清掉誤導字面,是**把一個決定藏進一個會變的前提裡**。
         ✅ **2026-08-23 夜結案:這幾張卡【維持方角】,而且那是量到的,不是「不改比較省事」。**
            線A 用 `tool-final-css.py`(五個世界自檢全 PASS)量 OD 產物頂層最終值:
            `[data-od-panel="customer"] section` ⇒ **`0`** —— 客戶·發票那一頁的卡片在稿上**就是方角**。
            (同一發量到的對照:同層的 `[data-od-panel="money"] … > summary` 是 **8px** ⇒ **稿上是混的**。)
            ⇒ **現況(這裡沒有任何圓角 class ⇒ 0)已經與稿一致,零改動。**
         🔴🔴 **而我差一點問錯題**:我原本端出去的是「摘要三卡**要不要**補回圓角」——
            那個問法**預設了三張卡同一個答案**,而稿上根本不是。
            ⇒ **一個把答案空間預先收窄的問題,比一個沒問的問題更危險** —— 它會得到一個看起來
              有人拍過板的答案。**先去量真權威,再決定問題長什麼樣。**

   🔴 **小標字體 = OD `.spec .l`(`:256-257`),而三件裡一樣只搬得動兩件**:
      OD = `font-size:var(--text-xs); font-weight:700; letter-spacing:1.5px; text-transform:uppercase`。
        ✅ 搬 `font-weight:700`(`font-medium` → `font-bold`)與 `letter-spacing:1.5px`。
        🔴 **不搬 `uppercase`** —— 四個標題全是中文(客戶資訊 / 收件與出貨 / 付款 / 發票),
           **對 CJK 是 no-op**:寫上去畫面一個像素都不會變,卻會留下一行「已照 OD 做大寫」的假字面。
           **與訂單表表頭同一個判斷,不是各自決定的。**
   ✅ **OD `.spec .v` 那個「大數字」已於片4b 落地** —— 🔴 2026-08-27 起它**不在本檔**,
      搬到 `order-focal-row.tsx`(Sean 拍乙);~~見下方 `OrderFocalRow`~~ **本檔已無那個 export**。
      上一版這裡寫「沒有做…那是內容決策,已排給 Sean」,**Sean 2026-08-16 已拍板要哪些數字**
      ⇒ 那句話連同「不要順手把 `.v` 補上去」的禁令一起**在他拍板的那一刻就過期了**,
      而它**不會有任何東西紅**。留這行是要讓下一個人知道禁令已解除、不是漏刪。 */
/* ═══ FIX-02(OD):客戶／付款／發票三欄壓密 ═══════════════════════════════════════
   症狀逐字:「卡片 `p-4`、每列 `py-1`、標題 `mb-3`,**三欄佔掉第一屏一大半**」。
   改法逐字:`p-4` → `px-4 py-3`;列 `py-1` → `py-0.5`;標題 `mb-3` → `mb-2`。
   🔴 **欄位內容一項沒動**(OD 逐字)—— 這一片只有三個間距 token,零欄位增刪、零文案。
   ⚠️ **`CARD` 改完之後與下面 `SPEC` 的 `px-4 py-3` 逐字相同,而那【不是】可以合併的訊號**:
      `SPEC` 的值來自 OD `.spec` 本來就有的 `var(--space-3) var(--space-4)`,
      `CARD` 的值來自本次壓密。**兩個常數同值是巧合;合併會讓其中一邊之後改不動。** */
const CARD = 'bg-card px-4 py-3 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-2 text-xs font-bold tracking-[1.5px]';
const ROW = 'flex justify-between gap-4 py-0.5 text-sm';
const ROW_LABEL = 'text-muted-foreground shrink-0';

/* ═══ BMW M 片4b:頭條數字(OD `.spec .v` + `.l`)═══════════════════════════════════
   規格 = `docs/specs/2026-08-16-bmw-m-headline-numbers-spec.md`(Sean 已批內容)。

   🔴 **`.v` 逐字搬 OD `overview-desktop-bmw-m.html` 的 `.spec .v`**(用 grep `\.spec \.v` 找,不給行號):
      `font-size:var(--text-xl)`(= OD `:34` `--text-xl: 24px`)→ `text-2xl`(Tailwind 24px)
      `font-weight:300` → `font-light` / `letter-spacing:var(--tracking-display)`(= `-0.025em`)
      → `tracking-[-0.025em]` / `font-variant-numeric:tabular-nums` → `tabular-nums`
      / `line-height:1.15` → `leading-[1.15]` / `color:var(--fg)` → `text-foreground`
      ⚠️ **不搬 `font-family:var(--font-display)`** —— 我方沒有 `--font-display`(BMWTypeNext 是授權字型)。
         寫上去會靜靜 fallback,留下一行「已照 OD 用 display 字體」的假字面。
   🔴 **`.spec` 的 padding 是 `var(--space-3) var(--space-4)` = 12px 16px ⇒ `px-4 py-3`**,
      **不是**四張卡的 `p-4` —— OD 這兩個值本來就不同,不要為了「看起來一致」抹平。
   🔴 **`.l` 在 `.v` 【下面】**(OD `.spec .l` 帶 `margin-top:var(--space-2)`)——
      與四張卡的 `CARD_TITLE`(`mb-3`、在上面)方向相反,**那是 OD 自己的兩種角色**:
      卡片標題是段落標題、`.l` 是大數字的註腳。⇒ `mt-2`,不共用 `CARD_TITLE`。
   🔴 **一樣不搬 `text-transform:uppercase`** —— 標籤全中文、對 CJK 是 no-op(全檔第三次同一判斷)。

   ⚠️ **「寫數字就好 我們看得懂」(Sean 逐字)講的是【數值呈現】** —— 數字旁不加解釋文字。
      **它不是「拿掉標籤」**:他隔一輪逐字更正「**小標留著**」。兩個讀法都能從同一句話推出來,
      而只有一個是對的。⇒ `.l` 一定要在。 */
// 🔴🔴 **`SPEC` / `SPEC_V` / `SPEC_L` 三個常數已於 2026-08-27 刪除(焦點列抽檔,Sean 拍乙)。**
//    它們只有那三張大卡在用,而那三張卡整組被稿的焦點列取代了。
//    ⚠️ **而 `SPEC_V` 的值 `text-2xl leading-[1.15] font-light …` 在現行 OD 稿的 payload 裡是 0 個**
//       ⇒ 它不是「暫時沒人用」,是**那種東西在稿上已經不存在**。要復活它得先回去對稿。
//    🔴 **它們是【lint 抓不到】的死碼**(code-reviewer 2026-08-27 nit;我實跑 eslint ⇒ rc=0 零輸出):
//       模組內未使用的 `const` 不在 `no-unused-vars` 的預設射程裡
//       ⇒ **「三綠通過」與「沒有留下死碼」是兩個宣稱**,而這一片一度同時符合前者、不符合後者。

/**
 * 🔴 `atomic` = 這個值**斷開之後會變成一個「讀得通而錯」的東西**(email / 電話 / 時間戳 /
 *    發票號碼 / 載具 / 金額)⇒ 走不換行 + 截斷 + tooltip,理由與量到的數字見
 *    `atomic-field-value.tsx` 檔頭。
 * ⚠️ **預設是 false,而預設那條路仍然是 `break-all`** —— 不要順手把全部改成 atomic:
 *    出貨狀態那種**本來就帶換行**的多行值套上去會被吃掉換行。
 */
function Field({
  label,
  value,
  atomic = false,
}: {
  label: string;
  value: React.ReactNode;
  atomic?: boolean;
}) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      {atomic && typeof value === 'string' && value !== '' ? (
        <AtomicFieldValue text={value} />
      ) : (
        /* 🔴 `break-all` → `break-keep break-words`(2026-08-21,量到的):
           ~~`break-all`~~ = `word-break: break-all` **允許在任何字元中間斷**,實測把
           「網站 · 線上刷卡」斷成「網站 · 線上刷」/「卡」—— 斷在一個詞的中間。
           · `break-keep`(`word-break: keep-all`)= **不在詞內斷**,CJK 連續字串也當一個詞
             ⇒ 實測該格「斷在 token 中間」1 → 0,而**格高不變(40px)、零溢出**。
           · `break-words`(`overflow-wrap: break-word`)= 保險絲:**單一 token 真的塞不下時**
             才斷它,免得 `keep-all` 讓超長值直接溢出格子。
           ⚠️ 這條路是給**斷開也不會被讀錯**的值走的(人名/狀態標籤)。
              email / 時間戳那種斷開會變成「讀得通而錯」的,走上面的 `atomic`。
           🔴🔴 `min-w-0`(#805,2026-08-21 A窗量到、B窗補根因+修):這個 span 是 `ROW`
              (`flex justify-between`)裡的 flex child,沒有它時瀏覽器預設 `min-width:auto`,
              長字串會把 span 撐到自己內容的完整寬度、直接溢出卡片右邊界、被隔壁那張卡的
              不透明底色蓋住(不是 CSS 裁切,是視覺遮蔽——`overflow` 量出來是 `visible`)。
              `min-w-0` 讓這個 flex child 真的能縮到比內容窄,`break-words` 才有機會接手換行。
              實測(37字姓名,本機 `localhost:3021` 真瀏覽器,DOM 注入長字串,非單元測試):
              修前 overflow 195px,只看得到約 23 字;修後零溢出、換行顯示。 */
        /* 🔴 `??` 接不住空字串(2026-08-21 線 E 真瀏覽器實量)。
           `customer.phone` 進來的是 `''` 不是 `null` ⇒ `'' ?? '—'` 仍然是 `''`
           ⇒ 那一格渲染成一個空 `<span>`,畫面上什麼都沒有。
           實量(同一張單、`localhost:3021`):電話 span 內容 `""`;
           對照發票號碼 `—`(它是 `null` ⇒ 舊的 `??` 接得住)⇒ **同一個元件兩種結果**。
           🔴 **空白同時相容於【客人沒留電話】與【電話沒載到】** ——
              而本檔自己寫著這條(anchor:grep `「不知道」與「是 0」不是同一件事`)。
           🔴 **`'—'` 只解掉一半,不要以為這格做完了**:它讓「這格是空的」看得見,
              **仍然分不出「客人沒留」與「沒載到」** —— 要分得出來得由呼叫端傳兩種不同的空
              (那是資料層的事,不在本片)。 */
        <span className='min-w-0 text-right break-keep break-words'>
          {value == null || value === '' ? '—' : value}
        </span>
      )}
    </div>
  );
}

// #350c:欄數改看**容器寬度**而不是視窗寬度(主視窗 2026-08-10 裁④)。
// 🔴 為什麼非改不可:同一份明細現在有兩個容器 —— 整頁版(~72rem)與右側面板(~36rem)。
// 用 `md:`/`xl:` 這種 viewport 斷點的話,1920 螢幕上的 576px 面板會**硬排四欄**、每欄擠到不能看。
// 容器斷點 `@md`(28rem)/ `@4xl`(56rem)⇒ 面板 2 欄、整頁 4 欄。
// ⚠️ **兩個消費者的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、一律退回 1 欄
// (`order-panel-wiring.test.ts` 有一格把兩邊的 `@container` 釘住)。
/**
 * 🔴 **`GoodsAxisValue` 不是這一片新寫的輔助函式** —— 它是從 `order-detail.tsx` **原封搬過來的**
 *    (2026-08-16 收割 `customers` 分支時,void-readers 把明細抽成本元件 ⇒ 它必須跟著搬)。
 *    **不要因為「這裡只有一個地方用到」就把它就地展開或刪掉** —— 它的守門與 docstring 都認這個名字。
 */
/**
 * 「出貨狀態」那格的值 = 軸的中文 + **一行解釋為什麼是這個字的小字**。
 *
 * 🔴 **為什麼要有這行小字**(Sean 2026-08-15 拍板乙):改讀真相之後,`RCPVVJ` 那張單
 *    上方摘要寫「未訂貨」、品項列寫「訂貨 3/6」—— **兩個都對,而放在一起讓人看不懂**
 *    (軸的定義是「該單所有品項都訂滿才算已訂」,3<6 ⇒ 退回前一階)。
 *    ⚠️ 後果不是美觀問題:**員工可能讀成「還沒下單」而重複下單、同一批貨訂兩次。**
 *    需求檔 `docs/specs/2026-08-12-admin-order-ui-design-brief.md:114` 早就要求
 *    「這個定義要在畫面上讓人看得懂」—— `#514` 只做了改讀真相那半,這片補另一半。
 *
 * 🔴 **軸值本身一個字都不動**(`GOODS_AXIS_LABEL` / `ORDER_GOODS_AXIS_VALUES` / 篩選 chip / adapter
 *    全部沒碰)⇒ 這片不中鐵則 8。小字是**加上去的解釋**,不是新的狀態。
 *
 * 規則與它依賴的三條 DB CHECK 寫在 `goodsAxisProgressNote` 的 docstring,**不在這裡重複一份**
 * (兩份會漂;那條規則的正當性屬於算它的地方)。
 *
 * 🔴 **守門在 `app/orders/[id]/refund-wiring.test.tsx` 的 `describe('出貨狀態的解釋小字')`(六格)。**
 *    **檔名對不上是刻意的**,「為什麼不改名」寫在 `goodsAxisProgressNote` 的 docstring
 *    (E 窗 2026-08-15 `E-629` nit1)。⇒ **動這一格的渲染 = 必跑那六格。**
 */
/* ═══ `itemsTruncated` 閘(2026-08-16 片4c)══════════════════════════════════════════
   🔴🔴 **這一片的範圍比它被登記的樣子大,而那個差別是我實查出來的、不是規格寫的。**

   backlog 登記的是「**那行小字**沒有截斷閘」。實查之後,**軸的標籤本身也沒有** ——
   而**標籤那半嚴重得多**:
     · 小字錯 = 印出一個**少算的分數**(「本單 N 件中已訂 M 件」,N/M 只加總前 200 列)
     · 標籤錯 = 印出一個**錯的狀態**。`goodsAxisOfLines` 三條判定都是 `.every(...)`
       ⇒ **看得見的 200 件全出貨了就答「已出貨」,而沒載進來的那 50 件可能一件都沒出。**
   ⇒ **員工看到「已出貨」會停止動作。** 少算一個數字他還會去查;講錯狀態他不會。
   ⚠️ **字面是「已出貨」不是「出貨完成」**(code-reviewer 2026-08-16 抓到我引錯):
      `出貨完成` 是**列表**八值 `ORDER_STATUS_LABEL.paid.shipped`,**這一格印的是**
      `GOODS_AXIS_LABEL.shipped` = `已出貨`(`order-list-view.ts` 搜 `shipped: '已出貨'`)。
      🔴 我原本那句戲劇性描述,描述的其實是**列表那條軸** —— 而列表那條有它自己的問題(見下)。

   🔴 **截斷是【單向樂觀】—— 不會往保守的方向錯,所以只能 fail-closed。**
      `.every()` 對子集**單調**:全集為真 ⇒ 子集必為真;反之不然。
      ⇒ **子集算出來的階段恆 ≥ 真實階段**,不存在「因為截斷而停在較低階」那個方向。
      ⚠️ **我第一版寫「兩個方向都會錯…軸會停在較低階(保守、無害)」,那句是錯的**
      (code-reviewer 2026-08-16 抓到):我舉的例(沒載進來的已出貨、看得見的沒出)
      **全集算出來也是同一個低階 ⇒ 那根本不是錯誤,是正確答案。**
      🔴 把一個「非錯誤」寫成「錯誤的另一個方向」,會讓下一個人以為這裡有雙向風險要權衡,
         而**真相是單向的、沒有權衡空間**。同檔 `order-status-axes.ts` 搜 `剛好給對答案`
         記過同型教訓:「用錯的分母剛好給對答案,不是它對」。

   ⚠️ **閘只能裝在這裡,不能裝進 `goodsAxisOfLines`** —— 它的參數型別刻意收窄成
      「有 `items`、每件帶 `quantity` 與 `quantitySummary`」,看不到 `itemsTruncated`
      (理由寫在 `orderDetailGoodsAxis` 的 docstring)。這與頭條那格是**同一個結構決定**。

   📎 **文案對齊既有兄弟**:`shipping-doc.tsx` 搜 `品項清單這次沒有完整載入` 與
      `item-procurement-section.tsx` 的 `TruncationWarning` 都是同一句起手。
      **這裡不用 banner** —— 它住在一個 label-value 的窄格裡,banner 會把整張卡撐開。

   ⚠️ **風險已量、代價不對稱(與頭條那格同一組理由)**:
      `ORDER_ITEMS_EMBED_LIMIT = 200`(`packages/adapters/src/supabase/mappers/order.ts`
      搜 `ORDER_ITEMS_EMBED_LIMIT`)⇒ 機車零件單實務上到不了。
      **但讀它的代價只是「截斷時改印未知」,不讀它的代價是【講錯狀態而零訊號】。** */
function GoodsAxisValue({ detail }: { detail: AdminOrderDetail }) {
  if (detail.itemsTruncated) {
    return (
      <>
        未知
        <span className='text-muted-foreground block text-xs'>
          這張單的品項清單這次沒有完整載入,算不出出貨狀態。請重新整理。
        </span>
      </>
    );
  }
  const note = goodsAxisProgressNote(detail.items);
  return (
    <>
      {GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]}
      {note !== null && <span className='text-muted-foreground block text-xs'>{note}</span>}
    </>
  );
}


/**
 * 客戶 / 付款 / 發票 三欄。
 *
 * 🔴 **抽成具名元件是 OD FIX-07 分頁化的需要,DOM 一個節點都沒動** ——
 *    `OrderSummaryCards` 不給 `section` 時渲染出來的樹與抽之前**逐字相同**。
 * ✅ **2026-08-23 改成 export**(審查 important 5):`OrderSummaryCards` 那個外殼刪掉之後,
 *    呼叫端(`order-detail.tsx` 的「客戶 · 發票」分頁)直接叫它 ⇒ 它現在有真的消費者了。
 */
export function OrderInfoCards({ detail }: { detail: AdminOrderDetail }) {
  return (
      <div className='grid gap-px border bg-border @md:grid-cols-3'>
        <section className={CARD}>
          <h2 className={CARD_TITLE}>客戶資訊</h2>
          <Field label='姓名' value={detail.customer.name} />
          <Field label='電話' value={detail.customer.phone} atomic />
          <Field label='Email' value={customerEmailDisplay(detail.customer.email)} atomic />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>付款</h2>
          <Field label='付款狀態' value={PAYMENT_STATUS_LABEL[detail.paymentStatus]} />
          {/* 🔴🔴 `#514`:這一格**改讀貨品軸的真相**,不再讀 `orders.fulfillment_status`。
              那一欄的 COLUMN COMMENT 自己寫著「E10 起停止維護、值為 legacy stale、不得當現況真相」
              (`20260729010000_m4b_e10_d0_display_id_expand.sql:88` 逐字),而**全 migrations 零 writer**
              ⇒ 正式庫 13/13 全是 DEFAULT `notOrdered` ⇒ **這一格從來沒有正確過一次**。
              ⚠️ 那條 COMMENT 防的是「有人拿它做判斷」,**沒防「有人把它畫出來」——`render` 不是判斷**。
              🔴 **文案一個字都沒變**:`GOODS_AXIS_LABEL` 與 `FULFILLMENT_STATUS_LABEL` 字面逐字相同
                 (`order-list-view.ts` 兩張表的 docstring 互相記著這件事)⇒ **變的只有資料從哪來**。
              ⚠️ **修完之後多數單仍顯示「未訂貨」,而那是對的** —— 正式庫多數單還沒採購;
                 要證明它真的改讀了,看**有採購紀錄的那張單**(`order-status-axes.test.ts` 釘了那一格)。 */}
          <Field label='出貨狀態' value={<GoodsAxisValue detail={detail} />} />
          <Field
            label='來源 · 管道'
            value={`${ORDER_SOURCE_LABEL[detail.orderSource]} · ${PAYMENT_CHANNEL_LABEL[detail.paymentChannel]}`}
          />
          <Field
            label='付款時間'
            value={detail.paidAt ? formatOrderDateTime(detail.paidAt) : null}
            atomic
          />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>發票</h2>
          <Field label='需求型式' value={invoiceTypeLabel(detail.invoiceRequest.type)} />
          {detail.invoiceRequest.taxId && (
            <Field label='統編 / 抬頭' value={`${detail.invoiceRequest.taxId} ${detail.invoiceRequest.title ?? ''}`} />
          )}
          {detail.invoiceRequest.carrier && (
            <Field label='載具' value={detail.invoiceRequest.carrier} atomic />
          )}
          <Field label='開立狀態' value={INVOICE_STATUS_LABEL[detail.invoiceStatus]} />
          <Field label='發票號碼' value={detail.invoiceNumber} atomic />
          <Field
            label='發票金額'
            value={
              detail.invoiceAmount ? `NT$ ${formatOrderAmount(detail.invoiceAmount.amount)}` : null
            }
            atomic
          />
          </section>
      </div>
  );
}
