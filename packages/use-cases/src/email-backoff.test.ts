import { describe, expect, it } from 'vitest';
import type { EmailSendErrorCode } from '@pcm/ports';
import {
  computeEmailBackoff,
  computePrepareFailureBackoff,
  isQuotaExhaustionCode,
  LEASE_RECLAIM_RETRY_DELAY_MS,
} from './email-backoff';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const FAILED_AT = new Date('2026-07-17T10:00:00.000Z');

/**
 * 🔴 union 全集(`satisfies Record<EmailSendErrorCode, true>` 逼窮舉:union 增員漏補本表 →
 * typecheck 必紅、減員留冗鍵也紅;codex 關卡2 R1 nit —— 純陣列字面清單靠人記得同步、逼不了)。
 */
const ALL_CODES_MAP = {
  http_400: true,
  http_401: true,
  http_403: true,
  http_404: true,
  http_408: true,
  http_409: true,
  http_422: true,
  http_429: true,
  http_500: true,
  http_502: true,
  http_503: true,
  http_504: true,
  rate_limited: true,
  quota_daily_exceeded: true,
  quota_monthly_exceeded: true,
  network_error: true,
  provider_error: true,
  // ⟦b4-RESEND409⟧ 2026-09-07:Resend 的第三種 409(重試永遠不會成功)自己一格。
  idempotency_payload_mismatch: true,
} satisfies Record<EmailSendErrorCode, true>;

const ALL_CODES = Object.keys(ALL_CODES_MAP) as readonly EmailSendErrorCode[];

const QUOTA_CODES: readonly EmailSendErrorCode[] = [
  'quota_daily_exceeded',
  'quota_monthly_exceeded',
  'http_429',
];

/**
 * ⟦b4-RESEND409⟧ 自己一格的政策 —— **它不是 quota、也不是 exponential**。
 * 🔴 少了這一行, 下面那個 filter 會把它算進 `EXPONENTIAL_CODES`
 * ⇒ 📌 **那一格會斷言它走指數退避, 而那正是這一片要改掉的行為** —— 測試會替舊行為背書。
 */
const IDEMPOTENCY_CODES: readonly EmailSendErrorCode[] = ['idempotency_payload_mismatch'];

const EXPONENTIAL_CODES: readonly EmailSendErrorCode[] = ALL_CODES.filter(
  (c) => !QUOTA_CODES.includes(c) && !IDEMPOTENCY_CODES.includes(c) && c !== 'rate_limited',
);

function delayOf(code: EmailSendErrorCode, attempts: number, random: () => number): number {
  return computeEmailBackoff(code, attempts, FAILED_AT, random).getTime() - FAILED_AT.getTime();
}

describe('computeEmailBackoff — §⑨ 三列', () => {
  it.each(QUOTA_CODES.map((c) => [c] as const))(
    '%s:random=0 → 恰 +24h(下界字面;禁指數 = attempts 不影響)',
    (code) => {
      expect(delayOf(code, 1, () => 0)).toBe(DAY_MS);
      // §⑨ 字面=quota 列「禁指數退避」→ 引申:attempts 1 與 5 結果必須相同
      expect(delayOf(code, 5, () => 0)).toBe(DAY_MS);
    },
  );

  it.each(QUOTA_CODES.map((c) => [c] as const))(
    '%s:jitter 只加不減、上界 < +24h30m(≥24h 合約下界不破)',
    (code) => {
      const max = delayOf(code, 1, () => 0.999999);
      expect(max).toBeGreaterThanOrEqual(DAY_MS);
      expect(max).toBeLessThan(DAY_MS + 30 * MINUTE_MS);
    },
  );

  it('rate_limited:15 分 + jitter(0..5 分)、禁指數', () => {
    expect(delayOf('rate_limited', 1, () => 0)).toBe(15 * MINUTE_MS);
    expect(delayOf('rate_limited', 5, () => 0)).toBe(15 * MINUTE_MS);
    const max = delayOf('rate_limited', 1, () => 0.999999);
    expect(max).toBeGreaterThanOrEqual(15 * MINUTE_MS);
    expect(max).toBeLessThan(20 * MINUTE_MS);
  });
});

describe('computeEmailBackoff — 兜底列(指數 5min × 2^(attempts-1)、上限 2h)', () => {
  it.each([
    [1, 5 * MINUTE_MS],
    [2, 10 * MINUTE_MS],
    [3, 20 * MINUTE_MS],
    [4, 40 * MINUTE_MS],
    [5, 80 * MINUTE_MS],
    [6, 2 * HOUR_MS],
    [50, 2 * HOUR_MS],
  ] as const)('attempts=%i → %i ms', (attempts, expected) => {
    for (const code of EXPONENTIAL_CODES) {
      expect(delayOf(code, attempts, () => 0.5)).toBe(expected); // random 不參與兜底列
    }
  });

  it.each([
    [0, 5 * MINUTE_MS],
    [-3, 5 * MINUTE_MS],
    [Number.NaN, 5 * MINUTE_MS],
    [2.9, 10 * MINUTE_MS],
  ] as const)('非法/非整數 attempts=%s → 防禦性 clamp', (attempts, expected) => {
    expect(delayOf('provider_error', attempts, () => 0)).toBe(expected);
  });
});

describe('政策映射完整性', () => {
  it('union 全集恰 18 碼、每碼皆可計算出未來時點(窮舉 Record 的 runtime 對照)', () => {
    // ⛔ ~~17~~ ⇒ **18**(⟦b4-RESEND409⟧ 2026-09-07 加 `idempotency_payload_mismatch`)。
    expect(ALL_CODES).toHaveLength(18);
    for (const code of ALL_CODES) {
      const next = computeEmailBackoff(code, 1, FAILED_AT, () => 0);
      expect(next.getTime()).toBeGreaterThan(FAILED_AT.getTime());
    }
  });

  /**
   * ⟦b4-RESEND409⟧ —— **三種 409 各自的落點**(2026-09-07)。
   * 🔬 官方語意(https://resend.com/docs/api-reference/errors, 親讀):
   *    `concurrent_idempotent_requests` / `resource_locked` ⇒ 重試會成功 ⇒ 留在 `http_409`(指數)
   *    `invalid_idempotent_request`     ⇒ 官方逐字「Change your idempotency key or payload」
   *                                     ⇒ **重試永遠不會成功** ⇒ 自己一格, 等那把 key 的 24h 窗過期
   */
  it('🔴 第三種 409 走【跨 24h 窗】而不是指數 —— 指數只是把死信算得比較慢', () => {
    const d = delayOf('idempotency_payload_mismatch', 1, () => 0);
    expect(d).toBe(24 * 60 * MINUTE_MS);
    // 🔵 負對照:同一發若走指數, 第 1 次只有 5 分鐘 ⇒ 兩者差三個數量級, 這一格分得開。
    expect(delayOf('http_409', 1, () => 0)).toBe(5 * MINUTE_MS);
  });

  it('🔴 它【不算】額度用盡 —— 借 quota_24h 會汙染那個告警', () => {
    expect(isQuotaExhaustionCode('idempotency_payload_mismatch')).toBe(false);
    // 🟢 正對照:真的額度碼要是 true, 證明這把尺不是恆 false。
    expect(isQuotaExhaustionCode('quota_daily_exceeded')).toBe(true);
    expect(isQuotaExhaustionCode('http_429')).toBe(true);
  });

  it('🔵 前兩種 409 沒有被順手改掉 —— 它們是暫時衝突, 留在指數是對的', () => {
    expect(delayOf('http_409', 3, () => 0)).toBe(delayOf('http_500', 3, () => 0));
  });

  /**
   * 🔴 **抖動與 attempts 兩個維度**(codex 2026-09-07 nit)。
   * ⛔ 上面那幾格只餵 `attempts=1, random=0` ⇒ 📌 **把 jitter 整段刪掉, 它們照樣全綠。**
   */
  it('🔴 新政策帶抖動, 而抖動在 [0, 30 分) 之內', () => {
    const base = 24 * 60 * MINUTE_MS;
    expect(delayOf('idempotency_payload_mismatch', 1, () => 0)).toBe(base);
    // 🔵 random 接近 1 ⇒ 逼近上界而不到 —— 刪掉 jitter 這一格會紅。
    const hi = delayOf('idempotency_payload_mismatch', 1, () => 0.999999);
    expect(hi).toBeGreaterThan(base);
    expect(hi).toBeLessThan(base + 30 * MINUTE_MS);
  });

  it('🔴 它【不隨 attempts 變長】—— 它等的是供應商的窗, 不是我們的退讓', () => {
    const a1 = delayOf('idempotency_payload_mismatch', 1, () => 0);
    const a5 = delayOf('idempotency_payload_mismatch', 5, () => 0);
    expect(a5).toBe(a1);
    // 🔵 負對照:指數那一族【會】隨 attempts 變長 —— 證明這把尺分得出兩種行為。
    expect(delayOf('http_409', 5, () => 0)).toBeGreaterThan(delayOf('http_409', 1, () => 0));
  });

  it('lease 回收延遲 = 5 分(§⑩ 單值、非逐列;毒信慢燒節奏由 lease 長度主導)', () => {
    expect(LEASE_RECLAIM_RETRY_DELAY_MS).toBe(5 * MINUTE_MS);
  });
});

/**
 * ⟦mail-BACKOFFDIESSOONER⟧ 證不到格②:**把那一列的核心數字從【算式】變成【讀數】。**
 *
 * 那一列自陳(逐字):「**沒有跑過任何一次真的重試, 兩個數都是從常數與公式算出來的**」。
 * 而它同時指出兩個來源的寫法不同:
 *   · 板列寫【單次】 5 / 10 / 20 / 40 分
 *   · `sweep-email-outbox.ts` 的 docstring 寫【累積】 0 / 5 / 15 / 35 / 75 分
 * 🔴 **那不是兩個獨立來源, 是【一個來源的兩種呈現】** —— 其中一個是把另一個加起來的
 *    ⇒ 📌 **若那個加法錯了, 兩邊都不會叫。**
 *
 * 🛑 **本段的期望值【來自板列與 docstring 那兩串規格】, 不是把跑出來的抄回去。**
 * 🛑 **本段不動被測碼一個字, 也不改那 75** —— 對不上要停下報主視窗
 *    (那個 75 已經被兩條線引用過, 而且今晚以 `Q86` 端給 Sean 了)。
 *
 * ⚠️ **射程**:`max_attempts = 5`(`email-backoff.ts:15` 逐字)⇒ 正式路徑上 `attempts` 只走到 5。
 *    下面那格 cap 用 `attempts = 6` 是**為了驗接線**, **不是說正式環境會走到那裡**。
 */
describe('⟦mail-BACKOFFDIESSOONER⟧ 那條退避序列 —— 真的跑一次, 不算', () => {
  const T0 = new Date('2026-09-07T00:00:00.000Z');
  const minsAfter = (d: Date) => (d.getTime() - T0.getTime()) / MINUTE_MS;
  /** 第 n 次失敗之後要等多久(分)。 */
  const delayOf = (attempts: number) => minsAfter(computePrepareFailureBackoff(attempts, T0));

  // 🔴 分母:這把尺會動嗎 —— 少了它,「序列相符」與「它每次都回同一個數」印同一個綠。
  it('🔴 分母:五次的回傳【不是同一個值】(否則下面兩格恆真)', () => {
    const got = [1, 2, 3, 4, 5].map(delayOf);
    expect(new Set(got).size).toBe(5);
  });

  it('🔴 單次序列 = 板列那一串 5 / 10 / 20 / 40(前四次)', () => {
    expect([1, 2, 3, 4].map(delayOf)).toEqual([5, 10, 20, 40]);
  });

  it('🔴🔴 累積序列 = docstring 那一串 0 / 5 / 15 / 35 / 75 —— 而【75 就是那一列的主張】', () => {
    // 第 n 次嘗試發生在「前面 n-1 次失敗的等待」加總之後。
    const cumulative = [0, 1, 2, 3, 4].map((k) =>
      Array.from({ length: k }, (_, i) => delayOf(i + 1)).reduce((a, b) => a + b, 0),
    );
    expect(cumulative).toEqual([0, 5, 15, 35, 75]);
  });

  // ⚪ cap 要【兩個方向】—— 只驗「沒觸發」的話,
  //    「cap 沒作用」與「cap 根本沒接上」印同一個綠。
  it('⚪ cap 方向一:5 次之內【不觸發】 —— 第 5 次是 80 分, 未被截斷', () => {
    expect(delayOf(5)).toBe(80);
  });

  it('🔴 cap 方向二:推到它一定要出手的地方 ⇒ 真的被截在 2 小時', () => {
    // 未截斷時 attempts=6 應是 160 分(5 * 2^5)⇒ 截成 120。
    expect(delayOf(6)).toBe(120);
    expect(delayOf(9)).toBe(120);
  });
});
