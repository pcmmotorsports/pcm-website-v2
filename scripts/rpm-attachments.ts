/**
 * rpm-attachments — 商品附件(說明書 PDF / 安裝影片)正規化。純函式、無 IO。
 *
 * 2026-08-08 從 rpm-transform.ts 拆出(該檔已 >400 行、鐵則 6),同時把說明書標籤規則
 * 從「按數量硬編」換成「按 doc_type 給中文名」(報價單側合約 v5、交接檔
 * `docs/handoff/2026-08-07-f-line-attachments-final-handoff.md`)。
 *
 * 🔴 合約 v5 的三條紅線(交接檔 §2):
 *   1. **只看 doc_type**。不看 type_id、不自己解析檔名判種類、不沿用舊的按數量編號。
 *      type_id 只有 akrapovic 有值、其餘全 null;拿它判種類會讓五家七千多份說明書全變通稱。
 *   2. 過渡期 `doc.doc_type ?? 'install'` —— 「沒有 doc_type」不是缺資料、不得整列 reject。
 *   3. pdf_docs 與 pdf_urls 的 URL 串建構上必然相等,**兩欄擇一、絕對不要合併**(合併=每份文件出現兩次)。
 *
 * 🔴 檔名後綴是**供應商級**決定(交接檔 §3),不是看檔名長相猜:
 *   - gbracing / evotech:多份=不同車款的同一種文件 ⇒ 標籤後括號接檔名,客人靠它挑自己那台。
 *   - akrapovic:檔名是 GUID ⇒ **不接**,同類多份用編號(接了會變「文件(ffdd4e47-…)」)。
 */

/** products.manuals jsonb 元素形狀(label 由本檔生成;sizeKB 來源無、故省)。 */
export interface InstallManual {
  label: string;
  url: string;
}

/** 來源 storefront_catalog_v.pdf_docs 元素(第 29 欄、合約 v5)。
 *  doc_type/type_id 皆 optional:2026-08-08 00:0x 實查,akrapovic 635 列只有 {url,type_id}、
 *  doc_type 全庫 0 列(各家 fetcher 下次跑過才回填);其餘五家 pdf_docs 整欄 null。 */
export interface SourcePdfDoc {
  doc_type?: string | null;
  type_id?: number | null;
  url: string;
}

// doc_type → 中文名(交接檔 §2 表)。用 Map 不用物件字面:
// 🔴 `obj[來源字串]` 會取到原型鏈成員(`constructor` / `toString` 都是 truthy),讓「未知 doc_type」
//    靜默拿到函式當標籤。Map.get 對未知鍵一律 undefined、無原型鏈面。
const DOC_TYPE_LABEL = new Map<string, string>([
  ['install', '安裝說明書'],
  ['parts_diagram', '零件分解圖'],
  ['other', '文件'],
]);
// 未知 / 新增的 doc_type → 落到最低調的那類(交接檔把 other 定義為「認證、型錄等雜項」)。
// fail-safe 方向:寧可把真說明書降級成「文件」,也不要把雜項冒充成「安裝說明書」誤導客人。
const FALLBACK_LABEL = '文件';
// 過渡期預設(交接檔 §2):doc_type 尚未回填時視為安裝說明書 = 維持現狀。
const DEFAULT_DOC_TYPE = 'install';

// http(s) URL 驗證:new URL() 嚴驗(protocol http/https + hostname 非空)、比裸 regex 擋掉 'https://'(無 host)等髒值
//   (與 UI InstallResources 的 /^https?:\/\//i 為雙層,本層為寫入前更嚴的第一層)。
export function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * 從 URL 取「給人看的檔名」:最後一段路徑、去 .pdf、URL 解碼。
 * `+` 先換空白再解碼:evotech 的 S3 檔名用 `+` 當空白
 *   (實查 `015396+triumph+trident+tail+tidy+instructions.pdf`)。
 * query string 不干擾(用 pathname);解不出 / 壞 URL / 空 → 回空字串,由呼叫端退回編號。
 */
export function filenameLabelOf(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
    return decodeURIComponent(last.replace(/\+/g, ' '))
      .replace(/\.pdf$/i, '')
      .trim();
  } catch {
    return '';
  }
}

/**
 * 說明書正規化:群級彙整過的 pdf_docs → 乾淨 InstallManual[]。
 *
 * 步驟:①濾非 http(s) ②依 URL 去重保序(同群多變體常帶重複)③依 doc_type 給中文名
 *   ④同一中文名多份時的區分方式:appendFilename ? 括號接檔名 : 標籤後加編號。
 *
 * 🔴 編號與檔名都是**同類內**的事(交接檔「同一類多份怎麼區分」):三份安裝說明書 + 一份零件分解圖
 *    ⇒ 前者編 1/2/3、後者不編號,不是全群連號。
 * 🔴 appendFilename 模式下再做一次「同標籤去重」:同群不同變體常把同一份文件掛在不同 GUID 目錄下
 *    (URL 不同、檔名相同)⇒ 只靠 URL 去重會吐出兩個一模一樣的標籤 = 客人看到重複項。
 *    非 appendFilename 模式不做這步(那邊標籤本來就靠編號區分、不會撞)。
 */
export function normalizeManuals(
  docs: (SourcePdfDoc | null | undefined)[],
  opts: { appendFilename: boolean },
): InstallManual[] {
  const seenUrl = new Set<string>();
  const clean: { url: string; base: string }[] = [];
  for (const d of docs) {
    if (!d || typeof d.url !== 'string' || !isHttpUrl(d.url)) continue;
    const url = d.url.trim();
    if (seenUrl.has(url)) continue;
    seenUrl.add(url);
    const kind = d.doc_type ?? DEFAULT_DOC_TYPE;
    clean.push({ url, base: DOC_TYPE_LABEL.get(kind) ?? FALLBACK_LABEL });
  }

  // 同類份數(決定要不要編號);appendFilename 模式不看這個。
  const countByBase = new Map<string, number>();
  for (const c of clean) countByBase.set(c.base, (countByBase.get(c.base) ?? 0) + 1);

  const seqByBase = new Map<string, number>();
  const out: InstallManual[] = [];
  const seenLabel = new Set<string>();
  for (const c of clean) {
    let label: string;
    const filename = opts.appendFilename ? filenameLabelOf(c.url) : '';
    if (filename) {
      label = `${c.base}(${filename})`;
      if (seenLabel.has(label)) continue; // 同標籤=同一份文件的不同存放路徑,不重複列
      seenLabel.add(label);
    } else if ((countByBase.get(c.base) ?? 0) > 1) {
      // 同類多份且沒有可用檔名 → 編號(akrapovic 走這條;appendFilename 家的壞 URL 也退回這條)
      const n = (seqByBase.get(c.base) ?? 0) + 1;
      seqByBase.set(c.base, n);
      label = `${c.base} ${n}`;
    } else {
      label = c.base;
    }
    out.push({ label, url: c.url });
  }
  return out;
}

// ── 安裝影片 ──
// YouTube videoId 抽取:🔴 與 UI apps/storefront/src/components/InstallResources.tsx parseYoutubeId 邏輯對齊(改一邊要同步另一邊)。
//   host 白名單(去 www.)youtu.be / youtube.com / m.youtube.com;抽 watch?v= / embed|shorts / youtu.be 路徑;id 需合 ^[\w-]{6,}$。
//   本層多一道 protocol http(s) 守衛(擋 javascript://youtu.be/... 偽裝、寫入前更嚴);抽不到(頻道/播放清單等)→ null。
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
