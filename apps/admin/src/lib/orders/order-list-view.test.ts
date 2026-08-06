// order-list-view.test.ts — 訂單列表顯示層純函式單測(M-4a 訂單線第一片)。
// 訂單專屬:searchParams 白名單守門 / buildOrderListHref / 標籤覆蓋 / 格式化。
// 通用分頁數學 / parsePage 的測試在 ../shared/list-params.test.ts。

import { describe, it, expect } from 'vitest';
import type { AdminOrderFilter } from '@pcm/domain';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  formatOrderDate,
  formatOrderAmount,
  formatOrderItemVehicle,
  ORDERS_PAGE_SIZE,
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  PAYMENT_STATUS_VALUES,
  FULFILLMENT_STATUS_VALUES,
  ORDER_SOURCE_VALUES,
  PAYMENT_CHANNEL_VALUES,
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

describe('parseOrderListSearchParams — A9w2 九碼篩選下架', () => {
  // 🔴 原本這裡有三條「形狀守門」測試(合法 slug / unset 哨兵 / 逐值剔除注入),
  //    隨 `workflow_status` 查詢鍵下架一併移除。留下這一條是因為**下架不等於自動安全**:
  //    白名單解析器對未知鍵本來就沉默,萬一有人把解析加回來(或別的鍵誤讀那個 param),
  //    沒有這條就沒有任何測試看得見。
  it('🔴 URL 仍帶 ?workflow_status= 時整個被忽略,不得回到 filter 上', () => {
    const { filter } = parseOrderListSearchParams({
      workflow_status: ['received_confirmed', 'unset'],
      payment_status: 'paid',
    });
    expect('workflowStatuses' in filter).toBe(false);
    expect(filter.paymentStatus).toBe('paid'); // 其餘軸不受影響
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

  it('🔴 A9w2:即使 filter 上還掛著 workflowStatuses,連結也不得再帶那個鍵', () => {
    // A9w3 已把該欄從 `AdminOrderFilter` 型別移除 ⇒ 這裡改用繞型別的方式餵。量的事沒變:
    // 舊呼叫端(或反序列化回來的舊狀態)帶著它時,href 建構不得讀它 —— 否則翻頁與 returnTo
    // 會把死參數一路傳下去。
    const href = buildOrderListHref(
      { workflowStatuses: ['shipped_done', null], paymentStatus: 'paid' } as AdminOrderFilter,
      2,
    );
    expect(href).not.toContain('workflow_status');
    expect(href).toContain('payment_status=paid');
  });
});

describe('標籤覆蓋 — 每個 enum 值皆有中文標籤', () => {
  it('付款狀態', () => {
    for (const v of PAYMENT_STATUS_VALUES) expect(PAYMENT_STATUS_LABEL[v]).toBeTruthy();
  });

  // 🔴 上一條從 PAYMENT_STATUS_VALUES 迴圈衍生 ⇒ 陣列漏加值時它**照樣全綠**(假綠:
  //    少一個元素既不是型別錯誤、也不會讓迴圈失敗)。本條改用**獨立硬編碼期望**,
  //    與該陣列無衍生關係 ⇒ PaymentStatus 加值而忘了同步 PAYMENT_STATUS_VALUES 時會轉紅。
  //    (M-3 RF2a 加 partiallyRefunded 時補;plan §9.2 M6 的殺手測試。)
  it('付款狀態 — 值域獨立斷言(不從 PAYMENT_STATUS_VALUES 衍生)', () => {
    expect(PAYMENT_STATUS_VALUES).toHaveLength(5);
    expect([...PAYMENT_STATUS_VALUES].sort()).toEqual([
      'paid',
      'partiallyPaid',
      'partiallyRefunded',
      'refunded',
      'unpaid',
    ]);
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

describe('formatOrderItemVehicle（V-3b 年份廠牌車種欄）', () => {
  it('dict → 「年 品牌 車型」', () => {
    expect(formatOrderItemVehicle({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' }))
      .toBe('2021 Yamaha MT-09 SP');
  });

  it('dict 無年份 → 「品牌 車型」', () => {
    expect(formatOrderItemVehicle({ kind: 'dict', brand: 'Honda', model: 'CB650R', source: 'garage' }))
      .toBe('Honda CB650R');
  });

  it('free → 「年 raw」', () => {
    expect(formatOrderItemVehicle({ kind: 'free', raw: '我的老車', year: 2005, source: 'freetext' }))
      .toBe('2005 我的老車');
  });

  it('null(未帶車款)→ null(顯示端兜「—」)', () => {
    expect(formatOrderItemVehicle(null)).toBeNull();
  });
});

// ── M-4b E10 A10c1:單號搜尋參數 ────────────────────────────────────────────
describe('parseOrderListSearchParams — A10c1 單號搜尋(order_no)', () => {
  const on = { orderNumberSearchEnabled: true };

  it('🔴 flag 未開 → 整個不解析(D0 未 apply 時打這條 filter 會 42703、整頁掛掉)', () => {
    const { filter } = parseOrderListSearchParams({ order_no: 'YWP3PC' });
    expect(filter.orderNumber).toBeUndefined();
  });

  it('flag 開啟 + 合法新格式 → 正規化後帶入', () => {
    const { filter } = parseOrderListSearchParams({ order_no: 'ywp3pc' }, on);
    expect(filter.orderNumber).toBe('YWP3PC');
  });

  it('flag 開啟 + 合法舊格式 → 帶入(改號後舊號仍可查)', () => {
    const { filter } = parseOrderListSearchParams({ order_no: ' pcm-2026-0104 ' }, on);
    expect(filter.orderNumber).toBe('PCM-2026-0104');
  });

  it('缺參數 / 空字串 → undefined(不篩選)', () => {
    expect(parseOrderListSearchParams({}, on).filter.orderNumber).toBeUndefined();
    expect(parseOrderListSearchParams({ order_no: '   ' }, on).filter.orderNumber).toBeUndefined();
  });

  it('🔴 格式不符不得吞成 undefined —— 吞掉就變成「打錯字 = 列出全部訂單」的 fail-open', () => {
    const { filter } = parseOrderListSearchParams({ order_no: 'YWP3P0' }, on);
    expect(filter.orderNumber).toBe('YWP3P0'); // 原樣往下傳,adapter 端 fail-closed 回零筆
  });

  it('🔴 超長輸入被截斷,不把上萬字帶進 filter 與後續 URL', () => {
    const huge = `PCM-2026-${'9'.repeat(5000)}`;
    const { filter } = parseOrderListSearchParams({ order_no: huge }, on);
    expect(filter.orderNumber).toBeDefined();
    expect(filter.orderNumber?.length).toBeLessThanOrEqual(32);
  });

  it('同鍵重複 param 取第一個(URL 被手動塞多值時行為明確)', () => {
    const { filter } = parseOrderListSearchParams({ order_no: ['YWP3PC', 'BKPR5M'] }, on);
    expect(filter.orderNumber).toBe('YWP3PC');
  });
});

describe('buildOrderListHref — A10c1 單號搜尋要跟著翻頁與回跳走', () => {
  it('🔴 帶單號時 href 必須保留 order_no(漏帶 = 翻第 2 頁就變回全部訂單)', () => {
    const href = buildOrderListHref({ orderNumber: 'YWP3PC' }, 2);
    expect(href).toContain('order_no=YWP3PC');
    expect(href).toContain('page=2');
  });

  it('單號與其他篩選並存時兩者都在', () => {
    const href = buildOrderListHref({ orderNumber: 'PCM-2026-0104', paymentStatus: 'paid' }, 1);
    expect(href).toContain('order_no=PCM-2026-0104');
    expect(href).toContain('payment_status=paid');
  });

  it('無單號 → href 不出現 order_no', () => {
    expect(buildOrderListHref({ paymentStatus: 'paid' }, 1)).not.toContain('order_no');
  });
});
