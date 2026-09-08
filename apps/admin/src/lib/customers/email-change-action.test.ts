import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(),
  revalidatePath: vi.fn(),
  readEmailVerification: vi.fn(),
  record: vi.fn(),
  updateUserById: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeManagerMutation: mocks.authorizeManagerMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
// 🔴 **`redirect` 要用【會 throw 的】替身**:真的 `next/navigation` redirect 是靠拋出來
//    中斷函式的。用 `vi.fn()` 當替身 ⇒ 程式會**繼續往下跑**
//    ⇒ 「擋下來了」這種斷言會在一個【其實沒擋住】的實作上照樣綠。
class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));
// 🔴 這支模組現在還匯出 `MUTATION_READ_TIMEOUT_MS`(寫入路徑專用逾時)——
//    整支換掉會讓 action 那一行 import 拿到 undefined ⇒ 只換函式, 常數走原檔。
vi.mock('./email-verification-read', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./email-verification-read')>();
  return { ...actual, readEmailVerification: mocks.readEmailVerification };
});
vi.mock('../orders/order-repository', () => ({
  getAdminAuditLogRepository: () => ({ record: mocks.record }),
}));

// 🔴 解析器、資格閘、結果碼**刻意不 mock** —— 餵真 FormData 走真的那幾支,
//    否則「爛表單擋得住」「Google 帳號擋得住」都會變成恆真斷言(同 `wallet-actions.test.ts` 的理由)。
import { changeCustomerEmailAction } from './email-change-action';
import {
  EMAIL_CHANGE_CUSTOMER_ID_FIELD,
  EMAIL_CHANGE_EMAIL_FIELD,
  EMAIL_CHANGE_RETURN_TO_FIELD,
} from './email-change-form';

// email-change-action.test.ts — **這支檔是 code-reviewer 與 codex 兩邊同時逼出來的**。
//
// 🛑 他們各自逐字說:整支 action 零測試,而承重的東西全在那裡 ——
//    兩段寫入的順序、`half_done` 的收斂論證、fail-closed 重讀、`taken` 分流。
//    ⇒ 📌 「壞在中間往哪一邊倒」是這一片最貴的判斷, 而**它當時靠的是讀者相信檔頭那段註解**。
// ⇒ 本檔逐格釘住它,每一格都答得出「什麼樣的爛實作會讓它變紅」。

const CUS = '11111111-2222-4333-8444-555555555555';
/** 第 ④ 步讀回來的 `updated_at`(與替身裡的 `UPDATED_AT` 同值)。 */
const UPDATED_AT_FIXTURE = '2026-09-08T10:00:00Z';
const OLD = 'wang.old@example.com';
const NEW = 'wang.new@example.com';

function form(overrides: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    [EMAIL_CHANGE_CUSTOMER_ID_FIELD]: CUS,
    [EMAIL_CHANGE_EMAIL_FIELD]: NEW,
    [EMAIL_CHANGE_RETURN_TO_FIELD]: `/customers/${CUS}`,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

/**
 * 假的 supabase client。**只長出 action 真的會走的那幾條鏈**,
 * 而每一條都記下它被呼叫時的參數 ⇒ 斷言問得出「有沒有真的送出去」。
 *
 * 🔴🔴 **這個替身本身被 codex R2 nit 8 打過一次, 修法寫在這裡**:
 * ```
 * ⛔ ~~舊版忽略 update 的第二個參數~~  ⇒ 拿掉 `{count:'exact'}` 它照樣回數字
 *    而真的 supabase-js 沒要 count 時回 `count: null` ⇒ 那個回歸【測不出來】
 * ⛔ ~~舊版忽略 select 的所有篩選~~    ⇒ 拿掉占用查詢的 email 條件, 測試照樣綠
 * ```
 * ✅ 現行:`update` 沒帶 `count:'exact'` ⇒ 回 `count: null`(照真 SDK);
 *    占用查詢**真的比對**它送出去的那組 email。
 * 📌 memory `feedback_my-fixture-drifts-toward-my-conclusion` —— 自己寫的替身會往自己的結論偏,
 *    所以它的每一格都要問一次「真的那一支在這裡會回什麼」。
 */
type FakeOpts = {
  /** 第 ④ 步:這位客人現在的信箱;`null` = 查無此列。 */
  current?: string | null;
  /** 第 ④ 步一起讀回來的 `updated_at`(樂觀鎖的鑰匙)。 */
  updatedAt?: string;
  /** 第 ⑤ 步:**哪一個信箱**被別位客人占著(替身會真的比對, 不是無條件回)。 */
  occupiedEmail?: string | null;
  /** 第 ⑦ 步 update 的結果。 */
  update?: { error?: { code?: string } | null; count?: number };
  /** 第 ⑧ 步零列命中之後的回讀(`undefined` = 用 `current`;`'ERROR'` = 那一發自己失敗)。 */
  after?: string | null | 'ERROR';
  /** Auth 更新的結果。`email: null` = 回了 200 而回應裡沒有 email。 */
  auth?: { error?: { code?: string } | null; email?: string | null };
};

const UPDATED_AT = '2026-09-08T10:00:00Z';

function fakeClient(o: FakeOpts) {
  const calls = {
    /**
     * 🔴 **一條【共同】的事件序列 —— 而它是 codex R3 逼出來的。**
     * 舊版只比 `record()` 的第一次 vs 第二次 ⇒ 把 attempt 搬到 Auth **之後**、
     * 結果稽核**之前**, 那一格**照樣綠** ⇒ 它守的其實是「有兩列稽核」, 不是「順序」。
     * ⇒ 📌 要斷言 `attempt < updateUserById`, 兩件事就必須記在**同一條**軸上。
     *
     * ⚠️ **它守不住的那一段要寫明**(R5):這條軸記的是【呼叫的先後】, 不是【完成的先後】
     *    ⇒ 有人把 `await` 拿掉(attempt 沒等它寫完就往下走), 或把 builder 先建起來
     *    而讓結果稽核先落地 —— **這條軸都看不到**。它守的是順序, 不是因果。
     */
    seq: [] as string[],
    update: [] as {
      values: Record<string, unknown>;
      options: unknown;
      eqs: [string, unknown][];
    }[],
    auth: [] as { id: string; attrs: Record<string, unknown> }[],
    /** 占用預檢送出去的那組 email(`.in('email', […])`)。 */
    occupiedProbe: null as unknown,
  };
  let selectRound = 0;
  const client = {
    auth: {
      admin: {
        updateUserById: (id: string, attrs: Record<string, unknown>) => {
          calls.auth.push({ id, attrs });
          calls.seq.push('auth');
          const a = o.auth ?? {};
          if (a.error) return Promise.resolve({ data: { user: null }, error: a.error });
          // `email` 明寫成 null ⇒ 回 200 而回應裡沒有 email(codex R2 must-fix 5 那一格)。
          const email = 'email' in a ? a.email : (attrs.email as string);
          return Promise.resolve({ data: { user: { email } }, error: null });
        },
      },
    },
    from: () => ({
      select: () => {
        const round = selectRound++;
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.eq = self;
        chain.neq = self;
        chain.in = (_col: string, vals: unknown) => {
          calls.occupiedProbe = vals;
          return chain;
        };
        chain.maybeSingle = () => {
          // 第一發 = ④ 讀現值;第二發 = ⑤ 占用預檢;第三發 = ⑧ 零列命中後回讀。
          if (round === 0) {
            return Promise.resolve({
              data:
                o.current === null
                  ? null
                  : { email: o.current ?? OLD, updated_at: o.updatedAt ?? UPDATED_AT },
              error: null,
            });
          }
          if (round === 1) {
            // 🔴 **真的比對** —— 替身不再無條件回「有人占著」。
            const probed = (calls.occupiedProbe as string[] | null) ?? [];
            const hit = o.occupiedEmail !== undefined && o.occupiedEmail !== null
              && probed.includes(o.occupiedEmail);
            return Promise.resolve({ data: hit ? { user_id: 'another' } : null, error: null });
          }
          if (o.after === 'ERROR') {
            return Promise.resolve({ data: null, error: { code: 'PGRST000' } });
          }
          const a = o.after === undefined ? (o.current ?? OLD) : o.after;
          return Promise.resolve({ data: a === null ? null : { email: a }, error: null });
        };
        return chain;
      },
      update: (values: Record<string, unknown>, options?: unknown) => {
        const entry = { values, options, eqs: [] as [string, unknown][] };
        calls.update.push(entry);
        // 🔴 **`customers` 那一發也要進事件軸**(R4 nit):少了它, 把【結果稽核】搬到
        //    update **之前**(= 宣稱一個還沒發生的寫入)那一格照樣綠。
        calls.seq.push('customers');
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, val: unknown) => {
          entry.eqs.push([col, val]);
          return chain;
        };
        chain.then = (resolve: (v: unknown) => unknown) => {
          // 🔴 照真 SDK:**沒有要 count 就沒有 count**。
          const wantsCount = (options as { count?: string } | undefined)?.count === 'exact';
          return resolve({
            error: o.update?.error ?? null,
            count: wantsCount ? (o.update?.count ?? 1) : null,
          });
        };
        return chain;
      },
    }),
  };
  return { client, calls };
}

/** 跑一發, 回傳它導去哪裡(拿不到 redirect = action 沒有停下來 ⇒ 直接讓測試紅)。 */
async function run(o: FakeOpts, f: FormData = form()): Promise<string> {
  const { client, calls } = fakeClient(o);
  mocks.createSupabaseServiceClient.mockReturnValue(client);
  lastCalls = calls;
  try {
    await changeCustomerEmailAction(f);
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error('action 跑完了而沒有 redirect —— 每一條路都應該以 redirect 收尾');
}

let lastCalls: ReturnType<typeof fakeClient>['calls'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeManagerMutation.mockResolvedValue({ sid: 's1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-1');
  // 🔴 稽核也記進【同一條】事件軸(見 `calls.seq` 的 docstring)。
  mocks.record.mockImplementation((entry: { action: string }) => {
    lastCalls?.seq.push(entry.action);
    return Promise.resolve(undefined);
  });
  // 預設 = 一個可以改的帳號(純信箱註冊、已驗證)。
  mocks.readEmailVerification.mockResolvedValue({
    confirmedAt: '2026-09-01T00:00:00Z',
    provider: undefined,
    syntheticAddress: false,
    authProviders: ['email'],
  });
});

describe('順利那一發', () => {
  it('改成功 ⇒ saved,而【兩段寫入都真的送出去了】', async () => {
    const url = await run({});
    expect(url).toBe(`/customers/${CUS}?r=customer_email_saved`);
    // 🔴 只斷言結果碼是不夠的 —— 一個什麼都不做只 redirect 的實作也會綠。
    expect(lastCalls.auth).toEqual([
      { id: CUS, attrs: { email: NEW, email_confirm: true } },
    ]);
    expect(lastCalls.update[0]?.values).toEqual({ email: NEW });
  });

  it('🔴 稽核記的是【舊→新】,而 actor 與 request_id 是 server 給的', async () => {
    await run({});
    expect(mocks.record).toHaveBeenCalledWith(
      {
        action: 'customer.email.change',
        target: `customer:${CUS}`,
        before: { email: OLD },
        after: { email: NEW },
      },
      { actor: 'sean', requestId: 'req-1', sourceApp: 'admin' },
    );
  });

  it('🔴 稽核寫不進去 ⇒ 仍然 saved_audit_failed(不假裝沒發生, 也不說成功)', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    expect(await run({})).toBe(`/customers/${CUS}?r=customer_email_saved_audit_failed`);
  });
});

describe('🔴 順序:Auth 先、customers 後 —— 這是本片最貴的判斷', () => {
  it('customers 那半失敗 ⇒ half_done,而 Auth 那半【已經送出去了】', async () => {
    const url = await run({ update: { error: { code: '42501' } } });
    expect(url).toBe(`/customers/${CUS}?r=customer_email_half_done`);
    expect(lastCalls.auth).toHaveLength(1);
  });

  it('🔴 撞到別人的 UNIQUE(23505)⇒ half_done_stuck,不是 half_done', async () => {
    // 兩顆碼在畫面上叫員工做**相反**的事(再按一次 / 不要再按)。
    expect(await run({ update: { error: { code: '23505' } } })).toBe(
      `/customers/${CUS}?r=customer_email_half_done_stuck`,
    );
  });

  it('🔴 查無此客人 ⇒ not_found,而【一個字都沒送到 Auth】', async () => {
    const url = await run({ current: null });
    expect(url).toBe(`/customers/${CUS}?r=customer_email_not_found`);
    expect(lastCalls.auth).toHaveLength(0);
  });
});

describe('🔴 資格閘(server 端重讀, 不信任畫面)', () => {
  it.each([
    ['LINE 帳號', { provider: 'line' }, 'not_eligible'],
    ['後台手動建立', { provider: 'manual' }, 'not_eligible'],
  ])('%s ⇒ %s,而零寫入', async (_l, over, code) => {
    mocks.readEmailVerification.mockResolvedValue({
      confirmedAt: 'x',
      syntheticAddress: false,
      authProviders: ['email'],
      ...over,
    });
    expect(await run({})).toBe(`/customers/${CUS}?r=customer_email_${code}`);
    expect(lastCalls.auth).toHaveLength(0);
  });

  // 🔴🔴 這一格就是 code-reviewer 與 codex 各自獨立抓到的那條缺口。
  it('🔴 Google 一鍵註冊(kind 會判成 verified)⇒ not_eligible,而零寫入', async () => {
    mocks.readEmailVerification.mockResolvedValue({
      confirmedAt: 'x',
      provider: undefined,
      syntheticAddress: false,
      authProviders: ['google'],
    });
    expect(await run({})).toBe(`/customers/${CUS}?r=customer_email_not_eligible`);
    expect(lastCalls.auth).toHaveLength(0);
  });

  it('🔴 Auth 讀不到(readEmailVerification 回 null)⇒ unreadable,而零寫入 = fail-closed', async () => {
    mocks.readEmailVerification.mockResolvedValue(null);
    expect(await run({})).toBe(`/customers/${CUS}?r=customer_email_unreadable`);
    expect(lastCalls.auth).toHaveLength(0);
  });
});

describe('🔴 交錯與零列命中 —— 三種世界的下一步不一樣', () => {
  it('零列而回讀已是新值(別人先寫成了)⇒ no_change', async () => {
    expect(await run({ update: { count: 0 }, after: NEW })).toBe(
      `/customers/${CUS}?r=customer_email_no_change`,
    );
  });

  it('零列而那一列不見了(中間被刪)⇒ not_found', async () => {
    expect(await run({ update: { count: 0 }, after: null })).toBe(
      `/customers/${CUS}?r=customer_email_not_found`,
    );
  });

  it('🔴 零列而變成第三個值(有人插隊改成別的)⇒ half_done_stuck,不是 saved', async () => {
    expect(await run({ update: { count: 0 }, after: 'someone.else@example.com' })).toBe(
      `/customers/${CUS}?r=customer_email_half_done_stuck`,
    );
  });

  it('🔴 update 帶著【比對後寫入】的兩個條件 —— 少了 email 那一個, 交錯的兩發會互相蓋掉', async () => {
    await run({});
    expect(lastCalls.update[0]?.eqs).toEqual([
      ['user_id', CUS],
      ['email', OLD],
      ['updated_at', UPDATED_AT_FIXTURE],
    ]);
  });
});

describe('🔴 以 Auth【回傳的】那一份為準, 不是我送過去的字面', () => {
  it('GoTrue 把整個位址轉小寫 ⇒ customers 與稽核都存它回傳的那一份', async () => {
    const url = await run(
      { auth: { email: 'wang.new@example.com' } },
      form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'Wang.New@Example.COM' }),
    );
    expect(url).toBe(`/customers/${CUS}?r=customer_email_saved`);
    // 送進去的是 canonicalize 過的 `Wang.New@example.com`(local-part 保留大小寫),
    // 而寫進 customers 的必須是 Auth 回的那一份。
    expect(lastCalls.update[0]?.values).toEqual({ email: 'wang.new@example.com' });
    // 🔵 `calls[0]` 是**嘗試**那一列(它記的是【我打算改成什麼】= 送出去的字面),
    //    `calls[1]` 才是**結果**那一列(它記的是【對方存了什麼】)。兩列的 after 本來就不同,
    //    而那個不同**正是這一片要證的東西** —— 不要把它們對齊。
    expect(mocks.record.mock.calls[0]?.[0].after).toEqual({ email: 'Wang.New@example.com' });
    expect(mocks.record.mock.calls[1]?.[0].after).toEqual({ email: 'wang.new@example.com' });
  });
});

describe('🔴 動 Auth 之前的兩道擋門', () => {
  it('那個位址被別位客人占著 ⇒ taken,而【零寫入】(不讓它變成 half_done_stuck)', async () => {
    const url = await run({ occupiedEmail: NEW });
    expect(url).toBe(`/customers/${CUS}?r=customer_email_taken`);
    expect(lastCalls.auth).toHaveLength(0);
  });

  it('Auth 說信箱已存在 ⇒ taken(不是 error —— 重按永遠不會好)', async () => {
    expect(await run({ auth: { error: { code: 'email_exists' } } })).toBe(
      `/customers/${CUS}?r=customer_email_taken`,
    );
  });

  it('Auth 其他錯 ⇒ error,而 customers 那半【沒有被碰】', async () => {
    const url = await run({ auth: { error: { code: 'unexpected_failure' } } });
    expect(url).toBe(`/customers/${CUS}?r=customer_email_error`);
    expect(lastCalls.update).toHaveLength(0);
  });
});

describe('🔴 授權與表單', () => {
  it('不是管理者 ⇒ denied,而且【回得了原本那張客人卡】(不是被丟回列表)', async () => {
    mocks.authorizeManagerMutation.mockResolvedValue(null);
    expect(await run({})).toBe(`/customers/${CUS}?r=customer_email_denied`);
  });

  it('表單爛掉(信箱不合格式)⇒ invalid,而零寫入', async () => {
    const url = await run({}, form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'not-an-email' }));
    expect(url).toBe('/customers?r=customer_email_invalid');
    expect(lastCalls.auth).toHaveLength(0);
  });

  it('🔴 合成網域(員工手打一個系統位址)⇒ invalid,而零寫入', async () => {
    const url = await run(
      {},
      form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'line_u1@line.pcmmotorsports.local' }),
    );
    expect(url).toBe('/customers?r=customer_email_invalid');
    expect(lastCalls.auth).toHaveLength(0);
  });
});


// ══ codex R2(2026-09-08)打掉的那七條, 每一條各留一格 ══════════════════════
describe('🔴 codex R2 的七條 must-fix —— 每一格都對著一個【被實測重現過】的失敗', () => {
  it('#1 樂觀鎖:update 帶著 updated_at ⇒ 同址寫入不再擊穿比對閘', async () => {
    await run({});
    // 只比 email 的話:B 讀到 a、A 把 Auth 改回 a 並寫 customers a→a
    // ⇒ B 的 `.eq('email', a)` 照樣命中 ⇒ 它寫 a→b, 而兩發都印綠色。
    expect(lastCalls.update[0]?.eqs.map(([c]) => c)).toContain('updated_at');
  });

  it('#2 占用預檢是【大小寫不敏感】的 —— 送出去的是原字面與全小寫兩個', async () => {
    await run({}, form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'Wang.New@Example.COM' }));
    expect(lastCalls.occupiedProbe).toEqual(['Wang.New@example.com', 'wang.new@example.com']);
  });

  it('🔴 #2 別人占著全小寫那一份, 而員工打大寫 ⇒ 仍然 taken(零寫入)', async () => {
    const url = await run(
      { occupiedEmail: 'wang.new@example.com' },
      form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'Wang.New@Example.COM' }),
    );
    expect(url).toBe(`/customers/${CUS}?r=customer_email_taken`);
    expect(lastCalls.auth).toHaveLength(0);
  });

  it('🔴 #5 Auth 回 200 而沒有 email ⇒ half_done,而【customers 一個字都沒寫】', async () => {
    const url = await run({ auth: { email: null } });
    expect(url).toBe(`/customers/${CUS}?r=customer_email_half_done`);
    expect(lastCalls.update).toHaveLength(0);
  });

  it('🔴 #4 零列 + 回讀自己失敗 ⇒ half_done_stuck(不知道是哪一種衝突就不准叫他重按)', async () => {
    expect(await run({ update: { count: 0 }, after: 'ERROR' })).toBe(
      `/customers/${CUS}?r=customer_email_half_done_stuck`,
    );
  });

  it('零列而信箱仍是舊值(有人只動了這一列的別的欄)⇒ half_done(重按是安全的)', async () => {
    expect(await run({ update: { count: 0 }, after: OLD })).toBe(
      `/customers/${CUS}?r=customer_email_half_done`,
    );
  });

  it('🔴 #6 稽核失敗優先於 no_change —— 不得被一句成功語氣蓋掉', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    // 送同一個信箱 ⇒ 舊版會印綠色 no_change, 而稽核零筆。
    const url = await run({}, form({ [EMAIL_CHANGE_EMAIL_FIELD]: OLD }));
    expect(url).toBe(`/customers/${CUS}?r=customer_email_saved_audit_failed`);
  });

  it('🔴 #7 動手【之前】先落一列 attempt 稽核 —— 它是舊信箱這個值的唯一副本', async () => {
    await run({});
    const first = mocks.record.mock.calls[0]?.[0];
    expect(first.action).toBe('customer.email.change.attempt');
    expect(first.before).toEqual({ email: OLD });
    expect(first.reason).toContain('結果未定');
    // 🔴 而它必須排在【動 Auth 之前】—— 排在後面就保不住任何東西。
    //    ⛔ ~~舊版比的是 record() 的第一次 vs 第二次~~ —— 那守不住順序
    //       (把 attempt 搬到 Auth 之後、結果稽核之前, 舊版照樣綠)。
    //    ✅ 現在比的是【同一條事件軸】上的位置。
    expect(lastCalls.seq).toEqual([
      'customer.email.change.attempt',
      'auth',
      'customers',
      'customer.email.change',
    ]);
  });

  // 🔴 拿掉那個第三參數會**安靜退回 1.5 秒**(顯示用的那個)而 190 格全綠 ⇒ 釘住它。
  it('🔴 資格閘那一發用的是【寫入路徑】的逾時, 不是顯示用的 1.5 秒', async () => {
    await run({});
    expect(mocks.readEmailVerification).toHaveBeenCalledWith(CUS, undefined, 5_000);
  });

  it('🔴 #7 attempt 稽核寫不進去【不擋】後面(稽核壞掉不等於功能要壞掉)', async () => {
    mocks.record.mockRejectedValueOnce(new Error('boom'));
    expect(await run({})).toBe(`/customers/${CUS}?r=customer_email_saved`);
    expect(lastCalls.auth).toHaveLength(1);
  });

  it('🔴 nit8 update 沒帶 count:exact ⇒ 真 SDK 回 null ⇒ 本片必須走回讀路, 不得當成功', async () => {
    // 替身照真 SDK:沒要 count 就回 null。這一格守的是 `typeof !== number` 那個判準。
    expect(lastCallsCountContract()).toBe(true);
  });
});

/** `update` 的第二參數必須是 `{ count: 'exact' }` —— 拿掉它, 真 SDK 回 null。 */
function lastCallsCountContract(): boolean {
  return (lastCalls.update[0]?.options as { count?: string } | undefined)?.count === 'exact';
}


// ══ codex R3(2026-09-08)—— 換角度那一輪抓到的 ═════════════════════════════
describe('🔴 codex R3:前兩輪修法自己帶進來的東西', () => {
  it('🔴 Auth 整段拋出(auth-js 對網路那一類是 throw 不是回 error)⇒ auth_unknown, 不是 500', async () => {
    const { client } = fakeClient({});
    client.auth.admin.updateUserById = () => {
      throw new TypeError('fetch failed');
    };
    mocks.createSupabaseServiceClient.mockReturnValue(client);
    let url = '';
    try {
      await changeCustomerEmailAction(form());
    } catch (e) {
      url = e instanceof RedirectSignal ? e.url : `THREW:${String(e)}`;
    }
    expect(url).toBe(`/customers/${CUS}?r=customer_email_auth_unknown`);
  });

  // 🔴🔴 **這兩格取代舊的那一格, 而舊的那一格【是我自己餵出來的假綠】。**
  //    ⛔ ~~舊版寫「預檢漏掉 ⇒ 撞 UNIQUE ⇒ half_done_stuck ⇒ 不會靜默」~~,
  //    而它是靠我在 fixture 裡**手動塞了一個 `23505`** 才成立的(R4 抓到)。
  //    真相:`customers.email` 是純 text 的 UNIQUE ⇒ **大小寫敏感** ⇒ 那兩個字串根本不會撞。
  //    ⇒ 📌 memory `feedback_fixtures-supply-what-the-real-world-never-sends` —— 我供給了
  //       一個真實世界在這條路上不會送出來的錯誤碼, 然後拿它證明「有安全網」。

  // ⚠️⚠️ **這一格證的是【分流】, 不是【那道防線存在】**(R5 訂正我的宣稱):
  //    `email_exists` 是我在替身裡**手餵**的 ⇒ 它答的是「拿到這顆碼會不會走 taken」,
  //    **答不出**「GoTrue 遇到唯一鍵衝突一定回這顆碼」—— 後者我沒有連過 GoTrue、**未量**
  //    (它也可能把交易失敗包成 500 ⇒ 那一發會落進 `error`)。
  //    ⇒ 📌 舊的測試名字寫「真正的安全網是…」是**過度宣稱**, 已改成它真的在測的那件事。
  it('Auth 回 email_exists 時走 taken(這一格證分流, 不證 GoTrue 一定回這顆碼)', async () => {
    // 預檢兩個 exact 值都對不上 DB 裡那份混大小寫的 ⇒ 它放行 ⇒ 而 Auth 那一關回了那顆碼。
    const url = await run(
      { occupiedEmail: 'Wang.New@example.com', auth: { error: { code: 'email_exists' } } },
      form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'WANG.NEW@example.com' }),
    );
    expect(lastCalls.occupiedProbe).toEqual(['WANG.NEW@example.com', 'wang.new@example.com']);
    expect(url).toBe(`/customers/${CUS}?r=customer_email_taken`);
  });

  // 🛑 **這一格釘的是【一個沒有被擋住的世界】, 而它現在誠實地印出來。**
  //    auth 與 customers 已經漂開的那一位(customers 存混大小寫、而沒有對應的小寫 auth 帳號)
  //    ⇒ 預檢放行、Auth 放行、UNIQUE 不撞 ⇒ **多出一列只差大小寫的 customers, 而畫面印 saved**。
  //    🔬 今天構造不出來(`handle_new_user` 從 auth.users 抄過來, 而那一份是小寫的)——
  //       **未量, 是推的**。真解 = DB 端 `lower(email)` 唯一索引(另一支 migration)。
  //    ⛔ ~~「這一格會在那支 migration 落地時變紅」~~ —— **那句是假的**(R5 抓到):
  //       本格用的是**假 client**, 不連 DB ⇒ 加了 `lower(email)` 唯一索引之後它**照樣綠**。
  //       ⇒ 📌 它是一份**書面紀錄**(把那個沒被擋住的世界寫下來), **不是一道會叫的閘**。
  //       真的要它會叫, 得有一發連真 DB 的測試 —— 那不在本片射程。
  it('🛑 已知殘餘:auth 與 customers 漂開時, 只差大小寫的第二列寫得進去而畫面印 saved', async () => {
    const url = await run(
      { occupiedEmail: 'Wang.New@example.com' },
      form({ [EMAIL_CHANGE_EMAIL_FIELD]: 'WANG.NEW@example.com' }),
    );
    expect(url).toBe(`/customers/${CUS}?r=customer_email_saved`);
  });
});
