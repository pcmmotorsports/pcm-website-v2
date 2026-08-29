import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import {
  CORRECTION_P2B44_MARKERS,
  CORRECTION_REQUEST_ID_UNIQUE,
  CORRECTION_RPC_RAISE_CODES,
  CorrectionCallerBugError,
  CorrectionRejectedError,
  correctRefundVerdict,
} from './refund-correction-repository';

// refund-correction-repository.test.ts — `#890` 片2a。
//
// 🔴 誠實邊界:mock 只證「本層怎麼判回來的東西」,**不證 RPC 真的會那樣回**。
//    而下面那一族「跨側」測試是例外 —— 它讀的是 migration 檔的**字面**,
//    ⇒ 它證得了「我的碼表與 RPC 裡真的 RAISE 出來的那些**對得上**」,
//    ⚠️ 而它仍然證不到 runtime:PostgREST 有沒有把那個 SQLSTATE 原樣送到 `error.code`,
//       **今天沒有人跑過**。這一格是本檔最大的未量處。

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20260814190000_m4b_e10_473b1_refund_manual_corrections.sql',
);

const REFUND = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function input(over: Record<string, unknown> = {}) {
  return {
    refundId: REFUND,
    expectedCorrectionId: null,
    actor: 'staff_01',
    reason: '對過 TapPay，錢其實沒有動',
    correctedTo: 'no_money_moved' as const,
    requestId: 'req-0001',
    ...over,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('🔴 跨側:我的碼表 vs migration 裡【真的 RAISE 出來】的那些', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  /** 只取那支函式體裡帶 CONSTRAINT 的 RAISE(那是它的錯誤面契約)。 */
  const raised = new Set(
    [...sql.matchAll(/USING ERRCODE = '([A-Z0-9]+)', CONSTRAINT = '([a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((code): code is string => typeof code === 'string'),
  );

  it('🔴 正對照:那支 migration 裡真的有帶 CONSTRAINT 的 RAISE(尺是活的)', () => {
    // 缺這一格 ⇒ regex 打錯字時 raised 是空集合，而下面兩格會【全過】。
    expect(raised.size).toBeGreaterThan(0);
    expect(sql).toContain('pcm_rmc_cas_mismatch');
  });

  it('🔴 我認得的碼【一個都不多】—— 多的那個代表我在防一個不存在的東西', () => {
    for (const code of CORRECTION_RPC_RAISE_CODES) {
      expect(raised.has(code), `碼表有 ${code}，而 migration 裡沒有它`).toBe(true);
    }
  });

  it('🔴🔴 我認得的碼【一個都不少】—— 少的那個會落進「不認得」分支被原樣拋', () => {
    for (const code of raised) {
      expect(
        (CORRECTION_RPC_RAISE_CODES as readonly string[]).includes(code),
        `migration 會 RAISE ${code}，而我的碼表沒有它`,
      ).toBe(true);
    }
  });

  it('🔴 負對照:一個編出來的碼不在那份集合裡(證明上面兩格不是「什麼都算有」)', () => {
    // ⚠️ **這一格只驗那份【掃描集合】,不驗實作**(codex R2:它仍是恆真測試)——
    //    它答的是「regex 不會什麼都撈」,答不了「實作會怎麼處理一個沒見過的碼」。
    //    ⇒ 那半在下面「不認得的 DB 錯誤 ⇒ 原樣拋」那一族,用**物件 identity** 驗。
    expect(raised.has('P9Z99')).toBe(false);
  });

  it('🔴 request_id 那個名字要出現在【DDL 的 CONSTRAINT 宣告】,不是任何一處字面', () => {
    // ⛔ ~~原本寫 `expect(sql).toContain(NAME)`~~ **作廢(codex 2026-08-29 must-fix 3)**:
    //    那個字面在該檔出現**兩處** —— `:93` 的真 DDL 與 `:312` 的一段註解。
    //    ⇒ 有人把 constraint 改名而註解沒跟著改 ⇒ **舊寫法照樣綠**,
    //      而我們的 23505 是**靠名字比對**認出來的 ⇒ 那一刻它會安靜地認不出來。
    expect(sql).toMatch(
      new RegExp(`CONSTRAINT\\s+${CORRECTION_REQUEST_ID_UNIQUE}\\s+UNIQUE\\s*\\(request_id\\)`),
    );
  });

  it('🔴 而上一格的負對照:把名字改一個字 ⇒ 那個 DDL 樣式必須【比不到】', () => {
    expect(sql).not.toMatch(
      new RegExp(`CONSTRAINT\\s+${CORRECTION_REQUEST_ID_UNIQUE}_zzq\\s+UNIQUE`),
    );
    // 而「單純 toContain 會被註解餵綠」這件事本身也釘一格:那個字面確實出現不只一次。
    expect(sql.split(CORRECTION_REQUEST_ID_UNIQUE).length - 1).toBeGreaterThan(1);
  });

  it('🔴 P2B44 的三句話,逐句都要在 migration 裡找得到(它們是我分辨三種的唯一依據)', () => {
    // 🔴 `error.code` 只有 SQLSTATE、沒有 CONSTRAINT 名 ⇒ 只能靠訊息裡的字面分辨。
    //    ⇒ 那是字面尺，它會因為 RPC 改字而斷 ⇒ 這一格是它斷掉時唯一會叫的東西。
    for (const [key, phrase] of Object.entries(CORRECTION_P2B44_MARKERS)) {
      expect(sql, `${key} 的那句話不在 migration 裡了`).toContain(phrase);
    }
  });

  it('🔴 負對照:一句編出來的話比不到(證明上一格不是「什麼都算有」)', () => {
    expect(sql).not.toContain('本支只更正人工判定zzq6641');
  });
});

describe('成功的兩條路(而它們的欄位不一樣)', () => {
  it('CORRECTED ⇒ 五欄逐格對上', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        result: 'CORRECTED',
        refund_id: REFUND,
        correction_id: 'c-1',
        seq: 3,
        corrected_to: 'no_money_moved',
      },
      error: null,
    });
    await expect(correctRefundVerdict(input())).resolves.toEqual({
      result: 'CORRECTED',
      refundId: REFUND,
      correctionId: 'c-1',
      seq: 3,
      correctedTo: 'no_money_moved',
    });
  });

  it('🔴 DUPLICATE_REQUEST **沒有** seq/corrected_to ⇒ 不得照 CORRECTED 的形狀驗', async () => {
    // RPC :299-300 逐字只回三欄。照 CORRECTED 驗 ⇒ 這一條合法的回應會被判成協定漂移。
    mocks.rpc.mockResolvedValue({
      data: { result: 'DUPLICATE_REQUEST', refund_id: REFUND, correction_id: 'c-9' },
      error: null,
    });
    await expect(correctRefundVerdict(input())).resolves.toEqual({
      result: 'DUPLICATE_REQUEST',
      refundId: REFUND,
      correctionId: 'c-9',
    });
  });

  it('送出去的參數逐格對上(CAS 傳 null = 「我看到的是尚未更正」)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'CORRECTED', refund_id: REFUND, correction_id: 'c', seq: 1, corrected_to: 'money_moved' },
      error: null,
    });
    await correctRefundVerdict(input({ correctedTo: 'money_moved' as const }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_correct_order_refund_verdict', {
      p_refund_id: REFUND,
      p_expected_correction_id: null,
      p_actor: 'staff_01',
      p_reason: '對過 TapPay，錢其實沒有動',
      p_corrected_to: 'money_moved',
      p_request_id: 'req-0001',
    });
  });
});

describe('🔴 三族錯誤必須分得開', () => {
  it.each([...CORRECTION_RPC_RAISE_CODES])('SQLSTATE %s ⇒ CorrectionRejectedError(業務結果)', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'nope' } });
    await expect(correctRefundVerdict(input())).rejects.toBeInstanceOf(CorrectionRejectedError);
  });

  it('🔴 而 sqlstate 要留給呼叫端分文案(CAS 失敗 ≠ 稍後再試)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2B44', message: 'cas' } });
    await expect(correctRefundVerdict(input())).rejects.toMatchObject({ sqlstate: 'P2B44' });
  });

  it('🔴 23505 + 那個索引名 ⇒ REQUEST_ID_COLLISION(換一把 token 重試,不是錯誤)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: `duplicate key value violates unique constraint "${CORRECTION_REQUEST_ID_UNIQUE}"`,
      },
    });
    await expect(correctRefundVerdict(input())).resolves.toEqual({ result: 'REQUEST_ID_COLLISION' });
  });

  it('🔴 P2B44 + 「冪等鍵全域唯一」⇒ 也是 collision(那是同一件事的前置檢查版)', async () => {
    // codex 2026-08-29 must-fix 3:把它當業務錯 ⇒ 員工會看到一句他無法處理的話。
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P2B44', message: `x ${CORRECTION_P2B44_MARKERS.requestIdReused} y` },
    });
    await expect(correctRefundVerdict(input())).resolves.toEqual({ result: 'REQUEST_ID_COLLISION' });
  });

  it('🔴🔴 訊息很長(request_id 佔滿 64 字)時仍要命中 —— **截斷不得吃掉比對**', async () => {
    // codex R3 抓到:給人看的訊息截 200 字，而這句 marker 在訊息**後段** ——
    // 拿截斷後的字串去 includes() ⇒ 比不到 ⇒ 那一發會落回「業務錯」，
    // 而員工會看到一句他無法處理的話，**而系統本來只要換一把 token 重送就好**。
    const longToken = 'x'.repeat(64);
    const realShape =
      `admin_correct_order_refund_verdict:request_id [${longToken}] 已被退款 ` +
      `${'a'.repeat(36)} 用過,不能再用於退款 ${'b'.repeat(36)} ⇒ 拒絕` +
      `(${CORRECTION_P2B44_MARKERS.requestIdReused};請換一把新的)`;
    expect(realShape.length, '這一格要打的就是「超過 200 字」那個世界').toBeGreaterThan(200);
    expect(
      realShape.slice(0, 200).includes(CORRECTION_P2B44_MARKERS.requestIdReused),
      '截斷之後應該比不到 —— 這是本格存在的理由',
    ).toBe(false);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P2B44', message: realShape } });
    await expect(correctRefundVerdict(input())).resolves.toEqual({ result: 'REQUEST_ID_COLLISION' });
  });

  it('🔴 對照:P2B44 但**不是**那句話 ⇒ 仍是 CorrectionRejectedError(證明上一格不是「一律 collision」)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P2B44', message: CORRECTION_P2B44_MARKERS.casMismatch },
    });
    await expect(correctRefundVerdict(input())).rejects.toBeInstanceOf(CorrectionRejectedError);
  });

  it('🔴 對照:23505 但**不是**那個索引 ⇒ 不得吞成 collision,要原樣拋', async () => {
    // 缺這一格 ⇒ 任何一個 UNIQUE 衝突都會被靜靜地重試一次，而那可能是別的東西壞了。
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "other_key"' },
    });
    await expect(correctRefundVerdict(input())).rejects.toMatchObject({ code: '23505' });
  });

  it('🔴 不認得的 DB 錯誤 ⇒ **原樣拋**,不得包裝成業務錯', async () => {
    // 包裝它 ⇒ 一個平台故障會長得像「你填錯了」，而員工會一直改輸入。
    // ⛔ ~~原本只用 `toMatchObject({code:'57014'})`~~ **不夠(codex must-fix 3)**:
    //    一個「包裝過但把 code 帶著走」的實作照樣會過 ⇒ 要同時證明它**不是我們那兩個型別**。
    // 🔴🔴 **用物件 identity,不用 toMatchObject**(codex R2 第二輪):
    //    `not.toBeInstanceOf` 只排掉我們自己那兩個型別 ——
    //    一個「包成別的 Error 而把 code 抄過去」的實作**照樣會過**。
    //    ⇒ `toBe` 要的是【同一個物件】⇒ 只有真的原樣拋才成立。
    const raw = { code: '57014', message: 'canceled' };
    mocks.rpc.mockResolvedValue({ data: null, error: raw });
    const err = await correctRefundVerdict(input()).catch((e: unknown) => e);
    expect(err).toBe(raw);
  });

  it('🔴 而一個【從沒見過的】SQLSTATE 也要原樣拋(這才是 P9Z99 那格答不了的那一半)', async () => {
    const raw = { code: 'P9Z99', message: '一個不存在的碼' };
    mocks.rpc.mockResolvedValue({ data: null, error: raw });
    const err = await correctRefundVerdict(input()).catch((e: unknown) => e);
    expect(err).toBe(raw);
  });

  it('🔴 23514(表層 CHECK 拒絕)⇒ 業務結果,不是平台故障', async () => {
    // reason 超過 500 / request_id 超過 64 都會撞這個。原樣拋 ⇒ 員工看到「系統壞了」而一直重按。
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'new row violates check constraint' },
    });
    await expect(correctRefundVerdict(input())).rejects.toMatchObject({
      name: 'CorrectionRejectedError',
      sqlstate: '23514',
    });
  });

  it('🔴 22P02(id 型別不合)⇒ **我們的 bug**,不是業務錯 —— 那些 id 是我們產的', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    });
    const err = await correctRefundVerdict(input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CorrectionCallerBugError);
    // 🔴 而它**不得**同時算進業務錯那一族 —— 兩族的處置相反。
    expect(err).not.toBeInstanceOf(CorrectionRejectedError);
  });
});

describe('🔴 協定漂移 = 我們的 bug,不是業務錯', () => {
  it('回傳不是物件 ⇒ CorrectionCallerBugError', async () => {
    mocks.rpc.mockResolvedValue({ data: 'CORRECTED', error: null });
    await expect(correctRefundVerdict(input())).rejects.toBeInstanceOf(CorrectionCallerBugError);
  });

  it('未知的 result 碼 ⇒ CorrectionCallerBugError', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'MAYBE' }, error: null });
    await expect(correctRefundVerdict(input())).rejects.toBeInstanceOf(CorrectionCallerBugError);
  });

  it('🔴 CORRECTED 少一個 seq ⇒ CorrectionCallerBugError(放行的話畫面會顯示 undefined)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { result: 'CORRECTED', refund_id: REFUND, correction_id: 'c', corrected_to: 'money_moved' },
      error: null,
    });
    await expect(correctRefundVerdict(input())).rejects.toBeInstanceOf(CorrectionCallerBugError);
  });

  it('🔴 而 CorrectionCallerBugError 與 CorrectionRejectedError 是【兩個型別】,不得互相冒充', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'MAYBE' }, error: null });
    await expect(correctRefundVerdict(input())).rejects.not.toBeInstanceOf(CorrectionRejectedError);
  });
});
