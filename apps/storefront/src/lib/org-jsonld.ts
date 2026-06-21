// lib/org-jsonld.ts — schema.org/Store(LocalBusiness 子型)JSON-LD builder(GEO P0「商家身分證」)。
//
// 全站 layout 注入 <script type="application/ld+json">:讓 Google / AI 助理(Claude/GPT/Perplexity)
// 知道「PCM 是誰、賣什麼、在哪、怎麼聯絡」。Sean 2026-06-21 確認化成路為實體店面 → @type:Store
// (含地址 + 營業時間,可被「新北/新莊哪買重機改裝零件」類問題引用、GEO 最強)。
//
// 🔴 沿用 product-jsonld.ts 紀律(鐵則 12):逐欄白名單建構、**絕不 ...spread**。本身不含商品價格
//   → 經銷價外洩風險結構上不存在,但仍守同款書寫紀律以保一致。
// 序列化一律走 lib/json-ld.ts safeJsonLd(檔頭規約:任何新增 JSON-LD 注入點一律走本函式)。
// url / @id / logo 絕對網址走 lib/site-url.ts resolveSiteUrl();base 未設(prod 未設網域)→ 省略該欄。

import { resolveSiteUrl } from '@/lib/site-url';
import { safeJsonLd } from '@/lib/json-ld';
import {
  SITE_NAME,
  LEGAL_NAME,
  LEGAL_NAME_EN,
  TAX_ID,
  CONTACT_PHONE,
  CONTACT_EMAIL,
  STORE_ADDRESS,
  OPENING_HOURS,
  SOCIAL_URLS,
  LOGO_PATH,
} from '@/lib/site-config';

const SCHEMA_ORG = 'https://schema.org';

export type OrganizationJsonLd = Record<string, unknown>;

/** schema.org/Store JSON-LD 物件(逐欄白名單;見檔頭 🔴)。 */
export function buildOrganizationJsonLd(): OrganizationJsonLd {
  const base = resolveSiteUrl();

  const jsonLd: OrganizationJsonLd = {
    '@context': SCHEMA_ORG,
    '@type': 'Store',
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    // 英文登記名(Sean 確認為正確登記名;= footer 顯示名 PCM MOTOR PARTS LTD)。
    alternateName: LEGAL_NAME_EN,
    taxID: TAX_ID,
    telephone: CONTACT_PHONE,
    email: CONTACT_EMAIL,
    address: {
      '@type': 'PostalAddress',
      addressCountry: STORE_ADDRESS.country,
      addressRegion: STORE_ADDRESS.region,
      addressLocality: STORE_ADDRESS.locality,
      postalCode: STORE_ADDRESS.postalCode,
      streetAddress: STORE_ADDRESS.street,
    },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [...OPENING_HOURS.days],
      opens: OPENING_HOURS.opens,
      closes: OPENING_HOURS.closes,
    },
    // sameAs:官方社群 / LINE 加好友(皆可點 URL;LINE basic ID @pcmmoto 非 URL 不放此)。
    sameAs: [SOCIAL_URLS.facebook, SOCIAL_URLS.instagram, SOCIAL_URLS.line],
  };

  // 絕對網址欄位(prod 未設 NEXT_PUBLIC_SITE_URL → base undefined → 省略,見 site-url.ts)。
  if (base) {
    jsonLd['@id'] = `${base}/#store`;
    jsonLd.url = base;
    jsonLd.logo = `${base}${LOGO_PATH}`;
    jsonLd.image = `${base}${LOGO_PATH}`;
  }

  return jsonLd;
}

/**
 * 序列化為注入 <script> 的精確字串。走共用 safeJsonLd(@/lib/json-ld):escape 每個 < 防
 * </script> breakout(Next 官方寫法、與 Product / FAQPage JSON-LD 同源)。
 */
export function serializeOrganizationJsonLd(): string {
  return safeJsonLd(buildOrganizationJsonLd());
}
