'use client';

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { dispatchShipmentAction } from '@/lib/shipping/shipment-dispatch-hct-action';
import { submitShipmentToHctAction } from '@/lib/shipping/shipment-submit-hct-action';

// shipment-pick.tsx — 出貨清單(稿 v22 §4)的勾選 + 右上角的批次鈕。
//
// 🔴 **零新寫入路**:叫車仍是既有的 `dispatchShipmentAction({ shipmentId })`(一箱一發、含 HCT 佔位 / needs_human 那整套),
//    要號仍是既有的 `submitShipmentToHctAction({ shipmentId })`。這裡只是勾幾箱 → 右上角一顆鈕 → **逐箱依序**呼叫同一支 action、逐箱印結果。
//    依序不併發:那兩支 action 每一發都打新竹;併發只會讓 needs_human 更難判。
// 🔴🔴 2026-09-27 出貨流程乙(Fable R4 必修 2):**一定是瀏覽器逐箱各呼叫一次 action**, 不做一支 action 迴圈多箱 ——
//    一支 action 有 60 秒上限, 迴圈 30 箱會在中途被平台砍掉, 被砍的那箱變成「結果未確認」, 10 分鐘後又能重新叫車。
// 🔵 2026-09-27 出貨流程乙第 4–6 項:上方分群(還沒要託運單號 / 可以叫車 / 結果未確認 / 已出貨)+ 每群全選 +
//    「跟新竹要託運單號(N 箱)」+「新竹物流叫車(N 箱)」;叫車前先確認一次(寫出箱數, 叫車不能收回)。
//    勾選只活在這一頁的 client state;重整就沒了(它不是資料)。

type Tone = 'ok' | 'warn' | 'muted';
type Outcome = { text: string; tone: Tone };

/** 頁層算好的分群(箱 id)。只有 `needsNumber` 與 `ready` 兩群勾得起來。 */
export type PickGroups = {
  needsNumber: readonly string[];
  ready: readonly string[];
  uncertain: number;
  shipped: number;
};

type Api = {
  groups: PickGroups;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  selectAll: (ids: readonly string[]) => void;
  results: ReadonlyMap<string, Outcome>;
  busy: boolean;
  progress: { done: number; total: number } | null;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  dispatchSelected: () => void;
  submitSelected: () => void;
};
const Ctx = createContext<Api | null>(null);

const EMPTY_GROUPS: PickGroups = { needsNumber: [], ready: [], uncertain: 0, shipped: 0 };

/**
 * `initialSelected`:2026-09-27 出貨流程甲片二 —— 訂單列表的「叫車」帶 `?pick=<箱 id>` 過來, 那一箱先勾好。
 * 🔴 只放勾得了的箱(頁層判), 勾不了的箱不能因為網址而被勾起來。
 */
export function ShipmentPickProvider({
  children,
  initialSelected = [],
  groups = EMPTY_GROUPS,
}: {
  children: ReactNode;
  initialSelected?: readonly string[];
  groups?: PickGroups;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialSelected));
  const [results, setResults] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();
  const router = useRouter();
  const unselect = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  /** 逐箱依序呼叫 `one`;每箱結果印在那一箱下面;全部送完才重新整理。 */
  const runEach = (ids: readonly string[], one: (id: string) => Promise<{ outcome: Outcome; done: boolean }>) =>
    start(async () => {
      setProgress({ done: 0, total: ids.length });
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i]!;
        const { outcome, done } = await one(id);
        setResults((prev) => new Map(prev).set(id, outcome));
        if (done) unselect(id);
        setProgress({ done: i + 1, total: ids.length });
      }
      setProgress(null);
      router.refresh();
    });
  const api: Api = {
    groups,
    selected,
    results,
    busy,
    progress,
    confirming,
    setConfirming,
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectAll: (ids) => setSelected((prev) => new Set([...prev, ...ids])),
    dispatchSelected: () => {
      setConfirming(false);
      runEach(
        groups.ready.filter((id) => selected.has(id)),
        async (id) => {
          const r = await dispatchShipmentAction({ shipmentId: id });
          // 叫到車 / 不確定 ⇒ 那一箱的狀態變了,從勾選裡拿掉(留著會再叫一次)。明白被拒 / 閘關著 ⇒ 留著讓他看理由。
          return {
            outcome: r.ok
              ? { text: `叫到車了(${r.edelno})`, tone: 'ok' }
              : { text: r.message, tone: r.kind === 'needs_human' ? 'warn' : 'muted' },
            done: r.ok || r.kind === 'needs_human',
          };
        },
      );
    },
    submitSelected: () =>
      runEach(
        groups.needsNumber.filter((id) => selected.has(id)),
        async (id) => {
          const r = await submitShipmentToHctAction({ shipmentId: id });
          // 🔵 `needs_confirm`(有欄位會被截短 / 電話地址要看一眼)⇒ 批次不替他按第二次, 要他打開那一箱看過再送。
          const text = r.ok
            ? `已取得託運單號(${r.requestId ?? '貨號待補'})`
            : r.kind === 'needs_confirm'
              ? `${r.message} 這一箱要先打開訂單看過再送。`
              : r.message;
          return {
            outcome: { text, tone: r.ok ? 'ok' : r.kind === 'unknown' || r.kind === 'needs_human' ? 'warn' : 'muted' },
            done: r.ok || r.kind === 'unknown' || r.kind === 'needs_human' || r.kind === 'refused',
          };
        },
      ),
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
  return (
    <input
      type='checkbox'
      className='size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
      checked={api.selected.has(shipmentId)}
      disabled={!enabled || api.busy}
      onChange={() => api.toggle(shipmentId)}
      aria-label={enabled ? '選這一箱' : (why ?? '這一箱不能叫車')}
    />
  );
}

/**
 * 叫車 / 要號結果:印在那一箱下面的整列(報告問題 12:原本擠在勾選框那一格, 把整張表推歪)。
 * 沒按過 ⇒ 不畫這一列。
 */
export function ShipmentPickResultRow({ shipmentId, colSpan }: { shipmentId: string; colSpan: number }) {
  const r = useApi().results.get(shipmentId);
  if (r === undefined) return null;
  return (
    <tr>
      <td colSpan={colSpan} className='px-3 pb-2'>
        <span
          className={`text-[12.5px] leading-[1.5] ${
            r.tone === 'ok' ? 'text-green-700' : r.tone === 'warn' ? 'font-medium text-orange-700' : 'text-muted-foreground'
          }`}
          role='status'
        >
          {r.text}
        </span>
      </td>
    </tr>
  );
}

/** 上方分群:每群的箱數, 勾得起來的兩群給「全選」。 */
export function ShipmentPickGroups() {
  const api = useApi();
  const g = api.groups;
  const chip = 'border-border bg-card inline-flex items-center gap-1.5 rounded-lg border px-2 py-[3px] text-[12px] leading-[1.4]';
  const selectBtn = 'text-primary underline underline-offset-2 disabled:opacity-50 disabled:no-underline';
  return (
    <div className='flex flex-wrap items-center gap-2' data-testid='pick-groups'>
      <span className={chip}>
        還沒要託運單號 {g.needsNumber.length} 箱
        {g.needsNumber.length > 0 && (
          <button type='button' className={selectBtn} disabled={api.busy} onClick={() => api.selectAll(g.needsNumber)} data-testid='select-needs-number'>
            全選
          </button>
        )}
      </span>
      <span className={chip}>
        可以叫車 {g.ready.length} 箱
        {g.ready.length > 0 && (
          <button type='button' className={selectBtn} disabled={api.busy} onClick={() => api.selectAll(g.ready)} data-testid='select-ready'>
            全選
          </button>
        )}
      </span>
      <span className={`${chip} ${g.uncertain > 0 ? 'font-medium text-orange-700' : ''}`}>結果未確認 {g.uncertain} 箱</span>
      <span className={chip}>已出貨 {g.shipped} 箱</span>
      {api.progress !== null && (
        <span className='text-muted-foreground text-[12px]' role='status'>
          送出中 {api.progress.done} / {api.progress.total}
        </span>
      )}
    </div>
  );
}

const HEAD_BTN =
  'bg-primary text-primary-foreground inline-flex min-h-[26px] items-center rounded-lg px-2 text-[12px] leading-[1.4] font-medium disabled:opacity-50';

/** 「跟新竹要託運單號(N 箱)」:只算勾到而且還沒要號的箱。 */
export function ShipmentSubmitAllButton() {
  const api = useApi();
  const n = api.groups.needsNumber.filter((id) => api.selected.has(id)).length;
  return (
    <button type='button' disabled={n === 0 || api.busy} onClick={api.submitSelected} className={HEAD_BTN}>
      {n === 0 ? '跟新竹要託運單號' : `跟新竹要託運單號(${n} 箱)`}
    </button>
  );
}

/**
 * 右上角那顆(稿 `.btn.btn-sm.btn-p` 字面「新竹物流叫車」)。沒勾任何可以叫車的箱 ⇒ disabled,不藏(稿上它常駐)。
 * 2026-09-27 出貨流程乙第 6 項:按下去先出現確認(寫出箱數、不能取消), 按「確認」才逐箱送。
 */
export function ShipmentDispatchAllButton() {
  const api = useApi();
  const n = api.groups.ready.filter((id) => api.selected.has(id)).length;
  if (api.confirming && n > 0) {
    return (
      <span className='inline-flex items-center gap-2 text-[12px]'>
        <span className='font-medium'>將向新竹物流叫車 {n} 箱，送出後不能取消。</span>
        <button type='button' className={HEAD_BTN} onClick={api.dispatchSelected} data-testid='dispatch-confirm'>
          確認
        </button>
        <button
          type='button'
          className='border-border bg-card inline-flex min-h-[26px] items-center rounded-lg border px-2 text-[12px]'
          onClick={() => api.setConfirming(false)}
        >
          取消
        </button>
      </span>
    );
  }
  return (
    <button type='button' disabled={n === 0 || api.busy} onClick={() => api.setConfirming(true)} className={HEAD_BTN}>
      {api.busy ? '送出中…' : n === 0 ? '新竹物流叫車' : `新竹物流叫車(${n} 箱)`}
    </button>
  );
}
