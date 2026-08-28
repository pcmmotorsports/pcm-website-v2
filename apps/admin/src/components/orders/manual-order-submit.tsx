'use client';

import { useEffect, useRef, useState } from 'react';
import { MANUAL_ORDER_CUSTOMER_FIELD } from '@/lib/orders/manual-order-form';

// manual-order-submit.tsx — 建單表單那顆「建立訂單」(2026-08-28,codex R4 must-fix)。
//
// 🔴🔴 **它為什麼要是一支獨立的 client component,而不是一顆普通的 `<button type='submit'>`**
//
//   R4 抓到的病:**沒有選客人也按得下去。**
//   按下去之後不是「什麼都沒發生」—— 解析器會擋(`manual-order-form.ts:424-427`),
//   而擋的方式是 **`redirect()`** ⇒ **員工填好的運費、地址、發票、每一列品項,全部消失,只剩一個 `mrid`。**
//   📌 **一道正確運作的守門,把流量推進了這一片本來要修的那個病。**
//
//   而「沒選客人」有兩種形狀,**原生 `required` 只涵蓋其中一種**:
//     ① 清單上有候選、他一個都沒點 ⇒ radio group 存在 ⇒ `required` 擋得住(瀏覽器自己出訊息)
//     ② 🔴 **他還沒搜、或搜了查無** ⇒ **一顆 radio 都沒有畫出來**
//        ⇒ radio group 不存在 ⇒ **`required` 沒有任何東西可以驗** ⇒ 它恆綠、擋不住
//   ⇒ 本檔擋的是 ②。**兩道加起來才是一整面,單獨引用任何一道都會高估它。**
//
// 🔴 **順帶擋掉鍵盤那道門的一半**:HTML 的隱式送出(在文字框按 Enter)是去按「第一顆 submit 按鈕」,
//    而**被 `disabled` 的按鈕按不下去** ⇒ 沒選客人時 Enter 也送不出去。
//    ⚠️ 但**選了客人之後 Enter 仍然會送出** ⇒ 那半在 `manual-customer-picker.tsx` 的 `onEnter` 擋。
//
// ── 不變式(與 picker 同一條)──────────────────────────────────────────────
//   **state 只從 DOM 讀進來,沒有任何一條路徑把 state 寫回控制項的 value。**
//   本檔的 state 是 `picked`(有沒有選)—— 它是**問 DOM 問出來的**(`:checked` 選擇器),
//   不是我們自己記的一份「使用者選了誰」。⇒ 顯示與送出之間**沒有第二份真相可以分岔**。
/**
 * 會被「在裡面按 Enter = 送出整張表單」的那些輸入型別。
 * 🔴 只列**這張表單現在真的有的**加同族幾個;`''` = 沒寫 `type` 的 `<input>`(預設就是 text)。
 */
// 🔴 ~~原本清單裡有 `''`~~ —— **那一格永遠到不了**(codex R7 nit):
//    `HTMLInputElement.type` 對沒寫 `type` 的欄位回的是 `'text'`,不是空字串。
//    📌 一個**不可達**的白名單項目,讀起來像多守了一種情況。
const TEXT_LIKE_INPUT_TYPES = new Set(['text', 'tel', 'email', 'number', 'search', 'url', 'password']);

export function ManualOrderSubmit() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 🔴🔴 **三態,不是兩態**(codex R5 must-fix)。`null` = **還沒問過 DOM**(SSR / 尚未 hydrate)。
  //   兩態版的病:`useState(false)` ⇒ **SSR 吐出來的那顆鈕永遠是灰的**
  //   ⇒ JS 沒 hydrate / chunk 載入失敗 / 這顆元件自己初始化出錯 ⇒ **整頁送不出任何東西**,
  //     而畫面上那句話說的是「先挑一位客人」⇒ **它把系統故障說成員工還沒做完事。**
  //   📌 形狀:**一個守門在「它沒有機會執行」時的預設值,決定了故障當天員工看到什麼。**
  //   ⇒ 🔴🔴 **而「沒問過 ⇒ 亮著」是錯的解**(codex R6 must-fix,推翻我上一輪的修法):
  //     沒有 hydrate 的世界裡,**picker 根本選不了任何人**(搜尋是 client action)
  //     ⇒ 那顆亮著的鈕**只可能**產生一種結果:送出 ⇒ 解析器擋 ⇒ PRG ⇒ 整張值清空。
  //     📌 **我為了修「按不下去」,做出了一顆【按下去一定會弄丟資料】的按鈕。**
  //   ⇒ 三態的正解:沒問過 ⇒ **停用,而且說「載入中」**(不說「先挑客人」——
  //     後者在故障當天會把系統問題說成員工還沒做完事);問過而沒選 ⇒ 停用 + 「先挑客人」。
  //     ⚠️ 兩句話的差別不是禮貌,是**它叫他做的下一件事不一樣**:等 vs 去挑。
  const [picked, setPicked] = useState<boolean | null>(null);

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    const sync = () => {
      setPicked(form.querySelector(`input[name="${MANUAL_ORDER_CUSTOMER_FIELD}"]:checked`) !== null);
    };
    sync();
    // 🔴 兩個訊號都要:`change` = 員工自己點了一顆;`MutationObserver` = 搜尋回來 / 剛建好的那位
    //    被畫進 DOM(那一顆帶 `defaultChecked`,**不會發 `change`**)。
    //    少了後者 ⇒ 「建好客人自動選起來」之後按鈕仍然是灰的,而畫面上明明選好了。
    form.addEventListener('change', sync);

    // 🔴🔴 **隱式送出的守門要掛在【整張表單】上,不是掛在我知道的那幾個框上。**
    //
    //   成因是真瀏覽器量到的(2026-08-28,`localhost:3011` 面板實測):
    //     · 在**客人電話**框按 Enter ⇒ 不送出 ✅(picker 的 `onEnter` 擋住了)
    //     · 🔴 在**運費**框按 Enter ⇒ **送出、換頁到 `/orders/new?r=manual_order_denied`、
    //       運費 150 / 收件人 / 地址 / 品項【全部消失】**
    //   ⇒ 我第一版只守了 picker 那三個框,而**病在每一個文字框上** ——
    //     收件人、電話、地址、發票四格、每一列品項的料號與金額,全部都是門。
    //   📌 **形狀:我照著 finding 的【例子】修,而 finding 講的是【類】。**
    //      codex 那條逐字寫「搜尋框或新增客人欄按 Enter」—— 那是它舉的兩個例子,
    //      而我把例子當成了範圍。**一份正確的 finding,配一個太窄的修法,測試會全綠。**
    //
    //   為什麼擋而不是「讓它送」:這張表單失敗時走 PRG(`redirect`)⇒ **值全清**。
    //   ⇒ 一個手滑的 Enter = 重打一整張單。送出這件事要他**看著那顆按鈕按下去**。
    // ⚠️ `textarea` 不在此列(那裡的 Enter 是換行,本來就不送出);`select` 亦然。
    const blockImplicitSubmit = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      // 🔴 **組字中的 Enter 是「選這個字」**(codex R6 must-fix)。
      //    picker 的 `onEnter` 自己已經有這一道,而**事件仍然會冒泡到這一層** ——
      //    這一層不看的話,中文輸入法確認選字照樣被這裡 `preventDefault` 掉。
      //    📌 兩道守門各自都對,而**事件會經過兩道** ⇒ 只補一道等於沒補。
      if (e.isComposing) return;
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      // 🔴 **只擋文字類**(codex R6 must-fix)。上一版擋所有 `input`,
      //    連 `date` / `radio` / `checkbox` 都擋 —— 而那些控制項上的 Enter
      //    在各家瀏覽器與輔助科技上有別的意思(開日曆、確認選取)。
      //    ⚠️ 這是**白名單**不是黑名單,而白名單的代價要明寫:
      //       漏列一種型別 ⇒ 那一格又變成一條隱式送出的路,**而它不會叫**。
      //       ⇒ 這張清單要跟著表單長,新增欄位型別時回來看一眼。
      if (!TEXT_LIKE_INPUT_TYPES.has(target.type)) return;
      e.preventDefault();
    };
    form.addEventListener('keydown', blockImplicitSubmit);
    const observer = new MutationObserver(sync);
    observer.observe(form, { childList: true, subtree: true });
    return () => {
      form.removeEventListener('change', sync);
      form.removeEventListener('keydown', blockImplicitSubmit);
      observer.disconnect();
    };
  }, []);

  return (
    <div className='space-y-1'>
      <button
        ref={buttonRef}
        type='submit'
        disabled={picked !== true}
        data-testid='manual-order-submit'
        className='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
      >
        建立訂單
      </button>
      {picked !== true && (
        // 🔴 說**現在缺什麼**,不說「請填寫必填欄位」—— 後者會讓他去檢查地址那幾格。
        //    而 `null`(還沒 hydrate)與 `false`(問過而沒選)**下一步不一樣** ⇒ 兩句話。
        <p className='text-muted-foreground text-xs' data-testid='manual-order-submit-hint'>
          {picked === null
            ? '畫面還在載入,載完才能送出。一直是這樣的話請重新整理。'
            : '先在上面挑一位客人(找不到就在那裡建一位),這顆按鈕才會亮。'}
        </p>
      )}
    </div>
  );
}
