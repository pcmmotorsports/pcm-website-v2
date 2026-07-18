/**
 * rpm-fetch — RPM Carbon 同步:來源唯讀讀取段(S3b 改讀報價單側乾淨 view)
 *
 * 來源(唯讀、絕不寫):報價單 B庫 `dllwkkfanaebrsuyuedy` 的乾淨公開 view `storefront_catalog_v`
 *   WHERE supplier_slug=<呼叫端指定>(P0-A-2 起參數化、多供應商共用;RPM=8878 變體);
 *   用 anon publishable key(只露公開目錄、讀不到成本/蝦皮/經銷)。
 *
 * 🔴 紅線(S3b):
 *   - 只讀乾淨 view、零敏感欄(view 物理無 cost/shopee/source/price_store);
 *     價格只有 price_retail(=報價單零售真相、對接到網站 price_general)。
 *   - 每個讀取都 .eq('supplier_slug', supplierSlug)(view 混多供應商、scope 由呼叫端一路傳入、漏濾=灌別家)。
 *
 * S3b(2026-06-02):取代 S2 版「直讀 raw products + product_groups_mv 兩查」。
 *   view grain=每列一變體、已含 main_sku / vehicle_label(廢掉 computeMainSku regex + fetchVehicleLabels 第二查)。
 *   SourceProductRow 對齊 view 欄、零敏感(砍 price_listing/price_store/price_shopee/price_cost/
 *   price_source_amount/price_source_currency/manually_corrected/raw_jsonb)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── constants ──
const PAGE_SIZE = 1000;

// ── source row types(view storefront_catalog_v、fetch→transform 共用)──
export interface SourceFitmentEntry {
  brand: string;
  model: string;
  year_start?: number | null; // 數字欄(bonamici/rpm 等提供);缺 → 回退解析 year_str(2026-07-05)
  year_end?: number | null;
  // 🔴 部分供應商(gbracing 實測)fitment_parsed 只給 year_str 字串(如 "2006-2010")、無 year_start/year_end
  //    數字欄 → transform mergeFitments 以 year_str fallback 解析(見 rpm-transform.parseYearStr)。
  year_str?: string | null;
  unconfirmed?: boolean;
  // 來源另有 menu_path / model_raw 等內部追蹤 key、transform 忽略
}
export interface SourceProductRow {
  supplier_slug: string;
  main_sku: string; // 群代表碼(乾淨、無前綴、大寫;取代 computeMainSku regex)
  sku: string; // 變體碼(乾淨、大小寫敏感、join key)
  product_name: string; // 英文部位名
  product_name_zh: string; // 中文部位名(title 優先)
  description: string | null; // 來源繁中描述(P0-A-3 起攜帶;僅 supplier-config.syncDescription=true 才寫進 products.description、§2.9 F2)
  highlights_zh: string[] | null; // 來源賣點條列(jsonb 字串陣列;A/#270、與 description 同 syncDescription gate→products.highlights、rpm 不寫)
  pdf_urls: string[] | null; // 說明書 PDF 連結(text[] 裸 URL;#270 安裝資源、syncInstallResources gate→products.manuals、rpm 不寫)
  video_urls: string[] | null; // 安裝影片連結(text[] 多支可能含 Vimeo;#270、pickInstallVideo 取第一支 YouTube→products.video_url)
  vehicle_label: string | null; // 適用車款(subtitle 用;通用件可能 null)
  fitment_parsed: SourceFitmentEntry[] | null;
  category_zh: string | null; // 舊 97 子類(保留備用、transform 不消費)
  major_category_zh: string | null; // 舊 16 大類(保留備用、v2 上架後不再解分類)
  // #212 新 taxonomy(分類 resolve 與副標詞來源);optional=view 恆 select(缺欄 fetch 即報錯、
  // runtime 保證),免動既有 rpm-transform 測試 fixture;rpm-import find(...)?? '' 本就容 undefined。
  major_category_v2_zh?: string | null; // 14 大類
  sub_category_v2_zh?: string | null; // 77 子類(組麵包屑「大類 · 子類」)
  spec: Record<string, string> | null; // {weave,finish}(+optional special)/ {color,material}/ null、值全 string
  price_retail: string | number | null; // 🔴 報價單零售真相 → 網站 price_general(numeric 序列化可能為 string)
  image_url: string | null; // 群代表圖
  // 圖欄兩形狀並存(2026-07-04 view 實測):rpm=[{url}] 物件陣列(群共用圖池、變體專屬圖靠 sku
  //   前綴過濾)、bonamici/cncracing=純字串陣列(per-variant、各家 fetcher 寫法不同);
  //   mapImages(rpm-transform)兼容兩形狀、rpm 物件路徑不動(byte 錨)。
  images: ({ url: string } | string)[] | null;
  stock_status: string; // in_stock / out
  // 下架權威(合約 §10、view v3 起):來源側【已套用 7 天去抖】的下架時戳。
  // 非 null = 該變體已確認停產;網站【鏡射不重判】(不再從「view 缺席」自行推下架)。
  //
  // 🔴 optional 只是型別/fixture 便利,**runtime 恆存在**:VIEW_COLS 恆 select 此欄,
  //    來源 view 若尚未升到 v3(欄不存在),PostgREST 回 42703 → 整個請求 400 →
  //    fetchPageWithRetry 白重試 3 次後 throw(fail-closed、不會寫髒資料,但該供應商同步整個掛掉)。
  //    **故部署順序必須「先套報價單庫 v3 migration、再上本 repo code」**,不可顛倒。
  delisted_at?: string | null;
}

// view 公開欄(零敏感;不取 brand/category/variant_count/last_synced_at — transform 不需)。
// P0-A-3(多供應商去碳):補 description(依 syncDescription 決定寫不寫、§2.9 F2)+ major_category_zh(per-group 分類與副標來源)
//   + category_zh(97 子類、Phase 0 不 seed、先攜帶備用)。description 仍受 supplier-config 旗標 gate:rpm=false 不寫、byte 等價。
// A/#270:補 highlights_zh(賣點條列 jsonb 字串陣列)→ products.highlights;與 description 同 syncDescription gate(rpm 不寫)。
// #270 安裝資源:補 pdf_urls / video_urls(text[])→ products.manuals / video_url;syncInstallResources gate(gbracing/bonamici 才寫)。
const VIEW_COLS =
  'supplier_slug, main_sku, sku, product_name, product_name_zh, description, ' +
  'vehicle_label, fitment_parsed, category_zh, major_category_zh, major_category_v2_zh, sub_category_v2_zh, ' +
  'spec, price_retail, image_url, images, stock_status, ' +
  'highlights_zh, pdf_urls, video_urls, delisted_at';

// ── source fetch(分頁 + 重試、全程 .eq('supplier_slug', supplierSlug);讀乾淨 view 取代 raw 兩查)──
const MAX_RETRY = 3; // S5:每頁最多嘗試次數(初次 + 2 重試)
const RETRY_BASE_MS = 1000; // 指數退避基數(1s → 2s)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 讀單頁(指數退避重試)。anon 讀大 view 偶撞 statement timeout(57014)等暫時性錯誤、
 * 無人值守 cron 不能因一次冷撞整 run 失敗 → 退避重試(限 MAX_RETRY)、最後一次仍敗才拋(S5)。
 */
async function fetchPageWithRetry(src: SupabaseClient, from: number, supplierSlug: string): Promise<SourceProductRow[]> {
  let lastErr: { code?: string; message: string } | null = null;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const { data, error } = await src
      .from('storefront_catalog_v')
      .select(VIEW_COLS)
      .eq('supplier_slug', supplierSlug) // 🔴 紅線(view 混多供應商、scope 由呼叫端傳入)
      .order('sku')
      .range(from, from + PAGE_SIZE - 1);
    if (!error) return (data ?? []) as unknown as SourceProductRow[];
    lastErr = error;
    if (attempt < MAX_RETRY) {
      const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(
        `[rpm-fetch] page@${from} 第 ${attempt}/${MAX_RETRY} 次失敗(${error.code ?? ''} ${error.message})、${backoff}ms 後重試`,
      );
      await sleep(backoff);
    }
  }
  throw new Error(`fetchPage@${from} 重試 ${MAX_RETRY} 次仍失敗:${lastErr?.code ?? ''} ${lastErr?.message ?? ''}`);
}

export async function fetchAllSupplierProducts(src: SupabaseClient, supplierSlug: string): Promise<SourceProductRow[]> {
  const all: SourceProductRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = await fetchPageWithRetry(src, from, supplierSlug);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}
