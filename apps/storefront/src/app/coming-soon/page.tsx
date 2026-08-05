// app/coming-soon/page.tsx — 整站上線前的「即將上線」頁(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `coming-soon.html`(無參數變體)+ `coming-soon-handoff.md` §二表格第一列。
// Sean 2026-08-05 逐字:「上線就先用這個頁面」。
//
// 🔴 **這一頁刻意沒有天地(頁首導航 / 站內連結)**,不是漏做 —— 交接單驗收 #14 明列。
//    理由:整站上線前其他頁面都還沒就緒,擺站內連結點了只會 404。
//    ⇒ 本頁**不 import** `<Header>` / `<HomeFooter>`(本站的殼是逐頁 import、不是 layout 注入,
//    所以「不 import」就真的沒有);`<MobileTabBar>` 掛在根 layout、擋不掉 import,
//    改由 `MobileTabBar.tsx` 的 hidden 判定認這條路由(守門在 `styles/coming-soon.test.ts`)。
//
// 🔴 **`noindex` 這一頁要、`/stores` `/install` 不要**(交接單 §三「兩個 meta 差異(容易漏)」):
//    這頁現在不是對外首頁,不希望被 Google 收錄成 PCM 的正式內容。
//    ⚠️ **真的要拿它當對外首頁時,記得移除下面的 robots 欄**(交接單 §六驗收 #11 反過來就是這條)。
//
// 內容分級 L1(文案年 0-1 次改動、hardcode 可)。字面來源:眉標 = 首頁 hero 輪播 COPY 逐字;
// 說明第一句「數十個改裝品牌」= Sean 2026-08-05 由「二十個」改(理由:「我們品牌還很多沒上」)。

import type { Metadata } from 'next';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = {
  title: '即將上線 — PCM MOTOR PARTS 重機零件與改裝精品',
  description:
    'PCM MOTOR PARTS 新網站整備中。數十個改裝品牌、依車款精準匹配。零件照樣出貨、安裝照樣約 —— 先用 LINE 找我們。',
  robots: { index: false, follow: true },
  openGraph: {
    title: '即將上線 — PCM MOTOR PARTS',
    description: '新網站整備中。零件照樣出貨、安裝照樣約，先用 LINE 找我們。',
    type: 'website',
  },
};

export default function ComingSoonPage() {
  return (
    <ComingSoon
      hasNav={false}
      eyebrow="PCM MOTOR PARTS ‧ 重機零件與改裝精品"
      titleLead="新網站，"
      titleAccent="即將上線。"
      lede={
        <>
          數十個改裝品牌、依車款精準匹配的新商城正在做最後整備。
          <br />
          在那之前一切照舊 —— 零件照樣出貨、安裝照樣約，
          <br />
          直接用 LINE 找我們就好。
        </>
      }
      etaText="最後整備中"
      secondaryCta={{
        href: 'https://www.instagram.com/pcm_officialtw/',
        label: '看最新到貨',
        icon: 'instagram',
        external: true,
      }}
    />
  );
}
