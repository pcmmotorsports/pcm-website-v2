// social-post-template.ts — 新品草稿的 FB / IG 文字與帶 UTM 的官網連結(2026-10-01, 每日自動新品草稿片 1)
//
// 格式照社群研究範本 1(~/pcm-mailbox/社群研究-20261001/分析與建議.md 四之範本 1):
//   第一行「品牌｜品名｜適用車款」→ 3～5 條事實 → 料號與價格 → 出口(FB 連結 / IG 料號搜尋)→ hashtag。
// 🔴 只用呼叫端傳進來的資料庫欄位組字;沒有的那一行整行不寫, 不補、不猜(Sean:數字與單位照原文)。
// 🔴 連結與 UTM 一律由這裡組, 不讓 AI 產。UTM 三個值是 Sean 2026-10-01 定的。

export type SocialPlatform = 'facebook' | 'instagram';

export interface NewProductPostInput {
  /** 品牌顯示名, 例 Materya */
  brandName: string;
  /** 卡片中文標題, 例「Lever Guard 拉桿護弓」 */
  title: string;
  /** 適用車款(卡片副標);通用件可以空白 */
  vehicleLabel?: string | null;
  /** 賣點(資料庫 highlights);最多取 5 條 */
  highlights: ReadonlyArray<string>;
  /** 料號(基準款) */
  sku: string;
  /** 售價(新台幣整數);沒有就不寫價格 */
  priceTwd?: number | null;
  /** 商品頁完整網址, 不帶查詢字串, 例 https://www.pcmmotorsports.com/products/materya-lg01 */
  productUrl: string;
  /** hashtag 用的零件分類(子分類中文名);沒有就不放 */
  partTag?: string | null;
  /** hashtag 用的車款(短的英文型號, 例 YZF-R9);沒有就不放 */
  modelTag?: string | null;
}

export interface NewProductPost {
  fbText: string;
  igText: string;
  fbUrl: string;
  /** IG 內文不能點連結;這條給限時動態的連結貼紙用 */
  igUrl: string;
}

const MAX_FACTS = 5;
const SHOP_TAG = '#PCM重機零件販售';

/** utm_campaign:料號小寫, 只留英數與 - _(其他字元換成 -, 連續的 - 收成一個)。 */
export function utmCampaign(sku: string): string {
  const c = sku.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  // 料號全是非英數時不要留空值(utm_campaign= 會讓分析工具把它歸到「沒有活動」)
  return c || 'new-product';
}

/** 商品頁網址加上 UTM 三個參數。 */
export function socialUtmUrl(productUrl: string, platform: SocialPlatform, campaign: string): string {
  const u = new URL(productUrl);
  u.searchParams.set('utm_source', platform);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

// hashtag 只留字母、數字、底線:FB / IG 的 hashtag 碰到 - + & 就斷(「#MT-09」只會被認成 #MT, R1 必修 1)。
function tag(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/[^\p{L}\p{N}_]+/gu, '');
  return t ? `#${t}` : null;
}

function priceLine(sku: string, priceTwd: number | null | undefined): string {
  // 價格只在是正整數時顯示;不是整數就當作沒有價格, 不印小數
  const price = typeof priceTwd === 'number' && Number.isInteger(priceTwd) && priceTwd > 0 ? `NT$${priceTwd.toLocaleString('en-US')}` : null;
  return price ? `料號 ${sku}｜${price}` : `料號 ${sku}`;
}

/** 新品草稿的 FB / IG 兩份文字。 */
export function buildNewProductPost(input: NewProductPostInput): NewProductPost {
  const campaign = utmCampaign(input.sku);
  const fbUrl = socialUtmUrl(input.productUrl, 'facebook', campaign);
  const igUrl = socialUtmUrl(input.productUrl, 'instagram', campaign);
  // 品名已經以品牌開頭(例 Öhlins 品名保留 Ohlins 前綴, Sean 0928)就不重複寫品牌
  const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const brandFirst = fold(input.title.trim()).startsWith(fold(input.brandName.trim())) ? null : input.brandName;
  const head = [brandFirst, input.title, input.vehicleLabel].map((s) => (s ?? '').trim()).filter(Boolean).join('｜');
  const facts = input.highlights.map((h) => h.trim()).filter(Boolean).slice(0, MAX_FACTS);
  const brandTag = tag(input.brandName.toLowerCase());
  const baseTags = [brandTag, tag(input.modelTag), tag(input.partTag)].filter((t): t is string => !!t);

  const fbText = [
    head,
    '',
    ...facts.map((f) => `・${f}`),
    '',
    priceLine(input.sku, input.priceTwd),
    `官網商品頁：${fbUrl}`,
    '',
    [...baseTags, SHOP_TAG].join(' '),
  ].join('\n');

  const igText = [
    head,
    '',
    ...facts,
    '',
    priceLine(input.sku, input.priceTwd),
    `官網搜尋料號 ${input.sku}，或點個人檔案連結。`,
    '.',
    '.',
    [...baseTags, '#重機改裝', '#重機零件', SHOP_TAG].join(' '),
  ].join('\n');

  // 沒有賣點時中間會多一個空行;多個空行收成一個
  const tidy = (t: string) => t.replace(/\n{3,}/g, '\n\n');
  return { fbText: tidy(fbText), igText: tidy(igText), fbUrl, igUrl };
}
