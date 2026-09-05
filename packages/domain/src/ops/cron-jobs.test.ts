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
describe('🔴 【七】支排程的門檻是【唯一來源】,而這裡把值釘住', () => {
  it('【七】支的名字與門檻逐格釘死(改動 = 改變線上告警行為, 要有人按一下)', () => {
    expect(
      CRON_JOB_WHITELIST.map((w) => [w.jobName, w.staleMinutes] as const),
    ).toEqual([
      ['pcm-anomaly-alert', 26 * 60],
      ['pcm-capture-recheck', 30],
      ['pcm-email-sweep', 15],
      ['pcm-expire-unpaid-orders', 180],
      ['pcm-order-ineligible-gate', 6],
      ['pcm-settle-sweep', 6],
      // 🔵 2026-09-05 第七支:匯款兜底(`20260905140000`)。門檻 30 = 排程 */10 連漏三輪才叫,
      //    與 `pcm-capture-recheck` 同一把尺(它也是 */10)。
      ['pcm-late-payment-sweep', 30],
    ]);
  });

  /**
   * 🔴 這一格與上面那格**問的不是同一件事**:上面問「值對不對」,這格問「有沒有少一支」。
   *    ⇒ 一支排程被整個刪掉時,上面那格也會紅 —— 而它紅的訊息會指向「值不對」,
   *      而真正發生的是「那支排程再也沒有人在看了」。**兩個訊息要分得開。**
   */
  it('剛好【七】支 —— 少一支 = 那支排程再也沒有人在看,而它不會自己出聲', () => {
    expect(CRON_JOB_WHITELIST.length).toBe(7);
  });

  /**
   * 🔴 `pcm-expire-unpaid-orders` 是純 SQL,pg_cron 把它跑在自己一個交易裡
   * ⇒ 函式拋錯 ⇒ 同一交易裡寫的失敗心跳一起被回捲 ⇒ 它**物理上寫不出失敗心跳**
   * ⇒ 它的 `consecutive_failures` **永遠是 0**,而那在儀表上與「一直很健康」長得一樣。
   * ⇒ 所以它要被排除在失敗計數之外 —— 而**它正好是唯一一支碰錢的**(訂單自動取消)。
   * 🛑 這一格若被誤刪,那支的失敗計數會變成一個**恆為 0 的健康證明**。
   */
  it('失敗計數無意義的名單 = 【兩支】純 SQL 的(它們寫不出失敗心跳)', () => {
    // 🔵 2026-09-05:`pcm-late-payment-sweep` 也是純 SQL, 同一個物理限制。
    expect([...FAILURE_COUNT_MEANINGLESS]).toEqual(['pcm-expire-unpaid-orders', 'pcm-late-payment-sweep']);
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

/**
 * 🔴 `⟦b9-HBSEMANTIC⟧` 的前置守門(2026-09-02, `-15`)—— **而它獨立成立**:
 * 就算那一片不做, 這張表也答得出「今天六支的 schedule 是什麼、而它的週期是幾分鐘」。
 *
 * ## 它擋什麼
 * 那一片要用【比值 = staleMinutes / 週期】來決定訊息怎麼寫。
 * 🔴 而週期若與真排程漂開 ⇒ 那句話會**很有信心地講錯輪數** —— 比不寫更糟。
 * ✅ 所以週期不用【解析 cron 運算式】算(那種東西看起來簡單而邊界很多),
 *    改用**一張寫死的對照表** + 一道「白名單裡的每個 schedule 都要在表上」的斷言。
 *    ⇒ 有人改 schedule 或加一支 job ⇒ **當場紅**, 直到他把週期也寫上。
 *
 * ## 🛑 它【擋不到】什麼 —— 先讀這一段
 * ```
 * 它比的是【本檔的字面】對【本表】。
 * 🔴 而「正式庫的 cron 被人在 SQL Editor 改了」⇒ 兩邊都不會動 ⇒ **這道閘全綠**。
 * ⇒ 那與 cron-jobs.ts 檔頭已知的那一格同型(「它會漂, 而本檔不會知道」), 不是本測項新增的。
 * ```
 * 🟢 **而現值有一發實測**:`-15` 2026-09-02 00:0x 以 `postgres` 身分唯讀撈正式庫 `cron.job`
 *    全表(六支, 分母是全部不是抽樣)⇒ **六支的 schedule 全部與下表相同**。
 *    🛑 **而那不是「它不會漂」** —— 它只是把那一格的時點推到 2026-09-02。
 *    **下一個引用它的人一樣要自己撈一次。**
 *    ⚠️ 而那一發是【只下 SELECT】—— **那是自律不是限制**(連線身分是 postgres)。
 */
describe('⟦b9-HBSEMANTIC⟧ 週期對照表 —— 而它不解析 cron 運算式', () => {
  /** schedule 字面 → 週期(分鐘)。🔴 **人寫死的**, 加一支 job 就要加一行。 */
  const PERIOD_MINUTES_BY_SCHEDULE: Readonly<Record<string, number>> = {
    '*/2 * * * *': 2,
    '*/5 * * * *': 5,
    '*/10 * * * *': 10,
    '0 * * * *': 60,
    '0 1 * * *': 1440,
  };

  it('🔴 白名單裡每一支的 schedule 都要在對照表上(加 job 或改 schedule ⇒ 當場紅)', () => {
    const missing = CRON_JOB_WHITELIST.filter(
      (w) => PERIOD_MINUTES_BY_SCHEDULE[w.schedule] === undefined,
    ).map((w) => `${w.jobName}(${w.schedule})`);
    expect(missing).toEqual([]);
  });

  it('🟢 對照表沒有【多】的項目 —— 一個沒有人用的週期是一個沒有人會維護的數字', () => {
    // 🔵 明寫 `Set<string>`:白名單是 `as const` ⇒ `w.schedule` 是字面聯集型別,
    //    而 `used.has(k)` 的 `k` 來自 `Object.keys` ⇒ `string` ⇒ **typecheck 紅而 vitest 綠**。
    //    📌 而那正是今晚踩過的形狀:兩把尺, 而只有一把看了。
    const used = new Set<string>(CRON_JOB_WHITELIST.map((w) => w.schedule));
    expect(Object.keys(PERIOD_MINUTES_BY_SCHEDULE).filter((k) => !used.has(k))).toEqual([]);
  });

  /**
   * 🔴 **這一格才是那一列在講的東西**:比值把【七】支分成兩種語意,
   * 而它們今天**印同一句話**。
   * ```
   * 比值 >= 2 ⇒ 門檻至少兩個週期 ⇒ 要【連續錯過一整輪以上】才叫 ⇒ 語意是「它停了嗎」
   * 比值 <  2 ⇒ 一輪都不必錯過 ⇒ 只要那一輪晚了就叫       ⇒ 語意是「它準時嗎」
   * ```
   * 🛑 **而 2.0 這條線【不承重】** —— 它只決定那句話怎麼寫, 不決定叫不叫。
   *    七支現值是 3.0 ×6 與 1.08 ×1 ⇒ 分界放在 1.5–2.9 之間結果都一樣。
   */
  it('🔴 【七】支分成兩種語意 —— 六支答【它停了嗎】, 一支答【它準時嗎】', () => {
    const byMeaning = { 停了嗎: [] as string[], 準時嗎: [] as string[] };
    for (const w of CRON_JOB_WHITELIST) {
      const period = PERIOD_MINUTES_BY_SCHEDULE[w.schedule]!;
      (w.staleMinutes / period >= 2 ? byMeaning.停了嗎 : byMeaning.準時嗎).push(w.jobName);
    }
    expect(byMeaning.準時嗎).toEqual(['pcm-anomaly-alert']);
    // 🔵 2026-09-05:5 ⇒ 6(加了 pcm-late-payment-sweep,30/10 = 3.0 ⇒ 也是「它停了嗎」)。
    expect(byMeaning.停了嗎).toHaveLength(6);
    // 🔵 而那個 1.08 要釘住:它是這一列存在的理由, 而它被調過就該回來讀這一段。
    expect(1560 / 1440).toBeCloseTo(1.083, 3);
  });
});
