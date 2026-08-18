// lib/site-config.ts — 站台 / 商家事實單一真相(GEO Organization JSON-LD + 未來重用)。
//
// 🟡 內容分級 L2(hardcode + TODO + backlog #248):商家聯絡 / 登記資料目前 hardcode 於本檔。
//   季度級異動頻率;未來有後台再遷。此處為唯一真相,勿在各元件重複硬寫(站名原散在 4 檔)。
//
// 真值來源:Sean 2026-06-21 親自提供(電話 / 統編 / 登記名 / FB / IG / email / 地址 / logo)。
//   LINE 沿用 lib/line-cta.ts 既有真值(@pcmmoto / lin.ee 短網址),不重複定義。

import { LINE_ADD_URL } from '@/lib/line-cta';

/** 品牌 / 商號顯示名。 */
export const SITE_NAME = 'PCM Motorsports';
/** 法定登記名稱(中文公司登記;對應統編 90003020)。 */
export const LEGAL_NAME = '派達有限公司';
/** 法定登記名稱(英文;Sean 2026-06-22 確認為正確登記名,亦為 footer 顯示名)。 */
export const LEGAL_NAME_EN = 'PCM MOTOR PARTS LTD';
/** 統一編號(台灣)。 */
export const TAX_ID = '90003020';
/** 公司負責人(登記事項;Sean 2026-07-23 提供,供 /terms 企業經營者資訊條使用)。 */
export const LEGAL_REPRESENTATIVE = '林蓁瑜';
/** 客服 / 門市電話(E.164)。 */
export const CONTACT_PHONE = '+886-930-531-867';
/** 客服 / 門市電話(台灣本地顯示格式;與 CONTACT_PHONE 同一支號碼、UI 顯示用)。 */
export const CONTACT_PHONE_DISPLAY = '0930-531-867';
/** 客服 email。 */
export const CONTACT_EMAIL = 'sean@pcmmotorsports.com';

/** 實體門市地址(Sean 2026-06-21 確認為可現場購買的實體店面 → LocalBusiness/Store)。 */
export const STORE_ADDRESS = {
  country: 'TW',
  region: '新北市',
  locality: '新莊區',
  postalCode: '242',
  street: '化成路736巷18號1樓',
} as const;

/** 營業時間(週一–六 10:00–19:00;對齊 footer / rpm-policies;Sean 2026-07-04 全站 20:00→19:00)。 */
/** 星期名(英文,`OPENING_HOURS.days` 的輸入域)。
 *  🔴 **收成 union 是 GR-051 F5**:原本是 `string[]`,typo(`'Sundy'`)會讓 `WEEK_ORDER.indexOf` 回 -1
 *  ⇒ 五個消費端一起印出「週至週六」,**而 tsc 不紅、三綠全綠**。收成 union 之後 typo 變成型別錯誤。 */
export type WeekdayName =
  | 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export const OPENING_HOURS = {
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as readonly WeekdayName[],
  opens: '10:00',
  closes: '19:00',
} as const;

/** 英→中星期(營業日顯示用;SSoT `OPENING_HOURS.days` 存英文)。 */
const ZH_DAY: Record<string, string> = {
  Sunday: '日',
  Monday: '一',
  Tuesday: '二',
  Wednesday: '三',
  Thursday: '四',
  Friday: '五',
  Saturday: '六',
};
const WEEK_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * 營業日字串:連續 → 「週一`joiner`週六」;不連續 → 「週一、週三、週五」。
 *
 * 🔴 **連續性實際判斷、不假設** —— Sean 若改成只開平日或跳日,這裡自動跟著對,
 *    不會像寫死「週一至週六」那樣靜默說謊。
 *
 * 🔴🔴 **本函式原本住在 `data/legal-content.ts`,而選定它搬到這裡的理由是 `#528`**:
 *    從前只有法律頁從 `days` 推導,三個畫面顯示點硬寫「週一-週六」
 *    ⇒ Sean 哪天加開週日,**法律頁與 JSON-LD 會變、畫面不會** —— 同一個站對營業日講兩種話。
 *
 * 🔴 **`joiner` 沒有預設值是刻意的**(GR-051 F3):原本預設 `'至'` 只服務法律頁一個消費端,
 *    而要 `'-'` 的有三個 ⇒ **未來新增畫面消費端忘了傳,會靜默偏離 design 字面**。
 *    改成必填 ⇒ 忘了傳是 tsc 錯,不是上線後才看到的錯字。
 * 🔴 **`joiner` 不是多餘的彈性**:法律頁用「週一**至**週六」、畫面用「週一**-**週六」,
 *    **兩種寫法都是 design 的字面** ⇒ 統一成一種 = 偷改 design(鐵則 1)。
 */
export function openDaysLabel(joiner: string): string {
  // 🔴 GR-051 F6:重複值(`['Monday','Monday','Tuesday']`)會讓連續判定破掉
  //    ⇒ 印出「週一、週一、週二」。去重之後,重複值等價於它去重後的樣子。
  const days = [...new Set(OPENING_HOURS.days)];
  if (days.length === 0) return '';
  const idx = days.map((d) => WEEK_ORDER.indexOf(d)).sort((x, y) => x - y);
  const contiguous = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -99) + 1);
  const zh = (i: number) => `週${ZH_DAY[WEEK_ORDER[i] ?? ''] ?? ''}`;
  if (days.length === 1) return zh(idx[0] ?? 0);
  return contiguous
    ? `${zh(idx[0] ?? 0)}${joiner}${zh(idx[idx.length - 1] ?? 0)}`
    : idx.map((i) => zh(i)).join('、');
}

/** 官方社群 / 通訊(sameAs 用;皆為可點 URL)。 */
export const SOCIAL_URLS = {
  facebook: 'https://www.facebook.com/partscheaper',
  instagram: 'https://www.instagram.com/pcm_officialtw/',
  line: LINE_ADD_URL,
} as const;

/** Logo 圖檔路徑(置於 storefront public/;絕對 URL = resolveSiteUrl() + 此路徑)。 */
export const LOGO_PATH = '/pcm-logo.png';
