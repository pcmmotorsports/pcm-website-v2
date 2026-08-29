import { stripPictographs } from '@/lib/print/strip-pictographs';
import type { AdminOrderDetail, AdminOrderDetailItem } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { BlockedSheet } from './blocked-sheet';
import { PrintButton } from './print-button';
import { QR_DATA_URI } from './print-assets';
import { PrintMasthead } from './print-masthead';

// #10 片1:⛔ ~~揀貨單(給倉庫的人拿在手上、對著箱子勾的那張紙)~~
//    🔴 **2026-08-23 起這張紙是【訂單明細】,不是揀貨單了**(Sean 拍板;紙上抬頭已是「訂單明細 / ORDER DETAIL」)。
//    ⇒ 舊字面留著不刪 —— 下面整段的理由是【對揀貨單而言正確】的,而對象換了。
//
// ⛔🔴🔴 ~~**本檔不得出現任何金額。** 揀貨的人不需要知道這批貨賣多少錢,~~
//    ~~而這張紙會被拿到倉庫、放在桌上、可能被客人瞄到 ⇒ 少印一個欄位就少一個外洩面。~~
//    ~~同理 **不印收件地址與電話**(那是出貨單的事,片2)。~~
//    ~~⚠️ 這條**不是**風格偏好,是這片的驗收條件…⇒ 想在這裡加金額的人:先去改那格測試。~~
//
// 🔴🔴 **上面整段自 2026-08-29 起為假 —— 本檔【現在要印】金額與收件資訊。**
//    兩個拍板,都是 2026-08-29:
//      ① `Q-DETAIL-MONEY` Sean 拍【甲 要印金額】(理由逐字「訂單明細 = 完整的一張訂單」)
//      ② PII Sean 拍【甲 要(照稿)】⇒ 推翻 `page.tsx` 那條「只印姓名」
//    落點與原句:`apps/admin/src/app/print/orders/[id]/picking/page.test.tsx:180-189`
//    (那格斷言已整格反轉成 `②' 訂單明細【必須】有金額三欄與收件資訊`)
//      + `~/pcm-mailbox/等Sean決策-20260829.md`
//      + `memory/project_0829-sean-order-detail-prints-full-pii.md`
//    🛑 **而反轉的是【對象】不是紀律** —— 舊那道守門是用突變驗過的,它對【揀貨單】是正確的。
//
// 🔴 **⇒ 所以那句「想加金額的人先去改那格測試」現在是【反過來】的**(這是本次更正的重點):
//    **想【拿掉】金額或收件資訊的人 —— 先去看 `page.test.tsx:189` 那格,它現在斷言那些【必須在】。**
//    ⚠️ 而那一步一樣會逼你回來想清楚為什麼:那兩樣是 Sean 親口要的,拿掉要新的拍板。
//
// 📌 **為什麼整段劃掉而不是刪掉**(2026-08-29 線A `-e9` 更正,主視窗 `-48` 指定):
//    測試那一半在拍板當天就改對了(舊斷言劃掉 + 附拍板出處),**而這段註解沒有跟著改**
//    ⇒ 它變成一份【指路指反了】的文件:照它走的人會走到一個與它相反的地方,**而兩邊都很篤定**。
//    🔴 **過期註解的危害分級:描述現況的過期 < 指路的過期。這一段屬於後者。**
//
// 🔴 為什麼是「訂單為單位」而不是「箱為單位」:**先揀貨、才裝箱** ——
//    揀的時候箱子還不存在(`shipments` 那一列還沒被建出來)。
//    箱為單位的版本是出貨單的事,而且要新讀模型(`shipment_items` 沒有品名/料號)。
//
// 🔴 **沒有公司抬頭,這是刻意的。** 第一版我放了一個 `COMPANY_NAME` 常數又給它 `print:hidden`
//    ⇒ 那顆字面**永遠不會出現在紙上**,而我的 plan 卻拿「紙上唯一 hardcode = 公司抬頭」
//    當 L1 的理由 —— 字面與事實不符。揀貨單是**給自己人**的內部紙,不需要抬頭 ⇒ 整個拿掉。
//    ⇒ 本檔紙上的 hardcode 只剩「揀貨單」與欄名,那些不會改 ⇒ L1 仍成立。

/**
 * 這一列**這次該揀幾件**。`null` = 不知道(不是 0)。
 *
 * 🔴🔴 **算式 = 已到貨 − 已出貨,不是下單量。** 這是 R1 must-fix 3+4 的修法,
 * 而那兩條 finding 其實是**同一個病的兩個面**:「揀貨單不反映貨的真實狀態」。
 * 我折之前列過這病的全部面,一次修掉,不只改被指名那兩處:
 *   面1 整單取消(`cancelledAt`)      → 見下方 `PickingDoc` 開頭,整張紙擋掉
 *   面2 部分取消(`cancelledQuantity`)→ 本算式(取消掉的那幾件**不會到貨** ⇒ 不在 instock 裡)
 *   面3 未到貨(代購!貨從供應商來)   → 本算式(沒到的不在 instock 裡)
 *   面4 已出貨(`shippedQuantity`)    → 本算式(已寄走的扣掉,不再揀一次)
 *   面5 摘要為 `null`                 → 本函式回 `null`,呼叫端 fail-closed
 *   面6 `itemsTruncated`              → 既有處置
 *   面7 `items` 空陣列                → 見下方空清單提示
 *   面8 退款中                        → **錢的軸,不動貨** ⇒ 明確不在本片範圍(不是漏掉)
 *
 * 🔴 **為什麼敢減 `shippedQuantity`,而 `types.ts:793-797` 明寫「看到 shipped 就順手減一下 = 改壞方式」**:
 * 那段話管的是 **`cancellableQuantity`(可取消量)**,它的算式 `quantity − instock − cancelled`
 * 刻意不減 shipped,因為 `shipped ⊆ instock`、再減一次就是**重複扣**。
 * 本函式問的是**另一個問題**:「倉庫裡現在還有幾件是這張單的、而且還沒寄走」——
 * 那就是 `instock − shipped`,兩者不衝突。**同一個欄位、不同用途,不要把那條禁令套過來。**
 *
 * 🔴 **`null` 一律回 `null`、絕不補 0**:契約在 `packages/domain/src/order/types.ts:739-762`
 * 逐字「`null` 的意思是「不知道」,不是「都是 0」」+「`null` 時一律 fail-closed …不得自行補 0」。
 * 同段把用途分兩類:純顯示可以 COALESCE、**守門/上限/判斷不可以**。
 * ⚠️ **揀貨單屬後者** —— 紙上的數字會讓人去倉庫做一個實體動作,那是指令不是顯示。
 * (該段落我親自開檔定位;R1 reviewer 引的 `:785-800` 是 `shippedQuantity` 的 docstring、不是這條規則。)
 */
export function pickableQuantity(item: AdminOrderDetailItem): number | null {
  const s = item.quantitySummary;
  if (s === null) return null;
  // 兩個和都由 A4a trigger 重算並由 CHECK 釘死;`shipped ⊆ instock`(Sean 2026-08-05
  // 拍板「出貨必先到貨、無直送」)⇒ 這個差恆 ≥ 0。仍夾 0 是因為我不想在紙上印負數。
  return Math.max(0, s.instockQuantity - s.shippedQuantity);
}

/**
 * 🔴 `slot` 是**給量測管線抓狀態用的錨點**,不是樣式,也不是給人看的。
 *
 * **為什麼要有它**(2026-08-18,一次真的 dev 紅換來的):
 * `page-measure.test.tsx` 原本用 `toContain('達到 200 筆上限')` 之類的**文案字面**
 * 去確認「這份 fixture 真的處在 B 態」⇒ **同一句話有兩個所有權人**
 * (那支檔一份、`page.test.tsx` 一份)⇒ **必然會漂,而漂的那天只有一邊會紅。**
 * 實際發生:改文案那一顆同步了 `page.test.tsx`、漏了量測管線 ⇒ dev 紅。
 *
 * ⇒ **分家**:文案的所有權**只在 `page.test.tsx`**;量測管線改抓這個 `data-slot`。
 * 🔴 **這不是把守門放寬** —— 判別法是兩句都要成立:
 *   **改文案時量測管線不該紅** ／ **文案錯時 `page.test.tsx` 一定要紅。**
 */
function Alert({ children, slot }: { children: React.ReactNode; slot?: string }) {
  return (
    <div
      role='alert'
      data-slot={slot}
      className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-800'
    >
      {children}
    </div>
  );
}

// 🔴 A3-3'(2026-08-29):~~`needsPicking()` 與它的 docstring~~ **拿掉** ——
//    它的唯一消費端是 `pickableCount`, 而那是已被拿掉的「本次應揀合計」的來源。
//    ⚠️ 它的 docstring 逐字寫著「它有**兩個**消費端 —— 那一列的勾選框、與底下的『本次應揀合計』」
//       ⇒ **兩個都不存在了** ⇒ 留著會讓下一個人以為這張紙還有勾選邏輯。
//    🔴 而 `eslint`/`tsc` 對它【零輸出】—— 死碼在這個設定下沒有任何機制看得見。

export function PickingDoc({ detail }: { detail: AdminOrderDetail }) {
  // 🔴 面1:整單已取消 ⇒ **不印品項表**。
  //    理由不是版面,是「已取消訂單的揀貨單沒有任何正當用途」——
  //    印出一張看起來正常的紙,員工就會照著去倉庫揀一批不該出的貨。
  //    ⚠️ 這裡是**真正的守門**;`order-detail.tsx` 那顆鈕改成已取消時不渲染只是 UX ——
  //    網址可以被貼、被書籤、或在分頁開著的時候訂單才被取消,那些路徑都繞過鈕。
  const cancelledAt = detail.cancelledAt;

  // 🔴 **合計走與那一列【同一支函式】,不另外數一次。**
  //    這正是今天 `#522` 那個病的形狀:同一個概念在兩個地方各算一次,然後其中一邊被改掉。
  //    ⇒ 「這一列有沒有勾選框」與「合計要不要算它」必須是**同一個判斷**,
  //      否則會出現「有 9 個框、合計說 8 項」這種紙,而它印得出來、沒有任何東西會紅。
  //    ⚠️ 所以判斷收成 `needsPicking` 一支、算一次存成 `pickables` 一份,
  //      勾選框與合計【都讀它】—— 不是「兩邊寫得一樣」,是**兩邊沒有各自的版本可以漂走**。
  const pickables = detail.items.map((item) => pickableQuantity(item));
  // 🔴 A3-3'(2026-08-29):~~const pickableCount = pickables.filter(needsPicking).length;~~
  //    **拿掉** —— reviewer R1 MF9:它零讀取(唯一消費端是已被拿掉的「本次應揀合計」),
  //    而 `eslint` 對它 rc=0 零輸出 ⇒ **死碼而 lint 看不見**。
  const unknownCount = pickables.filter((q) => q === null).length;
  // 🔴 A3-4':稿的「品項合計」逐字是 `共 N 項　／　M 項未到貨`
  //    M = 有多少【品項列】還沒到齊(客人買的 > 已到貨)。
  //    ⚠️ `quantitySummary` 為 null ⇒ **不知道**, 而不知道【不算進未到貨】——
  //       算進去會把「我們不知道」印成「我們知道它沒到」。那一格由頁首 Alert 承擔。
  const waitingCount = detail.items.filter(
    (it) => it.quantitySummary !== null && it.quantitySummary.quantity > it.quantitySummary.instockQuantity,
  ).length;

  return (
    /* 🔴 `print-sheet` 是 `app/print/print-a4.css` 唯一的掛勾:列印時把 `p-6` 歸零,
       讓紙面邊界**只由** `@page{margin:12mm 12mm 14mm 12mm}` 決定,不然會內縮兩次。
       ⚠️ 改名要同步那支 CSS;改名後的症狀是**紙印出來邊距不對**,三綠與單測都不會紅。
       📎 Sean 逐字「出貨單都是 A4」⇒ **揀貨單一起吃**,兩張紙同一套版面。 */
    <div data-slot='picking-doc' className='print-sheet mx-auto max-w-3xl space-y-4 p-6 print:max-w-none pd-sheet'>
      {/* 🔴 A3-2'(2026-08-29):這張紙改吃【與出貨單同一套】的抬頭 ——
          Sean 2026-08-23 拍板(壓縮轉述, 原話見 memory `project_0823-sean-shipping-doc-server-render.md:19-20`)
          「原揀貨單鈕改成訂單明細…**格式跟出貨單一樣**」。
          ⚠️ **`pd-sheet` 不是裝飾** —— `app/print/print-a4.css:236` 起它定義了整組 `--pd-*` 變數
             與 `display:flex; flex-direction:column` ⇒ **加上它才吃得到那套版面**;
             不加的話下面所有 `pd-*` 子類都會落在沒有變數的世界裡。 */}
      <PrintMasthead />
      {/* 🔴 A3-2':版面骨架換成稿的 `.pd-doctitle`(與出貨單同一個 class)。
          `print-a4.css:335-350` 定義:`display:flex; align-items:baseline; gap:5mm`
          + `border-top` + `h1` 的字級字距 ⇒ **原本的 Tailwind `text-2xl` 由 CSS 接管**。
          🛑 ~~稿裡的 `.pd-en` 與 `.pd-use` 本片刻意不加 —— 沒有人拍過板 ⇒ 不發明~~
             🔴 **2026-08-29 code-reviewer R1 Critical 1:那句是錯的, 而且它有害。**
             **稿裡【有】那些字面**(`-c8` 開檔複驗, 兩個獨立來源):
             · OD `pcm-524f/patch-orders-ui.py:3316-3318` 的 `fix49_order_doc`
               (進入條件就是這張紙)逐字 `'訂單明細', 'Order Detail', '這張訂單的完整明細',
               '涵蓋本訂單全部品項；本單不描述出貨進度'`
             · 渲染結果在同專案 `預覽-訂單明細.html`
             📌 **⇒ 我沒有 grep 稿就寫下「沒有人拍過板」—— 那句會【關掉下一個人的尋找動作】**
                (常載 §6-b 第 4 條點名的句形)。**鐵則 1 違反, 記在這裡。**
             ✅ **本片採用 `.pd-en` = `Order Detail`**(照稿)。
             🛑 **而 `.pd-use` 那兩行本片【仍然不加】, 而這次理由是量到的**:
                稿的用途標語逐字寫「**本單不描述出貨進度**」, 而**這張紙上現在還有勾選框**
                (`data-slot='picking-checkbox'`)與「應揀數量」⇒ **印上去會是一句紙上自相矛盾的話。**
                ⇒ 勾選框拿掉那一片(A3-3')落地之後再補, 不是現在。 */}
      <div className='pd-doctitle'>
        {/* 🔴 `#240`/Q1-A1(2026-08-23):抬頭由 ~~「揀貨單」~~ 改為「訂單明細」——
            Sean 拍板②逐字「那原本的揀貨單 按鈕改成 -> **訂單明細**」。
            ⚠️ **鈕改了而這裡沒改, 比不改更糟**:他在後台看到新名字, 列印出來還是舊的
               (code-reviewer R1 must-fix 3 抓到)。
            📌 而**這張紙的【內容】本片沒動** —— 版面同出貨單、無出貨狀態字眼、無勾選欄
               那些屬 A3(從 ShippingDoc 衍生 variant + PickingDoc 退役)。 */}
        <h1>訂單明細</h1>
        <div className='pd-en'>Order Detail</div>
        {/* 🔴 A3-4'(2026-08-29):`.pd-use` 兩行, **逐字照稿**
            (OD `pcm-524f/patch-orders-ui.py:3316-3318` 的 `fix49_order_doc`,
             渲染結果見同專案 `預覽-訂單明細.html`)。
            🛑 **A3-2' 當時刻意不加, 而理由是量到的**:那時紙上還有勾選框,
               而標語逐字寫「**本單不描述出貨進度**」⇒ 印上去會是一句紙上自相矛盾的話。
        {/* 🛑 A3-4' 訂正(2026-08-29 Sean 逐字):~~`.pd-use` 兩行用途標語~~ **拿掉** ——
            他的原話:「這張訂單的完整明細 / 涵蓋本訂單全部品項;本單不描述出貨進度
            **這個不要寫**」+「**太多標語了, 真的很奇怪**」。
            🔴 **而他指出的是真的**:同一張紙上這句話講了【三次】——
               `.pd-use`(兩行)· `.pd-multi`「本單是這張訂單的完整明細。」
               · `.pd-dim`「本單列出這張訂單的全部品項。」
            📌 **⇒ 而三句都是【逐字照稿】搬過來的 —— 稿上本來就是三句。**
            ⇒ **對標稿【不等於】照抄稿的每一個字**;稿是一個人畫的, 而重複只有在紙上並排時才看得見。 */}
        {/* 🛑 A3-2' 刻意【還沒搬】:出貨單那張把 `displayId` 移進了下面的 `.pd-info` 右欄
            (`shipping-doc.tsx` 該處註解逐字:「稿把它們移到 `.pd-info`…每個值前面都有 `.k` 欄名
             ⇒ 仍然不是裸印」)。本張紙還沒有 `.pd-info` 區 ⇒ 現在搬會變成裸印。
            🔴 而 `-c8` 第一版在這裡寫了一個 `print-a4.css` 裡不存在的 class ⇒ 會 render 成無樣式。
               ⚠️ ~~而 typecheck 與所有測試都不會紅~~ 🛑 **2026-08-29 R1 Critical 2:那句是錯的。**
               **有守門, 而且它會紅**:`app/print/print-a4-css.test.ts:255-263` 的反方向掃描格
               把本檔併進 `names`, 而一個 CSS 無規則、又不在 `HOOK_ONLY` 的名字會落進 `orphan`
               ⇒ `toEqual([])` 失敗。📌 **⇒ 我那句的危害不是記錯, 是它告訴下一個人「這一格沒有人在守」。**
               ✅ 還原成原本的 Tailwind。 */}
        <span className='text-xl font-semibold tabular-nums'>{detail.displayId}</span>
        {/* 🔴 **擋住內容卻沒擋住列印鈕 = 守門裝在沒有事的那條路上**(2026-08-17;
            與 `shipping-doc.tsx` 同批,那邊 code-reviewer R2 F3 點名這裡一個字沒改)。
            兩種狀態下這張紙都**不該被拿去揀貨**(訂單已取消 / 清單沒載完),
            而改之前這顆鈕在警告**上面**、不受影響 ⇒ 員工按得下去,印出一張紙照樣進倉庫。
            🔴 **這不是守門,只是不再遞刀** —— `print-button.tsx:5-7` 自己就寫著
               「為什麼要有這顆鈕、而不是叫員工按 Ctrl+P」⇒ ⌘P 那條路還在,
               真正的解法是整幅阻印版面(樣張 B)—— **`#601` 的 A / C 兩種已落地,見下方**。
            🔴 **`items.length === 0` 補進條件裡了**(2026-08-17,`#601` 同批):
               在那之前**這顆鈕在那一種狀態下還在**,而紙上是一行「讀不到任何品項」
               ⇒ **鈕的條件與紙的條件不一致 = 守門裝在一半的路上**。
               數法:`grep -n 'items.length === 0' <本檔>` 落地前 1 處(只在 JSX 裡),現在 2 處。 */}
        {cancelledAt === null && !detail.itemsTruncated && detail.items.length > 0 && (
          <PrintButton label='列印' />
        )}
      </div>

      {/* 🔴 `#601` A 種:整張訂單已取消 ⇒ **整幅阻印版面**,不是一行警告。
          為什麼換掉那一行 `<Alert>`:設計端逐字(樣張 `:551`)「印出來看起來正常的紙,
          員工就會照做,所以警告必須佔滿這個位置」——而 ⌘P 擋不住(見上方那段)。
          ⚠️ **原本那句「品項清單已隱藏,避免有人照著這張紙出貨」沒有消失,是被【換成更好的】**:
             `BlockedSheet` 固定印「本頁不含品項明細。這不是資料漏印,是刻意不印。」(樣張 `:509` 逐字)
             ⇒ 同一個意思、而且是設計端的字面。**不要為了「保留原文案」把兩句都印。**
          ⚠️ `reason` 只放**原因**,不放「不要揀貨」—— 那句在 `BlockedSheet` 的四條動作裡
             (「不要依本單揀貨、裝箱或出貨。」)。兩處都寫 = 紙上同一件事說兩次。 */}
      {cancelledAt !== null && (
        <BlockedSheet
          kind='picking-cancelled'
          reason={`這張訂單已於 ${formatOrderDateTime(cancelledAt)} 取消。`}
          orderDisplayId={detail.displayId}
        />
      )}

      {cancelledAt === null && (
        <>
          {/* 🔴 面6 `itemsTruncated` fail-closed:清單沒載完的揀貨單會讓人「揀完了」卻少一件,
              而少的那件不會有任何症狀 —— 到客人收到貨才發現。
              既有同型處置 `components/orders/item-procurement-section.tsx:253`。 */}
          {detail.itemsTruncated && (
            <Alert slot='picking-truncated-notice'>
              {/* 🔴 **舊字面是一句假話**(2026-08-17,與 `shipping-doc.tsx:76` 同批):
                  原本逐字「請重新整理後再列印」,而觸發它的是**固定上限**
                  (`ORDER_ITEMS_EMBED_LIMIT = 200`,
                  `packages/adapters/src/supabase/mappers/order.ts:406`,判定 `:830` 是 `>=`)
                  ⇒ **重整一百次拿回同一個數字**,那句話叫員工去做一件永遠不會成功的事,
                  而他會照做、會做很多次,然後以為是自己哪裡沒弄對。
                  ⚠️ **文案裡連「重新整理」這個詞根都不留** —— 守門禁的是詞根不是祈使形白名單
                  (白名單被穿透兩次的紀錄在 `shipping-doc` 那片的 commit body)。 */}
              {/* 🔴 **「筆」原本在這裡,而同一張紙上其他地方數品項都用「項」**
                  (「品項:N 項」、「本次應揀合計 N 項」)——
                  **同一種東西、同一張紙、兩個量詞** ⇒ 對照著看的人要先自己想通它們是同一件事。
                  2026-08-18 紙上文字審查第四則。**這兩處的字是我們自己寫的,不是設計端的** ⇒ 可以改。 */}
              這張訂單的品項達到 200 項上限,系統一次列不完,下面看到的不是全部。
              這是系統的固定限制,不是暫時的狀況。請聯絡負責人處理,不要拿這張去揀貨。
            </Alert>
          )}

          {/* 🔴 有「數量資料尚未就緒」的列 ⇒ 揀完該揀的**也不算處理完這張單**。
              放在頁首而不是合計旁邊的理由見下面合計那段(跨頁會把它切掉)。 */}
          {unknownCount > 0 && (
            <Alert>
              有 {unknownCount} 項的數量資料尚未就緒
              {/* 🔴 截斷時這個數也只是【已載入子集】裡的數量(codex R2)——
                  與「品項:N 項」同一個病,不能只修被指名的那一處。 */}
              {detail.itemsTruncated && '(而且清單沒載完,未載入的列裡可能還有)'}。
              <br />
              {/* 🔴 **這句原本中間是一個 `⇒`** —— 那是我們寫註解用的**邏輯符號(蘊含)**,
                  2026-08-18 紙上文字審查掃出來的第二則(掃渲染產物的邏輯/裝飾符號 ⇒ 只命中它,2 處)。
                  ⚠️ **揀貨的人不讀邏輯符號。** 換成「所以」——**句意一個字都沒改,只是用人話接。** */}
              那幾項的數量【還不知道】。所以這張單仍然不算處理完,請回報。
            </Alert>
          )}

          {/* 🔴 A3-4'(2026-08-29):~~原本這裡是一排散裝資訊(客人 / 下單 / 品項 N 項)~~
              ⇒ 換成稿的 `.pd-info` 兩欄(OD `pcm-524f/預覽-訂單明細.html`)。
              🛑 **客戶欄印【姓名 / 電話 / 地址】三格 —— 而那推翻了一條既有紀律**:
                 `app/print/orders/[id]/picking/page.tsx:19` 逐字「本頁只印客人**姓名**,
                 不印電話與地址…**少印不等於少讀, 但少印就少一個外洩面**」。
              ✅ **Sean 2026-08-29 拍【甲 要(照稿)】, 知情地推翻它**
                 (落檔 `memory/project_0829-sean-order-detail-prints-full-pii.md`,
                  含原句與「外洩面沒有消失, 只是被接受了」那一格)。
              🔴 而那條紀律【當時是對的】—— 它的前提是這張紙是**揀貨單**;
                 Sean 08-23 把它改成「訂單明細」之後, 前提就不在了。 */}
          <section className='pd-info'>
            <div className='pd-col'>
              <span className='pd-label'>客戶</span>
              <div className='pd-field'>
                <div className='k'>姓名</div>
                <div className='v big'>
                  {stripPictographs(detail.customer.name) ?? '—'}
                </div>
              </div>
              <div className='pd-field'>
                <div className='k'>電話</div>
                <div className='v code'>
                  {detail.customer.phone ?? detail.shippingAddress?.phone ?? '—'}
                </div>
              </div>
              <div className='pd-field'>
                <div className='k'>地址</div>
                {/* 🔴 地址只有 `shippingAddress` 有(`customer` 沒有地址欄)。
                    ⚠️ 而它在既有 fixture 裡【可能整個 undefined】—— 那不是防禦性編程,
                       是量到的:A3-4' 第一版寫 `detail.shippingAddress.line` ⇒ 6 支測試爆
                       `Cannot read properties of undefined`。⇒ 用 `?.`。 */}
                <div className='v addr'>{detail.shippingAddress?.line ?? '—'}</div>
              </div>
            </div>
            <div className='pd-col'>
              <span className='pd-label'>單據</span>
              <div className='pd-field'>
                <div className='k'>訂單編號</div>
                <div className='v big code'>{detail.displayId}</div>
              </div>
              <div className='pd-field'>
                <div className='k'>下單</div>
                <div className='v'>{formatOrderDateTime(detail.createdAt)}</div>
              </div>
              {/* 🔴 截斷時這個數字**只是已載入的子集**, 而它讀起來像總數(codex R2 舊 finding)
                  ⇒ 那句限定跟著搬過來, 不因為換版面而消失。 */}
              <div className='pd-field'>
                <div className='k'>品項數</div>
                <div className='v'>
                  {detail.items.length} 項{detail.itemsTruncated && '(清單沒載完)'}
                </div>
              </div>
              <div className='pd-field'>
                <div className='k'>訂單金額</div>
                <div className='v big code'>{formatOrderAmount(detail.total.amount)}</div>
              </div>
              {/* 🛑 A3-4' 訂正(Sean 2026-08-29 拍甲):~~`.pd-multi`「本單是這張訂單的完整明細。」~~ 拿掉。
                  與下面 `.pd-dim` 那句、以及已拿掉的 `.pd-use` 兩行, **三句在講同一件事**。
                  他的理由(逐字):「那張紙的名字就叫『訂單明細』, 不用再解釋一次」。 */}
            </div>
          </section>

          {/* 🔴 面7:空清單。印一張只有表頭的空表格 = 看起來像「這張單沒東西要揀」,
              而它其實可能是投影出問題。與 `itemsTruncated` 同一條 fail-closed 立場。 */}
          {detail.items.length === 0 ? (
            /* 🔴 `#601` C 種:這張單讀不到任何品項 ⇒ **整幅阻印版面**,不是一行警告。
                與 A 種同一個理由(⌘P 擋不住、一行紅字的紙看起來正常),而**這一種原本更糟**:
                改之前**列印鈕在這一種狀態下還在**(鈕條件只看 `cancelledAt` 與 `itemsTruncated`)
                ⇒ 我們自己遞了刀。鈕的條件已同批補上 `items.length > 0`。
                ⚠️ **原文案「請重新整理」保留在 `reason` 裡是刻意的** —— 這一種與 `itemsTruncated`
                   不同:那一種是**固定上限**(重整一百次拿回同一個數字,`:143` 那段講過),
                   而這一種是**投影出問題**,重整**真的可能好**。⇒ 這句話在這裡不是假話。 */
            <BlockedSheet
              kind='picking-no-items'
              reason='這張單讀不到任何品項(可能是資料讀取出問題)。請重新整理;仍然一樣請回報。'
              orderDisplayId={detail.displayId}
            />
          ) : (
            <>
            {/* 🔴🔴 **跨頁表頭:已實測會自動重複,所以這裡沒有任何 `print:` class —— 那是刻意的。**
                揀貨單的正常情境就是品項多 ⇒ 幾乎一定跨頁;第 2 頁沒有欄名 = 一堆數字不知道哪欄是哪欄 = 揀錯貨。
                **量法(2026-08-15,真瀏覽器 + 真 A4 分頁,30 項 fixture)**:
                · `getComputedStyle(thead).display` 在 print media 下 = `table-header-group`(UA 預設,Preflight 沒重設)
                · Chromium 產 A4 PDF ⇒ **第 2 頁上緣確實有四個欄名**
                · 🔴 **負向對照**(證明上面那句不是恆真):runtime 注入
                  `@media print { thead { display: table-row-group !important } }` ⇒ 同一份 30 項,
                  **第 2 頁的欄名整排消失、直接從 SKU-0016 開始**。
                ⇒ 加 `print:table-header-group` 會是一條**永遠不會失效的字面**(它等於 UA 預設)——
                  「紅不起來的守門比沒有更糟」,所以不加。
                🔴 **真正會弄壞它的改法是把這個 `<table>/<thead>` 改成 div 排版** ——
                  那條路 UA 預設救不了,而且畫面上看起來一模一樣。`page.test.tsx` 的格②b 釘的就是那條路。

                ⚠️ **已知缺口(2026-08-15 主視窗裁定:留片2)**:`break-inside: avoid` **沒寫、也沒量** ——
                  一列剛好卡在分頁邊界時會不會被切成兩半,**我不知道**。
                  不現在補的理由用的是同一把尺:我剛因為「沒量過的 CSS 字面」拒絕加 `print:table-header-group`,
                  就不能自己在旁邊放一條沒量過的 `break-inside`。
                  症狀評估(**這句是推的、不是量的**):難看但讀得懂 ⇒ 不會揀錯貨。片2 一起量。 */}
            {/* 🔴 A3-4'(2026-08-29):品項表換成稿的 `.pd-items` 六欄。
                依據 = OD `pcm-524f/預覽-訂單明細.html`(Sean 2026-08-29 指定「對標 OD」)。
                稿的表頭逐字:`料號 | 品名 / 規格 | 狀態 | 數量 | 單價 | 小計`
                稿的欄寬逐字:38mm / auto / 20mm / 14mm / 24mm / 24mm
                ⚠️ **`<table>/<thead>` 這個結構不得改成 div** —— 跨頁欄名重複靠瀏覽器對
                   `<thead>` 的原生行為(舊註解逐字, 那條沒有過期)。 */}
            <section className='pd-items'>
              <h2 className='pd-sech'>
                品項明細<span>本訂單全部品項</span>
              </h2>
              <table>
                <colgroup>
                  <col style={{ width: '38mm' }} />
                  <col />
                  <col style={{ width: '20mm' }} />
                  <col style={{ width: '14mm' }} />
                  <col style={{ width: '24mm' }} />
                  <col style={{ width: '24mm' }} />
                </colgroup>
                <thead>
                  {/* 🔴 續頁欄名重複那一列 —— 它在 `<thead>` 裡、在欄名那一列的上面。
                      `colSpan` 必須等於欄數(6);少一欄的話那一列只會撐在左邊。 */}
                  <tr className='pd-contbar'>
                    <th colSpan={6}>
                      訂單 <b>{detail.displayId}</b>
                      <i>續頁欄名重複</i>
                    </th>
                  </tr>
                  <tr className='pd-colhead'>
                    <th>料號</th>
                    <th>品名 / 規格</th>
                    <th>狀態</th>
                    <th className='pd-num'>數量</th>
                    <th className='pd-num'>單價</th>
                    <th className='pd-num'>小計</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => {
                    const q = item.quantitySummary;
                    // 🔴 狀態欄照稿:稿的實例逐字是「未到貨 1」⇒ 未到貨數 = 客人買的 − 已到貨。
                    //    `quantitySummary` 為 null ⇒ **不知道**, 而【不知道不等於 0】。
                    const waiting = q === null ? null : Math.max(0, q.quantity - q.instockQuantity);
                    return (
                      <tr key={item.id} data-slot='picking-item' className={waiting ? 'pd-wait' : undefined}>
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
                        <td className='pd-state'>
                          {waiting === null ? '數量資料尚未就緒' : waiting > 0 ? `未到貨 ${waiting}` : ''}
                        </td>
                        <td className='pd-num'>{item.quantity}</td>
                        <td className='pd-num'>{formatOrderAmount(item.unitPrice.amount)}</td>
                        <td className='pd-num pd-strong'>{formatOrderAmount(item.lineTotal.amount)}</td>
                      </tr>
                    );
                  })}
                  {/* 🔴 面6b:清單沒載完 ⇒ 表【自己】要說它沒有結尾(缺列印在表身, 不是只在表尾講)。
                      這一列是甲案與乙案的分野, 而它有測試釘著 —— 不得搬到表格外面。 */}
                  {detail.itemsTruncated && (
                    <>
                    {/* 🔴 A3-4':舊版有【兩列】截斷標記, 而 A3-4' 第一版只留了下面那條帶子。
                        ⇒ 這一列(佔位列)是另一半:它讓【表身自己】長出一列「這裡本來有東西」,
                          而不是只在表尾講一句。`? ? ? ?` 是刻意的 —— 上游只給布林,
                          **印任何具體數字就是編的**(舊註解逐字, 那條沒有過期)。
                        📌 抓到我漏掉它的是 `page.test.tsx` 那格的 `toContain('?')`。 */}
                    <tr className='pd-wait'>
                      <td className='pd-sku'>? ? ? ?</td>
                      <td className='pd-name'>
                        未載入的品項 —— 這一列不在這張紙上
                        <span className='pd-spec'>系統一次只列得出 200 項,這張單超過了</span>
                      </td>
                      <td className='pd-state'>?</td>
                      <td className='pd-num'>?</td>
                      <td className='pd-num'>?</td>
                      <td className='pd-num'>?</td>
                    </tr>
                    <tr data-slot='picking-truncated-band' className='pd-wait'>
                      <td className='pd-state' colSpan={6}>
                        以上不是全部。還缺幾列 —— 系統也不知道,所以這張表沒有結尾。
                      </td>
                    </tr>
                    </>
                  )}
                </tbody>
              </table>
            </section>
            {/* 🔴 A3-4'(2026-08-29):~~原本這裡是「本次應揀合計」與「日期:____」~~
                ⇒ 換成稿的 `.pd-totals` + `.pd-bottom`(OD `pcm-524f/預覽-訂單明細.html`)。
                下面所有對外字面【逐字照稿】, 含全形括號與全形空格 —— 不得正規化。 */}
            <div className='pd-totals'>
              <div className='pd-primary'>
                <span className='pd-label'>品項合計</span>
                {/* 稿逐字:`共 1 項　／　1 項未到貨`(分隔用全形空格 U+3000, 不是半形) */}
                <div className='n'>
                  共 {detail.items.length} 項　／　{waitingCount} 項未到貨
                </div>
                {/* 🛑 A3-4' 訂正(Sean 2026-08-29 拍甲):~~`.pd-dim`「本單列出這張訂單的全部品項。」~~ 拿掉。
                  📌 **這三句全部是逐字照稿搬過來的 —— 稿上本來就是三句。**
                  🔴 **⇒ 對標稿【不等於】照抄稿的每一個字。**
                     稿是一個人畫的, 而**重複只有在紙上並排時才看得見** ——
                     而看見它的是 Sean, 不是我, 也不是任何一道守門。 */}
              </div>
            </div>

            <div className='pd-bottom'>
              <div className='pd-foot'>
                <section className='pd-contact'>
                  {/* 🔴 `src` 是內嵌常數不是 `/print/line-qr.png` —— 那個網址走登入閘,
                      伺服器渲染(沒有 cookie)會被 303, 而症狀是【圖不見了, 不是錯誤】。
                      ⚠️ 而這張紙的 LINE 連結與顧客站是同一個官方帳號(Sean 2026-08-29 說的,
                         我們沒有打開連結確認 ⇒ 詳見 `shipping-doc.tsx` 同款註解)。 */}
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
                        <td className='v'>{formatOrderAmount(detail.subtotal.amount)}</td>
                      </tr>
                      <tr className='line'>
                        <td className='k'>運費</td>
                        <td className='v'>{formatOrderAmount(detail.shippingFee.amount)}</td>
                      </tr>
                      {/* 🔴 折扣稿上沒有 —— 因為稿那張單折扣是 0。而【0 不代表這一列不存在】
                          ⇒ 有折扣時才印, 沒有時不印一列 `0`(印 0 會讓客人以為我們算了一筆折扣)。 */}
                      {detail.discountTotal.amount > 0 && (
                        <tr className='line'>
                          <td className='k'>折扣</td>
                          {/* 🔴 A3-4':~~負號用 `−`(U+2212 數學減號)~~ ⇒ **那道「紙上不得有表情符號」的守門會紅** ——
                            它的字集含 `\u2200-\u22FF`(數學運算子)。**而它抓對了**:那個字元在
                            單色印表機與缺字型的環境下不保證印得出來。⇒ 改用 ASCII `-`。
                            📌 這一格是【守門抓到作者】, 不是作者想到的。 */}
                        <td className='v'>-{formatOrderAmount(detail.discountTotal.amount)}</td>
                        </tr>
                      )}
                      <tr className='grand'>
                        <td className='k'>訂單金額</td>
                        <td className='v'>{formatOrderAmount(detail.total.amount)}</td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              </div>
            </div>
            </>
          )}

        </>
      )}
    </div>
  );
}
