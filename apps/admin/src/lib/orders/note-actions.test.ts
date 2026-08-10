import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  appendOrderNote: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

// 🔴 只換掉寫入函式,`OrderNoteCallerBugError` 用真的那一個(同 supplier-actions.test.ts 的理由:
//    自己造一個假 class,「bug 與 error 分得開」就變成自我實現)。
vi.mock('./note-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./note-repository')>();
  return { ...actual, appendOrderNote: mocks.appendOrderNote };
});

// 🔴 解析器**刻意不 mock** —— 餵真 FormData 走真解析器,否則「爛表單擋得住」是恆真斷言。
import { appendOrderNoteAction } from './note-actions';
import { OrderNoteCallerBugError, NOTE_RESULT_CODES } from './note-repository';
import {
  NOTE_BODY_FIELD,
  NOTE_CHANNEL_FIELD,
  NOTE_OCCURRED_AT_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  NOTE_TYPE_FIELD,
  type NoteActionState,
} from './note-action-state';

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = '99999999-8888-7777-6666-555555555555';
const DETAIL = `/orders/${ORDER_ID}`;
// 🔴 **刻意含 emoji(surrogate pair)**:關卡2 抓到原 fixture 全是 BMP 字元 ⇒
//    `[...body].length`(碼位)與 `body.length`(UTF-16)結果相同,那格是恆真的。
//    RPC 寫進稽核的是 `char_length` = 碼位語意,兩者必須對齊。
const BODY = '客人說先不要出貨,等他確認顏色 🏍️';
const IDLE: NoteActionState = { status: 'idle', requestToken: TOKEN };

function noteForm(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [NOTE_ORDER_ID_FIELD]: ORDER_ID,
    [NOTE_REQUEST_TOKEN_FIELD]: TOKEN,
    [NOTE_TYPE_FIELD]: 'internal',
    [NOTE_BODY_FIELD]: BODY,
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req_http-side-id');
  mocks.appendOrderNote.mockResolvedValue('APPENDED');
  mocks.redirect.mockImplementation(() => {
    // 真 redirect 是拋 NEXT_REDIRECT;不模擬拋出的話「redirect 被包進 try」這個突變殺不掉。
    throw new Error('NEXT_REDIRECT');
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('appendOrderNoteAction — 閘門順序', () => {
  it('未授權 → denied state、repository 零呼叫', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await appendOrderNoteAction(IDLE, noteForm());
    expect(state).toMatchObject({ status: 'failed', code: 'denied' });
    expect(mocks.appendOrderNote).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  // 🔴 只釘「回應優先序」釘不住短路(S3b-2 關卡2 R2 的教訓)⇒ 用一個 get() 會爆的 FormData:
  //    授權若沒有真的短路解析,這條會炸而不是回 denied。
  it('未授權時**根本不碰解析器**(餵 get() 會爆的 FormData 仍平安回 denied)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const landmine = {
      get() {
        throw new Error('解析器不該被碰到');
      },
    } as unknown as FormData;
    await expect(appendOrderNoteAction(IDLE, landmine)).resolves.toMatchObject({
      code: 'denied',
    });
  });

  it('解析失敗 → invalid state、repository 零呼叫', async () => {
    const state = await appendOrderNoteAction(IDLE, noteForm({ [NOTE_TYPE_FIELD]: 'urgent' }));
    expect(state).toMatchObject({ status: 'failed', code: 'invalid' });
    expect(mocks.appendOrderNote).not.toHaveBeenCalled();
  });
});

describe('appendOrderNoteAction — Sean Q1=A:失敗必須保留員工輸入', () => {
  // 🔴 `denied` 是**唯一例外**且是刻意的:授權閘排在讀任何欄位之前(見上一個 describe 的地雷測試)
  //    ⇒ 拿不到 body。理由 = session 已失效、他一定要重新登入,留著也接不回去。
  it('denied 不帶回 body(授權閘絕對第一的已知代價,不是漏做)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const state = await appendOrderNoteAction(IDLE, noteForm());
    expect(state).toMatchObject({ status: 'failed', code: 'denied', body: '' });
  });

  it('其餘失敗路都帶回 body 原文(invalid / 可改輸入 / bug / error)', async () => {
    const cases: Array<() => Promise<NoteActionState>> = [
      async () => appendOrderNoteAction(IDLE, noteForm({ [NOTE_TYPE_FIELD]: 'urgent' })),
      async () => {
        mocks.appendOrderNote.mockResolvedValue('BODY_TOO_LONG');
        return appendOrderNoteAction(IDLE, noteForm());
      },
      async () => {
        mocks.appendOrderNote.mockRejectedValue(new OrderNoteCallerBugError('boom'));
        return appendOrderNoteAction(IDLE, noteForm());
      },
      async () => {
        mocks.appendOrderNote.mockRejectedValue({ code: '08006', message: 'connection lost' });
        return appendOrderNoteAction(IDLE, noteForm());
      },
    ];
    for (const run of cases) {
      mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
      const state = await run();
      expect(state).toMatchObject({ status: 'failed', body: BODY });
    }
  });

  // 🔴🔴 關卡1 Fable R2-2:失敗也會 revalidate ⇒ 表單重渲染;若不把 token 原樣帶回,
  //    員工在 `error`(**可能已 commit**)分支重按 = 新 token = A6 認不出重送 = 第二筆永久備註。
  it('🔴 每一條失敗路都**原樣**帶回 requestToken(換新的 = 在 error 路上製造第二筆永久備註)', async () => {
    mocks.appendOrderNote.mockRejectedValue({ code: '08006', message: 'connection lost' });
    const state = await appendOrderNoteAction(IDLE, noteForm());
    expect(state).toMatchObject({ status: 'failed', code: 'error', requestToken: TOKEN });

    mocks.appendOrderNote.mockResolvedValue('OCCURRED_AT_IN_FUTURE');
    const state2 = await appendOrderNoteAction(IDLE, noteForm());
    expect(state2).toMatchObject({ requestToken: TOKEN });

    mocks.appendOrderNote.mockRejectedValue(new OrderNoteCallerBugError('boom'));
    expect(await appendOrderNoteAction(IDLE, noteForm())).toMatchObject({
      code: 'bug',
      requestToken: TOKEN,
    });

    // 🔴 `invalid` 走的是另一條取值路(解析失敗 ⇒ 拿不到 parsed,改由 carryBack 取)
    //    —— 突變測試發現這條原本零覆蓋:把 carryBack 改成「一律發新 token」時全綠。
    expect(
      await appendOrderNoteAction(IDLE, noteForm({ [NOTE_TYPE_FIELD]: 'urgent' })),
    ).toMatchObject({ code: 'invalid', requestToken: TOKEN });
  });

  it('失敗訊息有字、且 body 不進 URL(不 redirect ⇒ 沒有把 4000 字塞進網址的路)', async () => {
    mocks.appendOrderNote.mockResolvedValue('INVALID_BODY');
    const state = await appendOrderNoteAction(IDLE, noteForm());
    expect(state.status === 'failed' && state.message.length).toBeGreaterThan(0);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('appendOrderNoteAction — Sean Q2=C:冪等鍵是表單 token 不是 HTTP request id', () => {
  // 🔴🔴 關卡1 Fable F1 預言的恆真格,而我第一版真的踩中了:突變「把 requestToken 換成
  //    httpRequestId」時**全部測試照樣綠** —— 整個 Q2=C 設計沒有被任何斷言釘住。
  //    修法 = 把兩個 id 設成**不同值**,並斷言 repository 實際收到的是**表單那一把**。
  it('🔴 送進 repository 的 requestToken **字面等於表單 token**、且不等於 HTTP x-request-id', async () => {
    mocks.getRequestId.mockResolvedValue('req_completely-different-id');
    mocks.appendOrderNote.mockResolvedValue('APPENDED');
    await expect(appendOrderNoteAction(IDLE, noteForm())).rejects.toThrow('NEXT_REDIRECT');
    const args = mocks.appendOrderNote.mock.calls[0]?.[0] as { requestToken: string };
    expect(args.requestToken).toBe(TOKEN);
    expect(args.requestToken).not.toBe('req_completely-different-id');
  });
});

describe('appendOrderNoteAction — 14 碼三類映射(母 plan F3,逐碼)', () => {
  const SUCCESS = ['APPENDED', 'DUPLICATE_REQUEST'];

  it('兩個成功碼 → redirect 同一個結果頁(DUPLICATE_REQUEST 顯示成錯誤會誘發重送)', async () => {
    for (const code of SUCCESS) {
      mocks.redirect.mockClear();
      mocks.appendOrderNote.mockResolvedValue(code);
      await expect(appendOrderNoteAction(IDLE, noteForm())).rejects.toThrow('NEXT_REDIRECT');
      expect(mocks.redirect).toHaveBeenCalledWith(`${DETAIL}?r=note_added`);
    }
  });

  it('其餘 12 碼**逐碼**回 failed state,且 code 原樣落在 state 上', async () => {
    const failures = NOTE_RESULT_CODES.filter((c) => !SUCCESS.includes(c));
    expect(failures).toHaveLength(12);
    for (const code of failures) {
      mocks.appendOrderNote.mockResolvedValue(code);
      const state = await appendOrderNoteAction(IDLE, noteForm());
      expect(state).toMatchObject({ status: 'failed', code });
    }
  });

  it('未知碼由 repository 拋 CallerBug → bug state(叫員工停手)', async () => {
    mocks.appendOrderNote.mockRejectedValue(new OrderNoteCallerBugError('未預期碼'));
    const state = await appendOrderNoteAction(IDLE, noteForm());
    expect(state).toMatchObject({ status: 'failed', code: 'bug' });
  });
});

describe('appendOrderNoteAction — redirect 與 revalidate', () => {
  // 🔴 關卡1 Fable R2-3:redirect 是拋 NEXT_REDIRECT;若被包進 RPC 的 try,
  //    catch 會吞掉它、把**已成功的寫入**分類成 error ⇒ 員工看到失敗但備註已寫入。
  it('🔴 成功路徑確實把 redirect 拋出去(沒有被自己的 catch 吞掉變成 error state)', async () => {
    mocks.appendOrderNote.mockResolvedValue('APPENDED');
    await expect(appendOrderNoteAction(IDLE, noteForm())).rejects.toThrow('NEXT_REDIRECT');
  });

  it('成功與失敗**兩邊**都 revalidate 明細頁(失敗支可能已 commit ⇒ 不重取會停在舊畫面)', async () => {
    mocks.appendOrderNote.mockResolvedValue('APPENDED');
    await expect(appendOrderNoteAction(IDLE, noteForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL);

    mocks.revalidatePath.mockClear();
    mocks.appendOrderNote.mockRejectedValue({ code: '08006', message: 'lost' });
    await appendOrderNoteAction(IDLE, noteForm());
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL);
  });

  it('redirect 目標只由已驗過的 orderId 組成(非 uuid 在解析就變 state、到不了 redirect)', async () => {
    const state = await appendOrderNoteAction(
      IDLE,
      noteForm({ [NOTE_ORDER_ID_FIELD]: '../../evil' }),
    );
    expect(state).toMatchObject({ code: 'invalid' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('appendOrderNoteAction — log 面(PII)', () => {
  it('🔴 attempt log 記長度不記 body 全文,且兩個 id 都記', async () => {
    const info = vi.mocked(console.info);
    mocks.appendOrderNote.mockResolvedValue('APPENDED');
    await expect(
      appendOrderNoteAction(
        IDLE,
        noteForm({
          [NOTE_TYPE_FIELD]: 'contact_log',
          [NOTE_CHANNEL_FIELD]: 'phone',
          [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T14:30:00+08:00',
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    const payload = info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain(BODY);
    expect(payload).toMatchObject({
      // 🔴 碼位 ≠ UTF-16 長度(BODY 含 surrogate pair)⇒ 用 .length 實作會轉紅
      body_length: [...BODY].length,
      request_id: 'req_http-side-id',
      request_token: TOKEN,
    });
  });

  it('🔴 DB error log 不記 details / hint(PG 23514 的 DETAIL 會帶整列 = 備註全文進 log)', async () => {
    const errorLog = vi.mocked(console.error);
    mocks.appendOrderNote.mockRejectedValue({
      code: '23514',
      message: 'check violated',
      details: `Failing row contains (${BODY})`,
      hint: 'secret hint',
    });
    await appendOrderNoteAction(IDLE, noteForm());
    const dumped = JSON.stringify(errorLog.mock.calls);
    expect(dumped).not.toContain(BODY);
    expect(dumped).not.toContain('secret hint');
  });
});

// ── #365 片②:carryBack 與解析器的讀法一致 ────────────────────────────────────────────
describe('appendOrderNoteAction — #365 carryBack 與解析器讀同一套', () => {
  beforeEach(() => {
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  });

  // 🔴 解析器對「送兩份」回 ok:false ⇒ 這條一定走 `invalid`。真正被測的是**帶回來的那兩個值**:
  //    carryBack 若還採第一筆,失敗畫面就會把其中一份當成員工打的字、把其中一把 token 當冪等鍵
  //    繼續用(「兩邊各自正確、合起來錯」)。
  it('🔴 body 送兩份 → invalid,且不把其中一份當成員工輸入帶回', async () => {
    const d = noteForm();
    d.append(NOTE_BODY_FIELD, '第二份');
    const state = await appendOrderNoteAction(IDLE, d);
    expect(state).toMatchObject({ status: 'failed', code: 'invalid', body: '' });
    expect(state.status === 'failed' && state.body).not.toBe(BODY);
  });

  it('🔴 request_token 送兩份 → invalid,且另產一把新 token(不沿用其中一份當冪等鍵)', async () => {
    const d = noteForm();
    d.append(NOTE_REQUEST_TOKEN_FIELD, '11112222-3333-4444-5555-666677778888');
    const state = await appendOrderNoteAction(IDLE, d);
    expect(state).toMatchObject({ status: 'failed', code: 'invalid' });
    const carried = state.status === 'failed' ? state.requestToken : '';
    expect(carried).not.toBe(TOKEN);
    expect(carried).not.toBe('11112222-3333-4444-5555-666677778888');
    expect(carried.length).toBeGreaterThan(0);
  });

  // 🔴 正向對照:只送一份時 body 與 token **仍然原樣帶回** —— 沒有這格,上面兩條對
  //    「carryBack 一律回空字串 + 一律發新 token」的突變也會是綠的(那是既有行為的迴歸網)。
  it('只送一份 → body 與 token 照舊原樣帶回(證明上面兩格紅的是「兩份」)', async () => {
    const state = await appendOrderNoteAction(IDLE, noteForm({ [NOTE_TYPE_FIELD]: 'urgent' }));
    expect(state).toMatchObject({ code: 'invalid', body: BODY, requestToken: TOKEN });
  });
});
