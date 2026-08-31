import type { SettingsResultMessages } from '@/components/settings/settings-result-banner';

// dead-letter-messages.ts — ⟦b4-MAILDEAD⟧ 結果碼 ⇒ 畫面文字。
// 🔴 與 action 分檔:`'use server'` 的檔**只能 export async function**,
//    常數放進去 typecheck 不紅、`next build` 才紅(本 repo 記過的一格)。
// 🔴 形狀對齊 `SettingsResultBanner` 的 `SettingsResultMessages`(它刻意沒有預設碼表,
//    漏帶 = 編譯期報錯,不會靜默套到一份沒人維護的詞彙上)。

export type DeadLetterResultCode =
  | 'requeued'
  | 'denied'
  | 'invalid'
  | 'audit_failed'
  | 'notfound'
  | 'rejected'
  | 'error';

export const DEAD_LETTER_RESULT_MESSAGES: SettingsResultMessages = {
  requeued: { text: '已重新排入寄送佇列,下一輪掃描會再試一次。', tone: 'ok' },
  denied: { text: '只有管理者可以重排死信。', tone: 'warn' },
  invalid: { text: '沒有指定要重排哪一封。', tone: 'warn' },
  // 🔴 這一句要說出【重排沒有發生】—— 那正是本片 fail-closed 與既有慣例
  //    (`staff-actions.ts:86`「員工變更已生效」)相反的地方,而使用者看得到的只有這句話。
  audit_failed: { text: '稽核紀錄寫入失敗,因此這封信【沒有】被重排。請稍後再試一次。', tone: 'error' },
  notfound: { text: '找不到那一封信,它可能已經被重排或狀態改變了。', tone: 'warn' },
  rejected: { text: '那一封信目前的狀態不允許重排(只認尚未寄出、且重試次數已用完的信)。', tone: 'warn' },
  error: { text: '重排失敗,請看伺服器記錄。', tone: 'error' },
};
