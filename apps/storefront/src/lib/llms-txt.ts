// lib/llms-txt.ts — `/llms.txt` 的純邏輯 builder(GEO:給 AI 讀的站點索引)
//
// 📌 **格式出處**:`https://llmstxt.org/`(2026-09-09 查)。Jeremy Howard 2024-09 提出、
//   v2 於 2026-08 更新。⚠️ **它【不是】正式標準**,而 OpenAI / Anthropic / Google 的
//   開發者文件都有在用。⇒ 規格還會動 ⇒ 本檔走**最保守的那個形狀**,只用它明文要求的東西:
//     ① 一個 H1(唯一真正必要的)② 一段 blockquote 摘要 ③ 內文 ④ H2 底下的連結清單,
//     每一條是 `- [名稱](網址): 說明`。不使用任何延伸語法。
//
// 🔴🔴 **只寫【站上證得到】的事實。** 這個檔是給 AI 讀了之後拿去回答客人的 ——
//   寫錯不會有任何東西叫(Google 不會叫、我們的測試不會叫、客人也看不到這個檔)。
//   ⇒ 不寫行銷詞、不寫沒查證的數字、**不寫我們與品牌之間的授權關係**。
//
// 🛑 **身分宣稱那一格是硬線**(Sean 2026-09-09 拍乙,逐字「不是總代理,是經銷」):
//   本檔對品牌關係只抄站上既有的那句 —— `components/HomeStatement.tsx:80` 逐字
//   「全站皆為原廠正品,部分品牌正式代理、部分平行輸入,杜絕仿品風險。」
//   ⇒ 那句是**刻意留餘地**的,不要把它改寫成指名哪幾家代理。
//   ⇒ 守門 `llms-txt.test.ts`:產出裡不得出現「總代理 / 獨家代理 / Exclusive Distributor」那組。
//
// 🔵 **換網域**:所有網址都由 `resolveSiteUrl()` 的 base 拼出來,不寫死 `shop.`。
//   base 未設(prod 未設 `NEXT_PUBLIC_SITE_URL`)⇒ 回空字串、路由回 404
//   —— 與 `robots.txt` / `sitemap.xml` 的休眠一致:沒有正式網域就不對外宣告任何東西。

import { BRAND_CONTENT } from '@/data/brand-content';
import { LEGAL_NAME, LEGAL_NAME_EN, SITE_NAME, TAX_ID } from '@/lib/site-config';
import { NEW_ARRIVAL_WINDOW_DAYS } from '@/lib/catalog-query';

/**
 * 🔴 **不得出現在任何對外產出裡的身分宣稱字面。**
 * 這一組**不是**文字潔癖:寫錯是品牌方可以投訴的事實宣稱,而它是一個沒有人會發現的錯。
 * 匯出是為了讓測試同時掃 `llms.txt`、Organization JSON-LD、Product JSON-LD 與首頁 description。
 */
export const FORBIDDEN_AUTHORITY_CLAIMS = [
  '總代理',
  '獨家代理',
  '獨家經銷',
  'Exclusive Distributor',
  'Official Distributor',
  'Sole Distributor',
] as const;

/** 站上既有字面(`components/HomeStatement.tsx:80`),逐字抄、不改寫。 */
const AUTHENTICITY_LINE = '全站皆為原廠正品,部分品牌正式代理、部分平行輸入,杜絕仿品風險。';

type Link = { label: string; path: string; note?: string };

const ENTRY_LINKS: Link[] = [
  { label: '商品目錄', path: '/products', note: '全部商品;可依車款、分類、品牌篩選' },
  { label: '最新上架', path: '/products?filter=new', note: `近 ${NEW_ARRIVAL_WINDOW_DAYS} 天上架的商品` },
  { label: '品牌總覽', path: '/brands', note: '有介紹頁的品牌一覽' },
  { label: '運送與付款說明', path: '/info/shipping', note: '運費、配送方式與付款方式' },
  { label: '服務條款', path: '/terms' },
  { label: '隱私權政策', path: '/privacy' },
];

const MACHINE_LINKS: Link[] = [
  { label: 'sitemap.xml', path: '/sitemap.xml', note: '全站可索引網址' },
  { label: 'robots.txt', path: '/robots.txt', note: '爬蟲規則;AI 爬蟲具名允許' },
];

function renderLink(base: string, { label, path, note }: Link): string {
  return `- [${label}](${base}${path})${note ? `: ${note}` : ''}`;
}

/**
 * 產生 `/llms.txt` 全文。
 *
 * @param base `resolveSiteUrl()` 的回傳值;`undefined` ⇒ 回空字串(呼叫端回 404)。
 */
export function buildLlmsTxt(base: string | undefined): string {
  if (!base) return '';

  const brands = BRAND_CONTENT.map((b) =>
    renderLink(base, {
      label: b.name,
      path: `/brands/${b.slug}`,
      note: `${b.country} · ${b.wallTagline}`,
    }),
  );

  return [
    `# ${SITE_NAME}`,
    '',
    `> 台灣的重機改裝部品線上商店,販售歐系與日系品牌的機車部品,可依車款查詢適用零件。營運方為${LEGAL_NAME}(${LEGAL_NAME_EN},統一編號 ${TAX_ID})。`,
    '',
    `${AUTHENTICITY_LINE}`,
    '',
    // 🔴 下面每一條都指得出站上的出處,不是行銷詞:
    //   · 「接單後向原廠訂購」= 商品頁 FAQ 的逐字(`data/rpm-policies.ts`)
    //   · 「合作店家安裝」= `/install` 與首頁 N°04 既有字面
    //   · 「線上刷卡」= 結帳實際支援的付款方式
    '- 商品多數為接單後向原廠訂購的預購品,等待時間以各商品頁的說明為準。',
    '- 每一頁商品標示適用車款;整個目錄也可以用車款篩選。',
    '- 付款為線上刷卡。安裝可預約全台合作店家。',
    '- 價格以新台幣(TWD)標示。',
    '',
    '## 主要入口',
    '',
    ...ENTRY_LINKS.map((l) => renderLink(base, l)),
    '',
    '## 品牌介紹頁',
    '',
    ...brands,
    '',
    '## 機器可讀',
    '',
    ...MACHINE_LINKS.map((l) => renderLink(base, l)),
    '',
  ].join('\n');
}
