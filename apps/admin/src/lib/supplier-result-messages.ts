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
  | 'duplicate_rename'
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
  // 🔴 **不得宣稱「下方清單已定位到那一家」**(codex K2 抓,原文案就是那樣寫的):
  //    banner 只看得到 `?r=`,看不到定位有沒有成功。`?r=duplicate` 而**沒有** `q`、
  //    `q` 指的那家剛被別人改名而命中 0 筆、甚至整份名單載入失敗時,
  //    畫面上根本沒有定位這回事,而文案照樣言之鑿鑿 ⇒ 那是對員工說謊。
  //    ⇒ 定位成功與否由**頁面**負責講(`page.tsx` 的 `locating` 那一行,它看得到結果),
  //      本文案只講「這個名字已經存在」與「該怎麼辦」。
  duplicate: {
    text: '這個名稱已經有了,沒有新增。到下方清單找出那一家;若它顯示為「已停用」,按該列的「啟用」即可繼續使用。',
    tone: 'warn',
  },
  // 🔴🔴 **改名撞名必須有自己的碼**(Fable R4 must-fix 2):
  //    改名路徑原本沿用上面那則,而那則的字面是「沒有**新增**」—— 在改名這條路上就是錯的。
  //    更糟的是定位:`?q=` 帶的是**新名字**,清單會篩到「佔用那個名字的**別家**」,
  //    而**被改名的那一家(仍是舊名字)反而從畫面上消失** ⇒ 員工看到自己打的名字
  //    躺在表格裡,會合理地讀成「我的改名成功了」,實際上那一家原封不動。
  //    ⇒ 本則必須同時講三件事:①改名沒成功 ②清單現在篩到的是佔用者、不是你要改的那家
  //    ③怎麼找回你要改的那一家。
  duplicate_rename: {
    text: '改名沒有成功 —— 這個名稱已經被另一家供應商用了。下方清單目前篩到的是「用這個名稱的那一家」,不是你要改名的那一家(它仍是原本的名字);按「顯示全部」可以找回它。',
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
