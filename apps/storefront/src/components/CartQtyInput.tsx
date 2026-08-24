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
    const clamped = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QTY) : qty;
    if (Number.isFinite(parsed) && parsed > MAX_QTY) {
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
