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
