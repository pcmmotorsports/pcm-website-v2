'use client';

// 後台「信件文字」(信件文字第 3 片):左邊是句子清單(依信件分組), 右邊是編輯、預覽、寄測試信與修改紀錄。
import { useState } from 'react';
import type { EmailCopyGroup, EmailCopyKey } from '@pcm/domain';
import { EMAIL_COPY_GROUP_LABEL, EMAIL_COPY_GROUP_ORDER, type EmailCopyRow } from '@/lib/email-copy/email-copy-view';
import { EmailCopyPanel } from './email-copy-panel';

export function EmailCopyEditor({
  rows,
  samples,
  testConfigured,
}: {
  rows: EmailCopyRow[];
  samples: readonly { id: string; label: string }[];
  testConfigured: boolean;
}) {
  const [selected, setSelected] = useState<EmailCopyKey | null>(null);
  const byGroup = new Map<EmailCopyGroup, EmailCopyRow[]>();
  for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  const current = rows.find((r) => r.key === selected) ?? null;

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]'>
      <nav aria-label='信件句子清單' className='space-y-4'>
        {EMAIL_COPY_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => (
          <section key={g} className='rounded-lg border'>
            <h2 className='bg-muted/40 border-b px-3 py-2 text-sm font-semibold'>{EMAIL_COPY_GROUP_LABEL[g]}</h2>
            <ul className='divide-y'>
              {(byGroup.get(g) ?? []).map((r) => (
                <li key={r.key}>
                  <button
                    type='button'
                    onClick={() => setSelected(r.key)}
                    aria-current={selected === r.key ? 'true' : undefined}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-muted/40 ${selected === r.key ? 'bg-muted' : ''}`}
                  >
                    <span className='block font-medium'>{r.label}</span>
                    <span className='text-muted-foreground block truncate text-xs'>{r.currentText}</span>
                    <span className='text-muted-foreground block text-xs'>
                      {r.lockReason !== null ? '不開放修改' : r.isDefault ? '預設文字' : '已修改'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <div>
        {current === null ? (
          <div className='text-muted-foreground rounded-lg border p-6 text-sm'>從左邊選一句來查看或修改。</div>
        ) : (
          <EmailCopyPanel key={current.key} row={current} samples={samples} testConfigured={testConfigured} />
        )}
      </div>
    </div>
  );
}
