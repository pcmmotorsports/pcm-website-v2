// M-4b E4-b 出貨脈絡讀取 adapter 的測試。
//
// 🔴 **本檔最重要的一組是「兩種 null」** —— port 檔頭明文,而它們合併之後
//    「系統壞了」與「這批本來就沒碼」在呼叫端變成同一件事,
//    其中一條會寄出**一封說「本批為自取」的假話**。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  SupabaseShippedEmailContextAdapter,
  ShippedContextQueryError,
  SHIPPED_EMAIL_MAX_LINES,
  ORDER_ITEMS_SCAN_MAX,
  type ShippedEmailContextClient,
} from './SupabaseShippedEmailContextAdapter';

const SHIPMENT = 'shp-1';
const ORDER = 'ord-1';

function box(over: Record<string, unknown> = {}) {
  return {
    shipment_reference: 'BCDF23',
    carrier_code: 'hct',
    carrier_note: null,
    tracking_number: 'HCT123456',
    shipped_at: '2026-08-22T10:00:00.000Z',
    deleted_at: null,
    ...over,
  };
}

function line(title: string | null, quantity = 1) {
  return {
    shipped_quantity: quantity,
    order_items: {
      order_id: ORDER,
      product_snapshot: title === null ? {} : { title, sku: 'X', spec: {} },
      orders: { display_id: 'PCM-2026-0001' },
    },
  };
}

/** 一段查詢被實際送出去的東西。**這個型別存在的理由見下方 `makeClient` 的註解。** */
type RecordedQuery = {
  table: string;
  columns: string;
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  order: Array<[string, { ascending: boolean }]>;
  limit: number;
};

/**
 * 兩段查詢的假 client。**依呼叫順序回**(① shipments ② shipment_items),
 * 與 adapter 內的順序綁死 —— 順序換了測試會紅,那是刻意的。
 *
 * 🔴🔴 **它會【記下每一個參數】,而那是 2026-08-22 codex R1 ② 之後才加的。**
 * 原版把 `from/select/eq/is/order/limit` 的參數**全部吞掉**
 * ⇒ 刪掉 `deleted_at` 過濾、刪掉 `order_id` 篩選、拿掉 `!inner`、甚至打錯表名,
 *   **14 格照樣全綠** —— 那些測試證明的是「這段 TS 邏輯自洽」,不是「它問了對的問題」。
 * ⇒ 而那兩個過濾的真實後果是:**作廢箱的通知信被寄出去 / 別張訂單的品項被印進這封信**。
 *
 * ⚠️ **它能做到與做不到的,分開講**:
 *   ✅ 抓得到「查詢條件被刪掉/改掉」(下方 `describe — 查詢形狀` 那組逐條釘住)
 *   ❌ 抓不到「PostgREST 對這個條件的**真實語意**」——
 *      例如 `!inner` 到底有沒有讓父列跟著被濾掉,那只有真的 PostgREST 說了算。
 *   ⇒ 那一格**沒有被本檔覆蓋**,照實寫在這裡,不假裝它被覆蓋了。
 */
function makeClient(
  results: Array<{ data: unknown[] | null; error: { code?: string } | null }>,
  opts: { throwOn?: number } = {},
) {
  let call = 0;
  const queries: RecordedQuery[] = [];
  const chain = (table: string): Record<string, unknown> => {
    const rec: RecordedQuery = { table, columns: '', eq: [], is: [], order: [], limit: -1 };
    queries.push(rec);
    const self: Record<string, unknown> = {};
    self.select = (c: string) => {
      rec.columns = c;
      return self;
    };
    self.eq = (k: string, v: unknown) => {
      rec.eq.push([k, v]);
      return self;
    };
    self.is = (k: string, v: unknown) => {
      rec.is.push([k, v]);
      return self;
    };
    self.order = (k: string, o: { ascending: boolean }) => {
      rec.order.push([k, o]);
      return self;
    };
    self.limit = (n: number) => {
      rec.limit = n;
      const i = call++;
      if (opts.throwOn === i) return Promise.reject(new Error('boom'));
      // 🔴 第三段(訂單層「還有沒出的東西」)沒給時, 預設回【一項、已全出】
      //    ⇒ orderHasUnshippedItems = false。
      //    為什麼給預設而不是空陣列:那一段是 2026-08-30 才加的, 而既有 14 格
      //    問的都不是它 —— 讓它們每一格都去寫一個與自己無關的 fixture, 只會讓
      //    「這一格在測什麼」變模糊。
      //    ⚠️ 而**這個預設會讓「adapter 根本沒發那一段查詢」變得看不出來**
      //    ⇒ 所以下面「查詢形狀」那組有一格專門釘住第三段的表名/欄位/條件。
      const fallback = i === 2 ? { data: [summaryRow(1, 1, 0)], error: null } : { data: [], error: null };
      return Promise.resolve(results[i] ?? fallback);
    };
    return self;
  };
  const client = { from: (t: string) => chain(t) } as unknown as ShippedEmailContextClient;
  return { client, queries };
}

/**
 * 訂單層那一段的一列:`order_items` 的 `quantity` + 內嵌的 summary。
 * 判準(與 adapter 及 SQL 同形):`shipped >= max(quantity - cancelled, 0)` ⇒ 這一項出完了。
 */
function summaryRow(quantity: number, shipped: number, cancelled = 0) {
  return {
    quantity,
    order_item_quantity_summary: { shipped_quantity: shipped, cancelled_quantity: cancelled },
  };
}

/** 只要 client 的簡寫(大多數格不需要看送出去的參數)。 */
const client = (
  results: Array<{ data: unknown[] | null; error: { code?: string } | null }>,
  opts: { throwOn?: number } = {},
) => makeClient(results, opts).client;

const load = (c: ShippedEmailContextClient) =>
  new SupabaseShippedEmailContextAdapter(c).loadShippedContext({ orderId: ORDER, shipmentId: SHIPMENT });

/**
 * 只在【期望 ok】的格子用:不是 ok 就當場失敗,並把實際的 kind 印出來。
 * 🔴 **不寫成 `as` 硬轉** —— 硬轉的話,回了 `voided` 的那一發會變成
 *    「讀 undefined 的欄位」而不是「這一格期望 ok 卻拿到 voided」,錯誤訊息會指向錯的地方。
 */
function expectOk(r: Awaited<ReturnType<typeof load>>) {
  expect(r.kind).toBe('ok');
  if (r.kind !== 'ok') throw new Error(`期望 ok，實際 ${r.kind}`);
  return r.context;
}

describe('SupabaseShippedEmailContextAdapter — 🔴 查詢形狀(送出去的條件,不是回來的資料)', () => {
  // 🔴 這一組是 codex 2026-08-22 R1 ② 之後補的。**在它之前,把下面任何一個條件刪掉,
  //    整支測試檔都不會紅** —— 而那兩個條件擋的是「寄出作廢箱的通知」與「印進別張單的品項」。
  async function run() {
    const { client: c, queries } = makeClient([
      { data: [box()], error: null },
      { data: [line('排氣管')], error: null },
    ]);
    await new SupabaseShippedEmailContextAdapter(c).loadShippedContext({
      orderId: ORDER,
      shipmentId: SHIPMENT,
    });
    return queries;
  }

  it('① 查的是 shipments、按 id 篩,而且🔴【刻意不在查詢裡過濾 deleted_at】', async () => {
    const [q] = await run();
    expect(q?.table).toBe('shipments');
    expect(q?.eq).toContainEqual(['id', SHIPMENT]);
    // 🔴🔴 **這一格 2026-08-22 Fable R2 F2 之後【方向反過來】了,而理由要讀得到**:
    //    在查詢裡過濾掉作廢箱 ⇒ 「這箱作廢了」與「這箱不存在」回**同一個空結果**
    //    ⇒ 作廢是**正常業務動作**（裝箱打錯的唯一補救就是整箱作廢重開）
    //    ⇒ 把它當成異常，會讓一個正常動作**每天發告警**、有人半夜起來查。
    //    ⇒ 所以要把 deleted_at **撈回來自己判**，才回得出 `voided` 這個可辨識的態。
    expect(q?.is).toEqual([]); // ← 沒有任何 .is() 過濾
    expect(q?.columns).toContain('deleted_at'); // ← 而那一欄必須被【撈回來】
  });

  it('🔴 ② 撈回來的欄位必須含 shipped_at —— 少了它,「還沒出貨」會判不出來', async () => {
    const [q] = await run();
    expect(q?.columns).toContain('shipped_at');
  });

  it('② 查的是 shipment_items,而且【同時按箱 + 按訂單】篩', async () => {
    const [, q] = await run();
    expect(q?.table).toBe('shipment_items');
    expect(q?.eq).toContainEqual(['shipment_id', SHIPMENT]);
    // 🔴 刪掉這一行 ⇒ 這一箱裡【別張訂單】的品項會被印進這封信。
    expect(q?.eq).toContainEqual(['order_items.order_id', ORDER]);
  });

  it('🔴 ② 的 select 必須帶 `!inner` —— 少了它,上面那個訂單篩選會變成「篩子表、父列照回」', async () => {
    const [, q] = await run();
    expect(q?.columns).toContain('order_items!inner');
    expect(q?.columns).toContain('orders!inner');
  });

  it('② 排序帶唯一鍵、且探針是上限 + 1', async () => {
    const [, q] = await run();
    expect(q?.order.map(([k]) => k)).toEqual(['id']);
    expect(q?.limit).toBe(SHIPPED_EMAIL_MAX_LINES + 1);
  });
});

describe('SupabaseShippedEmailContextAdapter — 正常路徑', () => {
  it('撈得到 ⇒ 箱號 / 貨運商中文名 / 追蹤碼 / 品項都是【具體的值】', async () => {
    const res = await load(
      client([
        { data: [box()], error: null },
        { data: [line('鈦合金排氣管', 2), line('碳纖維前土除')], error: null },
      ]),
    );

    const ctx = expectOk(res);
    expect(expectOk(res)).toMatchObject({
      orderDisplayId: 'PCM-2026-0001',
      shipmentReference: 'BCDF23',
      carrierName: '新竹物流', // ← 這一格證明 CARRIER_LABEL 搬到 packages 之後，寄信這側拿得到
      trackingNumber: 'HCT123456',
      linesTruncated: false,
    });
    expect(ctx.lines).toEqual([
      { title: '鈦合金排氣管', quantity: 2 },
      { title: '碳纖維前土除', quantity: 1 },
    ]);
  });

  it('品名快照缺 title ⇒ 那一列的 title 是 null(不是空字串、也不是整包失敗)', async () => {
    const res = await load(
      client([
        { data: [box()], error: null },
        { data: [line(null)], error: null },
      ]),
    );

    const ctx = expectOk(res);

    expect(ctx.lines).toEqual([{ title: null, quantity: 1 }]);
  });
});

describe('SupabaseShippedEmailContextAdapter — 🔴 兩種 null 不可以合併', () => {
  it('🔴 自取(carrier=other + note「自取」+ 沒有追蹤碼)⇒ 整包不是 null,而追蹤碼是 null', async () => {
    // 🔴🔴 **這一格 2026-08-22 改過,而改的是【資料本身合不合法】,不是斷言**(codex R1 ①):
    //    ~~原本寫 `other` + `carrier_note: null`~~ —— **那是正式庫生不出來的資料**。
    //    `20260805170000_…_shipments.sql:112` 是**雙向** CHECK:
    //      CHECK ((carrier_code = 'other') = (NOT pcm_b2_is_blank(carrier_note)))
    //    ⇒ `other` **必須**有非空 note ⇒ 「自取 / 自送」在這個 schema 裡就是那個 note 的內容。
    // ⇒ 這才是 Sean Q3=甲「照寄,信裡寫無追蹤碼」的**真實形狀**:
    //   有貨運商名(= note)、沒有追蹤碼。
    const res = await load(
      client([
        { data: [box({ carrier_code: 'other', carrier_note: '自取', tracking_number: null })], error: null },
        { data: [line('後照鏡')], error: null },
      ]),
    );

    const ctx = expectOk(res);
    expect(ctx.carrierName).toBe('自取');
    expect(ctx.trackingNumber).toBeNull(); // ← 這一半才是「兩種 null」的正例
    expect(ctx.lines).toHaveLength(1);
  });

  it('⚠️ 縱深:`other` 沒有 note(**DB CHECK 擋著,正式庫生不出來**)⇒ carrierName = null', async () => {
    // 🔴 保留這一格的理由,不是「這是合法狀態」——**它不是**。
    //    是:① 既有列不會因 `pcm_b2_is_blank` 改版被自動重驗(該函式 COMMENT 逐字);
    //        ② 有人繞過 migration 直接改線上 CHECK 時,這條路會活過來。
    //    ⇒ port 型別就是 `string | null`,呼叫端仍須處理得了。**這是縱深,不是常態路徑。**
    const res = await load(
      client([
        { data: [box({ carrier_code: 'other', carrier_note: null, tracking_number: null })], error: null },
        { data: [line('後照鏡')], error: null },
      ]),
    );

    const ctx = expectOk(res);

    expect(ctx.carrierName).toBeNull();
  });

  it('carrier=other 且有 note ⇒ 以 note 為準(那是「自送」那類的自由文字)', async () => {
    const res = await load(
      client([
        { data: [box({ carrier_code: 'other', carrier_note: '老闆自送', tracking_number: null })], error: null },
        { data: [line('腳踏')], error: null },
      ]),
    );

    const ctx = expectOk(res);

    expect(ctx.carrierName).toBe('老闆自送');
  });

  it('追蹤碼是空字串 ⇒ 當成沒有碼(null),不是一個空的碼', async () => {
    const res = await load(
      client([
        { data: [box({ tracking_number: '   ' })], error: null },
        { data: [line('把手')], error: null },
      ]),
    );

    const ctx = expectOk(res);

    expect(ctx.trackingNumber).toBeNull();
  });

  it('🔴 箱查不到 ⇒ unavailable(「讀不到」,這一態應該吵)', async () => {
    expect((await load(client([{ data: [], error: null }]))).kind).toBe('unavailable');
  });

  /**
   * 🔴🔴 **這一格在 2026-08-30 一度變成假綠, 而抓到它的是 codex R2** ——
   *    我把箱層裁決搬到品項查詢之後(R1 must-fix 6)之後,**這一格沒有補品項 fixture**
   *    ⇒ 它其實是先被「0 品項 ⇒ unavailable」擋下的
   *    ⇒ **把 `shipped_at === null` 那一行整行刪掉, 32 格照樣全綠**(我自己跑過那一發突變)。
   * 📌 **⇒ 一個【正確的重構】把一格守門推到它守的東西後面, 而斷言的【值】沒有變 ⇒ 零訊號。**
   *    ⇒ 所以補品項不是「讓測試過」, 是**讓它重新走到它要量的那一行**。
   */
  it('🔴 箱還沒標出貨 ⇒ unavailable(我們對「該寄」的判斷與資料對不上)', async () => {
    const res = await load(
      client([
        { data: [box({ shipped_at: null })], error: null },
        // 🔴 品項給滿 —— 否則這一格會停在「0 品項」那道閘, 永遠走不到 `shipped_at` 那一行。
        { data: [line('前煞車來令片')], error: null },
      ]),
    );
    expect(res.kind).toBe('unavailable');
  });

  it('🔴🔴 箱【已作廢】⇒ voided,**不是 unavailable** —— 那是正常業務動作,不該把人叫起來', async () => {
    // 🔴 這一格是 Fable 2026-08-22 R2 F2 的本體。合併成同一態的失敗鏈:
    //    信排進佇列 → 員工把箱子作廢 → 每輪 claim 都失敗 → 燒完 attempts → 進死信
    //    → **訊號 2 每日告警** ⇒ 有人半夜起來查一個【正常的】業務動作。
    // ⚠️ 而 voided **不等於可以靜默丟掉** —— 呼叫端要落一列「跳過」的痕跡(片3 的事)。
    // 🔵 **2026-08-30 起這一格要多餵一段品項**(codex R1 must-fix 6):`voided` 現在下在
    //    **歸屬確認之後** ⇒ 沒有品項的話會先落 `unavailable`。理由見下面那一格。
    const res = await load(
      client([
        { data: [box({ deleted_at: '2026-08-22T12:00:00.000Z' })], error: null },
        { data: [line('前煞車來令片')], error: null },
      ]),
    );

    expect(res.kind).toBe('voided');
  });

  it('作廢優先於「還沒出貨」—— 兩個都成立時回 voided(那是它真正的狀態)', async () => {
    const res = await load(
      client([
        { data: [box({ shipped_at: null, deleted_at: '2026-08-22T12:00:00.000Z' })], error: null },
        { data: [line('前煞車來令片')], error: null },
      ]),
    );

    expect(res.kind).toBe('voided');
  });

  /**
   * 🔴🔴 **codex 2026-08-30 R1 must-fix 6 的證人。**
   *
   * 場景:A 單的 outbox 列指向一個**不屬於 A**的箱(scanner 出錯 / 手動寫入),
   * 而那個箱**剛好已作廢**。
   * ```
   * 舊行為 ⇒ voided ⇒ 呼叫端【靜默跳過、不計 error】⇒ A 的客人永遠收不到信,零訊號
   * 新行為 ⇒ unavailable ⇒ 計 error ⇒ 503 ⇒ 有人看得到
   * ```
   * 📌 而最難看見的是:**同一個錯配,在箱【沒有】作廢時本來就會吵**(② 撈到 0 項)
   *    ⇒ **吵不吵取決於一個與錯配完全無關的欄位。那不是設計,那是順序。**
   */
  it('🔴🔴 箱已作廢【而且不屬於這張訂單】⇒ unavailable(不得被當成正常作廢吞掉)', async () => {
    const res = await load(
      client([
        { data: [box({ deleted_at: '2026-08-22T12:00:00.000Z' })], error: null },
        { data: [], error: null }, // ← 這張單在這一箱裡 0 項 = 錯配
      ]),
    );

    expect(res.kind).toBe('unavailable');
  });

  it('🔴 這張訂單在這一箱裡 0 項 ⇒ 整包 null,**不寄一封空清單的信**', async () => {
    const res = await load(
      client([
        { data: [box()], error: null },
        { data: [], error: null },
      ]),
    );

    expect(res.kind).toBe('unavailable');
  });

  it('🔴 撈不到 display_id ⇒ 整包 null,**不得用空字串頂替**', async () => {
    const broken = { ...line('排氣管') };
    (broken.order_items as { orders?: unknown }).orders = null;
    const res = await load(
      client([
        { data: [box()], error: null },
        { data: [broken], error: null },
      ]),
    );

    expect(res.kind).toBe('unavailable');
  });
});

describe('SupabaseShippedEmailContextAdapter — 🔴 截斷', () => {
  it('品項超過上限 ⇒ linesTruncated=true,而 lines 只給上限那麼多', async () => {
    // 🔴 為 true 時呼叫端**必須不寄**(port 檔頭)——
    //    少列幾項的信與正常的信長得一模一樣,客人不會知道要問。
    const rows = Array.from({ length: SHIPPED_EMAIL_MAX_LINES + 1 }, (_, i) => line(`品項${i}`));
    const res = await load(
      client([
        { data: [box()], error: null },
        { data: rows, error: null },
      ]),
    );

    const ctx = expectOk(res);

    expect(ctx.linesTruncated).toBe(true);
    expect(ctx.lines).toHaveLength(SHIPPED_EMAIL_MAX_LINES);
  });

  it('剛好等於上限 ⇒ linesTruncated=false(「收滿」與「沒載完」不可混為一談)', async () => {
    const rows = Array.from({ length: SHIPPED_EMAIL_MAX_LINES }, (_, i) => line(`品項${i}`));
    const res = await load(
      client([
        { data: [box()], error: null },
        { data: rows, error: null },
      ]),
    );

    const ctx = expectOk(res);

    expect(ctx.linesTruncated).toBe(false);
  });
});

describe('SupabaseShippedEmailContextAdapter — 錯誤路徑', () => {
  it('查詢回 error ⇒ throw,訊息帶階段與 code,**不帶 DB 原文**', async () => {
    await expect(
      load(client([{ data: null, error: { code: '42501' } }])),
    ).rejects.toBeInstanceOf(ShippedContextQueryError);
    await expect(
      load(client([{ data: null, error: { code: '42501' } }])),
    ).rejects.toThrow(/shipment:42501/);
  });

  it('查詢直接 reject ⇒ 收成固定 code,**不接住原始錯誤物件**', async () => {
    await expect(load(client([], { throwOn: 0 }))).rejects.toThrow(/shipment:rejected/);
  });

  it('第二段查詢失敗 ⇒ 階段名要指得出是哪一段(凌晨三點的人靠它決定查哪裡)', async () => {
    await expect(
      load(client([{ data: [box()], error: null }, { data: null, error: { code: 'PGRST100' } }])),
    ).rejects.toThrow(/items:PGRST100/);
  });
});

/**
 * 🔴 **`orderHasUnshippedItems`** —— 它答的是 Sean 2026-08-30 `q3: C` 第二段的【條件】
 * (「其餘商品出貨時會另外通知您」該不該印), 而**兩個方向的錯都會打電話進來**:
 * ```
 * 印了而其實出完了 ⇒ 客人等一封永遠不會來的信
 * 沒印而其實還有  ⇒ 客人收到第二封時以為我們重複寄（那正是他選 C 要防的）
 * ```
 */
describe('SupabaseShippedEmailContextAdapter — 🔴 這張訂單還有沒有沒出的東西', () => {
  const ok3 = (rows: unknown[]) => [
    { data: [box()], error: null },
    { data: [line('A')], error: null },
    { data: rows, error: null },
  ];

  it('全部出完 ⇒ false(不印那一句)', async () => {
    const ctx = expectOk(await load(client(ok3([summaryRow(2, 2), summaryRow(1, 1)]))));
    expect(ctx.orderHasUnshippedItems).toBe(false);
  });

  it('有一項沒出完 ⇒ true', async () => {
    const ctx = expectOk(await load(client(ok3([summaryRow(2, 2), summaryRow(3, 1)]))));
    expect(ctx.orderHasUnshippedItems).toBe(true);
  });

  it('🔴 取消掉的量要扣:訂 3 取消 1 出 2 ⇒ false(它已經出完了)', async () => {
    const ctx = expectOk(await load(client(ok3([summaryRow(3, 2, 1)]))));
    expect(ctx.orderHasUnshippedItems).toBe(false);
  });

  it('🔴 對照:同一列只把 cancelled 拿掉 ⇒ true(證明那個扣是承重的)', async () => {
    const ctx = expectOk(await load(client(ok3([summaryRow(3, 2, 0)]))));
    expect(ctx.orderHasUnshippedItems).toBe(true);
  });

  it('summary 內嵌回 null ⇒ 當成 0 已出 ⇒ true, 不靜靜當成出完了', async () => {
    const ctx = expectOk(
      await load(client(ok3([{ quantity: 1, order_item_quantity_summary: null }]))),
    );
    expect(ctx.orderHasUnshippedItems).toBe(true);
  });

  it('🔴 這張訂單一列都撈不到 ⇒ unavailable(不猜、不寄)', async () => {
    const r = await load(client(ok3([])));
    expect(r.kind).toBe('unavailable');
  });

  it('🔴 掃不完(拿到 MAX+1 列)⇒ true —— 刻意選這一邊, 理由在 adapter 註解', async () => {
    const rows = Array.from({ length: ORDER_ITEMS_SCAN_MAX + 1 }, () => summaryRow(1, 1));
    const ctx = expectOk(await load(client(ok3(rows))));
    expect(ctx.orderHasUnshippedItems).toBe(true);
  });

  it('🔴 查詢形狀:第三段要問對表與條件 —— 否則那個預設會讓「根本沒問」看不出來', async () => {
    const { client: c, queries } = makeClient(ok3([summaryRow(1, 1)]));
    await load(c);
    expect(queries).toHaveLength(3);
    const q = queries[2];
    if (q === undefined) throw new Error('第三段查詢沒有被送出去');
    expect(q.table).toBe('order_items');
    expect(q.columns).toContain('order_item_quantity_summary');
    expect(q.columns).toContain('cancelled_quantity');
    expect(q.eq).toContainEqual(['order_id', ORDER]);
    expect(q.limit).toBe(ORDER_ITEMS_SCAN_MAX + 1);
  });

  it('第三段查詢失敗 ⇒ 階段名指得出是哪一段', async () => {
    await expect(
      load(
        client([
          { data: [box()], error: null },
          { data: [line('A')], error: null },
          { data: null, error: { code: 'PGRST200' } },
        ]),
      ),
    ).rejects.toThrow(/order_summary:PGRST200/);
  });
});
