// line-status-view.ts — 客人的 LINE 綁定狀態(唯讀顯示;2026-09-14 Sean Q11 乙)。
// 純函式、無 DB、無 'server-only' ⇒ 顯示層與測試共用。
//
// 🔴 **型別不進 `packages/domain`**:`Customer` 那支顧客站也 import,而這是後台唯讀的一格
//    ⇒ 住 admin-only 的 lib(同 `item-costs-view.ts` 那條紅線的理由)。
// 🔴 **三態 + 一個「讀不到」**:欄位還沒貼(B 窗 `20260914040000`)或讀失敗 ⇒ `unknown`,
//    **不可以退回「沒用 LINE」** ——「不知道」與「他真的沒綁」在畫面上必須分得出來
//    (同 email 驗證那格、同成本「讀取失敗 ≠ 沒填」)。

export type CustomerLineRow = {
  /** LINE 的使用者 id;`null` = 這個帳號沒有綁過 LINE。 */
  lineUserId: string | null;
  /** 加官方帳號好友的時刻(ISO);`null` = 綁了但沒加好友(或還沒回報)。 */
  lineFriendAt: string | null;
};

export type LineStatus =
  | { kind: 'friend'; friendAt: string }
  | { kind: 'login_only' }
  | { kind: 'none' }
  | { kind: 'unknown' };

/** 讀到的一列 → 三態;`null`(沒這個人 / 讀不到)⇒ `unknown`。 */
export function lineStatusOf(row: CustomerLineRow | null | undefined): LineStatus {
  if (row === null || row === undefined) return { kind: 'unknown' };
  const id = typeof row.lineUserId === 'string' ? row.lineUserId.trim() : '';
  if (id === '') return { kind: 'none' };
  const at = typeof row.lineFriendAt === 'string' ? row.lineFriendAt.trim() : '';
  return at === '' ? { kind: 'login_only' } : { kind: 'friend', friendAt: at };
}

/** 畫面上那一行字。`friend` 那態的日期由呼叫端格式化後傳進來(台北時區的 MM/DD,共用 `formatCustomerDate`)。 */
export function lineStatusLabel(status: LineStatus, friendDate?: string): string {
  switch (status.kind) {
    case 'friend':
      return friendDate === undefined ? '已加好友' : `已加好友 ${friendDate}`;
    case 'login_only':
      return '已登入未加好友';
    case 'none':
      return '沒用 LINE';
    case 'unknown':
      return '讀不到(可能是系統暫時查不到,不代表他沒綁)';
  }
}

/** 列表那顆小標:只有【已加好友】才印(其餘三態不佔位;Sean:有好友才印)。 */
export function showsLineChip(status: LineStatus): boolean {
  return status.kind === 'friend';
}
