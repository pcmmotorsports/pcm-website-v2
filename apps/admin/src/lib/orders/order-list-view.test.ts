// order-list-view.test.ts — 訂單列表顯示層純函式單測(M-4a 訂單線第一片)。
// 訂單專屬:searchParams 白名單守門 / buildOrderListHref / 標籤覆蓋 / 格式化。
// 通用分頁數學 / parsePage 的測試在 ../shared/list-params.test.ts。

import { describe, it, expect } from 'vitest';
import type { AdminOrderFilter } from '@pcm/domain';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  ORDER_DENSITY_DEFAULT,
  ORDER_DENSITY_PARAM,
  ORDER_DENSITY_VALUES,
  buildOrderDatePresetOptions,
  ORDER_DATE_DEFAULT_KEY,
  formatOrderListDate,
  formatOrderAmount,
  formatOrderItemVehicle,
  ORDERS_PAGE_SIZE,
  PAYMENT_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  PAYMENT_STATUS_VALUES,
  FULFILLMENT_STATUS_VALUES,
  ORDER_SOURCE_VALUES,
  PAYMENT_CHANNEL_VALUES,
  SHOW_UNPAID_CARD_PARAM,
} from './order-list-view';

/**
 * L3 片4:`buildOrderListHref` 的顯示設定參數是**必填**(主視窗 E-424 裁)。
 * 🔴 本檔多數格子與密度無關 ⇒ 統一給預設值,讓那些格子的斷言維持原意;
 *    密度本身的三條守門在下方自己的 describe 裡,**不靠這個常數**。
 */
const DEN = { density: ORDER_DENSITY_DEFAULT } as const;

describe('parseOrderListSearchParams — 白名單守門', () => {
  it('合法四軸值 → filter 帶入(來源/管道 D-1b 多勾選=陣列);page 解析', () => {
    const { filter, page } = parseOrderListSearchParams({
      payment_status: 'paid',
      goods_axis: 'shipped',
      order_source: 'manual_line',
      payment_channel: 'bank_transfer',
      page: '3',
    });
    expect(filter).toEqual({
      paymentStatus: 'paid',
      goodsAxes: ['shipped'],
      orderSources: ['manual_line'],
      paymentChannels: ['bank_transfer'],
      // L6:filter 是整包比對 ⇒ 新增鍵一定要在這裡出現(這正是它的價值:
      // 有人新增 filter 欄卻忘了想「預設值該是什麼」時,這三條會紅)。
      includeUnpaidCardOrders: false,
    });
    expect(page).toBe(3);
  });

  // 🔴 `#484a` A2:舊鍵**不是**「暫時還相容」,是**必須被忽略**。
  //    留著解析的話,舊書籤會安靜地變成「篩了一個永遠零筆的條件」——
  //    而零筆與「真的沒有這種單」在畫面上長得一模一樣。
  it('🔴 A2:舊的 fulfillment_status 鍵一律忽略(不得回退成任何篩選)', () => {
    const { filter } = parseOrderListSearchParams({ fulfillment_status: 'shipped' });
    expect(filter.goodsAxes).toBeUndefined();
    expect(filter).not.toHaveProperty('fulfillmentStatus');
  });

  // 🔴 M6:多值來源只可能是手工網址(可見控制項是單選下拉)。
  //    不 clamp 的話會變成「列表篩兩值、下拉顯示一值、一動別的篩選就掉一值」。
  it('🔴 A2:多值 URL 先 clamp 成 1 值(片 B 的 chip UI 才放開)', () => {
    const { filter } = parseOrderListSearchParams({ goods_axis: ['ordered', 'instock'] });
    expect(filter.goodsAxes).toEqual(['ordered']);
  });

  // 貨品軸的白名單:四值 = `none/ordered/instock/shipped`。
  // ⚠️ 舊軸的 `notOrdered` / `inStock` **在這裡必須被剔除** —— 兩個字面在新欄不存在。
  it('🔴 A2:貨品軸只認四值,舊軸字面被剔除', () => {
    // 🔴 非法值**排在最前面**是刻意的:若把它們排後面,clamp 成 1 值之後
    //    「非法值被剔除」與「被 clamp 截掉」兩件事會長得一模一樣 ⇒ 這一格就失去判別力。
    //    現在期望值是 `instock`(第三個輸入)⇒ 只有「前兩個真的被剔除」才可能出現。
    const { filter } = parseOrderListSearchParams({
      goods_axis: ['notOrdered', 'inStock', 'instock', 'HACK'],
    });
    expect(filter.goodsAxes).toEqual(['instock']);
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
      goodsAxes: undefined,
      orderSources: undefined,
      paymentChannels: undefined,
      includeUnpaidCardOrders: false,
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
      goodsAxes: undefined,
      orderSources: undefined,
      paymentChannels: undefined,
      includeUnpaidCardOrders: false,
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
    expect(buildOrderListHref({}, DEN, 1)).toBe('/orders');
  });

  it('帶篩選 + page>1 → 保留篩選 + page;多勾選=同鍵重複 param', () => {
    const href = buildOrderListHref(
      { paymentStatus: 'paid', orderSources: ['web', 'manual_line'] },
      DEN,
      2,
    );
    expect(href).toContain('/orders?');
    expect(href).toContain('payment_status=paid');
    expect(href).toContain('order_source=web&order_source=manual_line');
    expect(href).toContain('page=2');
  });

  it('page 1 省略 page 參數(但保留篩選)', () => {
    const href = buildOrderListHref({ goodsAxes: ['shipped'] }, DEN, 1);
    expect(href).toContain('goods_axis=shipped');
    // 🔴 `#484a` A2:舊鍵不得再出現 —— 它的值篩不到任何東西(正式站實測 `notOrdered` = 0 筆)。
    expect(href).not.toContain('fulfillment_status=');
    expect(href).not.toContain('page=');
  });

  it('🔴 A9w2:即使 filter 上還掛著 workflowStatuses,連結也不得再帶那個鍵', () => {
    // A9w3 已把該欄從 `AdminOrderFilter` 型別移除 ⇒ 這裡改用繞型別的方式餵。量的事沒變:
    // 舊呼叫端(或反序列化回來的舊狀態)帶著它時,href 建構不得讀它 —— 否則翻頁與 returnTo
    // 會把死參數一路傳下去。
    const href = buildOrderListHref(
      { workflowStatuses: ['shipped_done', null], paymentStatus: 'paid' } as AdminOrderFilter,
      DEN,
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

  // 🔴 A11a-5 起 `INVOICE_STATUS_LABEL` 住在本檔(原在 order-detail-view.ts)。逐值硬編碼期望、
  //    不從陣列衍生 —— 而且 **V11 要的「三態各自可辨識」正是靠這三個字面互不相同**:
  //    把 `voided` 併進「未開立」是 plan 指定的突變靶,這條會紅。
  it('開票紀錄狀態三值皆有標籤,且三者互不相同', () => {
    expect(INVOICE_STATUS_LABEL.not_issued).toBe('未開立');
    expect(INVOICE_STATUS_LABEL.issued).toBe('已開立');
    expect(INVOICE_STATUS_LABEL.voided).toBe('已作廢');
    expect(new Set(Object.values(INVOICE_STATUS_LABEL)).size).toBe(3);
  });
});

describe('格式化', () => {
  // 🔴 `formatOrderDate` 的兩條測試隨該函式一併刪除(A9c,主視窗 `E-116-A` 裁定)。
  //    UTC 邊界 off-by-one 的覆蓋沒有消失 —— 移到下面 V6 那組(`formatOrderListDate` 同樣走
  //    Asia/Taipei 曆面,且多測了一格真正的跨年邊界)。
  // ── V6:列表日期格式(A11a-2;母 plan §5.1a「改寫 | 日期 → `07/25`」那列逐字)──
  // 🔴 各自對應一種會靜默壞掉的改法:①一律補年份 ②一律不補年份 ③拿 UTC 年份比 ④非法 iso 擲錯。
  it('V6 同年 → `MM/DD`、不帶年份', () => {
    // 🔴 這裡原本多寫一條 `.not.toContain('2026')`,R1 抓到它被本條 `toBe` **嚴格蘊含**
    //    (任何多印年份的退化都先讓 `toBe` 紅)⇒ 零判別力、而註解卻宣稱它擋得住某種改法。已刪。
    expect(formatOrderListDate('2026-07-25T03:00:00Z', new Date('2026-07-30T00:00:00Z'))).toBe(
      '07/25',
    );
  });

  it('V6 跨年 → `YYYY/MM/DD`、補回年份', () => {
    expect(formatOrderListDate('2025-06-27T03:00:00Z', new Date('2026-07-30T00:00:00Z'))).toBe(
      '2025/06/27',
    );
  });

  it('🔴 V6 年份比較在 Asia/Taipei 曆面做,不是拿 UTC 年份比', () => {
    // UTC `2025-12-31T16:30Z` 在台北已是 **2026-01-01** ⇒ 相對 2026 是**同年**、不該補 `2025/`。
    // 拿 UTC 年份比的寫法在這一格會輸出 `2025/01/01`(月日還對、只有年份錯)—— 只有這條抓得到。
    expect(formatOrderListDate('2025-12-31T16:30:00Z', new Date('2026-03-01T00:00:00Z'))).toBe(
      '01/01',
    );
  });

  it('🔴 非法 iso 不擲錯、原樣回傳(server component 內擲錯 = 整個 /orders 500)', () => {
    // `Intl.DateTimeFormat.formatToParts(Invalid Date)` 會擲 RangeError ⇒ 必須先擋。
    // 慣例同 `note-timeline.ts:85`。正常路徑構造不出來(created_at 是 timestamptz NOT NULL),
    // 但這支是純函式、下一個呼叫端不保證餵的是 DB 值。
    expect(() => formatOrderListDate('not-a-date')).not.toThrow();
    expect(formatOrderListDate('not-a-date')).toBe('not-a-date');
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

// ── #347-B(Sean 拍板 Q-347-B1=B):`order_no` / `supplier_no` 兩個 query key 已退場,
//    它們的解析、fail-closed、href 保留、同鍵重複收斂等三個 describe 一併刪除。
// 🔴 **白名單守門那一族仍然蓋得住它們**:上面「非法篩選值一律忽略」與
//    「A9w2 九碼下架」兩格證的是同一件事 —— 不在白名單的鍵進不了 filter。
//    URL 手打 `?order_no=…` 自此與 `?workflow_status=…` 同待遇:被忽略。

describe('🔴 M-4b 生命週期 L6 — 預設隱藏刷卡未付款單的開關解析', () => {
  // Sean 逐字「刷卡單失敗直接不顯示在後台就好」(P-233-A)。預設隱藏 ⇒ 解析出錯時
  // 必須倒向**隱藏**,不能倒向全顯示 —— 後者是「規則靜默失效」而畫面看不出來。
  it('L6-1 沒帶參數 → includeUnpaidCardOrders=false(預設隱藏)', () => {
    expect(parseOrderListSearchParams({}).filter.includeUnpaidCardOrders).toBe(false);
  });

  it('L6-2 show_unpaid_card=1 → true(唯一的開法)', () => {
    expect(
      parseOrderListSearchParams({ [SHOW_UNPAID_CARD_PARAM]: '1' }).filter.includeUnpaidCardOrders,
    ).toBe(true);
  });

  it.each(['true', 'TRUE', 'yes', '0', '', 'on', '01', ' 1'])(
    '🔴 L6-3 show_unpaid_card=%p(非字面 1)→ false,fail-safe 倒向預設隱藏',
    (v) => {
      expect(
        parseOrderListSearchParams({ [SHOW_UNPAID_CARD_PARAM]: v }).filter.includeUnpaidCardOrders,
      ).toBe(false);
    },
  );

  it('🔴 L6-4 同鍵重複(?show_unpaid_card=1&show_unpaid_card=x)→ 取首值 → true', () => {
    // firstValue 是必要的:陣列直接比對字串恆為 false ⇒ 勾打開後一翻頁就失效。
    expect(
      parseOrderListSearchParams({ [SHOW_UNPAID_CARD_PARAM]: ['1', 'x'] }).filter
        .includeUnpaidCardOrders,
    ).toBe(true);
  });

  it('🔴 L6-5 buildOrderListHref 會把開關帶著走(翻頁不掉)', () => {
    const href = buildOrderListHref({ includeUnpaidCardOrders: true }, DEN, 3);
    expect(href).toContain(`${SHOW_UNPAID_CARD_PARAM}=1`);
    expect(href).toContain('page=3');
  });

  // ── L3 片4:密度(顯示軸)三條 ────────────────────────────────────────────
  //
  // 🔴🔴 **這三條守的是編譯期窮舉守門蓋不到的那一半。**
  //    `Record<keyof OrderListDisplayState, HrefEntry>` 只保證「density 這個 key 被做過決定」,
  //    保證不了 ①param 名對不對 ②該帶的時候有沒有帶 ③不該帶的時候有沒有忍住。
  // ⚠️ **第二條最容易被抄漏**:只寫第一條的話,「永遠把 `den=loose` 寫進 URL」也會全綠,
  //    而那會讓每一條連結都掛著雜訊參數。三條缺一都不行。
  it('🔴 片4-1 非預設密度會被帶著走(翻頁不掉)', () => {
    const href = buildOrderListHref({}, { density: 'tight' }, 3);
    expect(href).toContain(`${ORDER_DENSITY_PARAM}=tight`);
    expect(href).toContain('page=3');
  });

  it('🔴 片4-2 等於預設值時**不寫進 URL**(否則每條連結都掛著 den=loose 的雜訊)', () => {
    const href = buildOrderListHref({}, { density: ORDER_DENSITY_DEFAULT }, 1);
    expect(href).not.toContain(ORDER_DENSITY_PARAM);
    // 前提:這個 fixture 真的走得出一條 href(不然 `not.toContain` 在空字串上恆真)
    expect(href).toBe('/orders');
  });

  it('🔴 片4-3 往返:URL → display → URL 逐字回到原樣', () => {
    for (const den of ORDER_DENSITY_VALUES) {
      const { filter, display } = parseOrderListSearchParams({ [ORDER_DENSITY_PARAM]: den });
      expect(display.density, `${den} 應被解析回自己`).toBe(den);
      const qs = new URLSearchParams(buildOrderListHref(filter, display, 1).split('?')[1] ?? '');
      // 預設那一檔刻意不寫進 URL(片4-2)⇒ 往返的期望值要跟著分流,不是一律 `toBe(den)`。
      expect(qs.get(ORDER_DENSITY_PARAM)).toBe(den === ORDER_DENSITY_DEFAULT ? null : den);
    }
  });

  it('🔴 片4-4 非法值倒向預設,不是讓畫面壞掉、也不是變成沒人選過的密度', () => {
    const { display } = parseOrderListSearchParams({ [ORDER_DENSITY_PARAM]: 'huge' });
    expect(display.density).toBe(ORDER_DENSITY_DEFAULT);
    // 同鍵重複取首值(與其他軸一致);首值非法 ⇒ 仍倒向預設
    const dup = parseOrderListSearchParams({ [ORDER_DENSITY_PARAM]: ['tight', 'std'] });
    expect(dup.display.density).toBe('tight');
  });

  it('L6-6 關著的時候不留空參數在 URL 上', () => {
    expect(buildOrderListHref({ includeUnpaidCardOrders: false }, DEN, 1)).not.toContain(
      SHOW_UNPAID_CARD_PARAM,
    );
  });
});

// ── M-4b #347-3c-1:建立日期範圍的 URL 軸 ──────────────────────────────────────
describe('#347-3c-1 日期範圍 URL 軸', () => {
  it('🔴 曆面日 → 絕對時刻:from 是台北午夜、to 是**下一個**台北午夜', () => {
    // 突變:parse 改用 `new Date(ymd)`(UTC 午夜)⇒ 這條紅,而症狀是畫面顯示 08/10 的單
    // 在選了 08/10 之後不見了(差 8 小時)。
    const { filter } = parseOrderListSearchParams({
      date_from: '2026-02-10',
      date_to: '2026-08-10',
    });
    expect(filter.createdFrom).toBe('2026-02-10T00:00:00+08:00');
    expect(filter.createdTo).toBe('2026-08-11T00:00:00+08:00');
  });

  it.each([
    ['格式不合', '2026/08/10'],
    ['不存在的日期', '2026-02-30'],
    ['垃圾', 'yesterday'],
    ['空字串', ''],
  ])('%s → 該側不篩(不是回零筆、也不是擲錯)', (_label, raw) => {
    const { filter } = parseOrderListSearchParams({ date_from: raw, date_to: raw });
    expect(filter.createdFrom).toBeUndefined();
    expect(filter.createdTo).toBeUndefined();
  });

  it('🔴 沒帶參數 ⇒ **沒有預設**(本片不套近半年;那是 3c-2 的下拉預設選項)', () => {
    // 🔴 這條守的是 plan §1-1 推翻框的結論:預設要是**看得見的選單狀態**,不是這裡偷偷補區間。
    //    突變:在 parse 補一個 `?? recentTaipeiMonthsRange(...)` ⇒ 這條紅。
    const { filter } = parseOrderListSearchParams({});
    expect(filter.createdFrom).toBeUndefined();
    expect(filter.createdTo).toBeUndefined();
  });

  it('🔴🔴 往返:URL → filter → URL 逐字回到原樣(翻頁不得把日期弄丟或位移一天)', () => {
    // 🔴 編譯期那道 `Record<keyof AdminOrderFilter, …>` 只保證「每個軸都被做過決定」,
    //    **保證不了那個決定是對的** —— 對到錯的 param 名、或 `to` 換算回去差一天,型別一樣過。
    //    這條就是它蓋不到的那一半。突變:把 `taipeiYmdFromDayEndExclusive` 換成
    //    `isoBackToTaipeiYmd`(直接取上界的曆面)⇒ `date_to` 變 08-11 ⇒ 紅,
    //    而症狀是員工每翻一頁結束日就往後跑一天。
    const raw = { date_from: '2026-02-10', date_to: '2026-08-10', payment_status: 'paid' };
    const { filter } = parseOrderListSearchParams(raw);
    const qs = new URLSearchParams(buildOrderListHref(filter, DEN, 1).split('?')[1] ?? '');
    expect(qs.get('date_from')).toBe('2026-02-10');
    expect(qs.get('date_to')).toBe('2026-08-10');
    expect(qs.get('payment_status')).toBe('paid');
  });

  it('🔴 只給一邊也要往返得回來', () => {
    const { filter } = parseOrderListSearchParams({ date_to: '2026-08-10' });
    const qs = new URLSearchParams(buildOrderListHref(filter, DEN, 1).split('?')[1] ?? '');
    expect(qs.get('date_to')).toBe('2026-08-10');
    expect(qs.has('date_from')).toBe(false);
  });

  it('🔴 `keyword` 那一軸**永遠不進 URL**(它住 httpOnly cookie;PII 紅線)', () => {
    // 窮舉 Record 逼每個軸都要有一格,而 keyword 那格的值恆 undefined。
    // 突變:把 keyword 那格改成 `['keyword', filter.keyword]` ⇒ 這條紅,而症狀是
    // 客人姓名/電話跟著網址進 access log、CDN log、瀏覽器歷史。
    const href = buildOrderListHref({ keyword: '王小明' }, DEN, 1);
    expect(href).not.toContain('王小明');
    expect(href).not.toContain(encodeURIComponent('王小明'));
    expect(href).toBe('/orders');
  });

  it('日期軸與面板連結並存(點開一張單不會把日期洗掉)', () => {
    const { filter } = parseOrderListSearchParams({ date_from: '2026-02-10' });
    const qs = new URLSearchParams(buildOrderListHref(filter, DEN, 2, 'ord-1').split('?')[1] ?? '');
    expect(qs.get('date_from')).toBe('2026-02-10');
    expect(qs.get('panel')).toBe('ord-1');
    expect(qs.get('page')).toBe('2');
  });
});

// ── M-4b #347-3c-2:「未選預設近半年」+ 下拉狀態 ────────────────────────────────
describe('#347-3c-2 預設近半年 + 選中的選項', () => {
  const NOW = new Date('2026-08-10T03:00:00Z'); // 台北 8/10 11:00

  it('🔴🔴 沒帶日期 + 給了 now ⇒ 套近半年,**而且下拉顯示的就是它**', () => {
    // 🔴 這是本片的核心不變式:**選中的選項 == 真正生效的區間**。
    //    顯示「近半年」卻篩著別的期間,會讓員工據此判斷「這段期間沒有單」——
    //    那比不篩選糟得多。兩者同源(`resolveOrderDateRange` 一次算出),結構上不可能分岔。
    const r = parseOrderListSearchParams({}, { now: NOW });
    expect(r.selectedDatePresetKey).toBe('m6');
    expect(r.filter.createdFrom).toBe('2026-02-10T00:00:00+08:00');
    // 迄日含當天 ⇒ 上界是下一個台北午夜。
    expect(r.filter.createdTo).toBe('2026-08-11T00:00:00+08:00');
    const selected = r.datePresetOptions.find((o) => o.key === r.selectedDatePresetKey);
    expect(selected?.fromYmd).toBe('2026-02-10');
  });

  it('🔴 **不給 now ⇒ 不套預設**(3c-1 的行為;藏資料的那個決定要呼叫端明講)', () => {
    // 突變:把 `now` 改成 `?? new Date()` ⇒ 這條紅。那樣的話任何呼叫端都會靜默拿到近半年。
    const r = parseOrderListSearchParams({});
    expect(r.filter.createdFrom).toBeUndefined();
    expect(r.filter.createdTo).toBeUndefined();
    expect(r.datePresetOptions).toEqual([]);
  });

  it('🔴 URL 帶了日期 ⇒ 用它,不得被預設蓋掉', () => {
    const r = parseOrderListSearchParams({ date_from: '2025-01-01', date_to: '2025-01-31' }, { now: NOW });
    expect(r.filter.createdFrom).toBe('2025-01-01T00:00:00+08:00');
    // 🔴 上界也要斷言(R1 nit 11):只驗下界的話,「to 算錯一天」那個窄突變沒有任何一格會紅。
    expect(r.filter.createdTo).toBe('2025-02-01T00:00:00+08:00');
    expect(r.selectedDatePresetKey).toBe('custom');
  });

  it('🔴 只帶起日 ⇒ 迄日**不得**被補成預設(「這天之後的全部」是合理需求)', () => {
    // 突變:把「只帶一邊也算帶了」改成「兩邊都要才算」⇒ 這條紅,而症狀是員工只設起日,
    // 迄日卻被系統偷偷設成今天。
    const r = parseOrderListSearchParams({ date_from: '2025-01-01' }, { now: NOW });
    expect(r.filter.createdFrom).toBe('2025-01-01T00:00:00+08:00');
    expect(r.filter.createdTo).toBeUndefined();
  });

  it('🔴 日期剛好等於某個預設 ⇒ 顯示那一格(不是永遠顯示自訂)', () => {
    const r = parseOrderListSearchParams({ date_from: '2026-07-10', date_to: '2026-08-10' }, { now: NOW });
    expect(r.selectedDatePresetKey).toBe('m1');
  });

  it('每個預設選項都算得出區間,而且 `m6` 就是預設那一格', () => {
    const options = buildOrderDatePresetOptions(NOW);
    expect(options.map((o) => o.key)).toEqual(['m1', 'm3', 'm6', 'y1']);
    for (const o of options) {
      expect(o.fromYmd, `${o.key} 的起日`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.toYmd).toBe('2026-08-10');
    }
    expect(options.some((o) => o.key === ORDER_DATE_DEFAULT_KEY)).toBe(true);
  });

  it('🔴 預設套用之後,**連結**會帶著日期走(翻頁/分享不會掉回不限期間)', () => {
    // ⚠️ 名稱精確化(R1 important 4):打開裸 `/orders` 時**沒有東西改寫網址列** ——
    //    首次載入的可見性完全由下拉那格承擔;這一格量的是 `buildOrderListHref` 的產出,
    //    也就是「按下去之後」那些連結。別把它讀成「網址列會顯示日期」。
    const r = parseOrderListSearchParams({}, { now: NOW });
    const qs = new URLSearchParams(buildOrderListHref(r.filter, DEN, 1).split('?')[1] ?? '');
    expect(qs.get('date_from')).toBe('2026-02-10');
    expect(qs.get('date_to')).toBe('2026-08-10');
  });
});
