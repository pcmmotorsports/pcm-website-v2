// @vitest-environment node
//
// /checkout/callback page test(M-3 3DS-3、🔴 鐵則 12 callback)。
// 以「呼叫 Server Component 預設 export → 檢視回傳 React 元素樹」驗分支(不渲染 DOM、免 Header provider):
//   ① 未登入 → redirect('/login')、不呼 settleCharge
//   ② getUser throw → 泛用處理中(fail-closed)、不呼 settleCharge、不 redirect
//   ③ order 缺 / 非 UUID → 泛用處理中、不呼 settleCharge
//   ④ 🔴 N1 歸屬閘:非本人單(歸屬讀無 row / throw)→ 泛用處理中、**不呼 settleCharge**、**不洩 displayId**
//   ⑤ 歸屬通過 × settleCharge paid → CheckoutSuccess(paid, displayId) + ClearCartOnSuccess
//   ⑥ pending → CheckoutSuccess(processing, displayId) + ClearCartOnSuccess(A4 清品項)
//   ⑦ no_attempt → 同 processing + ClearCartOnSuccess(N2)
//   ⑧ failed → CheckoutSuccess(failed, displayId) **無** ClearCartOnSuccess(D4 不清車)
//   ⑨ settleCharge throw → processing(fail-closed)+ ClearCartOnSuccess
// mock supabase server client(auth.getUser + from/select/eq/single)、composition、settleCharge、next/navigation、
//   CheckoutSuccess/ClearCartOnSuccess(stub、避免載入 Header 依賴與 server-only;比對元素 type 身分)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fragment, isValidElement, type ReactElement } from 'react';

const { redirectMock, settleChargeMock, supabaseRef } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  settleChargeMock: vi.fn(),
  supabaseRef: { current: null as unknown },
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve(supabaseRef.current),
}));
vi.mock('@/lib/payment/composition', () => ({
  getSettleChargeDeps: () => ({}),
}));
vi.mock('@pcm/use-cases', () => ({
  settleCharge: (...args: unknown[]) => settleChargeMock(...args),
}));
// stub 完成頁元件(node env 不渲染、只比對 type 與 props;避免載入 Header server-only 依賴)。
vi.mock('@/components/CheckoutSuccess', () => ({
  CheckoutSuccess: function CheckoutSuccess() {
    return null;
  },
}));
vi.mock('@/components/ClearCartOnSuccess', () => ({
  ClearCartOnSuccess: function ClearCartOnSuccess() {
    return null;
  },
}));

import { CheckoutSuccess } from '@/components/CheckoutSuccess';
import { ClearCartOnSuccess } from '@/components/ClearCartOnSuccess';

const ORDER_ID = '00000000-0000-4000-8000-000000000000';
const DISPLAY_ID = 'PCM-2026-0007';

type Supa = {
  getUserThrows?: boolean;
  user?: { id: string } | null;
  orderRow?: { display_id: string } | null;
  orderError?: { code: string } | null;
  selectThrows?: boolean;
};

function makeSupabase(s: Supa) {
  const eqCalls: Array<[string, unknown]> = [];
  const single = vi.fn(async () => {
    if (s.selectThrows) throw new Error('select boom');
    return { data: s.orderRow ?? null, error: s.orderError ?? null };
  });
  // 可鏈式 eq(支援 .eq('id',..).eq('customer_user_id',..).single() 應用層縱深),記錄呼叫供斷言。
  const chain: { eq: ReturnType<typeof vi.fn>; single: typeof single } = {
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    }),
    single,
  };
  return {
    __eqCalls: eqCalls,
    auth: {
      getUser: vi.fn(async () => {
        if (s.getUserThrows) throw new Error('getUser boom');
        return { data: { user: s.user ?? null } };
      }),
    },
    from: vi.fn(() => ({ select: vi.fn(() => chain) })),
  };
}

async function run(order: string | string[] | undefined, s: Supa): Promise<ReactElement> {
  supabaseRef.current = makeSupabase(s);
  const { default: CheckoutCallbackRoute } = await import('./page');
  return (await CheckoutCallbackRoute({
    searchParams: Promise.resolve(order === undefined ? {} : { order }),
  })) as ReactElement;
}

/** 規範化回傳:抽出 CheckoutSuccess 的 props + 是否含 ClearCartOnSuccess。 */
function inspect(el: ReactElement): {
  variant: unknown;
  displayId: unknown;
  message: unknown;
  hasClear: boolean;
} {
  if (el.type === Fragment) {
    const children = (el.props as { children: ReactElement[] }).children.filter(isValidElement);
    const cs = children.find((c) => c.type === CheckoutSuccess)!;
    const props = cs.props as Record<string, unknown>;
    return {
      variant: props.variant,
      displayId: props.displayId,
      message: props.message,
      hasClear: children.some((c) => c.type === ClearCartOnSuccess),
    };
  }
  expect(el.type).toBe(CheckoutSuccess);
  const props = el.props as Record<string, unknown>;
  return { variant: props.variant, displayId: props.displayId, message: props.message, hasClear: false };
}

afterEach(() => {
  vi.clearAllMocks();
  supabaseRef.current = null;
});

describe('/checkout/callback page', () => {
  it('① 未登入 → redirect(/login)、不呼 settleCharge', async () => {
    await expect(run(ORDER_ID, { user: null })).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('② getUser throw → 泛用處理中(fail-closed)、不 settle、不 redirect', async () => {
    const r = inspect(await run(ORDER_ID, { getUserThrows: true }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBeUndefined();
    expect(r.hasClear).toBe(false);
    expect(settleChargeMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('③ order 缺 → 泛用處理中、不 settle', async () => {
    const r = inspect(await run(undefined, { user: { id: 'u1' } }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBeUndefined();
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('③b order 非 UUID → 泛用處理中、不 settle', async () => {
    const r = inspect(await run('not-a-uuid', { user: { id: 'u1' } }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBeUndefined();
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('④ 🔴 N1:非本人單(歸屬讀無 row)→ 泛用處理中、不呼 settleCharge、不洩 displayId', async () => {
    const r = inspect(
      await run(ORDER_ID, { user: { id: 'u1' }, orderRow: null, orderError: { code: 'PGRST116' } }),
    );
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBeUndefined();
    expect(r.hasClear).toBe(false);
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('④b 歸屬讀 throw → 泛用處理中、不呼 settleCharge', async () => {
    const r = inspect(await run(ORDER_ID, { user: { id: 'u1' }, selectThrows: true }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBeUndefined();
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('⑤ 歸屬通過 + paid → CheckoutSuccess(paid, displayId) + ClearCartOnSuccess', async () => {
    settleChargeMock.mockResolvedValueOnce({ kind: 'paid', idempotent: false, displayId: 'IGNORED' });
    const r = inspect(await run(ORDER_ID, { user: { id: 'u1' }, orderRow: { display_id: DISPLAY_ID } }));
    expect(r.variant).toBe('paid');
    expect(r.displayId).toBe(DISPLAY_ID); // displayId 取自歸屬讀、非 settleCharge 回值
    expect(r.hasClear).toBe(true);
    expect(settleChargeMock).toHaveBeenCalledWith({}, { orderId: ORDER_ID });
    // 🔴 應用層縱深(codex 關卡2):歸屬讀同時 filter id + customer_user_id(RLS 之上再釘本人)。
    const eqCalls = (supabaseRef.current as { __eqCalls: Array<[string, unknown]> }).__eqCalls;
    expect(eqCalls).toContainEqual(['id', ORDER_ID]);
    expect(eqCalls).toContainEqual(['customer_user_id', 'u1']);
  });

  it('⑥ pending → processing + ClearCartOnSuccess(A4 清品項)', async () => {
    settleChargeMock.mockResolvedValueOnce({ kind: 'pending', reason: 'auth_or_pending' });
    const r = inspect(await run(ORDER_ID, { user: { id: 'u1' }, orderRow: { display_id: DISPLAY_ID } }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBe(DISPLAY_ID);
    expect(r.hasClear).toBe(true);
  });

  it('⑦ no_attempt → processing + 🔴 不清車(必然未扣款、codex K2 r1 must-fix、Sean A)', async () => {
    settleChargeMock.mockResolvedValueOnce({ kind: 'no_attempt' });
    const r = inspect(await run(ORDER_ID, { user: { id: 'u1' }, orderRow: { display_id: DISPLAY_ID } }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBe(DISPLAY_ID);
    expect(r.hasClear).toBe(false); // no_attempt ⟺ failed/never → 必然未扣款 → 保留車(對齊 A4 真意=防雙扣)
  });

  it('⑧ failed → CheckoutSuccess(failed, displayId) 無 ClearCartOnSuccess(D4 不清車)', async () => {
    settleChargeMock.mockResolvedValueOnce({ kind: 'failed' });
    const r = inspect(await run(ORDER_ID, { user: { id: 'u1' }, orderRow: { display_id: DISPLAY_ID } }));
    expect(r.variant).toBe('failed');
    expect(r.displayId).toBe(DISPLAY_ID);
    expect(r.hasClear).toBe(false);
  });

  it('⑨ settleCharge throw → processing(fail-closed)+ ClearCartOnSuccess', async () => {
    settleChargeMock.mockRejectedValueOnce(new Error('settle boom'));
    const r = inspect(await run(ORDER_ID, { user: { id: 'u1' }, orderRow: { display_id: DISPLAY_ID } }));
    expect(r.variant).toBe('processing');
    expect(r.displayId).toBe(DISPLAY_ID);
    expect(r.hasClear).toBe(true);
  });
});
