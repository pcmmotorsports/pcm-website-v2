'use client';

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { dispatchShipmentAction, type DispatchActionResult } from '@/lib/shipping/shipment-dispatch-hct-action';

// shipment-pick.tsx — 出貨清單(稿 v22 §4)的勾選 + 右上角「新竹物流叫車」藍鈕。
//
// 🔴 **零新寫入路**:叫車仍是既有的 `dispatchShipmentAction({ shipmentId })`(一箱一發、含 HCT 佔位 / needs_human 那整套),
//    這裡只是把「每列一顆叫車鈕」換成稿的形狀:勾幾箱 → 右上角一顆鈕 → **逐箱依序**呼叫同一支 action、逐箱印結果。
//    依序不併發:那支 action 每一發都寫佔位、打新竹;併發只會讓 needs_human 更難判。
// 🔴 能不能勾 = 既有 `dispatchButton(row, now)` 的 enabled(非 hct / 作廢 / 已叫車 / 途中中斷 ⇒ 勾不了,理由印在旁邊)。
//    勾選只活在這一頁的 client state;重整就沒了(它不是資料)。

type Api = {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  results: ReadonlyMap<string, DispatchActionResult>;
  busy: boolean;
  dispatchSelected: () => void;
};
const Ctx = createContext<Api | null>(null);

export function ShipmentPickProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<ReadonlyMap<string, DispatchActionResult>>(new Map());
  const [busy, start] = useTransition();
  const router = useRouter();
  const api: Api = {
    selected,
    results,
    busy,
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    dispatchSelected: () =>
      start(async () => {
        const ids = [...selected];
        for (const id of ids) {
          const r = await dispatchShipmentAction({ shipmentId: id });
          setResults((prev) => new Map(prev).set(id, r));
          // 叫到車 / 不確定 ⇒ 那一箱的狀態變了,從勾選裡拿掉(留著會再叫一次)。明白被拒 / 閘關著 ⇒ 留著讓他看理由。
          if (r.ok || r.kind === 'needs_human') setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
        }
        router.refresh();
      }),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function useApi(): Api {
  const v = useContext(Ctx);
  if (v === null) throw new Error('ShipmentPick* 必須在 <ShipmentPickProvider> 裡');
  return v;
}

export function ShipmentPickBox({ shipmentId, enabled, why }: { shipmentId: string; enabled: boolean; why: string | null }) {
  const api = useApi();
  const r = api.results.get(shipmentId);
  return (
    <span className='inline-flex flex-col gap-0.5'>
      <input
        type='checkbox'
        className='size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
        checked={api.selected.has(shipmentId)}
        disabled={!enabled || api.busy}
        onChange={() => api.toggle(shipmentId)}
        aria-label={enabled ? '選這一箱一起叫車' : (why ?? '這一箱不能叫車')}
      />
      {r !== undefined && (
        <span
          className={`text-[11.5px] leading-[1.4] whitespace-nowrap ${
            r.ok ? 'text-green-700' : r.kind === 'needs_human' ? 'font-medium text-orange-700' : 'text-muted-foreground'
          }`}
          role='status'
        >
          {r.ok ? `叫到車了(${r.edelno})` : r.message}
        </span>
      )}
    </span>
  );
}

/** 右上角那顆(稿 `.btn.btn-sm.btn-p` 字面「新竹物流叫車」)。沒勾任何箱 ⇒ disabled,不藏(稿上它常駐)。 */
export function ShipmentDispatchAllButton() {
  const api = useApi();
  const n = api.selected.size;
  return (
    <button
      type='button'
      disabled={n === 0 || api.busy}
      onClick={api.dispatchSelected}
      className='bg-primary text-primary-foreground inline-flex min-h-[26px] items-center rounded-lg px-2 text-[12px] leading-[1.4] font-medium disabled:opacity-50'
    >
      {api.busy ? '叫車中…' : n === 0 ? '新竹物流叫車' : `新竹物流叫車(${n} 箱)`}
    </button>
  );
}
