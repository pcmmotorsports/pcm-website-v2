'use client';

import { useRef, useState } from 'react';
import {
  MANUAL_CUSTOMER_NEW_NAME_FIELD,
  MANUAL_CUSTOMER_NEW_PHONE_FIELD,
  MANUAL_ORDER_SHIP_TO_LINE_FIELD,
  MANUAL_ORDER_SHIP_TO_NAME_FIELD,
  MANUAL_ORDER_SHIP_TO_PHONE_FIELD,
} from '@/lib/orders/manual-order-form';

// manual-order-ship-to.tsx — 收件資料那一塊 +「同上」(2026-08-28,Sean `Q-建單1 ⇒ 乙`)。
//
// 🔴🔴 **它為什麼要從 `manual-order-form-body.tsx` 搬出來變成一支 client 元件**
//   「同上」要**寫值進輸入框** ⇒ 需要 state ⇒ 而 form-body 檔頭逐字寫著
//   「本檔本體仍是 server component、全 PRG」。
//   ⇒ 照 `manual-order-lines.tsx` 那條**已經被審過**的路加一支 client 子元件,
//     **不把 form-body 改成 client**(那會把整張表單的 PRG 形狀一起動掉)。
//
// ── 不變式(與 `manual-order-submit.tsx` / `manual-customer-picker.tsx` 同一條)──────────
//   **送出值一律由原生控制項承載;state 只從 DOM 讀進來,沒有任何一條路徑把 state 寫回 `value`。**
//   🔴 所以「同上」**不是** `setValue(...)`,而是**換 `key` → 重新掛載 → 新節點的 `defaultValue`**。
//      這個手法本片已經在用(`manual-customer-picker.tsx` 的 `key={searchedPhone}`),
//      而 codex 明確攻不破它。⇒ 這裡沿用同一條,不發明第二種。
//
// 🔴 **地址那一格【不掛 key】,而那是承重的**:
//   掛了的話,按「同上」會把它一起重新掛載 ⇒ **員工已經打好的地址被清空**。
//   而客人那一塊**沒有地址欄**(`manual-order-form.ts` 那段逐字)⇒ 沒有東西可以帶給它
//   ⇒ 它的正確行為是「完全不動」。
//   ⚠️ 這一格不要「順手也加上 key 保持一致」—— 一致在這裡等於資料遺失。

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **這一片四輪審查(16 條 finding)打的其實是【同一句話】,而它到第四輪才被講出來:**
//
//     **選了人 ⇒ 他【就是】真相來源 ⇒ 全欄照搬(含空的);**
//     **讀建立區 ⇒ 空 =「這裡沒有東西可以給你」⇒ 不覆蓋。**
//
// ⚠️ **下一個人會看到這兩條路長得像重複邏輯, 然後「順手統一」** —— 那正是 codex R4 抓到的那條:
//    我上一輪把它們統一成「空的一律不覆蓋」⇒ 做出「姓名甲 + 電話乙」的**混合收件人**。
//    📌 **一份每一格都有值、看起來完全正常的錯資料, 比一格被清空危險。**
// ⇒ 統一它們之前,先回答:**「空」在這兩條路上是不是同一個意思?** 它不是。
// ══════════════════════════════════════════════════════════════════════════

/** 「同上」要複製的欄位對。**就這兩對,寫死。**(客人塊沒有地址欄 ⇒ 地址不在這裡。) */
const COPY_PAIRS = [
  { from: MANUAL_CUSTOMER_NEW_NAME_FIELD, to: MANUAL_ORDER_SHIP_TO_NAME_FIELD },
  { from: MANUAL_CUSTOMER_NEW_PHONE_FIELD, to: MANUAL_ORDER_SHIP_TO_PHONE_FIELD },
] as const;

export function ManualOrderShipTo() {
  const rootRef = useRef<HTMLFieldSetElement>(null);
  // `null` = 從來沒按過「同上」⇒ 兩格用空的 `defaultValue`(= 現況)。
  const [copied, setCopied] = useState<{ name: string; phone: string } | null>(null);
  // 🔴 **序號是 `key` 的來源,不能用值本身當 key**:
  //    連按兩次「同上」而客人那兩格沒變 ⇒ 值相同 ⇒ key 相同 ⇒ **不會重新掛載**
  //    ⇒ 員工中間手改過的收件人**不會被蓋回去**,而他按了那顆鈕、以為蓋回去了。
  //    📌 **一顆「按了沒反應」的鈕,與一顆「按了但我看不出來」的鈕,在畫面上長一樣。**
  const [seq, setSeq] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  function copyFromCustomer() {
    const form = rootRef.current?.form;
    if (!form) return;
    const read = (field: string): string => {
      const el = form.querySelector(`[name="${field}"]`);
      return el instanceof HTMLInputElement ? el.value.trim() : '';
    };
    // 🔴 **逐項讀,不用 `COPY_PAIRS.map(...)` 解構** —— 那樣拿到的是 `string | undefined`
    //    (`noUncheckedIndexedAccess`),而 `?? ''` 兜掉它就等於**把「陣列長度不對」寫成「欄位是空的」**。
    //    ⇒ 兩格明白寫出來:漏一格會在 typecheck 紅,不會靜靜變成空字串。
    // 🔴🔴 **「上」有兩個意思, 而【選起來的那位】優先**(codex R1 must-fix,2026-08-28)。
    //    病:上一版只讀「建立新客人」那兩格 —— 而**最常走的路是「搜到既有客人、點起來」**,
    //    那條路上那兩格是空的(或還留著他拿來搜尋的那支電話)
    //    ⇒ 按「同上」的結果是**把收件人清成空的**,或蓋上一支不是收件人的電話。
    //    📌 而它不會叫:兩格確實被「帶入」了,只是帶入的是錯的東西。
    //    ⇒ 順序:①有選起來的客人 ⇒ 用他的 ②沒有 ⇒ 用建立那一塊打的字。
    const picked = form.querySelector('input[name="customer_user_id"]:checked');
    const fromPicked = picked instanceof HTMLElement;
    const name = fromPicked ? (picked.dataset.customerName ?? '').trim() : read(COPY_PAIRS[0].from);
    const phone = fromPicked ? (picked.dataset.customerPhone ?? '').trim() : read(COPY_PAIRS[1].from);
    // 🔴 **兩格都空 ⇒ 不複製,而且要說話。**
    //    直接複製的話,這顆鈕會**把收件人已經打好的字清成空的** ——
    //    那是「按一下弄丟資料」,而畫面上只是兩格變空,沒有任何錯誤。
    //    ⛔ ~~「只有一格有值時**照複製**:那是員工真的只打了姓名,空的那格本來就該是空的」~~
    //    **2026-08-28 作廢** —— 見下面 nit2 那段。留刪除線是因為**它讀起來完全合理**,
    //    而下一個人很可能會想「這樣比較一致」再把它改回去。
    if (name === '' && phone === '') {
      setNotice(
        fromPicked
          ? '你選的那位客人資料裡沒有姓名也沒有電話,所以沒有東西可以帶過來。'
          : '上面的「客人」那一塊還沒有打姓名或電話,所以沒有東西可以帶過來。',
      );
      return;
    }
    // 🔴🔴 **空的來源【不覆蓋】已經有值的目標**(Fable R3 nit2,2026-08-28)。
    //
    //   ⛔ ~~原本的決定:「只有一格有值 ⇒ 照複製, 空的那格跟著變成空的
    //      —— 那是他真的沒打」~~ **推翻。**
    //   R3 指出的反例:沒選人、而建立區那兩格**只剩搜尋預填的電話**時按「同上」
    //   ⇒ 姓名那格是空的 ⇒ **收件人姓名被清成空的**,而那是他自己打的。
    //   📌 **形狀:我把「來源是空的」讀成「他要它變空」—— 而它其實是「這裡沒有東西可以給你」。**
    //      兩者在 code 上都是 `''`。
    //
    //   ⚠️ 代價明寫:選了一位**沒有電話**的客人按同上 ⇒ 收件電話**維持舊值**,
    //      而舊值可能是上一次帶進來的別人的。⇒ 那是**看得見的錯**(兩格並排在畫面上);
    //      而被清空的姓名是**看不見的錯**(他以為還在)。⇒ 選看得見的那一邊。
    // 🔴🔴 **而「不覆蓋」只在【fallback】那條路生效**(codex R4 must-fix,2026-08-28
    //   —— 它指出我上一輪把 Fable 的 nit2 **折錯了**,而我核過:它對)。
    //
    //   我上一版無條件套用「空的來源不覆蓋」,做出了這個:
    //     收件電話已經是**乙的** ⇒ 選一位**沒有電話的甲** ⇒ 按同上
    //     ⇒ **姓名甲 + 電話乙** —— 一個**兩個人拼起來**的收件人。
    //   🔴 而我自己的測試 `manual-order-ship-to.test.tsx` 正在**釘住**那個行為。
    //   📌 **一個「保護資料不被清掉」的修法, 做出了一份比清空更危險的資料。**
    //      清空看得出來;拼起來的那一份**每一格都有值、看起來完全正常**。
    //
    //   ⇒ 兩條路的語意本來就不同,不該共用一個規則:
    //     · **選了一位客人** ⇒ 他**就是**收件資料的真相來源 ⇒ **全欄照搬,含空的**
    //       (他沒有電話 = 這張單的收件電話就是沒有,不是「沿用上一位的」)
    //     · **沒選人、讀建立區那兩格** ⇒ 空的意思是「**這裡沒有東西可以給你**」
    //       ⇒ 不覆蓋(那是 Fable nit2 要修的:預填只有電話時把打好的收件人姓名清掉)
    const keep = (incoming: string, field: string): string => {
      if (fromPicked) return incoming;
      if (incoming !== '') return incoming;
      const el = rootRef.current?.form?.querySelector(`[name="${field}"]`);
      return el instanceof HTMLInputElement ? el.value : '';
    };
    setCopied({
      name: keep(name, MANUAL_ORDER_SHIP_TO_NAME_FIELD),
      phone: keep(phone, MANUAL_ORDER_SHIP_TO_PHONE_FIELD),
    });
    setSeq((n) => n + 1);
    setNotice(null);
  }

  return (
    <fieldset ref={rootRef} className='space-y-2 rounded-md border p-3'>
      <legend className='px-1 text-sm'>收件資料</legend>

      {/* 🔴 位置:標題列,**不放在輸入框旁邊**。
          按「同上」會**覆蓋收件人姓名/電話已經打好的字,而且沒有復原** ——
          那是它的用途(不是 bug),所以不加二次確認
          (一顆要按兩下的「同上」比自己重打還慢 ⇒ 它會被繞過,而不是被小心使用)。
          ⇒ 改用**距離**降低誤按:離輸入框遠一點,離標題近一點。 */}
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>寄到哪裡、寄給誰。</p>
        <button
          type='button'
          onClick={copyFromCustomer}
          data-testid='manual-order-ship-to-copy'
          className='rounded-md border px-2 py-1 text-xs'
        >
          同上
        </button>
      </div>

      {notice && (
        <p role='status' data-testid='manual-order-ship-to-notice' className='text-xs text-amber-700'>
          {notice}
        </p>
      )}

      {/* 🔴 姓名/電話:`key` 綁序號 ⇒ 按「同上」時重新掛載、吃新的 `defaultValue`。 */}
      <input
        key={`name-${seq}`}
        name={MANUAL_ORDER_SHIP_TO_NAME_FIELD}
        autoComplete='off'
        aria-label='收件人'
        placeholder='收件人'
        defaultValue={copied?.name ?? ''}
        required
        className='block w-full rounded-md border px-2 py-1'
      />
      <input
        key={`phone-${seq}`}
        name={MANUAL_ORDER_SHIP_TO_PHONE_FIELD}
        autoComplete='off'
        aria-label='收件人電話'
        placeholder='電話'
        defaultValue={copied?.phone ?? ''}
        required
        className='block w-full rounded-md border px-2 py-1'
      />
      {/* 🔴 **這一格沒有 `key`、沒有 `defaultValue`** —— 見檔頭那段。「同上」不碰它。 */}
      <input
        name={MANUAL_ORDER_SHIP_TO_LINE_FIELD}
        autoComplete='off'
        aria-label='收件地址'
        placeholder='地址'
        required
        className='block w-full rounded-md border px-2 py-1'
      />
    </fieldset>
  );
}
