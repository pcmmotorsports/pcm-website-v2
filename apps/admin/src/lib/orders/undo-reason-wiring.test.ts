// 撤銷理由的**接線**守門 —— 兩條入口、一支 action、一個欄位名。
//
// 🔴 **為什麼要有這一格(2026-09-17)**:撤銷到貨有**兩個入口**,而它們走**同一支**
//    `undoItemReceiptAction`:
//      · `receipt-undo-bar.tsx`      —— 剛登錄完那一筆的「撤銷剛剛那筆」
//      · `receipt-delete-button.tsx` —— 逐筆到貨列表上某一筆的「撤銷」(`#450`)
//    ⇒ 🛑 **欄位名一旦有一邊寫錯,那一條入口會【靜靜地送不出理由】** ——
//      畫面上兩邊長得一模一樣、按下去也都成功,只是稽核表那一欄是空的。
//    📌 **而那正是 `#450` 踩過的形狀**(`receipt-actions.ts:258-266` 逐字記著:
//      「一條接線沒接上,而它的兩端各自都測過了」)—— 元件測試 mock 掉 action、
//      action 測試自己餵 FormData,**兩端都綠而中間斷掉**。
//
// 🛑 **這一格證不到「按下去真的會送」** —— 它比對的是原始碼裡的字面。
//    真的會不會送,由 `receipt-repository.test.ts` 那三格(送不送 key)與
//    `20260917120000` 的拋棄式 PG 實跑(理由有沒有落地)接。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RCPT_UNDO_REASON_FIELD } from './receipt-action-state';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRIES = [
  'components/orders/receipt-undo-bar.tsx',
  'components/orders/receipt-delete-button.tsx',
] as const;

describe('撤銷理由的接線', () => {
  it('🔴 兩條入口都有那一格輸入,而且都用【同一個常數】不是手打字串', () => {
    for (const rel of ENTRIES) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      // 🔴 **比對的是 `name={常數}` 這個【屬性】, 不是「檔案裡有沒有出現那個常數名」**。
      //    ⛔ ~~`src.includes('RCPT_UNDO_REASON_FIELD')`~~ 是 R1 MF1 抓到的**恆綠變形**:
      //      把 `name={RCPT_UNDO_REASON_FIELD}` 改成手打字串、而**上面那行 import 不動**
      //      ⇒ 檔案裡那個字仍在(import 那行)⇒ 這一格照樣綠。
      //    🔬 而**沒有任何一道閘會叫**(2026-09-17 實查, 不是推論):
      //      `grep -rn noUnusedLocals --include='tsconfig*.json' .` ⇒ 0 行
      //      `grep -rn unused eslint.config.*`                      ⇒ 0 行
      //      ⇒ 那個沒用到的 import 不會紅 ⇒ typecheck / lint / 本格 **三邊都放行**。
      //    📌 一道為了擋「接線沒接上」而寫的閘, 自己就沒接上 —— 抓到它的是 R1, 不是三綠。
      expect(
        src.includes('name={RCPT_UNDO_REASON_FIELD}'),
        `${rel} 沒有把那一格輸入的 name 掛到 RCPT_UNDO_REASON_FIELD 上`,
      ).toBe(true);
      expect(
        src.includes(`name='${RCPT_UNDO_REASON_FIELD}'`) ||
          src.includes(`name="${RCPT_UNDO_REASON_FIELD}"`),
        `${rel} 把欄位名手打成字串了 ⇒ 常數改名時它不會跟著改, 而且不會紅`,
      ).toBe(false);
    }
  });

  it('🔴 action 那一層真的去讀那個欄位', () => {
    const src = readFileSync(join(SRC, 'lib/orders/receipt-actions.ts'), 'utf8');
    // 🔴 **比對【用法】不是「檔案裡有沒有這個字」**(R2 F3, 2026-09-17)。
    //    ⛔ ~~`src.includes('RCPT_UNDO_REASON_FIELD')`~~ 與第一格是**同一種恆綠變形**:
    //      `receipt-actions.ts` 裡那個字**恰好兩次** —— import 清單一次、真的用一次。
    //      把用的那一處改成手打字串、import 不動 ⇒ 這一格照樣綠, 而 FormData 的 key
    //      與元件送出的 key 分家 ⇒ **兩條入口都填得進去, 理由一路被丟掉, 畫面上一切正常。**
    //    📌 R1 只修了第一格、把同樣的形狀留在這裡 ⇒ R2 才抓到。
    //      ⇒ **修這類恆綠, 同一支檔要一次掃完。**
    expect(
      src.includes('readSingleString(formData, RCPT_UNDO_REASON_FIELD)'),
      'action 沒用那個常數去讀欄位 ⇒ 兩條入口都填得進去, 而它一路被丟掉',
    ).toBe(true);
    // ⚠️ 舊 needle 是裸的 `reason:` —— 連註解裡的 `reason:` 都吃得到。釘住整個賦值。
    expect(src.includes('reason: readSingleString('), 'action 沒把它往 repo 傳').toBe(true);
  });

  // 🔵 **正對照**:沒有它,上面兩格在「我把路徑拼錯了」的時候會【自動全綠】。
  it('🔵 正對照:那兩個檔真的讀得到(不是路徑算錯讀到空字串)', () => {
    for (const rel of ENTRIES) {
      expect(readFileSync(join(SRC, rel), 'utf8').length, `${rel} 讀起來是空的`).toBeGreaterThan(
        500,
      );
    }
  });
});
