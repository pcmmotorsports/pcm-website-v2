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

/** D3-c 起本元件要 orderId/returnTo(只給作廢後 revalidate 與 returnTo 用)。 */
const WIRE = { orderId: 'ord-1', returnTo: '/orders/ord-1' } as const;

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
