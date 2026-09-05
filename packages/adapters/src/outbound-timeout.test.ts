import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { OUTBOUND_SEND_TIMEOUT_MS } from './outbound-timeout';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (abs: string) => readFileSync(abs, 'utf8');

/**
 * 🔴🔴 **把註解剝掉之後再比對** —— codex R1 #8/#9 打的就是這一格:
 * `src.toContain('signal: …')` 在那一行**被註解掉**、或那個字串**只出現在說明裡**時**照樣通過**。
 * 📌 一道用 `toContain` 讀原始碼的閘, 預設是把註解也當成碼。
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

/** 從一支檔裡挖一個具名數字常數;挖不到就 throw ⇒ **檔案改名或改寫時這道閘會【紅】, 不會靜默放行**。 */
const numberConst = (abs: string, name: string): number => {
  const m = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(stripComments(read(abs)));
  if (m === null) throw new Error(`🔴 在 ${abs} 找不到常數 ${name} —— 這道閘失去了它的輸入`);
  return Number(m[1]!.replace(/_/g, ''));
};

const ROUTE = join(REPO, 'apps/storefront/src/app/api/cron/email-sweep/route.ts');
const SWEEP = join(REPO, 'packages/use-cases/src/sweep-email-outbox.ts');

describe('⟦mail-FETCHTIMEOUT⟧ 對外送出的逾時上界', () => {
  it('🔴🔴 逾時 + 落表餘裕【裝得進】收尾餘裕 —— 而三個數字都是【從正式碼讀出來的】', () => {
    // 🛑 **codex R1 #6 打掉了我的第一版**:那一版把 5 與 55 寫死在測試裡
    //    ⇒ `5 × 10 < 55` 幾乎恆真, 而 production 的 `maxDuration` / tail 改了它照樣全綠。
    //    ⇒ 📌 **一個只跟自己的常數比對的閘, 量的是我打字的一致性, 不是系統。**
    const maxDurationSeconds = numberConst(ROUTE, 'maxDuration');
    const tailSeconds = numberConst(SWEEP, 'SEND_TAIL_ALLOWANCE_SECONDS');
    const MARK_SENT_ALLOWANCE_MS = 2_000; // send 回來之後那一發 markSent 落表

    // 🔴 **本檔最重要的一行**:最後一發在「預算耗盡前 1 ms」通過檢查之後,
    //    它最壞會跑滿一整個 timeout, 然後才落表 —— 那整段必須仍在平台的 kill 線之內。
    expect(
      tailSeconds * 1000,
      `🔴 收尾餘裕 ${tailSeconds}s 裝不下「逾時 ${OUTBOUND_SEND_TIMEOUT_MS / 1000}s + 落表 2s」` +
        ' ⇒ 一發在預算邊緣開始的 send 會跨過平台 kill 線 ⇒ 那一列留在 sending',
    ).toBeGreaterThanOrEqual(OUTBOUND_SEND_TIMEOUT_MS + MARK_SENT_ALLOWANCE_MS);

    // 🟢 正對照:那三個數字**真的讀到了**, 不是每一個都回 0 而讓上面那行恆真。
    expect(maxDurationSeconds).toBeGreaterThan(0);
    expect(tailSeconds).toBeGreaterThan(0);
    expect(OUTBOUND_SEND_TIMEOUT_MS).toBeGreaterThan(0);
    // 🔴 而收尾餘裕不可以吃掉整個 maxDuration(否則一封都寄不了, 而上面那一行照樣綠)。
    expect(tailSeconds).toBeLessThan(maxDurationSeconds);
  });

  it('🔴 【掃目錄】每一支會自己送出去的 adapter 都帶 signal —— 不用硬編清單(codex R1 #7)', () => {
    // ⛔ ~~第一版寫死三個檔名~~ ⇒ 註解宣稱「新增第四支會被抓到」而**那是假的**。
    // ✅ 改成掃 `src/**`, 判準 = 這支檔**自己呼叫 fetch**(`this.fetchImpl(` 字面, 註解已剝掉)。
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
            ? [join(dir, e.name)]
            : [],
      );

    const senders = walk(SRC).filter((f) => stripComments(read(f)).includes('this.fetchImpl('));
    // 🟢 正對照:掃到的支數不可以是 0 —— 否則下面那個 for 迴圈跑零次而它照樣綠。
    expect(senders.length, '🔴 一支都沒掃到 ⇒ 判準或路徑壞了, 不是「大家都合格」').toBeGreaterThanOrEqual(3);

    for (const f of senders) {
      expect(stripComments(read(f)), `🔴 ${f} 自己送出去而【沒有 signal】⇒ 那個 await 沒有上界`).toContain(
        'signal: AbortSignal.timeout(OUTBOUND_SEND_TIMEOUT_MS)',
      );
    }
  });

  it('🔴 兩個 FetchLike 的 `signal` 是【必填】—— 選填的話漏傳不會型別紅(codex R1 #9)', () => {
    for (const rel of ['email/ResendEmailSenderAdapter.ts', 'payment/LineAlertNotifierAdapter.ts']) {
      const code = stripComments(read(join(SRC, rel)));
      expect(code, `🔴 ${rel} 的 init 型別要求 signal`).toContain('signal: AbortSignal }');
      expect(code, `🔴 ${rel} 不可以把 signal 改成選填`).not.toMatch(/signal\?\s*:/);
    }
    // 🛑 **射程明寫(codex R1 #9 說得對)**:這一格讀的是**字面**, 它證不到
    //    「漏傳 signal 會讓 tsc 紅」—— 那要一支會編譯失敗的 fixture, 而本 repo 沒有那個 harness。
    //    ✅ 真正守著它的是 `pnpm typecheck` 本身:必填之下, 少傳的呼叫端當場紅。
  });
});
