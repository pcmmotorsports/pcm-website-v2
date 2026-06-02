/**
 * rpm-fetch — RPM Carbon 同步:來源唯讀讀取段(S3b 改讀報價單側乾淨 view)
 *
 * 來源(唯讀、絕不寫):報價單 B庫 `dllwkkfanaebrsuyuedy` 的乾淨公開 view `storefront_catalog_v`
 *   WHERE supplier_slug='rpm'(8878 變體);用 anon publishable key(只露公開目錄、讀不到成本/蝦皮/經銷)。
 *
 * 🔴 紅線(S3b):
 *   - 只讀乾淨 view、零敏感欄(view 物理無 cost/shopee/source/price_store);
 *     價格只有 price_retail(=報價單零售真相、對接到網站 price_general)。
 *   - 每個讀取都 .eq('supplier_slug','rpm')(view 混 6 供應商、漏濾=灌別家)。
 *
 * S3b(2026-06-02):取代 S2 版「直讀 raw products + product_groups_mv 兩查」。
 *   view grain=每列一變體、已含 main_sku / vehicle_label(廢掉 computeMainSku regex + fetchVehicleLabels 第二查)。
 *   SourceProductRow 對齊 view 欄、零敏感(砍 price_listing/price_store/price_shopee/price_cost/
 *   price_source_amount/price_source_currency/manually_corrected/raw_jsonb)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── constants ──
const SUPPLIER = 'rpm';
const PAGE_SIZE = 1000;

// ── source row types(view storefront_catalog_v、fetch→transform 共用)──
export interface SourceFitmentEntry {
  brand: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
  unconfirmed?: boolean;
  // 來源另有 year_str / menu_path / model_raw 等內部追蹤 key、transform 忽略
}
export interface SourceProductRow {
  supplier_slug: string;
  main_sku: string; // 群代表碼(乾淨、無前綴、大寫;取代 computeMainSku regex)
  sku: string; // 變體碼(乾淨、大小寫敏感、join key)
  product_name: string; // 英文部位名
  product_name_zh: string; // 中文部位名(title 優先)
  vehicle_label: string | null; // 適用車款(subtitle 用;通用件可能 null)
  fitment_parsed: SourceFitmentEntry[] | null;
  spec: Record<string, string> | null; // {weave,finish}(+optional special)、值全 string
  price_retail: string | number | null; // 🔴 報價單零售真相 → 網站 price_general(numeric 序列化可能為 string)
  image_url: string | null; // 群代表圖
  images: { url: string }[] | null; // 圖池 [{url}](變體專屬圖靠 sku 前綴過濾)
  stock_status: string; // in_stock / out
}

// view 公開欄(零敏感;不取 brand/category/major_category/variant_count/last_synced_at — RPM transform 不需)
// 🔴 不取 description:S3b 不同步描述(view 對 RPM 全空、現有 933 英文描述原地保留、新品留 NULL;
//    描述改由獨立中文化 workstream〔baoyu-translate→台灣校對〕處理、不從 view 拿。Sean Q-desc 定案 + backlog)。
const VIEW_COLS =
  'supplier_slug, main_sku, sku, product_name, product_name_zh, vehicle_label, ' +
  'fitment_parsed, spec, price_retail, image_url, images, stock_status';

// ── source fetch(分頁、全程 supplier_slug='rpm';讀乾淨 view 取代 raw 兩查)──
export async function fetchAllRpmProducts(src: SupabaseClient): Promise<SourceProductRow[]> {
  const all: SourceProductRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await src
      .from('storefront_catalog_v')
      .select(VIEW_COLS)
      .eq('supplier_slug', SUPPLIER) // 🔴 紅線(view 混 6 供應商)
      .order('sku')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as SourceProductRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}
