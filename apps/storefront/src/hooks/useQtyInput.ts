// useQtyInput.ts — 商品頁「數量」輸入的狀態機(#888 由 ProductInfo.tsx 搬出)
//
// 🔴 為什麼搬出來(理由與行數無關):它是一台自足的輸入狀態機,而且**帶一個要清的
//   `setTimeout`** —— 卸載沒清就是洩漏。留在 400 行的元件裡,那個 cleanup 很容易在下次
//   改動時被連帶弄掉。
// 🔴 而碼裡本來就記著一筆債(下方 `commitQty` 的行內註解):
//   「nit:字面住共用層,與 CartQtyInput 唸同一句」—— **同一句提示文字有兩個消費端**,
//   抽成 hook 之後才有一個地方可以收斂它。
// 🔴 下方內容自 ProductInfo.tsx L85-111 **逐字搬移**(sed/python 抽出、未重打),只加了
//   函式外殼與 return。承重註解(OD-4a / W11-019 B1 / §5 表 row 3、row 5)一起搬。
//
// ⚠️ **刻意留在元件裡的**:`product` 變更時 reset qty 的那個 `useEffect`。
//   搬它會改變 effect 的執行順序,而那是行為面的風險 ⇒ 本 hook 只吐 `resetQty`,
//   由元件自己決定何時呼叫(#888 刀C 的保守選擇)。

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_QTY, QTY_CAP_NOTICE } from '@/contexts/CartContext';

export function useQtyInput() {
  // OD-4a:selectedVariant 提升 ProductPage(props 受控)、本元件只持 qty local
  //   (~~liked~~ 2026-08-18 起在 FavoritesContext,不再是本元件的 state)。
  //   product 變更時 selectedVariant reset 由 ProductPage 統一處理(gallery 同步換圖);本處只 reset qty。
  const [qty, setQty] = useState<number>(1);
  // W11-019 B1:數量改可鍵盤輸入。qtyText 是輸入框顯示用的自由文字(打到一半允許空/半形數字),
  //   qty 才是算價/加購真正吃的值 —— 兩者分開,失焦才把 qtyText 收斂寫回 qty(§5 表 row 5)。
  const [qtyText, setQtyText] = useState('1');
  // 夾到上限時的一次性提示(§5 表 row 3:夾值要「明說」、不能像既有 bug 那樣靜默夾)。
  const [qtyNotice, setQtyNotice] = useState<string | null>(null);
  const qtyNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setQtyText(String(qty));
  }, [qty]);
  useEffect(() => () => {
    if (qtyNoticeTimer.current) clearTimeout(qtyNoticeTimer.current);
  }, []);
  const commitQty = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    // 🔴 **`: qty` 不是 `: 1`** —— 清空輸入框再失焦, 那一列曾經【從 8 件直接變 1 件, 零提示】。
    //   機制:`Number.parseInt('')` ⇒ `NaN` ⇒ `Number.isFinite(NaN)` ⇒ false ⇒ 走三元的 else。
    //   舊的 else 是常數 `1`, 而 `1` 是一個**看起來很合理的預設值** —— 那正是它活這麼久的原因:
    //   在客人只買 1 件的時候, 對的行為與錯的行為**印出同一個數字**。
    //
    //   🔴 **這一行同時是 `#886` flaky 的判別實驗**(主視窗 2026-08-24 裁定):
    //     線C 的兩個假說對 `updateQty(item, 1)` 這個指紋是**同一個結果**, 分不出來 ——
    //       r3  React value tracker 脫鉤 ⇒ onChange 被吞 ⇒ state 本來就是 '1', **不經過這一行**
    //       r4  失焦當下框是空的         ⇒ 走這一行 ⇒ 舊碼吐 1
    //     ⇒ 改成 `qty` 之後, r4 那條路**不再吐 1**(它吐當下的 qty)⇒ 兩個世界從此印不同的東西:
    //       **flaky 消失 ⇒ 成因是 r4;flaky 還在 ⇒ 成因是 r3。**
    //   ⚠️ **而這個實驗只有在有人回來看結果時才成立** —— 沒人看的話它就只是一個修好了的 bug。
    //   🔴🔴 **2026-08-29 線F:那一發紅被抓到了, 而答案是 `r4`。而【上面那條判準本身失效】。**
    //     證據(vitest 失敗訊息逐字):`#886 診斷:input.value="1"` · `Number of calls: 1` · 送出值 `1`
    //     對線C 的五格指紋表(`~/pcm-mailbox/線C-交件-886探針結果-20260824.md` §2):
    //       `calls=1` 排掉 r1/r2;`input.value="1"`(**不是 `"150"`**)排掉 r3 ⇒ **只剩 r4, 唯一。**
    //     完整證物 `~/pcm-mailbox/線F-證物-886那一發紅的完整log-20260829.txt`(**不要刪**)。
    //
    //   🔴 **而上面那句「flaky 還在 ⇒ 成因是 r3」對【那一格】是錯的, 照它推會去修錯的東西**:
    //     那格測試的 fixture 是 `CartView.test.tsx` 錨 `打 >99 失焦` 那個 `it` ⇒ 它用 **`qty: 1`**
    //     ⇒ r4 走 `: qty` 而 `qty` 就是 1 ⇒ **它照樣吐 1** ⇒「改成 qty」對那一格什麼都沒改變
    //     ⇒ **「flaky 還在」推不出 r3。**
    //   📌 **判別句:一個「改了值就能分辨」的實驗, 在【那個值恰好等於預設值】的測試上,**
    //     **兩個世界仍然印同一個數字。**
    //   ✅ **而真正把它分開的不是這個實驗, 是那條 assert 的第二參數**(失敗時印 `input.value`)——
    //     **越依賴前提的量具, 越容易在某個前提悄悄不成立時, 安靜地給出錯答案。**
    //   ⚠️ **而【另一格】才是這個實驗有判別力的地方, 而 flaky 沒有發生在那裡**:
    //     同檔錨 `打 0 失焦` 那個 `it` 用 `qty: 3` 且期望 `1` ⇒ r4 會吐 `qty`=3 ⇒ **紅**;
    //     🔴 而**舊碼 `: 1` 之下 r4 在那一格會吐 1 = 期望值 ⇒ 【綠】** ——
    //     ⇒ 改成 `: qty` 讓**那一格**變得抓得到 r4, 卻讓 `qty: 1` 那一格**完全沒變**。
    //     📌 **同一個改動, 對兩個相鄰的格子做了完全相反的事, 而註解只描述了其中一格。**
    //   ⚠️ **重現失敗要照實記**(2026-08-29 線F):兩格在低負載下**都重現不出來** ——
    //     五檔同跑 42 發 0 紅(其中 9 發是我自己開三個 vitest 併行製造競爭)。
    //     而那 2 發紅發生在**八個窗都在跑重活**的時候。
    //     ⇒ **「多開幾個 vitest 併行」不是觸發條件, 或至少不足以觸發** —— 這是負面資訊, 留著省下一輪。
    //   ⏳ **怎麼修還沒拍板**(它動購物車數量⇒金額 = 鐵則 12 ①, 要 plan + codex):
    //     四個選項與推薦在 `~/pcm-mailbox/線F-交件-886結案是r4不是r3-20260829.md` 檔尾。**本片只落事實, 不改行為。**
    const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QTY) : qty;
    if (Number.isFinite(parsed) && parsed > MAX_QTY) {
      setQtyNotice(QTY_CAP_NOTICE); // nit:字面住共用層,與 CartQtyInput 唸同一句
      if (qtyNoticeTimer.current) clearTimeout(qtyNoticeTimer.current);
      qtyNoticeTimer.current = setTimeout(() => setQtyNotice(null), 2500);
    }
    setQty(clamped);
    setQtyText(String(clamped));
  };
  // 🔴 `useCallback` 不是為了效能, 是為了【身分穩定】:
  //   呼叫端要把它放進 useEffect 的 deps(lint react-hooks/exhaustive-deps 要求),
  //   而每次 render 都是新函式的話, 那個 effect 會每次都跑 ⇒ 數量被無限重設回 1。
  const resetQty = useCallback(() => setQty(1), []);
  return { qty, qtyText, setQtyText, qtyNotice, commitQty, resetQty };
}
