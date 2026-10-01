// draft-new-product-posts.ts — 每天挑幾件真的新品, 建首頁大圖 + FB / IG 草稿(2026-10-01, 每日自動新品草稿片 3)
//
// 計畫:~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md(Sean 批准:每天最多 3 份、每個品牌 1 份)。
// 🔴 草稿只是草稿:圖文能不能用(rights_confirmed)一律由人勾, 發布也是人按。
// 🔴 文字只用資料庫欄位(buildNewProductPost), 連結與 UTM 由程式組;有紅字的不建, 換下一件。

import { buildNewProductPost, checkBannerCopy, checkSocialCopy, hasNoRealImage } from '@pcm/domain';
import type { INewProductDraftStore, INewProductSource, NewProductCandidate, NewProductDraft } from '@pcm/ports';

/** 每天最多幾份(Sean 2026-10-01)。 */
export const NEW_PRODUCT_DRAFTS_PER_DAY = 3;
/** 往回看多久:排程每天 09:00 跑, 多看 12 小時補前一天漏跑。同一商品不會建第二份(資料庫部分唯一)。 */
export const NEW_PRODUCT_LOOKBACK_HOURS = 36;
// 大批匯入(例 Arrow 首灌 1,106 件)當天, 只看前 200 張會全是同一個品牌, 其他品牌整天被擠掉(R1 建議 5)
const CANDIDATE_LIMIT = 1000;
const CTA_LABEL = '看商品';

/**
 * 貼文第一行的「適用車款」。卡片副標的格式是「車款 · 分類」, 通用件只有「分類」(正式庫 2026-10-01 唯讀量:
 * 有「 · 」24,892 筆、沒有 5,529 筆, 抽樣全是分類名)⇒ 只取「 · 」前面那段, 沒有「 · 」就當沒有車款。
 * 品名裡已經寫「 - 車款」(Evotech、CNC RACING 那類, 68 筆)⇒ 不再接車款, 免得第一行寫兩次(主視窗 2026-10-01)。
 */
export function vehicleLabelFor(title: string, subtitle: string | null): string | null {
  if (title.includes(' - ') || !subtitle) return null;
  const i = subtitle.lastIndexOf(' · ');
  return i > 0 ? subtitle.slice(0, i).trim() || null : null;
}
// 資料庫 CHECK 的上限(migration 20260916150000):超過就不建, 不截字(中文品名截一半會變另一個意思)
const MAX = { eyebrow: 40, title: 60, subtitle: 60, imageUrl: 2000, socialText: 2200 } as const;
// 與 home_banners_image_desktop_url_check 同一條:https、不含空白與控制字元(migration 20260916150000)
const IMAGE_URL = /^https:\/\/[^\s\p{Cc}]+$/u;

export type NewProductSkipReason =
  | 'no_image' | 'no_price' | 'no_highlights' | 'no_chinese_title' | 'title_too_long' | 'red_flag' | 'brand_done'
  /** 資料庫拒收(CHECK 等);這一件跳過, 不讓整輪失敗(R1 必修 2) */
  | 'rejected';

export interface DraftNewProductPostsDeps {
  readonly source: INewProductSource;
  readonly store: INewProductDraftStore;
  /** 官網網址, 例 https://www.pcmmotorsports.com */
  readonly siteUrl: string;
  readonly now?: () => Date;
  readonly perDay?: number;
}

export interface DraftNewProductPostsResult {
  readonly candidates: number;
  readonly created: number;
  readonly duplicate: number;
  readonly skipped: Readonly<Record<NewProductSkipReason, number>>;
}

/** 一件新品 ⇒ 草稿, 或不建的理由。 */
export function buildNewProductDraft(
  c: NewProductCandidate,
  siteUrl: string,
): { draft: NewProductDraft } | { skip: Exclude<NewProductSkipReason, 'brand_done' | 'rejected'> } {
  // 佔位圖(供應商的 noimage、自家 no-photo)也算沒有圖(R3 必修 1;沿用 domain 的同一支判斷)
  if (!c.imageUrl || c.imageUrl.length > MAX.imageUrl || !IMAGE_URL.test(c.imageUrl) || hasNoRealImage(c.imageUrl)) {
    return { skip: 'no_image' };
  }
  if (!(typeof c.priceGeneral === 'number' && c.priceGeneral > 0)) return { skip: 'no_price' };
  const highlights = c.highlights.map((h) => h.trim()).filter(Boolean);
  if (highlights.length === 0) return { skip: 'no_highlights' };
  const title = c.title.trim();
  // 計畫的挑選條件:要有中文標題。還沒翻譯的新品(標題全是英文)不建, 也不佔品牌額度(R3 必修 2)
  if (!/\p{Script=Han}/u.test(title)) return { skip: 'no_chinese_title' };
  if (title.length > MAX.title) return { skip: 'title_too_long' };

  // 品名已經以品牌開頭(例 Öhlins 品名保留 Ohlins 前綴, Sean 0928)⇒ 眉標不再寫品牌, 免得大圖重複(R1 nit 9)
  const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const brand = c.brandName.trim();
  const eyebrow = brand.length <= MAX.eyebrow && !fold(title).startsWith(fold(brand)) ? brand : null;
  const subtitle = c.subtitle && c.subtitle.trim().length <= MAX.subtitle ? c.subtitle.trim() : null;
  const linkPath = `/products/${c.handle}`;
  const post = buildNewProductPost({
    brandName: c.brandName,
    title,
    vehicleLabel: vehicleLabelFor(title, c.subtitle),
    highlights,
    sku: c.sku,
    priceTwd: c.priceGeneral,
    productUrl: `${siteUrl.replace(/\/+$/, '')}${linkPath}`,
    partTag: c.categoryName,
  });
  const red =
    checkBannerCopy([eyebrow, title, subtitle, CTA_LABEL]).length > 0 ||
    checkSocialCopy(post.fbText, [c.brandName]).length > 0 ||
    checkSocialCopy(post.igText, [c.brandName]).length > 0;
  if (red) return { skip: 'red_flag' };
  if (post.fbText.length > MAX.socialText || post.igText.length > MAX.socialText) return { skip: 'title_too_long' };

  return {
    draft: {
      sourceProductId: c.productId,
      eyebrow,
      titleLine1: title,
      subtitle,
      ctaLabel: CTA_LABEL,
      linkPath,
      imageDesktopUrl: c.imageUrl,
      fbText: post.fbText,
      igText: post.igText,
    },
  };
}

/** 每日一輪:新的排前面, 每個品牌最多 1 份, 建滿 perDay 份就停。 */
export async function draftNewProductPosts(deps: DraftNewProductPostsDeps): Promise<DraftNewProductPostsResult> {
  const now = (deps.now ?? (() => new Date()))();
  const perDay = deps.perDay ?? NEW_PRODUCT_DRAFTS_PER_DAY;
  const since = new Date(now.getTime() - NEW_PRODUCT_LOOKBACK_HOURS * 3600_000).toISOString();
  const candidates = await deps.source.listNewSince(since, CANDIDATE_LIMIT);

  const skipped: Record<NewProductSkipReason, number> = {
    no_image: 0, no_price: 0, no_highlights: 0, no_chinese_title: 0, title_too_long: 0, red_flag: 0, brand_done: 0, rejected: 0,
  };
  const brandsDone = new Set<string>();
  let created = 0;
  let duplicate = 0;
  for (const c of candidates) {
    if (created >= perDay) break;
    if (brandsDone.has(c.brandSlug)) {
      skipped.brand_done += 1;
      continue;
    }
    const built = buildNewProductDraft(c, deps.siteUrl);
    if ('skip' in built) {
      skipped[built.skip] += 1;
      continue;
    }
    let r: 'created' | 'duplicate';
    try {
      r = await deps.store.create(built.draft);
    } catch (error) {
      // 🔴 一件被資料庫拒收就跳過這一件;整輪失敗的話, 它排在前面會連擋好幾天(R1 必修 2)
      const e = error as { code?: unknown; message?: unknown } | null;
      console.error('[new-product-drafts] 這一件建不起來, 跳過', {
        productId: c.productId,
        code: typeof e?.code === 'string' ? e.code : 'unknown',
        message: typeof e?.message === 'string' ? e.message.slice(0, 200) : undefined,
      });
      skipped.rejected += 1;
      continue;
    }
    if (r === 'created') {
      created += 1;
      brandsDone.add(c.brandSlug);
    } else {
      duplicate += 1;
    }
  }
  return { candidates: candidates.length, created, duplicate, skipped };
}
