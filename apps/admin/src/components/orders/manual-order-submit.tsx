'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MANUAL_CUSTOMER_NEW_NAME_FIELD,
  MANUAL_CUSTOMER_NEW_PHONE_FIELD,
  MANUAL_ORDER_CUSTOMER_FIELD,
  MANUAL_ORDER_LINE_SKU_BASE,
  manualOrderLineField,
  parseManualOrderForm,
  taxBasisProblemMessage,
  readInvoiceRequestedFromForm,
} from '@/lib/orders/manual-order-form';

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

/**
 * **選了一位客人, 而建立區描述的是【另一個人】** ⇒ 這張單要擋下來。
 *
 * 🔴🔴 **判準是「不一樣」, 不是「有沒有字」**(codex R2 must-fix,2026-08-28 推翻我上一版)。
 *
 *   我 R1 的版本寫的是「有 radio 被選 && 建立區兩格任一非空 ⇒ 擋」——
 *   codex R2 用**兩條正常流程**打爆它:
 *     ① 搜甲 ⇒ 搜尋成功會把那支電話**預填進建立區**(`key={searchedPhone}` + `defaultValue`)
 *        ⇒ 再點選甲 ⇒ **建單的主線流程當場鎖死。**
 *     ② 建立乙**成功** ⇒ 那兩格的字**還在**、而乙的 radio 被自動勾起來
 *        ⇒ 立刻 conflict ⇒ 畫面叫他「請先按建立這位客人」⇒ **他剛按過, 這是死路。**
 *   📌 **形狀:我拿「欄位有沒有字」當「他想建另一個人」的代理, 而那兩件事在【成功路徑上】就會分家。**
 *      ⇒ 一道用來擋錯誤的閘, 擋住的全是對的操作。
 *
 *   正解:比**內容**。建立區某一格有字、而它與**選起來那位**的對應欄位不同 ⇒ 才是兩個人。
 *   ⚠️ **空欄位一律略過**:搜尋只預填電話、不填姓名 ⇒ 姓名那格是空的,
 *      而「空」不是「叫另一個名字」。拿空去比會把①打回來。
 */
function hasConflict(form: HTMLFormElement): boolean {
  const picked = form.querySelector(`input[name="${MANUAL_ORDER_CUSTOMER_FIELD}"]:checked`);
  if (!(picked instanceof HTMLElement)) return false;
  const read = (field: string): string => {
    const el = form.querySelector(`[name="${field}"]`);
    return el instanceof HTMLInputElement ? el.value.trim() : '';
  };
  // 🔴 電話比對**只看數字**:選起來那位存的是 `0912-345-678`,而他打的是 `0912345678`
  //    ⇒ 逐字比會把同一支電話判成兩個人 ⇒ 又一次「擋住對的操作」。
  const digits = (v: string): string => v.replace(/[^0-9]/g, '');
  const typedName = read(MANUAL_CUSTOMER_NEW_NAME_FIELD);
  const typedPhone = read(MANUAL_CUSTOMER_NEW_PHONE_FIELD);
  if (typedName === '' && typedPhone === '') return false;
  // 🔴🔴 **內容相符【只在「那位就是我們剛建出來的」時】才算免責**(codex R4 must-fix,2026-08-28)。
  //
  //   R2 讓我從「有沒有字」改成「一不一樣」,而 R4 打破了那一版:
  //     甲與乙**同名、同市話**(一家人)⇒ 他選了甲、打了乙、忘記按「建立這位客人」
  //     ⇒ **內容相符 ⇒ 判無衝突 ⇒ 送出鈕亮 ⇒ 單掛給甲。**
  //   📌 **「資料相同」不是「同一個人」** —— 而這句話 `manual-customer.ts` 的 `C-F1`
  //      早就寫過(建立那一側的預檢),**我在另一個守門上又犯了一次同一個錯**。
  //   ⇒ 內容比對留著,但它只回答一個更窄的問題:
  //     **「這兩格是不是就是我們剛剛建出來的那位留下的?」**
  //     不是 ⇒ 一律擋(fail-closed);是 ⇒ 放行(那是 R2-② 那條死路要避的)。
  //   ⚠️ 而 `data-just-created` 由 picker 在**它自己剛建出來的那一顆 radio** 上標,
  //      每一次新的搜尋都會清掉(`justCreatedId` ⇒ null)⇒ 它不會過期地生效。
  if (picked.dataset.justCreated !== '1') return true;
  const sameAsCreated =
    (typedName === '' || typedName === (picked.dataset.customerName ?? '')) &&
    (typedPhone === '' || digits(typedPhone) === digits(picked.dataset.customerPhone ?? ''));
  return !sameAsCreated;
}

/**
 * 有沒有哪一列標成**含稅**而換算回未稅**除不盡**(⟦b4-PURCHTAX1⟧ 2026-09-06)。
 *
 * 🔴🔴 **為什麼瀏覽器這一側也要有一道** —— server 那一側已經會拒了, 而**員工看不到那句話**:
 *    `manual-order-actions.ts` 把 `parsed.error` 丟進 `console.warn`, 導頁只帶一個固定碼
 *    ⇒ 畫面上出現的是「表單有地方不對,沒有存進去。」**而且走 PRG ⇒ 他打的東西全清。**
 *    ⇒ 📌 只有 server 那一道的話, 這片交出去的是「**擋住了, 而他不知道被什麼擋住**」,
 *      而 Sean 的 `Q5 = 甲` 要的是「補一道守門」, 不是補一次靜默失敗。
 * 🔵 **算式與訊息都向 `manual-order-form.ts` 借** —— 兩邊各寫一份的話,
 *    他在畫面上看到的數字與進 DB 的數字會有兩個來源。
 * ⚠️ **它不是 server 那道的替代品**:任何人繞過瀏覽器直接 POST, 擋他的是 server 那一道。
 */
function findTaxBasisProblem(_form: HTMLFormElement): string | null {
  // 🔴🔴 **[2026-09-10] 這一道【對品項已經沒有題目了】—— Sean 拍「Q2′ 甲 = 改成用減的」。**
  //    本函式只掃 `line_tax_basis_*`(**品項**那些 select),而品項的含稅價現在走殘差
  //    (`untaxedForTaxedLine`)⇒ **「除不盡」不再是一種錯。**
  //    ⇒ 📌 **它今天唯一做得到的事,是擋下一張【會成功的單】,並叫員工去改一個沒有錯的數字。**
  //
  // ⛔ ~~原本的迴圈:逐列找「標含稅而換不回整數」的單價 ⇒ 回 `taxBasisProblemMessage`~~
  //    連同它上面那幾段(`trim()` 那個自我訂正、`readInvoiceRequestedFromForm` 的三態)
  //    一起拿掉了 —— **它們守的那個狀態已經不存在。**
  //    🔵 而那些理由沒有消失:`trim()` 那一段在 `git log` 裡(2026-09-06 那一片),
  //      `readInvoiceRequestedFromForm` 的三態理由在它自己的 docstring 裡。
  //
  // 🛑 **而這支函式【不刪掉】,理由兩個**:
  //    ① **運費那半仍然會拒收**(`untaxedFromTaxedShippingFee`:RPC 收不到運費稅基)
  //       ⇒ 那一天有人要在瀏覽器補一道運費的守門,**這裡就是它的位置**,而外殼(只在
  //         勾發票時說話 / 判不出來就不說話 / 借 server 同一支算式)本來就是對的。
  //    ② 刪掉要動兩個呼叫端(`setTaxProblem` 那兩處)⇒ 📌 **本片改的是錢的算法,
  //       不該同時搬動一個 UI 流程** —— 那會讓 diff 裡「錢」與「畫面」混在一起。
  //
  // ⚠️ **代價照實寫**:`setTaxProblem` 從此永遠是 `null` ⇒ 畫面上那句話不會再出現。
  //    ✅ **而那正是要的** —— 那句話今天講的是一個不會發生的換算。
  return null;
}

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
  /**
   * **選了一位客人, 而「建立新客人」那兩格又有字**(codex R1 must-fix,2026-08-28)。
   * 🔴 這一格不是 `picked` 的細分, 是一個**獨立的世界**:兩個訊號都在說「可以送了」,
   *    而它們指的是不同的人。⇒ 它自己有訊息、自己有測試。
   */
  const [conflict, setConflict] = useState(false);
  /**
   * 稅基除不盡那一句(⟦b4-PURCHTAX1⟧)。**與 `conflict` 是兩個獨立的世界** ——
   * 兩件事可以同時成立, 而它們叫他做的下一件事不一樣。
   */
  const [taxProblem, setTaxProblem] = useState<string | null>(null);
  /**
   * 送出前跑一次 server 那支 `parseManualOrderForm`, 沒過的那句話(⟦走查 F1⟧ 2026-09-11)。
   * 🔴 server 那一道失敗時只帶 `invalid` 碼導頁(`manual-order-actions.ts:99-116`)⇒ 畫面只剩
   *    「表單有欄位沒填」而且 PRG 把整張表清空 ⇒ 少填一格料號 = 整張單重打。
   *    ⇒ 在瀏覽器先問同一支解析器:話一字不差、規則不長第二份;沒過就不送, 值自然都還在。
   * ⚠️ 它不是 server 那道的替代品(繞過瀏覽器直接 POST 仍由 server 擋)。
   * 🔵 只在員工再動任何一格時清掉 —— 不掛在 `sync` 上:這句話自己畫進 DOM 會觸發
   *    MutationObserver ⇒ 掛在 sync 會把它剛出現就擦掉。
   */
  const [formProblem, setFormProblem] = useState<string | null>(null);

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    const sync = () => {
      const hit = form.querySelector(`input[name="${MANUAL_ORDER_CUSTOMER_FIELD}"]:checked`) !== null;
      setPicked(hit);
      setConflict(hasConflict(form));
      setTaxProblem(findTaxBasisProblem(form));
    };
    sync();
    // 🔴 兩個訊號都要:`change` = 員工自己點了一顆;`MutationObserver` = 搜尋回來 / 剛建好的那位
    //    被畫進 DOM(那一顆帶 `defaultChecked`,**不會發 `change`**)。
    //    少了後者 ⇒ 「建好客人自動選起來」之後按鈕仍然是灰的,而畫面上明明選好了。
    form.addEventListener('change', sync);
    // 🔴 `change` 對文字框**要等 blur 才發** ⇒ 員工打完字直接按「建立訂單」時
    //    那顆鈕在他按下去的**那一刻**還是舊狀態。`input` 是逐字發的。**兩個都要。**
    form.addEventListener('input', sync);
    const clearFormProblem = () => setFormProblem(null);
    form.addEventListener('input', clearFormProblem);
    form.addEventListener('change', clearFormProblem);

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

    // 🔴🔴 **送出的那一刻【再問一次 DOM】**(codex R2 must-fix)。
    //   病:瀏覽器 autofill / 密碼管理員 / 擴充套件 / 任何程式化的 `.value = …`
    //   **不會發 `input` 或 `change`** ⇒ 上面那些監聽器一個都不會跑
    //   ⇒ `conflict` 還是 `false`、按鈕亮著 ⇒ 按下去 ⇒ 訂單掛給錯的人。
    //   📌 **形狀:一道靠【事件】維持的 state, 在「值變了而沒有事件」的世界裡是過期的**
    //      —— 而它過期的樣子,與它正確的樣子,在畫面上一模一樣。
    //   ⇒ 所以判定不是只住在 state 裡:送出那一刻**重新讀一次 DOM**,不一致就攔下來。
    //   ⚠️ 這一道與上面那個 state **不是重複**:state 管【按鈕長什麼樣】,這一道管【擋不擋】。
    const guardSubmit = (e: Event) => {
      // 🔴 稅基那一道**也要在送出的那一刻再問一次 DOM**, 理由與下面那道逐字相同:
      //    autofill / 擴充套件 / 程式化的 `.value =` 不發事件 ⇒ state 可能是過期的。
      const tax = findTaxBasisProblem(form);
      if (tax !== null) {
        e.preventDefault();
        setTaxProblem(tax);
        return;
      }
      if (hasConflict(form)) {
        e.preventDefault();
        setConflict(true);
        return;
      }
      const parsed = parseManualOrderForm(new FormData(form));
      if (parsed.ok) return;
      e.preventDefault();
      setFormProblem(parsed.error);
      if (parsed.lineIndex !== undefined) {
        // 把游標帶到錯的那一列(料號是那一列的第一格);瀏覽器會自己捲過去。
        const first = form.querySelector(
          `[name="${manualOrderLineField(MANUAL_ORDER_LINE_SKU_BASE, parsed.lineIndex)}"]`,
        );
        if (first instanceof HTMLElement) first.focus();
      }
    };
    form.addEventListener('submit', guardSubmit);
    const observer = new MutationObserver(sync);
    observer.observe(form, { childList: true, subtree: true });
    return () => {
      form.removeEventListener('change', sync);
      form.removeEventListener('input', sync);
      form.removeEventListener('input', clearFormProblem);
      form.removeEventListener('change', clearFormProblem);
      form.removeEventListener('keydown', blockImplicitSubmit);
      form.removeEventListener('submit', guardSubmit);
      observer.disconnect();
    };
  }, []);

  return (
    <div className='space-y-1'>
      <button
        ref={buttonRef}
        type='submit'
        disabled={picked !== true || conflict || taxProblem !== null}
        data-testid='manual-order-submit'
        className='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50'
      >
        建立訂單
      </button>
      {taxProblem !== null && (
        // 🔴 排在 `conflict` 前面:它講的是**錢**, 而錢的錯比選錯人更難事後發現。
        <p className='text-sm text-destructive' data-testid='manual-order-submit-tax-basis'>
          {taxProblem}
        </p>
      )}
      {conflict && (
        <p className='text-sm text-destructive' data-testid='manual-order-submit-conflict'>
          你已經選了上面清單裡的一位客人,而下面「建立新客人」那兩格又打了字。
          這張單只能屬於一個人 —— 要用下面那位,請先按「<strong>建立這位客人</strong>」;
          要用上面選的那位,請把下面兩格清空。
        </p>
      )}
      {formProblem !== null && (
        <p className='text-sm text-destructive' role='alert' data-testid='manual-order-submit-form-problem'>
          {formProblem}
        </p>
      )}
      {picked !== true && !conflict && taxProblem === null && (
        // 🔴 說**現在缺什麼**,不說「請填寫必填欄位」—— 後者會讓他去檢查地址那幾格。
        //    而 `null`(還沒 hydrate)與 `false`(問過而沒選)**下一步不一樣** ⇒ 兩句話。
        <p className='text-muted-foreground text-xs' data-testid='manual-order-submit-hint'>
          {picked === null
            ? '畫面還在載入,載完才能送出。一直是這樣的話請重新整理。'
            : // 🔴 ~~原句「先在上面挑一位客人(找不到就在那裡建一位),這顆按鈕才會亮。」~~
              //    2026-08-28 換掉。**改法是「點名那顆按鈕」**:
              //    舊句說「建一位」,而員工打完姓名電話就會以為**打完字就是建了**
              //    —— 那兩格不進建單解析器(`manual-order-form.ts` 那段逐字寫著),
              //    沒按「建立這位客人」就沒有客人 ⇒ 這顆鈕維持灰的 ⇒ **而他不知道為什麼。**
              //    📌 這一格是 Sean 2026-08-28 回報的直接落點:
              //       「直接輸入收件人資訊,但是還是無法建立訂單」。
              '這張單還沒有客人。上面挑一位,或是打好姓名電話後按「建立這位客人」——按了才算數。'}
        </p>
      )}
    </div>
  );
}
