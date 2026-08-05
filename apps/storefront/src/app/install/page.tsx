// app/install/page.tsx — /install 安裝預約(全站重設計 第2批;2026-08-06)
//
// 真權威 = OD `coming-soon.html?v=install` + `coming-soon-handoff.md` §二表格第三列。
// 說明與 `app/stores/page.tsx` 檔頭同源(天地要自己 import、不 noindex、完整稿保留待切回),
// 該處寫過的不重複。本頁專屬的兩件事:
//
// 🔴 **`InstallResources.tsx` 與這一頁無關**,不要混為一談:那是**商品頁側欄**的安裝影片 /
//    說明書面板(`SITE-MAP.md` 2026-08-05 新增兩頁那節逐字警告過)。
// 🔴 **工時費率沒有任何來源** ⇒ 全頁不寫任何金額。完整稿 `install-page.html` 的作法也是
//    一律「依品項報價」(`SITE-MAP.md` 字面來源分級「⚠️ 待補資料」那條)。
//
// 內容分級 L1。

import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { ComingSoon } from '@/components/ComingSoon';

export const metadata: Metadata = {
  title: '安裝預約 · 即將上線 — PCM MOTOR PARTS',
  description:
    'PCM 線上安裝預約正在開發中。之後填一次表單，技師一個工作天內就回你工時與費用，零件由 PCM 直送店家。',
};

export default function InstallPage() {
  return (
    <>
      <Header currentPage="install" />
      <ComingSoon
        hasNav
        eyebrow="N°07 · INSTALL"
        titleLead="新功能，"
        titleAccent="即將上線。"
        lede={
          <>
            <strong>線上安裝預約</strong>正在開發中。之後填一次表單，技師一個工作天內就回你工時與費用，零件由 PCM 直送店家。
            <br />
            現在要約安裝一樣沒問題 —— 先用 LINE 找我們，照樣幫你排。
          </>
        }
        etaText="功能開發中"
        secondaryCta={{ href: '/', label: '回首頁', icon: 'home' }}
      />
      <HomeFooter />
    </>
  );
}
