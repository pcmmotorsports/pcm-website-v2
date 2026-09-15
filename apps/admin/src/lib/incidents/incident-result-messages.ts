import type { SettingsResultMessages } from '../../components/settings/settings-result-banner';

// incident-result-messages.ts — 事故紀錄頁 `?r=<code>` 的員工可讀文案 + 表單欄位名
// 🔴 結果碼與欄位名的單一來源在本檔:`incident-actions.ts` 帶 `'use server'`,只能匯出 async function
//    (同 `supplier-result-messages.ts` 的安排)。

export const INCIDENT_FIELD = {
  id: 'incident_id',
  note: 'note',
  reason: 'reason',
  /** 只認 `all`:按完導回「全部」檢視;其他任何值 ⇒ 導回「未處理」 */
  view: 'view',
} as const;

/** 說明 / 原因上限,與 DB `v_note_max` / `v_reason_max` 同值(20260916080000) */
export const INCIDENT_TEXT_MAX = 500;

export type IncidentResultCode =
  | 'resolved'
  | 'already'
  | 'reopened'
  | 'already_open'
  | 'superseded'
  | 'notfound'
  | 'invalid'
  | 'reason_required'
  | 'denied'
  | 'error';

/** `satisfies Record<IncidentResultCode, …>`:少一個碼或多一個碼都 typecheck 紅。 */
export const INCIDENT_RESULT_MESSAGES = {
  resolved: { text: '已標記為已處理,這一筆不再算進告警。問題還在的話,有些種類系統下一次碰到會再記一筆。', tone: 'ok' },
  already: { text: '這一筆已經是已處理了(可能剛被別人按過),沒有重複記錄。', tone: 'ok' },
  reopened: { text: '已取消「已處理」,這一筆回到未處理,會重新算進告警。', tone: 'ok' },
  already_open: { text: '這一筆本來就是未處理,沒有變動。', tone: 'ok' },
  // Sean 2026-09-15 Q3 甲:「如果系統已經又記了一筆新的, 就不讓取消」
  superseded: { text: '沒有取消:系統在這一筆之後已經又記了同一件事的新紀錄,請去看那一筆新的。', tone: 'warn' },
  notfound: { text: '找不到這一筆事故,沒有變動。', tone: 'warn' },
  invalid: { text: `送出的內容格式不對(最多 ${INCIDENT_TEXT_MAX} 字、不可含換行或控制字元),沒有變動。`, tone: 'warn' },
  reason_required: { text: '取消「已處理」一定要寫原因,沒有變動。', tone: 'warn' },
  denied: { text: '沒有權限,或登入過期了,沒有變動。請重新登入再試一次。', tone: 'error' },
  error: { text: '儲存失敗,請稍後再試或聯絡系統維護。', tone: 'error' },
} as const satisfies Record<IncidentResultCode, SettingsResultMessages[string]>;
