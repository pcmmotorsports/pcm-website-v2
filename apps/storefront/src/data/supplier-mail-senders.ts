import type { SupplierMailSender } from '@pcm/ports';

// supplier-mail-senders.ts — 廠商新品信的寄件者白名單(PRD 2026-09-15 §3.2 / §7 第 3 點)。
// 🔵 2026-10-01 起有 5 家(見下);以前是空的(刻意, 等 Sean 給清單)。
// 🔵 Sean 填好清單後照下面範例一家一列加進 SUPPLIER_MAIL_SENDERS;之後會搬進 DB 表 supplier_mail_senders(後台可改)。
//
// 欄位:
//   sender       完整信箱(news@akrapovic.com)或整個網域(@akrapovic.com),小寫;網域只認那個網域本身、不含子網域
//   brandSlugs   這家信通常講哪些品牌(品牌 slug,跟網址 /brands/<slug> 同一個字)
//   rightsPolicy allowed = 圖文可以用 / ask_each_time = 每次發布前確認 / not_allowed = 只出文字、不帶圖
//   evidence     條款網址或「某年某月 email 同意」

// 2026-10-01 主視窗(mac mini 第二次乾跑後):先放這 5 個網域;品牌 slug 唯讀查網站 brands 表。
//   「圖文能不能用」主視窗正在問 Sean ⇒ 先一律 ask_each_time(每次發布前確認;草稿本來就是 rights_confirmed = false)。
//   racebikebitz.com 不放(網站沒有對應品牌)。寄件網域驗證:5 家 mac mini 實測都過(lightech 要靠 header.b 引號修正)。
export const SUPPLIER_MAIL_SENDERS: readonly SupplierMailSender[] = [
  { sender: '@extreme-components.com', brandSlugs: ['extreme'], rightsPolicy: 'ask_each_time', evidence: '待 Sean 確認' },
  { sender: '@dbkspecialparts.com', brandSlugs: ['dbk'], rightsPolicy: 'ask_each_time', evidence: '待 Sean 確認' },
  { sender: '@ilmberger-carbon.de', brandSlugs: ['ilmberger'], rightsPolicy: 'ask_each_time', evidence: '待 Sean 確認' },
  { sender: '@cncracing.it', brandSlugs: ['cnc-racing'], rightsPolicy: 'ask_each_time', evidence: '待 Sean 確認' },
  { sender: '@lightech.it', brandSlugs: ['lightech'], rightsPolicy: 'ask_each_time', evidence: '待 Sean 確認' },
];

/** 範例(不會被讀取;給填清單的人照抄)。 */
export const SUPPLIER_MAIL_SENDERS_SAMPLE: readonly SupplierMailSender[] = [
  { sender: '@akrapovic.com', brandSlugs: ['akrapovic'], rightsPolicy: 'ask_each_time', evidence: '未填' },
  { sender: 'newsletter@rizoma.com', brandSlugs: ['rizoma'], rightsPolicy: 'allowed', evidence: '2026-09 業務 email 同意' },
];
