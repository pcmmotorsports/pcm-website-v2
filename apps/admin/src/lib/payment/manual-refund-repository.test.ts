import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { recordManualRefund } from './manual-refund-repository';

// manual-refund-repository.test.ts — SQLSTATE → 失敗碼那張表。
//
// 🔴 **這支檔在 2026-08-31 之前不存在** —— 那張 map 只被間接跑過。
// ⛔ ~~它漏掉那三個碼「**一年多**沒有人紅」~~ ⇒ 🔴 **那個數字是我編的**(codex 關卡2 nit 6):
//    `#866` 是 `20260824011000` ⇒ 2026-08-24,而本檔是 08-31 ⇒ **一週,不是一年多。**
//    📌 **我沒有查日期就寫了一個【聽起來更嚴重】的量級** —— 而它比真值大 50 倍以上。
// 📌 **⇒ 一張沒有人直接測的對照表,它的缺口由【有沒有人按得到】決定,不由測試決定。**
//
// 🔴 mock 帶**真實 PostgrestError 形狀的 `code` 欄**(同 refund-repository.test.ts 的教訓:
//    mock 一個裸 Error 會讓「分得開」那幾格恆綠)。

const ARGS = {
  orderId: '11111111-2222-3333-4444-555555555555',
  rail: 'cash' as const,
  refundAmount: 500,
  reason: '客人現場退',
  occurredAt: '2026-08-31T01:00:00+08:00',
  actor: 'staff_01',
  requestId: '9f8e7d6c-5b4a-4321-a987-654321fedcba',
};

const raise = (code: string, message = '訊息') => ({ data: null, error: { code, message } });

beforeEach(() => {
  mocks.rpc.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('🔴 #866 軌別上限那三個碼 —— 它們原本落進 error,而 error 叫員工重試', () => {
  // 🔴 **三個碼今天的可達性【不一樣】,而 map 三個都接是刻意的**(codex 關卡2 must-fix 1 抓到
  //    我原本把三個講成同一回事):
  //      PCM01 ⇒ **可達**。`#866` 管的是【現金/匯款】那一軌,比 RPC 步5 的【訂單總額】窄
  //              ⇒ 訂單還有錢可退、而現金那一軌沒有 ⇒ 就是它。已端到端量到
  //              (`scripts/pcm01-transport-probe.sh`)。
  //      PCM02 ⇒ ⛔ ~~要 cap 回 NULL,今天構造不出來(我沒有演)~~
  //              🔴🔴 **codex R3 證得更強:它【不可能】回 NULL,不是「我構造不出來」。**
  //              `20260824010000:118-131` 那支 cap 的**兩段都是 `COALESCE(…, 0)`**
  //              ⇒ 回傳恆為非 NULL ⇒ **trigger 的 `IF v_cap IS NULL THEN RAISE … PCM02` 是死分支。**
  //              📌 **「我構造不出來」與「它不可能發生」是兩個宣稱** —— 前者說我的能力,後者說那段碼。
  //     🔴 **而真正的問題不是那個死分支,是它【原本要防的東西今天沒有人防】**:
  //        一個真的「算不出上限」的故障(表不見了 / 函式不見了 / 溢位 / 序列化失敗)
  //        會吐**別的** SQLSTATE,而它們**不在下方那張 map 裡** ⇒ 落 fallback 的 `error`
  //        ⇒ 又是那句「可以用同一張表單稍後再試」。當場量(2026-08-31):
  //          42501 權限被撤 ⇒ map 有(bug)✅
  //          🔴 42P01 表不存在 / 42883 函式不存在 / 22003 溢位 / 40001 序列化失敗 ⇒ **map 都沒有**
  //          🔵 負對照現造碼 ⇒ 0
  //        ⇒ 已開列 `⟦b4-CAPNULLDEAD⟧`。**本片不順手加**(那是另一組碼、另一個判斷)。
  //      PCM03 ⇒ 🔴 **今天不可達**:它只在 `DELETE` 發生,而**本 repository 只 INSERT**,
  //              且全 repo 零處 DELETE 那張表。
  //    ⛔ ~~當場量:app 側 `.delete(` ⇒ **0**~~ 🔴 **那把尺印不出那個數**(關卡2 R2 nit 12):
  //       `grep -rn '\.delete(' apps/admin/src` 實際 ⇒ **21**(URLSearchParams / FormData / cookies)。
  //       **結論是真的,而【被我寫進檔裡的量法】是假的** ——
  //       📌 **一個對的結論配一把錯的尺,下一個人照著跑會得到一個嚇人的數字,然後不知道該信哪個。**
  //    ✅ 正確的問法(當場跑):`grep -rn "from('order_manual_refunds')" apps/admin/src` 裡帶 `delete` 的
  //       ⇒ **0**;🔵 正對照:同把尺的總命中 ⇒ **1**(尺碰得到那張表)· 🔵 負對照現造表名 ⇒ **0**。
  //       migrations 側 `DELETE FROM public.order_manual_refunds` ⇒ **0**
  //       (🔵 正對照 `INSERT INTO …` ⇒ **3**)。
  //    ⇒ 🔵 **那為什麼還接?** 因為 map 的成本是一行,而沒接的代價是落進 `error` 那句「稍後再試」。
  //    ⛔ ~~而未來任何人加一條 DELETE 路徑時,這一行已經在那裡了~~
  //    🔴 **codex R3 nit 推翻了這句**:這張 map 是**私有的**,只活在 `recordManualRefund()` 裡,
  //       而那支只做 INSERT ⇒ **未來的 DELETE 會走【另一個呼叫端】,它接不到這一行。**
  //       📌 **⇒ 我把「碼在檔案裡」當成了「碼在那條路上」** —— 而那是兩件事。
  //    ✅ **所以這三行今天的真實價值,只有 `PCM01` 那一行**(它是唯一可達的)。
  //       另外兩行留著是**零成本的文件**:它們把「這張表上還有誰會吐什麼」寫成了會編譯的東西。
  // ⚠️ **下面這幾格驗的是【map 的行為】,不是「員工今天看得到」。**
  it.each([
    // ⚠️ **這三句是【改寫版】,不是 DB 原句**(關卡2 R2 nit 12):星號、🔴、第二句都被拿掉了。
    //    ⇒ 🛑 **本檔沒有任何一格釘住 DB 的字面** —— `⟦b4-PCM03STARS⟧` 修好或修壞,這套都不會變色。
    //    那是刻意的:本檔驗的是**分類與傳遞**(哪個碼落哪一格、message 有沒有原樣帶出去),
    //    而 DB 字面的權威在 migration,釘在這裡只會多一個會漂的副本。
    ['PCM01', '這張單在【現金 / 匯款】上目前只剩 300 元可退,退不了 500 元。'],
    ['PCM02', '這張單算不出可退上限 ⇒ 為了安全先擋下,沒有登記任何東西。'],
    ['PCM03', '人工退款登記不能刪除 —— 要取消請用「作廢」。'],
  ])('%s ⇒ rejected,而 RPC 那句話原樣帶給員工(驗 map 的行為;可達性見上方註解)', async (code, message) => {
    mocks.rpc.mockResolvedValue(raise(code, message));
    const out = await recordManualRefund(ARGS);
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ ok: false, code: 'rejected', sqlstate: code });
    // 🔴 承重的是這一格:`rejected` 的意義就是「把 RPC 那句寫給員工的話帶出去」。
    //    只驗 code 的話,一張把三個碼全丟進 rejected 卻【不帶訊息】的實作也會過。
    expect((out as { staffMessage: string | null }).staffMessage).toBe(message);
  });

  it('🔴🔴 三個碼【都不准】落進 error —— 那句話說「可以用同一張表單稍後再試」', async () => {
    for (const code of ['PCM01', 'PCM02', 'PCM03']) {
      mocks.rpc.mockResolvedValue(raise(code));
      const out = await recordManualRefund(ARGS);
      // 超額再送 = 同一個金額 = 永遠失敗;而 error 還宣稱「系統會回報這筆的現況」,
      // 而三個碼都是 RAISE ⇒ 交易回滾 ⇒ 沒有任何東西在等著被回報。
      expect((out as { code: string }).code, `${code} 落回 error 了`).not.toBe('error');
    }
  });
});

describe('🔵 負對照 —— 證明我沒有把既有那幾條弄壞', () => {
  it('P0001(D1 自己的業務 RAISE)仍然是 rejected,且仍然帶 staffMessage', async () => {
    mocks.rpc.mockResolvedValue(raise('P0001', '同一個 request_id 帶了不同的內容。'));
    const out = await recordManualRefund(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'rejected', sqlstate: 'P0001' });
    expect((out as { staffMessage: string | null }).staffMessage).toBe(
      '同一個 request_id 帶了不同的內容。',
    );
  });

  // 🔴 `⟦b4-CAPNULLDEAD⟧`(2026-08-31):真的「算不出上限」時會吐的碼。
  //    ⚠️ **而它們【不是同一個桶子】** —— 這一組測試的形狀本身就是那個判斷:
  //      42P01 / 42883 / 42703 / 23502 = schema 漂移 ⇒ `bug`(停手、通知維護)
  //      22003        = ⛔ ~~金額太大 ⇒ invalid~~ 🔴 **改成 `bug`** —— 表單層已擋掉超大金額
  //                     ⇒ 一個真的抵達的 22003 是內部溢位,不是使用者輸入(見下方那一格)
  //      40001 / 40P01 = 瞬時 ⇒ **維持 fallback 的 `error`**(「稍後用同一張表單再試」)
  //    📌 **⇒ 「把沒接的碼都接上」是錯的問法;要逐碼問【員工的下一步是什麼】。**
  it.each(['42P01', '42883', '42703', '23502'])('%s(schema 漂移)⇒ bug —— 重試一百次都一樣', async (code) => {
    mocks.rpc.mockResolvedValue(raise(code));
    expect(await recordManualRefund(ARGS)).toMatchObject({ code: 'bug', sqlstate: code });
  });

  it('🔴 22003 ⇒ bug —— 因為超大金額【到不了這一層】,所以抵達的那個一定是系統壞了', async () => {
    // ⛔ ~~原本我判它是「金額太大」⇒ invalid~~ 🔴 **回頭查之後推翻了我自己**:
    //    `manual-refund-form.ts:29,85` 在解析階段就擋掉 `> 2_147_483_647`
    //    ⇒ 使用者輸入永遠走不到 PostgREST 的轉型層
    //    ⇒ 📌 **一個真的抵達的 22003,照定義不是使用者輸入問題,是內部算術溢位。**
    //    ⇒ 而「叫他改金額」在那個世界是**錯的指示**:他改一百次也不會好。
    mocks.rpc.mockResolvedValue(raise('22003', 'value out of range for type integer'));
    const out = await recordManualRefund(ARGS);
    expect(out).toMatchObject({ code: 'bug', sqlstate: '22003' });
    expect((out as { code: string }).code).not.toBe('invalid');
  });

  // ⚠️ 可達性不同,而兩個都留在「不加」那一邊(codex R1 nit):
  //    `40P01` deadlock 是真正可達的那一個;而 `40001` 要 REPEATABLE READ 以上,
  //    而 RPC 步1 先用 `P8C01` 擋掉非 READ COMMITTED ⇒ **它大概到不了**。
  //    📌 **⇒ 一個是政策(不該加),一個是可達性(加了也不會被打到)—— 理由不同,結論相同。**
  it.each(['40001', '40P01'])(
    '🔵 %s(瞬時)⇒ **維持 fallback 的 error** —— 加進 map 反而會把「重試就好」變成一張工單',
    async (code) => {
      mocks.rpc.mockResolvedValue(raise(code));
      const out = await recordManualRefund(ARGS);
      // 🔴 這一格是【反向】的:它守的是「有人好心把它加進 map」那個改動。
      //    ⚠️ 而 `not.toBe('bug')` 我拿掉了(codex R1 nit):上面那個精確斷言已經涵蓋它,
      //      多一行不增加守門能力 —— 📌 **一行看起來像多一道防護的斷言,可能一格都沒多守。**
      expect(out).toMatchObject({ code: 'error', sqlstate: code });
    },
  );

  it.each(['P8C01', '23514', '23505', '42501', 'PGRST202'])(
    '%s 仍然是 bug(既有分類沒被動到)',
    async (code) => {
      mocks.rpc.mockResolvedValue(raise(code));
      expect(await recordManualRefund(ARGS)).toMatchObject({ code: 'bug', sqlstate: code });
    },
  );

  it('🔴🔴 不認得的碼仍然落 fallback 的 error —— **這一格是在驗 map,不是在驗 fallback**', async () => {
    // 📌 沒有這一格,我上面那些綠可能全部來自 fallback 而不是 map ——
    //    兩者在綠的時候長得一模一樣。突變二(把 fallback 改成 'rejected')會讓這一格紅。
    mocks.rpc.mockResolvedValue(raise('PCM99'));
    expect(await recordManualRefund(ARGS)).toMatchObject({ code: 'error', sqlstate: 'PCM99' });
  });

  it('bug 那一類【不得】把 RPC 訊息帶給員工(只有 rejected 可以)', async () => {
    mocks.rpc.mockResolvedValue(raise('42501', '權限被撤:內部細節'));
    const out = await recordManualRefund(ARGS);
    expect((out as { staffMessage: string | null }).staffMessage).toBeNull();
    // 🔵 而它仍然進 log(不是整個丟掉)
    expect((out as { logMessage: string }).logMessage).toContain('權限被撤');
  });
});
