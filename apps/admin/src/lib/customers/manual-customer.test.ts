import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  DUPLICATE_ACCOUNT_WARN_THRESHOLD,
  MANUAL_SYNTHETIC_EMAIL_DOMAIN,
  createManualCustomer,
  findCustomerCandidatesByPhone,
  normalizeManualPhone,
  type ManualCustomerClient,
  MANUAL_PROVIDER,
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
  /** 冪等那條路:這個佔位信箱**先前已經有人用了**(= 同一張表單送過第二次)。 */
  priorByEmail?: Record<string, Row>;
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
        // 🔴 2026-08-28:冪等那條路會用 `.eq('email', …)` 去撈「先前那一發建的人」。
        //    預設回空 = 「這個信箱沒有人用過」;`priorByEmail` 給了才回,那就是撞鍵的世界。
        eq: async (_col: string, value: string) => {
          if (opts.priorByEmail && opts.priorByEmail[value]) {
            return { data: [opts.priorByEmail[value]], error: null };
          }
          return { data: [], error: null };
        },
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

/** 一張建單表單的冪等鍵。🔴 **它現在決定佔位信箱**(codex R1 must-fix,2026-08-28)。 */
const REQ = '11111111-1111-4111-8111-111111111111';
const REQ2 = '22222222-2222-4222-8222-222222222222';

describe('佔位信箱(E4:不可枚舉 + 冪等,兩條都是程式契約)', () => {
  // 🔴🔴 **2026-08-28:這一族的契約換了一次,而換掉的理由要留著。**
  //    ~~舊契約:local-part = 模組內 `crypto.randomUUID()`,「每次都不同」是它的斷言。~~
  //    ⇒ 那讓這條路**沒有任何冪等**:雙擊 ⇒ 兩個真 auth user(codex R1 must-fix)。
  //    ✅ 新契約:local-part = **這張表單的冪等鍵**(caller 給,而只收合法 uuid)。
  //    兩件事同時成立:①不可枚舉(uuid 不是手機號)②同一張表單重送 ⇒ 同一個信箱 ⇒ 撞唯一鍵。
  //    🔴 而「不同表單要建得出第二個帳號」**也是要求**(Sean 08-24 `Q2=甲`:一支電話不設硬上限)
  //       ⇒ 下面那格用兩個不同的 REQ 釘住它。
  it('🔴 信箱由冪等鍵決定 —— 同一張表單 ⇒ 同一個信箱', async () => {
    const a = makeClient({});
    await createManualCustomer(a.client, { name: '王小明', phone: '0912-345-678', requestId: REQ });
    const b = makeClient({});
    await createManualCustomer(b.client, { name: '別人', phone: '0987654321', requestId: REQ });
    expect(a.createArgs[0]!.email).toBe(b.createArgs[0]!.email);
  });

  it('🔴 負對照:【不同】表單 ⇒ 不同信箱(不然一支電話就開不出第二個帳號了)', async () => {
    const a = makeClient({});
    await createManualCustomer(a.client, { name: '王小明', phone: '0912345678', requestId: REQ });
    const b = makeClient({});
    await createManualCustomer(b.client, { name: '王小明', phone: '0912345678', requestId: REQ2 });
    expect(a.createArgs[0]!.email).not.toBe(b.createArgs[0]!.email);
  });

  it('🔴 信箱不含手機號(不可枚舉:照號碼段批次搶註不成立)', async () => {
    const a = makeClient({});
    await createManualCustomer(a.client, { name: '王小明', phone: '0912-345-678', requestId: REQ });
    const email = a.createArgs[0]!.email as string;
    expect(email).not.toContain('0912345678');
    expect(email).not.toContain('0912-345-678');
    expect(email.endsWith(`@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
  });

  it('🔴 冪等鍵不是合法 uuid ⇒ 直接拒,不得把爛字串放進帳號的唯一鍵', async () => {
    const c = makeClient({});
    for (const bad of ['', 'abc', '../../x', '0912345678']) {
      const r = await createManualCustomer(c.client, {
        name: '王小明',
        phone: '0912345678',
        requestId: bad,
      });
      expect(r, `requestId=${bad} 應該被拒`).toMatchObject({ ok: false, reason: 'invalid_request_id' });
    }
    // 🔴 一發都不准送到 createUser。
    expect(c.createArgs.length).toBe(0);
  });

  it('🔴 佔位信箱必須被片0-a 那道判斷式認出來(否則它會被真的寄出去)', async () => {
    const c = makeClient({ verifyRows: undefined });
    await createManualCustomer(c.client, { name: '王小明', phone: '0912345678', requestId: REQ });
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

  // ══ ⟦b4-FINDCUSTOMERPHONE⟧ 2026-09-05:非電話的查詢要送到 RPC 的 name / email 軸 ══
  //   🔬 病:上一版第一件事是 `normalizeManualPhone` = `raw.replace(/\D/g,'')`
  //      ⇒ 打「王小明」得到空字串 ⇒ **直接回空, RPC 根本沒被呼叫**。
  //      而那支 RPC **本來就吃三軸而且姓名有索引** ⇒ 能力是被丟掉的, 不是沒做。
  it('🔴 打【姓名】⇒ 原字串送進 RPC(不是被輾成空字串)', async () => {
    const { client, rpcArgs } = makeClient({ rpcData: { ids: [], truncated: false } });
    await findCustomerCandidatesByPhone(client, '  王小明  ');
    // 🔵 去頭尾空白, 而中間的字一個都不動
    expect(rpcArgs).toEqual([{ p_query: '王小明', p_limit: 20 }]);
  });

  it('🔴 打【email】⇒ 原字串送進 RPC', async () => {
    const { client, rpcArgs } = makeClient({ rpcData: { ids: [], truncated: false } });
    await findCustomerCandidatesByPhone(client, 'ming@gmail.com');
    expect(rpcArgs).toEqual([{ p_query: 'ming@gmail.com', p_limit: 20 }]);
  });

  it('🔵 而【帶符號的電話】仍然走數字那條 —— 放寬不得把它推去搜姓名', async () => {
    // 🛑 這一格擋的是一個很自然的錯修法:「有非數字就當姓名」
    //    ⇒ `+886 912345678` 與 `(02) 2345 6789` 都會被送去搜姓名, 而它們是電話。
    for (const [raw, expected] of [
      ['0912-345-678', '0912345678'],
      ['(02) 2345 6789', '0223456789'],
      ['+886 912345678', '886912345678'],
    ] as const) {
      const { client, rpcArgs } = makeClient({ rpcData: { ids: [], truncated: false } });
      await findCustomerCandidatesByPhone(client, raw);
      expect(rpcArgs, `輸入 ${raw}`).toEqual([{ p_query: expected, p_limit: 20 }]);
    }
  });

  it('🔴🔴 姓名查詢【不得】報重複警告 —— 那個計數在這條路上算不出來', async () => {
    // 🛑 `countSamePhone` 比的是「候選電話正規化後 === 我查的那支電話」。
    //    姓名查詢時那支電話是空字串 ⇒ 它會把**每一個沒有電話的候選**算成同號 ⇒ 假警告。
    //    📌 而假警告比不警告糟:員工會學會忽略它。
    const { client } = makeClient({
      rpcData: { ids: ['u-a', 'u-b'], truncated: false },
      rows: [
        { user_id: 'u-a', name: '王小明', email: 'a@x.com', phone: null },
        { user_id: 'u-b', name: '王小明', email: 'b@x.com', phone: null },
      ],
      metaByUser: {},
    });
    const r = await findCustomerCandidatesByPhone(client, '王小明');
    expect(r.candidates.length).toBe(2);
    expect(r.samePhoneCount).toBe(0);
    expect(r.shouldWarnDuplicates).toBe(false);
  });

  it('🟢 負對照:同一組候選【用電話查】時, 那個計數會動', async () => {
    // 🔴 少了這一格,「姓名查詢回 0」與「這個計數永遠是 0」印同一個東西。
    const { client } = makeClient({
      rpcData: { ids: ['u-a', 'u-b'], truncated: false },
      rows: [
        { user_id: 'u-a', name: '王小明', email: 'a@x.com', phone: '0912345678' },
        { user_id: 'u-b', name: '王小明', email: 'b@x.com', phone: '0912-345-678' },
      ],
      metaByUser: {},
    });
    const r = await findCustomerCandidatesByPhone(client, '0912345678');
    expect(r.samePhoneCount).toBe(2);
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
    const r = await createManualCustomer(client, { name: '王小明', phone: '0912-345-678', requestId: REQ });
    expect(r).toEqual({ ok: true, userId: 'new-user' });
    expect(createArgs[0]!.app_metadata).toEqual({ pcm_provider: 'manual', pcm_manual_phone: '0912345678' });
    expect(createArgs[0]!.user_metadata).toEqual({ name: '王小明', phone: '0912345678' });
  });

  it('🔴🔴 E5 該紅會紅:trigger 沒把 customers 那列建出來 ⇒ 必須失敗,不得回 ok', async () => {
    const { client } = makeClient({ verifyRows: [] }); // ← 模擬 trigger 不在
    await expect(createManualCustomer(client, { name: '王小明', phone: '0912345678', requestId: REQ })).rejects.toThrow(
      /customers 那一列沒有出現/,
    );
  });

  it('🔴🔴 trigger 在、但把值寫錯 ⇒ 必須拋(只數列數的話這格會綠)', async () => {
    const { client } = makeClient({
      // 列出現了,但 name 不是我們送進去的那個
      verifyRows: [{ user_id: 'new-user', name: '別人', email: 'whatever@x', phone: '0912345678' }],
    });
    await expect(createManualCustomer(client, { name: '王小明', phone: '0912345678', requestId: REQ })).rejects.toThrow(
      /內容對不上/,
    );
  });

  it('🔴 確認查詢自己失敗 ⇒ 拋,不得當成成功(nit:原本 mock 從不回 error)', async () => {
    const { client } = makeClient({ selectError: { message: 'connection reset' } });
    await expect(createManualCustomer(client, { name: '王小明', phone: '0912345678', requestId: REQ })).rejects.toMatchObject({
      message: 'connection reset',
    });
  });

  it('🔴 沒有電話 ⇒ 拒絕、連建都不建', async () => {
    const { client, createArgs } = makeClient({});
    const r = await createManualCustomer(client, { name: '王小明', phone: '  -  ', requestId: REQ });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_phone' });
    expect(createArgs).toHaveLength(0);
  });

  // ── 🔴 codex R4 D1:信任邊界。這些會建出【真的 auth user】,不因為「今天沒呼叫端」而可省 ──
  it('🔴 空姓名 ⇒ 拒絕(原本建得出來,而訂單列表會認不出那張單是誰的)', async () => {
    const { client, createArgs } = makeClient({});
    const r = await createManualCustomer(client, { name: '   ', phone: '0912345678', requestId: REQ });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_name' });
    expect(createArgs).toHaveLength(0);
  });

  it('🔴 電話只有 1 個數字 ⇒ 拒絕(原本建得出來,而 `1` 幾乎命中所有人)', async () => {
    const { client, createArgs } = makeClient({});
    const r = await createManualCustomer(client, { name: '王小明', phone: 'abc1', requestId: REQ });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_phone' });
    expect(createArgs).toHaveLength(0);
  });

  it('🔴 邊界:剛好 8 個數字 ⇒ 過(對齊既有註冊規則 packages/schemas/src/index.ts:46 的 {8,})', async () => {
    const { client } = makeClient({});
    expect(await createManualCustomer(client, { name: '王小明', phone: '1234-5678', requestId: REQ })).toMatchObject({ ok: true });
  });

  it('🔴 邊界:7 個數字 ⇒ 拒(證上面那格不是恆真)', async () => {
    const { client } = makeClient({});
    expect(await createManualCustomer(client, { name: '王小明', phone: '1234567', requestId: REQ })).toMatchObject({
      ok: false,
      reason: 'invalid_phone',
    });
  });

  it('🔴 createUser 出錯 ⇒ 直接拋,不得吞', async () => {
    const { client } = makeClient({ createResult: { data: { user: null }, error: { code: 'weak_password' } } });
    await expect(createManualCustomer(client, { name: '王', phone: '0912345678', requestId: REQ })).rejects.toMatchObject({
      code: 'weak_password',
    });
  });

  it('🔴 建成功卻沒回 user.id ⇒ 拋,不得當成成功', async () => {
    const { client } = makeClient({ createResult: { data: { user: null }, error: null } });
    await expect(createManualCustomer(client, { name: '王', phone: '0912345678', requestId: REQ })).rejects.toThrow(/沒有回 user\.id/);
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
    const r = await createManualCustomer(client, { name: '王小明', phone: '0912345678', requestId: REQ });
    expect(r).toMatchObject({ ok: true }); // 本模組沒有任何「太多了就拒絕」的路徑
  });
});

// ── 🔴🔴 codex R2 must-fix(2026-08-28):**上一版的「造病」是假的** ────────────────────
//  R2 逐字:「『造病』用了**互不共享狀態的 client**;兩發都被 mock 成成功,
//  **沒有模擬 email 唯一約束**,也**沒斷言持久化帳號數最後為 1**。」
//  ⇒ 那一版量的是「我餵 email_exists 進去它會怎樣」,不是「重送真的會不會建出第二個帳號」。
//  ⇒ 這一族改成一個**有狀態的假世界**:它自己維護 auth 帳號表、**自己執行 email 唯一約束**,
//    然後**數最後剩幾個帳號**。那個數字在「有冪等」與「沒冪等」兩個世界不同。
type FakeUser = { id: string; email: string; app_metadata: Record<string, unknown> };

/** 一個會自己擋唯一鍵的假世界。`seed` = 這個信箱**先前已經被別人註冊了**(搶註)。 */
type FakeSeed = FakeUser & { customerName?: string; customerPhone?: string };

function makeWorld(seed: FakeSeed[] = []) {
  const users: FakeUser[] = seed.map(({ id, email, app_metadata }) => ({ id, email, app_metadata }));
  // 🔴 種子的 `customers` 那一列**要能指定姓名** —— 否則「姓名一律不同」會把
  //    provider / phone 兩道的判別力整個蓋掉(R3 F3 的同一個病:一個種子同時違反多個條件,
  //    ⇒ 拿掉其中任一道,測試照樣綠)。**每一道鑰匙要有一格只違反它自己。**
  const customers: Row[] = seed.map((u) => ({
    user_id: u.id,
    name: u.customerName ?? '不是我們建的',
    email: u.email,
    phone: u.customerPhone ?? '0900000000',
  }));
  let seq = 0;
  const client = {
    rpc: async () => ({ data: { ids: [], truncated: false }, error: null }),
    auth: {
      admin: {
        createUser: async (attrs: Record<string, unknown>) => {
          const email = attrs.email as string;
          // 🔴 **這就是那道唯一約束** —— 假世界自己執行它,不是測試餵一個 `email_exists` 進去。
          if (users.some((u) => u.email === email)) {
            return { data: { user: null }, error: { code: 'email_exists' } };
          }
          seq += 1;
          const id = `user-${seq}`;
          users.push({ id, email, app_metadata: (attrs.app_metadata ?? {}) as Record<string, unknown> });
          const meta = attrs.user_metadata as { name: string; phone: string };
          customers.push({ user_id: id, name: meta.name, email, phone: meta.phone });
          return { data: { user: { id } }, error: null };
        },
        getUserById: async (id: string) => ({
          data: { user: users.find((u) => u.id === id) ?? null },
          error: null,
        }),
      },
    },
    from: () => ({
      select: () => ({
        eq: async (_c: string, value: string) => ({
          data: customers.filter((r) => r.email === value),
          error: null,
        }),
        in: async (_c: string, ids: string[]) => ({
          data: customers.filter((r) => ids.includes(r.user_id)),
          error: null,
        }),
      }),
    }),
  } as unknown as ManualCustomerClient;
  return { client, users, customers };
}

describe('🔴🔴 同一張表單重送 ⇒ 不得建出第二個帳號(在會擋唯一鍵的假世界裡量)', () => {
  it('送兩發 ⇒ 兩發都成功、指同一個人, 而世界上【只有一個帳號】', async () => {
    const w = makeWorld();
    const input = { name: '王小明', phone: '0912345678', requestId: REQ };
    const first = await createManualCustomer(w.client, input);
    const second = await createManualCustomer(w.client, input);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true, idempotent: true });
    expect((second as { userId: string }).userId).toBe((first as { userId: string }).userId);
    // 🔴 **這一格才是病的量具**:沒有冪等的世界這裡會是 2。
    expect(w.users.length, '重送建出了第二個真帳號 —— 那正是 codex R1 抓到的病').toBe(1);
  });

  it('🔴 負對照:【不同表單】送兩發 ⇒ 真的建出兩個(Sean「一支電話不設硬上限」那道拍板)', async () => {
    const w = makeWorld();
    await createManualCustomer(w.client, { name: '王小明', phone: '0912345678', requestId: REQ });
    await createManualCustomer(w.client, { name: '王小明', phone: '0912345678', requestId: REQ2 });
    expect(w.users.length).toBe(2);
  });

  // ── 🔴🔴 codex R2 must-fix:**搶註那個世界** ────────────────────────────────────
  //  `mrid` 出現在後台網址上 ⇒ 外洩之後信箱算得出來 ⇒ 對方可以先去公開 signup 佔住它。
  //  舊版:我方撞鍵 ⇒ 撈第一筆同信箱 ⇒ **把對方的帳號當成這位客人** ⇒ 訂單掛到對方頭上。
  it('🔴🔴 信箱被【別人】先註冊走 ⇒ 必須拋, 不得把對方的帳號當成這位客人', async () => {
    const squatted = `manual_${REQ}@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`;
    // 🔴 攻擊者走的是公開 signup ⇒ 他**寫不到 `app_metadata`**(service_role only)⇒ 那裡是空的。
    const w = makeWorld([{ id: 'attacker', email: squatted, app_metadata: {} }]);
    await expect(
      createManualCustomer(w.client, { name: '王小明', phone: '0912345678', requestId: REQ }),
    ).rejects.toThrow(/已經被用過/);
    // 🔴 一個字都不得洩漏給畫面 —— 而且不准新增任何東西。
    expect(w.users.length).toBe(1);
  });

  it('🔴 同信箱、有身分鍵但【電話不同】⇒ 也要拋(身分鍵不是唯一的判準)', async () => {
    const squatted = `manual_${REQ}@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`;
    // 🔴 讓**其他兩道全部通過**(provider 對、姓名對)—— 只有這樣這一格才證得了 phone 那道在做事。
    //    第一版沒有 `customerName` ⇒ 姓名那道也違反 ⇒ 突變「刪掉 phone clause」時它照樣綠。
    const w = makeWorld([
      {
        id: 'other-manual',
        email: squatted,
        app_metadata: { pcm_provider: MANUAL_PROVIDER, pcm_manual_phone: '0988888888' },
        customerName: '王小明',
      },
    ]);
    await expect(
      createManualCustomer(w.client, { name: '王小明', phone: '0912345678', requestId: REQ }),
    ).rejects.toThrow(/已經被用過/);
  });

  it('🔴 不是撞鍵的錯 ⇒ 原樣拋, 不得走回收路徑', async () => {
    const c = makeClient({ createResult: { data: { user: null }, error: { code: 'boom' } } });
    await expect(
      createManualCustomer(c.client, { name: '王小明', phone: '0912345678', requestId: REQ }),
    ).rejects.toMatchObject({ code: 'boom' });
  });
});

// ── 🔴 R3 補的四格:每一格都對著一個【上一版恆綠】的世界 ────────────────────────────
describe('🔴 R3:回收路徑的三把鑰匙, 每一把都要有自己的負測', () => {
  const EMAIL = `manual_${REQ}@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`;

  // F3:上一版的 squatter 種子 `app_metadata: {}` **同時**過不了 provider 與 phone 兩道
  //     ⇒ 把 provider 那道刪掉,兩格照樣綠。這一格只讓 provider 那道有判別力。
  it('🔴 F3:電話對、姓名也對、【只差沒有身分鍵】⇒ 仍要拋', async () => {
    // 🔴 這一格刻意讓**其他兩道全部通過** —— 只有這樣才證得了 provider 那道在做事。
    //    (第一版三道一起違反 ⇒ 把 provider 那道整段刪掉, 測試照樣綠。實測過:
    //     突變「刪掉 provider clause」⇒ 190 格全綠。**那就是恆綠。**)
    const w = makeWorld([
      {
        id: 'no-provider',
        email: EMAIL,
        app_metadata: { pcm_manual_phone: '0912345678' },
        customerName: '王小明',
        customerPhone: '0912345678',
      },
    ]);
    await expect(
      createManualCustomer(w.client, { name: '王小明', phone: '0912345678', requestId: REQ }),
    ).rejects.toThrow(/已經被用過/);
  });

  // F1:這是 R3 唯一一條 must-fix 的量具。**上一版 51 格裡沒有一格餵過這組輸入。**
  it('🔴🔴 F1:同鍵、同電話、【不同姓名】⇒ 必須拋, 不得靜默回第一位的 userId', async () => {
    const w = makeWorld([
      {
        id: 'someone-else',
        email: EMAIL,
        app_metadata: { pcm_provider: MANUAL_PROVIDER, pcm_manual_phone: '0912345678' },
        customerName: '王小明',
        customerPhone: '0912345678',
      },
    ]);
    // 🔴 電話刻意**相同** —— 那正是 Sean 明文允許共用的那一欄。
    //    上一版兩把鑰匙(provider + phone)在這裡**全部通過**,然後把別人交出去。
    await expect(
      createManualCustomer(w.client, { name: '另一個人', phone: '0912345678', requestId: REQ }),
    ).rejects.toThrow(/已經被用過/);
  });

  it('🔴 負對照:三欄全對 ⇒ 才回 idempotent(證明上面兩格不是「一律拋」)', async () => {
    const w = makeWorld();
    const first = await createManualCustomer(w.client, {
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    const second = await createManualCustomer(w.client, {
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(second).toMatchObject({ ok: true, idempotent: true });
    expect((second as { userId: string }).userId).toBe((first as { userId: string }).userId);
  });

  // F6:`auth.users` 那道唯一索引比的是 **email 原字串**(2026-08-28 對正式庫唯讀量過:
  //     `users_email_partial_key ... btree (email) WHERE (is_sso_user = false)`)
  //     ⇒ 大小寫不同的 mrid 若不折平,就是兩個不同的信箱 ⇒ 冪等直接失效。
  it('🔴 F6:大寫的 mrid 與小寫的 mrid ⇒ 必須算出【同一個】信箱', async () => {
    // 🔴🔴 **這顆鍵必須帶英文字母。** 第一版用了 `REQ`(全是數字)⇒ `toUpperCase()` 等於它自己
    //    ⇒ 突變「拿掉 `.toLowerCase()`」時這一格**照樣綠**。實測過:190 格全綠。
    //    📌 **一個大小寫測試,餵了一個沒有大小寫的值。**
    const HEX = 'abcdef01-abcd-4abc-8abc-abcdefabcdef';
    const a = makeWorld();
    await createManualCustomer(a.client, {
      name: '王小明',
      phone: '0912345678',
      requestId: HEX.toUpperCase(),
    });
    const b = makeWorld();
    await createManualCustomer(b.client, { name: '王小明', phone: '0912345678', requestId: HEX });
    expect(a.users[0]!.email).toBe(b.users[0]!.email);
    expect(a.users[0]!.email).toBe(`manual_${HEX}@${MANUAL_SYNTHETIC_EMAIL_DOMAIN}`);
  });
});
