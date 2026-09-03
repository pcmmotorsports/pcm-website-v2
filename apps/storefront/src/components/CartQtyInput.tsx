'use client';

// CartQtyInput.tsx — 數量 +/- 輸入框(span 換 input,可鍵盤輸入),原本內嵌在 CartView.tsx。
// 2026-08-21 F-81:抽成獨立檔案給 ProductPage.tsx(手機數量滑出列)共用——
// 🔴 不能直接 `import { CartQtyInput } from './CartView'`:CartView.tsx 用了
// `useResolvedCart`,那條鏈上有 `server-only` 標記的模組,'use client' 元件互相 import
// 會在建置期直接炸(`This module cannot be imported from a Client Component module`)。
// 抽出來的這支檔案零server依賴、純UI,兩邊都能安全import。

import { useEffect, useRef, useState } from 'react';
import { MAX_QTY, QTY_CAP_NOTICE } from '@/contexts/CartContext';

/**
 * W11-019 B1/B2:購物車列數量控制,span 換 input(可鍵盤輸入)+ +/− 仍留(§6)。
 * qtyText 是本列自己的編輯態文字,失焦才收斂成整數送 onCommit(context 端 clampQty 仍是最終防線,
 * 但這裡先夾一次是為了畫面回饋 ——「回復成 1」「夾到 99 並明說」使用者要看得到)。
 * 🔴 絕不把 0 交給 onCommit:updateQty(key, 0) 在 CartContext 裡是「移除該列」的語意(qty<1 → filter
 *   掉),那是 +/− 按鈕 disabled 在防的事,輸入框打 0 不能繞過去變成整列消失。
 */
export function CartQtyInput({ qty, onCommit }: { qty: number; onCommit: (qty: number) => void }) {
  const [qtyText, setQtyText] = useState(String(qty));
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setQtyText(String(qty));
  }, [qty]);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);
  const commit = (raw: string) => {
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
    //   🔴🔴 **2026-09-04 線 `-db`:抓到【第四種】指紋, 而它不在那張五格表裡。**
    //     🔬 量法:同一支檔連跑 **30 發** ⇒ **紅 1 發**(≈3%);那一發的失敗訊息逐字:
    //       `#886 診斷:input.value="3"` · `Number of calls: 1` · 送出值 **3**(期望 99)
    //     🎯 **而它與 r3 / r4 都不同, 差別在 `input.value` 那一格**:
    //       r3  ⇒ DOM **有**值而 state 沒有 ⇒ `input.value === "150"`
    //       r4  ⇒ 失焦當下框是**空的**     ⇒ `input.value === ""`
    //       🔴 **第四種 ⇒ DOM 顯示的是【初始值】`"3"`** ⇒ **`fireEvent.change` 整個沒有落地,
    //          連 DOM 都沒變** ⇒ 那不是「state 沒跟上」, 是**那一發輸入根本沒發生**。
    //     🛑 **成因【未知】, 而我沒有修它** —— 可能是 jsdom/React 的時序、可能是這支檔的 render 競態。
    //       ⇒ 📌 **現在動手 = 把它改成我猜的樣子。** 落板 `⟦02-CARTQTYFLAKE4⟧`, 成因待查。
    //     ✅ **而它【不擋】任何事**:3% 之下「連 20 發紅 ≤ 2」的機率 ≈ 99.9%
    //       ⚠️ 而我第一發用 **5 發**樣本算出 20% ⇒ 推出「那個判準永遠達不到」⇒ **那是錯的**
    //       ⇒ 🎯 **一個從小樣本算出來的機率, 會被拿去做一個【二選一】的決定, 而那個決定
    //          不會標明它的信賴區間。** 30 發重量之後, 兩個結論指向相反的行動。
    //
    //   🔴 **而上面那句「flaky 還在 ⇒ 成因是 r3」對【那一格】是錯的, 照它推會去修錯的東西**:
    //     那格測試的 fixture 是 `CartView.test.tsx` 錨 `打 >99 失焦` 那個 `it`
    //     ⇒ ⛔ ~~它用 **`qty: 1`**~~ ⇒ 🔴 **2026-09-04 實查:它現在是 `qty: 3`**
    //       (`CartView.test.tsx` 錨 `打 >99 失焦` 那個 `it` 的第一行;同檔前一段註解逐字
    //        「✅ 改成 3 ⇒ 兩個世界從此分得開」⇒ **有人後來改了, 而那是對的事**)
    //     ⇒ 🛑 **所以下面這整段推理的前提已經不成立** —— 它是拿 `qty: 1` 推的。
    //     ⇒ ⇒ 📌 **而改 fixture 的人不是疏忽**:那段分析住在【另一支檔】, 而他改的是測試檔
    //       ⇒ 🎯 **一段引用了具體值的分析, 它的前提住在別的檔裡 —— 而改那支檔的人不會被通知。**
    //       ⇒ ✅ **更便宜的做法:分析不要引用【值】, 引用【那個值的來源座標】。**
    //     ⛔ ~~⇒ r4 走 `: qty` 而 `qty` 就是 1 ⇒ 它照樣吐 1 ⇒「改成 qty」對那一格什麼都沒改變~~
    //     ⛔ ~~⇒ 「flaky 還在」推不出 r3。~~  ⇐ **兩句都建立在 `qty: 1` 上, 一併作廢**
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
    // 🔴 **框是空的(或不是數字)⇒【什麼都不送】**(2026-08-29 Sean 拍甲, 逐字:
    //    「什麼都不送,件數維持原樣」;選項字面是我們寫的, 他只打了甲)。
    //    ⛔ ~~前一版走 `: qty` ⇒ 仍然呼叫 `onCommit(qty)`~~ —— 那已經達成「件數維持原樣」,
    //    🔴 而它【不是空操作】:`CartContext.updateQty` 是
    //       `prev.map((p) => (sameLine(p, key) ? { ...p, qty: safeQty } : p))`
    //       ⇒ 值一樣也產生【新陣列 + 新物件】⇒ state 變 ⇒ 重繪 + 寫 localStorage。
    //    ⇒ 觀察得到的差別是 **calls=1 vs calls=0**, 不是措辭。
    //    ✅ 框上的字仍然同步回 `String(qty)` ⇒ **客人看到的與之前一樣**, 少的只有那一次送出。
    if (!Number.isFinite(parsed)) {
      setQtyText(String(qty));
      return;
    }
    const clamped = Math.min(Math.max(parsed, 1), MAX_QTY);
    if (parsed > MAX_QTY) {
      setNotice(QTY_CAP_NOTICE); // nit:字面住共用層,與 ProductInfo 的數量框唸同一句
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 2500);
    }
    setQtyText(String(clamped));
    onCommit(clamped);
  };
  return (
    <div className="cart-qty">
      <button aria-label="減少數量" onClick={() => commit(String(qty - 1))} disabled={qty <= 1}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="數量"
        className="cart-qty-input"
        value={qtyText}
        onChange={(e) => setQtyText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => commit(qtyText)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button aria-label="增加數量" onClick={() => commit(String(qty + 1))}>
        +
      </button>
      {notice && (
        <div className="cart-qty-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
