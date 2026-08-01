import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('./session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('./audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

// 🔴 **只換掉兩支寫入函式,`SupplierCallerBugError` 用真的那一個。**
//    若在 mock 裡自己 `class SupplierCallerBugError extends Error {}`,
//    「bug 與 error 分得開」就變成自我實現:測試丟的是假 class、action 比對的也是同一個假 class,
//    真實作哪天改成不 extends Error 或改了 name,測試照樣全綠。
vi.mock('./supplier-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supplier-repository')>();
  return {
    ...actual,
    createSupplier: mocks.createSupplier,
    updateSupplier: mocks.updateSupplier,
  };
});

// 🔴 **解析器刻意不 mock** —— 驗收 2「解析失敗 ⇒ invalid 且 repository 零呼叫」若把解析器
//    也換成 mock,測到的是「假的 ok:false 會 redirect invalid」= 恆真,證不到真表單擋得住。
//    本檔一律餵真 FormData 走真解析器。
import {
  createSupplierAction,
  renameSupplierAction,
  setSupplierActiveAction,
} from './supplier-actions';
import { SupplierCallerBugError } from './supplier-repository';

const PATH = '/settings/suppliers';
const TARGET_ID = '11111111-2222-3333-4444-555555555555';
const ZWSP = String.fromCharCode(0x200b);

function formOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const createForm = (label = 'AKOSO') => formOf({ label });
const renameForm = (label = '老吳車業', id = TARGET_ID) =>
  formOf({ id, label });
const activeForm = (isActive = 'false', id = TARGET_ID) =>
  formOf({ id, is_active: isActive });

/**
 * 取出 redirect 的**完整** URL 字串。
 * 🔴 不用 `rejects.toThrow(url)`:那是**子字串**比對,`?r=created&q=任何東西` 也會過
 *    ⇒ 驗收 6「無額外參數面」變成測不到的字面。整串 `toBe` + 釘住恰呼叫一次。
 */
async function redirectUrlOf(action: Promise<void>): Promise<string> {
  await expect(action).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

function expectNoWrite(): void {
  expect(mocks.createSupplier).not.toHaveBeenCalled();
  expect(mocks.updateSupplier).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.authorizeAdminMutation.mockResolvedValue({
    sid: 'sid-1',
    actorId: 'sean',
  });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.createSupplier.mockResolvedValue('CREATED');
  mocks.updateSupplier.mockResolvedValue('UPDATED');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ALL_ACTIONS = [
  ['create', () => createSupplierAction(createForm())],
  ['rename', () => renameSupplierAction(renameForm())],
  ['active', () => setSupplierActiveAction(activeForm())],
] as const;

// ── 驗收 1:授權失敗 ⇒ denied,且 repository 零呼叫 ─────────────────
describe('supplier actions — 授權閘', () => {
  it.each(ALL_ACTIONS)(
    'should redirect denied before any write when %s is unauthorized',
    async (_name, invoke) => {
      mocks.authorizeAdminMutation.mockResolvedValue(null);

      expect(await redirectUrlOf(invoke())).toBe(`${PATH}?r=denied`);
      expectNoWrite();
      // 授權失敗連 requestId 都不該取(還沒進到要記錄的階段)。
      expect(mocks.getRequestId).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  // 🔴🔴 **兩閘的順序**(codex K2 must-fix):上面那組餵的是**合法**表單、下面解析閘那組
  //    餵的是**已授權** ⇒ 兩組都沒有釘住「誰先跑」。把解析移到授權前,兩組**照樣全綠**,
  //    但未授權者送一張爛表單會拿到 `invalid` 而不是 `denied`
  //    = 對**未經授權**的呼叫者洩漏「你的表單格式不對」這件事(以及解析器的存在與規則)。
  //    ⇒ 必須有一條同時不合法的向量,才分得出順序。
  it.each([
    ['create', () => createSupplierAction(createForm(ZWSP))],
    ['rename', () => renameSupplierAction(renameForm('X', 'nope'))],
    ['active', () => setSupplierActiveAction(activeForm('on'))],
  ])(
    'should answer denied, not invalid, when %s is both unauthorized and malformed',
    async (_name, invoke) => {
      mocks.authorizeAdminMutation.mockResolvedValue(null);

      expect(await redirectUrlOf(invoke())).toBe(`${PATH}?r=denied`);
      expectNoWrite();
    },
  );

  // 🔴🔴 上面那組只釘住**回應的優先序**(codex K2 R2 must-fix):解析搬到授權之前但仍先回
  //    `denied` ⇒ 照樣全綠。要證**短路**,得讓「解析器有沒有被碰到」變成可觀察事件:
  //    餵一顆 `get()` 會爆炸的 FormData。真短路 ⇒ 永不踩到;順序反過來 ⇒ 收到 TypeError 轉紅。
  //    (不必 mock 解析器 ⇒ 不會把「走真解析器」這個前提換掉。)
  it.each([
    ['create', createSupplierAction],
    ['rename', renameSupplierAction],
    ['active', setSupplierActiveAction],
  ])('should not even read the form for %s when unauthorized', async (_name, invoke) => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const landmine = {
      get() {
        throw new Error('解析器不該在授權閘之前被呼叫');
      },
    } as unknown as FormData;

    expect(await redirectUrlOf(invoke(landmine))).toBe(`${PATH}?r=denied`);
  });
});

// ── 驗收 2:解析失敗 ⇒ invalid,且 repository 零呼叫 ────────────────
describe('supplier actions — 解析閘', () => {
  it.each([
    // 純零寬空白:JS `.trim()` 過得了、rpcTrim 過不了 ⇒ 這條同時證明 action 走的是真解析器。
    ['create 的 label 只有零寬空白', () => createSupplierAction(createForm(ZWSP))],
    ['create 的 label 超過 100 字', () => createSupplierAction(createForm('a'.repeat(101)))],
    ['rename 的 id 不是 uuid', () => renameSupplierAction(renameForm('X', 'nope'))],
    ['rename 的 label 空白', () => renameSupplierAction(renameForm(' '))],
    ['active 的 is_active 是 on 而非 true/false', () => setSupplierActiveAction(activeForm('on'))],
  ])('should redirect invalid without touching the repository when %s', async (_case, invoke) => {
    expect(await redirectUrlOf(invoke())).toBe(`${PATH}?r=invalid`);
    expectNoWrite();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

// ── 驗收 5:成功路徑的結果碼與 revalidatePath ───────────────────────
describe('supplier actions — 成功路徑', () => {
  it('should map a create to r=created and revalidate the settings path', async () => {
    expect(await redirectUrlOf(createSupplierAction(createForm()))).toBe(
      `${PATH}?r=created`,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  // 🔴 逐欄斷言:mock 無論收到什麼都回 CREATED ⇒ 少了這條,實作把 label 送成 undefined
  //    或偷偷多送一個 id 都會全綠。深度相等(toHaveBeenCalledWith 整個物件)才擋得住。
  it('should call createSupplier with the parsed label and no id field at all', async () => {
    await redirectUrlOf(createSupplierAction(createForm(`  Webike TW  `)));

    expect(mocks.createSupplier).toHaveBeenCalledTimes(1);
    expect(mocks.createSupplier).toHaveBeenCalledWith({
      label: 'Webike TW', // 已剝空白
      actor: 'sean',
      requestId: 'req-1',
    });
  });

  // 🔴 Sean 2026-08-02 拍板 Q3=C:改名不填原因 ⇒ **不送 note**。
  //    這條深度相等斷言就是那個拍板的守門:哪天有人「順手」加一個 note 欄位進來,它會轉紅。
  it('should call updateSupplier with id and label only, never a note (Q3=C)', async () => {
    await redirectUrlOf(renameSupplierAction(renameForm('老吳車業')));

    expect(mocks.updateSupplier).toHaveBeenCalledTimes(1);
    expect(mocks.updateSupplier).toHaveBeenCalledWith({
      id: TARGET_ID,
      label: '老吳車業',
      actor: 'sean',
      requestId: 'req-1',
    });
  });

  it.each([
    ['UPDATED', 'saved'],
    ['NO_CHANGE', 'nochange'],
    ['NOT_FOUND', 'notfound'],
  ])('should map the rename result %s to r=%s', async (result, code) => {
    mocks.updateSupplier.mockResolvedValue(result);

    expect(await redirectUrlOf(renameSupplierAction(renameForm()))).toBe(
      `${PATH}?r=${code}`,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  // 🔴 `isActive: false` 必須真的送 false —— 被 `??`/`||` 吃成 undefined 的話,
  //    「停用」會變成「什麼都不動」= 按了沒反應而且零錯誤。
  it.each([
    ['false', false],
    ['true', true],
  ])('should forward the %s toggle direction verbatim', async (raw, expected) => {
    // 🔴 結果碼也要斷言:少了它,把最後一行改成 redirectWith('created') 照樣全綠。
    expect(await redirectUrlOf(setSupplierActiveAction(activeForm(raw)))).toBe(
      `${PATH}?r=saved`,
    );

    // 🔴 次數斷言(codex K2 nit):少了它,同一支 owner RPC 被呼叫兩次也全綠
    //    ⇒ 一次點擊寫兩列稽核而測試無感。
    expect(mocks.updateSupplier).toHaveBeenCalledTimes(1);
    expect(mocks.updateSupplier).toHaveBeenCalledWith({
      id: TARGET_ID,
      isActive: expected,
      actor: 'sean',
      requestId: 'req-1',
    });
  });

  // 🔴 codex K2 must-fix:切換啟用**只測了 UPDATED** ⇒ 把該 action 的結尾寫死成
  //    `redirectWith('saved')` 照樣全綠,而 `NO_CHANGE` / `NOT_FOUND` 會回錯的結果碼
  //    (員工按了「啟用」、那家其實已被別人刪改,他看到的卻是「已儲存」)。
  // 🔴 `UPDATED` 那格刻意不列(codex K2 R2 nit):它已被上面兩條 toggle-direction 測試
  //    嚴格蘊含,列進來只是把同一份證據數成兩格。
  it.each([
    ['NO_CHANGE', 'nochange'],
    ['NOT_FOUND', 'notfound'],
  ])('should map the toggle result %s to r=%s', async (result, code) => {
    mocks.updateSupplier.mockResolvedValue(result);

    expect(await redirectUrlOf(setSupplierActiveAction(activeForm()))).toBe(
      `${PATH}?r=${code}`,
    );
  });

  // 🔴🔴 codex K2 R2 must-fix:切換啟用那條路的 `revalidatePath` **完全沒被斷言** ——
  //    刪掉它,上面的結果碼全部照樣綠 ⇒ 驗收 5 在這條路上是假綠。
  //    (前兩輪突變只蓋到失敗路徑 M6 與撞名路徑 M10,漏了這條。)
  it.each(['UPDATED', 'NO_CHANGE', 'NOT_FOUND'])(
    'should revalidate the list after a toggle returning %s',
    async (result) => {
      mocks.updateSupplier.mockResolvedValue(result);

      await redirectUrlOf(setSupplierActiveAction(activeForm()));

      expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
    },
  );
});

// ── 驗收 3:SupplierCallerBugError ⇒ bug,且與一般 error 分得開 ──────
describe('supplier actions — 失敗分流', () => {
  const bug = () =>
    new SupplierCallerBugError('createSupplier 收到 id —— 新增路徑不接受 id');
  const dbError = () => ({ code: '42501', message: 'permission denied' });

  it.each([
    ['create', () => createSupplierAction(createForm()), () => mocks.createSupplier],
    ['rename', () => renameSupplierAction(renameForm()), () => mocks.updateSupplier],
    ['active', () => setSupplierActiveAction(activeForm()), () => mocks.updateSupplier],
  ])(
    'should map a caller-contract violation on %s to r=bug, not r=error',
    async (_name, invoke, getMock) => {
      getMock().mockRejectedValue(bug());

      expect(await redirectUrlOf(invoke())).toBe(`${PATH}?r=bug`);
    },
    // 🔴 「bug 與 error 分得開」的證據是**本組與下一組互為對照**,不是任何單獨一條:
    //    把兩個 catch 分支合併成一個 ⇒ 合併成 error 則本組 3 條紅、合併成 bug 則下一組 3 條紅。
    //    (別在這裡加一條「bug !== error」的字面比較 —— 那是恆真斷言、零判別力。)
  );

  it.each([
    ['create', () => createSupplierAction(createForm()), () => mocks.createSupplier],
    ['rename', () => renameSupplierAction(renameForm()), () => mocks.updateSupplier],
    ['active', () => setSupplierActiveAction(activeForm()), () => mocks.updateSupplier],
  ])(
    'should map an ordinary database failure on %s to r=error',
    async (_name, invoke, getMock) => {
      getMock().mockRejectedValue(dbError());

      expect(await redirectUrlOf(invoke())).toBe(`${PATH}?r=error`);
    },
  );

  // 🔴 「改名收到 CREATED」那一支代表**已經寫進去一筆刪不掉的供應商** ⇒ 清單必須重取,
  //    否則訊息叫員工「通知維護者」,維護者來看時畫面上根本沒有那一列。
  it('should revalidate the list even when the write failed as a caller bug', async () => {
    mocks.updateSupplier.mockRejectedValue(bug());

    await redirectUrlOf(renameSupplierAction(renameForm()));

    expect(mocks.revalidatePath).toHaveBeenCalledWith(PATH);
  });

  // 🔴 `Promise.reject(null)` 合法(codex K2 R2 nit)。沒有 `error ?? {}`,logger 讀 `.code`
  //    會自己拋 TypeError,而它已經在 catch 裡 ⇒ 穿出 action、員工看到 500 不是 `r=error`。
  it.each([['null', null], ['undefined', undefined]])(
    'should still answer r=error when the rejection value is %s',
    async (_name, thrown) => {
      mocks.createSupplier.mockRejectedValue(thrown);

      expect(await redirectUrlOf(createSupplierAction(createForm()))).toBe(
        `${PATH}?r=error`,
      );
    },
  );

  it('should log the bug with the request id instead of swallowing it', async () => {
    mocks.createSupplier.mockRejectedValue(bug());

    await redirectUrlOf(createSupplierAction(createForm()));

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('呼叫端契約違反'),
      expect.objectContaining({ request_id: 'req-1' }),
    );
  });
});

// ── log 面的收斂(註解裡標 🔴 的規則要有守門,否則只是願望)─────────
describe('supplier actions — log 不外洩、不無限長', () => {
  // 🔴 K1-n5:log **不得記 label 全文**。改成 `label: parsed.label` ⇒ 本條轉紅。
  it('should log the label length instead of the label itself', async () => {
    const secret = '老吳精品內部代號 A-77';

    await redirectUrlOf(createSupplierAction(createForm(secret)));

    // 🔴 掃**每一筆** info log(codex K2 R2 nit):只讀 calls[0] 的話,
    //    在安全的第一筆後面追加一筆含全名的 log 照樣全綠。
    const calls = (console.info as unknown as {
      mock: { calls: [string, Record<string, unknown>][] };
    }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, payload] of calls) {
      expect(JSON.stringify(payload)).not.toContain(secret);
    }
    expect(calls[0]![1].label_length).toBe([...secret].length);
  });

  // 🔴 rename 也記 label,同樣不得外洩(上一版的 oracle 只覆蓋 create)。
  it('should keep the label out of the rename log as well', async () => {
    const secret = '老吳精品內部代號 B-42';

    await redirectUrlOf(renameSupplierAction(renameForm(secret)));

    const calls = (console.info as unknown as {
      mock: { calls: [string, Record<string, unknown>][] };
    }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, payload] of calls) {
      expect(JSON.stringify(payload)).not.toContain(secret);
    }
  });

  // 🔴 DB error 的 message 直接來自 PG,長度不受本層控制 ⇒ 截斷是為了不讓一則 log 撐爆。
  it('should truncate a runaway database error message at 200 characters', async () => {
    mocks.createSupplier.mockRejectedValue({ code: '42501', message: 'x'.repeat(5000) });

    await redirectUrlOf(createSupplierAction(createForm()));

    const [, payload] = (console.error as unknown as {
      mock: { calls: [string, { message: string }][] };
    }).mock.calls[0]!;
    expect(payload.message).toHaveLength(200);
  });
});
