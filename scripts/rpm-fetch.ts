/**
 * rpm-fetch — RPM Carbon 匯入:來源唯讀讀取段(S2 從 rpm-import.ts 拆出、純 refactor、邏輯逐字搬移行為不變)
 *
 * 來源(唯讀、絕不寫):pcm-quote-v2 `dllwkkfanaebrsuyuedy`
 *   products WHERE supplier_slug='rpm'(7277 變體)+ product_groups_mv(取 vehicle_label)
 *
 * 🔴 紅線(對齊 16b plan):每個來源讀取都 .eq('supplier_slug','rpm')
 *   (mv 混 6 供應商 7057 群、漏濾=灌別家)。
 *
 * S2(2026-06-02):rpm-import.ts 原 415 行破鐵則 6、拆 fetch / transform / load 三段;本檔=fetch 段
 *   (來源 wire types + 兩個分頁讀取函式)。SourceProductRow / SourceFitmentEntry 為 fetch→transform
 *   共用合約、export 出去。平鋪 scripts/ root(被 tsconfig.scripts.json + eslint scripts/*.ts 覆蓋)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── constants ──
const SUPPLIER = 'rpm';
const PAGE_SIZE = 1000;

// ── source row types(wire、fetch→transform 共用)──
export interface SourceFitmentEntry {
  brand: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
  unconfirmed?: boolean;
}
export interface SourceProductRow {
  sku: string;
  product_name: string;
  product_name_zh: string;
  description_origin: string | null;
  price_listing: string | number;
  price_store: string | number;
  price_shopee: string | number | null;
  price_cost: string | number | null;
  price_source_amount: string | number | null;
  price_source_currency: string | null;
  stock_status: string;
  manually_corrected: boolean;
  fitment_parsed: SourceFitmentEntry[] | null;
  images: { url: string }[] | null;
  image_url: string | null;
  raw_jsonb: { spec?: Record<string, string> } | null;
}

// ── source fetch(分頁、全程 supplier_slug='rpm')──
export async function fetchAllRpmProducts(src: SupabaseClient): Promise<SourceProductRow[]> {
  const cols =
    'sku, product_name, product_name_zh, description_origin, price_listing, price_store, ' +
    'price_shopee, price_cost, price_source_amount, price_source_currency, stock_status, ' +
    'manually_corrected, fitment_parsed, images, image_url, raw_jsonb';
  const all: SourceProductRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await src
      .from('products')
      .select(cols)
      .eq('supplier_slug', SUPPLIER) // 🔴 紅線
      .order('sku')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as SourceProductRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

export async function fetchVehicleLabels(src: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await src
    .from('product_groups_mv')
    .select('main_sku, vehicle_label')
    .eq('supplier_slug', SUPPLIER) // 🔴 紅線(mv 混 6 供應商)
    .limit(5000);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { main_sku: string; vehicle_label: string | null }[]) {
    map.set(r.main_sku, r.vehicle_label ?? '');
  }
  return map;
}
