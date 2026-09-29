// bing-weekly.ts — Bing 週報:讀 Bing Webmaster API、跟前 7 天比、組 LINE 那一句(2026-09-29)。
//
// 計畫:~/pcm-mailbox/計畫-Bing週報LINE-20260929.md(第 11～14 節;Sean 09-29 選甲 = 獨立的每週一排程)。
// 呼叫端:apps/storefront/src/app/api/cron/bing-weekly/route.ts。
//
// 🔴 三種結果分清楚:ok(讀到而且夠新)/ stale(讀到但資料停在某一天)/ null(讀不到)。
//    讀不到與過期【都不可以】印成「沒有新問題」。
// 🔴 金鑰在網址參數裡 ⇒ 本檔不記任何 log、不回傳錯誤物件;只回固定的 reason 字串給 route 印。
// 🔴 寫成純函式 + 參數注入 fetch(不是 class 的 this.fetchImpl):逾時由呼叫端的 signal 決定,
//    避開 outbound-timeout.test.ts 對 `this.fetchImpl(` 的掃描(那條規則管的是 10 秒的送出類呼叫)。
//
// 欄位意思:官方文件只列欄位名稱(learn.microsoft.com … iwebmasterapi.getcrawlstats,
//   Returns「List of crawl statistics for the last 6 months」)。下面的分類是看 09-15～09-28 的
//   13 天資料推的,吻合但未證實:CrawlErrors / Code4xx / Code5xx / DnsFailures / ConnectionTimeout
//   是每天的數字;InIndex / BlockedByRobotsTxt 是當下總數。所以每天的欄位比「每日平均」,
//   總數欄位比「最新值 vs 前 7 天區間最後一列」。LINE 那一句一律附兩週數字, 上線後拿 Bing 後台核對。
import 'server-only';

const BING_API = 'https://ssl.bing.com/webmaster/api.svc/json';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 最新一列距今超過這麼多天 ⇒ stale。 */
const STALE_AFTER_DAYS = 3;
/** 每個 7 天區間至少要有幾天的資料。 */
const MIN_DAYS_PER_RANGE = 5;
/** LINE 那一句最多列幾項問題。 */
const MAX_PROBLEMS_SHOWN = 3;
/** 問題網址路徑最多幾個字(LINE 一則上限 5,000 字, 一個長網址不能把整則撐爆)。 */
const MAX_PATH_CHARS = 60;

export type BingDailyStat = {
  /** UTC 日 YYYY-MM-DD。 */
  date: string;
  crawlErrors: number;
  code4xx: number;
  code5xx: number;
  dnsFailures: number;
  connectionTimeout: number;
  containsMalware: number;
  blockedByRobotsTxt: number;
  inIndex: number;
};

export type BingWeekly =
  | { kind: 'ok'; from: string; to: string; problems: string[]; baseline: string }
  | { kind: 'stale'; lastDate: string }
  | null;

export type BingReadReason =
  | 'http_401'
  | 'http_403'
  | 'http_other'
  | 'timeout'
  | 'network'
  | 'bad_shape'
  | 'bing_error_body'
  | 'too_few_days';

export type BingReadOutcome = { result: BingWeekly; reason?: BingReadReason };

export type BingFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const num = (n: number) => n.toLocaleString('en-US');
const mmdd = (isoDate: string) => isoDate.slice(5);

// ── 解析 ──────────────────────────────────────────────

const DATE_RE = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/;
const STAT_FIELDS = {
  crawlErrors: 'CrawlErrors',
  code4xx: 'Code4xx',
  code5xx: 'Code5xx',
  dnsFailures: 'DnsFailures',
  connectionTimeout: 'ConnectionTimeout',
  containsMalware: 'ContainsMalware',
  blockedByRobotsTxt: 'BlockedByRobotsTxt',
  inIndex: 'InIndex',
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: BingReadReason };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Bing 回 HTTP 200 也可能是 `{ErrorCode, Message}`;其餘一律要有 `d` 陣列。 */
function unwrap(body: unknown): Parsed<unknown[]> {
  if (isRecord(body) && 'ErrorCode' in body) return { ok: false, reason: 'bing_error_body' };
  if (!isRecord(body) || !Array.isArray(body.d)) return { ok: false, reason: 'bad_shape' };
  return { ok: true, value: body.d };
}

function parseStats(body: unknown): Parsed<BingDailyStat[]> {
  const d = unwrap(body);
  if (!d.ok) return d;
  const out: BingDailyStat[] = [];
  for (const row of d.value) {
    if (!isRecord(row) || typeof row.Date !== 'string') return { ok: false, reason: 'bad_shape' };
    const m = DATE_RE.exec(row.Date);
    if (!m) return { ok: false, reason: 'bad_shape' };
    const stat = { date: new Date(Number(m[1])).toISOString().slice(0, 10) } as BingDailyStat;
    for (const [key, field] of Object.entries(STAT_FIELDS) as Array<[keyof typeof STAT_FIELDS, string]>) {
      const v = row[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: 'bad_shape' };
      stat[key] = v;
    }
    out.push(stat);
  }
  return { ok: true, value: out };
}

function parseIssueUrls(body: unknown): Parsed<string[]> {
  const d = unwrap(body);
  if (!d.ok) return d;
  const out: string[] = [];
  for (const row of d.value) {
    if (!isRecord(row) || typeof row.Url !== 'string') return { ok: false, reason: 'bad_shape' };
    out.push(row.Url);
  }
  return { ok: true, value: out };
}

// ── 比較 ──────────────────────────────────────────────

const sum = (rows: BingDailyStat[], k: keyof Omit<BingDailyStat, 'date'>) => rows.reduce((a, r) => a + r[k], 0);
const avg = (rows: BingDailyStat[], k: keyof Omit<BingDailyStat, 'date'>) => sum(rows, k) / rows.length;

/** 網址只留路徑、壓成一行、最多 MAX_PATH_CHARS 字。 */
function shortPath(url: string): string | null {
  try {
    const flat = new URL(url).pathname.replace(/\s+/g, ' ');
    const chars = [...flat];
    return chars.length > MAX_PATH_CHARS ? `${chars.slice(0, MAX_PATH_CHARS - 1).join('')}…` : flat;
  } catch {
    return null;
  }
}

/** 判斷順序(計畫 11.2):過期 → 天數不足 → 比較。格式檢查在 parse 那一層。 */
export function summarizeBingWeekly(stats: BingDailyStat[], issueUrls: string[], now: Date): BingReadOutcome {
  if (stats.length === 0) return { result: null, reason: 'too_few_days' };
  const rows = [...stats].sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1]!;
  const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
  const todayMs = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if ((todayMs - latestMs) / DAY_MS > STALE_AFTER_DAYS) {
    return { result: { kind: 'stale', lastDate: mmdd(latest.date) } };
  }

  const inRange = (fromDays: number, toDays: number) =>
    rows.filter((r) => {
      const age = (latestMs - Date.parse(`${r.date}T00:00:00Z`)) / DAY_MS;
      return age >= fromDays && age <= toDays;
    });
  const thisWeek = inRange(0, 6);
  const prevWeek = inRange(7, 13);
  if (thisWeek.length < MIN_DAYS_PER_RANGE || prevWeek.length < MIN_DAYS_PER_RANGE) {
    return { result: null, reason: 'too_few_days' };
  }
  const prevLast = prevWeek[prevWeek.length - 1]!;

  const problems: string[] = [];
  // 每天的欄位:每日平均多 50% 以上而且至少多 2。
  for (const [k, label] of [
    ['crawlErrors', '爬取錯誤'],
    ['code4xx', '找不到的頁面'],
  ] as const) {
    const a = avg(thisWeek, k);
    const b = avg(prevWeek, k);
    if (a >= b * 1.5 && a - b >= 2) problems.push(`${label}每日 ${num(Math.round(a))}（上週 ${num(Math.round(b))}）`);
  }
  // 平常應該是 0 的:這 7 天有、前 7 天沒有。
  for (const [k, label] of [
    ['code5xx', '伺服器錯誤'],
    ['dnsFailures', 'DNS 失敗'],
    ['connectionTimeout', '連線逾時'],
  ] as const) {
    const a = sum(thisWeek, k);
    if (a > 0 && sum(prevWeek, k) === 0) problems.push(`${label} 7 天 ${num(a)} 筆（上週 0）`);
  }
  if (latest.containsMalware > 0) problems.push(`Bing 標示含惡意程式 ${num(latest.containsMalware)} 頁`);
  if (latest.blockedByRobotsTxt > prevLast.blockedByRobotsTxt) {
    problems.push(`robots.txt 擋掉的頁面 ${num(prevLast.blockedByRobotsTxt)}→${num(latest.blockedByRobotsTxt)}`);
  }
  // 基準是 0 不算百分比、不判斷(計畫 9.4)。
  if (prevLast.inIndex > 0 && latest.inIndex < prevLast.inIndex * 0.9) {
    const pct = Math.round(((latest.inIndex - prevLast.inIndex) / prevLast.inIndex) * 100);
    problems.push(`已收錄頁數 ${num(prevLast.inIndex)}→${num(latest.inIndex)}（${pct}%）`);
  }
  if (issueUrls.length > 0) {
    const first = shortPath(issueUrls[0]!);
    problems.push(`有 ${num(issueUrls.length)} 個網址被 Bing 列為問題${first ? `（第一個 ${first}）` : ''}`);
  }

  const baseline =
    `爬取錯誤每日 ${num(Math.round(avg(thisWeek, 'crawlErrors')))}、上週 ${num(Math.round(avg(prevWeek, 'crawlErrors')))}；` +
    `收錄 ${num(latest.inIndex)}、上週末 ${num(prevLast.inIndex)}`;
  return {
    result: { kind: 'ok', from: mmdd(thisWeek[0]!.date), to: mmdd(latest.date), problems, baseline },
  };
}

/** LINE 週報的第二行(第一行是標題, route 組)。 */
export function formatBingWeeklyLine(o: BingReadOutcome): string {
  const r = o.result;
  if (r === null) {
    return o.reason === 'http_401' || o.reason === 'http_403'
      ? '這週讀不到 Bing 的資料（金鑰可能失效），請檢查 Bing 設定。'
      : '這週讀不到 Bing 的資料，下週一會再試。';
  }
  if (r.kind === 'stale') return `Bing 資料停在 ${r.lastDate}，本週無法判斷。`;
  const head =
    r.problems.length === 0
      ? '沒有新問題'
      : `${r.problems.slice(0, MAX_PROBLEMS_SHOWN).join('、')}${r.problems.length > MAX_PROBLEMS_SHOWN ? `等 ${r.problems.length} 項` : ''}`;
  return `Bing ${r.from}～${r.to}：${head}（${r.baseline}）`;
}

// ── 讀取 ──────────────────────────────────────────────

async function getJson(url: string, fetchFn: BingFetch, signal: AbortSignal): Promise<Parsed<unknown>> {
  let res: Awaited<ReturnType<BingFetch>>;
  try {
    res = await fetchFn(url, { signal });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (!res.ok) {
    return { ok: false, reason: res.status === 401 ? 'http_401' : res.status === 403 ? 'http_403' : 'http_other' };
  }
  try {
    return { ok: true, value: await res.json() };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'bad_shape' };
  }
}

/** 讀兩支 API(同時打)並比較。任何一支失敗 ⇒ null + 固定 reason。本函式不丟錯。 */
export async function readBingWeekly(opts: {
  apiKey: string;
  siteUrl: string;
  now: Date;
  fetchFn: BingFetch;
  signal: AbortSignal;
}): Promise<BingReadOutcome> {
  const q = `siteUrl=${encodeURIComponent(opts.siteUrl)}&apikey=${encodeURIComponent(opts.apiKey)}`;
  const [statsRes, issuesRes] = await Promise.all([
    getJson(`${BING_API}/GetCrawlStats?${q}`, opts.fetchFn, opts.signal),
    getJson(`${BING_API}/GetCrawlIssues?${q}`, opts.fetchFn, opts.signal),
  ]);
  if (!statsRes.ok) return { result: null, reason: statsRes.reason };
  if (!issuesRes.ok) return { result: null, reason: issuesRes.reason };
  const stats = parseStats(statsRes.value);
  if (!stats.ok) return { result: null, reason: stats.reason };
  const issues = parseIssueUrls(issuesRes.value);
  if (!issues.ok) return { result: null, reason: issues.reason };
  return summarizeBingWeekly(stats.value, issues.value, opts.now);
}
