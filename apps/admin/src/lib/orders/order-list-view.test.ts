// order-list-view.test.ts — 訂單列表顯示層純函式單測(M-4a 訂單線第一片)。
// 訂單專屬:searchParams 白名單守門 / buildOrderListHref / 標籤覆蓋 / 格式化。
// 通用分頁數學 / parsePage 的測試在 ../shared/list-params.test.ts。

import { describe, it, expect } from 'vitest';
import type { OrderStatusOption } from '@pcm/domain';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  formatOrderDate,
  formatOrderAmount,
  ORDERS_PAGE_SIZE,
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  PAYMENT_STATUS_VALUES,
  FULFILLMENT_STATUS_VALUES,
  ORDER_SOURCE_VALUES,
  PAYMENT_CHANNEL_VALUES,
  WORKFLOW_STATUS_UNSET_VALUE,
  workflowStatusBadge,
  indexOrderStatusOptions,
  workflowStatusFilterOptions,
  workflowStatusSelectValue,
} from './order-list-view';

describe('parseOrderListSearchParams — 白名單守門', () => {
  it('合法四軸值 → filter 帶入;page 解析', () => {
    const { filter, page } = parseOrderListSearchParams({
      payment_status: 'paid',
      fulfillment_status: 'shipped',
      order_source: 'manual_line',
      payment_channel: 'bank_transfer',
      page: '3',
    });
    expect(filter).toEqual({
      paymentStatus: 'paid',
      fulfillmentStatus: 'shipped',
      orderSource: 'manual_line',
      paymentChannel: 'bank_transfer',
    });
    expect(page).toBe(3);
  });

  it('非法篩選值一律忽略(等同不篩選、注入不透傳)', () => {
    const { filter } = parseOrderListSearchParams({
      payment_status: 'HACK',
      fulfillment_status: '',
      order_source: 'web; DROP',
      payment_channel: 'paypal',
    });
    expect(filter).toEqual({
      paymentStatus: undefined,
      fulfillmentStatus: undefined,
      orderSource: undefined,
      paymentChannel: undefined,
    });
  });

  it('string[] 值取首個', () => {
    const { filter } = parseOrderListSearchParams({ payment_status: ['unpaid', 'paid'] });
    expect(filter.paymentStatus).toBe('unpaid');
  });

  it('缺 searchParams → 全 undefined + page 1', () => {
    const { filter, page } = parseOrderListSearchParams({});
    expect(filter).toEqual({
      paymentStatus: undefined,
      fulfillmentStatus: undefined,
      orderSource: undefined,
      paymentChannel: undefined,
    });
    expect(page).toBe(1);
  });
});

describe('parseOrderListSearchParams — workflow_status(動態詞彙、形狀守門)', () => {
  it('合法 code slug → 原樣帶入', () => {
    const { filter } = parseOrderListSearchParams({ workflow_status: 'received_confirmed' });
    expect(filter.workflowStatus).toBe('received_confirmed');
  });

  it('unset 哨兵 → null(只看未設定)', () => {
    const { filter } = parseOrderListSearchParams({ workflow_status: 'unset' });
    expect(filter.workflowStatus).toBeNull();
  });

  it('非法形狀(大寫/空白/注入/過長/空字串/陣列)→ undefined(不篩、注入不透傳)', () => {
    for (const bad of ['HACK', 'a b', 'x; DROP', 'é', 'a'.repeat(65), '']) {
      expect(parseOrderListSearchParams({ workflow_status: bad }).filter.workflowStatus).toBe(
        undefined,
      );
    }
    expect(
      parseOrderListSearchParams({ workflow_status: ['a', 'b'] }).filter.workflowStatus,
    ).toBe(undefined);
  });
});

describe('buildOrderListHref — 訂單連結(保留篩選、page=1 省略)', () => {
  it('無篩選 + page 1 → /orders(乾淨)', () => {
    expect(buildOrderListHref({}, 1)).toBe('/orders');
  });

  it('帶篩選 + page>1 → 保留篩選 + page', () => {
    const href = buildOrderListHref({ paymentStatus: 'paid', orderSource: 'web' }, 2);
    expect(href).toContain('/orders?');
    expect(href).toContain('payment_status=paid');
    expect(href).toContain('order_source=web');
    expect(href).toContain('page=2');
  });

  it('page 1 省略 page 參數(但保留篩選)', () => {
    const href = buildOrderListHref({ fulfillmentStatus: 'shipped' }, 1);
    expect(href).toContain('fulfillment_status=shipped');
    expect(href).not.toContain('page=');
  });

  it('workflowStatus:code 原樣、null → unset 哨兵、undefined → 不出現', () => {
    expect(buildOrderListHref({ workflowStatus: 'shipped_done' }, 2)).toContain(
      'workflow_status=shipped_done',
    );
    expect(buildOrderListHref({ workflowStatus: null }, 2)).toContain('workflow_status=unset');
    expect(buildOrderListHref({}, 2)).not.toContain('workflow_status');
  });
});

// ── workflow_status badge 檢視模型 + 篩選選項(M-4a Slice A)──

const OPTIONS: OrderStatusOption[] = [
  { code: 'received_confirmed', label: '已收已定', color: '#FBE4A6', textColor: 'dark', sortOrder: 10, isActive: true },
  { code: 'unpaid_shipped', label: '未收出貨', color: '#A52A2A', textColor: 'light', sortOrder: 50, isActive: true },
  { code: 'retired_code', label: '停用中', color: '#CCCCCC', textColor: 'dark', sortOrder: 99, isActive: false },
];

describe('workflowStatusBadge — NULL / 命中 / 停用 / 未知 code 兜底', () => {
  const byCode = indexOrderStatusOptions(OPTIONS);

  it('NULL → 「未設定」中性(known=false)', () => {
    expect(workflowStatusBadge(null, byCode)).toEqual({
      label: '未設定',
      color: '',
      textColor: 'dark',
      known: false,
    });
  });

  it('命中選項 → DB label/color/textColor(known=true)', () => {
    expect(workflowStatusBadge('unpaid_shipped', byCode)).toEqual({
      label: '未收出貨',
      color: '#A52A2A',
      textColor: 'light',
      known: true,
    });
  });

  it('停用選項(is_active=false)仍解析 label/color(soft-delete:舊單不變裸 code)', () => {
    expect(workflowStatusBadge('retired_code', byCode).label).toBe('停用中');
    expect(workflowStatusBadge('retired_code', byCode).known).toBe(true);
  });

  it('查無 code → 原樣顯示 code 的中性兜底(誠實、不編造 label)', () => {
    expect(workflowStatusBadge('ghost_code', byCode)).toEqual({
      label: 'ghost_code',
      color: '',
      textColor: 'dark',
      known: false,
    });
  });
});

describe('workflowStatusFilterOptions / workflowStatusSelectValue', () => {
  it('篩選下拉 = active 選項(依傳入序)+ 未設定哨兵殿後;停用選項不入列', () => {
    expect(workflowStatusFilterOptions(OPTIONS)).toEqual([
      { value: 'received_confirmed', label: '已收已定' },
      { value: 'unpaid_shipped', label: '未收出貨' },
      { value: WORKFLOW_STATUS_UNSET_VALUE, label: '未設定' },
    ]);
  });

  it('current 為停用/未知 code → 補回顯項(不靜默清篩選);current 為 active code/null → 不加項', () => {
    expect(workflowStatusFilterOptions(OPTIONS, 'retired_code')).toContainEqual({
      value: 'retired_code',
      label: '停用中(已停用)',
    });
    expect(workflowStatusFilterOptions(OPTIONS, 'ghost_code')).toContainEqual({
      value: 'ghost_code',
      label: 'ghost_code',
    });
    expect(workflowStatusFilterOptions(OPTIONS, 'received_confirmed')).toHaveLength(3);
    expect(workflowStatusFilterOptions(OPTIONS, null)).toHaveLength(3);
  });

  it('selectValue:undefined → undefined(全部)/ null → unset / code 原樣', () => {
    expect(workflowStatusSelectValue(undefined)).toBe(undefined);
    expect(workflowStatusSelectValue(null)).toBe(WORKFLOW_STATUS_UNSET_VALUE);
    expect(workflowStatusSelectValue('shipped_done')).toBe('shipped_done');
  });
});

describe('標籤覆蓋 — 每個 enum 值皆有中文標籤', () => {
  it('付款狀態', () => {
    for (const v of PAYMENT_STATUS_VALUES) expect(PAYMENT_STATUS_LABEL[v]).toBeTruthy();
  });
  it('出貨狀態', () => {
    for (const v of FULFILLMENT_STATUS_VALUES) expect(FULFILLMENT_STATUS_LABEL[v]).toBeTruthy();
  });
  it('來源', () => {
    for (const v of ORDER_SOURCE_VALUES) expect(ORDER_SOURCE_LABEL[v]).toBeTruthy();
  });
  it('管道', () => {
    for (const v of PAYMENT_CHANNEL_VALUES) expect(PAYMENT_CHANNEL_LABEL[v]).toBeTruthy();
  });
});

describe('格式化', () => {
  it('formatOrderDate:UTC timestamptz → Asia/Taipei YYYY-MM-DD(避 off-by-one)', () => {
    expect(formatOrderDate('2099-04-15T16:30:00Z')).toBe('2099-04-16');
  });

  it('formatOrderAmount:整數元位千分位(非分、不除 100)', () => {
    expect(formatOrderAmount(5200)).toBe('5,200');
    expect(formatOrderAmount(0)).toBe('0');
    expect(formatOrderAmount(1234567)).toBe('1,234,567');
  });

  it('ORDERS_PAGE_SIZE = 20', () => {
    expect(ORDERS_PAGE_SIZE).toBe(20);
  });
});
