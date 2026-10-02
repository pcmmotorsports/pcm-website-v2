import { EMAIL_PREVIEW_SAMPLES, emailCopyKeysInSample } from '@pcm/use-cases';
import type { EmailCopyKey } from '@pcm/domain';
import { EmailCopyEditor } from '@/components/email-copy/email-copy-editor';
import { listEmailCopyVersions, type EmailCopyVersionWithAuthor } from '@/lib/email-copy/email-copy-repository';
import { buildEmailCopyRows } from '@/lib/email-copy/email-copy-view';
import { isTestEmailConfigured } from '@/lib/email-copy/send-test-email-copy-action';

export const dynamic = 'force-dynamic';

// app/settings/email-copy/page.tsx —— 後台「信件文字」(信件文字第 3 片)。
// PRD ~/pcm-mailbox/PRD-員工自己改交易信文案-20261002.md;Sean 10-02:所有員工可改、存檔前要先看預覽、主旨不開放、可寄測試信。

export default async function EmailCopyPage() {
  let versions: EmailCopyVersionWithAuthor[] | null = null;
  try {
    versions = await listEmailCopyVersions();
  } catch (error) {
    console.error('[admin/settings/email-copy] 信件文字載入失敗', { name: (error as { name?: unknown })?.name });
  }
  const sampleKeys = new Map<string, readonly EmailCopyKey[]>(
    EMAIL_PREVIEW_SAMPLES.map((s) => [s.id, emailCopyKeysInSample(s.id)]),
  );
  const testConfigured = await isTestEmailConfigured();

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>信件文字</h1>
        <p className='text-muted-foreground text-sm'>
          修改客人收到的訂單通知信裡的固定句子。金額、品項、單號、追蹤碼會依每張訂單自動帶入，不能在這裡改；信件主旨也不開放修改。
          <br />
          儲存前要先看過預覽。儲存後，之後排進寄送佇列的信會用新的文字；已經在排隊中的信仍用原本的文字。有綁定 LINE 的客人，LINE 通知也會用同一段文字。
        </p>
      </div>
      {versions === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          信件文字載入失敗，目前無法確認哪些句子已經改過。請重新整理；若仍無法載入，請聯絡系統管理員。
        </div>
      ) : (
        <EmailCopyEditor
          rows={buildEmailCopyRows(versions, sampleKeys)}
          samples={EMAIL_PREVIEW_SAMPLES}
          testConfigured={testConfigured}
        />
      )}
    </div>
  );
}
