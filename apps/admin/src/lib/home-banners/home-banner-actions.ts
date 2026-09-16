'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { HB_FIELD, HOME_BANNERS_PATH, type HomeBannerResultCode } from './home-banner-constants';
import { parseHomeBannerDraftForm, parseHomeBannerIdForm, parseHomeBannerPublishForm } from './home-banner-form';
import { archiveHomeBanner, publishHomeBanner, saveHomeBannerDraft } from './home-banner-repository';
import { parseTab, type HomeBannerTab } from './home-banner-view';

// home-banner-actions.ts — 首頁大圖 存草稿 / 發布 / 下架(DB 20260916150000;PRD §6,Sean Q5 甲)。
// 形狀抄 incident-actions:①授權閘 → ②解析 → ③repository → ④PRG redirect。
// 🔴 存草稿 / 發布 / 下架三支都 = 所有在職員工(authorizeAdminMutation)。
//    Sean 09-16 Q5 乙開放發布;主視窗同日裁「發得出去就要收得回來」⇒ 下架跟著開(20260916180000)。
//    DB 那層各自再驗一次(後台 key 是 service_role)。
// 🔴 本檔沒有稽核碼:RPC 同交易寫 admin_audit_log。
// 🔴 redirect 只到寫死的 /home-banners,view 走白名單、edit 只收 uuid ⇒ 沒有 open-redirect 面。

function go(view: HomeBannerTab, edit: string | null, code: HomeBannerResultCode): never {
  const q = new URLSearchParams({ view });
  if (edit !== null) q.set('edit', edit);
  q.set('r', code);
  redirect(`${HOME_BANNERS_PATH}?${q.toString()}`);
}

function viewOf(formData: FormData): HomeBannerTab {
  const v = formData.get(HB_FIELD.view);
  return parseTab(typeof v === 'string' ? v : undefined);
}

/** DB 丟回來的錯分流;RAISE 的字面在 20260916150000 裡。 */
function classifyError(tag: string, requestId: string, error: unknown): HomeBannerResultCode {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code === 'P0001') {
    if (message === '無權執行此操作') {
      console.warn(`${tag} —— DB 身分閘拒絕`, { request_id: requestId });
      return 'denied';
    }
    if (message.startsWith('草稿剛被改過')) return 'stale';
    if (message.startsWith('還沒確認圖文')) return 'rights';
    if (message.startsWith('大圖缺')) return 'incomplete';
    // 🔴 20260916180000 的兩道發布閘(Sean Q6 乙 + 主視窗加的連結範圍)。
    //    不收這兩句 ⇒ 落到 error「系統出錯」,把規則不合說成當機。
    if (message.startsWith('這張還沒配到商品')) return 'nomatch';
    if (message.startsWith('連結要指到')) return 'linkscope';
    if (message.startsWith('下架時間')) return 'window';
    if (message.startsWith('只有草稿')) return 'notdraft';
    if (message.startsWith('找不到這張大圖')) return 'notfound';
    if (message === '參數不正確') return 'invalid';
  }
  // 23514 CHECK / 23503 FK / 22007 時間格式:解析器擋過一次, 到這裡代表兩邊規則漂了 ⇒ 仍是員工改得了的 invalid
  if (e.code === '23514' || e.code === '23503' || e.code === '22007') {
    console.warn(`${tag} —— DB 欄位檢查拒絕(解析器沒擋到)`, { request_id: requestId, code: e.code });
    return 'invalid';
  }
  console.error(tag, { request_id: requestId, code: typeof e.code === 'string' ? e.code : undefined, message: message.slice(0, 200) });
  return 'error';
}

export async function saveHomeBannerDraftAction(formData: FormData): Promise<void> {
  const view = viewOf(formData);
  const authorization = await authorizeAdminMutation();
  if (!authorization) go(view, parseHomeBannerIdForm(formData), 'denied');

  const parsed = parseHomeBannerDraftForm(formData);
  if (!parsed.ok) go(view, parseHomeBannerIdForm(formData), 'invalid');

  const requestId = await getRequestId();
  console.info('[admin/home-banners] home_banner.save_draft.attempt', {
    request_id: requestId, sid: authorization.sid, actor: authorization.actorId, banner_id: parsed.value.id,
  });

  let id = parsed.value.id;
  let code: HomeBannerResultCode;
  try {
    id = await saveHomeBannerDraft(parsed.value, { actor: authorization.actorId, requestId });
    code = parsed.value.id === null ? 'created' : 'saved';
  } catch (error) {
    code = classifyError('[admin/home-banners] 存草稿失敗', requestId, error);
  }

  revalidatePath(HOME_BANNERS_PATH);
  go(view, id, code);
}

// 🔴 Sean 2026-09-16 Q5 乙:所有在職員工都可以發布(推翻限管理者);DB 那層同步(20260916180000)。
export async function publishHomeBannerAction(formData: FormData): Promise<void> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) go('draft', parseHomeBannerIdForm(formData), 'denied');

  const parsed = parseHomeBannerPublishForm(formData);
  if (!parsed.ok) go('draft', parseHomeBannerIdForm(formData), 'invalid');

  const requestId = await getRequestId();
  console.info('[admin/home-banners] home_banner.publish.attempt', {
    request_id: requestId, sid: authorization.sid, actor: authorization.actorId, banner_id: parsed.id,
  });

  let code: HomeBannerResultCode;
  try {
    // 🔴 expectedUpdatedAt 是頁面給的原字串,不經 Date(DB 比到微秒)
    await publishHomeBanner({ id: parsed.id, expectedUpdatedAt: parsed.expectedUpdatedAt, actor: authorization.actorId, requestId });
    code = 'published';
  } catch (error) {
    code = classifyError('[admin/home-banners] 發布失敗', requestId, error);
  }

  revalidatePath(HOME_BANNERS_PATH);
  // 發布成功 ⇒ 「全部」分頁(排程的會在已排程、立即的在已發布,全部都看得到);失敗 ⇒ 回草稿分頁
  go(code === 'published' ? 'all' : 'draft', parsed.id, code);
}

export async function archiveHomeBannerAction(formData: FormData): Promise<void> {
  const view = viewOf(formData);
  const authorization = await authorizeAdminMutation();
  if (!authorization) go(view, parseHomeBannerIdForm(formData), 'denied');

  const id = parseHomeBannerIdForm(formData);
  if (id === null) go(view, null, 'invalid');

  const requestId = await getRequestId();
  console.info('[admin/home-banners] home_banner.archive.attempt', {
    request_id: requestId, sid: authorization.sid, actor: authorization.actorId, banner_id: id,
  });

  let code: HomeBannerResultCode;
  try {
    const { changed } = await archiveHomeBanner({ id, actor: authorization.actorId, requestId });
    code = changed ? 'archived' : 'nochange';
  } catch (error) {
    code = classifyError('[admin/home-banners] 下架失敗', requestId, error);
  }

  revalidatePath(HOME_BANNERS_PATH);
  go(view, id, code);
}
