// lib/site-mode.ts —— 這一次部署是「一般站」還是「經銷站」(B2B 計畫 §2.1–2.2、片 4)。
//
// 同一份程式碼開成兩個 Vercel 專案:一般站不設(或設 retail),經銷站 b2b.pcmmotorsports.com 設 `NEXT_PUBLIC_SITE_MODE=b2b`。
// `NEXT_PUBLIC_*` 在建置時寫進程式,兩個專案各自建置,所以不會互相串到。
//
// 🔴 認不得的值直接丟錯,不猜(B2B 計畫第四版片 4、Fable R1 consider 4):
//   經銷站外觀與一般站幾乎相同,猜成哪一邊都沒有人看得出來 ——
//   經銷站被當成一般站 ⇒ 整站被收錄、經銷商登不進去;一般站被當成經銷站 ⇒ 整站慢慢被搜尋引擎除名。
//   `app/layout.tsx` 的 metadata 在模組載入時就呼叫這支 ⇒ 設錯時建置直接失敗。
export type SiteMode = 'retail' | 'b2b';

export function resolveSiteMode(raw: string | undefined = process.env.NEXT_PUBLIC_SITE_MODE): SiteMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'retail') return 'retail';
  if (v === 'b2b') return 'b2b';
  throw new Error(`NEXT_PUBLIC_SITE_MODE 只能是 retail、b2b 或不設,目前是「${raw}」`);
}

export const isB2bSite = (): boolean => resolveSiteMode() === 'b2b';
