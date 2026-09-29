// components/SiteAnalytics.tsx —— Vercel Web Analytics 與 Speed Insights,只在一般站載入。
//
// 一般站(2026-09-15 Sean Q10)有開 Web Analytics。經銷站那個 Vercel 專案沒有開,
// 載入的話每一頁都會去抓分析程式而拿到 404。Pro 方案的 Analytics 沒有免費額度,所以不去開經銷站的,
// 改成經銷站不載入(研究 `~/pcm-mailbox/研究-Vercel零成本優化-20260928.md` 第 3 項甲)。
//
// Speed Insights(2026-09-29 Sean 批甲):量真實客人的 LCP / INP / CLS, 只用免費版。
//   正式環境從同網域 `/_vercel/speed-insights/script.js` 載入、回傳也打同網域 ⇒ CSP 的 `'self'` 已涵蓋, next.config 不用改。
//   經銷站同上理由不載入。
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { resolveSiteMode } from '@/lib/site-mode';

export function SiteAnalytics() {
  if (resolveSiteMode() === 'b2b') return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
