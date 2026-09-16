import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { HomeBannerDraftInput } from './home-banner-form';
import type { HomeBannerKind, HomeBannerRow, HomeBannerStatus } from './home-banner-view';

// home-banner-repository.ts — 首頁大圖讀寫(DB 20260916150000)。
// 🔴 寫入只走三支 SECURITY DEFINER RPC(稽核在 RPC 同交易寫);service_role 對表只有 SELECT。
// 🔵 生成型別還沒有這張表 / 這三支 RPC ⇒ 走一個窄的 loose client(同 incident-repository 的 `as never` 慣例),
//    回來的東西逐欄驗形狀,驗不過就 throw(不當成空的)。

type Result = { data: unknown; error: unknown };
interface LooseQuery extends PromiseLike<Result> {
  select(columns: string): LooseQuery;
  order(column: string, options: { ascending: boolean }): LooseQuery;
  limit(n: number): LooseQuery;
}
interface LooseClient {
  from(table: string): LooseQuery;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Result>;
}

function db(): LooseClient {
  return createSupabaseServiceClient() as unknown as LooseClient;
}

const COLUMNS =
  'id, status, eyebrow, title_line1, title_line2, subtitle, cta_label, link_path, image_desktop_url, image_mobile_url, ' +
  'image_kind, rights_confirmed, rights_note, starts_at, ends_at, created_by, updated_by, published_by, archived_at, updated_at, ' +
  // 🔴 Sean 09-16 Q6 乙:信件來的草稿要配到商品才准發 ⇒ 頁面要看得到這兩欄才畫得出「為什麼不能發布」
  'source_email_id, matched_variant_ids';

const STATUSES: readonly HomeBannerStatus[] = ['draft', 'published', 'archived'];
const KINDS: readonly HomeBannerKind[] = ['scene', 'product'];

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toRow(raw: unknown): HomeBannerRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = r.status as HomeBannerStatus;
  const kind = r.image_kind as HomeBannerKind;
  if (typeof r.id !== 'string' || !STATUSES.includes(status) || !KINDS.includes(kind) || typeof r.updated_at !== 'string') {
    throw new Error('home_banners 回傳形狀不對 ⇒ 整頁走讀取失敗');
  }
  return {
    id: r.id,
    status,
    eyebrow: str(r.eyebrow),
    titleLine1: str(r.title_line1),
    titleLine2: str(r.title_line2),
    subtitle: str(r.subtitle),
    ctaLabel: str(r.cta_label),
    linkPath: str(r.link_path),
    imageDesktopUrl: str(r.image_desktop_url),
    imageMobileUrl: str(r.image_mobile_url),
    imageKind: kind,
    rightsConfirmed: r.rights_confirmed === true,
    rightsNote: str(r.rights_note),
    startsAt: str(r.starts_at),
    endsAt: str(r.ends_at),
    createdBy: str(r.created_by) ?? '',
    updatedBy: str(r.updated_by) ?? '',
    publishedBy: str(r.published_by),
    archivedAt: str(r.archived_at),
    sourceEmailId: str(r.source_email_id),
    matchedVariantIds: Array.isArray(r.matched_variant_ids) ? r.matched_variant_ids.filter((v): v is string => typeof v === 'string') : [],
    // 🔴 原字串原樣留著:發布時送回 p_expected_updated_at,DB 比到微秒
    updatedAt: r.updated_at,
  };
}

/** 最近改過的 200 張(含封存)。分頁在 JS 做(`home-banner-view.ts`),狀態要看現在時間。 */
export async function listHomeBanners(): Promise<HomeBannerRow[]> {
  const { data, error } = await db().from('home_banners').select(COLUMNS).order('updated_at', { ascending: false }).limit(200);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('home_banners 回傳不是陣列 ⇒ 不當成空的');
  return data.map(toRow);
}

export interface HomeBannerAudit {
  readonly actor: string;
  readonly requestId: string;
}

/** 存草稿;回那張的 id(新增時是新的)。 */
export async function saveHomeBannerDraft(input: HomeBannerDraftInput, audit: HomeBannerAudit): Promise<string> {
  const { data, error } = await db().rpc('admin_home_banner_save_draft', {
    p_banner_id: input.id,
    p_eyebrow: input.eyebrow,
    p_title_line1: input.titleLine1,
    p_title_line2: input.titleLine2,
    p_subtitle: input.subtitle,
    p_cta_label: input.ctaLabel,
    p_link_path: input.linkPath,
    p_image_desktop_url: input.imageDesktopUrl,
    p_image_mobile_url: input.imageMobileUrl,
    // 🔴 選檔上傳那條路要送 'storage' —— 這一欄的 CHECK 只收 'supplier_url' | 'storage',
    //    而在這一片之前【沒有任何程式產得出 'storage'】。沒傳檔 ⇒ 仍然是 null(既有行為不變)。
    p_image_origin: input.imageOrigin ?? null,
    p_image_kind: input.imageKind,
    p_rights_confirmed: input.rightsConfirmed,
    p_rights_note: input.rightsNote,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_source_email_id: null,
    p_matched_variant_ids: null,
    p_actor: audit.actor,
    p_request_id: audit.requestId,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('admin_home_banner_save_draft 沒回 id');
  return data;
}

/** 發布;上下架時間用草稿存的那一份(p_starts_at / p_ends_at 送 null)。 */
export async function publishHomeBanner(
  args: { id: string; expectedUpdatedAt: string } & HomeBannerAudit,
): Promise<void> {
  const { error } = await db().rpc('admin_home_banner_publish', {
    p_banner_id: args.id,
    p_expected_updated_at: args.expectedUpdatedAt,
    p_starts_at: null,
    p_ends_at: null,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) throw error;
}

export async function archiveHomeBanner(args: { id: string } & HomeBannerAudit): Promise<{ changed: boolean }> {
  const { data, error } = await db().rpc('admin_home_banner_archive', {
    p_banner_id: args.id,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) throw error;
  const changed = (data as { changed?: unknown } | null)?.changed;
  if (typeof changed !== 'boolean') throw new Error('admin_home_banner_archive 回傳形狀不對');
  return { changed };
}
