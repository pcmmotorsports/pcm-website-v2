'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setOrderItemCostsAction } from '../../lib/orders/item-costs-actions';
import { COST_ROWS_FIELD } from '../../lib/orders/item-costs-view';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { NextStepDialog } from './next-step-dialog';
import { NextStepCancelButton } from './next-step-cancel-button';
import {
  COST_FIELD_LABEL,
  COST_SUBMIT_REASON_TEXT,
  buildCostSubmit,
  dirtyCellCount,
  dirtyFields,
  type CostDraft,
  type CostDraftValues,
} from '../../lib/orders/item-costs-edit';

// item-costs-cells.tsx — 老闆成本四格(原價 / 運費 / 稅金 / 幣值)就地可改的 island(A2,2026-09-14 設計窗)。
// plan docs/plans/2026-09-14-order-item-cost-columns-plan.md §1-d;稿 shots/inv-draft-訂單-老闆成本.png:
//   td.cost 底 --boss-bg · input.c 無框透明右對齊 · td.dirty{inset 0 0 0 2px #7c3aed;白底} · #unsaved 紫底浮條
//   「✎ 已改 N 格,還沒存」+「取消變更」「確認全部」 · #confirm 560 列出 單 / 商品 / 欄 / 改成 +「回去再看」「確認(N 格)」(Sean Q17 甲)。
//
// 🔴 props 只有純量(`orders-table.tsx:66` 紅線:整包成本 / 金額不進 RSC payload):每格 `CostCellInputs` 只收字串;
//    `item-costs-cells.test.tsx` 用正規式釘著這件事。**不做即時重算預覽**(要 line_total 進 client);總計 / 利潤存檔後 server 重繪。
// 🔴 寫入 = 一發 `setOrderItemCostsAction`(隱形 <form>,`COST_ROWS_FIELD` JSON ≤200 列 + return_to);
//    畫面上的「改了幾格」只是 dirty 狀態,存之前一律先跳確認框列出每一格。
// 🔴 `orders-table.tsx` 零 use client:它只 import 本檔的元件,不碰狀態。

type Api = {
  register: (draft: CostDraft) => void;
  unregister: (orderItemId: string) => void;
  patch: (orderItemId: string, values: Partial<CostDraftValues>) => void;
  reset: () => void;
  drafts: ReadonlyMap<string, CostDraft>;
  /** 取消變更之後的世代號:每格 input 靠它把自己的值退回 baseline。 */
  generation: number;
};
const Ctx = createContext<Api | null>(null);

export function CostEditProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, CostDraft>>(new Map());
  const [generation, setGeneration] = useState(0);
  const register = useCallback((draft: CostDraft) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(draft.orderItemId, draft);
      return next;
    });
  }, []);
  const unregister = useCallback((orderItemId: string) => {
    setDrafts((prev) => {
      if (!prev.has(orderItemId)) return prev;
      const next = new Map(prev);
      next.delete(orderItemId);
      return next;
    });
  }, []);
  const patch = useCallback((orderItemId: string, values: Partial<CostDraftValues>) => {
    setDrafts((prev) => {
      const d = prev.get(orderItemId);
      if (!d) return prev;
      const next = new Map(prev);
      next.set(orderItemId, { ...d, current: { ...d.current, ...values } });
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setDrafts((prev) => {
      const next = new Map<string, CostDraft>();
      for (const [k, d] of prev) next.set(k, { ...d, current: { ...d.baseline } });
      return next;
    });
    setGeneration((g) => g + 1);
  }, []);
  const api = useMemo<Api>(() => ({ register, unregister, patch, reset, drafts, generation }), [register, unregister, patch, reset, drafts, generation]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function useCostEdit(): Api {
  const v = useContext(Ctx);
  if (v === null) throw new Error('ItemCostsCells:元件必須包在 <CostEditProvider> 內');
  return v;
}

const INPUT = 'w-[52px] bg-transparent border-0 px-1 py-[2px] text-right text-[13px] leading-[1.4] tabular-nums focus:outline-none focus:ring-1 focus:ring-(--boss-ink)';
const DIRTY = 'costs-dirty';  // 樣式在 globals(稿 td.dirty:inset 2px --boss-ink + 白底);arbitrary shadow class 在這裡量不到

/**
 * 一列的四格可改(原價 / 運費 / 稅金 / 幣值)。**回傳四個 `<td>`**(由 orders-table 的 `CostCells` 放進列裡,總計 / 利潤那兩格仍是 server 畫)。
 * props 一律純量字串;`currencies` 用逗號串,不傳陣列。
 */
export function CostCellInputs({
  orderItemId,
  orderDisplayId,
  itemTitle,
  costPrice,
  costShipping,
  costTax,
  currency,
  fxRate,
  currencies,
  tdClass,
}: {
  orderItemId: string;
  orderDisplayId: string;
  itemTitle: string;
  costPrice: string;
  costShipping: string;
  costTax: string;
  currency: string;
  /** 目前存檔那筆抄的匯率(字串);幣別一改就不再是它 ⇒ 畫面改印「存檔時帶」。 */
  fxRate: string;
  /** 可選幣別代碼,逗號串(例 `EUR,USD,TWD`)。 */
  currencies: string;
  /** 四格共用的 td class(由 orders-table 給,含 `boss-cell` 與各欄 class 前綴)。 */
  tdClass: string;
}) {
  const api = useCostEdit();
  const baseline = useMemo<CostDraftValues>(() => ({ costPrice, costShipping, costTax, currency }), [costPrice, costShipping, costTax, currency]);
  const [values, setValues] = useState<CostDraftValues>(baseline);
  const lastGen = useRef(api.generation);
  const { register, unregister } = api; // 兩支是 provider 的 useCallback([]),穩定 ⇒ 進 deps 不會重登記
  useEffect(() => {
    register({ orderItemId, orderDisplayId, itemTitle, baseline, current: baseline });
    return () => unregister(orderItemId);
  }, [register, unregister, orderItemId, orderDisplayId, itemTitle, baseline]);
  useEffect(() => {
    if (api.generation !== lastGen.current) {
      lastGen.current = api.generation;
      setValues(baseline);
    }
  }, [api.generation, baseline]);
  const set = (k: keyof CostDraftValues, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    api.patch(orderItemId, { [k]: v });
  };
  const draft = api.drafts.get(orderItemId);
  const dirty = new Set(draft ? dirtyFields(draft) : []);
  const codes = currencies.split(',').filter((c) => c !== '');
  const amount = (k: 'costPrice' | 'costShipping' | 'costTax', cls: string) => (
    <td key={k} className={`${tdClass} ${cls} text-right tabular-nums ${dirty.has(k) ? DIRTY : ''}`} data-l={COST_FIELD_LABEL[k]}>
      <input
        inputMode='decimal'
        value={values[k]}
        placeholder={COST_FIELD_LABEL[k]}
        aria-label={`${itemTitle} ${COST_FIELD_LABEL[k]}`}
        onChange={(e) => set(k, e.target.value)}
        className={INPUT}
      />
    </td>
  );
  return (
    <>
      {amount('costPrice', 'boss-price')}
      {amount('costShipping', 'boss-shipping')}
      {amount('costTax', 'boss-tax')}
      <td className={`${tdClass} boss-fx text-xs whitespace-nowrap ${dirty.has('currency') ? DIRTY : ''}`} data-l='幣值'>
        <select
          value={values.currency}
          aria-label={`${itemTitle} 幣值`}
          onChange={(e) => set('currency', e.target.value)}
          className='w-[52px] bg-transparent border-0 px-0 text-[13px] leading-[1.4] focus:outline-none'
        >
          {values.currency === '' ? <option value=''>—</option> : null}
          {codes.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>{' '}
        <span className='text-[11.5px] text-(--fg-2)'>
          {values.currency !== '' && values.currency === currency && fxRate !== '' ? `×${fxRate}` : values.currency === '' ? '' : '匯率存檔時帶'}
        </span>
      </td>
    </>
  );
}

/**
 * 紫底浮條「✎ 已改 N 格,還沒存」+ 取消變更 / 確認全部 + 確認框(列出每一格)+ 隱形送出表單。
 * 放在 `<CostEditProvider>` 裡任何位置(page.tsx 放表格上方,與出貨那條 bar 同一區)。
 */
export function CostUnsavedBar({ returnTo }: { returnTo: string }) {
  const api = useCostEdit();
  const drafts = useMemo(() => [...api.drafts.values()], [api.drafts]);
  const n = dirtyCellCount(drafts);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const check = buildCostSubmit(drafts);
  if (n === 0) return null;
  const openConfirm = () => {
    if (!check.ok) {
      setProblem(COST_SUBMIT_REASON_TEXT[check.reason]);
      return;
    }
    setProblem(null);
    dialogRef.current?.showModal();
  };
  const changed = drafts.flatMap((d) =>
    dirtyFields(d).map((k) => ({ key: `${d.orderItemId}:${k}`, order: d.orderDisplayId, item: d.itemTitle, field: COST_FIELD_LABEL[k], from: d.baseline[k] || '—', to: d.current[k] || (k === 'currency' ? '—' : '0') })),
  );
  return (
    <>
      <div className='costs-unsaved' role='status' data-testid='costs-unsaved-bar'>
        <span>✎ 已改 <b>{n}</b> 格,還沒存</span>
        {problem !== null ? <span className='costs-unsaved-problem'>{problem}</span> : null}
        <button type='button' className='costs-bar-btn costs-bar-btn--ghost' onClick={() => { setProblem(null); api.reset(); }}>取消變更</button>
        <button type='button' className='costs-bar-btn' onClick={openConfirm}>確認全部</button>
      </div>
      <dialog ref={dialogRef} className='costs-confirm bg-card text-foreground m-auto w-[min(560px,calc(100vw-2rem))] rounded-xl border-0 p-0 backdrop:bg-[rgba(16,24,40,.45)]' aria-labelledby='costs-confirm-title'
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div className='px-5 py-[18px]'>
          <h3 id='costs-confirm-title' className='mb-1.5 text-base leading-[1.4] font-semibold'>要存這些成本嗎?</h3>
          <p className='text-(--fg-2) mb-2 text-[12.5px] leading-[1.4]'>存了就重算總計 TWD 與利潤,並進老闆月報。</p>
          <div className='max-h-[320px] overflow-auto rounded-lg border'>
            <table className='w-full text-[13px] leading-[1.4]'>
              <thead><tr><th className='px-2 py-1 text-left'>單</th><th className='px-2 py-1 text-left'>商品</th><th className='px-2 py-1 text-left'>欄</th><th className='px-2 py-1 text-left'>改成</th></tr></thead>
              <tbody>
                {changed.map((c) => (
                  <tr key={c.key} className='border-t'>
                    <td className='px-2 py-1 font-mono'>{c.order}</td>
                    <td className='px-2 py-1'>{c.item}</td>
                    <td className='px-2 py-1'>{c.field}</td>
                    <td className='px-2 py-1'><span className='text-(--fg-2)'>{c.from} → </span><b>{c.to}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 隱形送出:JSON 列 + return_to。server action 端再驗一次(parseCostRowsField / authorizeManagerMutation)。 */}
          <form ref={formRef} action={setOrderItemCostsAction} className='mt-3 flex justify-end gap-2'>
            <input type='hidden' name={COST_ROWS_FIELD} value={check.ok ? JSON.stringify(check.rows) : ''} />
            <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
            <button type='button' className='costs-btn' onClick={() => dialogRef.current?.close()}>回去再看</button>
            <button type='submit' className='costs-btn costs-btn--p'>確認({n} 格)</button>
          </form>
        </div>
      </dialog>
    </>
  );
}

/**
 * 🆕 A2-b:批次列「改成本(勾選的列)」的彈窗(稿 v22 `#bulk` 520:「套用到勾選的 N 列」、留空的欄不動、四格 + 幣值、[取消][確認])。
 * 殼用 `NextStepDialog`(網址驅動 `?costs_items=`),送出 = 同一支 `setOrderItemCostsAction`:每個品項一列,
 * 填了的欄套新值、留空的用它現在的值(沒設過 = 0 / 幣別必須至少有一邊給)。
 * `itemsJson` 是 server 算好的純字串(每項:id / 單號 / 品名 / 四個現值);金額不做算術。
 */
export function CostsBulkDialog({
  closeHref,
  returnTo,
  itemsJson,
  currencies,
}: {
  closeHref: string;
  returnTo: string;
  itemsJson: string;
  currencies: string;
}) {
  const items = useMemo(() => {
    try {
      const parsed = JSON.parse(itemsJson) as unknown;
      return Array.isArray(parsed)
        ? (parsed as Array<CostDraft['baseline'] & { orderItemId: string; orderDisplayId: string; itemTitle: string }>)
        : [];
    } catch {
      return [];
    }
  }, [itemsJson]);
  const [v, setV] = useState<CostDraftValues>({ costPrice: '', costShipping: '', costTax: '', currency: '' });
  const codes = currencies.split(',').filter((c) => c !== '');
  // 留空 = 不動:用該品項現在的值補齊;四格都留空 ⇒ 那一列沒改 ⇒ buildCostSubmit 會回 nothing
  const drafts: CostDraft[] = items.map((it) => ({
    orderItemId: it.orderItemId,
    orderDisplayId: it.orderDisplayId,
    itemTitle: it.itemTitle,
    baseline: { costPrice: it.costPrice, costShipping: it.costShipping, costTax: it.costTax, currency: it.currency },
    current: {
      costPrice: v.costPrice.trim() === '' ? it.costPrice : v.costPrice,
      costShipping: v.costShipping.trim() === '' ? it.costShipping : v.costShipping,
      costTax: v.costTax.trim() === '' ? it.costTax : v.costTax,
      currency: v.currency === '' ? it.currency : v.currency,
    },
  }));
  const check = buildCostSubmit(drafts);
  const field = (k: 'costPrice' | 'costShipping' | 'costTax', label: string) => (
    <label className='flex flex-col gap-[2px] text-[12px] leading-[1.4]'>
      {label}
      <input
        inputMode='decimal'
        value={v[k]}
        placeholder='不動'
        aria-label={label}
        onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))}
        className='border-input bg-background h-7 w-full rounded-md border px-[6px] text-[13.5px] leading-[1.4]'
      />
    </label>
  );
  return (
    <NextStepDialog title={`套用到勾選的 ${items.length} 列`} closeHref={closeHref} inlineCancel>
      <p className='text-(--fg-2) mb-2 text-[12.5px] leading-[1.4]'>
        留空的欄不動。原價 / 運費 / 稅金都填該筆的外幣金額,乘匯率之後才是台幣。匯率去「設定 › 匯率」改。
      </p>
      <form action={setOrderItemCostsAction} data-testid='costs-bulk-form'>
        <div className='mb-[10px] grid grid-cols-2 gap-2 sm:grid-cols-4'>
          {field('costPrice', '原價(整列 · 外幣)')}
          {field('costShipping', '運費(整列 · 外幣)')}
          {field('costTax', '稅金(每件 · 外幣)')}
          <label className='flex flex-col gap-[2px] text-[12px] leading-[1.4]'>
            幣值
            <select
              value={v.currency}
              aria-label='幣值'
              onChange={(e) => setV((p) => ({ ...p, currency: e.target.value }))}
              className='border-input bg-background h-7 w-full rounded-md border px-[6px] text-[13.5px] leading-[1.4]'
            >
              <option value=''>不動</option>
              {codes.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {!check.ok ? (
          <p className='text-(--fg-2) mb-2 text-[12.5px] leading-[1.4]'>{COST_SUBMIT_REASON_TEXT[check.reason]}</p>
        ) : (
          <p className='text-(--fg-2) mb-2 text-[12.5px] leading-[1.4]'>會改 {check.changed} 格({check.rows.length} 列)。</p>
        )}
        <input type='hidden' name={COST_ROWS_FIELD} value={check.ok ? JSON.stringify(check.rows) : ''} />
        <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
        <div className='next-step-ft mt-3'>
          <NextStepCancelButton />
          <button type='submit' disabled={!check.ok} className='costs-btn costs-btn--p disabled:opacity-50'>確認</button>
        </div>
      </form>
    </NextStepDialog>
  );
}
