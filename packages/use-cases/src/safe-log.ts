// safe-log.ts — use-cases 內部用的「印 log 永遠不改變控制流」(稽核 P2-6、2026-09-15;不從 index 外露)
//
// 🔴 為什麼不直接 import storefront 那支 `apps/storefront/src/lib/safe-log.ts`(#900 的 safeLog):
//   本 package 只依賴 `@pcm/domain` / `@pcm/ports`(見 package.json)⇒ 反過來 import app 會破依賴方向。
//   🔎 動手前查過 packages/use-cases、ports、domain:沒有現成的 logger port 或 try/catch 包裝可用
//     (`settle-charge.ts` 的 bestEffort* 是各自專用的寫入,不是通用 log)。
//
// 🔴 為什麼另寫一份不會踩到 storefront 那支檔頭警告的 drift:
//   那段警告的對象是 `safeErrorName` 的【白名單】—— 兩份白名單 drift 的方向是「多印一點東西」。
//   本檔【只有 try/catch 包裝、沒有白名單】⇒ 不管兩份怎麼長歪,都不會多印任何欄位;
//   要印什麼仍由呼叫端逐欄決定(與原本的 console.error 呼叫逐字相同)。
//
// 🔴 存在理由(同 #900 codex R1 findings 1/2):**一個 catch 區塊裡的任何新語句,都在那個 catch 的保護範圍外面。**
//   use-cases 裡寫在 catch 內的 console.error 自己拋 ⇒ 逃出那個 catch:
//     · confirm-payment 收斂補記那處 ⇒ 被外層 confirm 的 catch 接住 ⇒ 已 paid 的單回 orphan
//     · confirm-payment 麵包屑那處 ⇒ 已扣款後整個 throw ⇒ action 外層 generic catch ⇒ 客人重按 ⇒ 雙扣形狀
//   ⇒ 射程:保證「console 本身拋也不改回傳」,**不**保證 log 一定出得來(沒有地方可以記「印失敗」)。
//   ⚠️ 射程的另一半(adversarial-reviewer 2026-09-15 N1):`fields` 物件在【呼叫 safeLog 之前】就求值,
//     不在這個 try 裡 ⇒ 呼叫端若在欄位裡讀一個會拋的 getter(例如 `(err as {code?})?.code`),那一拋仍會逃出 catch。
//     今天兩處這樣寫的呼叫端(confirm-payment 麵包屑 / initiate-payment rec)的 err 都是本 repo adapter 自造的 Error,
//     讀 `.code` 不會拋 ⇒ 正式站碰不到;改動前就是這個寫法。要收掉就把取值包進一個不會拋的小函式。

export function safeLog(
  level: 'info' | 'error',
  message: string,
  fields: Record<string, unknown>,
): void {
  try {
    console[level](message, fields);
  } catch {
    // 印不出來就算了。這支函式存在的唯一理由就是這一行的空。
  }
}
