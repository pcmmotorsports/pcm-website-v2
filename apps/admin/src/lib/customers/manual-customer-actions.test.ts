import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  createManualCustomer: vi.fn(),
  findCandidates: vi.fn(),
  auditRecord: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
// ⟦b4-ENUM3⟧ 片 1:搜尋事件改寫進 admin_audit_log ⇒ 這一支要換掉, 否則測試會真的去打 DB。
vi.mock('../orders/order-repository', () => ({
  getAdminAuditLogRepository: () => ({ record: mocks.auditRecord }),
}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
// 🔴 只換掉兩支會打 DB 的,`normalizeManualPhone` 走真實作 ——
//    「回傳的電話有沒有正規化」是本檔要量的性質之一,mock 掉它那格會變成自問自答。
vi.mock('./manual-customer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-customer')>();
  return {
    ...actual,
    createManualCustomer: mocks.createManualCustomer,
    findCustomerCandidatesByPhone: mocks.findCandidates,
  };
});

import { MANUAL_CUSTOMER_SEARCH_ACTION } from './manual-customer';
import {
  createManualCustomerInlineAction,
  searchManualCustomersAction,
} from './manual-customer-actions';

const REQ = '11111111-1111-4111-8111-111111111111';
const NEW_USER = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.authorizeAdminMutation.mockResolvedValue({ actorId: 'staff-1', sid: 's' });
  // 🔴 建客人現在會**先查一次**(R5-F1 的預檢)⇒ 預設查無,各格要測預檢時自己覆寫。
  mocks.findCandidates.mockResolvedValue({
    candidates: [],
    truncated: false,
    samePhoneCount: 0,
    shouldWarnDuplicates: false,
  });
  mocks.auditRecord.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ── 🔴 呼叫端守門(形狀沿用同族):一支「寫好了但沒有人呼叫」的 action 在三綠下全綠 ──────
describe('🔴 這兩支 action 必須有呼叫端', () => {
  const PICKER = join(__dirname, '../../components/orders/manual-customer-picker.tsx');
  const BODY = join(__dirname, '../../components/orders/manual-order-form-body.tsx');
  const strip = (t: string) =>
    t
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
  const picker = strip(readFileSync(PICKER, 'utf8'));
  const body = strip(readFileSync(BODY, 'utf8'));

  it('picker 兩支都呼叫得到', () => {
    expect(picker).toContain('searchManualCustomersAction(');
    expect(picker).toContain('createManualCustomerInlineAction(');
  });

  it('🔴 而表單本體真的 render 了 picker(不然 picker 是死碼, 上面那格會恆綠)', () => {
    expect(body).toMatch(/<ManualCustomerPicker/);
  });

  it('🔴🔴 兩顆按鈕必須是 `type=\'button\'` —— 那是「沒有 form reset」的結構前提', () => {
    // 🔴 `cancel-actions.ts:30` 記的病是 **`<form action=>` 回傳值** ⇒ React 會 reset 那張表單
    //    ⇒ 非受控控制項的值回到 defaultValue。本片靠的是「這兩顆不是 submit」。
    //    ⇒ 有人把 type 拿掉(HTML 預設就是 submit)⇒ 按「找客人」會送出整張建單表單。
    expect(picker).not.toMatch(/<button(?![^>]*type='button')/);
    // 負對照:它真的有 button(不是因為一顆都沒有才過)
    expect(picker.match(/<button/g)?.length).toBe(2);
  });

  it('🔴 負對照:同一把尺去找一個不存在的 action ⇒ 不命中', () => {
    expect(picker).not.toContain('createNoSuchAction(');
  });
});

describe('searchManualCustomersAction', () => {
  it('🔴 未授權 ⇒ denied, 而且【一發 DB 都沒打】', () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    return searchManualCustomersAction('0912345678').then((res) => {
      expect(res).toEqual({ ok: false, reason: 'denied' });
      expect(mocks.findCandidates).not.toHaveBeenCalled();
    });
  });

  it('🔴 太短 ⇒ 不打 DB(子字串比對會撈回一大堆不相干的人)', async () => {
    expect(await searchManualCustomersAction('09')).toEqual({ ok: false, reason: 'too_short' });
    expect(mocks.findCandidates).not.toHaveBeenCalled();
  });

  it('🔴 負對照:夠長 ⇒ 真的打 DB(證明上面兩格不是恆真)', async () => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [],
      truncated: false,
      samePhoneCount: 0,
      shouldWarnDuplicates: false,
    });
    await searchManualCustomersAction('0912');
    expect(mocks.findCandidates).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 回給畫面的候選【不含 email】—— 畫面不顯示它, 而它是 PII', async () => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [
        { userId: NEW_USER, name: '王小明', email: 'secret@example.test', phone: '0912345678', isManual: true },
      ],
      truncated: false,
      samePhoneCount: 1,
      shouldWarnDuplicates: false,
    });
    const res = await searchManualCustomersAction('0912345678');
    expect(res.ok).toBe(true);
    const json = JSON.stringify(res);
    expect(json).not.toContain('secret@example.test');
    expect(json).not.toContain('email');
    // 負對照:該有的欄真的在(不然「不含 email」可能只是因為整包都空)
    expect(json).toContain('王小明');
  });

  it('🔴 查壞了 ⇒ error(不得與「查無」回同一個東西:兩者的下一步相反)', async () => {
    mocks.findCandidates.mockRejectedValue(new Error('boom'));
    expect(await searchManualCustomersAction('0912345678')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('createManualCustomerInlineAction', () => {
  const input = { name: '王小明', phone: '0912-345-678', requestId: REQ };

  it('🔴 未授權 ⇒ denied, 而且【一個帳號都沒建】', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const res = await createManualCustomerInlineAction(input);
    expect(res.ok).toBe(false);
    expect(mocks.createManualCustomer).not.toHaveBeenCalled();
  });

  it('冪等鍵逐字遞下去(它決定佔位信箱 = 這條路唯一的冪等機制)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    await createManualCustomerInlineAction(input);
    expect(mocks.createManualCustomer).toHaveBeenCalledWith(
      expect.anything(),
      { name: '王小明', phone: '0912-345-678', requestId: REQ },
    );
  });

  it('🔴 回給畫面的電話是【正規化後】的, 姓名是【修剪過】的 —— 顯示的要與存進去的同一份', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const res = await createManualCustomerInlineAction({ ...input, name: '  王小明  ' });
    expect(res).toMatchObject({ ok: true, candidate: { phone: '0912345678', name: '王小明' } });
  });

  it('🔴 拋掉 ⇒ 文案叫他【先不要再按】, 不得叫他再建一次', async () => {
    mocks.createManualCustomer.mockRejectedValue(new Error('boom'));
    const res = await createManualCustomerInlineAction(input);
    expect(res.ok).toBe(false);
    expect((res as { message: string }).message).toContain('先不要再按一次');
    // 🔴 這一發是判別力來源:一句「再建一次」會讓同一位客人多出一個刪不掉的帳號。
    expect((res as { message: string }).message).not.toContain('再建一次。');
  });

  it('🔴 重送(idempotent)⇒ 回同一位 + 留下一筆 log(災難當天要查得到)', async () => {
    const warn = vi.mocked(console.warn);
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: true });
    const res = await createManualCustomerInlineAction(input);
    expect(res).toMatchObject({ ok: true, idempotent: true });
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('admin.manual_customer.idempotent_hit'))).toBe(true);
    // 🔴 不記姓名與電話(PII)。
    expect(lines.some((l) => l.includes('王小明') || l.includes('0912345678'))).toBe(false);
  });

  it('🔴 負對照:全新建立【不得】印那一筆(否則那把尺恆真)', async () => {
    const warn = vi.mocked(console.warn);
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER });
    const res = await createManualCustomerInlineAction(input);
    expect(res).toMatchObject({ ok: true, idempotent: false });
    expect(
      warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('idempotent_hit')),
    ).toBe(false);
  });

  it('姓名或電話不合 ⇒ 把那一層的訊息原樣帶回畫面(它比我們在這裡重寫一句準)', async () => {
    mocks.createManualCustomer.mockResolvedValue({
      ok: false,
      reason: 'invalid_phone',
      message: '請填寫完整的聯絡電話',
    });
    const res = await createManualCustomerInlineAction(input);
    expect(res).toMatchObject({ ok: false, reason: 'invalid_phone', message: '請填寫完整的聯絡電話' });
  });
});

// ── 🔴🔴 R5-F1:建之前先查一次 —— codex 推翻了我「擋在搜尋那道閘」的降級 ──────────────
//  反例(它構造的,我核過是對的):員工搜 `0912345677`(打錯一碼)⇒ 查無 ⇒ 建立區塊出現
//  ⇒ 而**建立區塊的電話欄是可以改的** ⇒ 他改回正確的 `0912345678` ⇒ 建立 ⇒ 第二個帳號。
//  📌 **我以為那道閘看的與這一步用的是同一個值 —— 而它們是兩個欄位。**
describe('🔴🔴 建客人之前,用【真正要建的那支電話】再查一次', () => {
  const EXISTING = '99999999-9999-4999-8999-999999999999';
  const priorHit = (over = {}) => ({
    candidates: [
      { userId: EXISTING, name: '王小明', email: 'x@y', phone: '0912345678', isManual: true, ...over },
    ],
    truncated: false,
    samePhoneCount: 1,
    shouldWarnDuplicates: false,
  });

  it('已經有同姓名同電話的【後台帳號】⇒ 回那一位,而且【完全不呼叫】建立', async () => {
    mocks.findCandidates.mockResolvedValue(priorHit());
    const res = await createManualCustomerInlineAction({
      name: ' 王小明 ',
      phone: '0912-345-678',
      requestId: REQ,
    });
    // 🔴 `outcome` 必須是 `existing` 而**不是** `idempotent` ——
    //    畫面對這兩者的處置**相反**(不選 vs 自動選)⇒ 混在一起的話,
    //    「撞到一位很像的人」會被當成「同一次操作重送」而**自動掛上去**。
    expect(res).toMatchObject({ ok: true, idempotent: true, outcome: 'existing' });
    expect(res.ok && res.candidate.userId).toBe(EXISTING);
    expect(mocks.createManualCustomer).not.toHaveBeenCalled();
  });

  it('🔴 對照組:姓名不同 ⇒ 照建(Sean 08-24「一支電話不設硬上限」不得被這道閘吃掉)', async () => {
    mocks.findCandidates.mockResolvedValue(priorHit());
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: false });
    const res = await createManualCustomerInlineAction({
      name: '王大明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res).toMatchObject({ ok: true, idempotent: false, outcome: 'created' });
    expect(mocks.createManualCustomer).toHaveBeenCalledTimes(1);
  });

  it('🔴 對照組:那位是【客人自己在前台註冊的】(isManual=false)⇒ 不得重用,照建', async () => {
    mocks.findCandidates.mockResolvedValue(priorHit({ isManual: false }));
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: false });
    const res = await createManualCustomerInlineAction({
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res.ok && res.candidate.userId).toBe(NEW_USER);
    expect(mocks.createManualCustomer).toHaveBeenCalledTimes(1);
  });

  it('🔴 對照組:電話不同 ⇒ 照建', async () => {
    mocks.findCandidates.mockResolvedValue(priorHit({ phone: '0900000000' }));
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: false });
    await createManualCustomerInlineAction({ name: '王小明', phone: '0912345678', requestId: REQ });
    expect(mocks.createManualCustomer).toHaveBeenCalledTimes(1);
  });

  it('🔴 查不動 ⇒ 【不建】,並且說「還不能」—— 硬建出去的那一個正是這道閘要擋的', async () => {
    mocks.findCandidates.mockRejectedValue(new Error('db down'));
    const res = await createManualCustomerInlineAction({
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain('還不能');
    expect(mocks.createManualCustomer).not.toHaveBeenCalled();
  });
});

// ── 🔴🔴 R6 折回來的兩族(預檢自己的兩個洞)────────────────────────────────────────
describe('🔴🔴 R6:預檢查無 + 【被截斷】⇒ 不得建', () => {
  // 🔴 那支 RPC 最多回 20 筆而且是**子字串**比對 ⇒ 構造 20 位較新的、電話包含這一串的人,
  //    就能把**那位精確吻合的舊帳號擠出清單** ⇒ 預檢查無 ⇒ 照建 ⇒ 重複帳號。
  //    📌 **「我沒看到他」在【他不存在】與【他被擠掉了】兩個世界印同一句話,
  //       而 `truncated` 是唯一分得開的那一格。**
  it('查無而 truncated=true ⇒ 回錯、且完全不呼叫建立', async () => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [],
      truncated: true,
      samePhoneCount: 0,
      shouldWarnDuplicates: true,
    });
    const res = await createManualCustomerInlineAction({
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain('還不能');
    expect(mocks.createManualCustomer).not.toHaveBeenCalled();
  });

  it('🔴 對照組:查無而 truncated=false ⇒ 照建(不然這道閘把功能整個關掉)', async () => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [],
      truncated: false,
      samePhoneCount: 0,
      shouldWarnDuplicates: false,
    });
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: false });
    const res = await createManualCustomerInlineAction({
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res.ok).toBe(true);
    expect(mocks.createManualCustomer).toHaveBeenCalledTimes(1);
  });

  it('🔴 對照組:truncated=true 但【有】精確命中 ⇒ 回那一位(截斷不得蓋過真的找到)', async () => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [
        { userId: NEW_USER, name: '王小明', email: 'a@b', phone: '0912345678', isManual: true },
      ],
      truncated: true,
      samePhoneCount: 1,
      shouldWarnDuplicates: true,
    });
    const res = await createManualCustomerInlineAction({
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res).toMatchObject({ ok: true, idempotent: true, outcome: 'existing' });
    expect(mocks.createManualCustomer).not.toHaveBeenCalled();
  });
});

describe('🔴 R7:真正的冪等重送(同一顆鍵)⇒ outcome 必須是 `idempotent`, 不是 `existing`', () => {
  // 🔴 兩者都回 `idempotent: true`,而**畫面的處置相反** ⇒ 只看那個布林會做錯事。
  it('createManualCustomer 自己回 idempotent ⇒ outcome = idempotent', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: true });
    const res = await createManualCustomerInlineAction({
      name: '王小明',
      phone: '0912345678',
      requestId: REQ,
    });
    expect(res).toMatchObject({ ok: true, idempotent: true, outcome: 'idempotent' });
  });
});

describe('🔴 R6:電話太短 ⇒ 預檢【完全不打 DB】', () => {
  // 🔴 舊條件只擋空字串 ⇒ 電話打一個 `1` 也會跑一發寬廣子字串查詢 + 最多 20 發 auth 查詢,
  //    最後才被建立層判 invalid。⇒ 門檻對齊建立層:**它不合格的話, 這一趟本來就沒有意義。**
  it('電話 1 碼 ⇒ 一次都沒查, 直接由建立層判 invalid', async () => {
    mocks.createManualCustomer.mockResolvedValue({
      ok: false,
      reason: 'invalid_phone',
      message: '請填寫完整的聯絡電話',
    });
    const res = await createManualCustomerInlineAction({ name: '王小明', phone: '1', requestId: REQ });
    expect(mocks.findCandidates).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('🔴 對照組:8 碼 ⇒ 有查(不然上面那格在「預檢整個沒接線」的世界也全綠)', async () => {
    mocks.createManualCustomer.mockResolvedValue({ ok: true, userId: NEW_USER, idempotent: false });
    await createManualCustomerInlineAction({ name: '王小明', phone: '12345678', requestId: REQ });
    expect(mocks.findCandidates).toHaveBeenCalledTimes(1);
  });
});

// ── ⟦b4-ENUM3⟧ 片 1:搜尋事件要進【查得到的表】, 不是一行沒人看的 log ────────────
//
// 🔴 **這一片修的不是枚舉, 是【偵測那一半的載體】。**
//    板上逐字寫「每一次查得動的搜尋【留一筆】」—— 而它原本是 `console.warn`:
//    不在 admin_audit_log、告警器(1,103 行)與 10 支 cron **一支都沒讀它**。
//    ⇒ 那與「沒有偵測」對【事後查得到嗎】印同一個答案。
// 🛑 **而限速那一半仍然是 0**(片 2)⇒ 本組測試證不到「擋得住枚舉」, 一格都證不到。
// ⚠️ **第二個天花板(codex R1 nit, 2026-09-01)**:本組把 `authorizeAdminMutation()` mock 成 `staff-1`
//    ⇒ 它只證得到 **actor 被原樣轉送**, **證不到 actor 是真的**。
//    旗標關著 + 舊票時 actor 仍可能來自那顆自選 cookie;session 被竊時也會記成別人。
//    ⇒ 那一格由 `session/` 那一族負責, 不是這裡。
describe('⟦b4-ENUM3⟧ 搜尋要留下一列查得到的稽核', () => {
  beforeEach(() => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [{ userId: NEW_USER, name: '王小明', phone: '0912345678', isManual: true }],
      truncated: false,
      samePhoneCount: 1,
      shouldWarnDuplicates: false,
    });
  });

  it('查得動 ⇒ 寫一列 admin_audit_log, 而 actor 來自那道授權閘', async () => {
    const res = await searchManualCustomersAction('0912345678');
    expect(res.ok).toBe(true);
    expect(mocks.auditRecord).toHaveBeenCalledTimes(1);
    const [entry, context] = mocks.auditRecord.mock.calls[0] as [
      { action: string; after: unknown },
      { actor: string; sourceApp: string },
    ];
    // 🔴 用【匯出的常數】比, 不是自己打一次字串 —— 那正是這個常數存在的理由。
    expect(entry.action).toBe(MANUAL_CUSTOMER_SEARCH_ACTION);
    expect(context.actor).toBe('staff-1');
    expect(context.sourceApp).toBe('admin');
    expect(entry.after).toEqual({ queryDigits: 10, hits: 1, truncated: false });
  });

  it('🔴 PII:那一列【不得】含他打的號碼或撈回來的姓名', async () => {
    await searchManualCustomersAction('0912345678');
    const payload = JSON.stringify(mocks.auditRecord.mock.calls[0]);
    // 🟢 先證明這把尺撈得到東西（否則下面兩發是恆真的）
    expect(payload).toContain(MANUAL_CUSTOMER_SEARCH_ACTION);
    expect(payload).not.toContain('0912345678');
    expect(payload).not.toContain('王小明');
  });

  it('🔴 負對照:太短(不打 DB)⇒【不得】寫稽核, 否則那把尺恆真', async () => {
    const res = await searchManualCustomersAction('09');
    expect(res).toMatchObject({ ok: false, reason: 'too_short' });
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });

  it('🛑 稽核寫失敗 ⇒【不擋搜尋】, 而訊號降級成一行 log 而不是消失', async () => {
    mocks.auditRecord.mockRejectedValue(new Error('audit table down'));
    const warn = vi.mocked(console.warn);
    const res = await searchManualCustomersAction('0912345678');
    // ① 搜尋照樣成功 —— 為了留紀錄而讓員工查不到客人, 代價不對等
    expect(res.ok).toBe(true);
    expect((res as { candidates: unknown[] }).candidates).toHaveLength(1);
    // ② 而訊號沒有消失:降級成 runtime log
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes(MANUAL_CUSTOMER_SEARCH_ACTION))).toBe(true);
    expect(lines.some((l) => l.includes('audit_write_failed'))).toBe(true);
    // ③ 🔴 而降級那一行也不得含 PII
    expect(lines.some((l) => l.includes('0912345678') || l.includes('王小明'))).toBe(false);
  });

  it('🛑🛑 稽核【卡住】⇒ 有逾時上界, 不會把搜尋一起拖住(codex R1 must-fix)', async () => {
    // 🔴 codex 的原話:「`catch` 只處理【快速拒絕】, 沒有逾時上界;
    //    INSERT 卡住時搜尋會一起卡住直到平台逾時。」
    //    ⇒ 而我先前那句「片 1 不擋任何人、零誤擋風險」因此是假的。
    // ⇒ 這一格演的是【慢寫】—— 前兩格演的是立即成功 / 立即失敗, 它們演不到這個世界。
    vi.useFakeTimers();
    try {
      // 永遠不 resolve 的寫入 = 卡住
      mocks.auditRecord.mockImplementation(() => new Promise(() => {}));
      const warn = vi.mocked(console.warn);
      const pending = searchManualCustomersAction('0912345678');
      await vi.advanceTimersByTimeAsync(2_000);
      const res = await pending;
      // ① 搜尋照樣回來了 —— 沒有被那筆寫入拖住
      expect(res.ok).toBe(true);
      // ② 而它降級成一行 log（訊號不消失）
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('audit_write_failed'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴 負對照:寫得進去的時候【不得】印那行降級 log(否則上面那格恆真)', async () => {
    const warn = vi.mocked(console.warn);
    await searchManualCustomersAction('0912345678');
    expect(
      warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('audit_write_failed')),
    ).toBe(false);
  });
});
