import 'server-only';

// 信件文字第 3 片:寄測試信的次數上限(每位員工每分鐘 3 封)。
// 不放在 'use server' 檔:那種檔匯出的函式都會變成瀏覽器叫得到的動作, 清除名額那支不能被叫到。
// ponytail: 名額放在記憶體, 只在同一個伺服器實例內有效;真的被濫用再改成存資料庫。

const TEST_EMAIL_PER_MINUTE = 3;
const recentByActor = new Map<string, number[]>();

export function takeTestEmailSlot(actor: string, now: number): boolean {
  const recent = (recentByActor.get(actor) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= TEST_EMAIL_PER_MINUTE) {
    recentByActor.set(actor, recent);
    return false;
  }
  recent.push(now);
  recentByActor.set(actor, recent);
  return true;
}

/** 測試用:清掉次數紀錄。 */
export function resetTestEmailSlotsForTest(): void {
  recentByActor.clear();
}
