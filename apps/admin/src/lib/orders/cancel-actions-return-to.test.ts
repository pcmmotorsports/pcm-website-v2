import { beforeEach, describe, expect, it, vi } from 'vitest';

// cancel-actions-return-to.test.ts — #350d-2:取消線的 C1 接線 + 契約 §5 硬前置守門。
//
// 🔴 為什麼取消線這條要單獨守:取消是 **append-only、刪不掉**的動作,而契約 §5 把
//    「`return_to` 指向哪條路由就 revalidate 哪條」列為**正確性**(不是效能):
//    D5 的 `miss_complete` 是全站唯一一句會讓員工**再送一次**的話,它踩的前提就是
//    「導頁之後那頁拿到的是重算過的資料」。回面板而沒 revalidate 面板 ⇒ 那個前提更不成立
//    ⇒ 員工看到「查不到你那筆」而按第二次 ⇒ 第二筆刪不掉的取消。

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((..._args: unknown[]): never => {
    throw new Error('NEXT_REDIRECT');
  }),
  revalidatePath: vi.fn(),
  authorizeAdminMutation: vi.fn(),
  cancelOrder: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  RedirectType: { replace: 'replace', push: 'push' },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./cancel-repository', () => ({ cancelOrder: mocks.cancelOrder }));

import { cancelOrderAction } from './cancel-actions';
import {
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  CANCEL_RESULT_PARAM,
  CANCEL_REQUEST_TOKEN_PARAM,
} from './cancel-action-state';
import { ORDER_RETURN_TO_FIELD } from './order-return-to';

const ORDER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const TOKEN = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
/**
 * 面板視圖的 `return_to`。
 * 🔴 **刻意夾帶一顆舊的 `r`/`rt`**(R1 nit-6):不夾帶的話「結果 URL 的 r/rt 各恰一顆」是**恆真** ——
 *    本來就沒東西可剝。真站上這個值來自 `buildPanelSelfHref`(已剝過),但 `return_to` 是
 *    client 送回來的字串,夾帶是構造得出來的,而後果就是重複鍵讓取消面板永遠讀不到。
 */
const PANEL_VIEW = `/orders?payment_status=paid&panel=${ORDER}&r=order_cancel_invalid&rt=${OTHER}`;
/** 剝乾淨之後應該長的樣子(= 真正會被導去的視圖)。 */
const PANEL_VIEW_CLEAN = `/orders?payment_status=paid&panel=${ORDER}`;

function form(returnTo: string, over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set(CANCEL_ORDER_ID_FIELD, ORDER);
  fd.set(CANCEL_REQUEST_TOKEN_FIELD, TOKEN);
  fd.set(CANCEL_MODE_FIELD, 'full');
  fd.set(CANCEL_REASON_CODE_FIELD, 'customer_request');
  fd.set(ORDER_RETURN_TO_FIELD, returnTo);
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

/** 跑一次 action,回傳導頁網址(每一條路徑都以 redirect 收場 —— 這片是全 PRG)。 */
async function redirectTarget(fd: FormData): Promise<string> {
  await expect(cancelOrderAction(fd)).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

describe('#350d-2 取消線:動作做完回發起的那個視圖(C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.cancelOrder.mockResolvedValue({
      ok: true,
      cancellationId: 'c1',
      idempotent: false,
      closed: true,
    });
  });

  it('🔴 成功:回面板,`r` 與 `rt` 都在,篩選一個都沒掉', async () => {
    // 突變:把成功那條改回 `detailPath(parsed.orderId)` ⇒ 這條紅(取消完面板被關掉)。
    const target = await redirectTarget(form(PANEL_VIEW));
    const qs = new URLSearchParams(target.split('?')[1]);
    // 🔴 前綴逐字 = 視圖被逐字保留(夾帶的舊 `r`/`rt` 剝在後面那兩條斷言)。
    expect(target.startsWith(`${PANEL_VIEW_CLEAN}&`)).toBe(true);
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.get('panel')).toBe(ORDER);
    // 🔴 契約 §2 硬條件 1:`rt` **必須跟著 `r` 一起回**,少了它 D3 的 classifier 一律落
    //    `unreadable` ⇒ 面板永遠只會說「查不到取消紀錄(讀取失敗)」= 功能等於廢掉。
    expect(qs.get(CANCEL_RESULT_PARAM)).toBeTruthy();
    expect(qs.get(CANCEL_REQUEST_TOKEN_PARAM)).toBe(TOKEN);
    // 各恰一顆(夾帶的一次性參數要在導頁前就被剝掉)。
    expect(qs.getAll(CANCEL_RESULT_PARAM)).toHaveLength(1);
    expect(qs.getAll(CANCEL_REQUEST_TOKEN_PARAM)).toHaveLength(1);
  });

  it('🔴 已送到 RPC 的失敗:同樣回面板,且**原樣帶回這次送出的 token**', async () => {
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'retry',
      sqlstate: '40001',
      logMessage: 'x',
    });
    const qs = new URLSearchParams((await redirectTarget(form(PANEL_VIEW))).split('?')[1]);
    expect(qs.get('panel')).toBe(ORDER);
    // 換一把新 token = 全新 payload_hash = 同一份 payload 會真的再取消一次。
    expect(qs.get(CANCEL_REQUEST_TOKEN_PARAM)).toBe(TOKEN);
  });

  it('🔴 沒送到 RPC 的 `invalid`:回面板、**不帶 rt**(帳本裡本來就沒那筆)', async () => {
    const target = await redirectTarget(form(PANEL_VIEW, { [CANCEL_REASON_CODE_FIELD]: 'bogus' }));
    const qs = new URLSearchParams(target.split('?')[1]);
    expect(qs.get('panel')).toBe(ORDER);
    expect(qs.has(CANCEL_REQUEST_TOKEN_PARAM), 'A 類給 token 是叫 D5 去找鬼').toBe(false);
    expect(mocks.cancelOrder, 'invalid 不該送到 RPC').not.toHaveBeenCalled();
  });

  it('整頁版(return_to = 明細頁)行為不變', async () => {
    expect(await redirectTarget(form(`/orders/${ORDER}`))).toBe(
      `/orders/${ORDER}?${CANCEL_RESULT_PARAM}=order_cancelled&${CANCEL_REQUEST_TOKEN_PARAM}=${TOKEN}`,
    );
  });

  it('🔴 return_to 指向別張單(query 與 path 兩種形式)⇒ 退回本單明細頁(契約 §6-1)', async () => {
    // 🔴 path 形式那條是 R1 must-fix 1:原本整條放行 ⇒ 取消 A 成功卻導去 B 的明細頁並帶著 `rt`
    //    ⇒ D5 在 B 的帳本查不到 ⇒ 落 `miss_complete`(全站唯一一句叫員工再送一次)。
    expect(await redirectTarget(form(`/orders?panel=${OTHER}`))).toContain(`/orders/${ORDER}?`);
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.cancelOrder.mockResolvedValue({
      ok: true,
      cancellationId: 'c1',
      idempotent: false,
      closed: true,
    });
    expect(await redirectTarget(form(`/orders/${OTHER}`))).toContain(`/orders/${ORDER}?`);
  });

  it('🔴 return_to 非法 ⇒ 退回本單明細頁,而且**取消照樣做完了**(不是 500)', async () => {
    const target = await redirectTarget(form('https://evil.example/steal'));
    expect(target.startsWith(`/orders/${ORDER}?`)).toBe(true);
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
  });

  it('🔴 未授權:導固定安全頁 /orders,而且**授權前一個欄位都沒讀**(地雷 FormData)', async () => {
    // 🔴 codex 關卡2 nit:原本這格只斷言「導頁目標不含 panel」—— 那證不了「沒讀欄位」,
    //    只證得了「沒用那個值」。改餵一顆 `get()` 會爆的地雷:未授權時只要碰任何欄位就 throw
    //    ⇒ 這格才真的量得到既有紀律 1(授權閘絕對第一)。
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const landmine = {
      get: () => {
        throw new Error('授權前讀了表單欄位');
      },
      getAll: () => {
        throw new Error('授權前讀了表單欄位');
      },
      has: () => {
        throw new Error('授權前讀了表單欄位');
      },
    } as unknown as FormData;
    const target = await redirectTarget(landmine);
    expect(target.startsWith('/orders?')).toBe(true);
    expect(new URLSearchParams(target.split('?')[1]).has('panel')).toBe(false);
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });
});

describe('#350d-2 契約 §5 硬前置:revalidate 隨 return_to 打對路由', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff-a' });
    mocks.cancelOrder.mockResolvedValue({
      ok: true,
      cancellationId: 'c1',
      idempotent: false,
      closed: true,
    });
  });

  it('🔴 回面板時,`/orders` 這條路由也要被 revalidate(不是只有明細頁)', async () => {
    // 🔴 突變:把 `safeRevalidate` 的第三個參數拿掉(或不傳 returnTo)⇒ 這條紅。
    //    症狀在真站上是「面板讀到更舊的帳本」—— 沒有錯誤、沒有 log,只有一句過時的話。
    await redirectTarget(form(PANEL_VIEW));
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/orders/${ORDER}`);
    expect(paths, 'return_to 的 pathname 沒被 revalidate').toContain('/orders');
  });

  it('🔴 `revalidatePath` 拿到的是**路徑**、不是帶 query 的網址', async () => {
    // `revalidatePath('/orders?panel=x')` 不會 revalidate `/orders` —— 它只是一條打不中的路徑,
    // 而且**不會報錯**。這條把「有呼叫」與「呼叫對了」分開。
    await redirectTarget(form(PANEL_VIEW));
    for (const [path] of mocks.revalidatePath.mock.calls) {
      expect(String(path)).not.toContain('?');
    }
  });

  it('🔴🔴 明細頁那條 revalidate 拋錯,`/orders` 那條**仍要被嘗試**(逐條各自 try)', async () => {
    // 🔴 codex 關卡2 must-fix:我把共用一個 try 改成逐條各包各的,但**沒有任何測試分得出來** ——
    //    改回單一外層 try 時全套照樣綠,而症狀是「第一條拋錯 ⇒ 員工真正落地的那一頁整個沒被重取」
    //    ⇒ 面板讀到舊帳本 ⇒ D5 說「查不到你那筆」⇒ 員工再取消一次(append-only,刪不掉)。
    //    突變:把 for 迴圈換回「一個 try 包兩次 revalidatePath」⇒ 這格紅。
    mocks.revalidatePath.mockImplementation((path: unknown) => {
      if (path === `/orders/${ORDER}`) throw new Error('detail revalidate boom');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await redirectTarget(form(PANEL_VIEW));
      const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
      expect(paths, '第一條拋錯不得讓第二條被跳過').toContain('/orders');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('整頁版:只打明細頁那一條(不重複打同一條)', async () => {
    await redirectTarget(form(`/orders/${ORDER}`));
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual([`/orders/${ORDER}`]);
  });

  it('🔴 revalidate 爆掉不得吃掉補償 log 與導頁(走 `!ok` 那條分支)', async () => {
    // 既有紀律:`safeRevalidate` 是全檔唯一的 try,理由是「讓畫面新一點」不是取消成功與否的一部分。
    // #350d-2 在它裡面多打了一條路由 ⇒ 多一個拋出點 ⇒ 這格確認那條紀律沒被我弄壞。
    // 🔴 **刻意走 `ok:false`**(R1 nit-5):註解講的「補償 log」只存在於失敗分支,
    //    用成功路徑跑等於這格的名字大於它量到的東西。
    mocks.cancelOrder.mockResolvedValue({
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: 'boom',
    });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error('revalidate boom');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const qs = new URLSearchParams((await redirectTarget(form(PANEL_VIEW))).split('?')[1]);
      expect(qs.get('panel')).toBe(ORDER);
      // 帶著這次送出的 token —— D5 拿它去帳本問「到底寫進去了沒有」。
      expect(qs.get(CANCEL_REQUEST_TOKEN_PARAM)).toBe(TOKEN);
      const messages = errorLog.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('取消失敗')), '補償 log 沒發生').toBe(true);
    } finally {
      errorLog.mockRestore();
    }
  });
});
