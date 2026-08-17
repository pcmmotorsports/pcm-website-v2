/**
 * @module components/print/blocked-sheet —— 兩張列印紙**共用**的整幅阻印版面(`#601`)。
 *
 * 🔴 **為什麼抽成共用檔而不是各寫一份**:這一幅裡有**印在紙上給員工看的四條動作**,
 *    兩份各寫一次 ⇒ 下一個人只改其中一邊,而**兩張紙會對同一件事說不同的話**。
 *    (同一支 repo 裡「兩份會漂」的既有紀錄:`shipping-doc.tsx` 抬頭七值那段註解。)
 * ⚠️ **它在 `apps/admin` 的 `components/`,不在 `packages/ui`** ⇒ 不命中鐵則 12⑥。
 *
 * 🔴 **那四條動作的字面來源是樣張 `shipping-picking-doc-a4.html:503-506`**,
 *    而那份樣張的標題逐字是「**出貨明細單(兼揀貨核對)**」
 *    ⇒ **設計端本來就是同一份紙兩用** ⇒ 同一組文案給兩張紙用,不是我挪用。
 *    ⚠️ 若 Sean 之後要**揀貨單專屬**的措辭,改這一個檔就好(這正是抽出來的第二個好處)。
 */

/**
 * `#601` **整幅阻印版面**(樣張 B)—— 這張紙不該被拿去出貨時,佔滿整頁的那一幅。
 *
 * 🔴 **設計端對這件事的答案是【份量】,不是【文字】。** 樣張 `:551` 逐字:
 *    「**印出來看起來正常的紙,員工就會照做,所以警告必須佔滿這個位置。**」
 *    ⚠️ **下一個做版面精簡的人:不要把這一幅縮回一行 `<Alert>`。** 縮了之後
 *       紙看起來仍然很正常,而**那正是這一幅存在的理由** —— 它守的不是「有沒有寫」,
 *       是「員工會不會照著那張紙做」。
 *
 * 🔴 **為什麼需要它**(拿掉列印鈕擋不住):`print-button.tsx:5-7` 自己寫著
 *    「為什麼要有這顆鈕、而不是叫員工按 Ctrl+P」⇒ **⌘P 那條路一直都在**,
 *    而在這一幅落地之前,⌘P 印出來的紙**只有一行紅字**、其餘看起來像一張正常單據。
 *
 * 逐字照搬樣張 `:492-511`(四條「請照這樣做」與那句「這不是資料漏印」一個字都沒動):
 *   `:493` 本單不得出貨 / `:499` 本單於列印當下已不成立…
 *   `:503-506` 四條動作 / `:509` 本頁不含品項明細。這不是資料漏印,是刻意不印。
 *
 * ⚠️ **樣張說「六種情形共用同一個槽位」,而我們有【八種】**
 *    (`shippingDocBlocker` 的面1–面8;樣張 `:515-527` 只列了六個)。
 *    **那不是衝突** —— 樣張同一段逐字寫著「原因文字換掉即可,版面不變」⇒
 *    槽位本來就是泛用的,`reason` 直接吃 `shippingDocBlocker()` 回傳的那句話。
 *    📎 **不要**照樣張把那張「六種情形」清單也印上去:印一張比實際少兩種的清單,
 *       會讓員工以為自己遇到的狀況不在系統的預期內。
 *
 * ⚠️ **樣張 B 還有兩塊本片【沒有做】**:LINE QR 那一區、以及「本狀態不印金額」那一格。
 *    前者整份紙都還沒有;後者**我們現在根本沒有金額區**(金額片未落地)⇒ 沒有東西可以「不印」。
 *    兩塊都等版面片一起補,不在這裡半套。
 */
export function BlockedSheet({
  reason,
  orderDisplayId,
  kind,
}: {
  reason: string;
  orderDisplayId: string;
  /**
   * 🔴 **量測管線用來認【是哪一種阻印】的錨點,不是樣式、不給人看。**
   *
   * **為什麼需要**(2026-08-18,一次真的 dev 紅換來的):量測管線原本用
   * `toContain('讀不到任何品項')` 這類**文案字面**去確認 fixture 落在哪一種阻印
   * ⇒ **同一句話有兩個所有權人**(量測管線一份、`page.test.tsx` 一份)⇒ **必然會漂**。
   * ⇒ 文案的所有權**只留在 `page.test.tsx`**;量測管線改抓這個。
   * ⚠️ **不動既有的 `data-slot='print-blocked'`** —— 已有三處測試在查它,
   *    這是**新增第二個屬性**,不是改名。
   */
  kind?: string;
}) {
  return (
    <section
      role='alert'
      data-slot='print-blocked'
      data-blocked-kind={kind}
      /* 🔴 `flex-1` 是**「佔滿這個位置」那句話的落點**,不是裝飾。
         它撐滿的是**紙面剩下的高度**,而剩多少由 `app/print/print-a4.css` 的
         `@media print { .print-sheet { display:flex; flex-direction:column; min-height:271mm } }` 給。
         **兩邊是一對** —— 少了任何一邊,這一幅就縮回內容高度。

         🔴 **原本是固定值 `min-h-[170mm]`,而它壞在哪(留痕,不要改回去)**:
         兩張紙的抬頭高度差很多(出貨明細單是七值卡片、揀貨單只有一行)
         ⇒ **同一個固定值在兩張紙上剩下的空間不同** —— 出貨明細單幾乎填滿,
         **而揀貨單只佔上半**(2026-08-17 `--png` 開圖看到的)。
         往上調又會把出貨明細單那一幅**推到第 2 頁**,而**第 2 頁上只有半幅警告,
         比一幅完整的更糟**。⇒ **一個固定值填不滿兩張紙**,所以改成「撐滿剩餘」。

         🔴 **為什麼【不留】那個固定值當保險**:留著的話**兩個機制同時在,而只有一個起作用**
         ⇒ 下一個人要調「這一幅多高」時會改到**沒在作用的那一個**,改完沒反應、再去別處亂改。
         ⇒ 只留一個。**代價明說**:若有人把 `print-a4.css` 那三行拿掉,
         這一幅會**靜默縮回內容高度** —— 不報錯、測試也不紅(那是版面,不是斷言抓得到的東西)。
         ⇒ 所以那三行旁邊寫了「兩邊是一對」,**這裡也寫一次**,兩處互指。 */
      className='border-foreground flex flex-1 flex-col gap-4 border-2 p-6'
    >
      <h2 className='text-4xl leading-tight font-bold tracking-wide'>本單不得出貨</h2>
      <div className='font-mono text-xl font-semibold tabular-nums'>{orderDisplayId}</div>
      <div className='grid gap-6 sm:grid-cols-2'>
        <div>
          <div className='text-muted-foreground text-xs font-bold tracking-[0.16em] uppercase'>
            原因
          </div>
          {/* 🔴 這裡吃的是 `shippingDocBlocker()` 那句話,**不是另外寫一份文案** ——
              兩份文案會漂,而漂掉的那一天紙上會說一件事、畫面說另一件事。 */}
          <div className='mt-1 text-base font-medium'>{reason}</div>
          <div className='text-muted-foreground mt-2 text-sm'>
            本單於列印當下已不成立,紙上的一切內容都不得作為作業依據。
          </div>
        </div>
        <div>
          <div className='text-muted-foreground text-xs font-bold tracking-[0.16em] uppercase'>
            請照這樣做
          </div>
          <ul className='mt-1 list-disc space-y-1 pl-5 text-sm'>
            <li>不要依本單揀貨、裝箱或出貨。</li>
            <li>不要把本單放進任何箱子。</li>
            <li>把本單作廢並回報主管,由系統重新確認後再列印。</li>
            <li>若貨已裝箱,先停下並確認箱內狀態,不要交給貨運。</li>
          </ul>
        </div>
      </div>
      <div className='border-t pt-3 text-sm font-medium'>
        本頁不含品項明細。這不是資料漏印,是刻意不印。
      </div>
    </section>
  );
}
