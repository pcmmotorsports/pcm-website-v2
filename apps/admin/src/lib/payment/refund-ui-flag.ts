// refund-ui-flag.ts — M-3 A7c RW2d:退款入口啟用旗標的**單一判準**(fable F3/F4「機制不靠口頭」)。
//
// 🔴 兩個消費端必須讀同一個函式,不得各自比字面:
//   ① `refund-actions.ts` 步 ②(server 閘 —— 「UI 不顯示」擋不住直接 POST action)
//   ② `orders/[id]/page.tsx` → `order-detail.tsx`(顯示面 —— 同一旗標決定入口渲不渲染)
//   分兩份字面的失效模式:一邊認 '1' 一邊認 'true' ⇒ 「畫面看得到、按下去永遠 disabled」
//   或反過來「畫面沒入口、旗標其實開著」—— 兩種都是值班排不出因的死巷。
//
// 🔴 預設 off、恰 '1' 才開;開啟前置 = RW4 收工 且 部分退 E2E 綠(plan §1 RW2d 列)。
//   admin production 追 dev ⇒ 推 dev 即上線 —— 本旗標**不進任何會部署的設定**,
//   dev/本機驗證用 env 開(`REFUND_UI_ENABLED=1`)。
//
// server-only 環境變數、非 NEXT_PUBLIC ⇒ server 端靜態讀=runtime 值,無 build-time 內聯問題。
//
// ⚠️ 本檔**刻意不掛** `import 'server-only'`(與 composition.ts 不同):
//   ① 旗標不是機密,只是開關;client bundle 誤 import 時非 NEXT_PUBLIC env = undefined
//     ⇒ 恆 false = 入口隱藏 = **fail-closed 方向**,不存在誤開面。
//   ② 頁層接線測試(refund-wiring.test.tsx)必須真載 page.tsx 量「env → 入口渲染」整條鏈
//     —— 那正是 F3/F4 要的機制驗證;掛 server-only 會讓 jsdom 頁層測試(含既有
//     procurement-wiring)整族解析失敗,等於用一個裝飾換掉一條真驗證。
export function isRefundUiEnabled(): boolean {
  return process.env.REFUND_UI_ENABLED === '1';
}
