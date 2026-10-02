'use client';

// 後台「信件文字」:先選信件(最上面一排)→ 左邊列出那封信用到的句子、右邊顯示整封信 → 點句子編輯。
// Sean 10-03 試用回饋:①看不出每一封信怎麼改、哪句屬於哪封信 ②信件很多, 往下捲就看不到右邊的編輯欄。
// ⇒ 改成先選信件;右欄 sticky(與訂單頁工具列同做法:捲的是整頁, 右欄 sticky top), 左邊清單隨頁面捲動。
import { useCallback, useMemo, useState } from 'react';
import type { EmailCopyGroup, EmailCopyKey } from '@pcm/domain';
import type { EmailPreviewSample } from '@pcm/use-cases';
import { EMAIL_COPY_GROUP_LABEL, EMAIL_COPY_GROUP_ORDER, type EmailCopyRow } from '@/lib/email-copy/email-copy-view';
import { EmailCopyPanel } from './email-copy-panel';
import { EmailWholePreview } from './email-whole-preview';

const TAB_ORDER: readonly EmailCopyGroup[] = [...EMAIL_COPY_GROUP_ORDER.filter((g) => g !== 'shared'), 'shared'];

function samplesOf(group: EmailCopyGroup, samples: readonly EmailPreviewSample[]): readonly EmailPreviewSample[] {
  return group === 'shared' ? samples : samples.filter((s) => s.group === group);
}

export function EmailCopyEditor({
  rows,
  samples,
  sampleKeys,
  testConfigured,
}: {
  rows: EmailCopyRow[];
  samples: readonly EmailPreviewSample[];
  /** 每一封範例信用到哪幾句。 */
  sampleKeys: Readonly<Record<string, readonly EmailCopyKey[]>>;
  testConfigured: boolean;
}) {
  const [group, setGroup] = useState<EmailCopyGroup>(TAB_ORDER[0]!);
  const [selected, setSelected] = useState<EmailCopyKey | null>(null);
  const [wholeSampleId, setWholeSampleId] = useState(samplesOf(TAB_ORDER[0]!, samples)[0]?.id ?? '');

  const groupSamples = useMemo(() => samplesOf(group, samples), [group, samples]);
  // 這封信的句子:這封信自己的, 加上它用到的「多封信共用」句子。「多封共用」那一格只列共用句子。
  const listRows = useMemo(() => {
    if (group === 'shared') return rows.filter((r) => r.group === 'shared');
    const used = new Set(groupSamples.flatMap((s) => sampleKeys[s.id] ?? []));
    return [...rows.filter((r) => r.group === group), ...rows.filter((r) => r.group === 'shared' && used.has(r.key))];
  }, [group, groupSamples, rows, sampleKeys]);

  const chooseGroup = (g: EmailCopyGroup) => {
    setGroup(g);
    setSelected(null);
    setWholeSampleId(samplesOf(g, samples)[0]?.id ?? '');
  };

  const pick = useCallback(
    (key: string) => {
      const row = rows.find((r) => r.key === key);
      if (row === undefined) return;
      // 「多封共用」看整封信時點到某封信自己的句子 ⇒ 換到那封信, 清單才看得到它。
      if (!listRows.some((r) => r.key === row.key)) {
        setGroup(row.group);
        setWholeSampleId(samplesOf(row.group, samples)[0]?.id ?? '');
      }
      setSelected(row.key);
    },
    [rows, listRows, samples],
  );

  const current = rows.find((r) => r.key === selected) ?? null;
  const panelSample =
    current === null
      ? undefined
      : sampleKeys[wholeSampleId]?.includes(current.key)
        ? wholeSampleId
        : groupSamples.find((s) => sampleKeys[s.id]?.includes(current.key))?.id;

  return (
    <div className='space-y-4'>
      <div role='tablist' aria-label='選擇信件' className='flex flex-wrap gap-2'>
        {TAB_ORDER.map((g) => (
          <button
            key={g}
            type='button'
            role='tab'
            aria-selected={group === g}
            onClick={() => chooseGroup(g)}
            className={`h-9 rounded-md border px-3 text-sm ${group === g ? 'bg-primary text-primary-foreground border-primary font-medium' : 'hover:bg-muted/40'}`}
          >
            {EMAIL_COPY_GROUP_LABEL[g]}
          </button>
        ))}
      </div>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]'>
        <nav aria-label={`${EMAIL_COPY_GROUP_LABEL[group]}的句子`} className='self-start rounded-lg border'>
          <h2 className='bg-muted/40 border-b px-3 py-2 text-sm font-semibold'>
            {EMAIL_COPY_GROUP_LABEL[group]}的句子（{listRows.length} 句）
          </h2>
          <ul className='divide-y'>
            {listRows.map((r) => (
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
                    {group !== 'shared' && r.group === 'shared' && r.lockReason === null ? '・多封信共用，改了其他信也會跟著改' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* 右欄固定在畫面上:捲的是整頁(layout 的內容容器 p-6), 所以 sticky top-6;太高時右欄自己捲。 */}
        <div className='lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto'>
          {current === null ? (
            <EmailWholePreview
              samples={groupSamples}
              sampleId={wholeSampleId}
              onSampleChange={setWholeSampleId}
              onPick={pick}
            />
          ) : (
            <EmailCopyPanel
              key={`${current.key}:${panelSample ?? ''}`}
              row={current}
              samples={samples}
              testConfigured={testConfigured}
              initialSampleId={panelSample}
              onBack={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
