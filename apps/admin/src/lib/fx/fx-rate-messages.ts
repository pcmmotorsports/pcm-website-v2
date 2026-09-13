import type { SettingsResultMessages } from '@/components/settings/settings-result-banner';

export const FX_SETTINGS_PATH = '/settings/fx';

export type FxResultCode = 'saved' | 'denied' | 'invalid' | 'error';

export const FX_RESULT_MESSAGES: SettingsResultMessages = {
  saved: { text: '匯率已存成新的一列。之後存的訂單會用這個數字;已經存過的不會回頭重算。', tone: 'ok' },
  denied: { text: '只有管理者可以改匯率。', tone: 'warn' },
  invalid: { text: '匯率要是大於 0 的數字(最多 6 位小數),幣別要在清單裡。', tone: 'warn' },
  error: { text: '匯率沒有存成,請稍後再試或聯絡系統維護。', tone: 'error' },
};
