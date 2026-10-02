'use client';

// 整封信預覽(「先選信件」):用現在生效的文字組出整封信, 可改的句子標黃底, 點了就打開那一句。
// iframe 只開 allow-scripts(不開 allow-same-origin):裡面那幾行只做一件事 —— 被點的句子用 postMessage 告訴外面。
import { useEffect, useRef, useState, useTransition } from 'react';
import { previewWholeEmailAction } from '@/lib/email-copy/preview-email-copy-action';

const PICK_MESSAGE = 'pcm-email-copy-pick';
const PICK_SCRIPT = `<script>document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;if(t.closest('a'))e.preventDefault();var m=t.closest('[data-copy-key]');if(m)parent.postMessage({type:'${PICK_MESSAGE}',key:m.getAttribute('data-copy-key')},'*');});</script>`;

type Loaded = { subject: string; html: string; highlighted: boolean };

export function EmailWholePreview({
  samples,
  sampleId,
  onSampleChange,
  onPick,
}: {
  samples: readonly { id: string; label: string }[];
  sampleId: string;
  onSampleChange: (id: string) => void;
  onPick: (key: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    start(async () => {
      setFailed(null);
      try {
        const r = await previewWholeEmailAction(sampleId);
        if (r.ok) setLoaded({ subject: r.subject, html: r.html, highlighted: r.highlighted });
        else {
          setLoaded(null);
          setFailed(r.reason === 'denied' ? '沒有權限查看信件文字，請重新登入。' : '整封信預覽產生失敗，請重新整理。若仍失敗，請聯絡系統管理員。');
        }
      } catch {
        setLoaded(null);
        setFailed('整封信預覽產生失敗，請重新整理。若仍失敗，請聯絡系統管理員。');
      }
    });
  }, [sampleId]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: unknown; key?: unknown } | null;
      if (data?.type === PICK_MESSAGE && typeof data.key === 'string') onPick(data.key);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPick]);

  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='text-lg font-semibold'>整封信預覽</h2>
        {samples.length > 1 && (
          <>
            <label htmlFor='email-whole-sample' className='text-sm'>情況</label>
            <select
              id='email-whole-sample'
              value={sampleId}
              onChange={(e) => onSampleChange(e.target.value)}
              className='border-input h-9 rounded-md border px-2 text-sm'
            >
              {samples.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </>
        )}
      </div>
      <p className='text-muted-foreground text-sm'>
        黃色底的句子可以修改，點一下就會打開那一句；灰色底的句子不開放修改。訂單資料是範例，不是真的訂單。
      </p>
      {failed !== null && (
        <p role='status' className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm'>{failed}</p>
      )}
      {loaded === null ? (
        failed === null && <p className='text-muted-foreground text-sm'>{pending ? '整封信載入中…' : ''}</p>
      ) : (
        <>
          <p className='text-sm'>主旨：{loaded.subject}</p>
          {!loaded.highlighted && (
            <p className='text-sm text-amber-800'>這封信目前無法標出可改的句子，請從左邊清單點要改的句子。</p>
          )}
          <iframe
            ref={frame}
            title='整封信預覽'
            sandbox='allow-scripts'
            srcDoc={loaded.html + PICK_SCRIPT}
            className='h-[40rem] w-full rounded-md border bg-white'
          />
        </>
      )}
    </section>
  );
}
