// components/SiteAnalytics.tsx —— Vercel Web Analytics,只在一般站載入。
//
// 一般站(2026-09-15 Sean Q10)有開 Web Analytics。經銷站那個 Vercel 專案沒有開,
// 載入的話每一頁都會去抓分析程式而拿到 404。Pro 方案的 Analytics 沒有免費額度,所以不去開經銷站的,
// 改成經銷站不載入(研究 `~/pcm-mailbox/研究-Vercel零成本優化-20260928.md` 第 3 項甲)。
import { Analytics } from '@vercel/analytics/next';
import { resolveSiteMode } from '@/lib/site-mode';

export function SiteAnalytics() {
  return resolveSiteMode() === 'b2b' ? null : <Analytics />;
}
