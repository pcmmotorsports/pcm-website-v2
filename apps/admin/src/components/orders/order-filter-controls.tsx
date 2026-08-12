'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FilterOption } from '../../lib/shared/list-params';
import { buildListHref } from '../../lib/shared/list-params';
import {
  PAYMENT_STATUS_PARAM,
  FULFILLMENT_STATUS_PARAM,
  ORDER_SOURCE_PARAM,
  SHOW_UNPAID_CARD_PARAM,
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  ORDER_DATE_CUSTOM_KEY,
  ORDER_DATE_DEFAULT_KEY,
  type OrderDatePresetOption,
  SHOW_UNPAID_CARD_ON,
  PAYMENT_CHANNEL_PARAM,
} from '../../lib/orders/order-list-view';
import { MultiCheckFilter } from '../shared/multi-check-filter';
import { AutoApplySelect } from '../shared/auto-apply-select';

// order-filter-controls.tsx — 訂單篩選列互動核心(M-4a D-1b;值班台 MF-1 修復路)。
// 🔴 競態設計:各軸值收成**單一 client state、URL 全量由 state 導出**(buildListHref、page 恆回 1、
//   r 不帶=清 stale banner)——不讀 useSearchParams/window.location 當基底,RSC 往返(數百 ms)中
//   快速連勾/跨軸交錯也不會用 stale 快照互相蓋寫,checkbox/select 顯示同源自 state=無延遲窗回彈。
//   前提:/orders 的 query 全集=**九**個鍵(付款 / 出貨 / 來源 / 管道 /
//   **單號搜尋 order_no**,M-4b E10 A10c1 新增;**供應商單號 supplier_no**,A10c2 新增;
//   **show_unpaid_card**,M-4b 生命週期 L6 新增;**date_from / date_to**,#347-3c-1 新增)
//   +page+r,無其他要保留的鍵
//   🔴 **「七」是 #347-3c-1 之前的數字,已過期**:那一片把日期兩軸加進 `parseOrderListSearchParams`,
//     而本檔的 `href()` 是**第二個 URL builder**、不受 `buildOrderListHref` 的編譯期窮舉守門保護
//     ⇒ 不同步的話,分享一條帶日期的網址、使用者一動任何下拉,日期就靜默消失。
//     ⇒ 3c-1 已把兩軸接成 **state 透傳**(沒有可見控制項;下拉是 3c-2)。
//   (A9w2:原第六軸「商品狀態 workflow_status」隨九碼退場已下架 —— state、URL 參數、
//    MultiCheckFilter 三處同時移除;少移一處都會留下「改別軸就把它丟掉」或「丟不掉」的半殘狀態)
//   (新增鍵時須進 state 或此處明列 —— 漏了就是「改任一篩選就把該鍵丟掉」的 fail-open)。
// server prop 追上後以 prev-prop 比對同步(內容已收斂=無感;外部改 URL 走整頁載入=重掛)。
// 🔴 經銷價紅線:props 只收篩選值/label/enum,零價格/tier/PII 序列化
//    (A9w2 起連 `order_status_options` 的策展選項都不收了 —— 九碼軸已下架)。

type FilterState = {
  /** '' = 全部 */
  pay: string;
  ful: string;
  src: readonly string[];
  ch: readonly string[];
  /**
   * 建立日期範圍的**曆面日**(#347-3c-1;'' = 該側不限)。
   * 🔴 **本片沒有可見控制項** —— 兩欄只是「進得來、出得去」的透傳:
   *    不進 state 的鍵會在改任一其他篩選時被靜默丟掉,而網址是可分享的。
   *    可見的下拉(含「未選預設近半年」)是 3c-2。
   */
  dateFrom: string;
  dateTo: string;
  /**
   * #347-3c-2:選中的那一格(`m1`/`m3`/`m6`/`y1` 或 `custom`)。
   * 🔴 **它不進 URL** —— URL 上的真相是 `date_from`/`date_to` 兩個曆面日,這一格是**從那兩個值
   *    比對出來的**(`matchOrderDatePreset`)。若它也進 URL,就會出現「選項說近半年、日期是別的」
   *    這種兩個真相打架的狀態,而畫面只會顯示其中一個。
   */
  datePreset: string;
  /**
   * 「連刷卡未付款一起顯示」(M-4b 生命週期 L6;'' = 預設隱藏、'1' = 全顯示)。
   * 🔴 與其他軸同理**必須進 state**:不進 state 的鍵會在改任一其他篩選或翻頁時
   * 被靜默丟掉 ⇒ 勾還打著、列表卻已經變回隱藏 = 畫面與實際不一致。
   * ⚠️ #347-B(Q-347-B1=B)之後,這個勾是「刷卡未付款單被藏起來」的**唯一逃生口** ——
   *    打單號自動豁免那條路已隨兩個舊搜尋欄一起退場,查無時的提示會指向這裡。
   */
  showUnpaidCard: string;
};

function href(state: FilterState): string {
  return buildListHref(
    '/orders',
    [
      [PAYMENT_STATUS_PARAM, state.pay || undefined],
      [FULFILLMENT_STATUS_PARAM, state.ful || undefined],
      [ORDER_SOURCE_PARAM, state.src],
      [PAYMENT_CHANNEL_PARAM, state.ch],
      [SHOW_UNPAID_CARD_PARAM, state.showUnpaidCard || undefined],
      // 🔴 #347-3c-1:**純透傳、沒有可見控制項**(下拉在 3c-2)。放這裡的理由與上面那幾軸相同:
      //    漏列 = 改任一篩選就把日期丟掉,而網址是可分享的、URL 已經是可達的 producer。
      [DATE_FROM_PARAM, state.dateFrom || undefined],
      [DATE_TO_PARAM, state.dateTo || undefined],
    ],
    1,
  );
}

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function OrderFilterControls({
  datePresetOptions,
  paymentOptions,
  fulfillmentOptions,
  sourceOptions,
  channelOptions,
  initial,
}: {
  /** #347-3c-2:日期下拉的選項(server 已把每格的區間算好;client 不碰時鐘)。 */
  datePresetOptions: OrderDatePresetOption[];
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
    if (lastPushedKey === null || initialKey === lastPushedKey) {
      setState(initial);
      // ⚠️ #347-B:本檔原本還有兩個「打字中草稿」state(單號 / 供應商單號輸入框),
      //    連同那兩個搜尋框一起隨 Q-347-B1=B 退場 —— 現在所有軸都是「選了即時生效」,
      //    沒有草稿要保護,所以這裡不再需要逐框判斷是否重設。
    }
  }

  const apply = (next: FilterState) => {
    setState(next);
    setLastPushedKey(JSON.stringify(next));
    router.replace(href(next), { scroll: false });
  };

  /**
   * 日期下拉:選預設 ⇒ 直接套那一格**server 算好**的區間;選「自訂」⇒ 保留現值讓員工自己改。
   *
   * 🔴 選中的那一格與生效的區間**同一次 apply 寫進去**,不可能分岔 ——
   *    「畫面說近半年、實際篩別的期間」是這一軸最貴的壞法(員工會據此判斷「這段期間沒單」)。
   */
  /**
   * 自訂區間改一格。
   *
   * 🔴🔴 **兩格都空是歧義態,必須當場消掉**(R1 must-fix 1,審查者構造出來的真分岔):
   *    兩格皆空 ⇒ `href()` 產出裸 `/orders` ⇒ server 判定「沒帶日期」⇒ **重新套近半年**,
   *    而 client 的回音因為與 `lastPushedKey` 不等會被 prop-sync 拒絕採用
   *    ⇒ 畫面停在「自訂 + 兩格空白」(員工讀成不限期間)、列表實際篩近半年,而且**永不自癒**。
   *    那正是「找不到舊單 → 清空日期想看全部 → 看到 0 筆 → 判定沒這張單」。
   * ⇒ 處置:兩格都空的那一刻,**當場退回預設那一格並把日期補上**。
   *    員工會看到下拉跳回「近半年」—— 那是**看得見**的,而且是事實:
   *    本片沒有「不限期間」這個選項(plan §1-1 認列過的誠實代價;要看更早的就填一個很早的起日)。
   */
  const applyCustomDate = (patch: { dateFrom?: string; dateTo?: string }) => {
    const next = { ...state, ...patch };
    if (next.dateFrom === '' && next.dateTo === '') {
      const fallback = datePresetOptions.find((o) => o.key === ORDER_DATE_DEFAULT_KEY);
      if (fallback !== undefined) {
        apply({
          ...next,
          datePreset: fallback.key,
          dateFrom: fallback.fromYmd,
          dateTo: fallback.toYmd,
        });
        return;
      }
    }
    apply(next);
  };

  const applyDatePreset = (key: string) => {
    if (key === ORDER_DATE_CUSTOM_KEY) {
      apply({ ...state, datePreset: key });
      return;
    }
    const option = datePresetOptions.find((o) => o.key === key);
    // 🔴 找不到那一格 ⇒ 什麼都不做(不要靜默清掉日期):選項是 server 給的,
    //    對不上只可能是 server/client 不同步,那時「維持現況」比「悄悄變成不限期間」安全。
    if (option === undefined) return;
    apply({ ...state, datePreset: key, dateFrom: option.fromYmd, dateTo: option.toYmd });
  };

  return (
    <>
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
      {/* L6:預設隱藏刷卡未付款單;這個勾是唯一的打開方式(資料沒被刪、只是不列)。 */}
      <label className='flex items-center gap-2 text-sm' htmlFor='show-unpaid-card'>
        <input
          id='show-unpaid-card'
          type='checkbox'
          className='size-4'
          checked={state.showUnpaidCard === SHOW_UNPAID_CARD_ON}
          onChange={(e) =>
            apply({ ...state, showUnpaidCard: e.target.checked ? SHOW_UNPAID_CARD_ON : '' })
          }
        />
        顯示刷卡未付款(預設隱藏)
      </label>
      {/* 🔴🔴 **日期這一塊刻意排在最後**:本檔既有的多格測試用 `getAllByRole('combobox')[0]`
          **位置索引**抓付款下拉(不是用 label)⇒ 在前面插一個 `<select>` 會讓那些測試靜默改測
          別的控制項(實測:5 格當場紅,錯誤訊息還長得像「replace 沒被呼叫」而不是「抓錯元素」)。
          把新控制項排在最後 = 既有測試的意圖與目標都不動。
          ⚠️ 這是**遷就測試的排版決定**,誠實寫下來:視覺順序若要改成日期在前,
          得先把那幾格改成用 label 抓元素,不要只是搬 JSX。 */}
      {datePresetOptions.length > 0 && (
        <div className='flex flex-col gap-1'>
          <label htmlFor='order-date-preset' className='text-muted-foreground text-xs'>
            建立日期
          </label>
          <select
            id='order-date-preset'
            value={state.datePreset}
            onChange={(e) => applyDatePreset(e.target.value)}
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            {datePresetOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            {/* 🔴 **逃生口**:預設近半年會藏掉更早的單,沒有這一格員工就無路可走
                (plan §1-1 認列過的誠實代價 —— 要看更早的就自己給一個很早的起日)。 */}
            <option value={ORDER_DATE_CUSTOM_KEY}>自訂</option>
          </select>
        </div>
      )}

      {datePresetOptions.length > 0 && state.datePreset === ORDER_DATE_CUSTOM_KEY && (
        <div className='flex flex-col gap-1'>
          <label htmlFor='order-date-from' className='text-muted-foreground text-xs'>
            起日 / 迄日(含當天)
          </label>
          <div className='flex items-center gap-1'>
            <input
              id='order-date-from'
              type='date'
              value={state.dateFrom}
              onChange={(e) => applyCustomDate({ dateFrom: e.target.value })}
              aria-label='起日'
              className='border-input bg-background h-9 rounded-md border px-2 text-sm'
            />
            <span className='text-muted-foreground text-sm'>–</span>
            <input
              id='order-date-to'
              type='date'
              value={state.dateTo}
              onChange={(e) => applyCustomDate({ dateTo: e.target.value })}
              aria-label='迄日'
              className='border-input bg-background h-9 rounded-md border px-2 text-sm'
            />
          </div>
        </div>
      )}

    </>
  );
}
