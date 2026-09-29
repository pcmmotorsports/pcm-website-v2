// bing-weekly.test.ts — Bing 週報讀取器與比較規則(計畫 ~/pcm-mailbox/計畫-Bing週報LINE-20260929.md 第 11～14 節)。
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  formatBingWeeklyLine,
  readBingWeekly,
  summarizeBingWeekly,
  type BingDailyStat,
  type BingFetch,
} from './bing-weekly';

const NOW = new Date('2026-10-05T01:05:00Z'); // 週一 台北 09:05

/** 產生一列每日統計;沒給的欄位都是 0, 收錄與 robots 給一個穩定的總數。 */
function day(date: string, over: Partial<BingDailyStat> = {}): BingDailyStat {
  return {
    date,
    crawlErrors: 0,
    code4xx: 0,
    code5xx: 0,
    dnsFailures: 0,
    connectionTimeout: 0,
    containsMalware: 0,
    blockedByRobotsTxt: 4,
    inIndex: 2800,
    ...over,
  };
}

/** 09-21～10-04 共 14 天, 每天同一組數字(= 沒有變化)。 */
function twoQuietWeeks(over: Partial<BingDailyStat> = {}): BingDailyStat[] {
  const out: BingDailyStat[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 8, 21 + i));
    out.push(day(d.toISOString().slice(0, 10), over));
  }
  return out;
}

/** 只改「這 7 天」(後 7 列)的欄位。 */
function withThisWeek(rows: BingDailyStat[], over: Partial<BingDailyStat>): BingDailyStat[] {
  return rows.map((r, i) => (i >= 7 ? { ...r, ...over } : r));
}

describe('summarizeBingWeekly — 判斷順序與門檻', () => {
  it('兩週一樣 ⇒ ok、沒有問題;區間照日期切(09-28～10-04)', () => {
    const r = summarizeBingWeekly(twoQuietWeeks(), [], NOW);
    expect(r).toEqual({ result: expect.objectContaining({ kind: 'ok', from: '09-28', to: '10-04', problems: [] }) });
  });

  it('🔴 最新一列超過 3 天 ⇒ stale(排在「天數不足」之前)', () => {
    const rows = twoQuietWeeks().slice(0, 9); // 最新 09-29, 距 10-05 六天
    expect(summarizeBingWeekly(rows, [], NOW)).toEqual({ result: { kind: 'stale', lastDate: '09-29' } });
    // 剛好 3 天不算過期
    const three = twoQuietWeeks().slice(0, 12); // 最新 10-02
    expect(summarizeBingWeekly(three, [], NOW).result?.kind).toBe('ok');
  });

  it('任一區間少於 5 天 ⇒ null(too_few_days);剛好 5 天可以', () => {
    const rows = twoQuietWeeks();
    const prevFour = [...rows.slice(3, 7), ...rows.slice(7)]; // 前 7 天只剩 4 天
    expect(summarizeBingWeekly(prevFour, [], NOW)).toEqual({ result: null, reason: 'too_few_days' });
    const prevFive = [...rows.slice(2, 7), ...rows.slice(7)];
    expect(summarizeBingWeekly(prevFive, [], NOW).result?.kind).toBe('ok');
  });

  it('同一天重複出現 ⇒ 只算一次(不讓 3 個日期各兩列湊成 6 天)', () => {
    const rows = twoQuietWeeks();
    const three = [...rows.slice(4, 7), ...rows.slice(4, 7), ...rows.slice(7)]; // 前 7 天只有 3 個日期, 各重複一次
    expect(summarizeBingWeekly(three, [], NOW)).toEqual({ result: null, reason: 'too_few_days' });
  });

  it('🔴 比的是每日平均, 不是加總:前 7 天缺 2 天不會被放大成問題', () => {
    const rows = twoQuietWeeks({ crawlErrors: 10 });
    const prevFive = [...rows.slice(2, 7), ...rows.slice(7)];
    expect(summarizeBingWeekly(prevFive, [], NOW).result).toMatchObject({ problems: [] });
  });

  it('爬取錯誤:每日平均多 50% 以上且至少多 2 ⇒ 問題;剛好沒超過 ⇒ 不是', () => {
    const base = twoQuietWeeks({ crawlErrors: 4 });
    const hit = summarizeBingWeekly(withThisWeek(base, { crawlErrors: 6 }), [], NOW).result;
    expect(hit).toMatchObject({ problems: ['爬取錯誤每日 6（上週 4）'] });
    // 多 50% 但只多 1
    const small = summarizeBingWeekly(withThisWeek(twoQuietWeeks({ crawlErrors: 2 }), { crawlErrors: 3 }), [], NOW).result;
    expect(small).toMatchObject({ problems: [] });
    // 多 2 但不到 50%
    const ratio = summarizeBingWeekly(withThisWeek(twoQuietWeeks({ crawlErrors: 10 }), { crawlErrors: 12 }), [], NOW).result;
    expect(ratio).toMatchObject({ problems: [] });
  });

  it('找不到的頁面(4xx)同一條門檻', () => {
    const r = summarizeBingWeekly(withThisWeek(twoQuietWeeks({ code4xx: 4 }), { code4xx: 12 }), [], NOW).result;
    expect(r).toMatchObject({ problems: ['找不到的頁面每日 12（上週 4）'] });
  });

  it('5xx / DNS / 逾時:這 7 天有、前 7 天是 0 ⇒ 問題;前 7 天也有 ⇒ 不是', () => {
    const rows = twoQuietWeeks();
    rows[10] = { ...rows[10]!, code5xx: 3, dnsFailures: 1, connectionTimeout: 2 };
    expect(summarizeBingWeekly(rows, [], NOW).result).toMatchObject({
      problems: ['伺服器錯誤 7 天 3 筆（上週 0）', 'DNS 失敗 7 天 1 筆（上週 0）', '連線逾時 7 天 2 筆（上週 0）'],
    });
    rows[2] = { ...rows[2]!, code5xx: 1, dnsFailures: 1, connectionTimeout: 1 };
    expect(summarizeBingWeekly(rows, [], NOW).result).toMatchObject({ problems: [] });
  });

  it('惡意程式:最新一列 > 0 ⇒ 問題', () => {
    const rows = twoQuietWeeks();
    rows[13] = { ...rows[13]!, containsMalware: 2 };
    expect(summarizeBingWeekly(rows, [], NOW).result).toMatchObject({ problems: ['Bing 標示含惡意程式 2 頁'] });
  });

  it('robots.txt 擋掉的頁數:最新比前 7 天區間最後一列多 ⇒ 問題', () => {
    const r = summarizeBingWeekly(withThisWeek(twoQuietWeeks(), { blockedByRobotsTxt: 9 }), [], NOW).result;
    expect(r).toMatchObject({ problems: ['robots.txt 擋掉的頁面 4→9'] });
  });

  it('收錄頁數:少 10% 以上 ⇒ 問題;剛好 10% 以內 ⇒ 不是;基準是 0 ⇒ 不判斷', () => {
    const drop = summarizeBingWeekly(withThisWeek(twoQuietWeeks({ inIndex: 1000 }), { inIndex: 899 }), [], NOW).result;
    expect(drop).toMatchObject({ problems: ['已收錄頁數 1,000→899（-10%）'] });
    const edge = summarizeBingWeekly(withThisWeek(twoQuietWeeks({ inIndex: 1000 }), { inIndex: 900 }), [], NOW).result;
    expect(edge).toMatchObject({ problems: [] });
    const zero = summarizeBingWeekly(withThisWeek(twoQuietWeeks({ inIndex: 0 }), { inIndex: 0 }), [], NOW).result;
    expect(zero).toMatchObject({ problems: [] });
  });

  it('被 Bing 列為問題的網址:有就印件數與第一個路徑(壓成一行、最多 60 字)', () => {
    const long = `https://pcmmotorsports.com/products/${'x'.repeat(80)}`;
    const r = summarizeBingWeekly(twoQuietWeeks(), [long, 'https://pcmmotorsports.com/a'], NOW).result;
    expect(r?.kind).toBe('ok');
    const p = (r as { problems: string[] }).problems[0]!;
    expect(p.startsWith('有 2 個網址被 Bing 列為問題（第一個 /products/xxx')).toBe(true);
    const path = p.slice(p.indexOf('/'), p.lastIndexOf('）'));
    expect([...path].length).toBeLessThanOrEqual(60);
    expect(path.endsWith('…')).toBe(true);
  });
});

describe('formatBingWeeklyLine — LINE 那一句', () => {
  it('ok 沒問題 ⇒ 附兩週基準數字', () => {
    const rows = withThisWeek(twoQuietWeeks({ crawlErrors: 25, inIndex: 2435 }), { inIndex: 2884 });
    expect(formatBingWeeklyLine(summarizeBingWeekly(rows, [], NOW))).toBe(
      'Bing 09-28～10-04：沒有新問題（爬取錯誤每日 25、上週 25；收錄 2,884、上週末 2,435）',
    );
  });

  it('ok 有問題 ⇒ 最多列三項, 多的寫「等 N 項」, 後面仍附基準', () => {
    const rows = twoQuietWeeks({ crawlErrors: 4, code4xx: 4 });
    const bad = withThisWeek(rows, { crawlErrors: 20, code4xx: 20, containsMalware: 1, blockedByRobotsTxt: 8 });
    const line = formatBingWeeklyLine(summarizeBingWeekly(bad, [], NOW));
    expect(line).toBe(
      'Bing 09-28～10-04：爬取錯誤每日 20（上週 4）、找不到的頁面每日 20（上週 4）、Bing 標示含惡意程式 1 頁等 4 項（爬取錯誤每日 20、上週 4；收錄 2,800、上週末 2,800）',
    );
  });

  it('stale ⇒ 資料停在哪一天', () => {
    expect(formatBingWeeklyLine({ result: { kind: 'stale', lastDate: '09-20' } })).toBe('Bing 資料停在 09-20，本週無法判斷。');
  });

  it('🔴 null ⇒ 讀不到那一句(R5 必修 2);401/403 另外提示金鑰', () => {
    expect(formatBingWeeklyLine({ result: null, reason: 'timeout' })).toBe('這週讀不到 Bing 的資料，下週一會再試。');
    expect(formatBingWeeklyLine({ result: null, reason: 'http_403' })).toBe(
      '這週讀不到 Bing 的資料（金鑰可能失效），請檢查 Bing 設定。',
    );
  });
});

/** 假 fetch:依網址回兩支 API 的內容。 */
function fakeFetch(opts: {
  stats?: unknown;
  issues?: unknown;
  status?: number;
  throwErr?: Error;
}): { f: BingFetch; urls: string[] } {
  const urls: string[] = [];
  const f: BingFetch = async (url) => {
    urls.push(url);
    if (opts.throwErr) throw opts.throwErr;
    const body = url.includes('/GetCrawlStats') ? opts.stats : opts.issues;
    return { ok: (opts.status ?? 200) < 300, status: opts.status ?? 200, json: async () => body };
  };
  return { f, urls };
}

/** Bing 原始 JSON 的一列(日期是 /Date(毫秒)/,可帶時區偏移)。 */
function raw(date: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const ms = Date.parse(`${date}T07:00:00Z`);
  return {
    Date: `/Date(${ms}-0700)/`,
    CrawlErrors: 0, Code4xx: 0, Code5xx: 0, DnsFailures: 0, ConnectionTimeout: 0,
    ContainsMalware: 0, BlockedByRobotsTxt: 4, InIndex: 2800, CrawledPages: 300,
    ...over,
  };
}

const RAW_ROWS = twoQuietWeeks().map((r) => raw(r.date));
const SIGNAL = new AbortController().signal;

describe('readBingWeekly — 呼叫與格式檢查', () => {
  it('正常 ⇒ 兩支 API 都打, 網址帶 siteUrl 與金鑰, 結果 ok', async () => {
    const { f, urls } = fakeFetch({ stats: { d: RAW_ROWS }, issues: { d: [] } });
    const r = await readBingWeekly({ apiKey: 'K', siteUrl: 'https://pcmmotorsports.com/', now: NOW, fetchFn: f, signal: SIGNAL });
    expect(r.result?.kind).toBe('ok');
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes('siteUrl=https%3A%2F%2Fpcmmotorsports.com%2F') && u.includes('apikey=K'))).toBe(true);
  });

  it.each([
    ['d 不是陣列', { d: 'x' }, 'bad_shape'],
    ['欄位不是數字', { d: [raw('2026-10-04', { CrawlErrors: 'many' })] }, 'bad_shape'],
    ['日期格式不對', { d: [raw('2026-10-04', { Date: '2026-10-04' })] }, 'bad_shape'],
    ['HTTP 200 帶錯誤內容', { ErrorCode: 3, Message: 'InvalidApiKey' }, 'bing_error_body'],
  ])('🔴 %s ⇒ null, 不算成「沒有新問題」', async (_n, stats, reason) => {
    const { f } = fakeFetch({ stats, issues: { d: [] } });
    const r = await readBingWeekly({ apiKey: 'K', siteUrl: 'https://s/', now: NOW, fetchFn: f, signal: SIGNAL });
    expect(r).toEqual({ result: null, reason });
  });

  it.each([
    [401, 'http_401'],
    [403, 'http_403'],
    [500, 'http_other'],
  ])('HTTP %i ⇒ null(%s)', async (status, reason) => {
    const { f } = fakeFetch({ status });
    const r = await readBingWeekly({ apiKey: 'K', siteUrl: 'https://s/', now: NOW, fetchFn: f, signal: SIGNAL });
    expect(r).toEqual({ result: null, reason });
  });

  it('逾時 ⇒ timeout;其他錯誤 ⇒ network', async () => {
    const timeout = Object.assign(new Error('x'), { name: 'TimeoutError' });
    expect(
      await readBingWeekly({ apiKey: 'K', siteUrl: 'https://s/', now: NOW, fetchFn: fakeFetch({ throwErr: timeout }).f, signal: SIGNAL }),
    ).toEqual({ result: null, reason: 'timeout' });
    expect(
      await readBingWeekly({ apiKey: 'K', siteUrl: 'https://s/', now: NOW, fetchFn: fakeFetch({ throwErr: new Error('ECONNRESET') }).f, signal: SIGNAL }),
    ).toEqual({ result: null, reason: 'network' });
  });

  it('爬取問題清單格式不對 ⇒ null(bad_shape)', async () => {
    const { f } = fakeFetch({ stats: { d: RAW_ROWS }, issues: { d: [{ Url: 5 }] } });
    const r = await readBingWeekly({ apiKey: 'K', siteUrl: 'https://s/', now: NOW, fetchFn: f, signal: SIGNAL });
    expect(r).toEqual({ result: null, reason: 'bad_shape' });
  });
});
