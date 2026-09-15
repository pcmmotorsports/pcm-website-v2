'use client';

// shipment-hct-query-probe.tsx — 🔴 片 B 臨時:新竹查詢(QueryEDELNO)真打驗證入口。
// 只在 HCT_QUERY_PROBE_ENABLED='true' 且管理者時由出貨清單頁渲染;驗完整支刪(plan 2026-09-15-hct-carrier-replied-exit-plan.md §3.4)。

import { useState } from 'react';
import {
  probeHctQueryAction,
  type HctProbeResult,
  type HctProbeWhich,
} from '../../lib/shipping/shipment-hct-probe-action';

export function ShipmentHctQueryProbe() {
  const [busy, setBusy] = useState<HctProbeWhich | null>(null);
  const [results, setResults] = useState<HctProbeResult[]>([]);

  const run = async (which: HctProbeWhich) => {
    setBusy(which);
    try {
      const r = await probeHctQueryAction({ which });
      setResults((prev) => [...prev, r]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className='rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'>
      <p className='font-semibold'>臨時:新竹查詢驗證(驗完就刪)</p>
      <p className='text-xs'>兩發都是唯讀查詢,不會在新竹建單,也不寫我們的資料庫。按之前要有 Sean 同意。</p>
      <div className='mt-2 flex flex-wrap gap-2'>
        <button
          type='button'
          className='border-input bg-card rounded-md border px-2 py-1 text-xs disabled:opacity-50'
          disabled={busy !== null}
          onClick={() => void run('positive')}
        >
          {busy === 'positive' ? '查詢中…' : '正對照:查 S9FC6P'}
        </button>
        <button
          type='button'
          className='border-input bg-card rounded-md border px-2 py-1 text-xs disabled:opacity-50'
          disabled={busy !== null}
          onClick={() => void run('negative')}
        >
          {busy === 'negative' ? '查詢中…' : '負對照:查從沒送過的箱號'}
        </button>
      </div>
      {results.length > 0 && (
        <ul className='mt-2 space-y-1 text-xs' role='status'>
          {results.map((r, i) => (
            <li key={i}>
              {r.verdict}
              {r.reference !== null && <span className='text-muted-foreground'> · 箱號 {r.reference}</span>}
              {r.outcome !== null && <span className='text-muted-foreground'> · 新竹回 {r.outcome}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
