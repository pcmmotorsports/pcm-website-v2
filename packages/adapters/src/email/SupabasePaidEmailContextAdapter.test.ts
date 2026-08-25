// M-4b 付款脈絡讀取 adapter 的測試。
//
// 🔴 **本檔最重要的兩組不是「撈得到」,是那兩條金額紅線**:
//    ① 經銷價零滲入 —— 而它要有**量具**,不能只有註解(下方「負向斷言」那組)
//    ② 金額整數禁浮點 —— 餵小數必須 throw(下方「浮點」那格)
// ⚠️ 而每一發「該紅」都在 diff 報告裡**故意改壞驗過一次**,不是寫了斷言就算。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  SupabasePaidEmailContextAdapter,
  PaidContextQueryError,
  PAID_EMAIL_MAX_LINES,
  type PaidEmailContextClient,
} from './SupabasePaidEmailContextAdapter';

const ORDER = 'ord-1';

function head(over: Record<string, unknown> = {}) {
  return {
    display_id: 'PCM-2026-0001',
    subtotal: 31120,
    shipping_fee: 150,
    discount_total: 790,
    total: 30480,
    // 🔴 真實的列**一定有這一欄**（`orders.cancelled_at` 可為 null，不是可缺席）。
    //    預設寫 null 而不是省略 —— 省略的話，「沒被取消」與「這一欄沒撈到」在
    //    fixture 上長得一樣，而那正是本檔要分辨的兩件事。
    cancelled_at: null,
    ...over,
  };
}

function line(over: Record<string, unknown> = {}) {
  return {
    variant_sku: 'BRM-19RCS-CC',
    quantity: 1,
    line_total: 18400,
    product_snapshot: { title: 'Brembo 19RCS 直推式煞車總泵', sku: 'BRM-19RCS-CC', spec: {} },
    ...over,
  };
}

/** 一段查詢被實際送出去的東西(鏡像出貨側:**參數要被記下來**,否則刪掉篩選也全綠)。 */
type RecordedQuery = {
  table: string;
  columns: string;
  eq: Array<[string, unknown]>;
  order: Array<[string, { ascending: boolean }]>;
  limit: number;
};

/**
 * 兩段查詢的假 client。**依呼叫順序回**(① orders ② order_items),與 adapter 內順序綁死。
 *
 * ⚠️ **能與不能,分開講**(抄出貨側那份誠實揭示):
 *   ✅ 抓得到「查詢條件/欄位白名單被刪掉或改掉」
 *   ❌ 抓不到 PostgREST 對這些條件的**真實語意**(那只有真的 PostgREST 說了算)
 *   ⇒ 那一格**沒有被本檔覆蓋**,不假裝它被覆蓋了。
 */
function makeClient(
  results: Array<{ data: unknown[] | null; error: { code?: string } | null }>,
  opts: { throwOn?: number } = {},
) {
  let call = 0;
  const queries: RecordedQuery[] = [];
  const chain = (table: string): Record<string, unknown> => {
    const rec: RecordedQuery = { table, columns: '', eq: [], order: [], limit: -1 };
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
    self.order = (k: string, o: { ascending: boolean }) => {
      rec.order.push([k, o]);
      return self;
    };
    self.limit = (n: number) => {
      rec.limit = n;
      const i = call++;
      if (opts.throwOn === i) return Promise.reject(new Error('boom'));
      return Promise.resolve(results[i] ?? { data: [], error: null });
    };
    return self;
  };
  const client = { from: (t: string) => chain(t) } as unknown as PaidEmailContextClient;
  return { client, queries };
}

const client = (
  results: Array<{ data: unknown[] | null; error: { code?: string } | null }>,
  opts: { throwOn?: number } = {},
) => makeClient(results, opts).client;

const load = (c: PaidEmailContextClient) =>
  new SupabasePaidEmailContextAdapter(c).loadPaidContext({ orderId: ORDER });

const ok = (rows: unknown[] = [line()], over: Record<string, unknown> = {}) => [
  { data: [head(over)], error: null },
  { data: rows, error: null },
];

/** 只在【期望 ok】的格子用;硬轉會讓錯誤訊息指向錯的地方。 */
function expectOk(r: Awaited<ReturnType<typeof load>>) {
  expect(r.kind).toBe('ok');
  if (r.kind !== 'ok') throw new Error(`期望 ok,實際 ${r.kind}`);
  return r.context;
}

describe('SupabasePaidEmailContextAdapter — 🔴 查詢形狀(送出去的條件,不是回來的資料)', () => {
  it('① 查 orders、按 id 篩、白名單六欄（第六欄 cancelled_at 不進信裡）', async () => {
    const { client: c, queries } = makeClient(ok());
    await load(c);
    expect(queries[0]?.table).toBe('orders');
    expect(queries[0]?.eq).toEqual([['id', ORDER]]);
    // 🔴 逐字釘住整串，不是「有沒有包含」——
    //    包含式的斷言擋不住「多撈了一欄」，而多撈一欄正是這一格要守的東西。
    //    2026-08-24 從五欄變六欄：`cancelled_at` 只用來判「還該不該寄」，**不會被印出去**。
    expect(queries[0]?.columns).toBe(
      'display_id, subtotal, shipping_fee, discount_total, total, cancelled_at',
    );
  });

  it('🔴 ① 的 select 不得出現任何經銷價欄(白名單一旦被改寬,這格必紅)', async () => {
    const { client: c, queries } = makeClient(ok());
    await load(c);
    for (const banned of ['price_store', 'price_by_tier', 'cost', 'price_general', '*']) {
      expect(queries[0]?.columns).not.toContain(banned);
      expect(queries[1]?.columns).not.toContain(banned);
    }
  });

  it('② 查 order_items、按 order_id 篩、排序帶唯一鍵、探針是上限 + 1', async () => {
    const { client: c, queries } = makeClient(ok());
    await load(c);
    expect(queries[1]?.table).toBe('order_items');
    expect(queries[1]?.eq).toEqual([['order_id', ORDER]]);
    expect(queries[1]?.order).toEqual([['id', { ascending: true }]]);
    expect(queries[1]?.limit).toBe(PAID_EMAIL_MAX_LINES + 1);
  });

  it('🔴 ② 不撈 unit_price —— 稿上印小計,多一個價格欄就多一個能被誤印的東西', async () => {
    const { client: c, queries } = makeClient(ok());
    await load(c);
    expect(queries[1]?.columns).not.toContain('unit_price');
  });
});

describe('SupabasePaidEmailContextAdapter — 正常路徑', () => {
  it('撈得到 ⇒ 編號 / 品項 / 四個金額都是【具體的值】', async () => {
    const ctx = expectOk(await load(client(ok())));
    expect(ctx.orderDisplayId).toBe('PCM-2026-0001');
    expect(ctx.subtotal).toBe(31120);
    expect(ctx.shippingFee).toBe(150);
    expect(ctx.discountTotal).toBe(790);
    expect(ctx.total).toBe(30480);
    expect(ctx.lines).toEqual([
      { title: 'Brembo 19RCS 直推式煞車總泵', variantSku: 'BRM-19RCS-CC', quantity: 1, lineTotal: 18400 },
    ]);
    expect(ctx.linesTruncated).toBe(false);
  });

  it('🔴 四個金額對得上 A 版稿那四列(小計 + 運費 − 折扣 = 訂單金額)', async () => {
    const ctx = expectOk(await load(client(ok())));
    expect(ctx.subtotal + ctx.shippingFee - ctx.discountTotal).toBe(ctx.total);
  });

  it('品名快照缺 title ⇒ 那一列 title 是 null(不是空字串、也不是整包失敗)', async () => {
    const ctx = expectOk(await load(client(ok([line({ product_snapshot: {} })]))));
    expect(ctx.lines[0]?.title).toBeNull();
  });

  it('料號是空字串 ⇒ 當成沒有料號(null),不是一個空的料號', async () => {
    const ctx = expectOk(await load(client(ok([line({ variant_sku: '  ' })]))));
    expect(ctx.lines[0]?.variantSku).toBeNull();
  });

  it('折扣 0(Phase 1 多為 0)⇒ 照常回 0,不是 null、也不是失敗', async () => {
    const ctx = expectOk(await load(client(ok([line()], { discount_total: 0, total: 31270 }))));
    expect(ctx.discountTotal).toBe(0);
  });
});

describe('SupabasePaidEmailContextAdapter — 🔴🔴 經銷價零滲入(負向斷言,不是「我沒撈」)', () => {
  it('🔴 原始列帶 price_store / cost / price_by_tier ⇒ 輸出物件裡**一個鍵都沒有**', async () => {
    const dirty = line({ price_store: 111, cost: 222, price_by_tier: { vip: 333 }, price_general: 444 });
    const ctx = expectOk(await load(client(ok([dirty]))));
    const dumped = JSON.stringify(ctx);
    for (const banned of ['price_store', 'cost', 'price_by_tier', 'price_general', '111', '222', '333', '444']) {
      expect(dumped).not.toContain(banned);
    }
    // 逐欄具名建構的正對照:輸出就是這四個鍵,多一個都算滲入。
    expect(Object.keys(ctx.lines[0] ?? {}).sort()).toEqual(['lineTotal', 'quantity', 'title', 'variantSku']);
  });

  it('🔴 表頭列帶經銷價 ⇒ 同樣一個鍵都不進 context', async () => {
    const ctx = expectOk(await load(client([
      { data: [head({ price_store: 999, cost: 888 })], error: null },
      { data: [line()], error: null },
    ])));
    const dumped = JSON.stringify(ctx);
    expect(dumped).not.toContain('999');
    expect(dumped).not.toContain('888');
    expect(Object.keys(ctx).sort()).toEqual([
      'discountTotal', 'lines', 'linesTruncated', 'orderDisplayId', 'shippingFee', 'subtotal', 'total',
    ]);
  });
});

describe('SupabasePaidEmailContextAdapter — 🔴🔴 金額整數,浮點禁入', () => {
  it('🔴 line_total 是小數 ⇒ **throw**,不得無聲取整、也不得寄出', async () => {
    await expect(load(client(ok([line({ line_total: 18400.5 })])))).rejects.toThrow(/integer/i);
  });

  it('🔴 total 是小數 ⇒ throw', async () => {
    await expect(load(client(ok([line()], { total: 30480.01 })))).rejects.toThrow(/integer/i);
  });

  it('🔴 金額是負數 ⇒ throw(付款信不存在負總額;它代表資料壞了)', async () => {
    await expect(load(client(ok([line()], { subtotal: -1 })))).rejects.toThrow(/non-negative/i);
  });
});

describe('SupabasePaidEmailContextAdapter — 🔴 fail-closed(這幾態應該吵)', () => {
  it('🔴 單查不到 ⇒ unavailable', async () => {
    const r = await load(client([{ data: [], error: null }]));
    expect(r.kind).toBe('unavailable');
  });

  it('🔴 撈不到 display_id ⇒ unavailable,**不得用空字串頂替**', async () => {
    const r = await load(client(ok([line()], { display_id: '   ' })));
    expect(r.kind).toBe('unavailable');
  });

  it('🔴 這張單 0 項 ⇒ unavailable,**不寄一封空清單的付款確認信**', async () => {
    const r = await load(client([{ data: [head()], error: null }, { data: [], error: null }]));
    expect(r.kind).toBe('unavailable');
  });

  it('🔴 品項查詢回 data:null ⇒ unavailable', async () => {
    const r = await load(client([{ data: [head()], error: null }, { data: null, error: null }]));
    expect(r.kind).toBe('unavailable');
  });
});

describe('SupabasePaidEmailContextAdapter — 🔴 截斷', () => {
  it('品項超過上限 ⇒ linesTruncated=true,而 lines 只給上限那麼多', async () => {
    const rows = Array.from({ length: PAID_EMAIL_MAX_LINES + 1 }, () => line());
    const ctx = expectOk(await load(client(ok(rows))));
    expect(ctx.linesTruncated).toBe(true);
    expect(ctx.lines).toHaveLength(PAID_EMAIL_MAX_LINES);
  });

  it('剛好等於上限 ⇒ linesTruncated=false(「收滿」與「沒載完」不可混為一談)', async () => {
    const rows = Array.from({ length: PAID_EMAIL_MAX_LINES }, () => line());
    const ctx = expectOk(await load(client(ok(rows))));
    expect(ctx.linesTruncated).toBe(false);
    expect(ctx.lines).toHaveLength(PAID_EMAIL_MAX_LINES);
  });
});

describe('SupabasePaidEmailContextAdapter — 錯誤路徑', () => {
  it('查詢回 error ⇒ throw,訊息帶階段與 code,**不帶 DB 原文**', async () => {
    const p = load(client([{ data: null, error: { code: '42703' } }]));
    await expect(p).rejects.toThrow(PaidContextQueryError);
    await expect(p).rejects.toThrow(/order:42703/);
  });

  it('查詢直接 reject ⇒ 收成固定 code,**不接住原始錯誤物件**', async () => {
    const p = load(client([], { throwOn: 0 }));
    await expect(p).rejects.toThrow(/order:rejected/);
    await expect(p).rejects.not.toThrow(/boom/);
  });

  it('第二段查詢失敗 ⇒ 階段名要指得出是哪一段(凌晨三點的人靠它決定查哪裡)', async () => {
    const p = load(client([{ data: [head()], error: null }], { throwOn: 1 }));
    await expect(p).rejects.toThrow(/items:rejected/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 已取消的單（第三態 `cancelled`；Sean 2026-08-24 拍【甲】：不寄、靜靜記一筆跳過）
//
// ⚠️ **正負兩面都要**：今天全隊的統計是**誤擋比漏擋更常發生**，
//    而誤擋的回饋路徑是「人自己繞過去、不留痕跡」⇒ 它比漏擋更難被發現。
//    ⇒ 所以「該擋的擋」與「正常的單不受影響」在本節是**同等份量**，不是主測 + 附帶。
// ══════════════════════════════════════════════════════════════════════════
describe('🔴 第三態 cancelled — 而它【不是】錯誤', () => {
  it('🔴 cancelled_at 非空 ⇒ 回 cancelled（不是 unavailable，那一態的合約是「應該吵」）', async () => {
    const r = await load(makeClient(ok([line()], { cancelled_at: '2026-08-24T10:00:00Z' })).client);
    expect(r.kind).toBe('cancelled');
  });

  it('🟢 正對照:cancelled_at 是 null ⇒ 照常回 ok（正常的單一個都不能被誤擋）', async () => {
    const r = await load(makeClient(ok([line()], { cancelled_at: null })).client);
    expect(r.kind).toBe('ok');
  });

  it('🟢 正對照:整組金額與品項在「沒被取消」時完全不受本次改動影響', async () => {
    const ctx = expectOk(await load(makeClient(ok()).client));
    expect(ctx.orderDisplayId).toBe('PCM-2026-0001');
    expect(ctx.total).toBe(30480);
    expect(ctx.lines).toHaveLength(1);
  });

  it('🔴 已取消【而且】display_id 是空的 ⇒ 仍回 cancelled，不得回 unavailable', async () => {
    // 這一格釘住「順序」：cancelled 的判斷在 display_id 檢查【之前】。
    // 少了它，一張已取消的單會依 display_id 是否為空而回到兩個不同的態
    // ⇒ 一個【正常業務狀態】會有機率被回報成「應該吵」的那一態。
    const r = await load(
      makeClient(ok([line()], { cancelled_at: '2026-08-24T10:00:00Z', display_id: '' })).client,
    );
    expect(r.kind).toBe('cancelled');
  });

  it('🔴 已取消的單【不會】去查 order_items（省一次查詢，也少一個外洩面）', async () => {
    const { client: c, queries } = makeClient(ok([line()], { cancelled_at: '2026-08-24T10:00:00Z' }));
    await load(c);
    expect(queries.map((q) => q.table)).toEqual(['orders']);
  });

  it('🔴 壞值(空字串)⇒ unavailable(不知道答案 ⇒ 應該吵)', async () => {
    // 本格改過兩次,而兩次方向不同 —— 兩次都留著,它們是同一條線的兩段。
    // 第一版:期望「空字串不算已取消」⇒ 紅了。我沒改碼配合期望,
    //   先問「哪一邊錯得比較輕」⇒ 選了 fail-closed(當成已取消)。
    // 🔴 第二版(2026-08-24 codex R2 M3):**那個 fail-closed 選錯了【態】。**
    //   當時只比較「寄」與「不寄」,而漏掉第三個選項:**不寄【而且吵】**。
    //     cancelled   = 正常業務動作 ⇒ 合約是「不吵」
    //     unavailable = 判斷與資料對不上 ⇒ 合約是「**應該吵**」
    //   空字串是**壞資料**,不是一個業務狀態 ⇒ 說成 cancelled 等於
    //   **把一次系統故障靜靜歸檔成一次正常取消**。
    // 📌 判別句:**這個值讓我知道答案了嗎?** 知道 ⇒ 照答案走;不知道 ⇒ 走那個會吵的態。
    // ⚠️ 這個輸入在正式庫造不出來(timestamptz 只回時間字串或 null)
    //    ⇒ 本格守的是**寫法**不是**現實**:釘住「不要用 !! 把壞值判成一個正常狀態」。
    const r = await load(makeClient(ok([line()], { cancelled_at: '' })).client);
    expect(r.kind).toBe('unavailable');
  });

  it('🔴 欄位沒回來(undefined)⇒ 也是 unavailable —— 與空字串【同極性】', async () => {
    // 🔴 第一版:空字串 fail-closed 而 undefined 卻被當成「未取消」繼續回 ok
    //    ⇒ **同一個 if 裡兩種極性**,而缺欄(回應漂移 / fixture 漂移)時
    //      取消判斷會**靜默失效** —— 沒有錯誤、沒有訊號、信照寄。
    // 📌 這是「同一份檔裡對一半嚴格、對另一半寬容」的最濃縮版本:**它在同一個 if 裡。**
    const h = head();
    delete (h as Record<string, unknown>).cancelled_at;
    const r = await load(
      makeClient([{ data: [h], error: null }, { data: [line()], error: null }]).client,
    );
    expect(r.kind).toBe('unavailable');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 M3(codex 2026-08-24):**三態不得被合併**
//
// ⚠️ **本節不叫「窮舉點」**(2026-08-24 R3/Fable F4 —— 那個名字比它做到的事寬):
//    「**這裡的測試會紅**」與「**S4 寫錯會紅**」是兩個宣稱,而本節**只證明了第一個**。
//
// 病灶:`LoadPaidContextResult` 是 discriminated union,而它**只保證**「你不能把
// `cancelled` 當成 `ok` 去取 `.context`」。它**擋不住** `if (r.kind !== 'ok')` ——
// 那個寫法型別上合法,而它把 `cancelled` 與 `unavailable` **合併成同一個分支**,
// 🔴 而那正好是 Sean 拍板要分開的兩件事(不寄 vs 應該吵)。
//
// ⇒ 本節就是那個窮舉點。**日後加第四態時,下面 `never` 那一行會【編譯期】紅。**
// ⚠️ 它守的是**型別**不是**行為** —— 它擋不住 S4 真的寫 `!== 'ok'`。
//    那一半只有 code review 與 port docstring 擋得住,**照實寫,不假裝覆蓋。**
// ══════════════════════════════════════════════════════════════════════════
describe('🔴 三態各自落到不同分支(加第四態時這裡會編譯期紅)', () => {
  /** 三個分支各自回一個可分辨的字串;`default` 那行是真正的守門。 */
  function classify(r: Awaited<ReturnType<typeof load>>): string {
    switch (r.kind) {
      case 'ok':
        return '寄';
      case 'cancelled':
        return '不寄-不吵';
      case 'unavailable':
        return '不寄-要吵';
      default: {
        const _exhaustive: never = r;
        return _exhaustive;
      }
    }
  }

  it('🔴 三態各自落到【不同】的分支(合併成兩態的話,這一格會有兩個值相同)', async () => {
    const got = [
      classify(await load(makeClient(ok()).client)),
      classify(await load(makeClient(ok([line()], { cancelled_at: '2026-08-24T10:00:00Z' })).client)),
      classify(await load(makeClient([{ data: [], error: null }]).client)),
    ];
    expect(got).toEqual(['寄', '不寄-不吵', '不寄-要吵']);
    // 🔴 三個值兩兩不同 —— 這一行才是「Sean 要的那兩件事沒有被合併」的證人。
    expect(new Set(got).size).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 M5(codex 2026-08-24):**交錯格 —— 而它記錄的是一個【還沒修】的缺口**
//
// codex 的問題:「orders 回未取消 → 查 items 期間才取消 → 會不會仍送出?」
// **會。** 本層在【表頭查詢當下】就把 `cancelled_at` 讀完了,之後不再回頭看。
//
// 🔴 **本節【不是】在驗一個功能,是在把那個窗口釘成可見的** ——
//    因為原本的取消測試全部用「查詢開始前就固定好」的 fixture,
//    **它們證明了我想證明的,而證明不了 codex 問的這件。**
//
// ✅ 修法【不在本層】:S4 要在靠近 `send()` 的地方再判一次(見 port docstring 的 S4 合約)。
// ⚠️ 所以下面第二格釘住「本層只查兩次表、不會回頭重讀 orders」——
//    哪天有人在**這裡**加第二次讀取,那一格會紅,而**他該做的是同時更新 S4 合約**,不是刪掉它。
// ══════════════════════════════════════════════════════════════════════════
describe('🔴 交錯:表頭讀完【之後】才取消 —— 本層看不見(已知缺口,不是功能)', () => {
  /** 表頭回「未取消」;而在 items 查詢**解析的當下**,外面那張單已經被取消了。 */
  function interleavedClient() {
    let cancelledInTheRealWorld = false;
    const { client: c, queries } = makeClient([
      { data: [head({ cancelled_at: null })], error: null },
      // 這一筆的 data 在被讀取時才產生 ⇒ 模擬「查 items 期間世界變了」
      { get data() {
          cancelledInTheRealWorld = true;
          return [line()];
        }, error: null },
    ]);
    return { client: c, queries, seeCancelled: () => cancelledInTheRealWorld };
  }

  it('🔴 表頭讀完後才取消 ⇒ 本層仍回 ok(這是缺口,S4 必須在 send() 附近再判一次)', async () => {
    const { client: c, seeCancelled } = interleavedClient();
    const r = await load(c);
    expect(r.kind).toBe('ok');
    // 🔴 而「世界確實已經變了」要被證明,否則這一格只是在測一個沒發生的交錯。
    expect(seeCancelled()).toBe(true);
  });

  it('🔴 成因是機械的:本層只查兩次表,不會回頭重讀 orders', async () => {
    const { client: c, queries } = interleavedClient();
    await load(c);
    expect(queries.map((q) => q.table)).toEqual(['orders', 'order_items']);
  });
});
