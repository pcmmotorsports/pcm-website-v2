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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WalletLedgerEntry } from '@pcm/domain';
import { WalletTab } from './WalletTab';

const HERE = dirname(fileURLToPath(import.meta.url));
/** design 原稿 —— 「刻意不做」那三個字面的**正對照量具**(見 `DELIBERATELY_OMITTED`)。 */
const DESIGN_WALLET_JSX = resolve(HERE, '../../../../../../design-reference/components/WalletTab.jsx');
/**
 * 🔴 **`design-reference` 是 git submodule** —— 新 worktree / 未跑過
 * `git submodule update --init` 的 checkout 上,那個目錄是**空的**。
 *
 * `scripts/commit-pack-preflight.sh` 用 `git worktree add --detach` 建乾淨沙箱 ⇒ 沙箱裡沒有它
 * ⇒ 這一格在那裡會**硬紅**,而紅的理由與「字面打錯了」長得一樣。(2026-08-27 preflight 實際抓到。)
 *
 * ⚠️ **本檔是全 repo 唯一在 runtime 讀 design-reference 檔案的測試**(2026-08-27 重量)
 *    ⇒ 沒有既有慣例可循,這個取捨是本片新造的。
 *
 * 🔴 **我第一版在這裡寫的數法是【假的】,而它旁邊的結論是真的** ——
 *    原文寫「`grep -rn design-reference --include='*.test.ts*' apps packages` ⇒ 只有本檔那一行」,
 *    而那條指令**照抄去跑印 12**,不是 1。**結論對、數法錯 ⇒ 下一個想重現的人會得到 12 然後不知道該信誰。**
 *    📌 **一個附了數法而數法錯的結論,比一個沒附數法的結論更難被推翻** ——
 *       因為它旁邊掛著一條可執行的指令,讀的人會覺得已經驗過了。
 *
 * 📏 **真正的數法(2026-08-27;它有兩段,而第二段【不是一條指令】)**:
 *    ① 先用一把**寬尺**取候選集 —— 全 repo、不限目錄、六種測試檔命名變體:
 *       `find . -path ./node_modules -prune -o \( -name '*.test.ts' -o -name '*.test.tsx'`
 *       `   -o -name '*.spec.ts' -o -name '*.spec.tsx' -o -name '*.test.js' -o -name '*.spec.js' \) -print`
 *       ⇒ 候選集 **851** 支;其中內容含 `design-reference` 的 **7** 支。
 *       負對照:同一把寬尺改查 `design-reference-nosuch` ⇒ **0**(尺不會無中生有)。
 *    ② 再**逐支開檔人工分類那 7 支** —— 🔴 **這一段沒有指令,是我一支一支看的**:
 *         3 支 `readFileSync` 讀的是**別的路徑**,design-reference 只出現在註解
 *           (`invisible-tap-targets` / `filter-drawer-width` / `order-detail-header`)
 *         1 支 `cancel-request-token` 同上(註解在講掃描範圍**不含** design-reference)
 *         2 支純註解、無讀檔(`FeatureEditorial`;`FilterDrawer` 那一行是**測試標題字串**)
 *         **1 支 = 本檔**,`DESIGN_WALLET_JSX` 這個 const 餵給 `readFileSync`
 *    🔴 **為什麼第②段不能用 grep**:本檔的路徑寫在一個 const 裡、`readFileSync` 收的是**變數**
 *       ⇒ `grep '(readFileSync|readFile|import)\(' | grep -c design-reference` 對**本檔自己**印 **0**。
 *       📌 **一把連自己都量不到的尺,會把唯一的那個命中報成零。**(我第二版又踩了一次。)
 *
 * ⚠️ **這個結論的殘留缺口(附不出檢查的就明寫)**:動態組出來的路徑
 *    (變數拼接、`process.env`、glob)我的候選集掃得到那支檔,而②的人工分類**可能看漏**。
 *    ⇒ 標**未確認**;它若被打破,方向是「不只本檔」,而本檔的 `skipIf` 處置不受影響。
 *
 * 🔴 **取捨(ponytail:寫下天花板)**:沒有 submodule 時 **skip 而不是紅**。
 *    · 代價 = **它在乾淨沙箱與 CI 上不生效** —— 那是一個 fail-open,我不假裝它不是。
 *    · skip **會出現在 vitest 摘要的 `Tests` 那一行**, 不是靜靜地綠 ⇒ 看得到。
 *      🔴 **而這句話 2026-08-27 之前對【沙箱】是假的**(審查 R2 的 C1):`commit-pack-preflight.sh`
 *      當時只印 `Test Files` 那一行, 而 skip **只出現在 `Tests` 那一行** ——
 *      實測 `Test Files 1 passed (1)` / `Tests 6 passed | 10 skipped (16)` ⇒ **10 格 skip 零訊號**。
 *      ✅ 已改成兩行都印。📌 **我拿【主樹手動跑】的經驗替【沙箱】背書, 而那是兩個介面。**
 *    · 而它在**主樹**(我與 Sean 實際工作、submodule 在的地方)照常跑;
 *      2026-08-27 突變複驗:把 `tierCard` 改名成 `wal-tier-card-v2` ⇒ 這一格紅。
 *    · 🔴 **沙箱那一半 2026-08-27 已做**(`#945` 片A):`scripts/commit-pack-preflight.sh` 建完
 *      乾淨 worktree 之後會 `git submodule update --init design-reference` ⇒ **這一格在沙箱裡會真的跑**。
 *      沒進來時(離線 / 沒金鑰 / `update=none`)它**不 fail**, 而最後那個 ✅ 會被加註
 *      「若這一包裡有讀 design 原稿的測試, 這個 ✅ 不涵蓋它」⇒ **綠的射程會縮**。
 *      🔴 那道判別掛在 **`git submodule status` 的首字元**(" "=在釘住的 SHA 才放行),
 *      **不掛在 git 的 rc、也不掛在「目錄裡有沒有東西」** —— 那兩把尺各自被打穿過一次:
 *      `update=none` ⇒ rc=0 而目錄空;缺 SHA ⇒ 目錄留下一個 `.git` ⇒ `ls -A`=1。
 *      📌 **每一把新尺都自帶一組它看不見的世界, 而「我剛修好一個坑」是最不會回頭再量的時刻。**
 *      ⚠️ 而它**只在包裡有【讀稿的測試檔】時才拉** —— 沙箱只跑包內測試, 且 build 期無人讀稿
 *      (2026-08-27 量:源碼含該字串 79 行、逐行看全是註解;設定檔 0)⇒ 不拉是省, 不是漏。
 *      ⚠️ 所以這個 fail-open 是被**縮小並顯影**, 不是被收掉 —— 不要讀成收掉了。
 *    · **CI 那一半還沒做**:`.github/workflows/ci.yml` 的 checkout 仍是 `submodules: false`
 *      🔴 **這裡刻意不寫行號**(審查 N3;而 2026-08-27 當天 `rpm-sync.yml` 就差點因為別人在檔案
 *      中間插註解而讓一份 spec 的行號漂掉 —— 行號是一支檔的公共介面)。當場重量:
 *      `grep -rn 'submodules' .github/workflows/` ⇒ 4 行;負對照 `submodules-nosuch` ⇒ 0。
 *      而**跑 `pnpm test` 的只有 `ci.yml`** ⇒ `grep -n 'run: pnpm test' .github/workflows/ci.yml`。
 *      ⇒ 這一格在 CI 上**目前仍然從來沒有跑過**。卡 `Q-945-1`(要放 deploy key 還是 PAT ——
 *      只有 Sean 放得了 secret);plan `docs/specs/2026-08-27-945-submodule-in-sandbox-and-ci-plan.md`。
 */
const HAS_DESIGN_SUBMODULE = existsSync(DESIGN_WALLET_JSX);

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

/**
 * 「拍板刻意不做的東西」的字面 —— **正對照與斷言共用同一份常數**。
 *
 * 🔴 分開寫的話,斷言那半打錯字(`.wal-tier-crd`)就變成**恆真**:
 *    `querySelector` 找不到一個不存在的 class,而它回 `null` —— 與「我們真的沒渲染」一模一樣。
 *    ⇒ 下面那格正對照拿【design 原稿】當量具:打錯的字在原稿裡也找不到 ⇒ 正對照先紅。
 */
const DELIBERATELY_OMITTED = {
  /** design `WalletTab.jsx` 的等級卡容器(Q2=乙 不放)。 */
  tierCard: 'wal-tier-card',
  /** design `WalletTab.jsx:108` 每列右下角的「當時餘額」(Q3=乙 不顯示)。 */
  txBalance: 'wal-tx-bal',
  /** design `WalletTab.jsx:54` 那顆鈕的字面(q5=乙 換成灰字)。 */
  depositButtonLabel: '立即儲值',
} as const;

describe('WalletTab — 🔴 拍板刻意不做的東西不得偷偷出現', () => {
  it.skipIf(!HAS_DESIGN_SUBMODULE)(
    '🔴 正對照:這三個字面在 design 原稿上【真的找得到】(否則下面那格是恆真的)',
    () => {
    // 🔴 這一格量的不是我們的元件,是**我的量具有沒有接上**。
    //    `queryBy…(X) === null` 在【我們沒渲染 X】與【X 這個字根本不存在】兩個世界印同一句話,
    //    而後者就是打錯字。⇒ 拿 design 原稿當第三方:打錯的字在那裡也不存在 ⇒ 這一格先紅。
    const designJsx = readFileSync(DESIGN_WALLET_JSX, 'utf8');

    // 🔴 **比【完整 token】不比子字串**(R1 nit):`toContain('wal-tier-card')` 在原稿改名成
    //    `wal-tier-card-v2` 時仍然綠,而 `querySelector('.wal-tier-card')` 那側已經量不到東西了
    //    ⇒ 正對照會替一把已經斷掉的尺背書。
    // 🔴🔴 **而 class 與中文標籤不能用同一把尺** —— JS 的 `\b` 靠 `\w`(ASCII)判邊界,
    //    中文字元不是 `\w` ⇒ `/\b立即儲值\b/` **永遠不匹配**,而它印出來的是「找不到」
    //    = 與「這個字面打錯了」一模一樣的失敗訊息。(我第一版就是這樣紅的。)
    //    ⇒ class 走 `\b`;中文標籤釘「自成一行的文字節點」(design 那顆鈕的字面就是這個形狀)。
    for (const cls of [DELIBERATELY_OMITTED.tierCard, DELIBERATELY_OMITTED.txBalance]) {
      expect(designJsx, `class token「${cls}」在 design 原稿上找不到 ⇒ 打錯或已改名`).toMatch(
        new RegExp(`\\b${cls}\\b`),
      );
    }
    expect(
      designJsx,
      `「${DELIBERATELY_OMITTED.depositButtonLabel}」在 design 原稿上不是一個獨立的文字節點 ⇒ 打錯或已改字`,
    ).toMatch(new RegExp(`^\\s*${DELIBERATELY_OMITTED.depositButtonLabel}\\s*$`, 'm'));
    },
  );

  it('沒有「立即儲值」鈕、沒有等級卡、沒有每列的「當時餘額」', () => {
    const { container } = render(
      <WalletTab balance={27600} entries={[entry(), entry({ id: 'b', amount: -2400, entryType: 'use' })]} />,
    );
    // q5=乙:鈕拿掉
    expect(screen.queryByText(DELIBERATELY_OMITTED.depositButtonLabel)).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    // Q2=乙:等級卡不放(🔴 這是【刻意偏離 design】, 不是漏搬 —— 見元件檔頭)
    expect(container.querySelector(`.${DELIBERATELY_OMITTED.tierCard}`)).toBeNull();
    // Q3=乙:每列的「當時餘額」不顯示
    expect(container.querySelector(`.${DELIBERATELY_OMITTED.txBalance}`)).toBeNull();
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
