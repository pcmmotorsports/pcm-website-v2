// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ManualRefundRow } from '../../lib/payment/manual-refund-read';
import { ManualRefundLedgerSection } from './manual-refund-ledger-section';

// 🔴 **為什麼要 mock**(不是為了方便,是 jsdom 進不去):作廢鈕是 client component,
//    它 import 的 server action 又 import `server-only` ⇒ 在 jsdom 下那支模組會直接 throw
//    「This module cannot be imported from a Client Component module」。
//    形狀與同目錄 `cancel-forms-browser.test.tsx:58` 那一行相同(那支也把 action 換成字串)。
// ⚠️ **誠實邊界**:換掉之後本檔證的是「這一欄長什麼樣、什麼時候出現」,
//    **不是**「按下去會發生什麼」。按下去那半住在 RPC 與 `scripts/d3b-void-probe.sh`。
vi.mock('../../lib/payment/manual-refund-void-actions', () => ({
  voidManualRefundAction: '/submit',
}));
// 作廢鈕在 bfcache 還原時 router.refresh()(作廢是狀態轉移,回上一頁看到的是舊狀態)
// ⇒ jsdom 沒有掛 app router,`useRouter()` 會丟 invariant。這裡給一個只夠用的替身。
// ⚠️ 同樣的誠實邊界:本檔不主張「bfcache 還原真的會 refresh」——那要真瀏覽器。
const refreshSpy = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshSpy }) }));

// M-4b E10 D3:非卡退款登記列表(server component,jsdom 直接 render —— 無 hook 無 context)。
//
// 🔴 [3] 是主視窗 2026-08-20 明點的那格:「有一筆已登記的退款時,畫面上真的看得到它」
// ——這正是主視窗 grep `order_manual_refunds` ⇒ 0 命中所指的那件事(員工今天完全看不到
// 已登記的非卡退款)。這一格不依賴沖銷 RPC(`#787`),可以在那片落地前先驗過。

function row(over: Partial<ManualRefundRow> = {}): ManualRefundRow {
  return {
    id: 'mr-1',
    rail: 'cash',
    refundAmount: 500,
    reason: '商品缺貨,現金退還客人',
    actor: 'sean',
    occurredAt: '2026-08-20T10:00:00.000Z',
    createdAt: '2026-08-20T10:05:00.000Z',
    voidedAt: null,
    voidReason: null,
    voidedBy: null,
    ...over,
  };
}

/**
 * D3-c 起本元件要 orderId/returnTo(只給作廢後 revalidate 與 returnTo 用)。
 *
 * 🔴 ⟦b4-PCM01RECORD⟧ 起多了 `displayId` 與 `railCap`。**`railCap` 這裡給 `0` 而不是 `null`**:
 *    `0` = 「上限剛好用完、沒有超額」⇒ **不標紅** ⇒ 上面那幾格驗的是它們原本要驗的東西。
 *    ⚠️ 給 `null` 的話每一格都會多出一條紅字, 而它們**照樣會綠** —— 那就是把一個
 *    「畫面多了一段沒人預期的東西」藏進一堆綠裡。
 */
const WIRE = {
  orderId: 'ord-1',
  displayId: 'PCM-0001',
  railCap: 0,
  returnTo: '/orders/ord-1',
} as const;

afterEach(() => {
  cleanup();
});

describe('ManualRefundLedgerSection — D3-c 作廢欄', () => {
  // 🔴 **不要只找文字**(codex R1 must-fix ③,2026-08-22):
  //    第一版寫 `textContent).toContain('作廢這筆登記')` ——
  //    把整顆按鈕換成 `<span>作廢這筆登記</span>` 它照樣綠。
  //    ⇒ 它證的是【標籤存在】,而我拿它去替代驗收①「入口出得來」。**那是超收。**
  //    現在改成:必須是一顆真的 `<button>`,而且**按下去要真的展開第二段**。
  it('[C1] 未作廢的列 → 有一顆【真的按鈕】,按下去展開理由欄與送出鈕', () => {
    const { container } = render(<ManualRefundLedgerSection rows={[row()]} {...WIRE} />);
    expect(container.textContent).not.toContain('已作廢');

    const buttons = [...container.querySelectorAll('button')];
    const open = buttons.find((b) => b.textContent === '作廢這筆登記');
    expect(open, '找不到一顆文字是「作廢這筆登記」的 <button>(是不是被換成 span 了?)').toBeDefined();

    // 第一段:還沒有輸入欄,也還沒有送出鈕 —— 兩段式的前半。
    expect(container.querySelector('input[name="void_reason"]')).toBeNull();

    fireEvent.click(open as HTMLButtonElement);

    // 第二段:理由欄 + 確認鈕 + 隱藏欄位都要在,而且 refundId 要是這一列的。
    const reason = container.querySelector('input[name="void_reason"]');
    expect(reason, '按了之後理由欄沒有出現 ⇒ 兩段式的後半沒接上').not.toBeNull();
    expect(reason?.getAttribute('required')).not.toBeNull();
    expect(
      container.querySelector('input[name="refund_id"]')?.getAttribute('value'),
    ).toBe('mr-1');
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === '確認作廢'),
    ).toBe(true);
  });

  // 🔴 這一格是**反向對照**:少了它,[C1] 在「作廢鈕無條件渲染」時照樣綠。
  it('[C2] 已作廢的列 → 顯示作廢資訊,而且【沒有】作廢入口(不能作廢兩次)', () => {
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[row({ voidedAt: '2026-08-22T03:00:00.000Z', voidReason: '金額打錯', voidedBy: 'alice' })]}
        {...WIRE}
      />,
    );
    expect(container.textContent).toContain('已作廢');
    expect(container.textContent).toContain('金額打錯');
    expect(container.textContent).toContain('alice');
    expect(container.textContent).not.toContain('作廢這筆登記');
  });

  // 🔴🔴 Fable R2 must-fix F1:確認面板必須把【後果】講出來。
  //    原文案寫「不會把錢收回來,**也不會退第二次**」—— 而那是反的:
  //    作廢會把金額加回可退餘額,而那個餘額餵退款發起入口的閘 ⇒ 開啟同額第二次退款的資格。
  //    ⚠️ 兩段式的第二顆按鈕擋得住誤觸、**擋不住誤解** —— 該出現在面板上的是後果,不是第二顆鈕。
  it('[C4] 🔴 展開後的確認面板要講出「金額會回到可退餘額」,而不得說「不會退第二次」', () => {
    const { container } = render(<ManualRefundLedgerSection rows={[row()]} {...WIRE} />);
    const open = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '作廢這筆登記',
    );
    fireEvent.click(open as HTMLButtonElement);
    const text = container.textContent ?? '';
    expect(text).toContain('可退餘額');
    expect(text).toContain('沒退過');
    // 🔴 反向對照:那句反的話一個字都不能留下來。
    expect(text).not.toContain('不會退第二次');
  });

  // 🔴 帳本記的是發生過的事 ⇒ 作廢的列**不移除**,金額與理由要留著給對帳的人看。
  it('[C3] 已作廢的列不會被藏起來:金額與原始理由仍在,而金額有刪除線', () => {
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[row({ voidedAt: '2026-08-22T03:00:00.000Z', voidReason: 'x', voidedBy: 'alice' })]}
        {...WIRE}
      />,
    );
    expect(container.textContent).toContain('500');
    expect(container.textContent).toContain('商品缺貨,現金退還客人');
    expect(container.querySelector('.line-through')).not.toBeNull();
  });
});

describe('ManualRefundLedgerSection — D3', () => {
  it('[1] 零列且未失敗 → 整區不渲染(同 RefundLedgerSection 的立場)', () => {
    const { container } = render(<ManualRefundLedgerSection rows={[]} {...WIRE} />);
    expect(container.innerHTML).toBe('');
  });

  it('[2] 載入失敗 → 警告(不靜默)', () => {
    const { container } = render(<ManualRefundLedgerSection rows={[]} loadFailed {...WIRE} />);
    expect(container.textContent).toContain('載入失敗');
    expect(container.textContent).toContain('勿在此期間重複登記');
  });

  it('[2b] 列被截斷 → 整區不顯示任何一列(Sean 2026-08-17 Q2=甲 同款立場)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} rowsTruncated {...WIRE} />,
    );
    expect(container.textContent).toContain('不顯示任何一列');
    // 🔴 truncated 分支必須排在渲染之前:即使 rows 非空,也不得把那一列印出來。
    expect(container.textContent).not.toContain('缺貨');
  });

  it('[3] 🔴 有一筆已登記的退款 → 畫面上真的看得到它(管道/金額/原因/經手人/時間全部出現)', () => {
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[
          row({
            rail: 'bank_transfer',
            refundAmount: 1200,
            reason: '客人要求匯款退款',
            actor: 'sean',
          }),
        ]}
        {...WIRE}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('匯款');
    expect(text).toContain('1,200');
    expect(text).toContain('客人要求匯款退款');
    expect(text).toContain('sean');
  });

  it('[3b] 多筆列 → 全部各自渲染(不是只顯示最新一筆)', () => {
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[
          row({ id: 'mr-1', rail: 'cash', refundAmount: 300 }),
          row({ id: 'mr-2', rail: 'bank_transfer', refundAmount: 700 }),
        ]}
        {...WIRE}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('300');
    expect(text).toContain('700');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

// ══ ⟦b4-PCM01RECORD⟧ 那條紅 ══════════════════════════════════════════════════
//
// 🔴 這一組是 `20260902020000` 的**解封條件**:那支把上限閘從【擋下來】改成【記下來】,
//    Sean 2026-09-02 拍甲逐字「記得下來, 但標紅」⇒ 沒有下面這幾格,那支不得單獨上線。
//    ⇒ 所以這裡驗的不是「有沒有一句字」,是**兩種紅分不分得開**(Sean Q4 甲)。
//
// 🛑 **第一版有三個假綠格, 全部由 codex 2026-09-02 抓到 —— 訃聞留著, 因為它們是同一族**:
//    ⑥ 只數 `role="alert"`, **完全沒驗它是紅的** ⇒ 把整段改成灰色仍全綠
//       ⇒ 📌 而規格的字面就是「標紅」, 那格量的卻是「有沒有一段 alert」。
//    ⑦ `toContain('800')` ⇒ 畫面印 `1,800` / `8000` 照樣過
//       ⇒ 📌 **而它守不到的正好是同一份 diff 裡另一條 must-fix(bigint 失真)。**
//    ⑧ 沒有任何一格演過 truncated / loadFailed / 零列 —— 而那三條 return 路徑當時都不掛紅。
describe('ManualRefundLedgerSection — ⟦b4-PCM01RECORD⟧ 超出上限要標紅', () => {
  /**
   * 🔴 **不是只數 `role="alert"`** —— 那把尺只量得到「有一段警語」,量不到「它是紅的」。
   *    這裡多釘一格:那段必須帶 `text-destructive`(本 repo 的紅=destructive token)。
   *    ⚠️ 誠實邊界:它證的是**class 在**, 不是**瀏覽器真的畫成紅色**(那要真瀏覽器)。
   *    ⇒ 但它擋得住「有人把紅底紅字改成灰色」這一種 —— 那正是 codex ⑥ 的那個世界。
   */
  function redAlerts(c: HTMLElement): HTMLElement[] {
    return Array.from(c.querySelectorAll<HTMLElement>('[role="alert"]')).filter((el) =>
      el.className.includes('text-destructive'),
    );
  }
  const allAlerts = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]'));

  it('[R1] railCap 為負 ⇒ 一條紅,講得出【超出多少】與【下一步是確認金額】', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={-800} />,
    );
    expect(redAlerts(container)).toHaveLength(1);
    const text = redAlerts(container)[0]?.textContent ?? '';
    // 🔴 **釘完整金額字面, 不是 `toContain('800')`**(codex ⑦):
    //    `1,800` / `8000` 都含 `800` ⇒ 那把尺對「金額算錯」是瞎的。
    expect(text).toContain('超出可退上限 NT$ 800');
    expect(text).not.toContain('-800');
    // 🔴🔴 **R3/Fable F2:文案原本只點名【一個】成因** ——
    //    而 `railCap < 0` 有兩個成因:①退款打錯 ②**收款側少記**。
    //    ⇒ 現金單的收款從未登錄時 cap=0 ⇒ 一筆【金額完全正確】的退款也會標紅
    //    ⇒ 員工確認金額沒錯 ⇒ 紅永遠在 ⇒ 🛑 **而畫面上唯一可按的東西是「作廢」**
    //    ⇒ ⇒ 他會作廢一筆**真實發生過**的退款來消紅 ⇒ 帳與事實分家,
    //       而那正是作廢欄自己(本檔 `:19-21`)說不該做的事。
    expect(text).toContain('退款金額有沒有打錯');
    expect(text).toContain('收款有沒有登錄齊全');
    // 🔴 而它必須明說「不要用作廢消警示」—— 那是這個畫面唯一一顆按得下去的鈕。
    expect(text).toContain('請勿用「作廢」來消除這個提示');
    // 🔴 而它必須同時講「已經記下來了」—— 少了這句,員工會以為登記被擋掉而再按一次。
    expect(text).toContain('記下來');
  });

  it('[R1b] 🔴 金額要逐字對得上, 千分位也算(守 bigint 失真那條)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={-1234567} />,
    );
    expect(redAlerts(container)[0]?.textContent ?? '').toContain('超出可退上限 NT$ 1,234,567');
  });

  it('[R2] railCap 為 null ⇒ 出現的是【另一條】紅:算不出上限 + 帶單號', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={null} />,
    );
    expect(redAlerts(container)).toHaveLength(1);
    const text = redAlerts(container)[0]?.textContent ?? '';
    expect(text).toContain('算不出');
    // 🔴 單號:員工看到這句會去打電話,而電話那頭第一句一定是「哪一張」(主視窗 2026-09-02 指定)。
    expect(text).toContain('PCM-0001');
    // 🛑 **這一格是 Sean Q4 甲的本體**:兩種紅的【下一步不同】⇒ 不得共用同一句。
    //    超額 ⇒ 自己去確認金額;算不出 ⇒ 找工程。合成一句 = 把該找工程的送去改一個沒問題的金額。
    expect(text).not.toContain('超出可退上限');
    expect(text).toContain('系統維護');
  });

  it('[R3] 🟢 正向對照:railCap >= 0 ⇒ 一條紅都不出現(否則上面兩格對「永遠標紅」也綠)', () => {
    for (const cap of [0, 1, 999999]) {
      const { container } = render(
        <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={cap} />,
      );
      expect(allAlerts(container)).toHaveLength(0);
      cleanup();
    }
  });

  // ══ codex must-fix ②/③/④:紅不得被別的 return 路徑遮掉 ════════════════════════
  it('[R6] 🔴 列被截斷時, 超額的紅仍要在 —— 那正是最該紅的時候', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={-800} rowsTruncated />,
    );
    expect(container.textContent).toContain('不顯示任何一列');
    expect(redAlerts(container)).toHaveLength(1);
    expect(redAlerts(container)[0]?.textContent ?? '').toContain('超出可退上限 NT$ 800');
  });

  it('[R7] 🔴 載入失敗時, 超額的紅仍要在(cap 是另一支查詢, 它沒失敗)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[]} {...WIRE} railCap={-500} loadFailed />,
    );
    expect(container.textContent).toContain('載入失敗');
    expect(redAlerts(container)[0]?.textContent ?? '').toContain('超出可退上限 NT$ 500');
  });

  it('[R8] 🔴 零列 + 超額 ⇒ 仍要渲染(並發時序:另一人在兩支查詢之間登記)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[]} {...WIRE} railCap={-500} />,
    );
    // 🛑 第一版在這裡 `return null` ⇒ 該紅而整個區塊不存在, 而畫面上零訊號。
    expect(container.innerHTML).not.toBe('');
    expect(redAlerts(container)).toHaveLength(1);
  });

  it('[R9] 🔴 只剩已作廢的列 + railCap 為 null ⇒ 不掛「算不出上限」', () => {
    // 🛑 **理由【不是】「對齊 RPC 的分母」**(R3/Fable F5 更正 —— 而那句宣稱在元件那側
    //    已經被 codex R2③/R2④ 判死兩次:cap 函式兩段 COALESCE(...,0) ⇒ DB 端恆非 NULL
    //    ⇒ 兩個數字本來就不會相等)。把它寫在測試裡, 會讓一句被殺掉的宣稱復活。
    // ✅ 真正的理由:**已作廢的登記不需要任何人做任何事** ⇒ 掛一句「請通知系統維護」
    //    是叫人去處理一件已經處理完的事。判準是【對員工有沒有下一步】, 就這一條。
    const { container } = render(
      <ManualRefundLedgerSection
        rows={[row({ voidedAt: '2026-09-01T00:00:00.000Z', voidReason: 'x', voidedBy: 'a' })]}
        {...WIRE}
        railCap={null}
      />,
    );
    expect(allAlerts(container)).toHaveLength(0);
    // 🟢 而列本身仍要看得到 —— 帳本不藏已作廢的列。
    expect(container.textContent).toContain('已作廢');
  });

  it('[R10] 🟢 負向對照:零列 + railCap 為 null ⇒ 整區不渲染(不是全站每張單都掛紅字)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[]} {...WIRE} railCap={null} />,
    );
    expect(container.textContent).toBe('');
  });

  // ══ codex R2⑤:`|| rowsTruncated || loadFailed` 那兩格【原本沒有守門】 ════════════
  //    把那整段從實作刪掉 ⇒ 上面每一格照樣全綠。下面兩格就是那兩個世界。
  it('[R12] 🔴 railCap 為 null + 列被截斷 ⇒ 仍要掛「算不出上限」(列看不到 ⇒ 往紅倒)', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={null} rowsTruncated />,
    );
    expect(redAlerts(container)).toHaveLength(1);
    expect(redAlerts(container)[0]?.textContent ?? '').toContain('算不出');
  });

  it('[R13] 🔴 railCap 為 null + 載入失敗 ⇒ 仍要掛「算不出上限」', () => {
    const { container } = render(
      <ManualRefundLedgerSection rows={[]} {...WIRE} railCap={null} loadFailed />,
    );
    expect(redAlerts(container)).toHaveLength(1);
    expect(redAlerts(container)[0]?.textContent ?? '').toContain('算不出');
  });

  it('[R11] 🔴 React 不解析 markdown ⇒ 兩條紅裡都不准有星號(同 today-summary R2 MF-D)', () => {
    for (const cap of [-800, null]) {
      const { container } = render(
        <ManualRefundLedgerSection rows={[row()]} {...WIRE} railCap={cap} />,
      );
      expect(container.textContent).not.toContain('**');
      cleanup();
    }
  });
});
