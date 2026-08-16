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
 * 🔴 ~~stopgap(#51):各 repository 方法現回全量陣列(引擎收集階段 slice 到 limit+1),
 *   目錄長大後(#212 多品牌 >4 萬)須改 server-side 分頁/上界查詢。~~
 *   **2026-08-17 已做**:四支查詢改為 server-side 上界查詢(見 `RECOMMENDATION_POOL_SIZE`)。
 *   ⚠️ **原句的「現回全量陣列」在寫下的當天就已經不是真的** —— PostgREST 對沒指定筆數的查詢
 *   靜默停在 1,000 ⇒ 它回的是「全量」還是「前 1,000 筆」,**呼叫端分辨不出來**,
 *   而「目錄長大後」這個觸發條件也早就到了(實測 19,777 商品 / 單品牌 4,566)。
 */
/**
 * 每個 tier 向 repository 要幾筆候選。
 *
 * 🔴 **這個數字取代的是一個【看不見的】上限**:四支查詢原本都沒有指定筆數,
 * 而 PostgREST 對「沒指定」的回答是**靜默停在 1,000 筆**(HTTP 仍 200、header 不反映)
 * ⇒ 推薦池被砍掉而沒有任何人會知道。實測與雙向對照見
 * `docs/specs/2026-08-17-embed-truncation-slice-plan.md`。
 *
 * **為什麼是 800**(四個不等式,每一個都有量到的母體撐著;2026-08-17 anon 側 production):
 * ```
 * 800 > 724    單一車型最大（BMW S 1000 RR）⇒ 車型那面【完整涵蓋，不是取樣】
 * 800 > 357    (品牌×分類) 的 95 百分位（226 組）⇒ 主池絕大多數完整
 * 800 < 1000   低於 max-rows 硬牆 ⇒ 單次查詢即可，不需要分頁迴圈
 * 800 >> 490   舊寫法在該車型上實得的候選數 ⇒ 【比修之前多 310 個】
 * ```
 * 傳輸量實測反而**少 17%**(1,344,526 vs 舊寫法 1,618,810 bytes;同一個 4,566 筆品牌、完整投影)。
 *
 * ⚠️ **800 涵蓋不到的三處,寫出來不藏**:單一分類最大 1,642 / 通用款 3,995 / 單一品牌 4,566。
 * 這三支在本引擎裡都是 **fallback**(湊不滿才補位),而 fallback 走 `seededOrder` 打亂
 * ⇒ 順序與池的順序無關;**主池**(車型、多數品牌×分類組合)才要求完整,而 800 涵蓋了。
 * 🔴 **這是取捨不是漏掉** —— 要讓 fallback 也完整得跑分頁迴圈,那會引入另一族坑
 * (頁大小 vs max-rows、`range` 邊界、中途失敗的出口、全序排序鍵)。
 */
const RECOMMENDATION_POOL_SIZE = 800;

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
    // 主池有沒有被 `RECOMMENDATION_POOL_SIZE` 填滿(= 母體可能比池更大)。
    let primaryPoolSaturated = false;

    // 🔴 repo 查詢 throw(DB 斷線/RLS 錯)→ 降級回空、不讓推薦區 crash 整頁(對齊 sibling
    //   fetchRelatedProducts「adapter throw → console.error + []」慣例;推薦區非關鍵、可降級)。
    try {
      if (context.vehicle) {
        // ── Case A:反查「選定車輛」的相容池 ─────────────────────────────
        const vehiclePool = await this.repo.listByFitment(vehicleToSpec(context.vehicle), RECOMMENDATION_POOL_SIZE);
        primaryPoolCount = countDistinctEligible(vehiclePool, excludes); // CTA=/products?vehicle=
        primaryPoolSaturated = vehiclePool.length >= RECOMMENDATION_POOL_SIZE;
        const sameCat = vehiclePool.filter((p) => p.category.raw === sameCategoryRaw);
        const otherCat = vehiclePool.filter((p) => p.category.raw !== sameCategoryRaw);
        addTier(sameCat, 100, 'same-vehicle-same-category', false); // 同車×同分類:最相關、決定性排序
        addTier(otherCat, 70, 'same-vehicle-other-brand', true); // 同車×其他:亂數
        if (!enough()) {
          const catPool = await this.repo.listByCategory(product.category, RECOMMENDATION_POOL_SIZE);
          addTier(catPool, 40, 'fallback-category', true); // 不足 → 同分類(不限車)
        }
      } else {
        // ── Case B:同品牌池(用 domain product.brand.id uuid) ──────────
        const brandPool = await this.repo.listByBrand(product.brand.id, RECOMMENDATION_POOL_SIZE);
        primaryPoolCount = countDistinctEligible(brandPool, excludes); // CTA=/products?brand=
        primaryPoolSaturated = brandPool.length >= RECOMMENDATION_POOL_SIZE;
        const sameCat = brandPool.filter((p) => p.category.raw === sameCategoryRaw);
        const otherCat = brandPool.filter((p) => p.category.raw !== sameCategoryRaw);
        addTier(sameCat, 100, 'same-brand', false); // 同品牌×同分類:決定性排序
        addTier(otherCat, 80, 'same-brand', true); // 同品牌其他:亂數
        if (!enough()) {
          const catPool = await this.repo.listByCategory(product.category, RECOMMENDATION_POOL_SIZE);
          addTier(catPool, 50, 'fallback-category', true); // 不足 → 同分類(不限品牌)
        }
      }

      // 兩 case 共用最後補位:通用款(fitments 空、設計上不綁車型)。
      if (!enough()) {
        const generalPool = await this.repo.listGeneral(RECOMMENDATION_POOL_SIZE);
        addTier(generalPool, 10, 'general', true);
      }
    } catch (err) {
      console.error('[RuleBasedRecommendationEngine] repository query failed:', err);
      return { items: [], hasMore: false };
    }

    // 🔴 `|| primaryPoolSaturated` 是 2026-08-17 codex 對抗審查抓到的洞:
    //    `primaryPoolCount` 最多只會是 `RECOMMENDATION_POOL_SIZE`(800),
    //    ⇒ 呼叫端若傳 `limit = 900`,而該品牌實有 4,566 件,`800 > 900` 為 false
    //    ⇒ **錯回 `hasMore = false`**,而「查看全部」CTA 點進去其實有 4,566 件。
    //    池被填滿 = 母體至少有 800 件 = CTA 那頁一定還有更多 ⇒ 直接判 true。
    //    ⚠️ 這一條**保守方向正確**:池未滿時 `primaryPoolCount` 就是真實母體、判斷精準;
    //    池滿時寧可說「還有更多」(CTA 確實有東西),不會出現「說沒有而其實有」。
    const hasMore = primaryPoolCount > limit || primaryPoolSaturated;
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
