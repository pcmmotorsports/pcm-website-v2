'use client';

// 編輯一句信件文字:改字 → 看預覽(必看)→ 儲存;另外可寄測試信、看修改紀錄、還原成預設或某一版。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailCopyPreview } from '@pcm/use-cases';
import type { EmailCopyRow } from '@/lib/email-copy/email-copy-view';
import { previewEmailCopyAction } from '@/lib/email-copy/preview-email-copy-action';
import { saveEmailCopyAction } from '@/lib/email-copy/save-email-copy-action';
import { sendTestEmailCopyAction } from '@/lib/email-copy/send-test-email-copy-action';

type Notice = { tone: 'ok' | 'error' | 'warn'; text: string } | null;
/** 編輯框裡的內容:文字, 或「還原成預設」(null)。 */
type Draft = string | null;

const PREVIEW_TABS = [
  { id: 'html', label: '信件(網頁版)' },
  { id: 'text', label: '信件(純文字)' },
  { id: 'line', label: 'LINE 通知' },
] as const;

function noticeClass(tone: 'ok' | 'error' | 'warn'): string {
  if (tone === 'ok') return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  if (tone === 'warn') return 'border-amber-300 bg-amber-50 text-amber-900';
  return 'border-destructive/30 bg-destructive/5 text-destructive';
}

export function EmailCopyPanel({
  row,
  samples,
  testConfigured,
  initialSampleId,
  onBack,
}: {
  row: EmailCopyRow;
  samples: readonly { id: string; label: string }[];
  testConfigured: boolean;
  /** 從某一封信點進來 ⇒ 預覽先用那一封。 */
  initialSampleId?: string;
  /** 有給 ⇒ 最上面顯示「回到整封信」。 */
  onBack?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(row.currentText);
  const [sampleId, setSampleId] = useState(initialSampleId ?? row.defaultSampleId ?? samples[0]?.id ?? '');
  const [preview, setPreview] = useState<{ for: Draft; sampleId: string; data: EmailCopyPreview; inSample: boolean } | null>(null);
  const [tab, setTab] = useState<(typeof PREVIEW_TABS)[number]['id']>('html');
  const [notice, setNotice] = useState<Notice>(null);
  const [testTo, setTestTo] = useState('');
  const [pending, start] = useTransition();

  const locked = row.lockReason !== null;
  const previewIsCurrent = preview !== null && preview.for === draft && preview.sampleId === sampleId;
  // 和現在生效的一樣 ⇒ 不用存(還原成預設時:本來就是預設 ⇒ 不用存)。
  const unchanged = draft === null ? row.isDefault : draft === row.currentText;
  const canSave = !locked && previewIsCurrent && !unchanged && !pending;

  const runPreview = (d: Draft, sid: string) =>
    start(async () => {
      setNotice(null);
      try {
        const r = await previewEmailCopyAction(row.key, d, sid);
        if (r.ok) setPreview({ for: d, sampleId: sid, data: r.preview, inSample: r.sentenceInSample });
        else if (r.reason === 'invalid') {
          setPreview(null);
          setNotice({ tone: 'error', text: `這段文字還不能用：${r.problems.join('；')}。` });
        } else if (r.reason === 'denied') setNotice({ tone: 'error', text: '沒有權限修改信件文字，請重新登入。' });
        else setNotice({ tone: 'error', text: '預覽產生失敗，請再按一次「預覽」。若仍失敗，請聯絡系統管理員。' });
      } catch {
        setNotice({ tone: 'error', text: '預覽產生失敗，請再按一次「預覽」。若仍失敗，請聯絡系統管理員。' });
      }
    });

  const save = () =>
    start(async () => {
      try {
        const r = await saveEmailCopyAction(row.key, draft);
        if (r.ok) {
          setNotice({
            tone: 'ok',
            text: draft === null ? '已還原成預設文字。之後排進寄送佇列的信會用預設文字。' : '已儲存。之後排進寄送佇列的信會用新的文字；已經在排隊中的信仍用原本的文字。',
          });
          router.refresh();
        } else if (r.reason === 'invalid') setNotice({ tone: 'error', text: `這段文字還不能用：${r.problems.join('；')}。` });
        else if (r.reason === 'denied') setNotice({ tone: 'error', text: '沒有權限修改信件文字，請重新登入。' });
        else setNotice({ tone: 'error', text: '信件文字儲存失敗，目前仍使用原本的文字。請重新整理後再試；若仍失敗，請聯絡系統管理員。' });
      } catch {
        setNotice({ tone: 'error', text: '無法確認是否已儲存。請重新整理，看這一句的修改紀錄有沒有新的一筆。' });
      }
    });

  const sendTest = () =>
    start(async () => {
      try {
        const r = await sendTestEmailCopyAction({ key: row.key, draft, sampleId, to: testTo });
        if (r.ok) setNotice({ tone: 'ok', text: `測試信已交給寄信服務，請到 ${testTo} 收信（可能要等一兩分鐘）。` });
        else if (r.reason === 'bad_address') setNotice({ tone: 'error', text: '收件信箱格式不對，請檢查後再寄。' });
        else if (r.reason === 'too_many') setNotice({ tone: 'warn', text: '一分鐘內最多寄 3 封測試信，請稍等再寄。' });
        else if (r.reason === 'not_configured') setNotice({ tone: 'error', text: '寄測試信尚未設定，請聯絡系統管理員。' });
        else if (r.reason === 'invalid') setNotice({ tone: 'error', text: `這段文字還不能用：${r.problems.join('；')}。` });
        else if (r.reason === 'denied') setNotice({ tone: 'error', text: '沒有權限寄測試信，請重新登入。' });
        else if (r.reason === 'unknown') setNotice({ tone: 'warn', text: '尚未確認測試信是否寄出。請先到信箱確認，沒有收到再寄一次。' });
        else setNotice({ tone: 'error', text: '測試信沒有寄出，請稍後再試。' });
      } catch {
        setNotice({ tone: 'warn', text: '尚未確認測試信是否寄出。請先到信箱確認，沒有收到再寄一次。' });
      }
    });

  return (
    <section className='space-y-4 rounded-lg border p-4'>
      {onBack !== undefined && (
        <button type='button' onClick={onBack} className='h-8 rounded-md border px-3 text-sm'>
          ← 回到整封信
        </button>
      )}
      <div className='space-y-1'>
        <h2 className='text-lg font-semibold'>{row.label}</h2>
        <p className='text-muted-foreground text-sm'>{row.isDefault ? '目前使用預設文字。' : '目前使用修改過的文字。'}</p>
      </div>

      {locked ? (
        <div className='bg-muted/40 rounded-md border p-3 text-sm'>
          <p className='font-medium'>這一句不開放修改</p>
          <p className='text-muted-foreground mt-1'>{row.lockReason}</p>
          <p className='mt-2 whitespace-pre-wrap'>{row.currentText}</p>
        </div>
      ) : (
        <div className='space-y-2'>
          <label htmlFor='email-copy-draft' className='text-sm font-medium'>文字</label>
          <textarea
            id='email-copy-draft'
            rows={3}
            maxLength={300}
            value={draft ?? row.defaultText}
            onChange={(e) => setDraft(e.target.value)}
            disabled={draft === null}
            className='border-input w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60'
          />
          <p className='text-muted-foreground text-xs'>
            {row.placeholders.length > 0
              ? `大括號裡的代號會換成每張訂單的資料，必須保留：${row.placeholders.map((p) => `{${p}}`).join('、')}。`
              : '這一句沒有要代入的訂單資料。'}
            最多 300 字，不能換行，不能用 &lt; 或 &gt;。
          </p>
          {draft === null && <p className='text-sm'>已選擇還原成預設文字，請看過預覽再儲存。</p>}
          {row.note !== null && <p className='text-sm whitespace-pre-line text-amber-800'>{row.note}</p>}
          {row.defaultSampleId === null && (
            <p className='text-sm text-amber-800'>這一句只在少見的情況出現（例如讀不到訂單編號），範例信看不到。修改時請特別確認文字。</p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            <label htmlFor='email-copy-sample' className='text-sm'>預覽範例</label>
            <select
              id='email-copy-sample'
              value={sampleId}
              onChange={(e) => setSampleId(e.target.value)}
              className='border-input h-9 rounded-md border px-2 text-sm'
            >
              {samples.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <button type='button' onClick={() => runPreview(draft, sampleId)} disabled={pending} className='h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'>
              {pending ? '處理中…' : '預覽'}
            </button>
            <button type='button' onClick={save} disabled={!canSave} className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'>
              {draft === null ? '還原成預設文字' : '儲存這一句'}
            </button>
            {draft === null ? (
              <button type='button' onClick={() => { setDraft(row.currentText); setPreview(null); }} className='h-9 rounded-md border px-4 text-sm'>取消還原</button>
            ) : (
              !row.isDefault && <button type='button' onClick={() => { setDraft(null); setPreview(null); }} className='h-9 rounded-md border px-4 text-sm'>改回預設文字</button>
            )}
          </div>
          {!previewIsCurrent && !unchanged && <p className='text-muted-foreground text-xs'>改過文字或換了範例之後，要先按「預覽」看過才能儲存。</p>}
        </div>
      )}

      {notice !== null && (
        <p role='status' className={`rounded-md border p-3 text-sm ${noticeClass(notice.tone)}`}>{notice.text}</p>
      )}

      {preview !== null && (
        <div className='space-y-2'>
          {!preview.inSample && <p className='text-sm text-amber-800'>這封範例信沒有用到這一句，請換一封範例再預覽。</p>}
          <p className='text-sm'>主旨：{preview.data.subject}</p>
          <div role='tablist' className='flex gap-2'>
            {PREVIEW_TABS.map((t) => (
              <button key={t.id} type='button' role='tab' aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`h-8 rounded-md border px-3 text-sm ${tab === t.id ? 'bg-muted font-medium' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'html' ? (
            <iframe title='信件預覽(網頁版)' sandbox='' srcDoc={preview.data.html} className='h-[36rem] w-full rounded-md border bg-white' />
          ) : (
            <pre className='bg-muted/30 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md border p-3 text-sm'>
              {tab === 'text' ? preview.data.text : preview.data.lineText}
            </pre>
          )}
        </div>
      )}

      {!locked && (
        <div className='space-y-2 border-t pt-3'>
          <h3 className='text-sm font-semibold'>寄測試信</h3>
          {testConfigured ? (
            <div className='flex flex-wrap items-center gap-2'>
              <label htmlFor='email-copy-test-to' className='text-sm'>收件信箱</label>
              <input id='email-copy-test-to' type='email' value={testTo} onChange={(e) => setTestTo(e.target.value)}
                className='border-input h-9 w-64 rounded-md border px-3 text-sm' placeholder='寄到你自己的信箱' />
              <button type='button' onClick={sendTest} disabled={pending || testTo.trim() === '' || !previewIsCurrent}
                className='h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'>
                寄測試信
              </button>
              <p className='text-muted-foreground w-full text-xs'>
                用目前預覽的文字與範例寄出，主旨前會加「〔測試〕」，內文最上面會標明這是測試信。要先預覽才能寄。一分鐘內最多 3 封，每封都會記在操作紀錄。
              </p>
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>寄測試信尚未設定，請聯絡系統管理員。</p>
          )}
        </div>
      )}

      <div className='space-y-2 border-t pt-3'>
        <h3 className='text-sm font-semibold'>修改紀錄</h3>
        {row.history.length === 0 ? (
          <p className='text-muted-foreground text-sm'>這一句沒有修改過，一直是預設文字。</p>
        ) : (
          <ul className='divide-y rounded-md border text-sm'>
            {row.history.map((h, i) => (
              <li key={h.id} className='flex flex-wrap items-start gap-2 p-2'>
                <span className='tabular-nums'>{h.savedAt}</span>
                <span className='text-muted-foreground'>{h.savedBy}</span>
                <span className='min-w-0 flex-1 whitespace-pre-wrap'>{h.text ?? '（還原成預設文字）'}</span>
                {i === 0 ? (
                  <span className='text-muted-foreground text-xs'>目前使用</span>
                ) : (
                  !locked && (
                    <button type='button' onClick={() => { setDraft(h.text); runPreview(h.text, sampleId); }} className='h-8 rounded-md border px-3 text-xs'>
                      還原成這一版
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
