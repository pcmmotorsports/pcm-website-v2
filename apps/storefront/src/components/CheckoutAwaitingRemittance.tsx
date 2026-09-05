'use client';

// CheckoutAwaitingRemittance.tsx — ⟦b4-BANKCHARGESCARD⟧ 片 2 ⑤:匯款單已成立 → 立刻導訂單明細頁。
//
// 🔴 **為什麼獨立成檔**:逐字照 `CheckoutRedirecting.tsx` 那一支的兩個理由 ——
//   ① `CheckoutTerminalScreen` 是純 presentational 的分派表, 加 effect 會把副作用混進去;
//   ② **render 期不可副作用** ⇒ 把導向封進本元件的 `useEffect`(可單元測 mock)。
//
// 🔴🔴 **為什麼是【導頁】而不是停在結帳頁給一個連結**(主視窗 2026-09-06 裁):
//   停在結帳頁 ⇒ 客人沒點就重整 ⇒ **單號與連結全部消失**(那個終態活在 React state 裡)。
//   而**明細頁是那份資料的 canonical 落點** —— 它 reload 活得過, 因為單在庫裡。
//   ⇒ 📌 「reload 之後還看得到」這件事**不是靠持久化 state 解的, 是靠【去一個本來就持久的地方】**。
//
// 🔵 **導頁之前先讓客人看到一眼「訂單已成立,等待匯款」** —— 沿用 `CheckoutSuccess` 的
//   `awaiting_remittance` variant(片 2 ④ 落的, `024b204a6`), 不新造畫面。
//   ⚠️ 而那一眼**可能很短** —— 它不是給人讀完的, 是**避免畫面空白一拍**(同 CheckoutRedirecting 的 interstitial)。
//
// 🔴 `router.replace` 不是 `push`:客人**不該用上一頁回到結帳頁** —— 那張單已經建好了,
//   回去只會讓他再送一次。(而「不擋第二張」是被授權的形狀, 不是我們要主動促成的。)
// 🔴 `encodeURIComponent` 不可省:`displayId` 兩種格式並存(6 碼亂碼 / `PCM-YYYY-NNNN`),
//   它是**使用者可見的識別碼、不保證只有 URL-safe 字元**(同 `OrdersTab.tsx:186-192` 的理由;reviewer 2026-09-06 訂正:⛔ ~~`:190`~~ 那是註解中段, `href` 在 `:192`)。

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckoutSuccess } from '@/components/CheckoutSuccess';

export function CheckoutAwaitingRemittance({
  displayId,
  message,
}: {
  displayId: string;
  message: string;
}) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/account/orders/${encodeURIComponent(displayId)}`);
  }, [router, displayId]);

  return <CheckoutSuccess variant="awaiting_remittance" displayId={displayId} message={message} />;
}
