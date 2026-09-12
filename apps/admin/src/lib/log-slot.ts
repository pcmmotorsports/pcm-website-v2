// log-slot.ts — 有界去重的 console log 名額。**本檔零 import**(見下面「為什麼要獨立一支」)。
//
// 🔴 **為什麼抽出來**(2026-09-12,⟦b4-AUDITNULLAMBIG⟧):
//    這個 repo 裡已經有兩份同款節流 —— `staff.ts` 的 `consumeLogSlot` 與
//    `session/session.ts` 的 `consumeAlarmSlot`。而 `manual-cancel-notice-read.ts` 需要第三個呼叫端。
//    ⛔ ~~再抄一份~~ —— 那正是 `staff.ts:20-22` 自己抱怨過的形狀(「同一個放大面在隔壁還開著」)。
//    ⛔ ~~直接 import `staff.ts`~~ —— 🔬 **實測擋下**:`staff.ts` → `staff-repository.ts:1` 有
//       `import 'server-only'` ⇒ 測試一 import 就爆
//       「This module cannot be imported from a Client Component module」。
//       📌 **一個「重用」把一整條 server-only 依賴鏈拖進一支純讀取模組** ⇒ 抽成這一支零依賴的檔。
//    🔵 `session.ts` 那一支**沒有動** —— 它的 key 型別是 `SessionRejectReason`(不是 string),
//       而合併它會把兩個不同的值域混成一個。**這一支只收 string key 的那一族。**
//
// ⚠️ **誠實界線(從 `staff.ts` 逐字帶過來)**:serverless 每個 instance 各有自己的計時器
//    ⇒ 這是**上界不是精確節流**;它擋的是「單一 instance 的洪水」,不是「全域剛好一則」。

const LOG_MIN_INTERVAL_MS = 60_000;
const lastLogAt = new Map<string, number>();

/**
 * 呼叫即消耗:同一個 `key` 在 60 秒內只回一次 `true`。
 * 🔴 key 要帶呼叫端前綴(`staff.` / `manual-cancel-notice.`)—— **本檔的呼叫端共用同一張表**
 *    (⛔ ~~全 repo~~:`session.ts` 的 `consumeAlarmSlot` 沒有併進來, 見檔頭)。
 */
export function consumeLogSlot(key: string, now: number = Date.now()): boolean {
  const prev = lastLogAt.get(key);
  if (prev !== undefined && now - prev < LOG_MIN_INTERVAL_MS) return false;
  lastLogAt.set(key, now);
  return true;
}

/** 測試用:清掉節流狀態。**不要在 production code 呼叫。** */
export function __resetLogSlotsForTests(): void {
  lastLogAt.clear();
}
