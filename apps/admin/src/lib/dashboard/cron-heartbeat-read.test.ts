import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// cron-heartbeat-read.test.ts — 3a 讀取端的守門。
//
// 🔴 每一格都要在**兩個世界印不同的東西**;只證「有值」的斷言不算。
// 🔴 本檔**不 mock** `loadCronHeartbeats` 本體的判斷邏輯 —— 只換掉 supabase client 那一層,
//    否則就變成在驗我自己寫的假字串。

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import {
  CRON_JOB_WHITELIST,
  FAILURE_COUNT_MEANINGLESS,
  loadCronHeartbeats,
  unreadableReport,
} from './cron-heartbeat-read';

type Row = Record<string, unknown>;

/** 讓 `.from(...).select(...)` 這條鏈 resolve 成一份假資料。 */
/** 🔴 **最後一次 `.select()` 被餵了什麼** —— 而它是本檔唯一看得到「有沒有讀那一欄」的地方。
 *  ⚠️ 原本的 mock 是 `select: () => …`(**丟掉參數**)⇒ 把 `last_failure_at` 從 SELECT 拿掉
 *     時, **24 格全綠**(2026-09-02 突變實測)⇒ 📌 而那正是這一片要修的那個病本身。
 *  ⇒ ⇒ **一個守「有沒有去讀」的測試, 如果它的替身丟掉那個參數, 它守的就是別的東西。** */
let lastSelect: string | null = null;
function withRows(rows: Row[] | null, error: unknown = null) {
  lastSelect = null;
  mocks.from.mockReturnValue({
    select: (cols?: unknown) => {
      lastSelect = typeof cols === 'string' ? cols : null;
      return Promise.resolve({ data: rows, error });
    },
  });
}
/** transport 層真的 reject(網路斷 / DNS)—— 那不會進 `{ error }`。 */
function withReject(err: unknown) {
  mocks.from.mockReturnValue({ select: () => Promise.reject(err) });
}

const NOW = new Date('2026-08-28T12:00:00.000Z');
/** n 分鐘前的 ISO 字串。 */
const ago = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

/** 八支全部剛剛成功過的一份完整資料(正向對照的地基)。 */
const ALL_HEALTHY: Row[] = CRON_JOB_WHITELIST.map((w) => ({
  job_name: w.jobName,
  last_success_at: ago(1),
  consecutive_failures: 0,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('白名單這張表本身', () => {
  // 🔴🔴 R1 I4:下面那兩格迴圈式守門的**分母是白名單自己** ——
  //    `for (const w of CRON_JOB_WHITELIST)` 與 `new Set(names).size === names.length`
  //    **在空陣列上全過**,而【打錯名字】更是一個字都不會紅
  //    (三支在別處只被索引引用、沒有字面)⇒ 名字漂掉 ⇒ 三綠全綠,
  //      而線上那一支永遠報「從來沒寫過心跳」,沒有人知道是名字打錯。
  //    ⇒ 這一格把六個名字與長度**釘成字面**:分母改成【我在檔案外面寫死的那份】。
  it('🔴 八支的名字與數量釘死(改名/多一支/少一支都要紅)', () => {
    expect(CRON_JOB_WHITELIST.map((w) => w.jobName)).toEqual([
      'pcm-anomaly-alert',
      'pcm-capture-recheck',
      'pcm-email-sweep',
      'pcm-expire-unpaid-orders',
      'pcm-order-ineligible-gate',
      'pcm-settle-sweep',
        // 🔵 2026-09-05 加(⟦b9-ACLDRIFT5⟧ 片一 20260905140000 排的)
        'pcm-acl-digest',
        // 🔵 2026-09-05 加(⟦b4-SETTLERETRYNEVER⟧)
        'pcm-settle-retry',
    ]);
    expect(CRON_JOB_WHITELIST).toHaveLength(8);
    // 🔴 而這六個名字必須與**正式庫 cron.job 實際排的**一致(2026-08-28 唯讀撈、總數 6、非抽樣)。
    //    ⚠️ 而本測試**驗不到那一側** —— 它只釘住「碼裡這份沒有被偷偷改掉」。
    //    真排程漂掉這一格由 ⟦b4-CRON6c⟧ 記著(後台讀不到 `cron.job`,三道權限)。
  });

  // 🔴 主視窗 2026-08-28 指定的守門:新增第七支排程時,它會安靜地沒有門檻。
  it('🔴 每一支都要有門檻、有標籤、有接線落點 —— 少一格就紅', () => {
    for (const w of CRON_JOB_WHITELIST) {
      expect(typeof w.staleMinutes, `${w.jobName} 的 staleMinutes`).toBe('number');
      expect(w.staleMinutes, `${w.jobName} 的門檻要是正數`).toBeGreaterThan(0);
      expect(w.label.length, `${w.jobName} 要有中文標籤`).toBeGreaterThan(0);
      expect(w.wiredAt.length, `${w.jobName} 要寫得出接線落點`).toBeGreaterThan(0);
    }
  });

  it('job 名字不得重複(重複 ⇒ 後面那支會蓋掉前面,而畫面上少一列沒有人會發現)', () => {
    const names = CRON_JOB_WHITELIST.map((w) => w.jobName);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * 🔴 **本格補的是【上面那一格自己說它驗不到】的那一側。**
   *    它逐字寫著「而本測試**驗不到那一側** —— 它只釘住『碼裡這份沒有被偷偷改掉』」。
   *    ⇒ 這裡把分母換成 `supabase/migrations/*.sql` 裡真的呼叫過的 `cron.schedule('<名字>'`。
   *
   * 🛑🛑 **而這一格【擋不到只在 SQL Editor 排的排程】, 這句話必須跟著它走。**
   *    Sean 只用 SQL Editor 手貼(`CLAUDE.md` 記著他不用 `db push`)⇒
   *    一支【只在 SQL Editor 排過、沒有進 repo】的 cron:本格看不見它、白名單不會有它,
   *    而**儀表上不會少一列** —— 它從頭到尾就沒有那一列。
   *    📌 **缺席的東西不會在任何一張表上留下一個空格。**
   *    ⇒ 所以本格綠的時候, 正確的讀法是
   *      **「repo 裡那兩份手寫的東西還一致」**, 不是「白名單沒有漏掉任何真的在跑的排程」。
   *      🔴 後者【沒有任何人量得到】:後台讀不到 `cron.job`(三道權限,見本檔對應說明)。
   *
   * 🔴 **為什麼要剝註解**:第一發不剝時撈到 20 行, 其中 8 行是**註解裡提到** `cron.schedule`
   *    (例如逐字「`cron.schedule` 兩 job:pcm-settle-sweep…」)⇒ 分母會被灌水。
   * ✅ 而**動態組出來的 job 名**(`format(...)` / `||` / 變數)實測**零命中**
   *    (2026-08-29 當場量, 同一把尺的正對照撈得到字面常數形狀 ⇒ 它不是恆零)。
   *    ⚠️ 若哪天有人用動態名排 cron, **本格會漏掉它而印綠** —— 那是本格的第二個盲區。
   */
  it('🔴 白名單 == migrations 裡真的排過的那幾支(兩個方向都比)', () => {
    const dir = resolve(__dirname, '../../../../../supabase/migrations');
    const names = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      // 剝掉 `--` 行註解再找 —— 否則「註解裡提到 cron.schedule」會被算進分母。
      // 🔴 先剝【區塊】註解再剝行註解(2026-09-04 `-auth`, ⟦b4-PIECEBGATEGAPS⟧ ②④):只剝 `--` 擋不住 `/* … */`。
      const sql = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
      for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'/g)) names.add(m[1]!);
    }
    const inMigrations = [...names].sort();
    // 🔴 顯式放寬成 string[]:`jobName` 是字面聯集型別,而這裡要拿【任意字串】
    //    (從 migrations 撈到的)去比 ⇒ 不放寬的話 `includes` 連編譯都過不了。
    //    ⚠️ 而放寬本身有代價:型別不再幫我擋「比錯欄位」⇒ 那一格由上面那道正對照擋。
    const inWhitelist: string[] = CRON_JOB_WHITELIST.map((w) => w.jobName as string).sort();

    // 🔴 正對照先跑:分母不得是空的。空目錄 / 樣式打錯 ⇒ 下面兩個 toEqual 會在
    //    「兩邊都空」時全過, 而那正是這種對帳最常見的假綠。
    expect(inMigrations.length, 'migrations 裡撈到的排程數(0 ⇒ 這把尺沒接上)').toBeGreaterThan(0);

    expect(
      inWhitelist.filter((n) => !names.has(n)),
      '白名單有、而 migrations 沒排 ⇒ 白名單有過期條目',
    ).toEqual([]);
    expect(
      inMigrations.filter((n) => !inWhitelist.includes(n)),
      '🔴 migrations 排了、而白名單沒有 ⇒ 有排程沒有人在看它的心跳',
    ).toEqual([]);
  });

  it('🔴 逾期取消那一支必須在「失敗計數沒有意義」名單裡(片2 的物理限制)', () => {
    expect(FAILURE_COUNT_MEANINGLESS.has('pcm-expire-unpaid-orders')).toBe(true);
    // 負對照:別支不在裡面 ⇒ 這個集合不是「全部都算」。
    expect(FAILURE_COUNT_MEANINGLESS.has('pcm-settle-sweep')).toBe(false);
  });
});

describe('loadCronHeartbeats', () => {
  it('正向對照:八支都健康 ⇒ 零異常、零漂移(證明下面每一格的斷言真的看得到東西)', async () => {
    withRows(ALL_HEALTHY);
    const r = await loadCronHeartbeats(NOW);
    expect(r.unreadableReason).toBeNull();
    expect(r.jobs).toHaveLength(CRON_JOB_WHITELIST.length);
    expect(r.jobs.filter((j) => j.abnormal)).toEqual([]);
    expect(r.neverBeat).toEqual([]);
    expect(r.unknownJobs).toEqual([]);
  });

  it('🔴 某一支太久沒成功 ⇒ 只有它 abnormal,而句子裡有分鐘數與門檻', async () => {
    const target = CRON_JOB_WHITELIST[5]; // settle-sweep,門檻 6 分
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === target.jobName ? { ...r, last_success_at: ago(target.staleMinutes + 5) } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const bad = r.jobs.filter((j) => j.abnormal);
    expect(bad.map((j) => j.jobName)).toEqual([target.jobName]);
    expect(bad[0]?.note).toContain('沒成功');
    expect(bad[0]?.note).toContain(String(target.staleMinutes));
  });

  it('🔴 差一分鐘不到門檻 ⇒ 不得亮(邊界的另一側,否則上一格可能是「永遠都紅」)', async () => {
    const target = CRON_JOB_WHITELIST[5];
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === target.jobName ? { ...r, last_success_at: ago(target.staleMinutes - 1) } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    expect(r.jobs.filter((j) => j.abnormal)).toEqual([]);
  });

  it('🔴 剛好等於門檻 ⇒ 不亮(判準是 > 不是 >=;R1 N2 邊界正中央)', async () => {
    const target = CRON_JOB_WHITELIST[5];
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === target.jobName ? { ...r, last_success_at: ago(target.staleMinutes) } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    expect(r.jobs.filter((j) => j.abnormal)).toEqual([]);
  });

  it('🔴 最後成功時間在未來 ⇒ 也要亮,而它【不是】太久沒跑 —— 句子要不一樣', async () => {
    const target = CRON_JOB_WHITELIST[2];
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === target.jobName ? { ...r, last_success_at: ago(-30) } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const bad = r.jobs.find((j) => j.jobName === target.jobName);
    expect(bad?.abnormal).toBe(true);
    expect(bad?.note).toContain('未來');
    expect(bad?.note).not.toContain('沒成功');
    // 負數照實印、不夾成 0 —— 夾掉它會把「有東西寫錯了」藏起來。
    expect(bad?.minutesAgo).toBeLessThan(0);
  });

  it('🔴 連續失敗 > 0 ⇒ 亮(即使剛剛才「成功」過)', async () => {
    const target = CRON_JOB_WHITELIST[1];
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === target.jobName ? { ...r, consecutive_failures: 3 } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const bad = r.jobs.find((j) => j.jobName === target.jobName);
    expect(bad?.abnormal).toBe(true);
    expect(bad?.consecutiveFailures).toBe(3);
  });

  it('🔴🔴 逾期取消那一支:失敗計數【不參與判斷】,而且不對外報一個假的 0', async () => {
    // 這一格是片2 那個物理限制的守門:它的失敗計數永遠是 0,
    // 而「永遠是 0」與「一直很健康」長得一樣 ⇒ 這一支只准看 staleness。
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === 'pcm-expire-unpaid-orders' ? { ...r, consecutive_failures: 9 } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === 'pcm-expire-unpaid-orders');
    expect(j?.consecutiveFailures).toBeNull(); // 不是 0 也不是 9 —— 它沒有意義
    expect(j?.abnormal).toBe(false); // 剛成功過 ⇒ 那個 9 不得讓它亮
    // ⚠️ R1 N1 誠實標註:下面這一行**重跑的是同一發 mock**,它是上面那一發的【複印】,
    //    不是第二個獨立證據(突變驗過它確實有判別力:把六支全塞進 FAILURE_COUNT_MEANINGLESS
    //    ⇒ 這行的 `toBe(0)` 會變成 `null` 而轉紅 ⇒ 不是恆真格)。
    //    真正的獨立對照在上面那格「連續失敗 > 0 ⇒ 亮」。
    const other = await loadCronHeartbeats(NOW);
    expect(other.jobs.find((x) => x.jobName === 'pcm-settle-sweep')?.consecutiveFailures).toBe(0);
  });

  // ══ R1 I1:有這一列、而從來沒有成功過 ══════════════════════════════════
  // `recordHeartbeatFailure` 刻意不碰 `last_success_at` ⇒ 上線第一輪就失敗 ⇒ 那一欄是 NULL。
  // 🔴 修之前這個世界印的是「最後成功時間讀不出來」⇒ **47 次連續失敗被印成一句型別問題**。
  it('🔴🔴 last_success_at 是 NULL 而連續失敗 N 次 ⇒ 句子要說【失敗】,不得說「讀不出來」', async () => {
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === 'pcm-settle-sweep'
          ? { ...r, last_success_at: null, consecutive_failures: 47 }
          : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === 'pcm-settle-sweep');
    expect(j?.abnormal).toBe(true);
    expect(j?.note).toContain('從來沒有成功過');
    expect(j?.note).toContain('47');
    expect(j?.note).not.toContain('讀不出來'); // 指錯方向的紅字 = 叫人去查一個不存在的問題
    expect(j?.minutesAgo).toBeNull();
    expect(r.neverBeat).toEqual([]); // 有列 ⇒ 不是「從來沒寫過心跳」,那是另一種病
  });

  it('🔴 NULL 而失敗計數是 0 ⇒ 仍要亮,而句子不得假裝它失敗過(對照上一格)', async () => {
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === 'pcm-settle-sweep' ? { ...r, last_success_at: null } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === 'pcm-settle-sweep');
    expect(j?.abnormal).toBe(true);
    expect(j?.note).toContain('從來沒有成功過');
    expect(j?.note).not.toContain('連續失敗');
  });

  // ══ R1 I2:失敗計數讀到的不是數字 ⇒ 要亮,不得靜靜變健康 ═════════════
  it('🔴🔴 consecutive_failures 不是數字 ⇒ 亮,而且與「沒有意義」分得開', async () => {
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === 'pcm-email-sweep' ? { ...r, consecutive_failures: '9' } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === 'pcm-email-sweep');
    expect(j?.abnormal).toBe(true); // 修之前這裡是 false ——「靜靜變健康」
    expect(j?.consecutiveFailuresUnreadable).toBe(true);
    expect(j?.consecutiveFailures).toBeNull();
    expect(j?.note).toContain('失敗計數讀不出來');
    // 🔴 對照:逾期取消那一支的 null 是【設計上沒有意義】,不得被標成讀不出來
    const expire = r.jobs.find((x) => x.jobName === 'pcm-expire-unpaid-orders');
    expect(expire?.consecutiveFailures).toBeNull();
    expect(expire?.consecutiveFailuresUnreadable).toBe(false);
    expect(expire?.abnormal).toBe(false);
  });

  it('🔴 白名單有、表裡沒有 ⇒ 進 neverBeat,而句子說「從來沒寫過」不是「太久沒跑」', async () => {
    withRows(ALL_HEALTHY.filter((r) => r.job_name !== 'pcm-expire-unpaid-orders'));
    const r = await loadCronHeartbeats(NOW);
    expect(r.neverBeat).toEqual(['pcm-expire-unpaid-orders']); // 印名字,不是印計數
    const j = r.jobs.find((x) => x.jobName === 'pcm-expire-unpaid-orders');
    expect(j?.abnormal).toBe(true);
    expect(j?.note).toContain('從來沒寫過心跳');
    expect(j?.minutesAgo).toBeNull(); // 🔴 絕不得兜成 0
  });

  it('🔴 表裡有、白名單沒有 ⇒ 進 unknownJobs(白名單過期),而不是被靜靜忽略', async () => {
    withRows([...ALL_HEALTHY, { job_name: 'pcm-brand-new-job', last_success_at: ago(1), consecutive_failures: 0 }]);
    const r = await loadCronHeartbeats(NOW);
    expect(r.unknownJobs).toEqual(['pcm-brand-new-job']);
    expect(r.neverBeat).toEqual([]); // 兩種漂移是兩格,不得互相污染
  });

  it('🔴 有那一列而時間戳解不出來 ⇒ 亮,句子與「從來沒寫過」不同', async () => {
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === 'pcm-email-sweep' ? { ...r, last_success_at: '不是時間' } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === 'pcm-email-sweep');
    expect(j?.abnormal).toBe(true);
    expect(j?.minutesAgo).toBeNull();
    expect(j?.note).toContain('讀不出來');
    expect(j?.note).not.toContain('從來沒寫過');
    expect(r.neverBeat).toEqual([]); // 有列,只是值壞 ⇒ 不算 neverBeat
  });

  it('🔴 查詢回 error ⇒ 印「量不到」的原因,不留白;而且【不拋】', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    withRows(null, new Error('boom'));
    const r = await loadCronHeartbeats(NOW);
    expect(r.unreadableReason).toBe('查詢失敗');
    expect(r.jobs).toEqual([]);
    expect(spy).toHaveBeenCalled(); // 靜默吞掉的話線上永遠不知道這格壞了
  });

  it('🔴 transport 層真的 reject(網路斷)⇒ 一樣接成值,不得把首頁帶走', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    withReject(new Error('ECONNRESET'));
    const r = await loadCronHeartbeats(NOW);
    expect(r.unreadableReason).toBe('查詢失敗');
    expect(spy).toHaveBeenCalled();
  });

  it('unreadableReport 是「量不到」的唯一作者(呼叫端不得自己組一份同形狀的)', () => {
    expect(unreadableReport('測試原因')).toEqual({
      jobs: [],
      neverBeat: [],
      unknownJobs: [],
      unreadableReason: '測試原因',
    });
  });
});

describe('🔴 那個【自己癒合的紅點】—— 失敗過的事實不得在下一輪成功時消失', () => {
  // 病灶(2026-09-02 正式庫唯讀量到, 而它當時就在發生):
  //   pcm-settle-sweep  last_success 09-01 19:00 · last_failure **09-01 17:16** · consecutive_failures **0**
  //   ⇒ 舊版只 SELECT last_success_at 與 consecutive_failures ⇒ 兩個都是好的 ⇒ **畫成綠的**
  //   ⇒ 而「兩小時前失敗過」這件事在畫面上不存在。
  const TARGET = 'pcm-settle-sweep';

  it('🔴 現在健康、而 N 分鐘前失敗過 ⇒ note 要【兩句都說】', async () => {
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === TARGET ? { ...r, last_failure_at: ago(134) } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === TARGET);
    expect(j, '找不到那一列').toBeDefined();
    expect(j!.note, 'note 沒說「現在健康」那一句').toContain('分前成功');
    expect(j!.note, '🔴 note 沒說「失敗過」—— 那正是會消失的那件事').toContain('失敗過一次');
    expect(j!.lastFailureMinutesAgo).toBe(134);
  });

  it('🛑 而它【不得】讓那一列變紅 —— 已經復原的失敗不是警報', async () => {
    // 理由:一次已復原的失敗亮紅 = 假警報, 而本檔逐字記過「天天叫的告警 = 等於沒有告警」。
    // ⇒ 本片做的是【把消失的證據留下來】, 不是【多亮一盞燈】。
    withRows(
      ALL_HEALTHY.map((r) =>
        r.job_name === TARGET ? { ...r, last_failure_at: ago(134) } : r,
      ),
    );
    const r = await loadCronHeartbeats(NOW);
    expect(r.jobs.filter((j) => j.abnormal)).toEqual([]);
  });

  it('🔴 SELECT 真的把 last_failure_at 讀進來了(不是只改判定)', async () => {
    // 🛑 這一格是突變逼出來的:把 last_failure_at 從 .select() 拿掉 ⇒ 上面那幾格【全綠】,
    //    因為 mock 的 select 丟掉了參數 ⇒ 它們讀的是我餵進去的 row, 不是真的查詢。
    //    ⇒ 📌 而那正是本片要修的病:**沒有去讀的那一欄, 在下游長得像「沒有值」。**
    withRows(ALL_HEALTHY);
    await loadCronHeartbeats(NOW);
    expect(lastSelect, '沒有攔到 select 的參數 ⇒ 這一格證不了東西').not.toBeNull();
    expect(lastSelect, '🔴 SELECT 沒有讀 last_failure_at').toContain('last_failure_at');
    // 🔵 正對照:那個字串真的是欄位清單(不是被我攔到別的東西)。
    expect(lastSelect).toContain('last_success_at');
    expect(lastSelect).toContain('consecutive_failures');
  });

  it('🔵 負對照:從來沒失敗過 ⇒ note 【不得】出現那一句', async () => {
    withRows(ALL_HEALTHY);
    const r = await loadCronHeartbeats(NOW);
    const j = r.jobs.find((x) => x.jobName === TARGET);
    expect(j!.note).not.toContain('失敗過一次');
    expect(j!.lastFailureMinutesAgo).toBeNull();
  });
});
