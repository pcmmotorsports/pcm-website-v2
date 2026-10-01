// SupabaseNewProductDrafts.ts — 每日自動新品草稿的資料庫串接(2026-10-01, 每日自動新品草稿片 3)
//
// 讀:products_public(客人看得到的卡)+ product_variants(判斷是不是真的新品、取代表料號)+ brands + categories。
// 寫:system_new_product_draft(migration 20261001120000, 只給 service_role)。

import type { SupabaseClient } from '@supabase/supabase-js';
import type { INewProductDraftStore, INewProductSource, NewProductCandidate, NewProductDraft } from '@pcm/ports';
import type { Database } from '../supabase/database.types';

// 一次 .in() 帶太多 id 會讓網址過長 ⇒ 分批
const IN_CHUNK = 100;
// 款式查詢每批 30 張卡, 每批再依 id 排序分頁取完(每頁 1,000 列 = PostgREST 單次上限)。
//   不分頁的話, 一批超過上限會被靜默截斷 ⇒ 那張卡款式不全, 代表款與價格會錯(R2 建議 2、R3 建議 3)。
const VARIANT_CHUNK = 30;
const PAGE = 1000;

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** 卡片第一張圖(同客人在卡片上看到的那張);格式不對就當沒有圖, 由 use-case 決定跳過。 */
function firstImage(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const im = images[0];
  const url = typeof im === 'string' ? im : (im as { url?: unknown } | null)?.url;
  return typeof url === 'string' ? url : null;
}

function strings(xs: unknown): string[] {
  return Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : [];
}

interface VariantRow {
  product_id: string;
  sku: string;
  price_general: number | null;
  sale_price_general: number | null;
  created_at: string;
}

/**
 * 客人實際付的價 —— 逐條照抄資料庫 pcm_effective_general_price(migration 20260928200000):
 * 一般價空 ⇒ 空;特價空或不低於一般價 ⇒ 一般價;否則特價(R2 必修:同步只改一般價, 舊特價可能比新一般價高)。
 */
export function effectivePrice(v: Pick<VariantRow, 'price_general' | 'sale_price_general'>): number | null {
  const g = v.price_general;
  const s = v.sale_price_general;
  if (g == null) return null;
  return s == null || s >= g ? g : s;
}

/**
 * 代表款式:實際價最低(沒價格的排後), 同價取料號(與 products_public 的代表款同規則:實際價、sku COLLATE "C")。
 * 🔴 料號與價格都取【這一個款式】的 ⇒ 不會出現「料號 A｜B 的特價」(R1 建議 3)。
 */
function representative(vs: readonly VariantRow[]): VariantRow | undefined {
  return [...vs].sort(
    (a, b) =>
      (effectivePrice(a) ?? Number.MAX_SAFE_INTEGER) - (effectivePrice(b) ?? Number.MAX_SAFE_INTEGER) ||
      (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0),
  )[0];
}

export class SupabaseNewProductSource implements INewProductSource {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async listNewSince(sinceIso: string, limit: number): Promise<readonly NewProductCandidate[]> {
    const { data: products, error } = await this.db
      .from('products_public')
      .select('id, handle, title, subtitle, images, brand_id, category_id, price_general, highlights, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const listed = (products ?? []).filter((p) => p.id && p.handle && p.title);
    if (listed.length === 0) return [];

    // 🔴 products_public 本身沒有 WHERE, 「客人看得到」靠 RLS(delisted_at IS NULL)。
    //    這裡用 service_role 讀 ⇒ RLS 不作用 ⇒ 已下架的也讀得到, 要自己擋(R1 必修 1;
    //    同 supplier-mail/SupabaseSupplierNewProductStore 讀 products.delisted_at 的做法)。
    const delisted = new Set<string>();
    for (const ids of chunks(listed.map((p) => p.id as string), IN_CHUNK)) {
      const { data, error: dErr } = await this.db.from('products').select('id, delisted_at').in('id', ids);
      if (dErr) throw dErr;
      for (const d of data ?? []) if (d.delisted_at) delisted.add(d.id);
    }
    const rows = listed.filter((p) => !delisted.has(p.id as string));
    if (rows.length === 0) return [];

    const variants: VariantRow[] = [];
    for (const ids of chunks(rows.map((p) => p.id as string), VARIANT_CHUNK)) {
      // 照實際拿到的列數往下翻, 拿到 0 列才停 ⇒ 不依賴伺服器單次上限 ≥ PAGE(R4 建議 1)
      for (let from = 0; ; ) {
        const { data, error: vErr } = await this.db
          .from('product_variants')
          .select('id, product_id, sku, price_general, sale_price_general, created_at')
          .in('product_id', ids)
          .order('id')
          .range(from, from + PAGE - 1);
        if (vErr) throw vErr;
        const page = (data ?? []) as VariantRow[];
        if (page.length === 0) break;
        variants.push(...page);
        from += page.length;
      }
    }
    const byProduct = new Map<string, VariantRow[]>();
    for (const v of variants) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);

    const brandIds = [...new Set(rows.map((p) => p.brand_id).filter((x): x is string => !!x))];
    const categoryIds = [...new Set(rows.map((p) => p.category_id).filter((x): x is string => !!x))];
    const brands = new Map<string, { name: string; slug: string }>();
    for (const ids of chunks(brandIds, IN_CHUNK)) {
      const { data, error: bErr } = await this.db.from('brands').select('id, name, slug').in('id', ids);
      if (bErr) throw bErr;
      for (const b of data ?? []) brands.set(b.id, { name: b.name, slug: b.slug });
    }
    const categories = new Map<string, string>();
    for (const ids of chunks(categoryIds, IN_CHUNK)) {
      const { data, error: cErr } = await this.db.from('categories').select('id, name').in('id', ids);
      if (cErr) throw cErr;
      for (const c of data ?? []) categories.set(c.id, c.name);
    }

    const since = Date.parse(sinceIso);
    const out: NewProductCandidate[] = [];
    for (const p of rows) {
      const vs = byProduct.get(p.id as string) ?? [];
      // 🔴 真的新品 = 至少一個款式是這段時間新建的。拆卡、搬卡會開新卡, 而款式沿用舊的(建立時間不變)
      //    ⇒ 2026-10-01 wrs 拆卡那 21 張新卡在這裡會被排除(唯讀實測:36 小時內新卡 51 張, 有新款式的 30 張)。
      if (!vs.some((v) => Date.parse(v.created_at) >= since)) continue;
      const rep = representative(vs);
      const brand = p.brand_id ? brands.get(p.brand_id) : undefined;
      if (!rep || !brand) {
        // 查不到品牌(brand_id 指到不存在的列)⇒ 不建, 但留一行, 免得每天靜靜跳過沒人知道(R4 建議 2)
        if (!brand) console.warn('[new-product-drafts] 新品查不到品牌, 跳過', { productId: p.id });
        continue;
      }
      out.push({
        productId: p.id as string,
        handle: p.handle as string,
        title: p.title as string,
        subtitle: p.subtitle ?? null,
        brandName: brand.name,
        brandSlug: brand.slug,
        categoryName: (p.category_id && categories.get(p.category_id)) || null,
        priceGeneral: effectivePrice(rep),
        imageUrl: firstImage(p.images),
        highlights: strings(p.highlights),
        sku: rep.sku,
        createdAt: p.created_at ?? '',
      });
    }
    return out;
  }
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export class SupabaseNewProductDraftStore implements INewProductDraftStore {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly requestId: () => string = newRequestId,
  ) {}

  async create(d: NewProductDraft): Promise<'created' | 'duplicate'> {
    const { data, error } = await this.db.rpc('system_new_product_draft', {
      p_draft: {
        source_product_id: d.sourceProductId,
        eyebrow: d.eyebrow,
        title_line1: d.titleLine1,
        subtitle: d.subtitle,
        cta_label: d.ctaLabel,
        link_path: d.linkPath,
        image_desktop_url: d.imageDesktopUrl,
        fb_text: d.fbText,
        ig_text: d.igText,
      },
      p_request_id: this.requestId(),
    });
    if (error) throw error;
    if (data !== 'created' && data !== 'duplicate') throw new Error(`system_new_product_draft 回傳不認得的值:${String(data)}`);
    return data;
  }
}
