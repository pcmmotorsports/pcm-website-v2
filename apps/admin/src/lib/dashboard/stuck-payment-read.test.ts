import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import { loadStuckPaymentCount, stuckPaymentLabel, unreadableStuckPayment } from './stuck-payment-read';

// stuck-payment-read.test.ts — 首頁那一格「扣款重試已放棄:N 張」的守門。
//
// 🔴🔴 **這支要證的核心只有一句**:**零張時它會印「0 張」, 而讀不到時它印「量不到」** ——
//    那兩個是**不同的字**。本片存在的全部理由就是這一格:
//    同一天量到三個「該叫才叫」的東西, 它們的沉默有兩種意思而收訊端分不出來。
//    ⇒ 📌 一支不會證明「零與壞印不同東西」的測試, 對這一片而言等於沒有測。
//
// 🔴 **誠實邊界**:鏈式 mock 只證**本層的形狀與分支**。
//    **不證** PostgREST 真的接受這個查詢、不證 `payment_charge_attempts` 上那兩個欄位真的存在、
//    也**不證 `service_role` 在正式庫真的讀得到那張表**(授權是 grep DDL 讀來的:
//    `20260612150000_m3_s2d_charge_attempts.sql:121` `GRANT SELECT … TO service_role`)。
//    ⚠️ **那是【讀來的】不是【量到的】** —— 真正的證據要一次對正式庫的唯讀查詢, 而本片沒有做。

/** `.from().select().eq().in()` ⇒ thenable。`reject` 走 transport 層 reject 那條路。 */
function chain(result: { count?: number | null; error?: unknown; reject?: unknown; hang?: true }) {
  const thenable = {
    then(ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) {
      if (result.hang) return new Promise(() => {}); // 永遠不回 ⇒ 演逾時那條路
      if ('reject' in result) return Promise.resolve(err?.(result.reject));
      return Promise.resolve(ok({ count: result.count ?? null, error: result.error ?? null }));
    },
  };
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = () => self;
  self.in = () => thenable;
  return self;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadStuckPaymentCount', () => {
  it('🔴🔴 零張 ⇒ 印「0 張」, 而【不是】什麼都不印(本片存在的全部理由)', async () => {
    mocks.from.mockReturnValue(chain({ count: 0 }));
    const c = await loadStuckPaymentCount();
    expect(c.count).toBe(0);
    expect(c.unreadableReason).toBeNull();
    expect(stuckPaymentLabel(c)).toBe('扣款重試已放棄:0 張');
  });

  it('🟢 有卡單 ⇒ 印那個數字', async () => {
    mocks.from.mockReturnValue(chain({ count: 3 }));
    expect(stuckPaymentLabel(await loadStuckPaymentCount())).toBe('扣款重試已放棄:3 張');
  });

  it('🔴🔴 零張與量不到印【不同的字】—— 這一格才是這片的守門', async () => {
    mocks.from.mockReturnValue(chain({ count: 0 }));
    const zero = stuckPaymentLabel(await loadStuckPaymentCount());
    mocks.from.mockReturnValue(chain({ error: { message: 'boom' } }));
    const broken = stuckPaymentLabel(await loadStuckPaymentCount());
    expect(zero).not.toBe(broken);
    // 🔴 而【兩邊都要印東西】—— 一個壞掉時留白的儀表, 與頁面還沒載完長一樣。
    expect(zero).not.toBe('');
    expect(broken).not.toBe('');
  });

  it('🔴 查詢出錯 ⇒ 量不到, 而**不是** 0 張', async () => {
    mocks.from.mockReturnValue(chain({ error: { message: 'boom' } }));
    const c = await loadStuckPaymentCount();
    expect(c.count).toBeNull();
    expect(stuckPaymentLabel(c)).toBe('扣款重試已放棄:量不到(查詢失敗)');
  });

  it('🔴 transport 層 reject(網路斷/DNS)⇒ 也是量不到, 不往上拋', async () => {
    mocks.from.mockReturnValue(chain({ reject: new Error('ECONNRESET') }));
    const c = await loadStuckPaymentCount();
    expect(c.count).toBeNull();
    expect(c.unreadableReason).toBe('查詢失敗');
  });

  it('🔴 count 回 null ⇒ 量不到, 而**不是** 0 張(拿不到數字不是好消息)', async () => {
    mocks.from.mockReturnValue(chain({ count: null }));
    const c = await loadStuckPaymentCount();
    expect(c.count).toBeNull();
    expect(stuckPaymentLabel(c)).toBe('扣款重試已放棄:量不到(拿不到筆數)');
  });

  it('🔴🔴 查詢永遠不回 ⇒ 5 秒後印「查詢逾時」, 而【不是】把首頁吊住', async () => {
    vi.useFakeTimers();
    try {
      mocks.from.mockReturnValue(chain({ hang: true }));
      const p = loadStuckPaymentCount();
      await vi.advanceTimersByTimeAsync(5_000);
      const c = await p;
      expect(c.count).toBeNull();
      expect(c.unreadableReason).toBe('查詢逾時(5 秒)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴 查詢形狀:讀 payment_charge_attempts、只數【系統放棄】而且【還鎖著單】的', async () => {
    const eq = vi.fn();
    const inFn = vi.fn();
    const thenable = {
      then: (ok: (v: unknown) => unknown) => Promise.resolve(ok({ count: 0, error: null })),
    };
    const self: Record<string, unknown> = {};
    const select = vi.fn(() => self);
    self.select = select;
    self.eq = (...a: unknown[]) => {
      eq(...a);
      return self;
    };
    self.in = (...a: unknown[]) => {
      inFn(...a);
      return thenable;
    };
    mocks.from.mockReturnValue(self);

    await loadStuckPaymentCount();

    expect(mocks.from).toHaveBeenCalledWith('payment_charge_attempts');
    // 🔴 `head: true` ⇒ 只回筆數不搬列(首頁每次進站都跑)。
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    // 🔴🔴 謂詞是**兩個**條件, 少任何一個都會數錯:
    //    少了 needs_manual_review ⇒ 數到全部在途的單
    //    少了 status 那半 ⇒ 把歷史上每一筆被標過的都數進來 ⇒ 這個數字只會長不會消
    expect(eq).toHaveBeenCalledWith('needs_manual_review', true);
    expect(inFn).toHaveBeenCalledWith('status', ['pending', 'charged']);
    // 🔴 而 `failed` **不准**進來:那個狀態會釋放 per-order 鎖 ⇒ 它不再擋住任何人。
    const statusArg = inFn.mock.calls[0]?.[1];
    expect(statusArg).not.toContain('failed');
  });
});

describe('字面的射程', () => {
  // 🔴🔴 **這一格釘的是【它不准宣稱它沒做到的事】**(code-reviewer 2026-09-03 R1 抓到):
  //    `status` 有四個值, 第四個是 `released`, 而那一族的人工佇列走**另一個欄**
  //    `released_manual_review_at` ⇒ `needs_manual_review` 對 released **設計上永不為 true**
  //    ⇒ 🎯 這個數字對那一族【結構上】是零 ⇒ 方向是**少報**, 而少報比多報糟。
  //    ⇒ 📌 所以字面只准說「扣款重試已放棄」, **不准說「系統放棄的付款」** ——
  //       後者宣稱涵蓋全部卡住的付款, 而它沒有。
  it('🔴 標籤不得宣稱它涵蓋【全部】卡住的付款(它看不到 released 那一族)', async () => {
    mocks.from.mockReturnValue(chain({ count: 1 }));
    const label = stuckPaymentLabel(await loadStuckPaymentCount());
    expect(label).toContain('扣款重試已放棄');
    expect(label).not.toContain('系統放棄的付款');
  });
});

describe('unreadableStuckPayment', () => {
  it('🔴 它回 null 不回 0 —— 0 是最漂亮的那一格, 而它正好是讀不到時最容易長出來的樣子', () => {
    const c = unreadableStuckPayment('測試');
    expect(c.count).toBeNull();
    expect(c.count).not.toBe(0);
  });
});
