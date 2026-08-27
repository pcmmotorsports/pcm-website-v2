import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  createManualCustomer: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));

// 🔴 **redirect mock 一定要拋**(體例逐字沿用 `lib/orders/manual-order-actions.test.ts:23-27`):
//    純 `vi.fn()` 不拋 ⇒ 「授權失敗之後還繼續往下建帳號」這種突變會**照樣全綠**。
class NextRedirectError extends Error {
  constructor() {
    super('NEXT_REDIRECT');
    this.name = 'NEXT_REDIRECT';
  }
}
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  RedirectType: { push: 'push', replace: 'replace' },
}));

// 🔴 **只換掉 `createManualCustomer`,`normalizeManualPhone` 走真實作**:
//    導頁帶的電話要不要正規化,是本檔要量的性質之一 ——
//    把正規化也 mock 掉的話,那一格會變成「我自己回什麼就斷言什麼」= 零判別力。
vi.mock('./manual-customer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-customer')>();
  return { ...actual, createManualCustomer: mocks.createManualCustomer };
});

import { createManualCustomerAction } from './manual-customer-actions';
import {
  MANUAL_CUSTOMER_NEW_NAME_FIELD,
  MANUAL_CUSTOMER_NEW_PHONE_FIELD,
  MANUAL_ORDER_IN_PANEL_FIELD,
  MANUAL_ORDER_IN_PANEL_VALUE,
  MANUAL_ORDER_REQUEST_ID_FIELD,
} from '../orders/manual-order-form';

const MRID = '11111111-1111-4111-8111-111111111111';
const NEW_USER = '22222222-2222-4222-8222-222222222222';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** 跑一次 action,回傳它導去哪。🔴 沒有導頁 = 失敗(每一條路徑都必須 PRG)。 */
async function runAndReadRedirect(fd: FormData): Promise<string> {
  await expect(createManualCustomerAction(fd)).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  // 🔴 `noUncheckedIndexedAccess` 下索引出來的是 `T | undefined` ⇒ 逐格取值前先斷言,
  //    不用 `!` 硬吞:吞掉的話「redirect 沒被呼叫」會變成一個看不懂的 undefined 錯。
  const call = mocks.redirect.mock.calls[0];
  expect(call).toBeDefined();
  return (call as unknown as [string])[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => {
    throw new NextRedirectError();
  });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.authorizeAdminMutation.mockResolvedValue({ actorId: 'staff-1' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ── 🔴 呼叫端守門(形狀逐字抄 `manual-order-actions.test.ts:76-110` 那一族)──────────────
//  理由同那一族:一支「寫好了但沒有人呼叫」的 action 在 typecheck / lint / 測試下**全綠**,
//  而 `createManualCustomer` 本人就是被這樣躺了好幾天的(production 呼叫端 0)。
describe('🔴 本 action 必須有呼叫端', () => {
  const FORM_BODY = join(__dirname, '../../components/orders/manual-order-form-body.tsx');
  const PAGE = join(__dirname, '../../app/orders/new/page.tsx');
  // 🔴 2026-08-28 線A:表單內容搬進 View(整頁與面板共用一份)⇒ 呼叫鏈多了一段,
  //    而**每一段都要驗**:少驗中間那段,任何一環變成死碼時上面那格會恆綠。
  const VIEW = join(__dirname, '../../components/orders/manual-order-view.tsx');
  /** 剝三種註解 —— 少剝 JSX 註解的話,被註解掉的 `<form action={…}>` 照樣命中 ⇒ 守門恆綠。 */
  const strip = (t: string) =>
    t
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
  const code = strip(readFileSync(FORM_BODY, 'utf8'));
  const pageCode = strip(readFileSync(PAGE, 'utf8'));

  it('表單本體把它接在 `<form action={…}>` 上', () => {
    expect(code).toMatch(/action=\{createManualCustomerAction\}/);
  });

  it('🔴 而且呼叫鏈一路通到頁面(不然元件是死碼, 上面那格會恆綠)', () => {
    const viewCode = strip(readFileSync(VIEW, 'utf8'));
    // View render 表單本體
    expect(viewCode).toMatch(/<ManualOrderFormBody/);
    // 整頁那一頁 render View
    expect(pageCode).toMatch(/<ManualOrderView/);
  });

  it('🔴 面板槽也 render 了同一份 View(不然面板那半是死碼)', () => {
    const panelCode = strip(
      readFileSync(join(__dirname, '../../app/@panel/orders/page.tsx'), 'utf8'),
    );
    expect(panelCode).toMatch(/<ManualOrderView/);
  });

  it('🔴 負對照:同一把尺去找一個不存在的 action ⇒ 不命中(尺不是恆真)', () => {
    expect(code).not.toMatch(/action=\{createNoSuchAction\}/);
  });
});

describe('createManualCustomerAction', () => {
  it('🔴 未授權 ⇒ 導 denied, 而且【一個帳號都沒建】', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const url = await runAndReadRedirect(
      form({ [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明', [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678' }),
    );
    expect(url).toBe('/orders/new?r=manual_order_denied');
    // 🔴 這一句才是這格的重點:授權閘要排在建帳號之前。少了它,突變把閘搬到後面仍會全綠。
    expect(mocks.createManualCustomer).not.toHaveBeenCalled();
  });

  it('姓名或電話不合 ⇒ 導 manual_customer_invalid, 並把冪等鍵與電話帶回去', async () => {
    mocks.createManualCustomer.mockResolvedValue({
      ok: false,
      reason: 'invalid_name',
      message: 'x',
    });
    const url = await runAndReadRedirect(
      form({
        [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
        [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '',
        [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
      }),
    );
    expect(url).toBe(`/orders/new?r=manual_customer_invalid&mrid=${MRID}&phone=0912345678`);
  });

  it('🔴 建到一半拋掉 ⇒ 導 manual_customer_【error】而不是 invalid(帳號可能已經建出來了)', async () => {
    mocks.createManualCustomer.mockRejectedValue(new Error('boom'));
    const url = await runAndReadRedirect(
      form({
        [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
        [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
        [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
      }),
    );
    // 🔴 兩顆碼的文案叫員工做【相反】的事:invalid 是「補好再按一次」、error 是「先去找一下」。
    //    拋掉那條路若印成 invalid ⇒ 他會直接再建一次 ⇒ 同一位客人兩個帳號。
    expect(url).toContain('r=manual_customer_error');
    expect(url).not.toContain('manual_customer_invalid');
  });

  it('成功 ⇒ 回建單頁, 而且【已經選好】剛建的那位客人', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const url = await runAndReadRedirect(
      form({
        [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
        [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
        [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
      }),
    );
    expect(url).toBe(`/orders/new?mrid=${MRID}&phone=0912345678&customer=${NEW_USER}`);
  });

  it('🔴 導頁帶的電話是【正規化過的數字串】, 不是他打的原文', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const url = await runAndReadRedirect(
      form({
        [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
        [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
        [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912-345-678',
      }),
    );
    // 帶原文回去 ⇒ 候選查詢比的是去掉非數字之後的值 ⇒ 他【找不到自己剛建的那個人】,
    // 而畫面看起來像什麼都沒發生。這一格就是那個世界與這個世界的分界。
    expect(url).toContain('phone=0912345678');
    expect(url).not.toContain('0912-345-678');
    expect(url).not.toContain('%2D');
  });

  it('🔴 原文【逐字】送進 createManualCustomer, 本層不先修剪(驗證是它的責任)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    await runAndReadRedirect(
      form({
        [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
        [MANUAL_CUSTOMER_NEW_NAME_FIELD]: ' 王小明 ',
        [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912-345-678',
      }),
    );
    expect(mocks.createManualCustomer).toHaveBeenCalledWith(expect.anything(), {
      name: ' 王小明 ',
      phone: '0912-345-678',
      // 🔴 冪等鍵要一起遞下去(codex R1 must-fix):它決定佔位信箱 = 這條路唯一的冪等機制。
      requestId: MRID,
    });
  });
});

// ── 🔴🔴 codex R1 must-fix(2026-08-28):面板旗標一格都沒被測到 ────────────────────
//  上一版把 `in_panel` 這條分支整條拿掉,**九格斷言沒有一格會紅** ——
//  因為它們全部走整頁版那條路,而整頁版正好是拿掉旗標之後的預設值。
//  📌 形狀:**「預設值」與「這個功能被刪掉了」印同一個結果。**
describe('🔴 面板版(in_panel)導頁', () => {
  const panelForm = (over: Record<string, string> = {}) =>
    form({
      [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
      [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
      [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
      [MANUAL_ORDER_IN_PANEL_FIELD]: MANUAL_ORDER_IN_PANEL_VALUE,
      ...over,
    });

  it('成功 ⇒ 留在面板裡(不得跳回整頁版)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const url = await runAndReadRedirect(panelForm());
    expect(url).toBe(`/orders?panel=new&mrid=${MRID}&phone=0912345678&customer=${NEW_USER}`);
    // 🔴 這一發是判別力的來源:整頁版那條路會是 `/orders/new?...`。
    expect(url.startsWith('/orders/new')).toBe(false);
  });

  it('失敗 ⇒ 也留在面板裡(不然他填到一半被丟出去)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: false, reason: 'invalid_name', message: 'x' });
    const url = await runAndReadRedirect(panelForm({ [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '' }));
    expect(url).toContain('/orders?panel=new');
    expect(url).toContain('r=manual_customer_invalid');
  });

  it('🔴 負對照:沒送旗標 ⇒ 走整頁版(證明上面兩格是旗標造成的, 不是恆真)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const url = await runAndReadRedirect(
      form({
        [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
        [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
        [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
      }),
    );
    expect(url.startsWith('/orders/new?')).toBe(true);
  });

  it('🔴 旗標值不對 ⇒ 當成整頁版(它是封閉集, 不是「有送就算」)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const url = await runAndReadRedirect(panelForm({ [MANUAL_ORDER_IN_PANEL_FIELD]: 'yes' }));
    expect(url.startsWith('/orders/new?')).toBe(true);
  });
});

// 🔴 冪等鍵遺失時**不得自己鑄一顆** —— 鑄了等於每一發都是新鍵 = 沒有冪等,而畫面上看不出差別。
it('🔴 表單沒帶合法 mrid ⇒ 遞空字串下去讓它拒, 不自己鑄一顆', async () => {
  mocks.createManualCustomer.mockResolvedValue({
    ok: false,
    reason: 'invalid_request_id',
    message: 'x',
  });
  await runAndReadRedirect(
    form({
      [MANUAL_ORDER_REQUEST_ID_FIELD]: 'not-a-uuid',
      [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
      [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
    }),
  );
  expect(mocks.createManualCustomer).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ requestId: '' }),
  );
});

// ── 🔴 R3 F10:**「重送之後員工看到什麼」在兩支測試檔裡都沒有量具** ──────────────────
//  上一版全程 mock 掉 `createManualCustomer`,而**沒有一格餵過 `idempotent: true`**
//  ⇒ 那條路是不是與全新建立走同一個分支、有沒有留下任何訊號,測試一個字都答不出來。
describe('🔴 重送(idempotent)那條路', () => {
  const successForm = () =>
    form({
      [MANUAL_ORDER_REQUEST_ID_FIELD]: MRID,
      [MANUAL_CUSTOMER_NEW_NAME_FIELD]: '王小明',
      [MANUAL_CUSTOMER_NEW_PHONE_FIELD]: '0912345678',
    });

  it('導去的地方與全新建立【相同】(員工要看到的就是那位客人)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: true });
    const url = await runAndReadRedirect(successForm());
    expect(url).toBe(`/orders/new?mrid=${MRID}&phone=0912345678&customer=${NEW_USER}`);
  });

  it('🔴 而它必須留下一筆 log(災難當天要查得到這顆鍵被判成重送)', async () => {
    const warn = vi.mocked(console.warn);
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: true });
    await runAndReadRedirect(successForm());
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('admin.manual_customer.idempotent_hit'))).toBe(true);
    // 🔴 **不得記姓名與電話**(PII)。這一格在「有記」與「沒記」兩個世界印不同的東西。
    expect(lines.some((l) => l.includes('王小明') || l.includes('0912345678'))).toBe(false);
  });

  it('🔴 負對照:全新建立【不得】印那一筆(否則那把尺恆真)', async () => {
    const warn = vi.mocked(console.warn);
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    await runAndReadRedirect(successForm());
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('admin.manual_customer.idempotent_hit'))).toBe(false);
  });
});
