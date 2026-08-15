// audit-ui-flag.ts — `#27` D1:稽核紀錄檢視入口的**單一判準**。
//
// 形狀**逐字抄** `lib/payment/refund-ui-flag.ts`(M-3 A7c RW2d,fable F3/F4「機制不靠口頭」),
// 不自己發明第二套慣例 —— 兩份字面的失效模式該檔 `:6-7` 已經寫過一次,不重複踩。
//
// ── 🔴 這支旗標為什麼存在(**不是為了漸進發布,是為了擋一個順序**)──────────
//   `20260815020000`(D0)**已 commit、尚未 apply**,而 apply **只有 Sean 能做**。
//   🔴 **admin 正式站追 `dev`** —— Sean push dev 即上線(`project_pcm-admin-production-tracks-dev`)。
//   ⇒ **若他先 push 再 apply**,檢視頁一上線,員工點進去就是 `42501 permission denied`。
//   ⚠️ 那正是 `feedback_app-layer-must-not-ship-before-migration-apply` 記的事故形狀
//      (2026-08-07 A9h 正式站壞約 8 小時,而該條逐字寫它是**當夜唯一逃逸出審查鏈的一條** ——
//       **審查看不到它**:單測 mock 掉 rpc、hook 看不到 deploy。**只有順序能擋。**)
//   ⇒ 決策單裡寫了「先 apply 再 push」,**但那是請求不是機制**。**這支旗標才是機制。**
//
// ── 🔴 開啟前置(兩條都要,缺一不得開)────────────────────────────
//   ① `20260815020000` **已 apply**;
//   ② **已驗證過它生效**(不是「應該 apply 了」)——
//      最省事的驗法 = `bash scripts/27-d0-verify.sh` 對該環境跑一次(該支全檔冪等、可重跑當漂移探針),
//      或直接確認 apply 當下印出的那三行 `【要回報】…目前繼承的角色 = …` 有被收下。
//
// 🔴 預設 off、**恰 `'1'`** 才開。**本旗標不進任何會部署的設定**;dev / 本機用 env 開。
// 🔴 消費端必須讀這個函式、不得各自比字面(兩處:sidebar 那一列、`/settings/audit` 頁本體)。
//    ⚠️ **頁本體也要擋** —— 只擋選單的話,**直接打網址照樣進得去**,那不是「到不了」。
//
// server-only 環境變數、非 `NEXT_PUBLIC` ⇒ server 端靜態讀 = runtime 值,無 build-time 內聯問題。
// ⚠️ 刻意**不掛** `import 'server-only'`(同 refund-ui-flag `:15-20` 的理由):
//   client bundle 誤 import 時非 NEXT_PUBLIC env = `undefined` ⇒ 恆 false = 入口隱藏 = **fail-closed 方向**;
//   且頁層接線測試要能真載頁面量「env → 入口渲染」整條鏈,掛 server-only 會讓 jsdom 頁層測試整族解析失敗。
export function isAuditUiEnabled(): boolean {
  return process.env.AUDIT_UI_ENABLED === '1';
}
