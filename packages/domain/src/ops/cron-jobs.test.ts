import { describe, it, expect } from 'vitest';

import { CRON_JOB_WHITELIST, FAILURE_COUNT_MEANINGLESS } from './cron-jobs';

/**
 * 🔴🔴 **這支檔存在的理由是一發【失敗的】突變。**
 *
 * 2026-08-31 片3 收工前,主視窗要求證明「門檻只有一份」:
 * **改 `packages/domain` 那個值 ⇒ 儀表板側與告警側兩邊都要紅。**
 * 我照做了 —— 把 `pcm-email-sweep` 的 `staleMinutes` 從 15 改成 999,兩側各跑一次:
 * ```
 * 儀表板側 cron-heartbeat-read.test.ts   ⇒ 21 passed(全綠)
 * 告警側   PgAnomalyAlertReaderAdapter    ⇒ 55 passed(全綠)
 * ```
 * 🛑 **兩邊都沒紅。** 而那**不是**「有兩份門檻」的證據 —— 結構上只有一份
 * (全 repo `staleMinutes:` 的定義只在本檔;兩側都 `import` 它,實查過)。
 *
 * 📌 **它證的是另一件事:那六個數字【根本沒有任何測試在守】。**
 *    兩側的測試都是**讀同一個常數**來組期望值 ⇒ 它們對那個常數的【值】**在構造上是盲的**
 *    ⇒ 改成 999 之後,測試跟著改期望值,然後印綠。
 *
 * 🔴 **⇒ 而這推翻了那個驗收法本身**:一份真正的單一來源,
 *    它的值**不可能**讓兩個「讀它的」測試同時變紅 —— 要變紅,得有人**把值寫死**。
 *    ⇒ 所以正確的形狀是:**一份來源 ⇒ 一道守門**,而那道守門就是這支檔。
 *
 * ⚠️ 這支檔會在**任何人改動那六個數字時變紅**。那是它的用途,不是它壞了:
 *    改門檻是一個**會改變線上告警行為**的決定 ⇒ 它應該要有人按一下確認。
 *    ⇒ 改的時候把下面的期望值一起改,**而那一次改動就是那個「按一下」**。
 */
describe('🔴 六支排程的門檻是【唯一來源】,而這裡把值釘住', () => {
  it('六支的名字與門檻逐格釘死(改動 = 改變線上告警行為, 要有人按一下)', () => {
    expect(
      CRON_JOB_WHITELIST.map((w) => [w.jobName, w.staleMinutes] as const),
    ).toEqual([
      ['pcm-anomaly-alert', 26 * 60],
      ['pcm-capture-recheck', 30],
      ['pcm-email-sweep', 15],
      ['pcm-expire-unpaid-orders', 180],
      ['pcm-order-ineligible-gate', 6],
      ['pcm-settle-sweep', 6],
    ]);
  });

  /**
   * 🔴 這一格與上面那格**問的不是同一件事**:上面問「值對不對」,這格問「有沒有少一支」。
   *    ⇒ 一支排程被整個刪掉時,上面那格也會紅 —— 而它紅的訊息會指向「值不對」,
   *      而真正發生的是「那支排程再也沒有人在看了」。**兩個訊息要分得開。**
   */
  it('剛好六支 —— 少一支 = 那支排程再也沒有人在看,而它不會自己出聲', () => {
    expect(CRON_JOB_WHITELIST.length).toBe(6);
  });

  /**
   * 🔴 `pcm-expire-unpaid-orders` 是純 SQL,pg_cron 把它跑在自己一個交易裡
   * ⇒ 函式拋錯 ⇒ 同一交易裡寫的失敗心跳一起被回捲 ⇒ 它**物理上寫不出失敗心跳**
   * ⇒ 它的 `consecutive_failures` **永遠是 0**,而那在儀表上與「一直很健康」長得一樣。
   * ⇒ 所以它要被排除在失敗計數之外 —— 而**它正好是唯一一支碰錢的**(訂單自動取消)。
   * 🛑 這一格若被誤刪,那支的失敗計數會變成一個**恆為 0 的健康證明**。
   */
  it('失敗計數無意義的名單 = 只有那支純 SQL 的(它寫不出失敗心跳)', () => {
    expect([...FAILURE_COUNT_MEANINGLESS]).toEqual(['pcm-expire-unpaid-orders']);
  });

  it('🟢 名單裡的每一支都真的在白名單裡(否則它排除的是一個不存在的東西)', () => {
    // 🔵 `as const` 讓 `jobName` 是窄字面聯集 ⇒ `Set<那個聯集>.has(string)` 過不了型別。
    //    這裡要問的是「這個名字在不在白名單裡」, 對象本來就是任意字串 ⇒ 顯式放寬。
    //    (與 `cron-heartbeat-read.ts` 那一格同一個理由, 它的註解裡寫過。)
    const names: ReadonlySet<string> = new Set<string>(CRON_JOB_WHITELIST.map((w) => w.jobName));
    for (const n of FAILURE_COUNT_MEANINGLESS) expect(names.has(n)).toBe(true);
  });
});

/**
 * 🔴 **codex 2026-08-31 片3 R1 #8 是對的:上面那組【不能】證明「唯一來源」。**
 *   任何一個消費端硬編同樣的數字,上面全綠。上面那組是**門檻變更的審批閘**,
 *   不是**架構閘** —— 兩者我原本混為一談。
 * ⇒ 這一格才是架構閘:掃全 repo,`staleMinutes:` 的**定義**只准出現在本目錄那支檔。
 * 🛑 **射程**:它只認 `staleMinutes:` 這個字面。有人用別的名字複製一份門檻(`thresholdMin` …)
 *   ⇒ **它看不到**。那是這把尺的已知盲區,不是它壞了。
 */
describe('🔴 架構閘:那六個門檻在全 repo 只有一份【定義】', () => {
  it('`staleMinutes:` 的定義只出現在 packages/domain/src/ops/cron-jobs.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = join(__dirname, '..', '..', '..', '..');
    const hits: Array<{ file: string; line: number; text: string }> = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (['node_modules', '.next', '.turbo', 'dist', '.git', 'design-reference'].includes(e)) continue;
        const full = join(dir, e);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        // 🔴 **副檔名要含 .js/.mjs/.cjs**(codex R2:第二份定義若出現在那些檔, 舊版全綠)。
        if (!/\.(tsx?|mts|cts|m?js|cjs)$/.test(e) || /\.test\.[a-z]+$/.test(e)) continue;
        readFileSync(full, 'utf8').split('\n').forEach((text, i) => {
          // 🔵 只認【碼】不認註解 —— 註解裡抄一份數字是另一種病(它會過期而不會紅),
          //    而本閘守的是「有沒有第二份會被執行的定義」。兩件事分開。
          const code = text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (code.includes('staleMinutes:')) hits.push({ file: relative(root, full), line: i + 1, text: text.trim().slice(0, 60) });
        });
      }
    };
    // 🔴 **要掃 `scripts/` 才對得起「全 repo」那三個字**(codex R2:舊版只掃兩個目錄,
    //    而我在測試名稱裡寫的是「全 repo」⇒ **名字比射程寬**, 那本身就是本 repo 記過的一種病)。
    for (const d of ['apps', 'packages', 'scripts']) walk(join(root, d));
    // 🟢 前置:至少要撈到本檔那六行 —— 否則這把尺沒接上而它會印綠。
    expect(hits.length, '一行都沒撈到 ⇒ 這把尺沒有接上').toBeGreaterThanOrEqual(6);
    const outside = hits.filter((h) => !h.file.endsWith('packages/domain/src/ops/cron-jobs.ts'));
    expect(outside, `這幾處在本檔之外定義了門檻:${JSON.stringify(outside, null, 2)}`).toEqual([]);
  });
});
