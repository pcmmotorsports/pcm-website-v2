import { WalletAdjustFormClient } from './wallet-adjust-form-client';

// M-4a 儲值金編輯:明細頁儲值金卡內的調整表單。
// Sean 拍板 Q1=B:「加值」「扣款」兩顆 submit(name=direction 定方向)+ 金額恆收正整數(server 轉號)
// + 備註必填;允許扣成負餘額(RPC 無下界擋)。Q2=A:本片不 step-up。
// E11-2:欄位外框與版面已改用共用 <AdminForm> 卡片內嵌變體。
//
// ══ 🔴 這一支現在只做一件事:**發 token** ══════════════════════════════════
// ⟦b4-WALLETDEDUPE⟧ 2026-09-06。表單本體搬去 `wallet-adjust-form-client.tsx`(那支要 `useActionState`)。
// 🛑 **為什麼要拆成兩支**:token **必須由 server 產**(A6 §9 `Q2=C`,Sean 2026-08-02 拍板)——
//    放在 client component 裡呼叫 `crypto.randomUUID()` 就變成「瀏覽器自造」,正是那條拍板拒絕的形狀。
//    ⇒ 📌 這個 server / client 邊界**就是那條拍板本身**,不是檔案整理的偏好。
//
// ⛔ ~~舊註解:「double-submit … DB 級 UNIQUE 去重=schema 改動、D1 決策題待 Sean」~~
//    **2026-09-06 已做**:`20260906800000` 加了 partial UNIQUE + 查驗式冪等;
//    Sean 逐字「甲=上線前必修」。backlog `#279` 那個「用 request_id 當去重鍵」的舊解法**擋不到**
//    back-resubmit(每個 HTTP request 一個新 id)⇒ 已作廢,見板列 ⟦b4-WALLETDEDUPE⟧。

export function WalletAdjustForm({ customerId }: { customerId: string }) {
  // 🔴 **每次 server 渲染產一把新的** —— 這是「開始一次新操作」的意思。
  //    而**失敗之後的重試不會走到這裡**:那一發用的是 client 端 state 帶回的原 token
  //    (見 `wallet-adjust-form-client.tsx` 的 `requestToken`)。
  const serverToken = crypto.randomUUID();
  return <WalletAdjustFormClient customerId={customerId} serverToken={serverToken} />;
}
