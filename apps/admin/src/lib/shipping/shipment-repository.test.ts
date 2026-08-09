// shipment-repository.test.ts — 出貨 RPC 呼叫面的守門。
//
// 🔴 **這支守的是兩件文字層以外看不到的事**:
//   ① **參數名漂移**:五支 RPC 的 `GRANT EXECUTE` 綁**精確簽章**
//      (`…w1_shipping_rpc_skeletons.sql:207-220`)。參數名改一個字 ⇒ PostgREST 找不到那個
//      overload ⇒ **執行期 42501/404**,而 migration 本身全綠。
//      幸好五支都已進生成型別 ⇒ 打錯會被 typecheck 擋;**但只有在呼叫端真的用字面鍵**時才擋得到,
//      有人改成 `{...spread}` 或 `as any` 就穿過去了 ⇒ 本檔用**讀原始碼**再釘一層。
//   ② **回傳信封被硬轉**:RPC 宣告回傳 `Json`,`as ShipmentWriteResult` 會讓「DB 真的回了這些鍵」
//      變成沒人驗的假設,少一個鍵時 `undefined` 一路流進畫面變成空白箱號。
//
// ⚠️ **它擋不住什麼**:這裡全是 mock,**證不了 RPC 真的存在、真的收這些參數、真的回這個形狀**。
//    本 worktree 無 DB ⇒ 真 DB smoke 是收割端的格(`D-347-A` 明列)。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc, from }),
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(resolve(HERE, 'shipment-repository.ts'), 'utf8');
/**
 * 🔴 **剝註解再掃,而且用等長空白代換**(行號不位移)。
 * 第一版直接掃原始碼 ⇒ 「不得出現 randomUUID」那條當場自己紅了 ——
 * 命中的是我寫在**註解裡當反例**的那句 `randomUUID()`。
 * 這是「字串出現 ≠ 那是程式碼」那一族;本 repo 今天已經在
 * `color-tokens.test.ts` 與 impeccable 偵測器上各中過一次。
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

/** 一個合法的信封(五鍵,形狀由 `pcm_b2_shipping_idem_response` 單一產生處決定)。 */
const ENVELOPE = {
  id: 'a1',
  shipment_reference: 'K7X2MP',
  customer_user_id: 'cu-1',
  shipment_id: 'sh-1',
  idempotent: false,
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: ENVELOPE, error: null });
});

describe('出貨 RPC 呼叫面 · 參數名逐字釘死(GRANT 綁精確簽章)', () => {
  // 🔴 期望值是從 migration 抄來的,不是從實作抄的 —— 從實作抄等於拿被測物當答案。
  //    來源:`20260807150000_…w1_shipping_rpc_skeletons.sql:207-220` 的 REVOKE/GRANT 字面,
  //    以及各 writer 的 `CREATE OR REPLACE FUNCTION` 參數列。
  const CONTRACT: ReadonlyArray<{ fn: string; params: readonly string[] }> = [
    { fn: 'admin_create_shipment', params: ['p_idempotency_key', 'p_customer_user_id', 'p_recipient_snapshot', 'p_carrier_code', 'p_carrier_note'] },
    { fn: 'admin_add_shipment_items', params: ['p_idempotency_key', 'p_shipment_id', 'p_items'] },
    { fn: 'admin_mark_shipment_shipped', params: ['p_idempotency_key', 'p_shipment_id', 'p_tracking_number'] },
    { fn: 'admin_void_shipment', params: ['p_idempotency_key', 'p_shipment_id', 'p_void_reason'] },
    { fn: 'admin_unvoid_shipment', params: ['p_idempotency_key', 'p_shipment_id'] },
  ];

  it('🔴 前提 — 五支 RPC 名稱都真的出現在本檔(改名了下面整組會變恆真)', () => {
    const missing = CONTRACT.filter((c) => !SRC.includes(`'${c.fn}'`)).map((c) => c.fn);
    expect(missing, 'RPC 名稱在 shipment-repository.ts 裡找不到 ⇒ 被改名或刪了,下面的參數斷言失去對象').toEqual([]);
  });

  for (const c of CONTRACT) {
    it(`🔴 ${c.fn} — 參數名逐字對得上 migration(漂一個字 = 執行期 42501)`, () => {
      const at = SRC.indexOf(`'${c.fn}'`);
      // 取這支呼叫的引數物件字面(到下一個 `);` 為止)
      const block = SRC.slice(at, SRC.indexOf(');', at));
      const missing = c.params.filter((p) => !new RegExp(`\\b${p}\\s*:`).test(block));
      expect(
        missing,
        `${c.fn} 的呼叫端少了這些參數鍵:${missing.join(', ')}。` +
          'GRANT EXECUTE 綁的是精確簽章,鍵名漂掉 ⇒ PostgREST 解析不到該 overload ⇒ 執行期 42501/404,' +
          '而 migration 與 typecheck 都可能全綠(有人用 spread 或 as any 就會繞過型別)。',
      ).toEqual([]);
    });
  }

  it('🔴 呼叫端不得用 spread / as any 餵引數(那會讓型別與本檔的字面守門同時失效)', () => {
    const calls = [...SRC.matchAll(/\.rpc\('(\w+)',\s*\{([\s\S]*?)\}\s*\)/g)];
    expect(calls.length, '掃不到任何 `.rpc(name, {…})` 形式的呼叫 ⇒ 呼叫形狀變了,本組守門要重寫').toBe(5);
    const bad = calls
      .filter((m) => /\.\.\.\w/.test(m[2] ?? '') || /as\s+any/.test(m[2] ?? ''))
      .map((m) => m[1]);
    // 註:`...(cond ? {} : { p_x: v })` 這種**條件性可選參數**是允許的(帶 DEFAULT 的參數不給就別送),
    //     所以只擋展開**變數**(`...args`)與 `as any`,不擋展開字面物件。
    expect(bad, `這些呼叫用了 spread 變數或 as any:${bad.join(', ')}`).toEqual([]);
  });
});

describe('回傳信封 · 不得硬轉、缺鍵要當場炸', () => {
  it('🔴 原始碼裡不得出現 `as ShipmentWriteResult`(硬轉 = 把 DB 回了什麼變成沒人驗的假設)', () => {
    expect(
      SRC,
      '有人把回傳硬轉成 ShipmentWriteResult ⇒ 少一個鍵時不會炸,`undefined` 會一路流進畫面變成空白箱號',
    ).not.toMatch(/as\s+ShipmentWriteResult/);
  });

  it('信封五鍵齊全 → 正常收斂', async () => {
    const { createShipment } = await import('./shipment-repository');
    const r = await createShipment({
      idempotencyKey: 'k1',
      customerUserId: 'cu-1',
      recipient: { name: '陳彥廷', phone: '0912', line: '台北市…' },
      carrierCode: 'hct',
    });
    expect(r).toEqual({
      shipmentId: 'sh-1',
      shipmentReference: 'K7X2MP',
      customerUserId: 'cu-1',
      idempotent: false,
    });
  });

  it('🔴 缺 `idempotent` → 丟錯(那是「有沒有真的動到資料」的唯一訊號,缺了就分不出成功與重放)', async () => {
    const { shipment_id, shipment_reference, customer_user_id } = ENVELOPE;
    rpc.mockResolvedValue({ data: { shipment_id, shipment_reference, customer_user_id }, error: null });
    const { unvoidShipment } = await import('./shipment-repository');
    await expect(unvoidShipment({ idempotencyKey: 'k', shipmentId: 's' })).rejects.toThrow(/idempotent/);
  });

  it('🔴 缺 `shipment_reference` → 丟錯(空箱號流進畫面,員工會看到一個沒有編號的箱子)', async () => {
    rpc.mockResolvedValue({ data: { ...ENVELOPE, shipment_reference: undefined }, error: null });
    const { voidShipment } = await import('./shipment-repository');
    await expect(
      voidShipment({ idempotencyKey: 'k', shipmentId: 's', voidReason: '客人改地址' }),
    ).rejects.toThrow(/shipment_reference/);
  });

  it('🔴 回傳是陣列 → 丟錯(w2 註解記著:非 object 會讓信封的 `||` 變成陣列串接、旗標整個消失)', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { markShipmentShipped } = await import('./shipment-repository');
    await expect(markShipmentShipped({ idempotencyKey: 'k', shipmentId: 's' })).rejects.toThrow(/JSON 物件/);
  });
});

describe('冪等鍵 · 必須由呼叫端給、本檔不得自己產', () => {
  // 🔴 若在這裡 `randomUUID()`,每次重試都是新鍵 ⇒ 冪等層完全失效**而且零症狀**
  //    (兩次呼叫都「成功」,DB 真的做了兩次)。這條擋的就是那個改法。
  it('原始碼不得出現 randomUUID / uuid() / Date.now() 之類的鍵產生器', () => {
    expect(SRC, '本檔自己產冪等鍵 ⇒ 重試沿用不到同一把鍵、冪等層失效且零症狀').not.toMatch(
      /randomUUID|crypto\.randomUUID|uuidv4|Date\.now\(\)/,
    );
  });

  it('五支 writer 的參數物件都把 idempotencyKey 傳進去(不是留空給 DB 自己想辦法)', async () => {
    const m = await import('./shipment-repository');
    const runs: Array<() => Promise<unknown>> = [
      () => m.createShipment({ idempotencyKey: 'K-1', customerUserId: 'c', recipient: { name: 'n', phone: 'p', line: 'l' }, carrierCode: 'hct' }),
      () => m.addShipmentItems({ idempotencyKey: 'K-2', shipmentId: 's', items: [{ orderItemId: 'oi', quantity: 1 }] }),
      () => m.markShipmentShipped({ idempotencyKey: 'K-3', shipmentId: 's', trackingNumber: 't' }),
      () => m.voidShipment({ idempotencyKey: 'K-4', shipmentId: 's', voidReason: 'r' }),
      () => m.unvoidShipment({ idempotencyKey: 'K-5', shipmentId: 's' }),
    ];
    for (const [i, run] of runs.entries()) {
      rpc.mockClear();
      await run();
      const args = rpc.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(args?.p_idempotency_key, `第 ${i + 1} 支沒把冪等鍵傳進 RPC`).toBe(`K-${i + 1}`);
    }
  });
});

describe('可選參數 · 不給就不要送(帶 DEFAULT 的參數送 undefined 會變成新 overload 的形狀)', () => {
  it('carrierNote 未給時,引數物件裡不得出現 p_carrier_note 這個鍵', async () => {
    const { createShipment } = await import('./shipment-repository');
    await createShipment({ idempotencyKey: 'k', customerUserId: 'c', recipient: { name: 'n', phone: 'p', line: 'l' }, carrierCode: 'hct' });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args), '未給 carrierNote 卻送了 p_carrier_note 鍵').not.toContain('p_carrier_note');
  });

  it('carrierNote 有給時要送出去(選「其他」時 DB 要求必填)', async () => {
    const { createShipment } = await import('./shipment-repository');
    await createShipment({ idempotencyKey: 'k', customerUserId: 'c', recipient: { name: 'n', phone: 'p', line: 'l' }, carrierCode: 'other', carrierNote: '客人自取' });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_carrier_note).toBe('客人自取');
  });

  it('trackingNumber 未給時,引數物件裡不得出現 p_tracking_number', async () => {
    const { markShipmentShipped } = await import('./shipment-repository');
    await markShipmentShipped({ idempotencyKey: 'k', shipmentId: 's' });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain('p_tracking_number');
  });
});

describe('掛品項 · 形狀轉換', () => {
  it('items 轉成 DB 要的 snake_case 鍵(order_item_id / quantity)', async () => {
    const { addShipmentItems } = await import('./shipment-repository');
    await addShipmentItems({
      idempotencyKey: 'k',
      shipmentId: 's',
      items: [{ orderItemId: 'oi-1', quantity: 2 }],
    });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_items).toEqual([{ order_item_id: 'oi-1', quantity: 2 }]);
  });

  it('🔴 掛品項不自行擋重複 order_item_id —— 那是 DB 的正確性層,這裡擋會變成第二個真相源', () => {
    // 🔴 **只掃 `addShipmentItems` 的函式體**,不是整個檔案。
    //    原本掃全檔;而 2026-08-09 加進來的 `listCustomerUserIdsByOrderItemIds` 合法地用
    //    `new Set(...)` 去重訂單 id / 收斂擁有者集合 —— 與掛品項的重複偵測完全無關,
    //    卻讓本條變成**假紅**。⚠️ 這條守的性質是「**掛品項這條路徑上**沒有第二個真相源」,
    //    那個不變量成立的面就是這支函式;把面畫成整個檔是畫錯了。
    const at = SRC.indexOf('export async function addShipmentItems');
    expect(at, '找不到 addShipmentItems 宣告 ⇒ 本條要重寫').toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf('\nexport ', at + 1));
    expect(body.length, '切出來的函式體太短 ⇒ 本條會退化成恆真').toBeGreaterThan(100);
    expect(
      body,
      'addShipmentItems 出現了重複偵測邏輯 ⇒ 與 DB 的 `pcm_b2_w3b2_items_duplicate` 變成兩個真相源,' +
        '兩邊哪天不一致時症狀是「UI 說可以、DB 說不行」或更糟的反過來',
    ).not.toMatch(/dedup|duplicate|new Set\(/i);
  });
});

describe('已配箱數量 · 與 shipped_quantity 是不同的問題', () => {
  /** 建一個 supabase 查詢鏈的 mock,記錄呼叫過的過濾條件。 */
  function chain(rows: unknown[]) {
    const calls: Record<string, unknown[]> = {};
    const rec = (k: string) => (...a: unknown[]) => {
      calls[k] = a;
      return api;
    };
    const api: Record<string, unknown> = {
      select: rec('select'),
      in: rec('in'),
      is: (...a: unknown[]) => {
        calls.is = a;
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return { api, calls };
  }

  it('🔴 必須排除已作廢的箱(作廢後品項要回到可出貨池,漏過濾等於把貨永久鎖住)', async () => {
    const { api, calls } = chain([]);
    from.mockReturnValue(api);
    const { listAssignedQuantitiesByOrderItemIds } = await import('./shipment-repository');
    await listAssignedQuantitiesByOrderItemIds(['oi-1']);
    expect(calls.is, '查詢沒有對 shipments.deleted_at 過濾 ⇒ 作廢箱裡的品項仍被算成已配箱').toEqual([
      'shipments.deleted_at',
      null,
    ]);
    expect(
      String(calls.select?.[0] ?? ''),
      'select 沒有用 `shipments!inner` ⇒ 巢狀過濾不會生效(outer join 下 null 側會被保留)',
    ).toContain('shipments!inner');
  });

  it('同一品項散在多箱 → 數量相加', async () => {
    const { api } = chain([
      { order_item_id: 'oi-1', shipped_quantity: 1, shipments: { deleted_at: null } },
      { order_item_id: 'oi-1', shipped_quantity: 2, shipments: { deleted_at: null } },
      { order_item_id: 'oi-2', shipped_quantity: 5, shipments: { deleted_at: null } },
    ]);
    from.mockReturnValue(api);
    const { listAssignedQuantitiesByOrderItemIds } = await import('./shipment-repository');
    const m = await listAssignedQuantitiesByOrderItemIds(['oi-1', 'oi-2']);
    expect(m.get('oi-1'), '同一品項分裝兩箱時數量沒有相加 ⇒ 會讓它看起來還能再出').toBe(3);
    expect(m.get('oi-2')).toBe(5);
  });

  it('🔴 本檔不得改用 `shipped_quantity` 欄(那是「已寄出」,不含草稿箱 ⇒ 會被裝進第二個箱)', () => {
    expect(
      SRC,
      '出現了 order_item_quantity_summary / shipped_quantity 欄的讀取 ⇒ ' +
        '那一欄只算已寄出,已放進**草稿箱**的品項仍會顯示可選、被裝進第二個箱子。' +
        '建箱畫面要問的是「已配進任何未作廢的箱」,不是「已寄出」。',
    ).not.toMatch(/order_item_quantity_summary/);
  });

  it('空輸入短路,不發請求', async () => {
    const { listAssignedQuantitiesByOrderItemIds } = await import('./shipment-repository');
    expect((await listAssignedQuantitiesByOrderItemIds([])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('讀取面 · 空輸入短路', () => {
  it('🔴 orderItemIds 為空時不得發出請求(PostgREST 的 `in.()` 行為不保證)', async () => {
    const { listShipmentItemsByOrderItemIds } = await import('./shipment-repository');
    const r = await listShipmentItemsByOrderItemIds([]);
    expect(r).toEqual([]);
    expect(from, '空輸入還是打了一次 DB').not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// 2026-08-09:「箱子掛誰」的來源(codex R1 打回來之後補)。
// ─────────────────────────────────────────────────────────────
describe('🔴🔴 品項 → 客人反查 · 全程 fail-closed', () => {
  /**
   * 依查的是哪張表回不同的列;`.in()` 直接結束鏈。
   *
   * 🔴 **`.select()` 與 `.in()` 的參數要記下來。** 第一版把它們整個忽略,而 codex R2 當場指出:
   *    那樣把正式查詢改成 `.in('id', ['亂寫'])`,底下六條**照樣全綠** ——
   *    測到的只有「有沒有查兩張表」,沒測到「查的是不是送進去的那批品項」。
   */
  function tables(byTable: Record<string, unknown[]>) {
    const seen: string[] = [];
    /** 每張表被查了什麼:`{ table, columns, filterColumn, filterValues }`。 */
    const queries: { table: string; columns: string; filterColumn: string; filterValues: unknown }[] = [];
    from.mockImplementation((t: string) => {
      seen.push(t);
      return {
        select: (columns: string) => ({
          in: (filterColumn: string, filterValues: unknown) => {
            queries.push({ table: t, columns, filterColumn, filterValues });
            return Promise.resolve({ data: byTable[t] ?? [], error: null });
          },
        }),
      };
    });
    return { seen, queries };
  }

  it('兩個品項同屬一位客人 → 集合裡恰好一位', async () => {
    void tables({
      order_items: [
        { id: 'oi-1', order_id: 'o1' },
        { id: 'oi-2', order_id: 'o2' },
      ],
      orders: [
        { id: 'o1', customer_user_id: 'cu-A' },
        { id: 'o2', customer_user_id: 'cu-A' },
      ],
    });
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    expect([...(await listCustomerUserIdsByOrderItemIds(['oi-1', 'oi-2']))]).toEqual(['cu-A']);
  });

  it('🔴 跨兩位客人 → 集合有兩位(呼叫端據此不建箱)', async () => {
    void tables({
      order_items: [
        { id: 'oi-1', order_id: 'o1' },
        { id: 'oi-2', order_id: 'o2' },
      ],
      orders: [
        { id: 'o1', customer_user_id: 'cu-A' },
        { id: 'o2', customer_user_id: 'cu-B' },
      ],
    });
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    expect((await listCustomerUserIdsByOrderItemIds(['oi-1', 'oi-2'])).size).toBe(2);
  });

  it('🔴 有品項查不到 → 整批回空集合(不是拿查得到的那些「湊」一位出來)', async () => {
    void tables({
      order_items: [{ id: 'oi-1', order_id: 'o1' }], // oi-2 查不到
      orders: [{ id: 'o1', customer_user_id: 'cu-A' }],
    });
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    expect(
      (await listCustomerUserIdsByOrderItemIds(['oi-1', 'oi-2'])).size,
      '清單裡混一個不存在的品項時仍推出「恰好一位客人」⇒ 箱子照建,' +
        '那個假品項要到掛品項才被 FK 擋掉,而箱子已經留在 DB 裡了(禁刪、只能作廢)。',
    ).toBe(0);
  });

  it('🔴 有訂單查不到客人 → 整批回空集合', async () => {
    void tables({
      order_items: [
        { id: 'oi-1', order_id: 'o1' },
        { id: 'oi-2', order_id: 'o2' },
      ],
      orders: [{ id: 'o1', customer_user_id: 'cu-A' }], // o2 那列讀不到
    });
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    expect((await listCustomerUserIdsByOrderItemIds(['oi-1', 'oi-2'])).size).toBe(0);
  });

  it('空輸入短路,不發請求', async () => {
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    expect((await listCustomerUserIdsByOrderItemIds([])).size).toBe(0);
    expect(from, '空輸入還是打了一次 DB').not.toHaveBeenCalled();
  });

  it('🔴 兩次查詢分別打 order_items 與 orders(不押在本專案測不了的內嵌 join 語意上)', async () => {
    const { seen } = tables({
      order_items: [{ id: 'oi-1', order_id: 'o1' }],
      orders: [{ id: 'o1', customer_user_id: 'cu-A' }],
    });
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    await listCustomerUserIdsByOrderItemIds(['oi-1']);
    expect(
      seen,
      '改成內嵌 join 了 ⇒ 過濾/展開語意押在本專案無法實測的 PostgREST 行為上' +
        '(本機是裸 PG、沒有 PostgREST)。',
    ).toEqual(['order_items', 'orders']);
  });

  it('🔴🔴 兩次查詢都真的**綁在送進去的那批 id 上**(投影欄與過濾條件逐項核)', async () => {
    const { queries } = tables({
      order_items: [
        { id: 'oi-1', order_id: 'o1' },
        { id: 'oi-2', order_id: 'o2' },
      ],
      orders: [
        { id: 'o1', customer_user_id: 'cu-A' },
        { id: 'o2', customer_user_id: 'cu-A' },
      ],
    });
    const { listCustomerUserIdsByOrderItemIds } = await import('./shipment-repository');
    await listCustomerUserIdsByOrderItemIds(['oi-1', 'oi-2']);

    // 🔴 這條擋的是「反查根本沒綁在輸入上」:把 `.in('id', [...wanted])` 改成任何別的清單,
    //    上面那些「回幾位客人」的測試**照樣全綠**(codex R2 指出的缺口)。
    expect(queries[0], '第一段沒有拿送進來的品項 id 去查').toEqual({
      table: 'order_items',
      columns: 'id, order_id',
      filterColumn: 'id',
      filterValues: ['oi-1', 'oi-2'],
    });
    expect(queries[1], '第二段沒有拿第一段查出來的 order_id 去查').toEqual({
      table: 'orders',
      columns: 'id, customer_user_id',
      filterColumn: 'id',
      filterValues: ['o1', 'o2'],
    });
    // 🔴 投影只有兩欄 —— 這條路徑上不得順手多撈金額或 PII。
    expect(queries[1]!.columns, 'orders 的投影長出第三欄 ⇒ 這支是「只取 id 對照」的窄查詢').not.toMatch(
      /total|shipping_address_snapshot|invoice/,
    );
  });
});
