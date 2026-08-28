'use client';

import { useId, useRef, useState, useTransition } from 'react';
import {
  MANUAL_CUSTOMER_NEW_NAME_FIELD,
  MANUAL_CUSTOMER_NEW_PHONE_FIELD,
  MANUAL_ORDER_CUSTOMER_FIELD,
} from '@/lib/orders/manual-order-form';
import {
  createManualCustomerInlineAction,
  searchManualCustomersAction,
  type PickerCandidate,
} from '@/lib/customers/manual-customer-actions';

// manual-customer-picker.tsx — 建單面板裡的「找客人 / 就地新增」那一塊(2026-08-28)。
//
// 🔴🔴 **Sean 2026-08-28 逐字:「我不要先搜尋客人才開始建立單,這樣整個流程太複雜,一個頁面搞定。」**
//    ⇒ 舊形狀:搜尋是 GET 導頁、建客人是 PRG ⇒ **兩者都會把已填的運費與地址清光**
//      ⇒ 所以才有「選到客人之前不出建單表單」那個兩段式。
//    ⇒ 本檔把成因拿掉:**兩件事都不導頁** ⇒ 兩段式沒有存在理由,它自然消失。
//
// ── 🔴🔴 不變式:送出值一律由**原生控制項**承載,client state 只從 DOM 讀進來 ──────────────
//   來源 = `cancel-form-body.tsx:28-31` 逐字:「state 只從 DOM 讀進來(單向投影),
//   **沒有任何一條路徑把 state 寫回控制項的 value、也沒有拿 state 去組另一個送出值**」。
//   本檔怎麼滿足它:
//     · 選中的客人 = 一顆 `<input type='radio' name={MANUAL_ORDER_CUSTOMER_FIELD}>`
//       ⇒ **員工看到的那個 DOM 節點,就是送出去的那個值** ⇒ 顯示與送出**沒有可以分岔的地方**
//     · state 只有兩樣:①候選清單(要畫幾顆 radio)②畫面訊息。**一個送出值都不碰。**
//     · 剛建好的那位用 `defaultChecked` —— 那是**新掛載節點的初始值**,不是持續受控;
//       之後員工改選誰,DOM 說了算(`key={userId}` 讓節點身分穩定,不會被索引重用竄位)。
//
// ── 🔴🔴 為什麼這裡【不會】踩到取消線那條血淚 ────────────────────────────────────────
//   `cancel-actions.ts:30` 記的是 **`<form action={…}>` 回傳值**那個形狀:
//   React 在 form action 完成後**會 reset 那張表單**,而非受控控制項的值就在那一刻回到 `defaultValue`。
//   ⇒ 本檔兩顆按鈕都是 `type='button'`、走**事件處理器**呼叫 action
//     ⇒ **沒有 form action ⇒ 沒有 form reset ⇒ 那個競態在結構上不存在。**
//   ⚠️ 而那條教訓**被同一支檔自己更正過**(`cancel-form-body.tsx:17`:「不要寫【零 client state】——
//      那句在 A13b E1 之後是假的」)⇒ **兩句都要讀**:競態是真的,而「不准有 client state」不是它的解。

export type ManualCustomerPickerProps = {
  /**
   * 這一次面板開啟的冪等鍵(合法 uuid,由 server 每次 render 給一顆)。
   * 🔴 **同一份畫面連按兩次「建立」⇒ 同一顆 ⇒ 建不出第二個帳號**;重新載入 ⇒ 換一顆。
   * 🔴 **它不進網址** —— 舊形狀靠 `?mrid=` 跨導頁帶回來,而導頁沒了就不必跨任何東西。
   */
  customerRequestId: string;
};

type Notice = { tone: 'warn' | 'error' | 'ok'; text: string } | null;

export function ManualCustomerPicker({ customerRequestId }: ManualCustomerPickerProps) {
  const phoneInputId = useId();
  const newNameId = useId();
  const newPhoneId = useId();

  const [candidates, setCandidates] = useState<PickerCandidate[] | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [searchedPhone, setSearchedPhone] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  /**
   * 搜尋的**序號** —— 只有「最後發出去的那一發」的結果算數(codex R5 must-fix)。
   *
   * 🔴 病的形狀:員工打 `0912` 按 Enter,還沒回來就改成 `0988` 再按一次
   *    ⇒ **兩發並行**,而慢的那一發(舊的)可能**後**回來 ⇒ 它把新結果蓋掉
   *    ⇒ 畫面上是**舊電話的候選**,而搜尋框裡寫著新電話 ⇒ **員工會選到別人。**
   * 📌 而它不會壞給你看:兩邊都是合法的客人清單,**沒有任何一格會紅**。
   */
  const searchSeq = useRef(0);

  /** 🔴 只從 DOM 讀,不回寫。這是本檔碰輸入框的**唯一**方向。 */
  const readValue = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';

  /**
   * 在這一塊的輸入框按 **Enter** ⇒ 跑它旁邊那顆按鈕,**不要送出整張訂單**。
   *
   * 🔴🔴 **codex R4 must-fix,而它推翻的是本檔檔頭原本的一句話**:
   *    原本寫「兩顆按鈕都是 `type='button'` ⇒ 不送出這張表單」——
   *    **那句對滑鼠成立、對鍵盤不成立。**
   *    HTML 的**隱式送出**(implicit submission):表單裡有多個文字輸入框時,在其中一個按 Enter
   *    會去找「第一顆 submit 按鈕」並按下它 —— 而這張表單裡那顆叫**「建立訂單」**。
   *    ⇒ 員工填好運費與地址、在搜尋框按 Enter ⇒ **整張單被送出去** ⇒ 走 PRG ⇒ 值全清。
   *    📌 也就是說:**這一片要修的那個病,從鍵盤那道門原封不動地走了回來,**
   *       而畫面上那顆按鈕、那個 `type='button'`、那些測試,**全都是對的**。
   */
  const onEnter = (run: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // 🔴🔴 **中文輸入法正在組字時的那一下 Enter,是「選這個字」,不是「執行」**(codex R5 must-fix)。
    //    不擋的話:員工打「王小明」按 Enter 確認選字 ⇒ **當場就去建客人**,
    //    而他要建的那個名字**只打到一半**。⇒ 系統裡多出一位「王小」。
    //    📌 這條在英數輸入下**永遠不會發生** ⇒ 開發時測不到,而 Sean 的客人全是中文名字。
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    run();
  };

  function runSearch() {
    const raw = readValue(phoneInputId);
    const seq = ++searchSeq.current;
    /** 這一發已經不是最新的那一發了 ⇒ 它的結果一個字都不准寫進畫面。 */
    const stale = () => seq !== searchSeq.current;
    startTransition(async () => {
      // 🔴🔴 **這一層 `try` 不是防禦性禮貌,是 codex R4 must-fix**:
      //    server action 在網路斷線 / 序列化失敗 / runtime 自己 throw 時**不會**回 `{ok:false}`,
      //    它會**往上拋** ⇒ 這顆 client component 掉進 Error Boundary ⇒ **整塊重新掛載**
      //    ⇒ 而重新掛載的那一刻,員工已經填好的運費與地址(非受控原生控制項)**一起回到預設值**。
      //    📌 也就是說:**這一片要修的那個病,可以完全不經過導頁、只靠一次網路斷線就發生。**
      let res: Awaited<ReturnType<typeof searchManualCustomersAction>>;
      try {
        res = await searchManualCustomersAction(raw);
      } catch {
        if (stale()) return;
        setNotice({ tone: 'error', text: '找客人的時候連不上系統。你填的東西都還在,請再按一次「找客人」。' });
        return;
      }
      if (stale()) return;
      if (!res.ok) {
        setCandidates(null);
        setNotice(
          res.reason === 'denied'
            ? { tone: 'error', text: '你的登入已經過期。請重新登入之後再找一次。' }
            : res.reason === 'too_short'
              ? { tone: 'warn', text: '電話至少要打 3 個數字才找得動。' }
              : // 🔴 「查壞了」與「查無」**不得印同一句**:後者要他去建客人(做得到),前者要他找人。
                { tone: 'error', text: '客人查詢現在讀不到(不是查不到這位客人)。請再找一次,一直這樣就找人看一下。' },
        );
        return;
      }
      setSearchedPhone(raw);
      setCandidates(res.candidates);
      setNotice(
        res.candidates.length === 0
          ? null
          : res.truncated
            ? { tone: 'warn', text: '符合的帳號太多,下面只列出前面幾個。請把電話打完整一點再找一次。' }
            : res.shouldWarnDuplicates
              ? { tone: 'warn', text: '這支電話上有好幾個帳號。請確認你選的是對的那一位。' }
              : null,
      );
    });
  }

  function runCreate() {
    const name = readValue(newNameId);
    const phone = readValue(newPhoneId);
    // 🔴🔴 **建立也要動同一顆序號**(codex R6 must-fix)——
    //    一發慢搜尋 + 一次建立並行時,慢搜尋回來會把「剛建好而且已經選起來的那位」蓋掉。
    //    📌 **兩個非同步動作寫同一塊畫面,只協調其中一對,等於沒有協調。**
    //
    // 🔴🔴 **而兩者的契約【不對稱】**(codex R7 must-fix,推翻我上一版的「兩邊都丟」):
    //    · 搜尋是**唯讀**的 ⇒ 舊結果丟掉沒有代價
    //    · 建立**在伺服器產生了一個真的帳號** ⇒ **它的結果一個字都不能丟**
    //      丟掉的話:員工看不到剛建好的那位 ⇒ 他會再建一個 ⇒ **DB 裡多一個真帳號,而畫面上什麼都沒說。**
    //    ⇒ 所以建立這邊**不做 stale 檢查**,而是在結果落地的那一刻**再推一次序號** ——
    //      把還在飛的搜尋全部作廢。**建立永遠贏。**
    ++searchSeq.current;
    startTransition(async () => {
      // 🔴 理由同 `runSearch` 那段(codex R4 must-fix:throw 不是 `{ok:false}`)。
      //    ⚠️ 而這一支的文案**不得**叫他「再按一次建立」—— 建帳號與回頭確認不在同一個交易裡,
      //    拋出來的那一刻可能**已經留下一個真的帳號**(`manual-customer.ts` 自陳)。
      let res: Awaited<ReturnType<typeof createManualCustomerInlineAction>>;
      try {
        res = await createManualCustomerInlineAction({ name, phone, requestId: customerRequestId });
      } catch {
        setNotice({
          tone: 'error',
          text: '建客人的時候連不上系統,而系統裡可能已經建好了。請【先不要再按一次】,改用同一支電話再找一次。',
        });
        return;
      }
      // 🔴 結果落地 ⇒ 再推一次序號 ⇒ 還在飛的搜尋全部作廢(成功與失敗都要,
      //    失敗那句「可能已經建好了」比任何搜尋結果都重要)。
      ++searchSeq.current;
      if (!res.ok) {
        setNotice({ tone: res.reason === 'invalid_name' || res.reason === 'invalid_phone' ? 'warn' : 'error', text: res.message });
        return;
      }
      setCandidates([res.candidate]);
      // 🔴🔴 **只有【我們剛做出來的那位】才自動選起來**(codex R7 must-fix)。
      //    `existing` = 預檢撞到一位很像的人(同姓名 + 同電話 + 後台開的帳號)——
      //    **那只是一組長得很像的資料,不是同一個人的證明**(一家人共用市話 + 剛好同名)。
      //    ⇒ 自動選起來 + 一句警告的話,**警告出現的時候客人已經被選好、送出鈕已經亮了**
      //      ⇒ 員工按下去就掛錯帳。
      //    📌 **一句警告如果沒有把下一步收回來, 它只是在旁邊講話。**
      setJustCreatedId(res.outcome === 'existing' ? null : res.candidate.userId);
      // 🔴🔴 **「新建的」與「本來就有的」要說不同的話**(codex R6 must-fix 的緩解)。
      //    ~~上一版兩條路共用一句「已經建好」~~ —— 而重用那條路有一個**罕見但真實**的誤判:
      //    **同名 + 同電話 ≠ 同一個人**(一家人共用市話、剛好同名)⇒ 訂單會靜默掛到別人帳上。
      //    ⇒ 系統判不出來,**而看得出來的是人** ⇒ 那就要讓他知道「這位是本來就有的」。
      //    📌 一個擋不掉的錯,至少要讓**唯一有可能發現它的人**看見它發生了。
      setNotice(
        res.outcome === 'existing'
          ? {
              tone: 'warn',
              text: `系統裡已經有一位「${res.candidate.name}」,電話也一樣,所以我【沒有】幫你多開一個帳號、也【沒有】幫你選起來。請你自己確認:下面那位就是你要的客人的話,點一下選起來;不是同一個人的話,找人看一下。`,
            }
          : { tone: 'ok', text: `已經建好「${res.candidate.name}」,並且幫你選起來了。` },
      );
    });
  }

  const searchedAndEmpty = candidates !== null && candidates.length === 0;

  return (
    <fieldset className='space-y-3 rounded-md border p-3' data-testid='manual-customer-picker'>
      <legend className='px-1 text-sm'>客人</legend>

      {/* 🔴 `type='button'` **只擋滑鼠**;鍵盤那半由 `onEnter` 擋(見上面那段)。兩個都要。 */}
      <div className='flex flex-wrap items-end gap-2'>
        <label className='block text-sm' htmlFor={phoneInputId}>
          客人電話
          <input
            id={phoneInputId}
            name='customer_phone_lookup'
            onKeyDown={onEnter(runSearch)}
            inputMode='tel'
            placeholder='用電話找客人'
            className='mt-1 block w-56 rounded-md border px-2 py-1'
          />
        </label>
        <button
          type='button'
          onClick={runSearch}
          disabled={pending}
          className='inline-flex h-8 items-center rounded-md border px-3 text-sm'
        >
          {pending ? '找…' : '找客人'}
        </button>
      </div>

      {notice && (
        <p
          role='status'
          data-testid='manual-customer-picker-notice'
          className={
            notice.tone === 'error'
              ? 'text-sm text-destructive'
              : notice.tone === 'warn'
                ? 'text-sm text-amber-700'
                : 'text-muted-foreground text-sm'
          }
        >
          {notice.text}
        </p>
      )}

      {candidates !== null && candidates.length > 0 && (
        <ul className='space-y-1' data-testid='manual-customer-candidates'>
          {candidates.map((c) => (
            <li key={c.userId}>
              <label className='flex items-center gap-2 text-sm'>
                {/* 🔴🔴 **這顆 radio 就是送出去的值。** 沒有第二份真相可以與它分岔。 */}
                <input
                  type='radio'
                  name={MANUAL_ORDER_CUSTOMER_FIELD}
                  // 🔴 原生必填 —— 有候選卻一個都沒選時,瀏覽器自己會擋下送出並指到這裡。
                  //    ⚠️ 它**只涵蓋「清單上有東西」那半**:一顆 radio 都沒畫出來時,
                  //    radio group 不存在 ⇒ `required` 沒有東西可以驗 ⇒ 另一半由送出鈕那支擋
                  //    (`manual-order-submit.tsx`)。**兩道各擋一半,不是重複。**
                  required
                  value={c.userId}
                  defaultChecked={c.userId === justCreatedId}
                />
                <span>
                  {c.name}({c.phone ?? '沒有電話'})
                  {c.isManual ? ' · 後台開的帳號' : ''}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* 🔴🔴 **查無 ⇒ 就地建。**(2026-08-27 Sean 逐字「沒有直接新增」)
          舊畫面在這裡印「請先到【客人】頁建立這位客人」—— 而**客人頁沒有那顆按鈕**
          ⇒ 那句話把員工指到一個做不到那件事的地方。 */}
      {searchedAndEmpty && (
        <div className='space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3' data-testid='manual-order-new-customer'>
          <p role='status' className='text-sm text-amber-700'>
            這支電話找不到客人。<strong>直接在這裡建一位</strong>,建好就會自動選起來。
          </p>
          <div className='grid grid-cols-2 gap-2'>
            <label className='block text-sm' htmlFor={newNameId}>
              客人姓名
              <input
                id={newNameId}
                name={MANUAL_CUSTOMER_NEW_NAME_FIELD}
                onKeyDown={onEnter(runCreate)}
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
            <label className='block text-sm' htmlFor={newPhoneId}>
              電話
              {/* 🔴 預填他剛剛搜的那支 —— 叫他把同一支電話再打一次,正是這一片要拿掉的動作。
                  `key` 綁著它 ⇒ 換一個搜尋字串時這格會重新掛載並帶新的預設值。 */}
              <input
                key={searchedPhone}
                id={newPhoneId}
                name={MANUAL_CUSTOMER_NEW_PHONE_FIELD}
                onKeyDown={onEnter(runCreate)}
                defaultValue={searchedPhone}
                inputMode='tel'
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
          </div>
          <button
            type='button'
            onClick={runCreate}
            disabled={pending}
            className='rounded-md border px-3 py-1 text-sm'
          >
            {pending ? '建立中…' : '建立這位客人'}
          </button>
          <p className='text-muted-foreground text-xs'>
            地址在下面的「收件資料」填就好,這裡不用。
          </p>
        </div>
      )}
    </fieldset>
  );
}
