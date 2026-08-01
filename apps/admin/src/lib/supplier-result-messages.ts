import type { SettingsResultMessages } from '../components/settings/settings-result-banner';

// supplier-result-messages.ts — M-4b E10 S3b-2:`?r=<code>` 的員工可讀文案。
//
// 🔴 **結果碼的單一來源在本檔,不在 action** —— `supplier-actions.ts` 帶 `'use server'`,
//    它的匯出全部必須是 async function(型別會被抹掉、值不行)。把碼定義在這裡,
//    action `import type` 回去用,兩邊就不可能各有一份名單。
//    少了這個安排,新增一個碼卻忘了寫文案 ⇒ banner 靜默不顯示(見下方 `?r=` 未知值的行為)。

export type SupplierResultCode =
  | 'created'
  | 'saved'
  | 'nochange'
  | 'duplicate'
  | 'notfound'
  | 'invalid'
  | 'denied'
  | 'bug'
  | 'error';

/**
 * 🔴 `satisfies Record<SupplierResultCode, …>` 是**雙向**守門:
 *   · 少一個碼 ⇒ typecheck 紅(漏寫文案)
 *   · 多一個碼 ⇒ typecheck 紅(物件字面的多餘屬性檢查)⇒ 不會殘留孤兒文案。
 */
export const SUPPLIER_RESULT_MESSAGES = {
  created: { text: '已新增供應商。', tone: 'ok' },
  saved: { text: '已儲存變更。', tone: 'ok' },
  nochange: {
    text: '沒有任何變更(送出的內容與目前相同)。',
    tone: 'ok',
  },
  // 🔴 Sean 2026-08-02 拍板 Q2=A 的文案面:訊息**只告知 + 指路**,系統不代員工按「啟用」。
  //    「按該列的啟用」這句話是刻意的 —— 未採「跳確認框直接啟用」那案。
  duplicate: {
    text: '這個名稱已經有了 —— 下方清單已定位到那一家。若它顯示為「已停用」,按該列的「啟用」即可繼續使用,不必另外新增。',
    tone: 'warn',
  },
  notfound: {
    text: '找不到該供應商(可能剛被其他人改動),未儲存。',
    tone: 'warn',
  },
  invalid: {
    text: '名稱格式不正確(不可空白、上限 100 字、不可含換行或控制字元),未儲存。',
    tone: 'warn',
  },
  denied: {
    text: '沒有權限或登入狀態已失效,未儲存。',
    tone: 'error',
  },
  // 🔴 與 `error` 分開的理由不是分類潔癖,是**下一步動作不同**:
  //    `error` 叫員工「再試一次」,而這一類的成因是呼叫端契約違反 ——
  //    其中「改名路徑收到 CREATED」那一支代表**已經寫進去一筆刪不掉的供應商**,
  //    此時再按一次可能再多一筆。所以這裡明文叫他停手 + 通知維護者。
  bug: {
    text: '系統偵測到異常,可能已多出一筆供應商 —— 請先不要重複送出,並通知維護者。',
    tone: 'error',
  },
  error: {
    text: '儲存失敗,請稍後再試或聯絡系統維護。',
    tone: 'error',
  },
} as const satisfies Record<SupplierResultCode, SettingsResultMessages[string]>;
