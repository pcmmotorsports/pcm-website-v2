import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  correct: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    // 真的 `redirect()` 是靠 throw 實作的 —— mock 也要 throw，否則測試會多跑後面的碼。
    const e = new Error(`NEXT_REDIRECT:${url}`);
    (e as { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw e;
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorize }));
vi.mock('./refund-correction-repository', async () => {
  const actual =
    await vi.importActual<typeof import('./refund-correction-repository')>(
      './refund-correction-repository',
    );
  return { ...actual, correctRefundVerdict: mocks.correct };
});

import { correctVerdictAction } from './refund-correction-actions';
import {
  CORRECTION_P2B44_MARKERS,
  CorrectionCallerBugError,
  CorrectionRejectedError,
} from './refund-correction-repository';
import {
  CORRECTION_EXPECTED_ID_FIELD,
  CORRECTION_REASON_FIELD,
  CORRECTION_REFUND_ID_FIELD,
  CORRECTION_REQUEST_TOKEN_FIELD,
  CORRECTION_RESULT_CODES,
  CORRECTION_VERDICT_FIELD,
} from './refund-correction-state';

// refund-correction-actions.test.ts — `#890` 片2c。
// 🔴 誠實邊界:repository 與授權層都是 mock ⇒ 本檔證的是**這一層的分派與短路**,
//    不證 RPC 行為、不證 session 驗證。

const REFUND = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ACTOR = 'staff_01';

function fd(over: Record<string, string | undefined> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string | undefined> = {
    [CORRECTION_REFUND_ID_FIELD]: REFUND,
    [CORRECTION_VERDICT_FIELD]: 'no_money_moved',
    [CORRECTION_REASON_FIELD]: '對過 TapPay，錢其實沒有動',
    [CORRECTION_REQUEST_TOKEN_FIELD]: 'tok-0001',
    ...over,
  };
  for (const [k, v] of Object.entries(base)) if (v !== undefined) f.append(k, v);
  return f;
}

/** 🔴 地雷表單:**碰它就爆**。用來釘住「denied 時零讀表單」。 */
const LANDMINE = {
  getAll() {
    throw new Error('denied 之後不該讀任何欄位');
  },
  append() {},
} as unknown as FormData;

beforeEach(() => {
  mocks.authorize.mockReset();
  mocks.correct.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.redirect.mockClear();
  mocks.authorize.mockResolvedValue({ sid: 'sid-1', actorId: ACTOR });
});

describe('🔴 授權閘絕對第一', () => {
  it('🔴🔴 denied ⇒ **零讀表單、零呼 RPC**(地雷表單釘住短路)', async () => {
    mocks.authorize.mockResolvedValue(null);
    const state = await correctVerdictAction({ ok: true }, LANDMINE);
    expect(state).toEqual({ ok: false, code: 'correction_denied' });
    expect(mocks.correct).not.toHaveBeenCalled();
  });

  it('🔴 未授權 + 爛表單 ⇒ 拿到的是 denied,**不是 invalid**', async () => {
    // invalid 會告訴他「哪裡填錯了」= 對一個沒有權限的人描述這張表單的形狀。
    mocks.authorize.mockResolvedValue(null);
    const state = await correctVerdictAction({ ok: true }, fd({ [CORRECTION_REASON_FIELD]: '' }));
    expect(state).toEqual({ ok: false, code: 'correction_denied' });
  });

  it('🔴 對照:有授權而表單爛 ⇒ 這時才是 invalid(證明上一格不是「一律 denied」)', async () => {
    const state = await correctVerdictAction({ ok: true }, fd({ [CORRECTION_REASON_FIELD]: '   ' }));
    expect(state).toEqual({ ok: false, code: 'correction_invalid' });
    expect(mocks.correct).not.toHaveBeenCalled();
  });
});

describe('🔴 actor 只能來自授權層', () => {
  it('表單塞一個別人的 actor ⇒ 送出去的仍是授權層那一個', async () => {
    mocks.correct.mockResolvedValue({ result: 'CORRECTED', refundId: REFUND, correctionId: 'c', seq: 1, correctedTo: 'no_money_moved' });
    const f = fd();
    f.append('correction_actor', 'someone_else');
    f.append('actor', 'someone_else');
    await correctVerdictAction({ ok: true }, f).catch(() => undefined);
    expect(mocks.correct).toHaveBeenCalledWith(expect.objectContaining({ actor: ACTOR }));
  });

  it('⚠️ 那個 actorId 必須通得過 DB 的值域 ^[a-z0-9_]{1,64}$ —— **而這一格只驗 fixture**', async () => {
    // 🔴 誠實邊界(codex R1 must-fix 4 點名):這一格與下一格**只測常數**,
    //    它們證的是「我這份 fixture 選的 actor 是合法的」,
    //    **證不到「授權層真的會吐一個合法的 actorId」** —— 那要真的 session，今天沒有人跑過。
    //    ⇒ 保留它是因為它擋得住「有人把 fixture 改成一個不合法的值而測試照樣綠」。
    expect(ACTOR).toMatch(/^[a-z0-9_]{1,64}$/);
  });

  it('🔴 負對照:一個不合法的 actor 必須比不到那個值域(證明上一格的尺會動)', () => {
    expect('Staff-01@pcm').not.toMatch(/^[a-z0-9_]{1,64}$/);
  });
});

describe('🔴 23505 換一把 token 重試【一次】', () => {
  it('第一次撞 ⇒ 換新 token 重送 ⇒ 成功', async () => {
    mocks.correct
      .mockResolvedValueOnce({ result: 'REQUEST_ID_COLLISION' })
      .mockResolvedValueOnce({ result: 'CORRECTED', refundId: REFUND, correctionId: 'c', seq: 1, correctedTo: 'no_money_moved' });
    await correctVerdictAction({ ok: true }, fd()).catch(() => undefined);
    expect(mocks.correct).toHaveBeenCalledTimes(2);
    const first = mocks.correct.mock.calls[0]?.[0] as { requestId: string };
    const second = mocks.correct.mock.calls[1]?.[0] as { requestId: string };
    // 🔴 重試要換一把**新的** —— 用同一把重送等於再撞一次。
    expect(second.requestId).not.toBe(first.requestId);
    expect(first.requestId).toBe('tok-0001');
  });

  it('🔴 第二次還撞 ⇒ **不再重試**,回 bug(那不是碰撞,是別的東西)', async () => {
    mocks.correct.mockResolvedValue({ result: 'REQUEST_ID_COLLISION' });
    const state = await correctVerdictAction({ ok: true }, fd());
    expect(state).toEqual({ ok: false, code: 'correction_bug' });
    expect(mocks.correct).toHaveBeenCalledTimes(2);
  });
});

describe('🔴 結果碼分派 —— stale 與 bug 必須讓員工做【相反】的事', () => {
  it.each([
    ['P2B42', 'correction_invalid'],
    ['23514', 'correction_invalid'],
    ['P8C03', 'correction_not_applicable'],
    ['P2B43', 'correction_bug'],
    ['P8C01', 'correction_bug'],
  ] as const)('SQLSTATE %s ⇒ %s', async (sqlstate, expected) => {
    mocks.correct.mockRejectedValue(new CorrectionRejectedError(sqlstate, 'x'));
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({ ok: false, code: expected });
  });

  // 🔴🔴 P2B44 底下【三個 CONSTRAINT 要員工做三件不同的事】(codex 2026-08-29 must-fix 3)。
  //    ⛔ ~~原本一格 `['P2B44','correction_stale']`~~ 作廢 —— 那一格**分不出這三種**,
  //      而它會通過任何一種合併寫法。
  it('P2B44 + cas_mismatch 的訊息 ⇒ stale(重看一次現況)', async () => {
    mocks.correct.mockRejectedValue(
      new CorrectionRejectedError('P2B44', `x ${CORRECTION_P2B44_MARKERS.casMismatch} y`),
    );
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({
      ok: false,
      code: 'correction_stale',
    });
  });

  it('🔴 P2B44 + target_not_manual_failed 的訊息 ⇒ **not_applicable**,不是 stale', async () => {
    // 叫他「重看一次現況」是錯的建議：那一列根本不是人工判定失敗的列，重看一百次也一樣。
    mocks.correct.mockRejectedValue(
      new CorrectionRejectedError('P2B44', `x ${CORRECTION_P2B44_MARKERS.targetNotManualFailed} y`),
    );
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({
      ok: false,
      code: 'correction_not_applicable',
    });
  });

  it('🔴 認不出訊息時落回 stale ⇒ fail-safe(那是三者裡最無害的一句)', async () => {
    // 字面尺會因為 RPC 改字而斷 ⇒ 這一格釘住它斷掉的**方向**。
    mocks.correct.mockRejectedValue(new CorrectionRejectedError('P2B44', '一句沒見過的話'));
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({
      ok: false,
      code: 'correction_stale',
    });
  });

  it('協定漂移 ⇒ correction_bug(不得叫員工重試)', async () => {
    mocks.correct.mockRejectedValue(new CorrectionCallerBugError('drift'));
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({
      ok: false,
      code: 'correction_bug',
    });
  });

  it('🔴 而 P2B44(stale)與 P2B43(bug)【不得】映到同一個碼', async () => {
    // ⛔ ~~原本只斷言 `a not.toEqual b`~~ **不夠(codex R1 must-fix 4)**:
    //    那個寫法在【兩者互換】時照樣會過 ⇒ 逐邊釘死它各自是哪一個。
    mocks.correct.mockRejectedValueOnce(
      new CorrectionRejectedError('P2B44', CORRECTION_P2B44_MARKERS.casMismatch),
    );
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({
      ok: false,
      code: 'correction_stale',
    });
    mocks.correct.mockRejectedValueOnce(new CorrectionRejectedError('P2B43', 'x'));
    expect(await correctVerdictAction({ ok: true }, fd())).toEqual({
      ok: false,
      code: 'correction_bug',
    });
  });
});

describe('成功路徑', () => {
  it('CORRECTED ⇒ revalidate + PRG 帶 correction_done', async () => {
    mocks.correct.mockResolvedValue({ result: 'CORRECTED', refundId: REFUND, correctionId: 'c', seq: 1, correctedTo: 'no_money_moved' });
    await correctVerdictAction({ ok: true }, fd()).catch(() => undefined);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/orders/refund-exceptions');
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/refund-exceptions?r=correction_done');
  });

  it('🔴 DUPLICATE_REQUEST ⇒ 帶【不同】的碼(員工按了兩次,而系統只做了一次)', async () => {
    mocks.correct.mockResolvedValue({ result: 'DUPLICATE_REQUEST', refundId: REFUND, correctionId: 'c' });
    await correctVerdictAction({ ok: true }, fd()).catch(() => undefined);
    expect(mocks.redirect).toHaveBeenCalledWith('/orders/refund-exceptions?r=correction_duplicate');
  });

  it('CAS 那一欄不在席 ⇒ 送 null 給 RPC', async () => {
    mocks.correct.mockResolvedValue({ result: 'CORRECTED', refundId: REFUND, correctionId: 'c', seq: 1, correctedTo: 'no_money_moved' });
    await correctVerdictAction({ ok: true }, fd({ [CORRECTION_EXPECTED_ID_FIELD]: undefined })).catch(
      () => undefined,
    );
    expect(mocks.correct).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCorrectionId: null }),
    );
  });
});

describe('🔴 跨側:每一個結果碼都要有文案', () => {
  it('七個碼在 ResultBanner 的 MESSAGES 裡一個都不缺', async () => {
    // 🔴 banner 對**未知碼是靜靜地不顯示** ⇒ 少登錄一個 ⇒ 員工按完什麼都沒發生，
    //    而畫面看起來很正常。這一格是那個沉默的唯一訊號。
    const { MESSAGES } = await import('../../components/orders/result-banner');
    // 🔴 正對照(codex R2):清單若變空,上面那個迴圈**一格都不跑而照樣綠**。
    expect(CORRECTION_RESULT_CODES.length).toBe(7);
    for (const code of CORRECTION_RESULT_CODES) {
      expect(Object.hasOwn(MESSAGES, code), `${code} 沒有文案`).toBe(true);
    }
  });

  it('🔴 負對照:一個編出來的碼**不在** MESSAGES 裡(證明上一格不是「什麼都算有」)', async () => {
    const { MESSAGES } = await import('../../components/orders/result-banner');
    expect(Object.hasOwn(MESSAGES, 'correction_zzq6641')).toBe(false);
    // 🔴 而正對照配著跑：那張表**不是空的**（否則上面那個迴圈在表被清空時也會綠）。
    expect(Object.keys(MESSAGES).length).toBeGreaterThan(20);
  });

  it('🔴 stale 與 bug 的文案要員工做【相反】的事 —— 逐邊釘,不只是「不相等」', async () => {
    // ⛔ ~~原本只斷言兩句不相等 + bug 那則不含「再試」~~ **不夠(codex R1 must-fix 4)**:
    //    「不相等」在兩句**互換**時照樣會過;而禁字只有「再試」會漏掉「重試 / 重送 / 再按」。
    const { MESSAGES } = await import('../../components/orders/result-banner');
    const stale = MESSAGES['correction_stale']?.text ?? '';
    const bug = MESSAGES['correction_bug']?.text ?? '';
    // stale：他有下一步，而那一步是「去看現況」。
    expect(stale).toMatch(/重新整理|現況|再決定|現在的判定/);
    // 🔴 bug：他沒有下一步。
    //    ⛔ ~~原本寫「禁止出現『重試』這個詞」~~ **那一版當場紅了,而它是【我的尺錯】不是文案錯**:
    //      現行文案是「請**不要重試**」—— 一個禁字尺分不出【叫他重試】與【叫他不要重試】,
    //      而那兩句的意思相反。
    //    ⇒ 改成釘【指令的方向】:必須出現否定的那一句,且不得出現肯定的那幾種。
    expect(bug).toContain('不要重試');
    for (const forbidden of ['請稍後', '再試一次', '請重試', '再按一次', '重送', '重新送出']) {
      expect(bug, `bug 文案不得出現「${forbidden}」`).not.toContain(forbidden);
    }
    expect(bug).toMatch(/工程師|維護/);
    // 🔴 而「互換」這件事本身也釘一格：stale 那句不得出現 bug 那句的指向。
    expect(stale).not.toMatch(/工程師|維護/);
  });
});
