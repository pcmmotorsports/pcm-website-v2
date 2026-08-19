'use client';

import { useEffect, useRef, useState } from 'react';

// auto-apply-submit.tsx — 讓零 JS 的 `<form method='get'>` 篩選列「選了就生效」。
//
// 來由:Sean 2026-08-19 肉眼驗收逐字,同一句話講了兩次(`MAIN-063` C 與 D):
//   「客戶:點選會員等級後,下方列表沒自動跳,還要按篩選」
//   「商品:…點選後下方列表沒自動跳」
// 🔴 **兩頁是同一個缺陷,不是兩件事** —— 兩邊都是 `<form method='get'>` + 一顆送出鈕。
//    而訂單頁**早就沒有這個問題**(`orders/order-filter-controls.tsx` 是 client + `router.replace`)
//    ⇒ 缺的不是做法,是這兩頁沒套上去。
//
// 🔴 **為什麼不照抄訂單頁那一套**:那套把每一軸收進 client state、自己組 URL
//    ⇒ 它自己的檔頭記著「本檔的 `href()` 是**第二個 URL builder**」,漏一個鍵就靜默丟掉一軸,
//    而那條病在那個檔上已經發作過四次。**本元件零 state、零 URL 組裝**:
//    送出的內容完全由瀏覽器序列化那張表單而來 ⇒ **不可能漏鍵**,因為沒有第二份清單。
//
// 🔴 **不用 JS 也要能操作**(`product-taxonomy-filter.tsx` plan §3⑤ 的驗收條件逐字):
//    ⇒ 鈕**照常 server-render**,關掉 JS 就是原本那顆鈕;掛上監聽之後才把自己收起來。
//    ⚠️ 誠實代價:hydration 前後有一幀「鈕在 → 鈕不在」。這是**看得見**的,不是壞掉。
//
// ⚠️ **鍵盤操作的已知代價**(沿用訂單頁既有取捨,不是本片新引入):`<select>` 用上下鍵逐格移動
//    時,Chrome 每一格都會發 `change` ⇒ 每一格都會送一次表單。訂單頁的 `AutoApplySelect`
//    自 M-4a 起就是這個行為。要改得兩頁一起改,不在本片單方面發明第二種。

/**
 * 放在 `<form>` 裡面,取代那顆送出鈕。
 *
 * 監聽的是 **form 上的 `change`**(不是各個 `<select>` 各掛一個):`change` 會冒泡,
 * 所以表單裡新增任何一顆下拉都自動吃到這個行為 —— **不必記得回來加一行**。
 * 🔴 反過來的限制寫在這裡:表單裡若哪天加了 `<input type='text'>`,它 blur 時也會發 `change`
 *    ⇒ 會送出。目前兩個呼叫端的關鍵字搜尋都是**各自獨立的 form**(客戶側還是 POST + cookie),
 *    不在這張表單裡。要加文字欄位進來的人,先讀這一段。
 */
export function AutoApplySubmit({ label, className }: { label: string; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  // false = 還沒掛上監聽(含關掉 JS 的情況)⇒ 鈕一定看得見,那是唯一的出口。
  const [autoApplying, setAutoApplying] = useState(false);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const submit = () => {
      form.requestSubmit();
    };
    form.addEventListener('change', submit);
    setAutoApplying(true);
    return () => {
      form.removeEventListener('change', submit);
    };
  }, []);

  return (
    <button ref={ref} type='submit' hidden={autoApplying} className={className}>
      {label}
    </button>
  );
}
