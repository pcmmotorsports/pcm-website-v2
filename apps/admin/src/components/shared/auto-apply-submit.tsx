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
// 🔴🔴 **鍵盤操作的代價:觸發相同,而後果【不同】——「沿用訂單頁既有取捨」那句話是錯的,已撤**
//    (W6 `W6-046` M1 抓到;~~原句「沿用訂單頁既有取捨,不是本片新引入」~~ 作廢):
//      訂單頁 `order-filter-controls.tsx` 的 `apply()` → `router.replace(href, { scroll: false })`
//        ⇒ **不重載**、焦點還在那顆 select 上、捲軸不動
//      本元件            → `form.requestSubmit()` 於 `<form method='get'>`
//        ⇒ **整頁導航**、焦點回 document、捲軸回頂
//    ⇒ 鍵盤使用者用方向鍵掃過**關閉狀態**的 `<select>` 時,訂單頁是「網址閃一下」,
//      這兩頁是「**每按一次重載一次整頁**」。那不是同一個代價。
//    ⚠️ 逃生路徑存在:`Alt+↓` 展開後在彈出層內移動**不發** `change`,選定才發一次。
//    📌 主視窗 2026-08-19 已裁:**本片不改**(理由:沒有人量過這條 / 逃生路徑存在 /
//       改它會動到互動模型,不是這片的體積)。⇒ 現況照實寫在這裡,
//       **不要再寫成「已經評估過」** —— 被評估過的是另一件事。追蹤 = backlog `#673`。
//    🔴 **可跑的檢查(答「這條代價還在不在」,不是「有沒有人記得回來看」)**:
//         grep -c '^ *form\.requestSubmit()' apps/admin/src/components/shared/auto-apply-submit.tsx
//       ⇒ **1 = 還是整頁導航,這一整段仍然成立**(`#673` 還沒被做掉)。
//       ⇒ **0 = 有人把它改成 client 端導航了** ⇒ 這一段連同 `#673` 一起作廢,回來刪。
//       🔴 **行首錨(`^ *`)不是講究,是我第一版寫錯了**:不帶錨的 `grep -c 'requestSubmit'`
//          當場回 **3** —— 因為**這段說明自己就含著那個字面**。尺撞到了講述它自己的文本,
//          而它回的是一個看起來很合理的數字。⇒ 這一族的判別句:**我的錨排除得掉註解嗎?**
//    ⚠️ 而「按一次方向鍵重載一次整頁」**至今沒有人量過** —— W6 讀 code 判、我在網址層
//       證實了整頁導航,兩邊都是**推的**。要拿它跟 Sean 講話,得先真的去量。
//
// 🔴 **本元件依賴一個不在本檔裡的東西(W6 `W6-046` 攻擊 #1 的結論)**:
//    「送出內容由瀏覽器序列化整張 form 而來 ⇒ 不可能漏鍵」為真,但**擋住「不相容的一對」的
//    不是這個性質** —— 是 `lib/products/product-list-view.ts` 的
//    `resolveCategoryPath()`(`sub.startsWith(top + SEP) ? sub : top`)。
//    場景:大類換成 B、而子分類下拉還停在 A 的子類 ⇒ 兩顆都會被送出。
//    手動鈕的時代使用者還有「先改回全部再按」的窗口,**自動送出把那個窗口拿掉了**。
//    ⇒ 🔴 **那道防禦被拿掉時,壞掉的是這一片,而它不在這個檔裡。** 動那支 parser 前先讀這段。

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
