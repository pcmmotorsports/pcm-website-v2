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
  // 🔴🔴 **⟦02-CARTQTYFLAKE4⟧ 的根因就在這三行。**
  //   ⛔ ~~`useEffect(() => { setQtyText(String(qty)); }, [qty])`~~
  //   🔬 **兩個方向都量過**(harness = `CartQtyFlake.harness.test.tsx`, 讀數可重跑;jsdom):
  //     ① 把 deps 拿掉(= 每次 render 後都跑)⇒ **40/40 全中**。
  //        指紋 `派發當下 input.value="150"` → `change 回來後 "3"` → blur 送出 **3**
  //        ⇒ **在線上那五個樣本量過的三格上**(`calls` / 送出值 / blur 後 `input.value`)逐字相同
  //        ——「派發當下」那一格是本 harness 才生出來的, 舊樣本沒有它, 不宣稱那一格也對得上。
  //     ② 留著 `[qty]`(= 只有掛載那一發)⇒ 800 發 **5 發**(0.6%)、500 發 **3 發**, 同一個指紋。
  //     ③ 換成下面這個形狀 ⇒ **2000 發 0 中**(load average 兩邊都是 70~80)。
  //     ④ **`onChange` 到底有沒有跑?量了。**(codex 2026-09-05 must-fix:我原本只證明了
  //        「setter 寫進去 150」, 沒證明 synthetic `onChange` 執行過, 也就沒排除
  //        「onChange 被吞 + React controlled-input restore 把值還原」那個世界。)
  //        做法:暫時在 `onChange` 裡記一個計數與收到的字, 舊版碼跑 1200 發。
  //        🔬 讀數:**壞的 10 發【每一發】都是 `onChange 跑了 1 次 收到 "150"`。**
  //        ⇒ 🎯 **那個替代解釋被讀數推翻** —— `setQtyText('150')` 確實執行了,
  //           而 blur 之前唯一還會寫 `qtyText` 的只剩這個 effect(`commit` 要 blur 才跑)。
  //        ⚠️ 探針是暫時的, **現在的碼裡沒有它**;要重量就照這段再掛一次。
  //   🎯 **機制**:passive effect 是被**排程**的, 不保證在 `findByText` 回來前跑完;
  //      負載高時被延到下一個 act 裡 ⇒ 順序變成
  //      「onChange 把 state 寫成 '150'」(④量到)→「那一發 effect 補跑, `setQtyText(String(qty))` 寫回 '3'」
  //      ⇒ re-render 把 `value={qtyText}` 蓋回 DOM。
  //      ⚠️ 仍未直接量到的只剩一格:**被延後的是不是【掛載】那一發**(①證明的是「這個 effect
  //      覆寫得出這個指紋」)。結論不靠那一格, 它靠 ①②③④ 四個讀數。
  //   🛑 **不要把它寫成「客人被吃字」** —— 讀數全在 jsdom, **瀏覽器可達性未確認**;
  //      而瀏覽器裡真的到得了的那個世界是「打字中 `qty` prop 變了」, 而**那個世界新舊兩版行為相同**
  //      (code-reviewer 2026-09-05 逐一比五個世界的結論)。⇒ 本片修的是**競態本身與那格 flake**,
  //      不是一個已證實的客訴。⚠️ 而加 retry 仍然不對:那是把讀數藏起來, 不是把競態關掉。
  //   ✅ 修法 = React 官方的「props 變了就在 render 當下調整 state」形狀(不是 effect):
  //      它在 render 階段跑 ⇒ **沒有「晚一步」這個狀態**, 也就沒有那個競態。
  //   ⚠️ **行為等價**(五個世界逐一比過:掛載 / `qty` 真的變 / 打字中 `qty` 變 / 夾到 99 而父層沒更新 /
  //      re-mount ⇒ 全部相同)。掛載時 `useState(String(qty))` 已經初始化好,
  //      **`qty` 未變時**那一發 effect 寫的是同一個值(⚠️ 而 flake 那幾發它寫的是**舊值**——
  //      那正是本片要修的東西, 不要把這句讀成「它從來沒有作用」)。
  //   🔴 **比較用 `Object.is` 不是 `!==`**(codex 2026-09-05 nit):`qty` 若是 `NaN`,
  //      `NaN !== NaN` 恆真 ⇒ **每次 render 都重設 state ⇒ 無限重跑**。而舊版的 `useEffect([qty])`
  //      用的就是 `Object.is`(React 的 deps 比較)⇒ 它對 `NaN` 是安全的。
  //      ⇒ 📌 **換形狀的時候, 把被換掉那個機制【內建的比較語意】一起換過來, 否則它會靜靜掉一格。**
  const [prevQty, setPrevQty] = useState(qty);
  if (!Object.is(qty, prevQty)) {
    setPrevQty(qty);
    setQtyText(String(qty));
  }
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
