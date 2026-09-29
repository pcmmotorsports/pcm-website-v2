// SiteAnalytics.test.tsx —— 經銷站不載入 Vercel Web Analytics(經銷站專案沒開,載入會每頁 404)。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/analytics/next', () => ({
  Analytics: () => <script data-testid='vercel-analytics' />,
}));
vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => <script data-testid='vercel-speed-insights' />,
}));

import { SiteAnalytics } from './SiteAnalytics';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SiteAnalytics', () => {
  it('經銷站 ⇒ 不輸出分析程式', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    expect(renderToStaticMarkup(<SiteAnalytics />)).toBe('');
    // 2026-09-29 Speed Insights 也一樣:經銷站那個專案沒開, 載入會每頁 404。
  });

  it.each(['retail', ''])('一般站(NEXT_PUBLIC_SITE_MODE=%j)⇒ 照常輸出', (mode) => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode);
    expect(renderToStaticMarkup(<SiteAnalytics />)).toContain('vercel-analytics');
    // 2026-09-29 Sean 批甲:一般站加 Vercel Speed Insights(免費版)量真實客人的 LCP / INP / CLS。
    expect(renderToStaticMarkup(<SiteAnalytics />)).toContain('vercel-speed-insights');
  });

  it('layout 只透過 SiteAnalytics 載入,不直接放 <Analytics />', () => {
    const src = readFileSync(join(__dirname, '../app/layout.tsx'), 'utf8');
    expect(src).toContain('<SiteAnalytics />');
    expect(src).not.toMatch(/<Analytics\b/);
    expect(src).not.toContain("from '@vercel/analytics");
  });
});
