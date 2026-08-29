/**
 * SupabaseCouponAdapter 的守門。
 *
 * 🔴 這支測的**不是「它會不會跑」** —— 是那三件【壞掉不會讓畫面看起來壞掉】的事:
 *    ① 投影白名單被人動了(而多一欄就是多一欄流到前端)
 *    ② `nullsFirst` 漏給(⇒ 排序看起來正常而第一頁全是不該在前面的)
 *    ③ 唯一次排序鍵漏給(⇒ 翻頁重複 / 漏列, 而每一頁自己看都正常)
 */
import { describe, expect, it } from 'vitest';

import {
  ADMIN_COUPON_LIST_SELECT,
  ADMIN_COUPON_LIST_VIEW,
  SupabaseCouponAdapter,
} from './SupabaseCouponAdapter';

type OrderCall = { column: string; opts?: { ascending?: boolean; nullsFirst?: boolean } };

/** 記錄 adapter 對 client 下了什麼 —— 不打真的 DB。 */
function makeSpyClient(rows: unknown[] = [], count = 0) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    eq: [] as Array<[string, unknown]>,
    order: [] as OrderCall[],
    range: [] as Array<[number, number]>,
  };
  const q: Record<string, unknown> = {};
  q.select = (sel: string) => {
    calls.select.push(sel);
    return q;
  };
  q.eq = (col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return q;
  };
  q.order = (column: string, opts?: OrderCall['opts']) => {
    calls.order.push({ column, opts });
    return q;
  };
  q.range = (a: number, b: number) => {
    calls.range.push([a, b]);
    return Promise.resolve({ data: rows, error: null, count });
  };
  const client = {
    from: (t: string) => {
      calls.from.push(t);
      return q;
    },
  };
  return { client: client as never, calls };
}

describe('投影白名單 — byte-equal 守門', () => {
  it('🔴 逐字比對:改了這一行就會紅（多一欄 = 多一欄流到前端）', () => {
    expect(ADMIN_COUPON_LIST_SELECT).toBe(
      'id, code, description, discount_type, discount_value, ends_on, max_redemptions, ' +
        'max_per_account, min_spend, stacks_with_tier, is_active, created_at, created_by, ' +
        'creator_label, used_count, coupon_level_blocks',
    );
  });

  it('🔴 禁 select(*)', () => {
    expect(ADMIN_COUPON_LIST_SELECT).not.toContain('*');
  });

  it('讀的是那支 view，不是底表（底表對 service_role 是零表權限）', () => {
    expect(ADMIN_COUPON_LIST_VIEW).toBe('admin_coupon_list_blocks_v');
    expect(ADMIN_COUPON_LIST_VIEW).not.toBe('coupons');
  });
});

describe('排序 — 兩個壞了也看不出來的坑', () => {
  it('🔴 nullsFirst:false —— 而【兩個方向都要給】', async () => {
    for (const ascending of [true, false]) {
      const { client, calls } = makeSpyClient();
      await new SupabaseCouponAdapter(client).listCouponsForAdmin({}, { limit: 20 }, {
        key: 'endsOn',
        ascending,
      });
      const endsOn = calls.order.find((o) => o.column === 'ends_on');
      expect(endsOn?.opts?.nullsFirst).toBe(false);
      expect(endsOn?.opts?.ascending).toBe(ascending);
    }
  });

  it('🔴 一律追加 id 當唯一次排序鍵 —— 而它要在【最後】', async () => {
    const { client, calls } = makeSpyClient();
    await new SupabaseCouponAdapter(client).listCouponsForAdmin({}, { limit: 20 }, {
      key: 'usedCount',
      ascending: false,
    });
    expect(calls.order.map((o) => o.column)).toEqual(['used_count', 'id']);
  });

  it('沒給 sort ⇒ created_at DESC，而 id 那把仍然在', async () => {
    const { client, calls } = makeSpyClient();
    await new SupabaseCouponAdapter(client).listCouponsForAdmin({}, { limit: 20 });
    expect(calls.order).toEqual([
      { column: 'created_at', opts: { ascending: false } },
      { column: 'id', opts: { ascending: true } },
    ]);
  });

  it('排序鍵 → 欄名是唯一那張表（負對照：不得直接把 camel 丟進 SQL）', async () => {
    const { client, calls } = makeSpyClient();
    await new SupabaseCouponAdapter(client).listCouponsForAdmin({}, { limit: 20 }, {
      key: 'endsOn',
      ascending: true,
    });
    expect(calls.order[0]?.column).toBe('ends_on');
    expect(calls.order[0]?.column).not.toBe('endsOn');
  });
});

describe('篩選與分頁', () => {
  it('isActive 給了才下 eq；沒給 ⇒ 一個 eq 都不下', async () => {
    const a = makeSpyClient();
    await new SupabaseCouponAdapter(a.client).listCouponsForAdmin({ isActive: true }, { limit: 20 });
    expect(a.calls.eq).toEqual([['is_active', true]]);

    const b = makeSpyClient();
    await new SupabaseCouponAdapter(b.client).listCouponsForAdmin({}, { limit: 20 });
    expect(b.calls.eq).toEqual([]);
  });

  it('🔴 isActive:false 要下得出去 —— 它不是「沒給」', async () => {
    // `if (filter.isActive)` 這種寫法會把 false 當沒給 ⇒ 「已停用」那個篩選會失效，
    // 而畫面上它看起來像「沒有已停用的券」。
    const { client, calls } = makeSpyClient();
    await new SupabaseCouponAdapter(client).listCouponsForAdmin({ isActive: false }, { limit: 20 });
    expect(calls.eq).toEqual([['is_active', false]]);
  });

  it('range 兩端皆含（offset ~ offset+limit-1）', async () => {
    const { client, calls } = makeSpyClient();
    await new SupabaseCouponAdapter(client).listCouponsForAdmin({}, { limit: 20, offset: 40 });
    expect(calls.range).toEqual([[40, 59]]);
  });

  it('total 走 count，不是 items.length', async () => {
    const { client } = makeSpyClient([{ id: 'a' }], 137);
    const r = await new SupabaseCouponAdapter(client).listCouponsForAdmin({}, { limit: 20 });
    expect(r.total).toBe(137);
    expect(r.items).toHaveLength(1);
  });
});
