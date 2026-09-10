import type { SettingsResultMessages } from '../components/settings/settings-result-banner';

export const STAFF_RESULT_MESSAGES = {
  saved: { text: '已儲存員工資料。', tone: 'ok' },
  audit_failed: {
    text: '變更已生效,但稽核紀錄寫入失敗 —— 請通知維護者。',
    tone: 'warn',
  },
  notfound: { text: '找不到該員工,未儲存。', tone: 'warn' },
  invalid: {
    text: '輸入格式不正確、代碼已存在,或本次停用會鎖住後台,未儲存。',
    tone: 'warn',
  },
  denied: {
    text: '可能沒有權限,也可能登入過期了。未儲存。先重新登入試一次;還是不行請找管理者。',
    tone: 'error',
  },
  error: {
    text: '儲存失敗,請稍後再試或聯絡系統維護。',
    tone: 'error',
  },
} as const satisfies SettingsResultMessages;
