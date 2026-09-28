import { describe, expect, it } from 'vitest';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// eslint-disable-next-line boundaries/dependencies
import nextConfig from '../../next.config';

// 後台安全標頭(2026-09-29;計畫 ~/pcm-mailbox/計畫-安全標頭-20260928.md)。
// 🔴 本檔守的是「後台 SSO 與 session 路由自己設的 Referrer-Policy: no-referrer 不被 next.config 蓋掉」:
//    Next 會以 next.config 的同名標頭為準、把路由的丟掉 ⇒ next.config 不能設任何路由自己 set 過的標頭。
// 只掃 apps/admin/src:packages/ 今天 0 處自己設標頭;哪天共用套件開始回 Response 並設同名標頭,這裡看不到。
const SRC = join(__dirname, '..');
const globalHeaders = async () => {
  const rules = (await nextConfig(PHASE_PRODUCTION_BUILD).headers?.()) ?? [];
  return rules.find((r) => r.source === '/:path*')?.headers ?? [];
};

describe('後台安全標頭', () => {
  it("全站有 nosniff、防嵌入('self')、權限與 CSP Report-Only", async () => {
    const headers = await globalHeaders();
    const valueOf = (key: string) => headers.find((h) => h.key === key)?.value;
    expect(valueOf('X-Content-Type-Options')).toBe('nosniff');
    expect(valueOf('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(valueOf('Content-Security-Policy')).toBe("frame-ancestors 'self'");
    expect(valueOf('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(valueOf('Content-Security-Policy-Report-Only')).toContain('report-uri https://www.pcmmotorsports.com/api/csp-report');
  });

  it('不送 X-Powered-By', () => {
    expect(nextConfig(PHASE_PRODUCTION_BUILD).poweredByHeader).toBe(false);
  });

  it('🔴 SSO 與 session 路由的 no-referrer 不被蓋掉:沒有任何路由自己設了 next.config 也在設的標頭', async () => {
    const keys = (await globalHeaders()).map((h) => h.key.toLowerCase());
    const files = readdirSync(SRC, { recursive: true })
      .filter((p): p is string => typeof p === 'string' && /\.(ts|tsx)$/.test(p) && !p.includes('.test.'));
    const code = (p: string) => readFileSync(join(SRC, p), 'utf8').toLowerCase();
    // 前置錨點:掃描真的看得到 SSO 與 session 那三支檔(七處)自己設的 no-referrer(否則「沒有衝突」恆真)。
    const referrerSetters = files.filter((p) => code(p).includes("headers.set('referrer-policy', 'no-referrer')"));
    expect(referrerSetters.length).toBeGreaterThanOrEqual(3);
    const clash = files.flatMap((p) =>
      keys.filter((k) => code(p).includes(`'${k}'`) || code(p).includes(`"${k}"`)).map((k) => `${p}: ${k}`),
    );
    expect(clash).toEqual([]);
  });
});
