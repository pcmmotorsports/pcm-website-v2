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
  ORDER_NUMBER_PARAM,
} from '../../lib/orders/order-list-view';
import { MultiCheckFilter } from '../shared/multi-check-filter';
import { AutoApplySelect } from '../shared/auto-apply-select';

// order-filter-controls.tsx — 訂單篩選列互動核心(M-4a D-1b;值班台 MF-1 修復路)。
// 🔴 競態設計:各軸值收成**單一 client state、URL 全量由 state 導出**(buildListHref、page 恆回 1、
//   r 不帶=清 stale banner)——不讀 useSearchParams/window.location 當基底,RSC 往返(數百 ms)中
//   快速連勾/跨軸交錯也不會用 stale 快照互相蓋寫,checkbox/select 顯示同源自 state=無延遲窗回彈。
//   前提:/orders 的 query 全集=**六**篩選軸(商品狀態 / 付款 / 出貨 / 來源 / 管道 /
//   **單號搜尋 order_no**,M-4b E10 A10c1 新增)+page+r,無其他要保留的鍵
//   (新增鍵時須進 state 或此處明列 —— 漏了就是「改任一篩選就把該鍵丟掉」的 fail-open)。
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
  /**
   * 訂單編號搜尋詞(M-4b E10 A10c1;'' = 不搜尋)。
   * 🔴 **必須進 state**:`href()` 是從 state 全量導出 URL 的,不進 state 的鍵會在
   * 「改任一其他篩選 / 翻頁」時被靜默丟掉 ⇒ 搜尋詞消失、列表變回全部訂單(fail-open)。
   * 本檔頂部的前提註解早就寫死了這條規則。
   */
  no: string;
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
      [ORDER_NUMBER_PARAM, state.no || undefined],
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
  orderNumberSearchEnabled = false,
}: {
  workflowOptions: FilterOption[];
  paymentOptions: FilterOption[];
  fulfillmentOptions: FilterOption[];
  sourceOptions: FilterOption[];
  channelOptions: FilterOption[];
  initial: FilterState;
  /**
   * 單號搜尋是否啟用(M-4b E10 A10c1;§7.1 逐批啟用閘)。
   * 🔴 預設 false —— DB 前置(D0 的 `orders.legacy_display_id`)未 apply 前不得開。
   */
  orderNumberSearchEnabled?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  // 搜尋框是「打字中」的暫存值,跟其他軸不同:其他軸是選了即時生效,
  // 單號要按 Enter 才送出(每打一個字就發一次查詢既吵又慢)。
  const [draftNo, setDraftNo] = useState(initial.no);
  // server prop 變動時的採用規則(值班台 R2 nit-1):只採用「非我方推送期的外部值」
  // (lastPushedKey===null)或「我方最終推送的收斂回音」(initialKey===lastPushedKey、=no-op);
  // 被超越舊導航若仍被 commit,其舊回音一律不採,避免瞬窗蓋掉本地更新值。
  // 識別以內容序列化比對(非物件 identity);back/外部導航=整頁重掛、lastPushedKey 歸 null。
  const initialKey = JSON.stringify(initial);
  const [prevKey, setPrevKey] = useState(initialKey);
  const [lastPushedKey, setLastPushedKey] = useState<string | null>(null);
  if (prevKey !== initialKey) {
    setPrevKey(initialKey);
    if (lastPushedKey === null || initialKey === lastPushedKey) {
      setState(initial);
      // 🔴 只在「外部真的換了單號」時才重設輸入框。
      //    無條件 setDraftNo 會踩到這個窗:先改別軸(replace 在途)→ 使用者邊等邊打字 →
      //    收斂回音進來被採用 → 打到一半的字被清空。
      if (initial.no !== state.no) setDraftNo(initial.no);
    }
  }

  const apply = (next: FilterState) => {
    setState(next);
    setLastPushedKey(JSON.stringify(next));
    router.replace(href(next), { scroll: false });
  };

  return (
    <>
      {orderNumberSearchEnabled && (
        <form
          className='flex flex-col gap-1'
          onSubmit={(e) => {
            e.preventDefault();
            apply({ ...state, no: draftNo.trim() });
          }}
        >
          <label
            htmlFor='order-number-search'
            className='text-muted-foreground text-xs font-medium'
          >
            訂單編號
          </label>
          {/* 🔴 刻意不給 name:form 無 action,hydration 完成前按 Enter 會走原生 GET,
              而原生送出只帶 form 內的欄位 ⇒ 其他五軸篩選會被清掉。沒有 name 就送不出東西。
              🔴 用 type='text' 不用 type='search':原生的 × 與 Esc 只觸發 onChange 清掉草稿、
              不會送出,使用者會以為搜尋已取消,實際列表還篩著同一張單。 */}
          <input
            id='order-number-search'
            type='text'
            autoComplete='off'
            value={draftNo}
            onChange={(e) => setDraftNo(e.target.value)}
            placeholder='輸入單號後按 Enter'
            aria-describedby='order-number-search-hint'
            className='border-input bg-background h-9 w-44 rounded-md border px-3 text-sm'
          />
          <span id='order-number-search-hint' className='sr-only'>
            可輸入新單號或改號前的舊單號
          </span>
          {/* form 內若沒有 submit 控制項,只有「恰好一個欄位」時 Enter 才隱式送出;
              日後多加一個欄位就會靜默失效。這顆按鈕同時給觸控與螢幕閱讀器一個明確入口。 */}
          <button type='submit' className='sr-only'>
            搜尋訂單編號
          </button>
        </form>
      )}
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
