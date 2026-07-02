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

/** 營業時間(週一–六 10:00–20:00;對齊 footer / rpm-policies)。 */
export const OPENING_HOURS = {
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  opens: '10:00',
  closes: '20:00',
} as const;

/** 官方社群 / 通訊(sameAs 用;皆為可點 URL)。 */
export const SOCIAL_URLS = {
  facebook: 'https://www.facebook.com/partscheaper',
  instagram: 'https://www.instagram.com/pcm_officialtw/',
  line: LINE_ADD_URL,
} as const;

/** Logo 圖檔路徑(置於 storefront public/;絕對 URL = resolveSiteUrl() + 此路徑)。 */
export const LOGO_PATH = '/pcm-logo.png';
