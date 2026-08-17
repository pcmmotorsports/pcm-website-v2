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
export function BlockedSheet({ reason, orderDisplayId }: { reason: string; orderDisplayId: string }) {
  return (
    <section
      role='alert'
      data-slot='print-blocked'
      /* 🔴 `min-h-[170mm]` 是**「佔滿這個位置」那句話的落點**,不是裝飾。
         量出來的(可重跑):`emit(1,'shipping-blocked',true)` 產物跑
         `sh scripts/pagecount.sh` ⇒ **1 頁**(加這條之前也是 1 頁 ⇒ 沒有把紙變多);
         `--png` 開來看 ⇒ 這一幅從抬頭正下方一路撐到紙面下緣。
         ⚠️ **不要往上加大**:A4 可印高度是 271mm,而抬頭七值那一塊已經吃掉一段;
         再加高就會把這一幅推到第 2 頁,而**第 2 頁上只有半幅警告比一幅完整的更糟**。
         📎 為什麼是 `min-h` 不是 `h`:原因文字長度不一(八種面共用這個槽位),
         `h` 會在長文案時把內容切掉。 */
      className='border-foreground flex min-h-[170mm] flex-col gap-4 border-2 p-6'
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
