// home-banner-view.ts — 首頁大圖列表的純函式(分頁、狀態、提示)。server 頁與 client 編輯面板共用,零 IO。

export type HomeBannerStatus = 'draft' | 'published' | 'archived';
export type HomeBannerKind = 'scene' | 'product';

export interface HomeBannerRow {
  readonly id: string;
  readonly status: HomeBannerStatus;
  readonly eyebrow: string | null;
  readonly titleLine1: string | null;
  readonly titleLine2: string | null;
  readonly subtitle: string | null;
  readonly ctaLabel: string | null;
  readonly linkPath: string | null;
  readonly imageDesktopUrl: string | null;
  readonly imageMobileUrl: string | null;
  readonly imageKind: HomeBannerKind;
  readonly rightsConfirmed: boolean;
  readonly rightsNote: string | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly publishedBy: string | null;
  readonly archivedAt: string | null;
  /** 這張是哪封廠商信來的;null = 員工自己新增的。 */
  readonly sourceEmailId: string | null;
  /** 信件草稿配到的商品。Sean 09-16 Q6 乙:信件來的要配到商品才准發(手動的不受管)。 */
  readonly matchedVariantIds: readonly string[];
  /** 🔴 原字串(PostgREST 給的微秒精度)—— 發布時原樣送回,不轉 Date。 */
  readonly updatedAt: string;
}

/** 畫面上的狀態:DB 的 published 依時間再拆成 已上架 / 已排程 / 已到期。 */
export type BannerState = 'draft' | 'live' | 'scheduled' | 'ended' | 'archived';

export const BANNER_STATE_LABEL: Record<BannerState, string> = {
  draft: '草稿',
  live: '已發布',
  scheduled: '已排程',
  ended: '已到期',
  archived: '已封存',
};

export function bannerState(row: Pick<HomeBannerRow, 'status' | 'startsAt' | 'endsAt'>, now: Date): BannerState {
  if (row.status === 'draft') return 'draft';
  if (row.status === 'archived') return 'archived';
  const t = now.getTime();
  if (row.startsAt !== null && Date.parse(row.startsAt) > t) return 'scheduled';
  if (row.endsAt !== null && Date.parse(row.endsAt) <= t) return 'ended';
  return 'live';
}

export const HOME_BANNER_TABS = ['draft', 'published', 'scheduled', 'archived', 'all'] as const;
export type HomeBannerTab = (typeof HOME_BANNER_TABS)[number];

export const HOME_BANNER_TAB_LABEL: Record<HomeBannerTab, string> = {
  draft: '草稿',
  published: '已發布',
  scheduled: '已排程',
  archived: '已封存',
  all: '全部',
};

export function parseTab(raw: string | undefined): HomeBannerTab {
  return (HOME_BANNER_TABS as readonly string[]).includes(raw ?? '') ? (raw as HomeBannerTab) : 'draft';
}

/** 到期的 published 算進「已封存」分頁(首頁上已經看不到了)。 */
function tabOf(state: BannerState): Exclude<HomeBannerTab, 'all'> {
  if (state === 'live') return 'published';
  if (state === 'ended') return 'archived';
  return state;
}

export function filterByTab(rows: readonly HomeBannerRow[], tab: HomeBannerTab, now: Date): HomeBannerRow[] {
  return tab === 'all' ? [...rows] : rows.filter((r) => tabOf(bannerState(r, now)) === tab);
}

export function tabCounts(rows: readonly HomeBannerRow[], now: Date): Record<Exclude<HomeBannerTab, 'all'>, number> {
  const counts = { draft: 0, published: 0, scheduled: 0, archived: 0 };
  for (const r of rows) counts[tabOf(bannerState(r, now))] += 1;
  return counts;
}

/**
 * 「首頁目前掛的」那一張。
 * 🔴 多張並存合法之後(Sean 09-16 Q9 乙),這裡要跟顧客站挑**同一張** ——
 *    顧客站是 `order('starts_at', desc).limit(1)`(`apps/storefront/src/lib/home-banners.ts`),
 *    而後台列表是照 `updated_at` 排的 ⇒ 用 find 會挑到「最近被編輯過」那張,
 *    畫面就會指著一張客人其實看不到的圖。
 */
export function currentLive(rows: readonly HomeBannerRow[], now: Date): HomeBannerRow | null {
  let best: HomeBannerRow | null = null;
  for (const r of rows) {
    if (bannerState(r, now) !== 'live') continue;
    if (best === null || Date.parse(r.startsAt ?? '') > Date.parse(best.startsAt ?? '')) best = r;
  }
  return best;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 主視窗 2026-09-16 裁乙:這張的下架時間早於首頁現在那張 ⇒ 提示「這張下架後到 X 之前首頁不會有新品大圖」。
 * 回 X(現在那張的下架時間,ISO);不用提示 ⇒ null。下架沒填 ⇒ 照 DB 預設 max(上架, 現在) + 14 天算。
 */
export function gapUntil(
  live: Pick<HomeBannerRow, 'id' | 'endsAt'> | null,
  draft: { id: string | null; startsAt: string | null; endsAt: string | null },
  now: Date,
): string | null {
  if (live === null || live.endsAt === null || live.id === draft.id) return null;
  const starts = draft.startsAt === null ? now.getTime() : Date.parse(draft.startsAt);
  const ends = draft.endsAt === null ? Math.max(starts, now.getTime()) + 14 * DAY_MS : Date.parse(draft.endsAt);
  if (Number.isNaN(ends)) return null;
  return ends < Date.parse(live.endsAt) ? live.endsAt : null;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `<input type="datetime-local">` 的值(台北時間)⇒ ISO(+08:00)。格式不對或日期不存在 ⇒ null。 */
export function taipeiLocalToIso(local: string): string | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // 2026-02-31 這種 Date 會自己進位 ⇒ 反推回台北日期要一樣
  return isoToTaipeiLocal(d.toISOString()) === local ? iso : null;
}

/** ISO ⇒ datetime-local 的值(台北時間)。 */
export function isoToTaipeiLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** 列表與提示用的短格式:`9/24 00:00`(台北)。 */
export function formatBannerTime(iso: string): string {
  const local = isoToTaipeiLocal(iso);
  const [date, time] = local.split('T');
  const [, month, day] = (date ?? '').split('-');
  return `${Number(month)}/${Number(day)} ${time}`;
}
