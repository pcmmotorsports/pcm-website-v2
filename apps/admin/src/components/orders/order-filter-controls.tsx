'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FilterOption } from '../../lib/shared/list-params';
import { buildListHref } from '../../lib/shared/list-params';
import {
  PAYMENT_STATUS_PARAM,
  FULFILLMENT_STATUS_PARAM,
  ORDER_SOURCE_PARAM,
  PAYMENT_CHANNEL_PARAM,
  WORKFLOW_STATUS_PARAM,
} from '../../lib/orders/order-list-view';
import { MultiCheckFilter } from '../shared/multi-check-filter';
import { AutoApplySelect } from '../shared/auto-apply-select';

// order-filter-controls.tsx — 訂單篩選列互動核心(M-4a D-1b;值班台 MF-1 修復路)。
// 🔴 競態設計:五軸值收成**單一 client state、URL 全量由 state 導出**(buildListHref、page 恆回 1、
//   r 不帶=清 stale banner)——不讀 useSearchParams/window.location 當基底,RSC 往返(數百 ms)中
//   快速連勾/跨軸交錯也不會用 stale 快照互相蓋寫,checkbox/select 顯示同源自 state=無延遲窗回彈。
//   前提:/orders 的 query 全集=五篩選軸+page+r,無其他要保留的鍵(新增鍵時須進 state 或此處明列)。
// server prop 追上後以 prev-prop 比對同步(內容已收斂=無感;外部改 URL 走整頁載入=重掛)。
// 🔴 經銷價紅線:props 只收篩選值/label/enum/order_status_options 策展選項,零價格/tier/PII 序列化。

type FilterState = {
  /** 商品狀態已勾 URL 值(code 或 'unset' 哨兵) */
  wf: readonly string[];
  /** '' = 全部 */
  pay: string;
  ful: string;
  src: readonly string[];
  ch: readonly string[];
};

function href(state: FilterState): string {
  return buildListHref(
    '/orders',
    [
      [WORKFLOW_STATUS_PARAM, state.wf],
      [PAYMENT_STATUS_PARAM, state.pay || undefined],
      [FULFILLMENT_STATUS_PARAM, state.ful || undefined],
      [ORDER_SOURCE_PARAM, state.src],
      [PAYMENT_CHANNEL_PARAM, state.ch],
    ],
    1,
  );
}

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function OrderFilterControls({
  workflowOptions,
  paymentOptions,
  fulfillmentOptions,
  sourceOptions,
  channelOptions,
  initial,
}: {
  workflowOptions: FilterOption[];
  paymentOptions: FilterOption[];
  fulfillmentOptions: FilterOption[];
  sourceOptions: FilterOption[];
  channelOptions: FilterOption[];
  initial: FilterState;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  // server prop 變動時的採用規則(值班台 R2 nit-1):只採用「非我方推送期的外部值」
  // (lastPushedKey===null)或「我方最終推送的收斂回音」(initialKey===lastPushedKey、=no-op);
  // 被超越舊導航若仍被 commit,其舊回音一律不採,避免瞬窗蓋掉本地更新值。
  // 識別以內容序列化比對(非物件 identity);back/外部導航=整頁重掛、lastPushedKey 歸 null。
  const initialKey = JSON.stringify(initial);
  const [prevKey, setPrevKey] = useState(initialKey);
  const [lastPushedKey, setLastPushedKey] = useState<string | null>(null);
  if (prevKey !== initialKey) {
    setPrevKey(initialKey);
    if (lastPushedKey === null || initialKey === lastPushedKey) setState(initial);
  }

  const apply = (next: FilterState) => {
    setState(next);
    setLastPushedKey(JSON.stringify(next));
    router.replace(href(next), { scroll: false });
  };

  return (
    <>
      <MultiCheckFilter
        label='商品狀態'
        options={workflowOptions}
        selected={state.wf}
        onToggle={(v) => apply({ ...state, wf: toggled(state.wf, v) })}
      />
      <AutoApplySelect
        label='付款狀態'
        value={state.pay}
        options={paymentOptions}
        onChange={(v) => apply({ ...state, pay: v })}
      />
      <AutoApplySelect
        label='出貨狀態'
        value={state.ful}
        options={fulfillmentOptions}
        onChange={(v) => apply({ ...state, ful: v })}
      />
      <MultiCheckFilter
        label='來源'
        options={sourceOptions}
        selected={state.src}
        onToggle={(v) => apply({ ...state, src: toggled(state.src, v) })}
      />
      <MultiCheckFilter
        label='管道'
        options={channelOptions}
        selected={state.ch}
        onToggle={(v) => apply({ ...state, ch: toggled(state.ch, v) })}
      />
    </>
  );
}
