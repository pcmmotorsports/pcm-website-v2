// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RefundExceptionRow } from '../../../lib/payment/refund-read';

// M-3 A7c RW3 清單 + RW4 操作(對帳判定/人工結案)。
// refund-read / recovery-actions transitively 拉 server-only ⇒ 整支 mock
// (refund-wiring.test.tsx 同紀律:page graph 每支 server 模組都要 mock)。

const mocks = vi.hoisted(() => ({
  listRefundExceptions: vi.fn(),
  findEffectiveVerdicts: vi.fn(),
  correctVerdictAction: vi.fn(),
}));
vi.mock('../../../lib/payment/refund-read', () => ({
  listRefundExceptions: mocks.listRefundExceptions,
}));
// 🔴 `#890` 片3:更正那條路的兩支 server 模組同樣要 mock(同上紀律 —— page graph 每支都要)。
vi.mock('../../../lib/payment/refund-correction-read', () => ({
  findEffectiveVerdicts: mocks.findEffectiveVerdicts,
}));
vi.mock('../../../lib/payment/refund-correction-actions', () => ({
  correctVerdictAction: mocks.correctVerdictAction,
}));
vi.mock('../../../lib/payment/refund-recovery-actions', () => ({
  judgeRefundExceptionAction: vi.fn(),
  resolveRefundExceptionAction: vi.fn(),
}));
// 列操作元件用 useRouter(bfcache refresh);jsdom 無 app router context ⇒ 假 router。
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import RefundExceptionsPage from './page';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function exceptionRow(over: Partial<RefundExceptionRow> = {}): RefundExceptionRow {
  return {
    id: 'r-1',
    kind: 'partial',
    status: 'processing',
    refundAmount: 100,
    reason: '缺貨退款',
    actor: 'sean',
    createdAt: '2026-08-04T03:00:00+00:00',
    failedReason: null,
    failedDetail: null,
    providerEvidence: null,
    orderId: ORDER_ID,
    orderDisplayId: 'PCM-2026-0001',
    ...over,
  };
}

beforeEach(() => {
  // 🔴 預設讓它成功回一個空 Map ——
  //    沒有這一行，「沒有 stuck 列」的那幾格是**靠運氣過**的:
  //    mock 回 undefined ⇒ 頁面拿到 undefined ⇒ 它不是 null ⇒ 只是剛好沒有列去 .get() 它。
  mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage(search: Record<string, string> = {}) {
  return render(await RefundExceptionsPage({ searchParams: Promise.resolve(search) }));
}

describe('/orders/refund-exceptions — RW3', () => {
  // ── 🔴 R1 MF3:灰字保底那一行的量具(這三格之前是零覆蓋 —— 整段刪掉照樣全綠)──
  //    它是 Sean 2026-08-30 拍【甲】的配套:數字只數尚未判定的,已判定的**從數字上消失**,
  //    而 `#473b-2` 的理由是「不解卡單,**只解看不見**」⇒ 不能讓它們從**畫面上**也消失。
  it('🔴 有已判定的列 ⇒ 灰字講出「另有 N 筆」(N 來自 listRefundExceptions,不自己重算)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow()],
      truncated: false,
      pendingCount: 0,
      decidedCount: 2,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    // 🔴 **R2 MF-B**:第一版是 `toContain('2')` —— 而 `exceptionRow()` 的
    //    `PCM-2026-0001` 與 `2026-08-04…` 本來就把 `2` 放進 DOM ⇒ **零判別力**。
    //    實測:把 `{decidedCount}` 換成 `{rows.length}`(印 1)⇒ 那一版**全綠存活**。
    //    ⇒ 整句一起錨,數字要真的是它。
    expect(container.textContent).toMatch(/另有\s*2\s*筆已經有人更正過判定/);
  });

  it('🔴 更正讀不到 ⇒ 那一行**不出現**(印「另有 0 筆」會把「讀不到」講成「沒有」)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: true,
    });
    const { container } = await renderPage();
    expect(container.textContent).not.toContain('筆已經有人更正過判定');
  });

  it('負對照:一筆都沒判定過 ⇒ 那一行也不出現(不印「另有 0 筆」)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    expect(container.textContent).not.toContain('筆已經有人更正過判定');
  });

  it('[1] 空清單 → 空態;頁面明寫勿重複發起', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [],
      truncated: false,
      pendingCount: 0,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    expect(container.textContent).toContain('目前沒有滯留或卡住的退款');
    expect(container.textContent).toContain('勿重複發起');
  });

  it('[2] 列渲染:訂單連結回明細頁、金額、證據標示', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), exceptionRow({ id: 'r-2', providerEvidence: 'DR999', refundAmount: 4500 })],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    const link = container.querySelector(`a[href="/orders/${ORDER_ID}"]`);
    expect(link?.textContent).toBe('PCM-2026-0001');
    expect(container.textContent).toContain('4,500');
    // 證據列=G7-hold 優先處理;無證據列=滯留逾時。兩種標示都要在。
    expect(container.textContent).toContain('TapPay 已受理,優先處理');
    expect(container.textContent).toContain('無(滯留逾時)');
  });

  it('[2b] 截斷旗標 → 顯「較新的異常未列出」橫幅(codex MF1)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow()],
      truncated: true,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    // 文案已改成不歸因(兩關 nit:原文把爆量一律說成「滯留量」,但 #473b-2 之後
    // 也可能全是卡住的列)⇒ 這格改守「有東西沒列出來」這個可觀察事實。
    expect(container.textContent).toContain('有退款沒有列出來');
  });

  it('[3] 讀取失敗 → 錯誤態 200(不 500、不靜默)', async () => {
    mocks.listRefundExceptions.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.textContent).toContain('清單載入失敗');
  });

  it('[4] 🔴 措辭鐵律同頁適用:不得出現「還能退」「剩餘可退」', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    expect(container.textContent).not.toContain('還能退');
    expect(container.textContent).not.toContain('剩餘可退');
  });
});

describe('/orders/refund-exceptions — #473 卡住的列(看得見、但沒有動作)', () => {
  const stuckRow = (over: Partial<RefundExceptionRow> = {}) =>
    exceptionRow({
      id: 'r-stuck',
      status: 'failed',
      failedReason: 'manual_failed',
      failedDetail: 'Record 差額 0',
      ...over,
    });
  // 🔴 **帶證據**的卡住列(code-reviewer MF4:我原本的 fixture 只有無證據那支,
  //    「有證據」那條分支零覆蓋、刪掉它六格全綠)。
  //    而依 `20260803150000:179` + `:377`,證據非空的列**出口只剩** recovered_confirmed /
  //    manual_failed ⇒ 帶證據的卡住列是**主要形態**,不是邊角。
  const stuckWithEvidence = () => stuckRow({ id: 'r-stuck-ev', providerEvidence: 'DR999' });

  // 🔴🔴 **`#890` 片3 之後,這一族的合約【反過來了】** ——
  //    ⛔ ~~原本 `[8]` 逐字「卡住的列**不掛**任何操作入口」~~ **作廢**,而它當時是對的:
  //      那時**沒有更正入口存在**,一顆按了只會回「已結案」的鈕確實是誤導。
  //    ✅ 而 `#890` 把那個入口做出來了 ⇒ 現在的合約是「**掛得上,而且員工按得到**」。
  //    🔴 而原本那句**仍然有一個世界成立**:更正查詢**失敗**時 ——
  //      那時他確實沒有可以按的東西,而**一顆按不動的鈕比沒有鈕糟**。
  //    ⇒ 所以下面把它拆成兩格,而不是刪掉。

  it('[8a] 🔴🔴 卡住的列**掛得上更正入口**,而且是【渲染整頁】量到的(A2 驗收)', async () => {
    // 📌 掛載元件只證明「元件會畫」;渲染 page 才證明「員工按得到」——
    //    而 R3-3 抓到的正是「入口被加在一個目標列永遠走不到的分支裡」。
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const { container } = await renderPage();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.some((t) => t.includes('更正這一筆的判定'))).toBe(true);
    // 🔴 只認鈕的字 ⇒ **接線接錯照樣綠**(codex 2026-08-29)。連那張表單真的帶了什麼一起釘。
    const form = container.querySelector('form');
    expect(form, '那顆鈕不在一張 form 裡 ⇒ 它按下去什麼都不會送').not.toBeNull();
    const named = [...(form?.querySelectorAll('input,textarea') ?? [])].map((el) =>
      el.getAttribute('name'),
    );
    expect(named).toContain('correction_refund_id');
    expect(named).toContain('correction_request_token');
    expect(named).toContain('correction_verdict');
    expect(named).toContain('correction_reason');
  });

  it('[8b] 🔴 而更正查詢**失敗**時 ⇒ 零按鈕 + 原本那段話(按不動的鈕比沒有鈕糟)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent ?? '').toContain('沒有可以按的動作');
  });

  it('[8c] 🔴 而查詢失敗**不得讓整張清單看起來像「沒有資料」**(plan §1d #13)', async () => {
    // 那正是「不得併進 page.tsx 既有那個 try」的理由 —— 併了就是整頁一起消失。
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('PCM-2026-0001');
    // 可處理那列的入口照常在。
    expect(
      [...container.querySelectorAll('button')].some((b) =>
        (b.textContent ?? '').includes('執行對帳判定'),
      ),
    ).toBe(true);
  });

  it('[8d] 🔴 已經被更正過的列:畫面要顯示【現行有效判定】,不只是給一顆鈕', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(
      new Map([
        [
          'r-stuck',
          {
            refundId: 'r-stuck',
            correctionId: 'c-1',
            seq: 2,
            correctedTo: 'money_moved' as const,
            reason: '對過 TapPay，錢有動',
            actor: 'staff_01',
            createdAt: '2026-08-29T10:00:00+00:00',
          },
        ],
      ]),
    );
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('已經被更正過');
    expect(text).toContain('staff_01');
    expect(text).toContain('對過 TapPay，錢有動');
    // 🔴🔴 **CAS 那一欄才是這條路的錢守門**(codex 2026-08-29 點名:刪掉它這一格仍會綠)。
    //    沒有它 ⇒ 送出去的是 NULL ⇒ 而 NULL 的語意是「我看到的是尚未更正過」
    //    ⇒ 一筆**已經被改過**的列會拿一個過期的前提去寫 ⇒ 而 CAS 本來就是為了擋這個。
    const cas = container.querySelector('input[name="correction_expected_id"]');
    expect(cas, '已更正過的列少了 CAS 鏈頭 ⇒ 它會用 NULL 送出去').not.toBeNull();
    expect(cas?.getAttribute('value')).toBe('c-1');
  });

  it('🔴 而【還沒被更正過】的列**不得**渲染那一欄(空字串會被解析器判成壞表單)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const { container } = await renderPage();
    expect(container.querySelector('input[name="correction_expected_id"]')).toBeNull();
  });

  it('[9] 🔴 同頁混合時,可處理那列仍只有一顆「執行對帳判定」(不是整頁一起開)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const { container } = await renderPage();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.filter((t) => t.includes('執行對帳判定'))).toHaveLength(1);
    // 而卡住那列拿到的是【另一種】入口，不是同一顆。
    expect(buttons.filter((t) => t.includes('更正這一筆的判定'))).toHaveLength(1);
  });

  it('[10] 🔴 而【查詢成功】時不得再出現「請聯絡工程師處理」—— 他現在做得到了', async () => {
    // ⛔ ~~原本這一格斷言那句話**必須**出現~~ 作廢：那時它是真的，現在它會叫他去找人做他自己能做的事。
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const text = (await renderPage()).container.textContent ?? '';
    // 🔴 正向錨(codex 2026-08-29):下面全是負斷言 ⇒ **一張空畫面也會過**。
    expect(text, '畫面是空的 ⇒ 下面那三個 not 都是恆真的').toContain('更正這一筆的判定');
    expect(text).not.toContain('請聯絡工程師處理');
    // 🔴 負:仍不得沿用 processing 那半的兩句。
    expect(text).not.toContain('滯留逾時');
    expect(text).not.toContain('優先處理');
  });

  it('[10b] 🔴 **帶 TapPay 受理證據**的卡住列:證據要標出來,但不得沿用「優先處理」', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckWithEvidence()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('TapPay 曾受理');
    expect(text).not.toContain('優先處理');
  });

  it('[10c] 🔴 不得把「人工判定」講成金流事實 —— 那正是可能要更正的東西', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckWithEvidence()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const { container } = await renderPage();
    const copy = [...container.querySelectorAll('p')].map((x) => x.textContent ?? '').join(' ');
    // 🔴🔴 **這一格的尺被我改窄過一次,而那是錯的**(code-reviewer 2026-08-29 Important):
    //    ⛔ ~~我把 `not.toContain('錢沒有動')` 改成 `'錢沒有動,'`(多帶一個逗號)~~ **作廢**
    //      —— 那讓「…錢沒有動而結案」這種**沒有逗號的宣稱句**從此抓不到,
    //      而那正是本格要防的東西。**我為了讓自己的新文案過關,把守門縮小了。**
    //    ✅ 改成量【那句規矩真正說的事】:出現那個詞可以,**但它必須被歸給「判定」**。
    //      ⇒ `#890` 的畫面寫「現行判定是「錢沒有動」」⇒ 合法(它敘述判定)
    //      ⇒ 而「這筆錢沒有動」⇒ 非法(它敘述金流事實)
    // 🔴🔴 **這裡差一點裝錯一種對照,寫下來**(2026-08-29 實撞):
    //    我原本加了一格「命中數必須 > 0,否則迴圈恆真」⇒ **當場紅,而紅得對** ——
    //    現行畫面一個「錢…動」都沒有(文案是「沒有動到錢」,詞序不同)。
    //    📌 而那不是缺陷:**這一格是【絆線】不是【量測】** ——
    //      一條禁止清單在一切正常時,本來就該零命中。
    //    ⇒ 🔴 **絆線的對照不是「現在有沒有命中」,是【餵一句違規的字,它抓不抓得到】。**
    //    ⇒ 而我如果留著那格「>0」,只有兩條路:拿掉守門,或去把違規的話寫進畫面。
    const rule = (text: string) =>
      [...text.matchAll(/錢[^。,，]{0,3}動|動到錢/g)].every((m) =>
        text.slice(Math.max(0, m.index - 12), m.index).includes('判定'),
      );
    // 負對照:一句把判定講成金流事實的話 ⇒ 這把尺必須判它違規。
    expect(rule('這一列的這筆錢沒有動,已結案'), '尺對違規句失效了').toBe(false);
    // 🔴 字集擴到「動到錢」那個詞序(codex 2026-08-29:原本只認一種寫法)。
    expect(rule('這一列沒有動到錢,已結案'), '尺抓不到另一種詞序').toBe(false);
    expect(rule('這一列的這筆錢有動'), '尺抓不到肯定句').toBe(false);
    // 正對照:一句正確歸屬給判定的話 ⇒ 必須放行(否則它是「一律拒」)。
    expect(rule('現行判定是「錢沒有動」'), '尺把合法句也擋了').toBe(true);
    for (const m of copy.matchAll(/錢[^。,，]{0,3}動|動到錢/g)) {
      const before = copy.slice(Math.max(0, m.index - 12), m.index);
      expect(
        before.includes('判定'),
        `「${m[0]}」出現在 <p> 而前 12 字內沒有「判定」⇒ 那是把判定講成金流事實:…${before}${m[0]}…`,
      ).toBe(true);
    }
    expect(copy).toContain('當初被人工判定');
  });

  it('[11] 🔴 文案守門:純文字輸出不得混進 Markdown 星號;不得寫死鐘點', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [stuckRow()],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    mocks.findEffectiveVerdicts.mockResolvedValue(new Map());
    const { container } = await renderPage();
    expect(container.textContent ?? '').not.toContain('**');
    // 🔴 鐘點守門只掃「我們寫的字」(<p> 文案),**不掃整頁** ——
    //    第一版掃整頁,紅在資料列渲染出來的 created_at「2026-08-04 11:00」,
    //    那是真實資料不是文案 = 量錯東西(掃描字集比宣稱寬)。
    //    ⚠️ 限度:寫死鐘點若被塞進 <td>/<th> 而非 <p>,本格看不到。
    const copy = [...container.querySelectorAll('p')].map((p) => p.textContent ?? '').join(' ');
    expect(copy).not.toBe('');
    // 「22:30」這種關帳鐘點依銀行而異,寫進 UI 就是對員工說謊(memory:鐘點不准進文案)。
    expect(copy).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('/orders/refund-exceptions — RW4 操作接線', () => {
  it('[5] 每列掛「執行對帳判定」入口;結案按鈕**不**直接渲染(判定成立後才出現)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), exceptionRow({ id: 'r-2' })],
      truncated: false,
      pendingCount: 1,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    const { container } = await renderPage();
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.filter((t) => t.includes('執行對帳判定'))).toHaveLength(2);
    // 量按鈕不量 textContent(頁首 prose 也提「標記失敗/恢復結案」;量錯東西=恆紅假訊號)。
    expect(buttons.filter((t) => t.includes('標記失敗'))).toHaveLength(0);
    expect(buttons.filter((t) => t.includes('恢復結案'))).toHaveLength(0);
  });

  it('[6] PRG 結果碼 → 兩則成功橫幅(result-banner 註冊)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [],
      truncated: false,
      pendingCount: 0,
      decidedCount: 0,
      verdictsUnavailable: false,
    });
    let rendered = await renderPage({ r: 'refund_marked_failed' });
    expect(rendered.container.textContent).toContain('已標記失敗結案');
    cleanup();
    rendered = await renderPage({ r: 'refund_recovered' });
    expect(rendered.container.textContent).toContain('已恢復結案');
  });

  it('[7] 讀取失敗 → 不渲染任何操作入口(loadFailed 分支零列=零按鈕;頁首 prose 提到判定不算入口)', async () => {
    mocks.listRefundExceptions.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
