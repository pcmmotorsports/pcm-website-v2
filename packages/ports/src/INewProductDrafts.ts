// INewProductDrafts.ts — 每日自動新品草稿的兩個外部依賴(2026-10-01, 計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md)。

/** 一張客人看得到、而且是真的新品的卡(至少一個款式是這段時間新建的;搬卡、拆卡的舊款式不算)。 */
export interface NewProductCandidate {
  readonly productId: string;
  readonly handle: string;
  /** 客人看到的卡片標題 */
  readonly title: string;
  /** 卡片副標(適用車款);通用件可能沒有 */
  readonly subtitle: string | null;
  readonly brandName: string;
  readonly brandSlug: string;
  /** 子分類中文名, hashtag 用 */
  readonly categoryName: string | null;
  /** 客人看到的售價(新台幣整數);沒有就是 null */
  readonly priceGeneral: number | null;
  /** 第一張商品圖(https);沒有就是 null */
  readonly imageUrl: string | null;
  readonly highlights: readonly string[];
  /** 代表款式的料號(售價最低、同價取排序最前) */
  readonly sku: string;
  readonly createdAt: string;
}

export interface INewProductSource {
  /** `sinceIso` 之後建立、客人看得到、而且有新款式的卡;新的排前面, 最多 `limit` 張。 */
  listNewSince(sinceIso: string, limit: number): Promise<readonly NewProductCandidate[]>;
}

/** 交給 system_new_product_draft 的草稿(migration 20261001120000)。 */
export interface NewProductDraft {
  readonly sourceProductId: string;
  readonly eyebrow: string | null;
  readonly titleLine1: string;
  readonly subtitle: string | null;
  readonly ctaLabel: string;
  readonly linkPath: string;
  readonly imageDesktopUrl: string | null;
  readonly fbText: string;
  readonly igText: string;
}

export interface INewProductDraftStore {
  /** 'duplicate' = 這個商品已經有草稿(一個商品只建一份)。 */
  create(draft: NewProductDraft): Promise<'created' | 'duplicate'>;
}
