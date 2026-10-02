'use server';

import { isEmailCopyKey, resolveEmailCopyOverrides, validateEmailCopyText, EMAIL_COPY_LOCKED } from '@pcm/domain';
import { emailCopyKeysInSample, renderEmailCopyPreview, type EmailCopyPreview } from '@pcm/use-cases';
import { authorizeAdminMutation } from '../session/authorize';
import { listEmailCopyVersions } from './email-copy-repository';

// 信件文字第 3 片:用草稿字組一封範例信給員工看(與寄信同一支組信程式)。
// 其他句子用「現在生效」的版本, 只有正在改的這一句換成草稿;draft = null ⇒ 預覽「還原成預設」之後的樣子。

export type PreviewEmailCopyResult =
  | { ok: true; preview: EmailCopyPreview; sentenceInSample: boolean }
  | { ok: false; reason: 'denied' }
  | { ok: false; reason: 'invalid'; problems: string[] }
  | { ok: false; reason: 'error' };

export async function previewEmailCopyAction(
  key: string,
  draft: string | null,
  sampleId: string,
): Promise<PreviewEmailCopyResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, reason: 'denied' };
  if (typeof key !== 'string' || !isEmailCopyKey(key)) return { ok: false, reason: 'invalid', problems: ['不認得這一句'] };
  if (EMAIL_COPY_LOCKED.has(key)) return { ok: false, reason: 'invalid', problems: ['這一句不開放修改'] };
  if (draft !== null) {
    if (typeof draft !== 'string') return { ok: false, reason: 'invalid', problems: ['文字格式不對'] };
    const problems = validateEmailCopyText(key, draft);
    if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  }
  try {
    const versions = await listEmailCopyVersions();
    const overrides = new Map(resolveEmailCopyOverrides(versions, new Date().toISOString()).overrides);
    if (draft === null) overrides.delete(key);
    else overrides.set(key, draft);
    const preview = renderEmailCopyPreview(sampleId, overrides);
    if (preview === null) return { ok: false, reason: 'error' };
    return { ok: true, preview, sentenceInSample: emailCopyKeysInSample(sampleId).includes(key) };
  } catch (err) {
    console.error('[email-copy] 預覽失敗', { name: (err as { name?: unknown })?.name });
    return { ok: false, reason: 'error' };
  }
}
