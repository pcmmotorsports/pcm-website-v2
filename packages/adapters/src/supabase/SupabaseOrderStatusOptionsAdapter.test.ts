// SupabaseOrderStatusOptionsAdapter.test.ts — 訂單處理狀態詞彙讀 adapter(M-4a Slice A)。
//
// 注入式 mock SupabaseClient 攔 from('order_status_options').select(...).order(...) 鏈:
// 斷言白名單 byte-equal + spy、sort_order ASC、row→domain mapper(text_color narrow)、
// error 裸 throw(caller〔admin 頁〕退降級態)。

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseOrderStatusOptionsAdapter,
  ORDER_STATUS_OPTIONS_SELECT,
} from './SupabaseOrderStatusOptionsAdapter';

function makeClient(result: { data: unknown; error: unknown }) {
  const order = vi.fn();
  const builder = Object.assign(Promise.resolve(result), { order });
  order.mockReturnValue(builder); // .order().order() 可鏈、await 得 result(thenable builder)
  const select = vi.fn().mockReturnValue(builder);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, order };
}

describe('SupabaseOrderStatusOptionsAdapter.listOrderStatusOptions', () => {
  it('🔴 鐵則 12 慣例縱深:ORDER_STATUS_OPTIONS_SELECT byte-equal 具名白名單(禁 *)', () => {
    expect(ORDER_STATUS_OPTIONS_SELECT).toBe(
      'code, label, color, text_color, sort_order, is_active',
    );
    expect(ORDER_STATUS_OPTIONS_SELECT).not.toContain('*');
  });

  it('查詢鏈 order_status_options / select(白名單) / order(sort_order asc);row → OrderStatusOption', async () => {
    const { client, from, select, order } = makeClient({
      data: [
        {
          code: 'received_confirmed',
          label: '已收已定',
          color: '#FBE4A6',
          text_color: 'dark',
          sort_order: 10,
          is_active: true,
        },
        {
          code: 'unpaid_shipped',
          label: '未收出貨',
          color: '#A52A2A',
          text_color: 'light',
          sort_order: 50,
          is_active: false, // soft-delete:仍回傳(舊單 badge 解析),UI 端 filter(isActive)
        },
      ],
      error: null,
    });

    const res = await new SupabaseOrderStatusOptionsAdapter(client).listOrderStatusOptions();

    expect(from).toHaveBeenCalledWith('order_status_options');
    expect(select).toHaveBeenCalledWith(ORDER_STATUS_OPTIONS_SELECT);
    expect(order).toHaveBeenNthCalledWith(1, 'sort_order', { ascending: true });
    expect(order).toHaveBeenNthCalledWith(2, 'code', { ascending: true }); // 尾鍵穩定序
    expect(res).toEqual([
      {
        code: 'received_confirmed',
        label: '已收已定',
        color: '#FBE4A6',
        textColor: 'dark',
        sortOrder: 10,
        isActive: true,
      },
      {
        code: 'unpaid_shipped',
        label: '未收出貨',
        color: '#A52A2A',
        textColor: 'light',
        sortOrder: 50,
        isActive: false,
      },
    ]);
  });

  it('空表 → []', async () => {
    const { client } = makeClient({ data: [], error: null });
    await expect(
      new SupabaseOrderStatusOptionsAdapter(client).listOrderStatusOptions(),
    ).resolves.toEqual([]);
  });

  it('查詢 error → 裸 throw(caller 降級:badge 中性灰、列表仍可用)', async () => {
    const { client } = makeClient({ data: null, error: new Error('relation does not exist') });
    await expect(
      new SupabaseOrderStatusOptionsAdapter(client).listOrderStatusOptions(),
    ).rejects.toThrow();
  });
});

// M-4a Slice D-3:from('order_status_options').update({5欄}).eq('code',code).select(白名單) 鏈。
function makeUpdateClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { client: { from } as unknown as SupabaseClient, from, update, eq, select };
}

describe('SupabaseOrderStatusOptionsAdapter.updateOrderStatusOption', () => {
  const UPDATE = {
    label: '已收已定',
    color: '#FBE4A6',
    textColor: 'dark' as const,
    sortOrder: 10,
    isActive: true,
  };

  it('🔴 UPDATE 只送 5 欄、絕不含 code/created_at(凍結欄);eq(code);select 回讀 → UPDATED', async () => {
    const { client, from, update, eq, select } = makeUpdateClient({
      data: [
        {
          code: 'received_confirmed',
          label: '已收已定',
          color: '#FBE4A6',
          text_color: 'dark',
          sort_order: 10,
          is_active: true,
        },
      ],
      error: null,
    });

    const res = await new SupabaseOrderStatusOptionsAdapter(client).updateOrderStatusOption(
      'received_confirmed',
      UPDATE,
    );

    expect(from).toHaveBeenCalledWith('order_status_options');
    expect(update).toHaveBeenCalledWith({
      label: '已收已定',
      color: '#FBE4A6',
      text_color: 'dark',
      sort_order: 10,
      is_active: true,
    });
    // 🔴 凍結欄縱深:update payload 絕不含 code / created_at(DB column-level grant 已擋、此處字面守門)
    const payload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('code');
    expect(payload).not.toHaveProperty('created_at');
    expect(eq).toHaveBeenCalledWith('code', 'received_confirmed');
    expect(select).toHaveBeenCalledWith(ORDER_STATUS_OPTIONS_SELECT);
    expect(res).toBe('UPDATED');
  });

  it('code 不存在(select 回 0 列)→ NOT_FOUND', async () => {
    const { client } = makeUpdateClient({ data: [], error: null });
    await expect(
      new SupabaseOrderStatusOptionsAdapter(client).updateOrderStatusOption('nope', UPDATE),
    ).resolves.toBe('NOT_FOUND');
  });

  it('DB error(CHECK 違反 / 權限)→ 裸 throw(caller 退 error 碼、不外洩)', async () => {
    const { client } = makeUpdateClient({
      data: null,
      error: new Error('violates check constraint'),
    });
    await expect(
      new SupabaseOrderStatusOptionsAdapter(client).updateOrderStatusOption('received_confirmed', UPDATE),
    ).rejects.toThrow();
  });
});

// M-4a Slice D-3c:from('order_status_options').insert({6欄}) 鏈(無 .select();只取 { error })。
function makeInsertClient(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe('SupabaseOrderStatusOptionsAdapter.createOrderStatusOption', () => {
  const INPUT = {
    code: 'new_status',
    label: '新狀態',
    color: '#ABCDEF',
    textColor: 'light' as const,
    sortOrder: 100,
    isActive: true,
  };

  it('INSERT 具名 6 欄(含 code、無 created_at)、無 .select() → CREATED', async () => {
    const { client, from, insert } = makeInsertClient({ error: null });
    const res = await new SupabaseOrderStatusOptionsAdapter(client).createOrderStatusOption(INPUT);
    expect(from).toHaveBeenCalledWith('order_status_options');
    expect(insert).toHaveBeenCalledWith({
      code: 'new_status',
      label: '新狀態',
      color: '#ABCDEF',
      text_color: 'light',
      sort_order: 100,
      is_active: true,
    });
    const payload = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('created_at'); // 交 DB default
    expect(res).toBe('CREATED');
  });

  it('code 重複(unique_violation 23505)→ DUPLICATE(非 throw、caller 退友善碼)', async () => {
    const { client } = makeInsertClient({ error: { code: '23505', message: 'duplicate key value' } });
    await expect(
      new SupabaseOrderStatusOptionsAdapter(client).createOrderStatusOption(INPUT),
    ).resolves.toBe('DUPLICATE');
  });

  it('其他 DB error(非 23505)→ 裸 throw', async () => {
    const { client } = makeInsertClient({ error: new Error('some other db error') });
    await expect(
      new SupabaseOrderStatusOptionsAdapter(client).createOrderStatusOption(INPUT),
    ).rejects.toThrow();
  });
});
