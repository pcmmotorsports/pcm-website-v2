import { HB_DB_MAX, HB_FIELD } from './home-banner-constants';
import { taipeiLocalToIso, type HomeBannerKind } from './home-banner-view';

// home-banner-form.ts — 首頁大圖表單的純解析器(無 IO)。形狀照 DB CHECK(20260916150000)先擋一次,
// 讓員工拿到「哪裡不對」而不是 DB 的 23514;DB 那層照樣再擋。

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
}

export interface HomeBannerDraftInput {
  readonly id: string | null;
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
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PostgREST 回的 timestamptz 形狀(微秒可有可無)。只驗形狀,不轉 Date(轉了會掉微秒)。 */
const PG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;

const INVALID = Symbol('invalid');
type Read<T> = T | typeof INVALID;

/** 與 DB `[[:cntrl:]]` 同範圍:C0、DEL、C1。 */
function hasControlChar(s: string): boolean {
  return [...s].some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n < 0x20 || n === 0x7f || (n >= 0x80 && n <= 0x9f);
  });
}

function readText(form: FormLike, name: string, max: number): Read<string | null> {
  const raw = form.get(name);
  if (raw === null) return null;
  if (typeof raw !== 'string') return INVALID;
  const s = raw.trim();
  if (s === '') return null;
  return [...s].length > max || hasControlChar(s) ? INVALID : s;
}

function readId(form: FormLike): Read<string | null> {
  const raw = form.get(HB_FIELD.id);
  if (raw === null || raw === '') return null;
  return typeof raw === 'string' && UUID_RE.test(raw) ? raw : INVALID;
}

function readTime(form: FormLike, name: string): Read<string | null> {
  const raw = form.get(name);
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') return INVALID;
  return taipeiLocalToIso(raw) ?? INVALID;
}

/** 只准站內路徑:開頭恰一個 `/`、後面不是 `/`;不准反斜線、空白(同 DB home_banners_link_path_check)。 */
function isSitePath(s: string): boolean {
  return /^\/[^/]/.test(s) && !/[\\\s]/.test(s);
}

function isHttpsUrl(s: string): boolean {
  return /^https:\/\/\S+$/.test(s);
}

export function parseHomeBannerDraftForm(form: FormLike): { ok: true; value: HomeBannerDraftInput } | { ok: false } {
  const id = readId(form);
  const eyebrow = readText(form, HB_FIELD.eyebrow, HB_DB_MAX.eyebrow);
  const titleLine1 = readText(form, HB_FIELD.title1, HB_DB_MAX.title);
  const titleLine2 = readText(form, HB_FIELD.title2, HB_DB_MAX.title);
  const subtitle = readText(form, HB_FIELD.subtitle, HB_DB_MAX.subtitle);
  const ctaLabel = readText(form, HB_FIELD.cta, HB_DB_MAX.cta);
  const linkPath = readText(form, HB_FIELD.link, HB_DB_MAX.link);
  const imageDesktopUrl = readText(form, HB_FIELD.imgDesktop, HB_DB_MAX.url);
  const imageMobileUrl = readText(form, HB_FIELD.imgMobile, HB_DB_MAX.url);
  const rightsNote = readText(form, HB_FIELD.rightsNote, HB_DB_MAX.rightsNote);
  const startsAt = readTime(form, HB_FIELD.starts);
  const endsAt = readTime(form, HB_FIELD.ends);

  const kindRaw = form.get(HB_FIELD.kind);
  const imageKind: Read<HomeBannerKind> =
    kindRaw === null || kindRaw === '' || kindRaw === 'scene' ? 'scene' : kindRaw === 'product' ? 'product' : INVALID;
  // checkbox 勾 ⇒ '1';沒勾 ⇒ 欄位不在
  const rightsRaw = form.get(HB_FIELD.rights);
  const rightsConfirmed: Read<boolean> = rightsRaw === null ? false : rightsRaw === '1' ? true : INVALID;

  if (
    id === INVALID || eyebrow === INVALID || titleLine1 === INVALID || titleLine2 === INVALID ||
    subtitle === INVALID || ctaLabel === INVALID || linkPath === INVALID || imageDesktopUrl === INVALID ||
    imageMobileUrl === INVALID || rightsNote === INVALID || startsAt === INVALID || endsAt === INVALID ||
    imageKind === INVALID || rightsConfirmed === INVALID
  ) {
    return { ok: false };
  }
  if (linkPath !== null && !isSitePath(linkPath)) return { ok: false };
  if (imageDesktopUrl !== null && !isHttpsUrl(imageDesktopUrl)) return { ok: false };
  if (imageMobileUrl !== null && !isHttpsUrl(imageMobileUrl)) return { ok: false };
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) return { ok: false };

  return {
    ok: true,
    value: {
      id, eyebrow, titleLine1, titleLine2, subtitle, ctaLabel, linkPath,
      imageDesktopUrl, imageMobileUrl, imageKind, rightsConfirmed, rightsNote, startsAt, endsAt,
    },
  };
}

/** 發布:只收 id + 預覽那一版的 updated_at(原字串);上下架時間用草稿存的那一份。 */
export function parseHomeBannerPublishForm(form: FormLike): { ok: true; id: string; expectedUpdatedAt: string } | { ok: false } {
  const id = readId(form);
  const expected = form.get(HB_FIELD.expected);
  if (id === INVALID || id === null) return { ok: false };
  if (typeof expected !== 'string' || !PG_TIMESTAMP_RE.test(expected)) return { ok: false };
  return { ok: true, id, expectedUpdatedAt: expected };
}

export function parseHomeBannerIdForm(form: FormLike): string | null {
  const id = readId(form);
  return id === INVALID ? null : id;
}
