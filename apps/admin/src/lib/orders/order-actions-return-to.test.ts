import { beforeEach, describe, expect, it, vi } from 'vitest';

// order-actions-return-to.test.ts — #350d C1 對**改單** action 的接線守門(R2 F5 補)。
//
// 🔴 為什麼要有這一支:`parseOrderReturnTo` 與 `appendResultQuery` 各自有單測、`workflow-form`
//    也有解析層單測,但**中間那一跳沒有任何守門** —— 把 `redirectWith` 改回內聯的 `?` 拼接
//    (面板網址本來就帶 query ⇒ 整串篩選被 `?r=saved` 蓋掉),當時全套測試**全綠**。
//    (memory `feedback_assertion-measures-the-wrong-thing` 第四形狀:兩端有測試、中間透傳無人守。)

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((..._args: unknown[]): never => {
    // 🔴 真的 `redirect()` 是**拋** NEXT_REDIRECT ⇒ 替身也要拋,否則 action 會繼續往下跑,
    //    測試就量到了一條真實環境不存在的路徑(例如 denied 之後還去打 DB)。
    throw new Error('NEXT_REDIRECT');
  }),
  revalidatePath: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  updateAdminOrderWorkflow: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./order-repository', () => ({
  getAdminOrderRepository: () => ({ updateAdminOrderWorkflow: mocks.updateAdminOrderWorkflow }),
}));

import { updateOrderWorkflowAction } from './order-actions';
import {
  ORDER_ID_FIELD,
  RETURN_TO_FIELD,
  SHIPPING_METHOD_FIELD,
  VERSION_FIELD,
} from './workflow-form';

const ORDER = '11111111-2222-4333-8444-555555555555';

function form(returnTo: string): FormData {
  const fd = new FormData();
  fd.set(ORDER_ID_FIELD, ORDER);
  fd.set(VERSION_FIELD, '7');
  fd.set(SHIPPING_METHOD_FIELD, 'home');
  fd.set(RETURN_TO_FIELD, returnTo);
  return fd;
}

/** 跑一次 action,回傳它 redirect 去的網址(action 一定以 redirect 收場)。 */
async function redirectTarget(returnTo: string): Promise<string> {
  await expect(updateOrderWorkflowAction(form(returnTo))).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

describe('#350d 改單 action:結果碼接在 return_to 後面', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.updateAdminOrderWorkflow.mockResolvedValue('UPDATED');
  });

  it('🔴 面板網址(本來就帶 query)用 `&` 接,篩選一個都不能掉', async () => {
    // 突變:把 `appendResultQuery` 換回寫死的 `?` ⇒ 這條紅(整串篩選被蓋掉)。
    const target = await redirectTarget(`/orders?payment_status=paid&panel=${ORDER}`);
    expect(target).toBe(`/orders?payment_status=paid&panel=${ORDER}&r=saved`);
  });

  it('整頁版(沒有 query)用 `?` 接', async () => {
    expect(await redirectTarget(`/orders/${ORDER}`)).toBe(`/orders/${ORDER}?r=saved`);
  });

  it('🔴 return_to 夾帶的一次性參數在導頁前就被剝掉(結果 URL 的 `r` 恰一顆)', async () => {
    const target = await redirectTarget(`/orders?panel=${ORDER}&r=conflict&rt=${ORDER}`);
    expect(target).toBe(`/orders?panel=${ORDER}&r=saved`);
    expect([...target.matchAll(/[?&]r=/g)]).toHaveLength(1);
  });

  it('🔴 return_to 非法 ⇒ 退回這張單的明細頁,而且**動作照樣做完了**(不是 500)', async () => {
    const target = await redirectTarget('https://evil.example/steal');
    expect(target).toBe(`/orders/${ORDER}?r=saved`);
    // 正向對照:寫入真的發生過 —— fail-closed 只換導頁目標,不吃掉動作本身。
    expect(mocks.updateAdminOrderWorkflow).toHaveBeenCalledTimes(1);
  });

  it('🔴 `panel` 指向別張單 ⇒ 退回本單明細頁(契約 §6-1,不照著導過去)', async () => {
    const other = '99999999-8888-4777-8666-555555555555';
    expect(await redirectTarget(`/orders?panel=${other}`)).toBe(`/orders/${ORDER}?r=saved`);
  });

  it('🔴 契約 §5:回面板那條路由也 revalidate 過(否則面板讀到舊帳本)', async () => {
    await redirectTarget(`/orders?panel=${ORDER}`);
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/orders');
    expect(paths).toContain(`/orders/${ORDER}`);
  });
});
