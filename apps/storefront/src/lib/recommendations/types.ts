import type { Product } from '@pcm/domain';
import type { MockProduct } from '@/data/mock-products';

/**
 * 通用商品推薦引擎 — 介面契約(R2b、對齊
 * docs/specs/2026-07-08-recommendation-engine-related-products-plan.md §2)。
 *
 * 設計要點(codex 關卡1 兩輪折入):
 * - 引擎**吃 domain `Product`**(含 `brand.id` uuid + `category` + `fitments`),輸出時才
 *   strip 成 client 安全的 `MockProduct`(UIProduct);UI product 只有 `brandSlug`、無 uuid,
 *   不足以支撐 Case B「同品牌」反查(§2 🔎 偵察查證)。
 * - 演算法邏輯獨立於前端元件(未來換 AI 只加 `VectorRecommendationEngine` adapter、消費者零改),
 *   對齊研究背書(Google Cloud 生成式推薦=推薦邏輯獨立 service;plan §1)。
 */

/**
 * 選定車輛(Case A 反查用)。
 *
 * 🔴 `motoBrand`/`modelCode` 為**原始車廠/車型名稱**(已由 URL `?vehicle=` slug 經 taxonomy
 * 解回、非 slug、非 uuid);product_fitments 存原始名、用名字 join(plan §2 codex #2)。
 * 現況來源=URL 解析;未來=登入車庫(Amazon/eBay Garage 範式、plan §9)。
 */
export type VehicleSelection = {
  motoBrand: string;
  modelCode: string;
  /** 選用;有值=查「這一年」適用品(套 fitment 四態年份重疊);無值=不限年份 */
  year?: number;
};

/**
 * 推薦情境。Phase 1 只用 `product` + `vehicle` + `excludeHandles`;其餘欄位為未來
 * (會員/購物車/首頁 + 帳號/搜尋紀錄/AI)預留、現不實作(plan §9)。
 */
export type RecommendationContext = {
  /** 🔴 domain Product(含 brand.id;非 stripped UIProduct)——Case B 用 product.brand.id 反查同品牌 */
  product?: Product;
  /** 🔴 選定車輛(Case A 用「這台車」反查、非商品自身 fitment) */
  vehicle?: VehicleSelection;
  /** 至少排自身;引擎另會自動把 context.product.handle 併入排除集 */
  excludeHandles?: string[];
  // future: userId? / savedVehicles? / searchHistory? / cartItems?
};

/**
 * 推薦落點。Phase 1 只實作 `pdp-related`;其餘回 `{items:[],hasMore:false}`
 * (明標 not-implemented、不 throw、plan §2)。
 */
export type RecommendationPlacement =
  | 'pdp-related'
  | 'cart-addon'
  | 'member-center'
  | 'home-editorial';

export type RecommendationRequest = {
  placement: RecommendationPlacement;
  context: RecommendationContext;
  /** 回傳上限(N°03 = 8、plan Q2=A);hasMore 供前端決定「查看全部」 */
  limit: number;
};

/**
 * 推薦理由(內部除錯 / 未來可解釋性,**非顧客可見**、不受內容分級;plan §4)。
 * - `same-vehicle-same-category`:Case A 同車 × 同分類(最相關)
 * - `same-vehicle-other-brand`:Case A 同車 × 其他分類/品牌
 * - `same-brand`:Case B 同品牌
 * - `fallback-category`:湊不滿 → 同分類(不限車/品牌)補位
 * - `general`:最後補位 → 通用款(不綁車型)
 */
export type RecommendationReason =
  | 'same-vehicle-same-category'
  | 'same-vehicle-other-brand'
  | 'same-brand'
  | 'fallback-category'
  | 'general';

export type RecommendedProduct = {
  /** 🔴 輸出 UIProduct(client 安全、經銷價已 strip) */
  product: MockProduct;
  /** 分數(tier 高低、內部用;數值僅相對排序意義) */
  score: number;
  reason: RecommendationReason;
};

export type RecommendationResult = {
  items: RecommendedProduct[];
  /** 🔴 去重/排自身後的候選數 > limit → true;前端據此顯「查看全部相容」 */
  hasMore: boolean;
};

export interface IRecommendationEngine {
  recommend(req: RecommendationRequest): Promise<RecommendationResult>;
}
