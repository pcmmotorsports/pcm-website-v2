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
  workflowStatusSelectedValues,
  summarizeOrderItemWorkflow,
} from './order-list-view';

describe('parseOrderListSearchParams — 白名單守門', () => {
  it('合法四軸值 → filter 帶入(來源/管道 D-1b 多勾選=陣列);page 解析', () => {
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
      orderSources: ['manual_line'],
      paymentChannels: ['bank_transfer'],
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
      orderSources: undefined,
      paymentChannels: undefined,
    });
  });

  it('單值軸 string[] 取首個;多勾選軸收全部合法值+去重、非法值剔除', () => {
    const { filter } = parseOrderListSearchParams({
      payment_status: ['unpaid', 'paid'],
      order_source: ['web', 'manual_line', 'web', 'HACK'],
      payment_channel: ['tappay', 'paypal', 'cash'],
    });
    expect(filter.paymentStatus).toBe('unpaid');
    expect(filter.orderSources).toEqual(['web', 'manual_line']);
    expect(filter.paymentChannels).toEqual(['tappay', 'cash']);
  });

  it('缺 searchParams → 全 undefined + page 1', () => {
    const { filter, page } = parseOrderListSearchParams({});
    expect(filter).toEqual({
      paymentStatus: undefined,
      fulfillmentStatus: undefined,
      orderSources: undefined,
      paymentChannels: undefined,
    });
    expect(page).toBe(1);
  });
});

describe('parseOrderListSearchParams — workflow_status(動態詞彙、形狀守門;D-1b 多勾選)', () => {
  it('合法 code slug → 原樣帶入(單值=單元素陣列)', () => {
    const { filter } = parseOrderListSearchParams({ workflow_status: 'received_confirmed' });
    expect(filter.workflowStatuses).toEqual(['received_confirmed']);
  });

  it('unset 哨兵 → null 元素(未設定;可與 code 混勾)', () => {
    expect(parseOrderListSearchParams({ workflow_status: 'unset' }).filter.workflowStatuses).toEqual(
      [null],
    );
    expect(
      parseOrderListSearchParams({ workflow_status: ['paid_wait', 'unset'] }).filter
        .workflowStatuses,
    ).toEqual(['paid_wait', null]);
  });

  it('多值:合法值保序去重、非法形狀逐值剔除;全非法/缺 → undefined(不篩、注入不透傳)', () => {
    expect(
      parseOrderListSearchParams({ workflow_status: ['a_1', 'HACK', 'a_1', 'b_2'] }).filter
        .workflowStatuses,
    ).toEqual(['a_1', 'b_2']);
    for (const bad of ['HACK', 'a b', 'x; DROP', 'é', 'a'.repeat(65), '']) {
      expect(
        parseOrderListSearchParams({ workflow_status: bad }).filter.workflowStatuses,
      ).toBe(undefined);
    }
    expect(
      parseOrderListSearchParams({ workflow_status: ['HACK', ''] }).filter.workflowStatuses,
    ).toBe(undefined);
  });
});

describe('buildOrderListHref — 訂單連結(保留篩選、page=1 省略)', () => {
  it('無篩選 + page 1 → /orders(乾淨)', () => {
    expect(buildOrderListHref({}, 1)).toBe('/orders');
  });

  it('帶篩選 + page>1 → 保留篩選 + page;多勾選=同鍵重複 param', () => {
    const href = buildOrderListHref(
      { paymentStatus: 'paid', orderSources: ['web', 'manual_line'] },
      2,
    );
    expect(href).toContain('/orders?');
    expect(href).toContain('payment_status=paid');
    expect(href).toContain('order_source=web&order_source=manual_line');
    expect(href).toContain('page=2');
  });

  it('page 1 省略 page 參數(但保留篩選)', () => {
    const href = buildOrderListHref({ fulfillmentStatus: 'shipped' }, 1);
    expect(href).toContain('fulfillment_status=shipped');
    expect(href).not.toContain('page=');
  });

  it('workflowStatuses:code 原樣、null → unset 哨兵、混勾=重複 param、undefined → 不出現', () => {
    expect(buildOrderListHref({ workflowStatuses: ['shipped_done'] }, 2)).toContain(
      'workflow_status=shipped_done',
    );
    expect(buildOrderListHref({ workflowStatuses: [null] }, 2)).toContain('workflow_status=unset');
    expect(buildOrderListHref({ workflowStatuses: ['paid_wait', null] }, 2)).toContain(
      'workflow_status=paid_wait&workflow_status=unset',
    );
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

describe('workflowStatusFilterOptions / workflowStatusSelectedValues', () => {
  it('篩選下拉 = active 選項(依傳入序)+ 未設定哨兵殿後;停用選項不入列', () => {
    expect(workflowStatusFilterOptions(OPTIONS)).toEqual([
      { value: 'received_confirmed', label: '已收已定' },
      { value: 'unpaid_shipped', label: '未收出貨' },
      { value: WORKFLOW_STATUS_UNSET_VALUE, label: '未設定' },
    ]);
  });

  it('已勾值含停用/未知 code → 各補回顯項(不靜默清篩選);active code/null → 不加項', () => {
    const withOrphans = workflowStatusFilterOptions(OPTIONS, ['retired_code', 'ghost_code']);
    expect(withOrphans).toContainEqual({ value: 'retired_code', label: '停用中(已停用)' });
    expect(withOrphans).toContainEqual({ value: 'ghost_code', label: 'ghost_code' });
    expect(workflowStatusFilterOptions(OPTIONS, ['received_confirmed'])).toHaveLength(3);
    expect(workflowStatusFilterOptions(OPTIONS, [null])).toHaveLength(3);
  });

  it('selectedValues:undefined → [] / null 元素 → unset / code 原樣保序', () => {
    expect(workflowStatusSelectedValues(undefined)).toEqual([]);
    expect(workflowStatusSelectedValues([null])).toEqual([WORKFLOW_STATUS_UNSET_VALUE]);
    expect(workflowStatusSelectedValues(['shipped_done', null])).toEqual([
      'shipped_done',
      WORKFLOW_STATUS_UNSET_VALUE,
    ]);
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

// ── summarizeOrderItemWorkflow — 整單彙總(M-4a D-2;拍板 Q-A=A 全同→該值、混合→多狀態)──

describe('summarizeOrderItemWorkflow — 整單狀態彙總', () => {
  it('全同值 → uniform 該值;全 NULL → uniform null(未設定)', () => {
    expect(summarizeOrderItemWorkflow(['shipped_done', 'shipped_done'])).toEqual({
      kind: 'uniform',
      code: 'shipped_done',
    });
    expect(summarizeOrderItemWorkflow([null, null])).toEqual({ kind: 'uniform', code: null });
    expect(summarizeOrderItemWorkflow(['cancelled'])).toEqual({ kind: 'uniform', code: 'cancelled' });
  });

  it('任一分歧(含 NULL 與 code 混)→ mixed', () => {
    expect(summarizeOrderItemWorkflow(['shipped_done', 'cancelled'])).toEqual({ kind: 'mixed' });
    expect(summarizeOrderItemWorkflow(['shipped_done', null])).toEqual({ kind: 'mixed' });
    expect(summarizeOrderItemWorkflow([null, 'shipped_done', null])).toEqual({ kind: 'mixed' });
  });

  it('空陣列(理論不發生)→ uniform null 兜底', () => {
    expect(summarizeOrderItemWorkflow([])).toEqual({ kind: 'uniform', code: null });
  });
});
