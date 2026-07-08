import 'server-only';

import type { IProductRepository } from '@pcm/ports';
import type { Product, FitmentSpec } from '@pcm/domain';
import { toUIProduct } from '@/lib/products';
import type {
  IRecommendationEngine,
  RecommendationRequest,
  RecommendationResult,
  RecommendationReason,
  VehicleSelection,
} from './types';

/**
 * 規則式(rule-based / content-based)推薦引擎 — Phase 1 `pdp-related` 策略。
 *
 * 對齊 docs/specs/2026-07-08-recommendation-engine-related-products-plan.md §4:
 * - **Case A(有選車 context.vehicle)**:池 = 反查「選定的那台車」能裝的其他部品
 *   (listByFitment,非商品自身 fitment)→ 同分類×同車 → 其他×同車 亂數 → 不足補同分類 → 通用款。
 * - **Case B(沒選車)**:池 = 同品牌(listByBrand(product.brand.id))→ 同品牌×同分類 →
 *   同品牌其他 亂數 → 不足補同分類 → 通用款。
 *
 * 研究背書(不自己發明):規則式 content-based = 無行為資料小站標準冷啟動解
 * (協同過濾需 1,000+ 互動;plan §1)。未來換 AI 只加 VectorRecommendationEngine adapter、
 * 本引擎與消費者零改動。
 *
 * 🔴 **決定性(禁 Math.random)**:seed = `placement|product.handle|vehicleKey`,亂數 tier 以
 *   seed+handle 雜湊排序 → SSR 兩次 render 一致、不同情境不同序(plan §4)。
 *
 * 🔴 **hasMore 主池語意(codex R3 F1、supersede plan §2 full-stream 定義)**:hasMore = 主池
 *   (「查看全部」CTA 目標 filter:Case A 車輛池 / Case B 品牌池)去重排自身後 > limit;**非全候選流**。
 *   items 仍由全候選流(tier + fallback + 通用款)去重排自身填到 limit(收集階段 `limit+1` 即停控成本),
 *   但 hasMore 只看主池——否則主池 ≤ limit 卻被 fallback 灌滿時 hasMore=true、CTA 點進去只有 ≤limit 品=誤導。
 *
 * 🔴 **經銷價安全**:引擎回 product → 一律 `toUIProduct(p,'general')` strip(public view 物理
 *   排除 price_store、傳 general 免 NT$0 錯價);與 fetchRelatedProducts 同守則。
 *
 * 🔴 stopgap(#51):各 repository 方法現回全量陣列(引擎收集階段 slice 到 limit+1),
 *   目錄長大後(#212 多品牌 >4 萬)須改 server-side 分頁/上界查詢。
 */
export class RuleBasedRecommendationEngine implements IRecommendationEngine {
  constructor(private readonly repo: IProductRepository) {}

  async recommend(req: RecommendationRequest): Promise<RecommendationResult> {
    const { placement, context, limit } = req;

    // Phase 1 只實作 pdp-related;其餘落點回空(not-implemented、不 throw、plan §2)。
    if (placement !== 'pdp-related') return { items: [], hasMore: false };

    const product = context.product;
    // pdp-related 必須有當前商品(Case B 反查同品牌 / 排自身皆需之);缺 → 回空不 throw。
    if (!product || limit <= 0) return { items: [], hasMore: false };

    const excludes = new Set(context.excludeHandles ?? []);
    excludes.add(product.handle); // 一律排自身

    const vehicleKey = context.vehicle
      ? `${context.vehicle.motoBrand}:${context.vehicle.modelCode}:${context.vehicle.year ?? ''}`
      : '';
    const seed = `${placement}|${product.handle}|${vehicleKey}`;
    const sameCategoryRaw = product.category.raw;

    // 收集器:tier 優先序串接 → 去重(seen)→ 排自身(excludes)→ 上限 limit+1(控成本 + hasMore 準)。
    const collected: { product: Product; score: number; reason: RecommendationReason }[] = [];
    const seen = new Set<string>();
    const cap = limit + 1;

    const addTier = (
      pool: Product[],
      score: number,
      reason: RecommendationReason,
      shuffle: boolean,
    ): void => {
      if (collected.length >= cap) return;
      const ordered = shuffle ? seededOrder(pool, seed) : byHandleAsc(pool);
      for (const p of ordered) {
        if (collected.length >= cap) break;
        if (excludes.has(p.handle) || seen.has(p.handle)) continue;
        seen.add(p.handle);
        collected.push({ product: p, score, reason });
      }
    };

    const enough = (): boolean => collected.length >= cap;

    // 🔴 hasMore 主池語意(codex R3 F1、supersede plan §2 full-stream 定義):
    //   「查看全部」CTA 連到主池對應 filter(Case A → /products?vehicle= / Case B → /products?brand=)。
    //   若用全候選流(含 fallback 同分類/通用款)判 hasMore,主池 ≤ limit 卻被 fallback 灌滿時 hasMore=true、
    //   CTA 點進去只有 ≤limit 相容品=誤導。故 hasMore = 主池(CTA 目標集合)去重排自身後 > limit。
    //   items 仍由全候選流(含 fallback)填到 limit(carousel 儘量填滿),兩者分離。
    let primaryPoolCount = 0;

    // 🔴 repo 查詢 throw(DB 斷線/RLS 錯)→ 降級回空、不讓推薦區 crash 整頁(對齊 sibling
    //   fetchRelatedProducts「adapter throw → console.error + []」慣例;推薦區非關鍵、可降級)。
    try {
      if (context.vehicle) {
        // ── Case A:反查「選定車輛」的相容池 ─────────────────────────────
        const vehiclePool = await this.repo.listByFitment(vehicleToSpec(context.vehicle));
        primaryPoolCount = countDistinctEligible(vehiclePool, excludes); // CTA=/products?vehicle=
        const sameCat = vehiclePool.filter((p) => p.category.raw === sameCategoryRaw);
        const otherCat = vehiclePool.filter((p) => p.category.raw !== sameCategoryRaw);
        addTier(sameCat, 100, 'same-vehicle-same-category', false); // 同車×同分類:最相關、決定性排序
        addTier(otherCat, 70, 'same-vehicle-other-brand', true); // 同車×其他:亂數
        if (!enough()) {
          const catPool = await this.repo.listByCategory(product.category);
          addTier(catPool, 40, 'fallback-category', true); // 不足 → 同分類(不限車)
        }
      } else {
        // ── Case B:同品牌池(用 domain product.brand.id uuid) ──────────
        const brandPool = await this.repo.listByBrand(product.brand.id);
        primaryPoolCount = countDistinctEligible(brandPool, excludes); // CTA=/products?brand=
        const sameCat = brandPool.filter((p) => p.category.raw === sameCategoryRaw);
        const otherCat = brandPool.filter((p) => p.category.raw !== sameCategoryRaw);
        addTier(sameCat, 100, 'same-brand', false); // 同品牌×同分類:決定性排序
        addTier(otherCat, 80, 'same-brand', true); // 同品牌其他:亂數
        if (!enough()) {
          const catPool = await this.repo.listByCategory(product.category);
          addTier(catPool, 50, 'fallback-category', true); // 不足 → 同分類(不限品牌)
        }
      }

      // 兩 case 共用最後補位:通用款(fitments 空、設計上不綁車型)。
      if (!enough()) {
        const generalPool = await this.repo.listGeneral();
        addTier(generalPool, 10, 'general', true);
      }
    } catch (err) {
      console.error('[RuleBasedRecommendationEngine] repository query failed:', err);
      return { items: [], hasMore: false };
    }

    const hasMore = primaryPoolCount > limit;
    const items = collected.slice(0, limit).map((c) => ({
      product: toUIProduct(c.product, 'general'), // 🔴 經銷價 strip、client 安全
      score: c.score,
      reason: c.reason,
    }));

    return { items, hasMore };
  }
}

/**
 * VehicleSelection → FitmentSpec(listByFitment 反查用)。
 * 有 year → 表「單一年」(yearStart=yearEnd=Y、套四態年份重疊);無 year → 不限年份(spec.yearStart undefined)。
 */
function vehicleToSpec(vehicle: VehicleSelection): FitmentSpec {
  return {
    motoBrand: vehicle.motoBrand,
    modelCode: vehicle.modelCode,
    ...(vehicle.year != null ? { yearStart: vehicle.year, yearEnd: vehicle.year } : {}),
  };
}

/**
 * 主池去重(by handle)+ 排除 excludes(含自身)後的 distinct 數。
 * hasMore 用之:主池(CTA 目標 filter)去重排自身 > limit 才顯「查看全部」(codex R3 F1)。
 */
function countDistinctEligible(pool: Product[], excludes: Set<string>): number {
  const seen = new Set<string>();
  for (const p of pool) {
    if (excludes.has(p.handle) || seen.has(p.handle)) continue;
    seen.add(p.handle);
  }
  return seen.size;
}

/** 決定性排序(同分類 tier 用):handle 升冪、穩定不跳(對齊 fetchRelatedProducts)。 */
function byHandleAsc(products: Product[]): Product[] {
  return products.slice().sort((a, b) => a.handle.localeCompare(b.handle, 'en'));
}

/**
 * 決定性「亂數」排序:以 seed+handle 雜湊當排序鍵、tie-break handle 升冪。
 * 同 seed(同情境)→ 同序;不同情境(不同 product/vehicle)→ 不同序;禁 Math.random(SSR 一致)。
 */
function seededOrder(products: Product[], seed: string): Product[] {
  return products
    .map((p) => ({ p, key: hashString(`${seed}|${p.handle}`) }))
    .sort((a, b) => a.key - b.key || a.p.handle.localeCompare(b.p.handle, 'en'))
    .map((x) => x.p);
}

/** djb2 32-bit 字串雜湊(無符號);純決定性、僅用於排序鍵、非密碼學用途。 */
function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0; // h * 33 + c、保持 32-bit
  }
  return h >>> 0;
}
