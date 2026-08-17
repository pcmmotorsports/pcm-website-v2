import type { AdminOrderDetail, AdminOrderDetailItem } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { BlockedSheet } from './blocked-sheet';
import { PrintButton } from './print-button';

// #10 片1:揀貨單(給倉庫的人拿在手上、對著箱子勾的那張紙)。
//
// 🔴🔴 **本檔不得出現任何金額。** 揀貨的人不需要知道這批貨賣多少錢,
//    而這張紙會被拿到倉庫、放在桌上、可能被客人瞄到 ⇒ 少印一個欄位就少一個外洩面。
//    同理 **不印收件地址與電話**(那是出貨單的事,片2)。
//    ⚠️ 這條**不是**風格偏好,是這片的驗收條件:
//    `apps/admin/src/app/print/orders/[id]/picking/page.test.tsx` 的格②把「渲染結果不含任何金額欄位」釘死,
//    而且那格用突變驗過(故意塞金額進去 ⇒ 該格必紅)。
//    ⇒ 想在這裡加金額的人:先去改那格測試,而那一步會逼你回來想清楚為什麼。
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

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role='alert'
      className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-800'
    >
      {children}
    </div>
  );
}

/**
 * 這一列**這次要不要動手揀**。
 *
 * 🔴 收成一支的理由:它有**兩個**消費端 —— 那一列的勾選框、與底下的「本次應揀合計」。
 *    各寫一份的話會出現「紙上有 9 個框、合計說 8 項」,而**那張紙印得出來、沒有任何東西會紅**。
 *    (同一個病 2026-08-16 在 `order-status-axes.ts` 真的發生過:軸與小字兩個分母各自漂走。)
 * ⚠️ `null`(不知道)算 **false** —— 不知道就不要叫人去揀。
 *    但**它不可以就這樣消失**:合計旁邊要把「不知道」那幾項單獨講出來,見 `PickingDoc` 底下那段。
 */
function needsPicking(pickable: number | null): boolean {
  return pickable !== null && pickable > 0;
}

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
  const pickableCount = pickables.filter(needsPicking).length;
  const unknownCount = pickables.filter((q) => q === null).length;

  return (
    /* 🔴 `print-sheet` 是 `app/print/print-a4.css` 唯一的掛勾:列印時把 `p-6` 歸零,
       讓紙面邊界**只由** `@page{margin:12mm 12mm 14mm 12mm}` 決定,不然會內縮兩次。
       ⚠️ 改名要同步那支 CSS;改名後的症狀是**紙印出來邊距不對**,三綠與單測都不會紅。
       📎 Sean 逐字「出貨單都是 A4」⇒ **揀貨單一起吃**,兩張紙同一套版面。 */
    <div className='print-sheet mx-auto max-w-3xl space-y-4 p-6 print:max-w-none'>
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>揀貨單</h1>
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
            <Alert>
              {/* 🔴 **舊字面是一句假話**(2026-08-17,與 `shipping-doc.tsx:76` 同批):
                  原本逐字「請重新整理後再列印」,而觸發它的是**固定上限**
                  (`ORDER_ITEMS_EMBED_LIMIT = 200`,
                  `packages/adapters/src/supabase/mappers/order.ts:406`,判定 `:830` 是 `>=`)
                  ⇒ **重整一百次拿回同一個數字**,那句話叫員工去做一件永遠不會成功的事,
                  而他會照做、會做很多次,然後以為是自己哪裡沒弄對。
                  ⚠️ **文案裡連「重新整理」這個詞根都不留** —— 守門禁的是詞根不是祈使形白名單
                  (白名單被穿透兩次的紀錄在 `shipping-doc` 那片的 commit body)。 */}
              這張訂單的品項達到 200 筆上限,系統一次列不完,下面看到的不是全部。
              這是系統的固定限制,不是暫時的狀況。請聯絡負責人處理,不要拿這張去揀貨。
            </Alert>
          )}

          {/* 🔴 有「數量資料尚未就緒」的列 ⇒ 揀完該揀的**也不算處理完這張單**。
              放在頁首而不是合計旁邊的理由見下面合計那段(跨頁會把它切掉)。 */}
          {unknownCount > 0 && (
            <Alert>
              有 {unknownCount} 項的數量資料尚未就緒(下面標「這一項不要揀」的那幾列)
              {/* 🔴 截斷時這個數也只是【已載入子集】裡的數量(codex R2)——
                  與「品項:N 項」同一個病,不能只修被指名的那一處。 */}
              {detail.itemsTruncated && '(而且清單沒載完,未載入的列裡可能還有)'}。
              <br />
              那幾項沒有算進「本次應揀合計」⇒ 勾完合計那個數字,這張單仍然不算處理完,請回報。
            </Alert>
          )}

          <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm'>
            <span>客人:{detail.customer.name ?? '—'}</span>
            <span>下單:{formatOrderDateTime(detail.createdAt)}</span>
            {/* 🔴 截斷時這個數字**只是已載入的子集**,而它讀起來像總數(codex R2)——
                與合計那句話同一個病,不能只修被指名的那一處。 */}
            <span>
              品項:{detail.items.length} 項{detail.itemsTruncated && '(未載完,不是總數)'}
            </span>
          </div>

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
              reason='這張單讀不到任何品項(可能是資料讀取出問題)。請重新整理;仍然一樣請回報。'
              orderDisplayId={detail.displayId}
            />
          ) : (
            /* 🔴🔴 **跨頁表頭:已實測會自動重複,所以這裡沒有任何 `print:` class —— 那是刻意的。**
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
                  症狀評估(**這句是推的、不是量的**):難看但讀得懂 ⇒ 不會揀錯貨。片2 一起量。 */
            <table className='w-full border-collapse'>
              <thead>
                {/* ── `Q-C20` 續頁抬頭(Sean 2026-08-17 拍**甲**:照設計稿做,不要另外發明)──
                    🔴 真權威 = OD 專案 `pcm-print-docs` / `shipping-picking-doc-a4.html:291`
                       的 `contbar` 那一列(在 `<thead>` 裡、欄名那一列的上面)。
                       完整理由與量測寫在 `components/print/shipping-doc.tsx` 的同一段註解,
                       **本檔只寫兩張紙【不一樣】的那一件事**,不重複貼一份。
                    🔴 **這張紙沒有箱號** —— 揀貨單的單位是「一張訂單」,箱是出貨明細單那邊的事
                       (`shipments` 表刻意沒有 `order_id`;本元件的 props 裡也沒有 shipment)。
                       ⇒ 這一列**只帶訂單編號**。**不要為了跟另一張紙長得一樣而去湊一個箱號。**
                    🔴 樣張右側那個 `<i>續頁欄名重複</i>` 本片同樣**刻意不印**(2026-08-17 裁定)
                       —— **不是漏做**;完整依據(樣張自己的 `.caption` 在列印時 `display:none`、
                       而那六個字沒被藏)寫在 `shipping-doc.tsx` 的同一段註解裡,不重複貼。 */}
                <tr className='contbar'>
                  <th
                    colSpan={4}
                    className='text-muted-foreground px-2 pt-2 pb-1 text-left text-xs font-bold tracking-[0.16em] uppercase'
                  >
                    品項明細　訂單{' '}
                    <b className='text-foreground font-mono tracking-[0.04em]'>{detail.displayId}</b>
                  </th>
                </tr>
                <tr className='border-b'>
                  <th className='w-10 px-2 py-2 text-left text-xs font-medium'>✓</th>
                  <th className='px-2 py-2 text-left text-xs font-medium'>料號</th>
                  <th className='px-2 py-2 text-left text-xs font-medium'>品名 / 規格</th>
                  <th className='px-2 py-2 text-right text-xs font-medium'>應揀數量</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item, i) => {
                  // 🔴 讀上面算好的那一份,不重算 —— 合計與這一列必須是同一個數。
                  const pickable = pickables[i] ?? null;
                  return (
                    <tr key={item.id} className='border-b'>
                      {/* 真的要用筆勾的框。`print-color-adjust` 不碰 —— 空心框在單色印表機上照樣看得見。
                          🔴 R2 nit-4 同一條:**不用揀 / 不該揀的列不給框**。
                             給了框就是在問「要不要打勾」,而那正是這格的歧義來源;
                             沒有框 = 這一列不需要你做任何動作,一眼就看得出來。 */}
                      <td className='px-2 py-3 align-top'>
                        {needsPicking(pickable) && (
                          <span
                            data-slot='picking-checkbox'
                            className='border-foreground block size-5 rounded-sm border-2'
                          />
                        )}
                      </td>
                      <td className='px-2 py-3 align-top font-mono text-sm whitespace-nowrap'>
                        {item.variantSku}
                      </td>
                      <td className='px-2 py-3 align-top text-sm'>
                        <div>{item.title ?? '—'}</div>
                        {item.spec && (
                          <div className='text-muted-foreground mt-0.5 text-xs'>
                            {Object.entries(item.spec)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className='px-2 py-3 text-right align-top'>
                        {pickable === null ? (
                          // 🔴 面5:不知道就明說,**不印下單量、不補 0**(契約見 `pickableQuantity` docstring)。
                          <span className='text-sm font-medium text-amber-800'>
                            數量資料尚未就緒
                            <br />
                            這一項不要揀
                          </span>
                        ) : pickable === 0 ? (
                          // 🔴 R2 nit-4:**「這次不用揀」要用字說,不能只印一個放大的 `0`。**
                          //    `pickable === 0` 是 PCM 代購模式**最常見**的狀態(貨還沒從供應商到)——
                          //    而放大的 `0` 配一顆打勾框,語意是模糊的:要打勾嗎?這項算不算揀完了?
                          //    ⚠️ 病根是**標準不對稱**:面5(不知道)我給了文字,面「知道就是 0」反而只給數字。
                          //    「或」是誠實的:兩個成因在這張紙上分不出來,但**哪一個都不用揀**。
                          <span className='text-muted-foreground text-sm font-medium'>
                            這次不用揀
                            <br />
                            <span className='text-xs'>(未到貨或已出貨)</span>
                          </span>
                        ) : (
                          <>
                            {/* 揀錯數量是這張紙唯一真的會出錯的地方 ⇒ 放大的一定要是**應揀量**。 */}
                            <div className='text-xl font-semibold tabular-nums'>{pickable}</div>
                            {pickable !== item.quantity && (
                              // 差額的成因(未到貨 / 已出貨 / 已取消)在這張紙上分不出來,也不需要 ——
                              // 揀貨的人只要知道「客人買的比這次要揀的多」,有疑問去看後台。
                              <div className='text-muted-foreground mt-0.5 text-xs'>
                                客人買 <span className='tabular-nums'>{item.quantity}</span>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── 本次應揀合計(Sean 2026-08-16 答「幾項」)──
              🔴 **它守的是「漏揀一整列」,而那件事在這張紙上【原本零症狀】** ——
                 揀貨的人一列一列往下勾,勾到最後沒有任何東西告訴他「你應該勾滿幾個」。
                 少勾一整列 ⇒ 紙看起來就是勾完了。合計是這張紙唯一的自我對帳手段。
              ⚠️ **上面表頭那行「品項:N 項」不能拿來當這個數** —— 它是**表格列數**,
                 而這裡要的是**要動手的列數**。兩者會不會差、差多少,**我沒有量過**
                 (本檔上面那句「`pickable === 0` 是最常見的狀態」也是**沒有分母的頻率宣稱**,
                  是先前的窗寫的,我一併標記而不是照抄背書)。
                 ⚠️ **而這一片不依賴那個頻率** —— 只要**有可能**不同,寫成同一個數就是錯的。
                 **把它們寫成同一個數,就是叫人去勾一個他勾不滿的數。** */}
          {detail.items.length > 0 && (
            <div className='border-t pt-3'>
              <div className='flex flex-wrap items-baseline gap-x-3'>
                <span className='text-sm font-semibold'>本次應揀合計</span>
                <span data-slot='picking-total' className='text-xl font-semibold tabular-nums'>
                  {pickableCount} 項
                </span>
                {/* 🔴🔴 **清單沒載完的時候,這句話會【說謊】,而它說的正是本片要防的那件事。**
                    (codex 對抗審查 2026-08-16 抓的,我第一版真的印了它。)
                    `itemsTruncated` 代表**有幾列根本沒被載進來** ⇒ 它們不在 `pickableCount` 裡
                    ⇒ 「全部勾完才算揀完」變成「勾完這 3 項就結束了」,而缺的那幾列沒有人知道。
                    ⚠️ **這比沒有合計更糟** —— 沒有合計時他至少不會覺得自己完成了;
                    有一個【看起來精確的數字】反而給了他一個假的完成條件。 */}
                {/* 🔴🔴 **`pickableCount === 0` 那一格原本印的是一句【恆真的完成條件】**
                    (2026-08-18,**在真伺服器 + 真資料上看到的**,六份 fixture 一份都沒照出來):
                    真單 `PCM-2026-0102` 只有 1 個品項、`quantitySummary` 為 `null`
                    ⇒ 頁首說「有 1 項的數量資料尚未就緒…這張單仍然不算處理完」,
                    而頁尾同時印「**勾選欄共 0 項,全部勾完才算揀完。**」
                    ⇒ **「把 0 個框全部勾完」是一個【不做任何事就成立】的條件**
                       —— 拿著這張紙的人在頁尾讀到的是「這張單沒事」。
                    ⚠️ 頁首那段警告**有**講清楚,而**兩句話互相矛盾時,人會信離簽名欄近的那一句**。
                    ⇒ 三分支:截斷 / 零項 / 正常。**零項不給完成條件,只說發生了什麼。**
                    🔴 **這一格 fixture 照不出來的原因值得留**:`page-measure.test.tsx` 的
                       `withQuantity` 要嘛全給數量(每列都有框)、要嘛全 `null`(走「品項:0」那條),
                       **而真資料是「有品項、但數量不知道」** —— 那是 fixture 沒有的第三種。 */}
                {detail.itemsTruncated ? (
                  <span className='text-sm font-medium text-amber-800'>
                    🔴 清單沒載完 —— 這個數字不是全部,不要拿它當揀完的依據。
                  </span>
                ) : pickableCount === 0 ? (
                  <span className='text-sm font-medium text-amber-800'>
                    這張單這次沒有任何一項要揀 —— 這不等於「已經揀完」,不要在這裡簽名收工。
                  </span>
                ) : (
                  <span className='text-muted-foreground text-xs'>
                    勾選欄共 {pickableCount} 項,全部勾完才算揀完。
                  </span>
                )}
              </div>
              {/* 🔴 **「不知道」的列不能靜靜地從合計裡消失。**
                  它們沒有勾選框(上面那段)⇒ 不算進應揀項數是對的;
                  **但只算不說,揀貨的人勾滿 N 項就會認為這張單處理完了**,
                  而那幾列其實可能還欠貨。⇒ 算式外的那幾項要當場講出來。
                  ⚠️ 這是 `pickableQuantity` docstring 那條「`null` 是不知道、不是 0」的**同一條規則
                     在合計這一層的延伸** —— 補 0 與「從分母裡拿掉且不說」是同一個錯的兩種形狀。 */}
              {/* 🔴🔴 **「不知道」的警告【不在這裡】,它在頁首的 Alert 區 —— 那是刻意的。**
                  第一版我放在這裡,codex 第二輪指出:這一塊**不在 `<table>` 裡**、跨頁時
                  「合計」可能留在頁尾而警告掉到下一頁 ⇒ **當頁讀起來就是「沒有不知道的」**
                  —— 而那正是本檔說最貴的那種錯(把「不知道」印成「沒有」)。
                  🔴 **我沒有量過分頁行為,而本檔的立場是「不加沒量過的 CSS 字面」**
                  (上面拒絕 `print:table-header-group` 用的是同一把尺)
                  ⇒ **所以不是加 `break-inside` 賭它,是把那句話搬到【結構上不會被切掉】的地方。**
                  ⚠️ 頁首 Alert 在第 1 頁、而且是揀貨的人動手前會先看到的位置 —— 兩個理由都成立。 */}
            </div>
          )}

          <div className='text-muted-foreground flex gap-8 pt-6 text-sm'>
            <span>揀貨人:________________</span>
            <span>日期:________________</span>
          </div>
        </>
      )}
    </div>
  );
}
