import { checkBannerCopy, checkSocialCopy } from '@pcm/domain';
import type {
  BannerCopy,
  CatalogSkuMatch,
  HomeBannerSystemDraft,
  IBannerCopywriter,
  ICatalogSkuMatcher,
  IInboundMailReader,
  ISupplierNewProductStore,
  InboundMailMessage,
  InboundMailRecord,
  SupplierMailSender,
} from '@pcm/ports';

/**
 * 每天讀廠商新品信 → 首頁大圖草稿(PRD 2026-09-15 §4;Sean §11:跑在網站雲端排程、Claude 起草、只存必要欄位)。
 *
 * 一輪:列信(最多 20 封)→ 去重 → 寄件者白名單 → Gmail 自己算的 SPF/DKIM/DMARC 對齊 → 抽料號與圖
 *      → 配商品、產連結 → AI 起草文字(失敗就用主旨)→ 記信 + 建草稿(同一個交易,由 store 負責)。
 *
 * 🔴 **草稿一律 rights_confirmed = false**(DB 預設)⇒ 發布前一定有管理者勾授權。
 * 🔴 **連結與圖由程式決定,AI 只寫字**;AI 回的字會被截到 DB 字數上限。
 * 🔴 單封失敗不擋整輪(記 failed);列信失敗(權杖失效 / API 掛)⇒ throw,整輪停,由 route 回 503。
 * 🔴 45 秒後不再開始新的一封(route maxDuration 60),剩下的算 deferred,下一輪再讀(查詢式重疊 3 天)。
 */

export const SUPPLIER_MAIL_QUERY = 'label:PCM新品 newer_than:3d';
export const SUPPLIER_MAIL_MAX_PER_RUN = 20;
export const SUPPLIER_MAIL_TIME_BUDGET_MS = 45_000;
const TEXT_EXCERPT_MAX = 2000;
const IMAGE_MAX = 10;
/** 單一圖網址上限(同 DB home_banners image_desktop_url CHECK)。 */
const IMAGE_URL_MAX = 2000;
/** 圖網址總長上限 ⇒ extracted jsonb 不會撞 16KB CHECK。 */
const IMAGE_TOTAL_MAX = 8000;
const SKU_MAX = 50;
/**
 * 一張草稿最多帶幾個「配到的商品」。
 * 🔴 這個數字要等於 `home_banners` 那條 CHECK 的上限(20260916150000:168 `cardinality(...) <= 200`)。
 *    超過 ⇒ INSERT 撞 23514 ⇒ 那封信記成 failed ⇒ 三天後 `newer_than:3d` 撈不到
 *    ⇒ **那封信永遠不會有草稿,而且沒有任何地方會叫**。
 *    一個料號可以配到多個變體 ⇒ 50 個料號要破 200 是做得到的(2026-09-16 合併後盲審 N1)。
 */
const MATCHED_VARIANT_MAX = 200;
/** 同 DB home_banners CHECK(20260916150000)。 */
const COPY_MAX = { eyebrow: 40, title: 60, subtitle: 60, cta: 20 } as const;
/** 同 DB home_banners_fb_text_check / home_banners_ig_text_check(20261001120000)。超過就不寫, 不截字。 */
const SOCIAL_MAX = 2200;

export interface DraftSupplierNewProductBannersDeps {
  readonly reader: IInboundMailReader;
  readonly copywriter: IBannerCopywriter;
  readonly matcher: ICatalogSkuMatcher;
  readonly store: ISupplierNewProductStore;
  readonly senders: readonly SupplierMailSender[];
  /** 測試用;預設 Date.now。 */
  readonly now?: () => number;
  /**
   * 一輪的時間上限與封數上限(預設是 Vercel route 的 45 秒 / 20 封)。
   * mac mini 版(apps/storefront/src/lib/supplier-mail/newsletter-drafts-macmini.ts)用 claude -p 起草, 一封要幾十秒 ⇒ 放寬時間、收緊封數。
   */
  readonly timeBudgetMs?: number;
  readonly maxPerRun?: number;
}

export interface DraftSupplierNewProductBannersResult {
  listed: number;
  known: number;
  skippedSender: number;
  skippedAuth: number;
  drafted: number;
  noProducts: number;
  failed: number;
  /** 時間用完、這一輪沒開始處理的封數(下一輪再讀)。 */
  deferred: number;
}

// ── 純函式(匯出給測試)─────────────────────────────────────────────

/**
 * From 標頭 ⇒ 小寫信箱。取【最後一個】角括號裡的位址 ——
 * `"Akrapovic <news@akrapovic.com>" <x@evil.com>` 顯示名稱裡那個是騙人的,真正的是最後那個。
 */
export function parseFromAddress(from: string): string | null {
  const angles = [...from.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)];
  const raw = angles.length > 0 ? angles[angles.length - 1]![1] : /^\s*([^\s<>"]+@[^\s<>"]+)\s*$/.exec(from)?.[1];
  return raw ? raw.toLowerCase() : null;
}

export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}

/** 完整信箱精確相等;`@網域` 只認那個網域本身(不含子網域)。 */
export function matchSender(senders: readonly SupplierMailSender[], address: string): SupplierMailSender | null {
  const domain = domainOf(address);
  return (
    senders.find((s) => s.sender.toLowerCase() === address) ??
    senders.find((s) => s.sender.startsWith('@') && s.sender.slice(1).toLowerCase() === domain) ??
    null
  );
}

function domainAligned(value: string, domain: string): boolean {
  const d = value.replace(/^.*@/, '').toLowerCase();
  return d === domain || d.endsWith(`.${domain}`);
}

/**
 * 寄件網域驗證(adversarial-reviewer R1 M1 / M2)。
 *
 * 🔴🔴 **只信 Gmail 自己寫的那一條 Authentication-Results**(authserv-id = `mx.google.com`、最上面那條)。
 *    寄件人可以在信裡自己塞一條 `Authentication-Results: x; dmarc=pass header.from=akrapovic.com`,
 *    Gmail 只會刪掉冒用它自己名字的那種 ⇒ 別的名字的假標頭會留著 ⇒ 不能每一條都信。
 *    ⚠️ 前提:Gmail API 回的 headers 照信件原本的順序(最上面的在前)—— 還沒接真 Gmail,接上那天要驗。
 * 🔴 那一條裡的 `header.from` 就是 Gmail 看到的真實寄件網域 ⇒ 跟我們解析出來的 From 網域對不上 ⇒ 直接不過
 *    (擋「顯示名稱裡藏一個假信箱」)。
 * 然後:DMARC pass,或 DKIM / SPF pass 且網域對齊 ⇒ 過。
 * ⚠️ 代價:經過轉寄的廠商信通常會掉 ⇒ skipped_auth。方向是寧可漏,不要被冒名。
 */
export function authAligned(headers: readonly string[], fromDomain: string): boolean {
  // 🔴 R2 K2:header 順序是假設 ⇒ 出現兩條以上 mx.google.com 就不信任何一條(轉寄過 Gmail 的信本來就會掉)
  const google = headers.filter((h) => /^\s*mx\.google\.com\s*;/i.test(h));
  if (google.length !== 1) return false;
  // 🔵 2026-10-01 mac mini 實測:Gmail 會把 DKIM 簽章值寫成 `header.b="AbCd1234"`(lightech.it 那封)⇒ 整行有引號 ⇒ 下面那條把真信判成不過。
  //    只拿掉【簽章值本身】:限 base64 字元、引號要成對(主視窗 10-01 甲:其他引號判斷一律不放寬)。
  //    簽章值不參與下面任何判斷;不是 base64 的(例 `header.b="x;dmarc=pass"`)不會被拿掉 ⇒ 照樣撞引號那條。
  const trusted = google[0]!.replace(/\bheader\.b=(?:"[A-Za-z0-9+/=]*"|[A-Za-z0-9+/=]+)/gi, 'header.b=_');
  // 🔴 R2 K1:用 `;` 切會切到註解 / 引號裡的字(寄件地址可以帶 `"x;dmarc=pass header.from=…"`)⇒ 有引號就不過
  if (trusted.includes('"')) return false;
  const parts = trusted.toLowerCase().split(';').map((p) => p.trim());
  const dmarcParts = parts.filter((p) => /^dmarc=/.test(p));
  if (dmarcParts.length > 1) return false;
  const headerFrom = dmarcParts[0] === undefined ? undefined : /\bheader\.from=([^\s;]+)/.exec(dmarcParts[0])?.[1];
  if (headerFrom !== undefined && !domainAligned(headerFrom, fromDomain)) return false;
  for (const p of parts) {
    if (/^dmarc=pass\b/.test(p) && headerFrom !== undefined) return true;
    const dkim = /^dkim=pass\b.*\bheader\.(?:i|d)=([^\s;]+)/.exec(p);
    if (dkim && domainAligned(dkim[1]!, fromDomain)) return true;
    const spf = /^spf=pass\b.*\bsmtp\.mailfrom=([^\s;]+)/.exec(p);
    if (spf && domainAligned(spf[1]!, fromDomain)) return true;
  }
  return false;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** 信裡的圖:排除追蹤像素(寬或高 ≤ 1、網址像 open/track/pixel)、有寫寬度但 < 800 的小圖、太長的網址。 */
export function extractImages(html: string | null): string[] {
  if (!html) return [];
  const out: string[] = [];
  let total = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.replace(/&amp;/g, '&');
    if (!src || src.length > IMAGE_URL_MAX || !/^https:\/\/\S+$/.test(src) || /open|track|pixel|beacon/i.test(src)) continue;
    const width = Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? NaN);
    const height = Number(/\bheight\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? NaN);
    if (width <= 1 || height <= 1) continue;
    if (!Number.isNaN(width) && width < 800) continue;
    if (out.includes(src) || total + src.length > IMAGE_TOTAL_MAX) continue;
    out.push(src);
    total += src.length;
    if (out.length >= IMAGE_MAX) break;
  }
  return out;
}

/**
 * 料號候選:英數 + 至少一個連字號、含數字(例 `S-B10SO4-HAPXT`)。只是候選,配不配得上由 matcher 查 DB 決定。
 * 🔵 DB 的 sku 分大小寫 ⇒ 原樣與全大寫各給一份(R1 C4)。
 */
export function extractSkuCandidates(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,12}){1,4}\b/g)) {
    if (!/[0-9]/.test(m[0])) continue;
    found.add(m[0]);
    found.add(m[0].toUpperCase());
    if (found.size >= SKU_MAX) break;
  }
  return [...found].slice(0, SKU_MAX);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 配到同一個品牌 ⇒ 商品列表篩那個品牌;配到 0 件且寄件者只對一個品牌 ⇒ 品牌頁;其他 ⇒ null(草稿沒連結,員工補)。 */
export function buildLinkPath(matches: readonly CatalogSkuMatch[], senderBrands: readonly string[]): string | null {
  const brands = [...new Set(matches.map((m) => m.brandSlug))];
  if (brands.length === 1 && SLUG_RE.test(brands[0]!)) return `/products?pbrands=${brands[0]}`;
  if (matches.length === 0 && senderBrands.length === 1 && SLUG_RE.test(senderBrands[0]!)) return `/brands/${senderBrands[0]}`;
  return null;
}

function clamp(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = [...s.replace(/[\x00-\x1f\x7f-\u009f]/g, ' ').trim()].slice(0, max).join('');
  return t === '' ? null : t;
}

function fallbackCopy(subject: string | null): BannerCopy {
  return { eyebrow: null, titleLine1: subject?.trim() || '廠商新品', titleLine2: null, subtitle: null, ctaLabel: null };
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? code : 'draft_failed';
}

// ── 主流程 ────────────────────────────────────────────────────────

export async function draftSupplierNewProductBanners(
  deps: DraftSupplierNewProductBannersDeps,
): Promise<DraftSupplierNewProductBannersResult> {
  const now = deps.now ?? Date.now;
  const timeBudgetMs = deps.timeBudgetMs ?? SUPPLIER_MAIL_TIME_BUDGET_MS;
  const maxPerRun = deps.maxPerRun ?? SUPPLIER_MAIL_MAX_PER_RUN;
  const startedAt = now();
  const result: DraftSupplierNewProductBannersResult = {
    listed: 0, known: 0, skippedSender: 0, skippedAuth: 0, drafted: 0, noProducts: 0, failed: 0, deferred: 0,
  };

  // 列信失敗 ⇒ throw(整輪停);那是權杖失效或 Gmail 掛,重試同一輪不會好
  const ids = await deps.reader.listMessageIds({ query: SUPPLIER_MAIL_QUERY, max: maxPerRun });
  const batch = ids.slice(0, maxPerRun);
  result.listed = batch.length;
  if (batch.length === 0) return result;

  const known = await deps.store.knownMessageIds(batch);

  for (const [index, id] of batch.entries()) {
    if (known.has(id)) {
      result.known += 1;
      continue;
    }
    if (now() - startedAt > timeBudgetMs) {
      result.deferred = batch.slice(index).filter((rest) => !known.has(rest)).length;
      break;
    }

    let message: InboundMailMessage;
    try {
      message = await deps.reader.getMessage(id);
    } catch (error) {
      // 讀不到這封 ⇒ 連寄件者都不知道,沒辦法落表(sender / received_at 必填)⇒ 只計數,下一輪會再試
      console.warn('[draft-supplier-newproduct-banners] 讀單封失敗', { gmail_message_id: id, code: errorCodeOf(error) });
      result.failed += 1;
      continue;
    }

    const address = parseFromAddress(message.from);
    const base = {
      gmailMessageId: message.id,
      gmailThreadId: message.threadId,
      sender: (address ?? 'unknown@invalid').slice(0, 320),
      subject: clamp(message.subject, 500),
      receivedAt: message.receivedAt,
    };

    const sender = address === null ? null : matchSender(deps.senders, address);
    if (sender === null) {
      await recordOrCountFailure(deps.store, { ...base, authPassed: false, status: 'skipped_sender', extracted: null, errorCode: null }, result, 'skippedSender');
      continue;
    }

    const authPassed = authAligned(message.authenticationResults, domainOf(address!));
    if (!authPassed) {
      await recordOrCountFailure(deps.store, { ...base, authPassed, status: 'skipped_auth', extracted: null, errorCode: null }, result, 'skippedAuth');
      continue;
    }

    try {
      const text = message.textBody ?? stripHtml(message.htmlBody ?? '');
      const images = sender.rightsPolicy === 'not_allowed' ? [] : extractImages(message.htmlBody);
      const skus = extractSkuCandidates(text);
      const matches = skus.length === 0 ? [] : await deps.matcher.match({ skus, brandSlugs: sender.brandSlugs });

      let copy: BannerCopy;
      let copyFallback = false;
      try {
        copy = await deps.copywriter.draft({
          subject: message.subject,
          textExcerpt: text.slice(0, TEXT_EXCERPT_MAX),
          productTitles: [...new Set(matches.map((m) => m.productTitle))].slice(0, 10),
          brandSlugs: sender.brandSlugs,
        });
      } catch {
        copy = fallbackCopy(message.subject);
        copyFallback = true;
      }
      const { fbText, igText } = copy;
      // 大圖文字有禁用字(現貨 / 到貨 / 保固…)⇒ 發布會被資料庫擋 ⇒ 退回用主旨, 不把紅字寫進草稿(FB / IG 另外判)
      if (!copyFallback && checkBannerCopy([copy.eyebrow, copy.titleLine1, copy.titleLine2, copy.subtitle, copy.ctaLabel]).length > 0) {
        copy = fallbackCopy(message.subject);
        copyFallback = true;
      }
      // FB / IG:紅字或超過 2,200 字 ⇒ 那一欄留空給員工寫(品牌名開頭的保固句算原廠, 同 social-copy-rules)
      const brandNames = sender.brandSlugs.map((b) => b.replace(/-/g, ' '));
      const social = (t: string | null | undefined): string | null => {
        const v = t?.trim() ?? '';
        return v === '' || [...v].length > SOCIAL_MAX || checkSocialCopy(v, brandNames).length > 0 ? null : v;
      };

      const status = matches.length > 0 ? 'drafted' : 'no_products';
      const draft: HomeBannerSystemDraft = {
        eyebrow: clamp(copy.eyebrow, COPY_MAX.eyebrow),
        titleLine1: clamp(copy.titleLine1, COPY_MAX.title) ?? clamp(fallbackCopy(message.subject).titleLine1, COPY_MAX.title)!,
        titleLine2: clamp(copy.titleLine2, COPY_MAX.title),
        subtitle: clamp(copy.subtitle, COPY_MAX.subtitle),
        ctaLabel: clamp(copy.ctaLabel, COPY_MAX.cta),
        linkPath: buildLinkPath(matches, sender.brandSlugs),
        imageDesktopUrl: images[0] ?? null,
        imageKind: 'scene',
        matchedVariantIds: matches.slice(0, MATCHED_VARIANT_MAX).map((m) => m.variantId),
        fbText: social(fbText),
        igText: social(igText),
      };
      const record: InboundMailRecord = {
        ...base,
        authPassed,
        status,
        extracted: { skus: skus.slice(0, SKU_MAX), matched_skus: matches.map((m) => m.sku), images },
        errorCode: copyFallback ? 'copy_fallback' : null,
      };

      const outcome = await deps.store.record(record, draft);
      if (outcome === 'duplicate') result.known += 1;
      else if (status === 'drafted') result.drafted += 1;
      else result.noProducts += 1;
    } catch (error) {
      const code = errorCodeOf(error);
      console.warn('[draft-supplier-newproduct-banners] 單封起草失敗', { gmail_message_id: id, code });
      result.failed += 1;
      try {
        await deps.store.record({ ...base, authPassed, status: 'failed', extracted: null, errorCode: code }, null);
      } catch {
        // 連 failed 都記不進去 ⇒ 下一輪會再撈到這封;這裡只計數,不讓一封拖垮整輪
      }
    }
  }

  return result;
}

async function recordOrCountFailure(
  store: ISupplierNewProductStore,
  record: InboundMailRecord,
  result: DraftSupplierNewProductBannersResult,
  counter: 'skippedSender' | 'skippedAuth',
): Promise<void> {
  try {
    const outcome = await store.record(record, null);
    if (outcome === 'duplicate') result.known += 1;
    else result[counter] += 1;
  } catch (error) {
    console.warn('[draft-supplier-newproduct-banners] 記錄略過的信失敗', { gmail_message_id: record.gmailMessageId, code: errorCodeOf(error) });
    result.failed += 1;
  }
}
