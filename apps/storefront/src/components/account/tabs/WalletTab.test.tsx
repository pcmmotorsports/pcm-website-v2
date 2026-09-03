// @vitest-environment jsdom
//
// WalletTab — #202 解凍第一片(Sean 2026-08-26「甲 只顯示餘額和明細」)。
//
// 🔴🔴 **本檔證不出【上游有沒有改名】。** 這一句放在第一段, 不放在「已知限制」那一節 ——
//    因為它決定的是你讀完本檔之後【還相不相信自己知道稿長什麼樣】。
//    本檔買的是【反恆真】(A):證明「我們刻意不渲染 X」不是一句空話 ⇒ 一份 fixture 就夠。
//    **抓漂移**(B, 證明 design 上游沒把 X 改名)是**另一件事, 而它【不做成 CI 格】** ——
//    🔴 **不是「沒做」** —— B 那一格就在本檔下面, 而它在**有稿的地方(主樹)每次都跑**;
//       它 `skipIf` 的是**沒有稿的地方**(CI / 新 worktree / 收包沙箱)。
//       (審查點名我原本寫「沒有做」⇒ 照那個字面讀, 下一個人會把 B 當死碼刪掉或再造一份。)
//    決策與理由:`docs/specs/2026-08-27-945-submodule-in-sandbox-and-ci-plan.md` `§13-8`(裁決落在那裡;`§13-7b` 只有題目, 沒有答案)
//    (主視窗 2026-08-27 裁 A;B 不做成 CI 格, 理由抄自 `scripts/od-drift-check.py` 檔頭:
//     稿住在 repo 外面 ⇒ CI 上那個檔不存在 ⇒ **紅在環境不是紅在漂移, 那種紅會被學會忽略**)。
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
/**
 * design 原稿 —— **漂移(B)那一格的量具**。
 * ⚠️ 它**不再是正對照** —— 正對照(反恆真)搬到下面那份 fixture 上了(審查 F9)。
 */
const DESIGN_WALLET_JSX = resolve(HERE, '../../../../../../design-reference/components/WalletTab.jsx');
/**
 * 🔴 **反恆真那一半的量具 —— 它在【每一台機器、每一個沙箱、CI 上】都存在。**
 * 內容是從 design 原稿**機械抄**出來的三行(抄法與版本 sha 寫在檔內), 不是我打的字。
 * ⇒ 它證「那三個字面在 design 上真的存在」⇒「沒有立即儲值鈕、沒有等級卡、沒有當時餘額」那格不是恆真。
 * ⚠️ 它是一份 **snapshot** ⇒ **上游改名它不會知道**。那一半見檔頭第一段。
 */
const DESIGN_CONTRACT_FIXTURE = resolve(HERE, 'wallet-design-contract.fixture.txt');
/**
 * 🔴 **`design-reference` 是 git submodule** —— 新 worktree / 未跑過
 * `git submodule update --init` 的 checkout 上,那個目錄是**空的**。
 *
 * `scripts/commit-pack-preflight.sh` 用 `git worktree add --detach` 建乾淨沙箱 ⇒ 沙箱裡沒有它
 * ⇒ 這一格在那裡會**硬紅**,而紅的理由與「字面打錯了」長得一樣。(2026-08-27 preflight 實際抓到。)
 *
 * ⛔ ~~**本檔是全 repo 唯一在 runtime 讀 design-reference 檔案的測試**(2026-08-27 重量)~~
 *    🔴 **2026-09-03 起不成立 —— 現在是 2 支。訂正全文見本段下方那一格。**
 *    (這一行原地標記, 是因為拿錨 grep 進來的人正好落在這裡, 而訂正在 29 行之後。)
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
 * ⛔⛔ **2026-09-03 訂正(線 `-auth`):上面那句「全 repo 唯一」【已經不成立】, 而它自己預告了方向。**
 *    `apps/storefront/src/styles/search-overlay-design-parity.test.ts`(2026-09-02 出生, `aa0161ed`;
 *    而那句「唯一」寫在本檔 `grep -n '全 repo 唯一在 runtime 讀' <本檔>` 那一行)
 *    也在 runtime 讀 `design-reference/styles/search-overlay.css` ⇒ **現在是 2 支, 不是 1 支。**
 *    🔴 **而它出生時沒有跟上本檔的 `skipIf` 處置** ⇒ 在 CI 上 **4 格全紅**
 *    (`gh run 33677207412` 逐字 `ENOENT … design-reference/styles/search-overlay.css`)——
 *    ⇒ 已於 2026-09-03 照本檔那一格的形狀補上 `skipIf`
 *      (定位:`grep -n 'it.skipIf(!HAS_DESIGN_SUBMODULE)' <本檔>` ——
 *       🔴 **不寫行號**:我第一版寫了 `:282`, 而**同一筆 diff 在它上面加了 12 行, 當場漂成 :294**;
 *       `.github/workflows/ci.yml` 對這件事有明文
 *       `grep -n '用 grep 定位不用行號' .github/workflows/ci.yml`)。
 *    🛑 而**它只搬了本檔的一半**:本檔是 fixture(A, 恆跑)+ skipIf(B), 那一支只有 (B)
 *      ⇒ **CI 上沒有任何一格在比對它與稿**。理由寫在該檔檔頭, 那是取捨不是疏漏。
 *    📌 **⇒ 這一格的教訓不是那個數字錯了, 是【它預告了「若被打破方向是不只本檔」而沒有東西在看】** ——
 *      本檔當時就標了「未確認」, 而**標了未確認之後, 沒有任何機制會在它被打破時出聲。**
 *      🔵 分母重量(2026-09-03)。**數法帶範圍與對照(本檔上面剛講過「附了數法而數法錯更難推翻」)**:
 *        `grep -rln design-reference apps/<app>/src packages/<pkg>/src --include=<test glob>` ⇒ **9 支**
 *        (🔴 不寫真 glob 字面 —— 它含【星號接斜線】會提前關掉區塊註解;真字面見 commit body);🟢 正對照 同一把尺打 `search-overlay` ⇒ 非 0(尺會動);
 *        🔵 負對照 打一個現造字串 ⇒ 0。
 *        ⇒ 逐支開檔後**真的在 runtime 讀的只有 2 支**;其餘 7 支是註解 / 測試名字裡的字串 /
 *        把它**排除**在目錄走訪之外(`packages/domain/src/ops/cron-jobs.test.ts` 裡那份排除清單)
 *        ⇒ **9 是「提到」不是「讀」。**
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
 *    ⇒ 反恆真那格拿【repo 內的 design 契約 snapshot】當量具:打錯的字在 snapshot 裡也找不到 ⇒ 它先紅。
 *      ⚠️ **原句寫「下面那格正對照拿 design 原稿當量具」** —— 拆成兩格之後那句就漂了(審查 F3)。
 */
const DELIBERATELY_OMITTED = {
  /** design `WalletTab.jsx` 的等級卡容器(Q2=乙 不放)。 */
  tierCard: 'wal-tier-card',
  /** design `WalletTab.jsx:108` 每列右下角的「當時餘額」(Q3=乙 不顯示)。 */
  txBalance: 'wal-tx-bal',
  /** design `WalletTab.jsx:54` 那顆鈕的字面(q5=乙 換成灰字)。 */
  depositButtonLabel: '立即儲值',
} as const;

/**
 * 🔴 **class token 的尺 —— 而它是【第二版】。**
 * 第一版用 `\b`, 而審查用一發實測打穿它:JS 的 `\b` 靠 `\w`(ASCII 字母數字底線)判邊界,
 * 而 **`-` 不是 `\w`** ⇒ `/\bwal-tier-card\b/` 對字串 `"wal-tier-card-v2"` 回 **true**。
 * ⇒ 上游把 class 加後綴改名時, 那把尺**照樣綠**;而我的註解逐字寫著它「改名成 -v2 時會紅」。
 * 📌 **那句註解與那把尺, 講的是兩件事, 而它們寫在同一行的上下。**
 * ⇒ 第二版把連字號一起算進邊界。四個世界實測(2026-08-27):
 *     `wal-tier-card` 對 `className="wal-tier-card"`  ⇒ true   (該中的中了)
 *     `wal-tier-card` 對 `"wal-tier-card-v2"`         ⇒ false  (改名抓得到)
 *     截斷字 `wal-tier` 對 `"wal-tier-card"`          ⇒ false  (打錯字抓得到)
 *     舊尺 `\b` 在後兩個世界都回 true                 ⇒ 兩種錯它都放行
 */
/** 🔴 token 是資料, 不是 regex ⇒ 進 `RegExp` 前要跳脫(審查 F5:`wal.tier` 會命中 `walXtier` 而靜靜過)。 */
const escapeRe = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_RULER = (token: string) => new RegExp(`(?<![\\w-])${escapeRe(token)}(?![\\w-])`);
/** 🔴 CJK 標籤的尺:`\b` 對它無效(見上)⇒ 釘「自成一行的文字節點」。 */
const LABEL_RULER = (label: string) => new RegExp(`^\\s*${escapeRe(label)}\\s*$`, 'm');

/**
 * 🔴 **從 `DELIBERATELY_OMITTED` 推, 不要手打清單**(審查點名):
 * 原本兩處都硬寫 `[tierCard, txBalance]` ⇒ 日後新增第 4 個「刻意不做」的東西,
 * 下面會多一條 `queryBy(...)===null`, 而**正對照那邊零新增、零紅** ⇒ 恆真悄悄回來一格。
 * 📌 **保護的分母與被保護的分母, 沒有理由相等 —— 而它們長得一樣, 都印一個綠。**
 */
const ALL_OMITTED = Object.values(DELIBERATELY_OMITTED);
/** ASCII-only ⇒ 當 class token 量;含非 ASCII ⇒ 當文字標籤量。**由內容分堆, 不由 key 名。** */
const CLASS_TOKENS = ALL_OMITTED.filter((v) => /^[\x20-\x7e]+$/.test(v));
const LABEL_TOKENS = ALL_OMITTED.filter((v) => !/^[\x20-\x7e]+$/.test(v));

/**
 * 🔴 fixture 的檔頭是**我們手打的** ⇒ 拿整份檔去比, 等於讓檔頭也能餵綠那把尺
 * (「重抄時順手在檔頭寫上新 class 名」就過了)。⇒ 只比分隔線【以下】那幾行。
 */
const CONTRACT_SEPARATOR = /^# -{10,}$/m;
function contractBody(raw: string): string {
  const m = CONTRACT_SEPARATOR.exec(raw);
  expect(m, 'design 契約 fixture 找不到分隔線 ⇒ 檔壞了或格式被改, 不得繼續').not.toBeNull();
  return raw.slice((m as RegExpExecArray).index + (m as RegExpExecArray)[0].length);
}

describe('WalletTab — 🔴 拍板刻意不做的東西不得偷偷出現', () => {
  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 反恆真(A)—— **這一格【不 skip】, 每一台機器 / 每一個沙箱 / CI 上都跑。**
  //    它是 `#945` 決策的產物:原本這件事掛在 submodule 上 ⇒ 沒有稿的地方就 skip
  //    ⇒ 而那正是「恆真」最會發生的地方。⇒ 改掛在一份 repo 內的 snapshot 上。
  //    決策與理由:`docs/specs/2026-08-27-945-submodule-in-sandbox-and-ci-plan.md` `§13-8`(裁決落在那裡;`§13-7b` 只有題目, 沒有答案)
  // ══════════════════════════════════════════════════════════════════════════
  it('🔴 反恆真:這三個字面在 design 契約 snapshot 上【真的找得到】(否則「沒有立即儲值鈕…」那格是恆真的)', () => {
    const contract = contractBody(readFileSync(DESIGN_CONTRACT_FIXTURE, 'utf8'));

    // 🔴 **兩把不同的尺, 而它們不能互換**(這一段與下面的漂移格用同一套, 刻意的):
    //    · class token 走 `TOKEN_RULER`(它的四世界實測寫在它自己的 docstring)
    //      🔴 **不要換回 `\b`** —— `-` 不是 `\w` ⇒ `\b` 對 `wal-tier-card-v2` 回 true
    //    · 🔴 中文標籤**不能走 `\b`** —— JS 的 `\b` 靠 `\w`(ASCII)判邊界, 中文不是 `\w`
    //      ⇒ `/\b立即儲值\b/` 對 `">立即儲值<"` 這種**真實會出現的形狀**不匹配,
    //        而它印的是「找不到」= 與「打錯字」同一句話。
    //      ⚠️ 我原本寫「**永遠**不匹配」—— 那個量級沒量過, 而實測 `"a立即儲值b"` ⇒ **true**。
    //        (結論不變:CJK 別用 `\b`。變的是我不該把「這裡不管用」講成「永遠不管用」。)
    for (const cls of CLASS_TOKENS) {
      expect(contract, `class token「${cls}」在 design 契約 snapshot 上找不到 ⇒ 打錯, 或 snapshot 該重抄`).toMatch(
        TOKEN_RULER(cls),
      );
    }
    for (const label of LABEL_TOKENS) {
      expect(
        contract,
        `「${label}」在 snapshot 上不是一個獨立的文字節點 ⇒ 打錯, 或 snapshot 該重抄`,
      ).toMatch(LABEL_RULER(label));
    }
    expect(CLASS_TOKENS.length + LABEL_TOKENS.length, '有東西沒有被分進任何一堆 ⇒ 分堆的尺漏了').toBe(
      ALL_OMITTED.length,
    );
  });

  it.skipIf(!HAS_DESIGN_SUBMODULE)(
    '🔴 漂移(B, 有稿才跑):這三個字面在【活的 design 原稿】上仍然找得到',
    () => {
    // 🔴 **這一格與上面那格【不是同一件事】, 不要合起來看**:
    //   上面(A, 恆跑)= snapshot ⇒ 答「那三個字面【曾經】在稿上」⇒ 反恆真
    //   這一格(B, 有稿才跑)= 活的稿 ⇒ 答「它們【現在】還在」⇒ 抓上游改名
    // 🔴 而它 `skipIf` ⇒ **沒有稿的地方(CI / 新 worktree)它不跑, 而那是刻意的**:
    //   稿住在 submodule 裡 ⇒ 做成必跑的 CI 格會【紅在環境】而不是【紅在漂移】,
    //   那種紅會被學會忽略(論證抄自 `scripts/od-drift-check.py` 檔頭)。
    // ⚠️ ⇒ **這一格的覆蓋率是「有稿的人」, 不是「每個人」。** 上面那格才是每個人都有的。
    const designJsx = readFileSync(DESIGN_WALLET_JSX, 'utf8');

    // 🔴 **比【完整 token】不比子字串**(R1 nit), 而**第一版那把尺是壞的**:
    //    我寫「`toContain('wal-tier-card')` 在改名成 `-v2` 時仍然綠 ⇒ 所以改用 `\b`」——
    //    而 `\b` **在同一個世界也綠**(實測 true)⇒ 那次的修法沒有解決我描述的那個問題,
    //    而**當時的突變複驗只演了「改我方常數」那個方向, 沒演「稿被改名」那個方向。**
    //    📌 **量具只演一個世界 ⇒ 它會替另一個世界的壞掉背書。** 現在兩處共用 `TOKEN_RULER`。
    //    ⚠️ 這兩行原本是上一版段落的下半, 而主詞在改寫時被換掉了 ⇒ 讀起來像在講新尺(審查 F2)。
    //       補回主詞:**舊的 `\b` 尺**對 `wal-tier-card-v2` 仍然綠, 而 `querySelector('.wal-tier-card')`
    //       那側已經量不到東西 ⇒ **正對照會替一把已經斷掉的尺背書。** 新尺(`TOKEN_RULER`)沒有這個病。
    // 🔴🔴 **而 class 與中文標籤不能用同一把尺** —— JS 的 `\b` 靠 `\w`(ASCII)判邊界,
    //    中文字元不是 `\w` ⇒ `/\b立即儲值\b/` 對 `">立即儲值<"` 不匹配,而它印出來的是「找不到」
    //    ⚠️(「**永遠**不匹配」是我原本的字面, 而實測 `"a立即儲值b"` ⇒ true ⇒ 那個量級沒量過)
    //    = 與「這個字面打錯了」一模一樣的失敗訊息。(我第一版就是這樣紅的。)
    //    ⇒ class 走 `TOKEN_RULER`;中文標籤走 `LABEL_RULER`(釘「自成一行的文字節點」)。
    //    🔴 **不要換回 `\b`** —— 它對 `wal-tier-card-v2` 回 true(見 `TOKEN_RULER` 的 docstring)。
    //    ⚠️ 原本這一行逐字寫著「class 走 `\b`」, 而同一格上面剛寫完「不要換回 `\b`」
    //       ⇒ **一支檔裡兩條互相矛盾的指示, 而壞的那條是祈使句**(審查 F1)。
    for (const cls of CLASS_TOKENS) {
      expect(designJsx, `class token「${cls}」在 design 原稿上找不到 ⇒ 打錯或已改名`).toMatch(
        TOKEN_RULER(cls),
      );
    }
    for (const label of LABEL_TOKENS) {
      expect(
        designJsx,
        `「${label}」在 design 原稿上不是一個獨立的文字節點 ⇒ 打錯或已改字`,
      ).toMatch(LABEL_RULER(label));
    }

    // 🔴 **把 snapshot 繫回活的稿** —— 這一格關掉兩個洞, 而兩個都是審查點名的:
    //   ① fixture 宣稱「機械抄」, 而**沒有任何一行碼在驗它**
    //      ⇒ 有人手打一行含那三個字面的東西進去, A 會綠、B 也會綠(token 確實在活稿上)
    //   ② fixture 檔頭記的 design commit sha **沒有任何一行碼讀它** ⇒ 純裝飾
    //      ⇒ submodule 指標被 bump 之後, snapshot 靜靜過期,
    //        而**過期的那個世界正好是 A 唯一生效的世界**(CI / 沙箱, 那裡沒有活稿可比)
    // ⚠️ 而它只在【有稿】的地方跑 ⇒ **繫繩本身也是 skipIf 的。** 這是這個設計的天花板:
    //    沒有稿的地方, 我們只能相信 snapshot 是對的, 而**沒有辦法當場證明**。
    for (const line of contractBody(readFileSync(DESIGN_CONTRACT_FIXTURE, 'utf8')).split('\n')) {
      const trimmed = line.trim();
      // 🔴 審查 F7:只跳空行不夠 —— fixture 日後重抄若帶進 `  }` 這種短行, 那一行對任何 JSX 恆真。
      //    ⇒ 下限:**這一行要含至少一個被守的字面**。含了就不可能對任意 JSX 恆真。
      // ⚠️ 我第一版還加了「長度 >= 8」, 而它**當場把 `            立即儲值` 判紅** ——
      //    那一行 trim 完只有 4 個字元, 因為 **CJK 一個字就是一個 char**。
      //    📌 **一個用字元數表達的「夠長」, 對中文與對英文不是同一個門檻。**
      //    ⇒ 拿掉長度那一半:它想擋的是「不含任何字面的短行」, 而那件事 `guarded` 自己就答完了。
      if (trimmed === '') continue;
      expect(
        ALL_OMITTED.some((t) => line.includes(t)),
        `契約 snapshot 有一行不含任何被守的字面 ⇒ 它對任何原稿都恆真, 不得留在 body 裡:\n${line}`,
      ).toBe(true);
      expect(
        designJsx,
        `契約 snapshot 有一行在活的 design 原稿上逐字找不到 ⇒ snapshot 過期或被手改:\n${line}`,
      ).toContain(line);
    }
    },
  );

  it('沒有「立即儲值」鈕、沒有等級卡、沒有每列的「當時餘額」', () => {
    const { container } = render(
      <WalletTab balance={27600} entries={[entry(), entry({ id: 'b', amount: -2400, entryType: 'use' })]} />,
    );

    // 🔴 **分母守門(2026-08-29 突變量到本格恆綠)**:整支 WalletTab 空渲染時
    //    下面五條(queryByText 為 null / querySelector 為 null / textContent 不含)**全部恆真**
    //    ⇒「這三樣刻意沒放」與「整個錢包頁沒渲染」印同一個綠。
    //    🔴 而這一格守的是**錢**:假了 = 一顆不會動的儲值鈕出現在客人面前,
    //      或每一列印出錯的「當時餘額」(Q3=乙 刻意不放的那一欄)。
    //    ⚠️ 錨【不能】釘「有沒有節點」—— 突變體自己 `return <div>` 就是一個節點(同夜實測踩過)。
    //      ⇒ 釘【只有真的 WalletTab 才會產生的兩個結構】, 而且兩個都釘。
    //
    // 🔴 **這三樣東西的家, 逐一對過 design(2026-08-29 code-reviewer R1 訂正我原本寫錯的兩句)**:
    //    儲值鈕    `design-reference/components/WalletTab.jsx:50-59` ⇒ 住在 `.wal-balance-r`(餘額卡【內】)
    //    等級卡    同檔 `:64` 的 `.wal-tier-card` ⇒ **是餘額卡的【兄弟】, 直接掛在 `.wal-tab` 根底下**
    //    當時餘額  同檔 `:108` 的 `.wal-tx-bal` ⇒ 住在 `:104` 的 `.wal-tx-r`, **不是 `.wal-tx-l`**
    //    ⚠️ 我第一版把前兩個都寫成「餘額卡的所在地」、第三個寫成 `.wal-tx-l` —— **兩句都錯**。
    //      斷言當時仍非恆真(錨到餘額卡 = 證明根渲染了, 等級卡那條是【傳遞來的】非直接),
    //      🔴 **而錯的是那句話** ⇒ 下一個要加第三個錨的人會照它去找錯地方。
    //    ⇒ 第二個錨同時升級成 `.wal-tx-r`(洩漏面本身, 同成本、順帶罩住 `.wal-tx-amt`)。
    //      📌 原本釘 `.wal-tx-l` 的失敗情境:`.wal-tx-r` 整塊消失時 `.wal-tx-l` 仍 = 2 ⇒ 那一條又恆真。
    expect(container.querySelectorAll('.wal-balance-card').length, '餘額卡沒渲染 ⇒ 下面關於鈕與等級卡的斷言恆真').toBe(1);
    expect(container.querySelectorAll('.wal-tx-r').length, '交易列的右半沒渲染 ⇒ 下面關於「當時餘額」的斷言恆真').toBe(2);
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
