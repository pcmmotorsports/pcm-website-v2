/**
 * rpm-transform — RPM Carbon 同步:純轉換段(S3b 改吃乾淨 view 列)
 *
 * 來源 wire(SourceProductRow=view 列)→ 目標 DB row(ProductRow / VariantRow)。無 IO、純函式。
 *
 * 🔴 紅線(S3b、命名地雷正解 + 經銷防護):
 *   - price_general 一律取 view.price_retail(報價單側零售真相欄、view 正名 price_retail);網站 price_general=零售。
 *   - 獨立 price_store integer 欄一律 null(Q2=A、view 無經銷價、絕不接 view 任何欄到 price_store)。
 *   - price_by_tier.store 填 price_retail placeholder(現役 CHECK 逼 general+store 兩 key 都要值);
 *     ⚠️ 此 placeholder 非真經銷價、M-2-08 tier-aware 取價別信此欄、真經銷價回報價單 dealer view 取。
 *   - metadata 不寫任何敏感欄(shopee/cost/source_*、S1 CHECK 硬擋);只留 name_en(非敏感)。
 *   - 金額一律 Math.round 整數(禁浮點)。
 *   - external_id=乾淨 main_sku(無 RPM- 前綴、對齊 S3a 洗淨值);handle='rpm-'+lower(S3a 保留 handle key)。
 *
 * S3b(2026-06-02):取代 S2 版「吃 raw products + 寫敏感 metadata + 加 RPM- 前綴」。
 *   主料號改用 view.main_sku(廢 computeMainSku regex);spec/images/vehicle_label/stock_status 直接吃 view 欄。
 */

import type { FitmentSpec } from '@pcm/domain';
import type { SourceProductRow, SourceFitmentEntry } from './rpm-fetch';
import type { VariantImageStrategy } from './supplier-config';

// ── constants ──
const PLACEHOLDER_IMAGE = '/placeholder-product.png';
const TWD = 'TWD' as const;

// ── helpers ──
/** numeric(string/number/null)→ 整數 TWD(Math.round、禁浮點);null/非法數字→null */
function roundTwd(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null; // 🔴 NaN/Infinity(非法來源值)→ null(codex k2 審查 must-fix 2)
}
/** 來源 images → string[](對齊 domain images: string[])。W3:兼容兩形狀 —
 *  rpm=[{url}] 物件陣列(抽 .url、現行路徑 byte 不變)、bonamici/cncracing=純字串陣列(直用)。 */
function mapImages(images: ({ url: string } | string)[] | null | undefined): string[] {
  return (images ?? []).map((i) => (typeof i === 'string' ? i : i.url)).filter(Boolean);
}
/**
 * 變體專屬圖 — 依 supplier-config.variantImages 策略分支(W3、#267):
 * - 'sku-prefix-pool'(rpm、Sean 拍):view.images 是「全群共用圖池」、過濾出檔名含該變體 sku 前綴的圖。
 *   檔名規則(已驗):變體 APRILIA-01-G-F 圖檔名含 'aprilia-01-g-f-XX';sku 小寫 + '-' 為精準前綴
 *   (不誤匹配 g-h / m-f)。own 空(如 12K 特殊款可能無專屬檔)→ [](DB 瘦、16c fallback 商品代表圖)。
 * - 'per-variant'(bonamici/cncracing/gbracing、2026-07-04 view 實測):view.images 已是該變體
 *   自己的圖組、直接全用不過濾(RPM 前綴規則對這些家檔名永遠 miss —— sku 後跟 / . _ 而非 '-',
 *   過濾會把全部變體圖丟成 [] = 選色不換圖)。
 */
function ownVariantImages(v: SourceProductRow, strategy: VariantImageStrategy): string[] {
  if (strategy === 'per-variant') return mapImages(v.images);
  const prefix = v.sku.toLowerCase() + '-';
  return mapImages(v.images).filter((url) => url.toLowerCase().split('?')[0]!.includes(prefix));
}
/**
 * stock_status → availability。view 現吐 in_stock / out(已驗);low(低庫存)對齊權威仍可買 → in-stock;
 * out/discontinued → out-of-stock。
 */
function availabilityOf(stock: string): 'in-stock' | 'out-of-stock' {
  return stock === 'in_stock' || stock === 'low' ? 'in-stock' : 'out-of-stock';
}
/**
 * subtitle = 適用車款(view.vehicle_label)· 分類詞(categoryTag);通用件 label 空 → 只分類詞。
 * 去碳:材質詞外提為參數、不再硬寫「碳纖維」。categoryTag 由 caller 依 supplier-config 供給:
 *   - rpm(fixed)= 分類 rawPath「碳纖維部品」(Sean 2026-07-03 拍 A:副標隨分類名、故現行「碳纖維」→「碳纖維部品」);
 *   - 試點(per-group)= 該群 major_category_zh(如「操控部品」「車殼外觀」)。
 * categoryTag 空 + 有車款 → 只車款;兩者皆空 → 空字串(通用件無分類、理論邊角)。
 */
function buildSubtitle(vehicleLabel: string | null | undefined, categoryTag: string): string {
  const v = (vehicleLabel ?? '').trim();
  const tag = categoryTag.trim();
  return v && tag ? `${v} · ${tag}` : v || tag;
}
/**
 * handle 片段正規化(#266、Sean 拍 A「正規化」):把來源 mainSku 洗成 URL-safe handle 片段。
 *   1. lowercase;
 *   2. 非白名單字元(空白 / 小數點 / slash 等 URL 危險字元)runs → 單一 hyphen;
 *   3. 連續分隔符(- 或 _ 或混合)收斂成單一 hyphen;
 *   4. 去前後分隔符。
 * 🔴 白名單保留底線(P0-A-4c、bonamici PU_001);對「已合法」片段(rpm APRILIA-01 / gbracing GB-001 等)
 *    = **no-op** → RPM handle byte 不變(rpm-transform.test golden 錨驗)。external_id 仍存原始 mainSku(join key、
 *    大寫),handle 僅 SEO key(backlog #266:handle 走正規化、SKU 保於 external_id)。
 *    ⚠️ 正規化後可能兩個不同髒 SKU 收斂成同 handle → 交由 handle preflight batch-duplicate 攔(dry-run 顯清單)。
 */
export function normalizeHandleSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') // 非白名單(空白 / . / slash 等)runs → 單一 hyphen
    .replace(/[-_]{2,}/g, '-') // 連續分隔符(含 -_ 混合)→ 單一 hyphen
    .replace(/^[-_]+|[-_]+$/g, ''); // 去前後分隔符(避免 HANDLE_RE 前後分隔符違規)
}
/**
 * fitment 年份解析(2026-07-05):供應商源頭 schema 不一致 —— bonamici/rpm 給數字欄 year_start/year_end、
 * gbracing 給字串欄 year_str(如 "2006-2010" / 單年 "2024" / 開放 "2019-" / 空 "")。
 * 數字欄優先(present 即用、維持 rpm/bonamici byte 不變);皆缺才解析 year_str。
 * 回 {start,end}:單年 → start=end;開放式(只有起年)→ end=null;無效/空 → 皆 null。
 */
export function resolveFitmentYears(e: SourceFitmentEntry): { start: number | null; end: number | null } {
  // 數字欄任一 present(非 undefined)→ 用數字欄(rpm/bonamici 現況、byte 錨)。null 視為明確「無」。
  if (e.year_start !== undefined || e.year_end !== undefined) {
    return { start: e.year_start ?? null, end: e.year_end ?? null };
  }
  const raw = (e.year_str ?? '').trim();
  if (!raw) return { start: null, end: null };
  // 🔴 嚴格 whitelist(codex 對抗審 must-fix):Number.parseInt 寬鬆會把 "2006abc"→2006、
  //    "2006/2010"→2006 誤收 → 錯年份污染 dedup 鍵 → 同車款誤併/誤裂(車種鐵律)。
  //    僅接受「恰 4 位數字」的段;三段以上 / 起年非法 → 整筆廢回 {null,null}(寧缺勿錯)。
  const parts = raw.split(/[-–—]/).map((s) => s.trim()); // hyphen / en-dash / em-dash
  if (parts.length > 2) return { start: null, end: null }; // 三段以上=髒字串
  const strictYear = (s: string): number | null => {
    if (!/^\d{4}$/.test(s)) return null; // 恰 4 位數字(擋 "2006abc" / "2006/2010" / "20" / 空)
    const n = Number.parseInt(s, 10);
    return n >= 1900 && n <= 2100 ? n : null; // 合理年界
  };
  const start = strictYear(parts[0]!);
  if (start === null) return { start: null, end: null }; // 起年非法 → 整筆廢(不讓髒值污染 dedup 鍵)
  if (parts.length === 1) return { start, end: start }; // 單年 → start=end
  return { start, end: strictYear(parts[1]!) }; // 區間;"2006-" → parts[1]='' → end null(開放式)
}

/**
 * fitments:全群所有變體 fitment_parsed 聯集去重(Q-B=A)。
 * 取 5 key {motoBrand,modelCode,yearStart?,yearEnd,unconfirmed?}、丟其餘內部 key(menu_path / model_raw 等)。
 * 通用件空 entry({} 或 brand+model 皆空)→ 跳過(防呆、避免吐 undefined fitment row)。
 * 年份走 resolveFitmentYears(數字欄優先、缺才解析 year_str 字串);start null/缺 → 省略 yearStart
 *   (domain yearStart?: number、語意=無下限);end null → null。
 * 去重鍵 = 4 軸(motoBrand/modelCode/yearStart/yearEnd);同車款 confirmed 優先(覆寫 unconfirmed)。
 */
function mergeFitments(variants: SourceProductRow[]): FitmentSpec[] {
  const seen = new Map<string, FitmentSpec>();
  for (const v of variants) {
    for (const e of v.fitment_parsed ?? []) {
      if (!e.brand && !e.model) continue; // 通用件空 entry 防呆
      const { start: yStart, end: yEnd } = resolveFitmentYears(e);
      const f: FitmentSpec = {
        motoBrand: e.brand,
        modelCode: e.model,
        ...(yStart != null ? { yearStart: yStart } : {}),
        yearEnd: yEnd,
        ...(e.unconfirmed === true ? { unconfirmed: true } : {}),
      };
      const key = `${f.motoBrand}|${f.modelCode}|${f.yearStart ?? ''}|${f.yearEnd ?? ''}`;
      const prev = seen.get(key);
      // 未見過 → 收;已見且舊的 unconfirmed、新的 confirmed → 用 confirmed 覆寫
      if (!prev || (prev.unconfirmed && !f.unconfirmed)) seen.set(key, f);
    }
  }
  return [...seen.values()];
}

// ── transform ──
export interface ProductRow {
  supplier_slug: string; // 🔴 複合鍵欄、顯式寫不靠 DB DEFAULT
  external_id: string;
  handle: string;
  title: string;
  subtitle: string;
  // 🔴 description 為 optional:依 supplier-config.syncDescription 決定寫不寫(§2.9 F2)。
  //    rpm=false → **全批一致省 key** → upsert `?columns` 聯集不含 description → 現有描述不覆寫、byte 等價(回歸鎖驗)。
  //    試點=true → 帶來源繁中 description;來源 null/空白 → 省 key。
  //    ✅ load 層混批 NULL-clobber 已修(#260、Sean 拍 ①保留現值):rpm-import 寫入段以 rpm-load
  //       partitionByKeyPresence 按 description key 分兩 uniform 批 upsert → 省 key 列不再被
  //       `?columns` 聯集 + defaultToNull(親驗 PostgrestQueryBuilder.ts:1087-1090)寫 NULL。
  //       ⚠️ 未來新增其他「條件省 key」欄位須一併納入 partition 依據(否則混批 NULL-clobber 重現)。
  description?: string;
  // 🔴 highlights 為 optional(供應商級條件、依 supplier-config.syncDescription):true → 展開 string[]
  //    (賣點條列、來源 highlights_zh 正規化);false(rpm)→ 省 key → 凍結現值不覆寫。
  //    與 description(per-row 條件、視來源空否)不同:highlights 在單一 supplier run 內 all-or-nothing
  //    (只看 syncDescription)→ 對 rpm-import description partition 天然 uniform、不需額外 partition(見該處註)。
  highlights?: string[];
  // 🔴 安裝資源(#270)為 optional(供應商級條件、依 supplier-config.syncInstallResources):true → 展開
  //    manuals(恆陣列、可 [])+ video_url(恆值、可 null);false(rpm/cnc)→ 省 key → 凍結不碰。
  //    來源即真相(空來源寫 []/null 是正確語意、非誤覆寫);單一 run all-or-nothing → 同 highlights、
  //    對 rpm-import description partition 天然 uniform、不需額外 partition(見該處註、codex 關卡1 確認)。
  manuals?: InstallManual[];
  video_url?: string | null;
  price_general: number | null;
  price_store: number | null;
  price_by_tier: Record<string, { amount: number; currency: string }>;
  fitments: FitmentSpec[];
  images: string[];
  availability: string;
  brand_id: string;
  category_id: string | null; // fixed=整批固定 id(rpm 恆真實);per-group=逐群 major_category_zh 解析、seed 前對不上→null(dry-run 報告顯示、無 live 風險)
  metadata: Record<string, unknown>;
  // 🔴 S4 復架方向:presence in source = active;upsert 帶 null 自動還原(商品回到 view → 復上架)。
  //    下架方向(source 消失 → 設 now)由 rpm-reconcile 處理、不在 transform。
  delisted_at: string | null;
  updated_at: string;
}
export interface VariantRow {
  supplier_slug: string; // 🔴 複合鍵欄、顯式寫不靠 DB DEFAULT
  sku: string;
  spec: Record<string, string>;
  price_general: number | null;
  price_store: number | null;
  availability: string;
  images: string[];
  sort_order: number;
  metadata: Record<string, unknown>;
  updated_at: string;
}

/**
 * 每群 transform 的「已解析情境」(由 rpm-import 依 supplier-config 逐群組裝供給)。
 * 去碳新增的 handlePrefix / subtitleTag / syncDescription 收成具名物件、不擴正位參數
 *   (避免正位參數暴增誤植 = Fable 前審「參數對調」風險)。
 */
export interface GroupTransformContext {
  brandId: string; // 已由 config.brandSlug resolveId(rpm→rpm-carbon)
  categoryId: string | null; // fixed=整批固定 id;per-group=該群 major_category_zh 解析(seed 前→null)
  handlePrefix: string; // handle = `${handlePrefix}-${mainSku.toLowerCase()}`(rpm→'rpm')
  subtitleTag: string; // 副標分類詞:rpm=分類 rawPath「碳纖維部品」、per-group=major_category_zh
  syncDescription: boolean; // true 才把來源 description 寫進 products.description(rpm=false)
  syncInstallResources: boolean; // #270:true 才把 pdf_urls/video_urls 寫進 products.manuals/video_url(rpm/cnc=false)
}

/** 安裝說明書項(#270;= DB products.manuals jsonb 元素形狀;label 由 transform 生成、sizeKB 來源無故省)。 */
export interface InstallManual {
  label: string;
  url: string;
}

// http(s) URL 驗證:new URL() 嚴驗(protocol http/https + hostname 非空)、比裸 regex 擋掉 'https://'(無 host)等髒值
//   (codex/ultra 關卡2 nit;與 UI InstallResources 的 /^https?:\/\//i 為雙層,transform 為寫入前更嚴的第一層)。
function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

// 安裝說明書正規化:跨變體裸 URL → 乾淨 InstallManual[]。
// 🔴 群級彙整(codex 關卡1 must-fix):吃 variants.flatMap(pdf_urls)、非單一 basis 列(某變體有 PDF、basis 沒有 → 不可漏)。
// 濾 http(s) → 去重保序(同群多變體常帶重複 URL)→ 依數量生 label(D1=A:1 份「安裝說明書」、多份「安裝說明書 N」)。
export function normalizeManuals(rawUrls: (string | null | undefined)[]): InstallManual[] {
  const clean = [...new Set(rawUrls.filter((u): u is string => typeof u === 'string' && isHttpUrl(u)).map((u) => u.trim()))];
  if (clean.length === 1) return [{ label: '安裝說明書', url: clean[0]! }];
  return clean.map((url, i) => ({ label: `安裝說明書 ${i + 1}`, url }));
}

// YouTube videoId 抽取:🔴 與 UI apps/storefront/src/components/InstallResources.tsx parseYoutubeId 邏輯對齊(改一邊要同步另一邊)。
//   host 白名單(去 www.)youtu.be / youtube.com / m.youtube.com;抽 watch?v= / embed|shorts / youtu.be 路徑;id 需合 ^[\w-]{6,}$。
//   transform 多一道 protocol http(s) 守衛(擋 javascript://youtu.be/... 偽裝、寫入前更嚴);抽不到(頻道/播放清單等)→ null。
function extractYoutubeId(url: string): string | null {
  let id: string | null = null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      id = u.pathname.split('/')[1] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else {
        const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/);
        id = m ? (m[1] ?? null) : null;
      }
    }
  } catch {
    return null;
  }
  return id && /^[\w-]{6,}$/.test(id) ? id : null;
}

// Vimeo id 抽取:host 白名單(去 www.)vimeo.com / player.vimeo.com;id 必純數字路徑段
//   (擋 /channels/staffpicks 等非影片路徑)。http(s) 守衛同 extractYoutubeId。
//   unlisted 型 vimeo.com/<id>/<hash> 同樣命中(segs[0]=id);管線存原始 URL、privacy hash 隨 URL
//   保留到 UI 端由 parseVimeo 抽出附 ?h=(embed 權限)。
//   🔴 與 UI InstallResources.tsx parseVimeo 邏輯對齊(改一邊要同步另一邊)。
function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
    const segs = u.pathname.split('/').filter(Boolean);
    const id = host === 'player.vimeo.com' ? (segs[0] === 'video' ? (segs[1] ?? null) : null) : (segs[0] ?? null);
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// 影片直檔判定:http(s) + pathname 副檔名白名單(query 不干擾;Evotech cdn.shopify/S3 .mp4 在名單內)。
//   🔴 刻意窄於嵌入指南 §4「其餘一律視為 file」——寫入管線 fail-closed、任意網頁 URL 不當影片寫入。
//   🔴 與 UI InstallResources.tsx parseVideoFileSrc 對齊(改一邊要同步另一邊)。
const VIDEO_FILE_EXTS = ['.mp4', '.webm', '.m4v', '.mov'];
function isVideoFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const p = u.pathname.toLowerCase();
    return VIDEO_FILE_EXTS.some((ext) => p.endsWith(ext));
  } catch {
    return false;
  }
}

// 安裝影片挑選:跨變體裸 URL → 第一支「可解析」的影片(youtube videoId / vimeo 數字 id / 直檔副檔名)。
// 🔴 2026-07-10 混格式放寬(品牌放量 kickoff §2、supersede D2=A「第一支 YouTube」):evotech mp4 /
//    lightech·cncracing Vimeo 納入;UI InstallResources resolveVideo 同步三分流。多支=follow-up 記 backlog。
// 🔴 ultra/codex 關卡2 must-fix 沿用:頻道/播放清單 URL(host 符合但無 id)不佔位、續試下一支,避免靜默吃掉後面真影片。
// 🔴 群級彙整(同 normalizeManuals)。
export function pickInstallVideo(rawUrls: (string | null | undefined)[]): string | null {
  for (const raw of rawUrls) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (extractYoutubeId(trimmed) !== null || extractVimeoId(trimmed) !== null || isVideoFileUrl(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

// 賣點條列正規化:來源 jsonb → 乾淨 string[](濾非字串與純空白;非陣列/null → [])。
// 對齊 products.highlights NOT NULL DEFAULT '[]':值恆為陣列、never null;不改字面(鐵則 1 忠實搬)。
function normalizeHighlights(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

/** 群內「應寫進網站」的變體。
 *
 *  view v3「投影不過濾」後,停產列不再從來源消失 => 停產變體不會被判孤兒、會照常 upsert 成
 *  可售變體;而 create_order 的下架擋阻只看【產品層】p.delisted_at
 *  (20260716200000_m4a_v3a_create_order_vehicle_type_guard.sql:171),部分停產群的產品層是 null
 *  => 客人仍可下單買到停產的那個顏色/規格(rpm-reconcile.ts:9-14 要防的正是此事)。
 *  故部分停產群把停產變體剔除 => 進不了 sourceVariantSkus => 判孤兒 => 硬刪。
 *
 *  🔴 整群停產者【保留全部變體】:
 *    - 產品層 delisted_at 已設 => 網站 RLS 隱藏 + create_order 擋單,保護已足夠;
 *    - 若連整群停產也剔除,會一次產生大量孤兒:實測 bonamici 148/1006 = 14.7%,
 *      超過 VARIANT_DELETE_RATIO_ABORT 10%(rpm-reconcile.ts)=> 整批同步 abort。
 *  實測目前部分停產僅 cncracing 2 群 3 個變體 = 3/4379 = 0.07%,遠低於閘門。
 *
 *  ⚠️ 此結果必須【同時】餵給 transformGroup 與 transformVariant:群層價格/圖片/文案取自變體集合,
 *     若群層仍吃全部變體、只有變體列被剔除,商品卡會顯示一個已不存在之停產變體的價格。
 */
export function liveVariantsOf(variants: SourceProductRow[]): SourceProductRow[] {
  return isFullyDelisted(variants) ? variants : variants.filter((v) => !v.delisted_at);
}

/** 整群停產 = 群內每一顆變體都帶來源側墓碑。單一真相,liveVariantsOf 與 transformGroup 共用
 *  (R2-N3:原本兩處各寫一次同樣的 every 判斷 = 雙份真相,日後只改一邊就會不一致)。 */
export function isFullyDelisted(variants: SourceProductRow[]): boolean {
  return variants.length > 0 && variants.every((v) => v.delisted_at);
}

export function transformGroup(
  mainSku: string,
  variants: SourceProductRow[],
  vehicleLabel: string | null,
  ctx: GroupTransformContext,
  now: string,
): ProductRow {
  // 基準款 = 群內 min(price_retail)、tie-break sku ASC(零售真相、語意一致)
  const sorted = [...variants].sort((a, b) => {
    const d = Number(a.price_retail) - Number(b.price_retail);
    return d !== 0 ? d : a.sku < b.sku ? -1 : 1;
  });
  const basis = sorted[0];
  if (!basis) throw new Error(`群 ${mainSku} 無變體(分群保證 ≥1、不應發生)`);
  const priceGeneral = roundTwd(basis.price_retail); // 🔴 view.price_retail → 網站 price_general(零售)
  // 群代表圖:第一個非空 image_url → 任一變體 images[0] → placeholder
  const repImage =
    variants.find((v) => v.image_url)?.image_url ??
    variants.flatMap((v) => mapImages(v.images))[0] ??
    PLACEHOLDER_IMAGE;
  // 描述:群內第一個非空來源描述(product-level、群內應一致;防呆取 first non-empty、含純空白視為空、F4)。
  const description = variants.find((v) => (v.description ?? '').trim() !== '')?.description ?? null;
  // 賣點:群內第一個非空賣點陣列(product-level、群內應一致;防呆 first non-empty、正規化為 string[])。
  const highlights = variants.map((v) => normalizeHighlights(v.highlights_zh)).find((h) => h.length > 0) ?? [];
  // 安裝資源(#270):群級彙整跨全變體(codex 關卡1 must-fix、非單一 basis 列)→ UI 形狀。
  const manuals = normalizeManuals(variants.flatMap((v) => v.pdf_urls ?? []));
  const videoUrl = pickInstallVideo(variants.flatMap((v) => v.video_urls ?? []));
  return {
    supplier_slug: basis.supplier_slug, // view 過濾值、顯式帶
    external_id: mainSku, // 🔴 乾淨主料號、無前綴(view.main_sku 已大寫、對齊 S3a 洗淨值)
    handle: `${ctx.handlePrefix}-${normalizeHandleSegment(mainSku)}`, // SEO slug、供應商命名空間化(rpm→'rpm-');#266 正規化(髒字元→hyphen;rpm 合法 sku=no-op、byte 不變)
    title: basis.product_name_zh || basis.product_name, // 中文部位詞優先、回退英文
    subtitle: buildSubtitle(vehicleLabel, ctx.subtitleTag),
    // 🔴 description 條件寫入(§2.9 F2):syncDescription 且來源非空才展開 key。
    //    rpm(false)→ 展開 {} → 無此 key → byte 等價(回歸鎖驗)。混批 NULL-clobber 已由 load 層 partition 修(見 ProductRow 註、#260)。
    ...(ctx.syncDescription && description != null ? { description } : {}),
    // 🔴 highlights 供應商級條件寫入:syncDescription=true 才展開 key(rpm=false → 無 key → 凍結不碰);
    //    all-or-nothing per run → rpm-import description partition 天然 uniform(見該處寫入段註)。
    ...(ctx.syncDescription ? { highlights } : {}),
    // 🔴 安裝資源(#270)供應商級條件寫入:syncInstallResources=true 才展開 manuals+video_url 兩 key(rpm/cnc=false → 無 key → 凍結);
    //    gate 下兩 key 恆出現(manuals 恆陣列、video_url 恆 null|string)→ 單一 run uniform → 免 partition(codex 關卡1 確認)。
    ...(ctx.syncInstallResources ? { manuals, video_url: videoUrl } : {}),
    price_general: priceGeneral,
    price_store: null, // 🔴 Q2=A 獨立經銷欄留 NULL(view 無經銷價、絕不接)
    price_by_tier: {
      general: { amount: priceGeneral ?? 0, currency: TWD },
      // ⚠️ store=零售 placeholder(現役 CHECK 逼 general+store 兩 key);非真經銷價、M-2-08 別信此欄
      store: { amount: priceGeneral ?? 0, currency: TWD },
    },
    fitments: mergeFitments(variants),
    images: [repImage],
    availability: variants.some((v) => availabilityOf(v.stock_status) === 'in-stock')
      ? 'in-stock'
      : 'out-of-stock', // 群 bool_or(任一變體可買=in-stock)
    brand_id: ctx.brandId, // 🔴 供應商對照解析(view.brand=車輛品牌、絕不當 brand_id)
    category_id: ctx.categoryId, // fixed=整批固定 / per-group=逐群 major_category_zh 解析(未 seed→null)
    metadata: {
      name_en: basis.product_name, // 英文全名留參考(非敏感、S1 CHECK 不擋)
    }, // 🔴 停寫 shopee/cost/source_*(S1 CHECK 硬擋)+ source_corrected_count(view 無 manually_corrected)
    // 下架權威 = 來源側單一裁判(合約 §10;view v3 起投影 delisted_at)。
    // 🔴 鏡射、不重判:改前是無條件 null(出現在 source 即視為上架),等於要求 S4 從
    //    「view 缺席」自行推下架 —— 正是合約要消滅的雙重去抖,且會讓大批停產撞上
    //    W1 5% / S4 10% 兩道防誤殺閘(bonamici 22.9% 曾使該供應商同步整個凍結)。
    // 群層語意比照上方 availability 的 bool_or:**全部變體都已下架才算整群下架**,
    //    只要有任一變體仍在售就維持上架(取最新時戳當群下架時間)。
    // 來源未投影此欄(舊 view / 舊 fixture)→ undefined → 視同未下架、行為與改前一致。
    // 取 max 僅為記錄語意:下游全部只做 IS NULL 判斷(rpm-reconcile.ts:49,110、
    // 網站 RLS 20260602135934:64、create_order:171),不依賴精確時戳。
    // 先 filter 出非空值再取 max(不用 reduce 種子 '' 與 ! 斷言):若日後有人把 every 放寬成 some,
    // 這裡不會啞掉漏出空字串,而是自然取到實際最新值。
    delisted_at: isFullyDelisted(variants)
      ? variants
          .map((v) => v.delisted_at)
          .filter((d): d is string => Boolean(d))
          .sort()
          .at(-1) ?? null
      : null,
    updated_at: now, // 顯式帶(無 trigger)
  };
}

export function transformVariant(
  v: SourceProductRow,
  now: string,
  sortOrder: number,
  // W3:顯式帶策略(無 default、fail-closed 逼呼叫端從 supplier-config 決策;rpm='sku-prefix-pool' byte 錨)
  variantImages: VariantImageStrategy,
): VariantRow {
  return {
    supplier_slug: v.supplier_slug, // 'rpm'(顯式帶)
    sku: v.sku, // 🔴 原樣、不 UPPER(join key、讀當前值)
    spec: v.spec ?? {}, // {weave,finish}+optional special、值全 string(view 直接吐)
    price_general: roundTwd(v.price_retail), // 🔴 view.price_retail → price_general(零售)
    price_store: null, // 🔴 Q2=A 經銷欄留 NULL(變體表無 price_by_tier、無 placeholder 需求)
    availability: availabilityOf(v.stock_status),
    images: ownVariantImages(v, variantImages), // 該變體專屬圖(策略分支);空→[] 靠 16c fallback
    sort_order: sortOrder,
    metadata: {}, // 🔴 停寫全部(4 敏感 S1 CHECK 擋 + source_corrected view 無來源)
    updated_at: now,
  };
}

/**
 * 變體排序:weave 字母 ASC → finish ASC → special 末 → sku ASC(確定性、不用 price)。
 * 🔴 shape-generic fallback(plan §2.1 #13):spec 缺 weave/finish(bonamici {color,material})或 spec=null
 *   (gbracing 單變體)→ 前綴退化為空字串 → 純 sku ASC、不 crash。**故意保留 weave/finish/special 專鍵**:
 *   改成「通用 spec 序列化」會重排 rpm 變體 sort_order = byte 回歸,rpm 順序不動是最高約束。
 */
export function variantSortKey(v: SourceProductRow): string {
  const s = v.spec ?? {};
  return `${s.weave ?? ''}|${s.finish ?? ''}|${s.special ? '1' : '0'}|${v.sku}`;
}
