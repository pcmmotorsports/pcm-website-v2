import type { SupplierMailSender } from '@pcm/ports';

// supplier-mail-senders.ts — 廠商新品信的寄件者白名單(PRD 2026-09-15 §3.2 / §7 第 3 點)。
// 🔴 **目前是空的,而那是刻意的**:Sean 還沒給清單 ⇒ 每日讀信那條線就算開了旗標,也一封都不會起草(全部 skipped_sender)。
// 🔵 Sean 填好清單後照下面範例一家一列加進 SUPPLIER_MAIL_SENDERS;之後會搬進 DB 表 supplier_mail_senders(後台可改)。
//
// 欄位:
//   sender       完整信箱(news@akrapovic.com)或整個網域(@akrapovic.com),小寫;網域只認那個網域本身、不含子網域
//   brandSlugs   這家信通常講哪些品牌(品牌 slug,跟網址 /brands/<slug> 同一個字)
//   rightsPolicy allowed = 圖文可以用 / ask_each_time = 每次發布前確認 / not_allowed = 只出文字、不帶圖
//   evidence     條款網址或「某年某月 email 同意」

export const SUPPLIER_MAIL_SENDERS: readonly SupplierMailSender[] = [];

/** 範例(不會被讀取;給填清單的人照抄)。 */
export const SUPPLIER_MAIL_SENDERS_SAMPLE: readonly SupplierMailSender[] = [
  { sender: '@akrapovic.com', brandSlugs: ['akrapovic'], rightsPolicy: 'ask_each_time', evidence: '未填' },
  { sender: 'newsletter@rizoma.com', brandSlugs: ['rizoma'], rightsPolicy: 'allowed', evidence: '2026-09 業務 email 同意' },
];
