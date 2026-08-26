// @vitest-environment jsdom
//
// WalletTab — #202 解凍第一片(Sean 2026-08-26「甲 只顯示餘額和明細」)。
//
// 🔴 **本檔守的不是「畫得出來」,是【四個會靜默說謊的地方】**:
//   ① 讀取失敗 vs 真的沒交易 —— 合成一種顯示就是在對客人說謊
//   ② 金額正負 —— 讀 `amount` 的正負, 不由 `entryType` 再推一次
//   ③ 拍板刻意不做的三樣東西, 不得偷偷出現(等級卡 / 當時餘額 / 立即儲值鈕)
//   ④ 灰字**不得承諾時程**
//
// 🔴 本檔原本沒有 cleanup ⇒ render 出來的 DOM 留在 document 上、`screen` 是全域查詢
//    ⇒ 對「同批跑了哪些檔、什麼順序」敏感(A 窗 2026-08-05 回報過非決定性紅)。**保留 cleanup。**

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WalletLedgerEntry } from '@pcm/domain';
import { WalletTab } from './WalletTab';

afterEach(cleanup);

function entry(over: Partial<WalletLedgerEntry> = {}): WalletLedgerEntry {
  return {
    id: 'e1',
    customerUserId: 'u1',
    entryDate: '2026-04-22',
    entryType: 'deposit',
    amount: 30000,
    note: '儲值 NT$ 30,000',
    relatedOrderId: null,
    createdAt: '2026-04-22T00:00:00Z',
    ...over,
  } as WalletLedgerEntry;
}

describe('WalletTab — 餘額', () => {
  it('印出餘額,而且是千分位', () => {
    render(<WalletTab balance={27600} entries={[]} />);
    expect(screen.getByText('27,600')).toBeTruthy();
    expect(screen.getByText('CURRENT BALANCE')).toBeTruthy();
  });

  it('餘額 0 照樣印 0,不是空白也不是 NaN', () => {
    const { container } = render(<WalletTab balance={0} entries={[]} />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('undefined');
  });
});

describe('WalletTab — 🔴 讀取失敗與「真的沒交易」必須分得開', () => {
  it('沒交易 ⇒ 說「尚無交易紀錄」', () => {
    render(<WalletTab balance={0} entries={[]} />);
    expect(screen.getByText('尚無交易紀錄')).toBeTruthy();
    expect(screen.getByText('0 ENTRIES')).toBeTruthy();
  });

  it('🔴 讀取失敗 ⇒ 【不得】說「尚無交易紀錄」,也【不得】印 0 ENTRIES', () => {
    // 這一格是本檔存在的主要理由:兩者合成一種顯示 = 讀取壞掉時對客人說「你沒有交易」。
    render(<WalletTab balance={5000} entries={[]} loadFailed />);
    expect(screen.queryByText('尚無交易紀錄')).toBeNull();
    expect(screen.queryByText('0 ENTRIES')).toBeNull();
    expect(screen.getByText('交易紀錄暫時讀不到')).toBeTruthy();
    // 而餘額仍要看得到 —— 明細讀不到不代表餘額讀不到(它們是兩發查詢)
    expect(screen.getByText('5,000')).toBeTruthy();
  });
});

describe('WalletTab — 🔴 金額的正負由 amount 決定,不由 entryType 再推一次', () => {
  it('deposit 正數 ⇒ +、use 負數 ⇒ -,而金額都印絕對值', () => {
    render(
      <WalletTab
        balance={27600}
        entries={[
          entry({ id: 'a', amount: 30000, entryType: 'deposit', note: '儲值' }),
          entry({ id: 'b', amount: -2400, entryType: 'use', note: '訂單折抵' }),
        ]}
      />,
    );
    expect(screen.getByText(/\+NT\$ 30,000/)).toBeTruthy();
    // 🔴 **負數【不印符號】—— 逐字照 design `WalletTab.jsx:106`**(`{tx.amount > 0 ? '+' : ''}`)。
    //    負的靠 `.is-minus` 變色。上一版我印 `-`, 那是未揭示的 design 偏離。
    expect(screen.getByText(/^NT\$ 2,400$/)).toBeTruthy();
    // 而金額一律印絕對值 —— 不得出現 `-2,400`
    expect(screen.queryByText(/-2,400/)).toBeNull();
  });

  it('🔴 `entryType` 與 `amount` 的正負不一致時,**看 amount** —— DB 的 CHECK 才是那個事實', () => {
    // 構造不出來的狀態(DB CHECK 擋著), 而這一格釘的是【我們讀哪一個】——
    // 讀 entryType 是再推一次, 而推錯了印出來仍是一個合理的金額。
    const { container } = render(
      <WalletTab balance={0} entries={[entry({ id: 'c', entryType: 'deposit', amount: -500 })]} />,
    );
    expect(container.querySelector('.wal-tx-amt.is-minus')).toBeTruthy();
    expect(container.querySelector('.wal-tx-amt.is-plus')).toBeNull();
  });
});

describe('WalletTab — 🔴 拍板刻意不做的東西不得偷偷出現', () => {
  it('沒有「立即儲值」鈕、沒有等級卡、沒有每列的「當時餘額」', () => {
    const { container } = render(
      <WalletTab balance={27600} entries={[entry(), entry({ id: 'b', amount: -2400, entryType: 'use' })]} />,
    );
    // q5=乙:鈕拿掉
    expect(screen.queryByText('立即儲值')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    // Q2=乙:等級卡不放(🔴 這是【刻意偏離 design】, 不是漏搬 —— 見元件檔頭)
    expect(container.querySelector('.wal-tier-card')).toBeNull();
    // Q3=乙:每列的「當時餘額」不顯示
    expect(container.querySelector('.wal-tx-bal')).toBeNull();
    expect(container.textContent).not.toContain('餘額 NT$');
  });

  it('🔴 灰字在(不留白), 而它【不承諾時程】', () => {
    const { container } = render(<WalletTab balance={0} entries={[]} />);
    const soon = container.querySelector('.wal-balance-soon');
    expect(soon).toBeTruthy();
    // 🔴 不得出現任何時程字眼 —— 舊 stub 的註解就是為了這件事而寫的,
    //    而那條註解的【理由】已經換掉(法規解凍), 【結論】沒有:他說的是「之後再補」。
    for (const banned of ['即將推出', '即將開放', '近期', '很快', '月']) {
      expect(soon?.textContent ?? '', `灰字不得出現「${banned}」`).not.toContain(banned);
    }
  });

  it('🔴 灰字是【一句】而且【兩半都點名】—— 儲值與折抵', () => {
    // 主視窗 2026-08-26 要求合併成一句:印兩句會讓客人讀到兩次「你不能」。
    // 而**兩個都要點名** —— 只說儲值不開放的話, 客人會到結帳頁才發現折抵也不能用。
    const { container } = render(<WalletTab balance={0} entries={[]} />);
    const soon = container.querySelector('.wal-balance-soon');
    expect(soon?.textContent).toContain('儲值');
    expect(soon?.textContent).toContain('折抵');
    // 🔴 先說能做什麼 —— 「餘額」要出現在「尚未開放」之前
    const t = soon?.textContent ?? '';
    expect(t.indexOf('餘額')).toBeGreaterThanOrEqual(0);
    expect(t.indexOf('餘額')).toBeLessThan(t.indexOf('尚未開放'));
    // 只有一個灰字節點, 不是兩句
    expect(container.querySelectorAll('.wal-balance-soon').length).toBe(1);
  });

  it('🔴 餘額卡下面那句話【不得承諾折抵】—— 折抵現在沒做', () => {
    // CheckoutStep2.tsx:35 / CheckoutView.tsx:39 逐字都寫著「儲值金折抵…不做」
    // ⇒ 印 design 原字「可用於下單折抵」= 對客人印一句他到結帳頁會發現不成立的話。
    // ⚠️ Sean 若答 Q-錢包-3=甲(照 design 印), 這一格要連同理由一起改, 不是刪掉。
    const { container } = render(<WalletTab balance={100} entries={[]} />);
    expect(container.querySelector('.wal-balance-meta')?.textContent).not.toContain('折抵');
  });
});

/* ══ 對抗審查 must-fix 的守門(2026-08-26)══════════════════════════════════ */

describe('WalletTab — 🔴 截斷:這一頁的筆數不得假扮成總筆數', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => entry({ id: `e${i}` }));

  it('total > 顯示筆數 ⇒ 印「20 / 57 ENTRIES」+ 一句看得到的說明', () => {
    const { container } = render(<WalletTab balance={100} entries={twenty} total={57} />);
    expect(screen.getByText('20 / 57 ENTRIES')).toBeTruthy();
    const more = container.querySelector('.wal-tx-more');
    expect(more).toBeTruthy();
    expect(more?.textContent).toContain('57');
    // 🔴 要告訴他【去哪裡問】—— 這一版沒有分頁, 更舊的真的看不到
    expect(more?.textContent).toContain('客服');
  });

  it('🔴 剛好 20 筆而 total 也是 20 ⇒ 【不得】說「還有更多」', () => {
    // 判準是「total > 顯示筆數」而不是「剛好 20 筆」——
    // 用後者判的話, 一個剛好 20 筆的客人會被告知還有更多, 而其實沒有。
    const { container } = render(<WalletTab balance={100} entries={twenty} total={20} />);
    expect(screen.getByText('20 ENTRIES')).toBeTruthy();
    expect(container.querySelector('.wal-tx-more')).toBeNull();
  });

  it('total 沒拿到(null)⇒ 不宣稱總數, 也不宣稱截斷', () => {
    const { container } = render(<WalletTab balance={100} entries={twenty} total={null} />);
    expect(screen.getByText('20 ENTRIES')).toBeTruthy();
    expect(container.querySelector('.wal-tx-more')).toBeNull();
  });
});

describe('WalletTab — 🔴 餘額讀不到, 不得印 0', () => {
  it('balanceFailed ⇒ 說「讀不到」, 而畫面上不得出現那個 0', () => {
    // 這一格擋的是:customers 那一發失敗而明細那一發成功
    // ⇒ 「NT$ 0」配著一串真實交易 = 對客人顯示一個錯的金額。
    const { container } = render(
      <WalletTab balance={0} entries={[entry()]} total={1} balanceFailed />,
    );
    expect(screen.getByText('餘額暫時讀不到')).toBeTruthy();
    expect(container.querySelector('.wal-balance-cur')).toBeNull();
    expect(container.querySelector('.wal-balance-meta')).toBeNull();
    // 而明細仍要看得到 —— 兩發查詢, 一發失敗不該把另一發帶走
    expect(screen.getByText('1 ENTRIES')).toBeTruthy();
  });

  it('對照組:balanceFailed 未設 ⇒ 照常印餘額', () => {
    render(<WalletTab balance={0} entries={[]} total={0} />);
    expect(screen.queryByText('餘額暫時讀不到')).toBeNull();
    expect(screen.getByText('0')).toBeTruthy();
  });
});
