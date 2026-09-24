'use client';

// 經銷品牌折扣設定表(B2B 計畫 §10.4 片 E3)。
// 每一列一個品牌;可搜尋、只看有設定的、勾選多個套同一個折扣、逐列修改, 最後一次「檢查變更」→ 差異確認 → 儲存。
// 折扣寫「折扣 X%」, 旁邊顯示「＝經銷價的 Y%」;不用「折」這個字。超過 20% 那一列標黃, 要多勾一次確認。
// 🔴 按「檢查變更」那一刻把要送的內容【凍結】成 review, 確認期間表格鎖住(Codex E3 R1):
//    送出去的一定是員工在確認畫面上看到的那一批, 不會多、不會少, 也不會沿用上一批的 20% 確認。
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBrandDiscountsAction, type SaveBrandDiscountsResult } from '../../lib/customers/brand-discount-actions';
import {
  DEALER_DISCOUNT_SOFT_CAP_PERCENT,
  buildDiscountChanges,
  parsePercentInput,
  priceRatioText,
  type CurrentDiscount,
} from '../../lib/customers/brand-discount-form';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

export type BrandDiscountRowView = {
  brandId: string;
  brandName: string;
  current: (CurrentDiscount & { updatedByLabel: string; updatedAtText: string }) | null;
};

const RESULT_TEXT: Record<SaveBrandDiscountsResult['kind'], { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  saved: { tone: 'ok', text: '已儲存品牌折扣。' },
  no_change: { tone: 'ok', text: '沒有需要儲存的變更。' },
  stale: { tone: 'warn', text: '有人在你打開頁面之後改過這位客人的折扣，這次沒有儲存。請重新整理後再改一次。' },
  not_found: { tone: 'error', text: '找不到這位客人，沒有儲存。' },
  not_dealer: { tone: 'warn', text: '這位客人不是車行等級，不能新增或修改折扣，這次沒有儲存。' },
  need_cap_confirm: { tone: 'warn', text: `有品牌折扣超過 ${DEALER_DISCOUNT_SOFT_CAP_PERCENT}%，請勾選確認後再儲存。` },
  invalid: { tone: 'error', text: '資料格式不對，沒有儲存。請重新整理後再試。' },
  denied: { tone: 'error', text: '只有管理者可以修改品牌折扣。' },
  unknown: { tone: 'warn', text: '無法確認是否已經儲存，請重新整理查看目前的折扣。' },
};
const TONE_CLASS = {
  ok: 'rounded-lg border p-3 text-sm',
  warn: 'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900',
  error: 'border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm',
} as const;

function fmt(p: number | null): string {
  return p === null ? '不打折' : `折扣 ${p}%`;
}

export function BrandDiscountTable({
  customerId,
  rows,
  canSave,
}: {
  customerId: string;
  rows: BrandDiscountRowView[];
  canSave: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlySet, setOnlySet] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState('');
  const [review, setReview] = useState<ReturnType<typeof buildDiscountChanges> | null>(null);
  const [capOk, setCapOk] = useState(false);
  const [result, setResult] = useState<SaveBrandDiscountsResult['kind'] | null>(null);

  const current = useMemo(
    () =>
      new Map(
        rows.flatMap((r) =>
          r.current
            ? [[r.brandId, { percent: r.current.percent, below_cost_reason: r.current.below_cost_reason, updated_at: r.current.updated_at }] as const]
            : [],
        ),
      ),
    [rows],
  );
  const nameOf = useMemo(() => new Map(rows.map((r) => [r.brandId, r.brandName])), [rows]);

  // 每一格目前的解析結果(沒動過的格子 = 目前值)
  const parsed = Object.fromEntries(Object.entries(edits).map(([id, raw]) => [id, parsePercentInput(raw)]));
  const hasError = Object.values(parsed).some((p) => !p.ok);
  const next = Object.fromEntries(
    Object.entries(parsed).flatMap(([id, p]) => (p.ok ? [[id, p.value] as const] : [])),
  );
  const diff = buildDiscountChanges(current, next);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) => (!q || r.brandName.toLowerCase().includes(q)) && (!onlySet || r.current !== null || (edits[r.brandId] ?? '') !== ''),
  );
  const batchParsed = parsePercentInput(batch);

  const locked = review !== null || pending;

  function applyBatch() {
    if (!batchParsed.ok) return;
    const text = batchParsed.value === null ? '' : String(batchParsed.value);
    setEdits((e) => ({ ...e, ...Object.fromEntries([...selected].map((id) => [id, text])) }));
    setResult(null);
  }

  function save() {
    if (!review) return;
    const snapshot = review;
    startTransition(async () => {
      let kind: SaveBrandDiscountsResult['kind'];
      try {
        kind = (
          await saveBrandDiscountsAction({
            customerId,
            changes: snapshot.changes,
            expected: snapshot.expected,
            overCapConfirmed: snapshot.overCap.length > 0 && capOk,
          })
        ).kind;
      } catch {
        // 回應沒收到:資料庫可能已經存好 ⇒ 結果不明, 修改留著讓員工重新整理核對
        kind = 'unknown';
      }
      setResult(kind);
      setReview(null);
      setCapOk(false);
      if (kind === 'saved' || kind === 'no_change') {
        setEdits({});
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className='space-y-3'>
      {result && (
        <p role='status' className={TONE_CLASS[RESULT_TEXT[result].tone]}>
          {RESULT_TEXT[result].text}
        </p>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        <input
          type='search'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='搜尋品牌'
          aria-label='搜尋品牌'
          className={ADMIN_INPUT_CLASS}
        />
        <label className='flex items-center gap-2 text-sm'>
          <input type='checkbox' checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} />
          只看有設定的
        </label>
      </div>

      {selected.size > 0 && !locked && (
        <div className='flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm' role='group' aria-label='批次套用'>
          <span>已選 {selected.size} 個品牌，全部套用</span>
          <input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            inputMode='decimal'
            aria-label='批次折扣 %'
            className={`${ADMIN_INPUT_CLASS} w-24`}
          />
          <span>%</span>
          <span className='text-muted-foreground'>{batchParsed.ok ? priceRatioText(batchParsed.value) : batchParsed.error}</span>
          <button type='button' onClick={applyBatch} disabled={!batchParsed.ok} className='h-9 rounded-md border px-3 disabled:opacity-50'>
            套用到已選品牌
          </button>
          <button type='button' onClick={() => setSelected(new Set())} className='h-9 px-2 underline'>
            取消選取
          </button>
        </div>
      )}

      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b text-left'>
            <th className='w-8 py-2'>
              <span className='sr-only'>選取</span>
            </th>
            <th className='py-2'>品牌</th>
            <th className='py-2'>目前折扣</th>
            <th className='py-2'>改成</th>
            <th className='py-2'>最後修改</th>
            <th className='py-2'>修改人</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const raw = edits[r.brandId];
            const p = raw === undefined ? null : parsePercentInput(raw);
            return (
              <tr key={r.brandId} className='border-b'>
                <td className='py-2'>
                  <input
                    type='checkbox'
                    aria-label={`選取 ${r.brandName}`}
                    checked={selected.has(r.brandId)}
                    disabled={locked}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(r.brandId);
                        else n.delete(r.brandId);
                        return n;
                      })
                    }
                  />
                </td>
                <td className='py-2'>{r.brandName}</td>
                <td className='py-2'>
                  {fmt(r.current?.percent ?? null)}
                  <span className='text-muted-foreground ml-1 text-xs'>{priceRatioText(r.current?.percent ?? null)}</span>
                </td>
                <td className='py-2'>
                  <span className='flex items-center gap-1'>
                    折扣
                    <input
                      value={raw ?? (r.current ? String(r.current.percent) : '')}
                      onChange={(e) => {
                        setEdits((x) => ({ ...x, [r.brandId]: e.target.value }));
                        setResult(null);
                      }}
                      inputMode='decimal'
                      disabled={locked}
                      aria-label={`${r.brandName} 折扣 %`}
                      className={`${ADMIN_INPUT_CLASS} w-20`}
                    />
                    %
                  </span>
                  {p && !p.ok ? (
                    <span className='text-destructive text-xs'>{p.error}</span>
                  ) : p?.ok ? (
                    <span className='text-muted-foreground text-xs'>{priceRatioText(p.value)}</span>
                  ) : null}
                </td>
                <td className='text-muted-foreground py-2'>{r.current?.updatedAtText ?? '—'}</td>
                <td className='text-muted-foreground py-2'>{r.current?.updatedByLabel ?? '—'}</td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} className='text-muted-foreground py-6 text-center'>
                沒有符合的品牌。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {review === null ? (
        <div className='flex flex-wrap items-center gap-3'>
          <button
            type='button'
            disabled={!canSave || hasError || diff.changes.length === 0 || pending}
            onClick={() => {
              setReview(diff);
              setCapOk(false);
              setResult(null);
            }}
            className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
          >
            {canSave ? `檢查變更（${diff.changes.length} 個品牌）` : '只有管理者可以修改'}
          </button>
          {hasError && <span className='text-destructive text-sm'>有格子需要修正，修正後才能儲存。</span>}
        </div>
      ) : (
        <section className='space-y-3 rounded-lg border p-4' aria-label='儲存前確認'>
          <h2 className='text-sm font-medium'>確認這 {review.changes.length} 個品牌的變更（要再修改請按「返回修改」）</h2>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b text-left'>
                <th className='py-2'>品牌</th>
                <th className='py-2'>原本</th>
                <th className='py-2'>改成</th>
              </tr>
            </thead>
            <tbody>
              {review.changes.map((c) => (
                <tr
                  key={c.brand_id}
                  className={`border-b ${review.overCap.includes(c.brand_id) ? 'bg-amber-50' : ''}`}
                  data-over-cap={review.overCap.includes(c.brand_id) ? 'true' : undefined}
                >
                  <td className='py-2'>{nameOf.get(c.brand_id)}</td>
                  <td className='py-2'>{fmt(current.get(c.brand_id)?.percent ?? null)}</td>
                  <td className='py-2'>
                    {fmt(c.percent)} <span className='text-muted-foreground text-xs'>{priceRatioText(c.percent)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.overCap.length > 0 && (
            <label className='flex items-center gap-2 text-sm text-amber-900'>
              <input type='checkbox' checked={capOk} disabled={pending} onChange={(e) => setCapOk(e.target.checked)} />
              我確認這個折扣超過 {DEALER_DISCOUNT_SOFT_CAP_PERCENT}%
            </label>
          )}
          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              onClick={save}
              disabled={pending || (review.overCap.length > 0 && !capOk)}
              className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
            >
              {pending ? '儲存中…' : '確認儲存'}
            </button>
            <button type='button' onClick={() => setReview(null)} disabled={pending} className='h-9 rounded-md border px-4 text-sm'>
              返回修改
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
