// lib/site-mode.ts —— 這一次部署是「一般站」還是「經銷站」(B2B 計畫 §2.1–2.2、片 4)。
//
// 同一份程式碼開成兩個 Vercel 專案:一般站不設(或設 retail),經銷站 b2b.pcmmotorsports.com 設 `NEXT_PUBLIC_SITE_MODE=b2b`。
// `NEXT_PUBLIC_*` 在建置時寫進程式,兩個專案各自建置,所以不會互相串到。
//
// 🔴 認不得的值一律當成經銷站:經銷站打錯字若變成一般站,整站會被搜尋引擎收錄、而且沒人會發現;
//   一般站打錯字變成經銷站,全站被擋,當天就會被發現。寧可擋錯,不可放錯。
export type SiteMode = 'retail' | 'b2b';

export function resolveSiteMode(raw: string | undefined = process.env.NEXT_PUBLIC_SITE_MODE): SiteMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'retail') return 'retail';
  return 'b2b';
}

export const isB2bSite = (): boolean => resolveSiteMode() === 'b2b';
