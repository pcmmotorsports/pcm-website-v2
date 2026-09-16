import 'server-only';
import { unstable_cache } from 'next/cache';
import { createCatalogAnonClient } from '@/lib/catalog-anon-client';

// home-banners.ts — 首頁輪播讀「已發布的新品大圖」(email 新品 → 首頁大圖 片 3;2026-09-16)
//
// 需求:docs/plans/2026-09-15-email-newproduct-homepage-banner-prd.md §5;
//   Sean Q1 乙(混進既有輪播)、Q11 甲(第 1 格先播)、Q12 甲(白底商品照放展示台照常發布)、Q6 乙(不接 Vercel 縮圖)。
// 資料:`home_banners_live_v`(20260916150000):只露已發布且在上下架時間內的列,DB 端擋「任何時刻最多一張」。
// OD 稿:pcm-home-redesign/home-hero-newproduct-v1.html(#scene / #product)。
//
// 🔴 **讀不到 = 沒有大圖,首頁照舊**(PRD §5「不讓首頁 500」):
//   · 逾時 / 查詢錯誤 / client 建不起來 ⇒ `fetchLiveHomeBanner` 回 null,server log 只記一行分類(不印內容)
//   · 列的形狀不對(連結不是站內路徑、圖不是 https、類型不認得)⇒ 當作沒有大圖,不猜著畫
// 🔴 快取 60 秒(同最新商品的節奏,PRD §5):後台與前台是兩個 app,發布後最慢約 1 分鐘出現。
//   ⚠️ 錯誤是在快取函式【裡面】throw 的 ⇒ `unstable_cache` 不會把失敗存起來,下一個請求會重試。

export type HomeBannerKind = 'scene' | 'product';

export type LiveHomeBanner = {
  id: string;
  eyebrow: string | null;
  titleLine1: string;
  titleLine2: string | null;
  subtitle: string | null;
  ctaLabel: string;
  linkPath: string;
  imageDesktopUrl: string;
  imageMobileUrl: string | null;
  kind: HomeBannerKind;
};

/** 按鈕字沒填時的預設(DB 不要求 cta_label 必填)。 */
export const HOME_BANNER_DEFAULT_CTA = '看新品';

/**
 * 讀取上限。首頁 `Promise.all` 等的是最慢的那一件 ⇒ 這支是「有更好、沒有也行」的內容,
 * 給它的時間比目錄讀路(15 秒)短很多:DB 慢的那一刻寧可這一發不掛大圖,也不要拖住整頁。
 */
export const HOME_BANNER_READ_TIMEOUT_MS = 2500;

const COLUMNS =
  'id,eyebrow,title_line1,title_line2,subtitle,cta_label,link_path,image_desktop_url,image_mobile_url,image_kind,starts_at';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * 站內相對路徑:開頭恰一個 `/`、後面不是 `/` 或 `\`,整串沒有空白 / 控制字元 / 反斜線。
 * 🔴 DB CHECK 已擋一次(`home_banners_link_path_check`);這裡再擋一次,因為 `<a href>` 接的是這個值
 *   (`//evil.com`、`/\evil.com` 在瀏覽器都是外站)。
 */
export function isSafeInternalPath(path: string): boolean {
  return /^\/[^/\\]/.test(path) && !/[\\\s\x00-\x1f\x7f]/.test(path);
}

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** view 的一列 ⇒ 前台要的形狀;任何一格不合就回 null(當作沒有大圖)。 */
export function toLiveHomeBanner(row: Record<string, unknown> | null | undefined): LiveHomeBanner | null {
  if (!row) return null;
  const id = text(row.id);
  const titleLine1 = text(row.title_line1);
  const linkPath = text(row.link_path);
  const imageDesktopUrl = text(row.image_desktop_url);
  const kind = row.image_kind;
  if (!id || !titleLine1 || !linkPath || !imageDesktopUrl) return null;
  if (kind !== 'scene' && kind !== 'product') return null;
  if (!isSafeInternalPath(linkPath) || !isHttpsUrl(imageDesktopUrl)) return null;
  const mobile = text(row.image_mobile_url);
  return {
    id,
    eyebrow: text(row.eyebrow),
    titleLine1,
    titleLine2: text(row.title_line2),
    subtitle: text(row.subtitle),
    ctaLabel: text(row.cta_label) ?? HOME_BANNER_DEFAULT_CTA,
    linkPath,
    imageDesktopUrl,
    // 手機圖不合格就退回桌機圖(不因為一個選填欄位讓整張大圖消失)
    imageMobileUrl: mobile && isHttpsUrl(mobile) ? mobile : null,
    kind,
  };
}

type BannerQueryResult = { data: Record<string, unknown>[] | null; error: { code?: string } | null };
type BannerClient = {
  from: (view: string) => {
    select: (columns: string) => {
      order: (column: string, opts: { ascending: boolean }) => {
        limit: (n: number) => PromiseLike<BannerQueryResult>;
      };
    };
  };
};

/**
 * 首頁最多掛幾張大圖(Sean 2026-09-16 批輪播稿)。
 *
 * 🔴 **這個 4 與 `HomeHero` 裡寫死的四張照片(`SLIDES`)【不相干】** —— 兩者剛好同數字。
 *    ⇒ 直接寫死 `4` 會讓下一個人以為它們有關;給名字是為了**切斷那個誤會**,
 *      不是為了「以後可能要改」(只有一個地方用它,不需要設定檔)。
 * 🔵 取名跟同檔的 `HOME_BANNER_READ_TIMEOUT_MS` 同款 —— 沿用既有慣例,不是新發明。
 */
export const HOME_BANNER_MAX_SLIDES = 4;

/**
 * 真的去讀(不快取)。**失敗一律 throw**(讓外層決定怎麼退)。
 *
 * 🔴 **2026-09-16 從「一張」改成「一疊」**(Sean 批輪播稿)。
 *    ⚠️ **只把 `.limit(1)` 改成 `.limit(4)` 是【零效果】的** —— 原本下一行是 `toLiveHomeBanner(data?.[0])`,
 *    多拿的三筆當場被丟掉;而型別、`page.tsx`、`HomeHero` 的 prop 也全是單數。
 *    📌 **那種改法會產生一個完美的假完成:commit 有、diff 有、`.limit(4)` 白紙黑字,三綠全過、
 *       測試全綠,而畫面一模一樣。** ⇒ 這一改是**整條路一起換形狀**,不是換一個數字。
 *
 * 🔴 **形狀不合的那一筆【只丟那一筆】,不再讓它把整個輪播關掉**(語意有變,刻意的):
 *    舊版一筆壞 ⇒ 回 `null` ⇒ 首頁沒有大圖;新版四筆裡一筆壞 ⇒ **剩下三筆照掛**。
 *    ⇒ 一張圖的網址填錯,不該讓另外三張一起消失。
 */
export async function loadLiveHomeBanners(
  client: BannerClient = createCatalogAnonClient() as unknown as BannerClient,
  timeoutMs: number = HOME_BANNER_READ_TIMEOUT_MS,
): Promise<LiveHomeBanner[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    // 🔵 排序**沒有動**:`starts_at` 由新到舊 = 最新上架的排前面(Sean 2026-09-16 逐字答甲)。
    //    view 本身不帶順序(它的 COMMENT 逐字「不帶順序(輪播排第幾張 Sean 未拍)」)⇒ 順序一直由前台決定。
    const query = client
      .from('home_banners_live_v')
      .select(COLUMNS)
      .order('starts_at', { ascending: false })
      .limit(HOME_BANNER_MAX_SLIDES);
    const { data, error } = await Promise.race([Promise.resolve(query), timeout]);
    if (error) throw new Error(`query error ${error.code ?? 'unknown'}`);
    return (data ?? []).map(toLiveHomeBanner).filter((b): b is LiveHomeBanner => b !== null);
  } finally {
    clearTimeout(timer);
  }
}

// 🔴🔴 **快取 key 從 `v1` 換成 `v2`,而那【不是】順手改的**:
//    回傳形狀從「一個物件或 null」變成「陣列」⇒ **沿用 `v1` 的話,部署後那 60 秒內
//    拿到的是上一版存進去的【單一物件】**,而下游會把它當陣列用 ⇒ 首頁當場壞掉。
//    📌 快取的 key 是那份資料的**形狀契約**;形狀變了而 key 沒變,是一個只在部署那一刻發作、
//       而且在本機永遠重現不出來的 bug。
const getLiveHomeBannersCached = unstable_cache(() => loadLiveHomeBanners(), ['home-banner-live-v2'], {
  revalidate: 60,
  tags: ['home-banner'],
});

/** 首頁用:永遠不 throw。讀不到 ⇒ 空陣列(首頁照舊四張照片)。 */
export async function fetchLiveHomeBanners(): Promise<LiveHomeBanner[]> {
  try {
    return await getLiveHomeBannersCached();
  } catch (err) {
    // 🛑 只記分類,不印列內容
    console.warn(`[homeBanner] 讀取失敗,首頁不掛大圖:${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`);
    return [];
  }
}
