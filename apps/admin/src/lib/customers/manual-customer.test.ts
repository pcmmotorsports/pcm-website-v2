import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  DUPLICATE_ACCOUNT_WARN_THRESHOLD,
  MANUAL_SYNTHETIC_EMAIL_DOMAIN,
  createManualCustomer,
  findCustomerCandidatesByPhone,
  normalizeManualPhone,
  type ManualCustomerClient,
} from './manual-customer';
import { isSyntheticEmailDomain } from '@pcm/schemas';

type Row = { user_id: string; name: string; email: string; phone: string | null };

function makeClient(opts: {
  rpcData?: unknown;
  rows?: Row[];
  metaByUser?: Record<string, Record<string, unknown>>;
  createResult?: { data: { user: { id: string } | null }; error: { code?: string } | null };
  /** 建帳號那條路:確認查詢要回什麼。不給 ⇒ **回聲**(照剛剛送進去的值組),= trigger 正常。 */
  verifyRows?: Row[];
  /** 確認查詢自己失敗(nit:原本 mock 永遠 error:null,沒覆蓋這條)。 */
  selectError?: { message?: string };
}) {
  const createArgs: Array<Record<string, unknown>> = [];
  const rpcArgs: Array<{ p_query: string; p_limit: number }> = [];
  const client = {
    rpc: async (_fn: string, args: { p_query: string; p_limit: number }) => {
      rpcArgs.push(args);
      return { data: opts.rpcData ?? { ids: [], truncated: false }, error: null };
    },
    auth: {
      admin: {
        createUser: async (attrs: Record<string, unknown>) => {
          createArgs.push(attrs);
          return opts.createResult ?? { data: { user: { id: 'new-user' } }, error: null };
        },
        getUserById: async (id: string) => ({
          data: { user: { app_metadata: opts.metaByUser?.[id] ?? {} } },
          error: null,
        }),
      },
    },
    from: () => ({
      select: () => ({
        in: async () => {
          if (opts.selectError) return { data: null, error: opts.selectError };
          if (opts.verifyRows) return { data: opts.verifyRows, error: null };
          if (opts.rows) return { data: opts.rows, error: null };
          // 🔴 預設 = **回聲**:trigger 正常時,customers 那列的值就是剛剛送進去的那組。
          const last = createArgs[createArgs.length - 1];
          if (!last) return { data: [], error: null };
          const meta = last.user_metadata as { name: string; phone: string };
          return {
            data: [{ user_id: 'new-user', name: meta.name, email: last.email as string, phone: meta.phone }],
            error: null,
          };
        },
      }),
    }),
  } as unknown as ManualCustomerClient;
  return { client, createArgs, rpcArgs };
}

describe('佔位信箱(E4:不可枚舉是程式契約,不是一句話)', () => {
  it('🔴🔴 隨機源【真的在模組內】—— spy `crypto.randomUUID`,證它被呼叫到', async () => {
    // 🔴 codex R3:原本那格只比「兩次結果不同」,把實作換成 `let seq=0; ++seq` **照樣全綠**
    //    ⇒ 它證不了「隨機源在模組內」。這一格直接盯那支 API。
    const spy = vi.spyOn(crypto, 'randomUUID');
    const c = makeClient({});
    await createManualCustomer(c.client, { name: '王小明', phone: '0912345678' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(c.createArgs[0]!.email).toContain(spy.mock.results[0]!.value as string);
    spy.mockRestore();
  });

  it('🔴 建出來的信箱不含手機號,而且每次都不同', async () => {
    const a = makeClient({ verifyRows: undefined });
    await createManualCustomer(a.client, { name: '王小明', phone: '0912-345-678' });
    const b = makeClient({ verifyRows: undefined });
    await createManualCustomer(b.client, { name: '王小明', phone: '0912-345-678' });

    const emailA = a.createArgs[0]!.email as string;
    const emailB = b.createArgs[0]!.email as string;
    expect(emailA).not.toContain('0912345678');
    expect(emailA).not.toBe(emailB); // 🔴 同樣的輸入 ⇒ 不同的信箱(隨機源在模組內)
    expect(emailA.endsWith(`@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
  });

  it('🔴 佔位信箱必須被片0-a 那道判斷式認出來(否則它會被真的寄出去)', async () => {
    const c = makeClient({ verifyRows: undefined });
    await createManualCustomer(c.client, { name: '王小明', phone: '0912345678' });
    expect(isSyntheticEmailDomain(c.createArgs[0]!.email as string)).toBe(true);
  });

  it('負對照:真客人的信箱不會被當成合成信箱', () => {
    expect(isSyntheticEmailDomain('customer@example.com')).toBe(false);
  });
});

describe('findCustomerCandidatesByPhone(本模組不認人,只列候選)', () => {
  it('🔴 用正規化後的數字去問現成 RPC(那支會把【存起來的】電話也去非數字 ⇒ 前台客人也找得到)', async () => {
    const { client, rpcArgs } = makeClient({ rpcData: { ids: [], truncated: false } });
    await findCustomerCandidatesByPhone(client, '0912-345-678');
    expect(rpcArgs).toEqual([{ p_query: '0912345678', p_limit: 20 }]);
  });

  it('🔴🔴 候選同時包含【後台開的】與【客人自己註冊的】—— 後者正是 C-F1 那個會被漏掉的人', async () => {
    const { client } = makeClient({
      rpcData: { ids: ['u-manual', 'u-web'], truncated: false },
      rows: [
        { user_id: 'u-manual', name: '王小明', email: 'manual_x@manual.pcmmotorsports.local', phone: '0912345678' },
        { user_id: 'u-web', name: '王小明', email: 'ming@gmail.com', phone: '0912-345-678' },
      ],
      metaByUser: { 'u-manual': { pcm_provider: 'manual' } },
    });
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.candidates.map((c) => [c.userId, c.isManual])).toEqual([
      ['u-manual', true],
      ['u-web', false], // ← 客人自己註冊的:**要出現在清單上讓員工看到**
    ]);
  });

  it('🔴 isManual 看的是 app_metadata,不是信箱網域(網域可以被搶註)', async () => {
    const { client } = makeClient({
      rpcData: { ids: ['u-fake'], truncated: false },
      // 信箱長得像我們的,但沒有身分鍵 ⇒ 必須標成「不是後台開的」
      rows: [{ user_id: 'u-fake', name: '假的', email: 'manual_zzz@manual.pcmmotorsports.local', phone: '0912345678' }],
      metaByUser: {},
    });
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.candidates[0]!.isManual).toBe(false);
  });

  it('🔴 命中太多被截斷 ⇒ 旗標要傳出去(靜默截斷會讓員工以為就這幾個)', async () => {
    const { client } = makeClient({
      rpcData: { ids: ['u1'], truncated: true },
      rows: [{ user_id: 'u1', name: 'A', email: 'a@b.c', phone: '1' }],
    });
    expect((await findCustomerCandidatesByPhone(client, '0912345678')).truncated).toBe(true);
  });

  it('🔴 RPC 回傳形狀不對 ⇒ 拋,不得靜默回空清單(查不到 vs 查壞了要分得開)', async () => {
    const { client } = makeClient({ rpcData: { nope: 1 } });
    await expect(findCustomerCandidatesByPhone(client, '0912345678')).rejects.toThrow(/形狀不對/);
  });

  it('沒有電話 ⇒ 回空清單、不打 RPC', async () => {
    const { client, rpcArgs } = makeClient({});
    expect(await findCustomerCandidatesByPhone(client, ' - ')).toEqual({
      candidates: [],
      truncated: false,
      samePhoneCount: 0,
      shouldWarnDuplicates: false,
    });
    expect(rpcArgs).toHaveLength(0);
  });
});

describe('createManualCustomer(永遠建新的,永不自動重用)', () => {
  it('建成功 ⇒ 回 userId;身分鍵與顯示資料都蓋上,phone 存正規化後的數字', async () => {
    const { client, createArgs } = makeClient({
      
    });
    const r = await createManualCustomer(client, { name: '王小明', phone: '0912-345-678' });
    expect(r).toEqual({ ok: true, userId: 'new-user' });
    expect(createArgs[0]!.app_metadata).toEqual({ pcm_provider: 'manual', pcm_manual_phone: '0912345678' });
    expect(createArgs[0]!.user_metadata).toEqual({ name: '王小明', phone: '0912345678' });
  });

  it('🔴🔴 E5 該紅會紅:trigger 沒把 customers 那列建出來 ⇒ 必須失敗,不得回 ok', async () => {
    const { client } = makeClient({ verifyRows: [] }); // ← 模擬 trigger 不在
    await expect(createManualCustomer(client, { name: '王小明', phone: '0912345678' })).rejects.toThrow(
      /customers 那一列沒有出現/,
    );
  });

  it('🔴🔴 trigger 在、但把值寫錯 ⇒ 必須拋(只數列數的話這格會綠)', async () => {
    const { client } = makeClient({
      // 列出現了,但 name 不是我們送進去的那個
      verifyRows: [{ user_id: 'new-user', name: '別人', email: 'whatever@x', phone: '0912345678' }],
    });
    await expect(createManualCustomer(client, { name: '王小明', phone: '0912345678' })).rejects.toThrow(
      /內容對不上/,
    );
  });

  it('🔴 確認查詢自己失敗 ⇒ 拋,不得當成成功(nit:原本 mock 從不回 error)', async () => {
    const { client } = makeClient({ selectError: { message: 'connection reset' } });
    await expect(createManualCustomer(client, { name: '王小明', phone: '0912345678' })).rejects.toMatchObject({
      message: 'connection reset',
    });
  });

  it('🔴 沒有電話 ⇒ 拒絕、連建都不建', async () => {
    const { client, createArgs } = makeClient({});
    const r = await createManualCustomer(client, { name: '王小明', phone: '  -  ' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_phone' });
    expect(createArgs).toHaveLength(0);
  });

  // ── 🔴 codex R4 D1:信任邊界。這些會建出【真的 auth user】,不因為「今天沒呼叫端」而可省 ──
  it('🔴 空姓名 ⇒ 拒絕(原本建得出來,而訂單列表會認不出那張單是誰的)', async () => {
    const { client, createArgs } = makeClient({});
    const r = await createManualCustomer(client, { name: '   ', phone: '0912345678' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_name' });
    expect(createArgs).toHaveLength(0);
  });

  it('🔴 電話只有 1 個數字 ⇒ 拒絕(原本建得出來,而 `1` 幾乎命中所有人)', async () => {
    const { client, createArgs } = makeClient({});
    const r = await createManualCustomer(client, { name: '王小明', phone: 'abc1' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_phone' });
    expect(createArgs).toHaveLength(0);
  });

  it('🔴 邊界:剛好 8 個數字 ⇒ 過(對齊既有註冊規則 packages/schemas/src/index.ts:46 的 {8,})', async () => {
    const { client } = makeClient({});
    expect(await createManualCustomer(client, { name: '王小明', phone: '1234-5678' })).toMatchObject({ ok: true });
  });

  it('🔴 邊界:7 個數字 ⇒ 拒(證上面那格不是恆真)', async () => {
    const { client } = makeClient({});
    expect(await createManualCustomer(client, { name: '王小明', phone: '1234567' })).toMatchObject({
      ok: false,
      reason: 'invalid_phone',
    });
  });

  it('🔴 createUser 出錯 ⇒ 直接拋,不得吞', async () => {
    const { client } = makeClient({ createResult: { data: { user: null }, error: { code: 'weak_password' } } });
    await expect(createManualCustomer(client, { name: '王', phone: '0912345678' })).rejects.toMatchObject({
      code: 'weak_password',
    });
  });

  it('🔴 建成功卻沒回 user.id ⇒ 拋,不得當成成功', async () => {
    const { client } = makeClient({ createResult: { data: { user: null }, error: null } });
    await expect(createManualCustomer(client, { name: '王', phone: '0912345678' })).rejects.toThrow(/沒有回 user\.id/);
  });

  it('電話正規化:不同寫法算同一支(它現在只是搜尋提示,不是身分鍵)', () => {
    expect(normalizeManualPhone('0912-345-678')).toBe('0912345678');
    expect(normalizeManualPhone('0912 345 678')).toBe('0912345678');
  });
});

// ── Sean 2026-08-24 `Q2=甲`:一支電話**不設硬上限**,但**超過 2 個**就在建單畫面出現【警告】──
describe('重複帳號警告(是警告,不是擋)', () => {
  it('門檻常數 = 2(Sean 逐字「超過 2 個」)', () => {
    expect(DUPLICATE_ACCOUNT_WARN_THRESHOLD).toBe(2);
  });

  function clientWithPhones(phones: string[]) {
    const ids = phones.map((_, i) => `u${i}`);
    return makeClient({
      rpcData: { ids, truncated: false },
      rows: phones.map((p, i) => ({ user_id: `u${i}`, name: '王小明', email: `u${i}@x.test`, phone: p })),
    });
  }

  it('🔴 2 個 ⇒ 不警告(門檻是「超過 2」,不是「2 以上」)', async () => {
    const { client } = clientWithPhones(['0912345678', '0912-345-678']);
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.samePhoneCount).toBe(2);
    expect(r.shouldWarnDuplicates).toBe(false);
  });

  it('🔴🔴 3 個 ⇒ 警告(拿掉那個判斷,這一格必須紅)', async () => {
    const { client } = clientWithPhones(['0912345678', '0912-345-678', '0912 345 678']);
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.samePhoneCount).toBe(3);
    expect(r.shouldWarnDuplicates).toBe(true);
  });

  it('🔴 數的是【所有帳號】,含客人自己在前台註冊的(傷害不分帳號是誰建的)', async () => {
    const { client } = makeClient({
      rpcData: { ids: ['u0', 'u1', 'u2'], truncated: false },
      rows: [
        { user_id: 'u0', name: '王小明', email: 'manual_a@manual.pcmmotorsports.local', phone: '0912345678' },
        { user_id: 'u1', name: '王小明', email: 'manual_b@manual.pcmmotorsports.local', phone: '0912345678' },
        { user_id: 'u2', name: '王小明', email: 'ming@gmail.com', phone: '0912-345-678' }, // ← 客人自己註冊的
      ],
      metaByUser: { u0: { pcm_provider: 'manual' }, u1: { pcm_provider: 'manual' } },
    });
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    // 只數 manual 的話是 2 ⇒ 不警告;數全部是 3 ⇒ 警告。**低估的方向正好是靜默。**
    expect(r.candidates.filter((c) => c.isManual)).toHaveLength(2);
    expect(r.samePhoneCount).toBe(3);
    expect(r.shouldWarnDuplicates).toBe(true);
  });

  it('🔴🔴 E1 fail-safe:命中被截斷 ⇒ 一律警告(此時數出來的可能反而偏小)', async () => {
    const { client } = makeClient({
      rpcData: { ids: ['u0'], truncated: true },
      rows: [{ user_id: 'u0', name: '王小明', email: 'a@x.test', phone: '0912345678' }],
    });
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.samePhoneCount).toBe(1); // 只數到 1
    expect(r.truncated).toBe(true);
    expect(r.shouldWarnDuplicates).toBe(true); // 🔴 但仍要警告
  });

  it('🔴 候選數 ≠ 同電話數:跨欄命中(Email 裡含那串數字)不算進警告', async () => {
    const { client } = makeClient({
      rpcData: { ids: ['u0', 'u1', 'u2'], truncated: false },
      rows: [
        { user_id: 'u0', name: '王小明', email: 'a@x.test', phone: '0912345678' },
        { user_id: 'u1', name: '別人', email: 'a0912345678@x.test', phone: '0987654321' }, // Email 命中
        { user_id: 'u2', name: '別人2', email: 'b0912345678@x.test', phone: '0900000000' },
      ],
    });
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.candidates).toHaveLength(3); // 候選 3 個
    expect(r.samePhoneCount).toBe(1); // 🔴 但同電話只有 1 個
    expect(r.shouldWarnDuplicates).toBe(false); // ⇒ 不該警告
  });

  it('🔴 警告【不擋】建帳號 —— Sean 明講不設硬上限', async () => {
    const { client } = makeClient({});
    const r = await createManualCustomer(client, { name: '王小明', phone: '0912345678' });
    expect(r).toMatchObject({ ok: true }); // 本模組沒有任何「太多了就拒絕」的路徑
  });
});
