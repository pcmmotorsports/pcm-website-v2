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
  /**
   * 候選清單的**版次** —— 每換一份清單就 +1,掛在 `<ul>` 的 `key` 上。
   *
   * 🔴🔴 **為什麼需要它(而我原本以為不需要)**:折 R3-MF2 時只加了 `setJustCreatedId(null)`,
   *   而那一格**還是紅的**。查完才知道機制比 R3 描述的**再細一層**:
   *     R3 寫「radio 重新掛載時 `defaultChecked` 又把他勾回來」——
   *     🔴 而在「他仍在新清單裡」這條路上,`<li key={c.userId}>` 讓 React **重用那個節點**
   *        ⇒ **它根本沒有重新掛載** ⇒ 它只是**留著上一次的 `checked`**。
   *   📌 **兩種機制、同一個畫面**:一個是「被重新勾起來」,一個是「從來沒有被放開」。
   *      而 `setJustCreatedId(null)` 只治得了前者。
   * ⇒ 換一份清單 = 換一次 `key` ⇒ 整批 radio 重新掛載 ⇒ 選取狀態回到 `defaultChecked`。
   * ⚠️ 代價明寫:**每一次搜尋都會清掉他已經選好的那一位。** 那是刻意的 ——
   *   新清單是一份新的事實,而「他上一次選的那位還在新清單裡」**不等於他還要選那一位**。
   */
  const [listSeq, setListSeq] = useState(0);
  const [searchedPhone, setSearchedPhone] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  /**
   * 上一次搜尋是**壞掉**(不是查無)。🔴 **這一格是 2026-08-28 走乙時補上的,而它是承重的。**
   *
   * 走乙之前,「建立客人」那一塊只有在**搜過而且查無**時才渲染
   * ⇒ 查壞了的世界裡它根本不在畫面上 ⇒ **那道保護是免費附贈的,沒有人寫過它。**
   * 而乙把那一塊改成無條件渲染 ⇒ **附贈的那道保護跟著消失了,而畫面上什麼都沒變。**
   *
   * 為什麼那道保護是真的:查詢壞掉 ⇒ 一位**確實存在**的客人被印成「找不到」
   * ⇒ 員工照著旁邊那句「直接在這裡建一位」建下去 ⇒ **同一個人第二個帳號,而那種帳號刪不掉**
   * ⇒ 客人日後登入看不到自己的單(`manual-customer.ts` 的 `C-F1` 那段有全文)。
   * 📌 **形狀:一個功能被刪掉的當下, 它順便擋住的那件事沒有名字, 所以不會有人發現它也一起沒了。**
   *
   * ⇒ 所以這一格明白地寫出來,並且**有自己的測試**(不靠「區塊沒渲染」這個副作用)。
   *
   * 🔴🔴 **2026-08-28 真瀏覽器實測後改成三態,而它原本是布林 —— 那個布林是錯的。**
   *   現象(`localhost:3021` 面板實測):登入過期時,畫面**同時出現兩句話**,
   *   而**下面那句(我加的)更長、更紅,說的卻是錯的故事**:
   *     ① 「你的登入已經過期。請重新登入之後再找一次。」   ← 既有 notice, 對的
   *     ② 「剛剛那次『找客人』是【壞掉】,不是找不到人……」 ← 我加的, 錯的
   *   成因:我把 `denied`(登入過期)與 `error`(查詢真的壞了)**一起塞進同一格布林** ——
   *   而它們**後果相同**(都該鎖住建立鈕)、**故事不同**。
   *   📌 **鎖對了, 話說錯了。** 而登入過期的人要做的是**重新登入**,不是「再找一次」。
   *
   * 🔴 而它為什麼三綠全過、codex 兩輪也沒抓到:
   *   `picker.test.tsx` 裡 `'denied'` 出現 **0** 次 ——
   *   **會觸發這道閘的三個 reason(`denied` / `error` / throw)裡, 有一個從來沒被餵過。**
   *   📌 **我的測試分母由【我想得到的情境】決定, 而 bug 的分母由【那道判斷式收得下哪些值】決定。**
   *   ⇒ 操作化:寫完一道 `if (X !== 'a')` 之後,問「**X 總共有幾個可能值?我餵過幾個?**」
   */
  const [searchBroken, setSearchBroken] = useState<'denied' | 'broken' | null>(null);
  /**
   * 員工**自己**在建立那一塊的電話欄打過字了(codex R1 must-fix)。
   * 🔴🔴 **它是 `useRef` 不是 `useState`, 而那是承重的**:
   *    我第一版寫成 state ⇒ 打第一個字 ⇒ `setState` ⇒ 重新 render ⇒ **`key` 從 `searchedPhone`
   *    變成 `'kept'`** ⇒ 那一格重新掛載 ⇒ **他剛打的那個字當場消失。**
   *    📌 **我為了「防止那一格被重新掛載」而做的修法, 自己造出了一次重新掛載。**
   *    (四支測試當場紅 —— 而它們紅的理由不是我以為的那個。)
   * ⇒ 改成 ref:打字**完全不觸發 render**,而搜尋成功時去問它「該不該預填」。
   * ⚠️ 它**只往一個方向走**(不會變回 `false`):清空欄位也不該讓預填權力回來 ——
   *    「他清空了」與「他從來沒打過」對他而言是**同一個空欄位**,而系統偷偷換掉其中一個的內容。
   */
  const createPhoneDirty = useRef(false);
  // 🔴 換一張表單(`customerRequestId` 變了)⇒ 把 dirty 放掉(codex R4 nit)。
  //   病:表單 A 打過再清空 ⇒ ref 永久 true ⇒ 表單 B 查無時**也不再預填** ——
  //   而那個預填是這一片省下的其中一次打字。
  //   ⚠️ 用 `useRef` 記上一次的值比對,**不用 `useEffect`** —— effect 在 render 之後才跑,
  //      而 `key`/`defaultValue` 在 render 當下就要是對的。
  const lastRequestId = useRef(customerRequestId);
  if (lastRequestId.current !== customerRequestId) {
    lastRequestId.current = customerRequestId;
    createPhoneDirty.current = false;
  }
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
        // 🔴🔴 **MF1(codex R4 must-fix,2026-08-28):throw 也要清掉舊清單與舊選取。**
        //   病:搜到甲並選起來 ⇒ 改搜乙而 action **拋出** ⇒ 舊候選與那顆勾選**原封留著**
        //   ⇒ **送出鈕仍然亮著** ⇒ 他按下去 ⇒ **單掛給甲**,而他要的是乙。
        //   📌 我原本在這條路上什麼都不清,理由寫著「你填的東西都還在」——
        //      **而那句話講的是【表單欄位】,不是【客人選取】。** 我把兩件事讀成同一件。
        //   ⇒ 與 `denied` / `error` 同款 fail-closed:那三種底下「舊清單還準不準」答不出來。
        //   ⚠️ 唯一保留舊清單的是 `too_short`(他還沒打完,不是查詢無效)。
        setCandidates(null);
        setListSeq((n) => n + 1);
        setSearchBroken('broken');
        setNotice({ tone: 'error', text: '找客人的時候連不上系統。你填的東西都還在,請再按一次「找客人」。' });
        return;
      }
      if (stale()) return;
      if (!res.ok) {
        // 🔴 **`too_short` 不清清單**(Fable R3 nit1)。舊碼一律 `setCandidates(null)` ⇒
        //   **一次手誤(少打一碼再按)就把已經搜到的清單【和他已經選好的 radio】一起丟掉。**
        //   而 throw 那條路刻意保留、還說「你填的東西都還在」⇒ **兩種失敗【相反處理】**。
        //   ⇒ `too_short` 是「他還沒打完」,不是「查詢結果無效」⇒ 舊結果仍然成立。
        //   ⚠️ `denied` / `error` **仍然清**:那兩種底下「舊清單還準不準」答不出來 ⇒ fail-closed。
        if (res.reason !== 'too_short') setCandidates(null);
        // 🔴 三種 reason 三種去處,**不合併**:
        //    · `too_short` = 他電話打太短,**系統是好的** ⇒ 不鎖(合併的話一次打字不完整就鎖住)
        //    · `denied`    = 登入過期 ⇒ 鎖,而話要指向**重新登入**
        //    · `error`     = 查詢真的壞了 ⇒ 鎖,而話要指向**重複帳號的風險**
        setSearchBroken(res.reason === 'too_short' ? null : res.reason === 'denied' ? 'denied' : 'broken');
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
      setSearchBroken(null);
      // 🔴🔴 **MF1(Fable R3 must-fix,2026-08-28):預填【只在查無時】留下,命中就清掉。**
      //
      //   病(R3 構造,而它走的是**官方支援的動線**):員工只記得後四碼是常態,
      //   而搜尋門檻是 `phone.length < 3`(`manual-customer-actions.ts:74`)⇒ 搜「5678」合法。
      //     搜「5678」⇒ 命中甲(0912345678)⇒ 舊碼把「5678」預填進建立區電話格
      //     ⇒ 點選甲 ⇒ `hasConflict` 拿「5678」比甲的「0912345678」⇒ digits 不等
      //     ⇒ 🔴 **送出鈕鎖死 +「這張單只能屬於一個人」—— 而那一格字【不是他打的】。**
      //   📌 **一道擋「兩個人」的閘,被一個【系統自己填的值】觸發了。**
      //
      //   🔴 **而「命中就不預填」不夠**(線A 動手前想到的反例,主視窗背書):
      //     先搜 `5678` 查無 ⇒ 預填 `5678` ⇒ **再搜完整號碼命中甲** ⇒ **舊預填還留著** ⇒ 一樣撞。
      //     ⇒ 所以是**清掉**(`''`)不是**不動**。
      //
      //   ⚠️ 清掉不是取捨,是修 bug:建立要 `MIN_PHONE_DIGITS = 8`
      //     (`manual-customer.ts:238`),而搜尋只要 3 ⇒ **部分號碼預填給「建立」用本來就是死的。**
      //   🔴 他自己打過字了(`createPhoneDirty`)⇒ **一個字都不碰**(codex R1 must-fix)。
      if (!createPhoneDirty.current) setSearchedPhone(res.candidates.length > 0 ? '' : raw);
      // 🔴🔴 **MF2(Fable R3 must-fix)**:`justCreatedId` 建立之後**永不清空** ⇒
      //   之後任何一發搜尋只要結果含那位,radio 重新掛載時 `defaultChecked` 又把他**無聲**勾回來。
      //     建立甲 ⇒ 改變主意、搜乙的電話(同市話一家人,清單 [甲,乙])
      //     ⇒ **甲被預選 ⇒ 送出鈕亮 ⇒ 單掛回甲。**
      //   📌 R3 判詞:**這正是 R7「只有剛做出來的那位才自動選」要擋的形狀, 從【時間差】繞回來了。**
      //   ⇒ 「剛做出來」是一個**會過期**的狀態,而舊碼把它當成永久的。
      setJustCreatedId(null);
      setListSeq((n) => n + 1);
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
      setListSeq((n) => n + 1);
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

  // ⛔ ~~`const searchedAndEmpty = candidates !== null && candidates.length === 0;`~~
  //    2026-08-28 刪除(Sean `Q-建單1 ⇒ 乙`)。它是「建立客人」那一塊的渲染閘,
  //    而理由寫在下面那塊的註解裡 —— **一個「查無才長出來」的區塊,對不知道要先搜的人等於不存在。**
  //    ⚠️ 刪它的同時要確認**沒有別的地方在用它**(這支檔內零命中;跨檔它是 local const、出不去)。

  return (
    <fieldset className='space-y-3 rounded-md border p-3' data-testid='manual-customer-picker'>
      <legend className='px-1 text-sm'>客人</legend>

      {/* 🔴 `type='button'` **只擋滑鼠**;鍵盤那半由 `onEnter` 擋(見上面那段)。兩個都要。 */}
      <div className='flex flex-wrap items-end gap-2'>
        {/* 🔴🔴 **這一格 2026-09-05 從「只吃電話」放寬**(`⟦b4-FINDCUSTOMERPHONE⟧`)——
            而放寬的**不是後端**:`admin_search_customers` 本來就吃 name / email / phone 三軸,
            是中間那一層先把查詢輾成數字(見 `manual-customer.ts` 的 `isPhoneLikeQuery`)。

            ⚠️ **`inputMode` 也要跟著改, 而這一格差點被漏掉**:原本是 `'tel'`
            ⇒ 手機上會叫出**數字鍵盤** ⇒ 📌 **員工在手機上根本打不出「王小明」** ——
            那會讓「我們放寬了」這件事在最需要它的裝置上不成立, 而畫面上看不出來。 */}
        <label className='block text-sm' htmlFor={phoneInputId}>
          找客人(電話 / 姓名 / Email)
          <input
            id={phoneInputId}
            name='customer_phone_lookup'
            autoComplete='off'
            onKeyDown={onEnter(runSearch)}
            inputMode='text'
            placeholder='電話 / 姓名 / Email'
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
        <ul key={listSeq} className='space-y-1' data-testid='manual-customer-candidates'>
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
                  // 🔴🔴 **姓名與電話掛在這顆 radio 上**(codex R1 must-fix,2026-08-28)。
                  //    收件那塊的「同上」原本只讀「建立新客人」那兩格 ——
                  //    而**最常見的路徑是「搜到既有客人、選起來」**,那條路上那兩格是空的
                  //    ⇒ 按「同上」會把收件人清成空的、或蓋上他剛剛拿來【搜尋】的那支電話。
                  //    📌 形狀:**「同上」的「上」有兩個意思, 而我只實作了比較少走的那一個。**
                  //    ⇒ 值放進 DOM(不是抬到共用 state)—— 照本片不變式:
                  //      **跨元件要共享的東西,放在那個原生控制項自己身上,不另開一份真相。**
                  data-customer-name={c.name}
                  data-customer-phone={c.phone ?? ''}
                  // 🔴🔴 **MF2(codex R4 must-fix)**:「這一位是我們【剛剛才建出來的】」。
                  //   病:`hasConflict` 原本只比**內容** ⇒ 甲與乙**同名、同市話**(一家人)時
                  //   ⇒ 他選了甲、打了乙、忘記按建立 ⇒ **內容相符 ⇒ 判無衝突 ⇒ 單掛給甲。**
                  //   📌 **「資料相同」不是「同一個人」** —— 而這正是 `manual-customer.ts` 的
                  //      `C-F1` 早就寫過的那句話,我在**另一個守門**上又犯了一次。
                  //   ⇒ 改成:內容相符**只在「那位就是我們剛建的」時**才算免責。
                  //     其餘情況 ⇒ 非空就擋(fail-closed)。
                  {...(c.userId === justCreatedId ? { 'data-just-created': '1' } : {})}
                  defaultChecked={c.userId === justCreatedId}
                />
                <span>
                  {/* 🔴 `||` 不是 `??`:`customers.phone` 可能是空字串(schema 沒有 `<> ''` 約束,
                      而【不准空字串】那種 CHECK 全 repo 172 條、phone 佔 0 條 ——
                      數法 `python3 -c "…count(chr(60)+chr(62)+\" ''\")"` 對 supabase/migrations/*.sql;
                      🛑 那與「全部 CHECK 有幾條」(608)是**兩個不同的問題**, 不要混用)⇒ `??` 會讓這裡顯示
                      一個【空括號】而不是「沒有電話」⇒ 員工分不出「沒填」與「畫面壞了」。⟦b4-PICKPHONE1⟧ */}
                  {c.name}({c.phone || '沒有電話'})
                  {c.isManual ? ' · 後台開的帳號' : ''}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* 🔴🔴 **這一塊【無條件】渲染 —— 面板一打開它就在。**(2026-08-28 Sean `Q-建單1 ⇒ 乙`)
          ⛔ ~~原本包在 `{searchedAndEmpty && (…)}` 裡~~ —— 而 `searchedAndEmpty` 的定義是
             「搜過了 **而且** 一筆都沒搜到」⇒ **面板剛打開時它不在 DOM 裡。**
          🔴 那正是 2026-08-28 Sean 回報的成因:他逐字說「直接輸入收件人資訊,但是還是無法建立訂單」
             —— **他一個字都沒提到建立新客人, 因為他根本沒看到那個東西。**
             他打完收件資料就去按送出,而送出鈕是灰的。
          📌 形狀:**一顆「查無才長出來」的按鈕, 在【使用者不知道要先搜】時等於不存在**
             —— 而它不會報錯,畫面上只是少了一塊。
          ⚠️ 這也是 Sean 2026-08-27 逐字「我不要先搜尋客人才開始建立單」那條拍板的落地
             —— 那條當時**沒有落到這一格**。 */}
      <div className='space-y-2 rounded-md border p-3' data-testid='manual-order-new-customer'>
        {/* 🔴 **文案不再說「這支電話找不到客人」** —— 那句話預設了「你已經搜過了」,
            而現在這一塊在搜尋之前就在畫面上。 */}
        <p className='text-sm'>
          找不到、或這是新客人?<strong>直接在這裡建一位</strong>,建好就會自動選起來。
        </p>
        <div className='grid grid-cols-2 gap-2'>
            <label className='block text-sm' htmlFor={newNameId}>
              客人姓名
              <input
                id={newNameId}
                name={MANUAL_CUSTOMER_NEW_NAME_FIELD}
                // 🔴 nit3:無條件渲染之後,**瀏覽器 autofill 在載入時就填得進去**,
                //    而它不發 `input`/`change` ⇒ 沒選人時那些字會被當成他要建的客人。
                autoComplete='off'
                onKeyDown={onEnter(runCreate)}
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
            </label>
            <label className='block text-sm' htmlFor={newPhoneId}>
              電話
              {/* 🔴 預填他剛剛搜的那支 —— 叫他把同一支電話再打一次,正是這一片要拿掉的動作。
                  `key` 綁著它 ⇒ 換一個搜尋字串時這格會重新掛載並帶新的預設值。

                  🔴🔴 **而 `key` 只綁到他【還沒自己打字】為止**(codex R1 must-fix,2026-08-28)。
                  病(codex 構造出來的):走乙之後這一塊**一開始就在畫面上**
                  ⇒ 員工可以**先**在這裡打新客人乙的電話,**再**去上面搜甲
                  ⇒ 搜尋成功 ⇒ `searchedPhone` 變了 ⇒ **這一格重新掛載**
                  ⇒ **乙的電話被無聲換成甲的,而姓名還是乙。**
                  ⇒ 他按下「建立這位客人」⇒ 系統裡多出一位「乙 + 甲的電話」。
                  📌 形狀:**這個 `key` 在舊形狀底下是安全的 —— 因為那時這一格
                     【搜尋之後才存在】,不可能有他先打好的字。**
                     ⇒ **拿掉那道渲染閘的同時,這個 `key` 的前提就沒了,而它沒有跟著改。**
                     一個安全的設計,在它依賴的那個條件被拿掉之後,長得一模一樣。
                  ⇒ 修法:他一開始打字就把 key 凍住 ⇒ 之後再怎麼搜都不會重新掛載。 */}
              <input
                key={searchedPhone}
                id={newPhoneId}
                name={MANUAL_CUSTOMER_NEW_PHONE_FIELD}
                autoComplete='off'
                onKeyDown={onEnter(runCreate)}
                onChange={() => {
                  createPhoneDirty.current = true;
                }}
                defaultValue={searchedPhone}
                inputMode='tel'
                className='mt-1 block w-full rounded-md border px-2 py-1'
              />
          </label>
        </div>
        <button
          type='button'
          onClick={runCreate}
          disabled={pending || searchBroken !== null}
          className='rounded-md border px-3 py-1 text-sm disabled:opacity-50'
        >
          {pending ? '建立中…' : '建立這位客人'}
        </button>
        {searchBroken !== null && (
          // 🔴 **一種原因一句話,而且【不與上面那個 notice 打架】。**
          //    `denied` 那句刻意**短**:上面的 notice 已經把該說的說完了,
          //    而我這一句若又長又紅,**它會蓋過正確的那一句**(2026-08-28 真瀏覽器量到的正是這個)。
          //    ⇒ 它只補一件 notice 沒說的事:**現在連「建一位」也不行**,並指向同一個動作。
          <p role='status' data-testid='manual-order-new-customer-blocked' className='text-sm text-destructive'>
            {searchBroken === 'denied' ? (
              <>
                登入過期的時候也<strong>建不了</strong>客人。請先重新登入,再回來建。
              </>
            ) : (
              <>
                剛剛那次「找客人」是<strong>壞掉</strong>,不是找不到人。
                這時候建下去,很可能會替一位<strong>本來就有帳號</strong>的客人再開一個
                —— 那種帳號刪不掉,而且他之後登入會看不到自己的單。請先再找一次。
              </>
            )}
          </p>
        )}
        {/* 🔴 ~~原句「地址在下面的『收件資料』填就好,這裡不用。」~~ 2026-08-28 換掉。
            它在乙底下讀起來像「客人不需要地址」,而真相是**客人的地址簿存在而沒有人在寫**
            (`customer_addresses`,見 `lib/orders/manual-order-form.ts` 那段訂正)。
            新句改成**指向那顆「同上」** —— 它要告訴他下一步按哪裡,不是解釋一個設計。 */}
        <p className='text-muted-foreground text-xs'>
          地址填在下面的「收件資料」;那一塊有一顆「同上」,可以把這裡的姓名電話帶過去。
        </p>
      </div>
    </fieldset>
  );
}
