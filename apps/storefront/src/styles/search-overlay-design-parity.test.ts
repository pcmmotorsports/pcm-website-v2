// search-overlay-design-parity.test.ts — 「本站的疊層樣式與設計稿的差異,恰好是那幾處刻意的」。
//
// 🔴 **這支存在的理由不是為了比對本身,是因為【寫成散文的判準壞了四次而沒有東西會叫】**:
//    ① `head -n -10` 在 macOS(BSD head)跑不起來 ⇒ 印 208
//    ② 改用行數算 ⇒ 算錯一行 ⇒ 印 25
//    ③ 改用錨點切 ⇒ 對了一次,而下一次改註解就又壞(註解被算進差異)
//    ④ 改成「剝註解再比」並把那段 python 寫進 CSS 註解
//       ⇒ 那段 python 含一個【星號接斜線】⇒ **把那個 CSS 註解提前關掉**
//       ⇒ 十行散文變成真的 CSS。⑤ 而我寫那段【更正】時,又原樣引用了那兩個字元一次。
//    📌 **四次都印出一個像樣的數字或安靜地壞掉 —— 因為散文不會跑。**
//    ⇒ 判準搬到這裡,它每次 CI 都跑。
//
// ⚠️ **它證不到什麼**:文字層比對 —— 看不到 cascade 勝負、看不到真實渲染。
//    「搬對」與「長得對」是兩件事,後者只有人眼看得到。

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

/** 剝掉註解與本站新增的鎖規則,只留可比對的樣式本體。 */
function normalize(path: string): string[] {
  const raw = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/body\[data-pcm-search-lock\][^}]*\}/g, '');
  return raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
}

const MINE = () => normalize(resolve(HERE, 'search-overlay.css'));
const DESIGN_PATH = resolve(REPO, 'design-reference/styles/search-overlay.css');
const DESIGN = () => normalize(DESIGN_PATH);

/**
 * 🔴🔴 **`design-reference` 是 git submodule, 而 CI 【不 checkout 它】** ——
 * `.github/workflows/ci.yml` 逐字有 `submodules: false`。
 *
 * ⇒ 📌 **本檔在 CI 裡【結構上不可能通過】** —— 它不是壞了, 是它要讀的東西從來沒有被 checkout。
 *   實錘:`gh run 33677207412` 逐字 `ENOENT: no such file or directory, open
 *   '/home/runner/work/pcm-website-v2/pcm-website-v2/design-reference/styles/search-overlay.css'`
 *   ⇒ **4 格全紅, 含它自己的負對照。**
 *
 * ══ 🛑🛑 **那個 `submodules: false` 是【有理由的】, 而理由不在 git 歷史裡** ══════════
 *
 * ⛔ **我 2026-09-03 第一版在這裡寫過 ~~「commit body 一個字都沒提 ⇒ 理由沒有被記下來」~~
 *    ~~「『SSH 沒鑰匙所以刻意關掉』是推的, 我沒有量到任何支持它的證據」~~ —— 那兩句都是【假的】。**
 *    🔴 **我的尺沒壞, 分母錯了**:我問的是「**那顆 commit 的 body** 有沒有寫」
 *      (實測 `39b6ccdc` 的 body 逐字零提 submodule / SSH —— 那一格是真的),
 *      而我把結論寫成「**理由沒有被記下來**」。⇒ 理由住在一份 spec 裡, 不住在那顆 commit body 裡。
 *      ⚠️ **而我第二版寫「理由不在 git 歷史裡」也還是錯的** —— 那份 spec **本身就在 git 裡**
 *      (`git log --oneline --all -- docs/specs/2026-08-27-945-submodule-in-sandbox-and-ci-plan.md` ⇒ 6 顆)。
 *      📌 **同一個缺席句我連錯兩次, 而第二次是把它降一級不是修掉它。**
 *
 * ✅ **正本**:`docs/specs/2026-08-27-945-submodule-in-sandbox-and-ci-plan.md`
 *    (定位用 grep 不用行號 —— 見下面那條 repo 明文)
 *    · `grep -n '不具公開讀取權' <該檔>` ⇒ §0-a:**帶正負對照的量測** ——
 *      不帶憑證打該 design repo 的 GitHub API ⇒ **404**;🟢 正對照 `actions/checkout` ⇒ **200**
 *      (證明我通得到 GitHub);🔵 負對照 現造 repo 名 ⇒ **404**
 *      ⇒ 🛑 **單看 404 分不出「私有」與「不存在」** ⇒ 該 spec 因此只寫「**不具公開讀取權**」。
 *    · `grep -n 'ssh-key' <該檔>` ⇒ §0-b:**親讀官方 README 的逐字引用** ——
 *      私有 repo 要自帶憑證, 且**沒有 `ssh-key` 時 `git@github.com:` 會被改寫成 HTTPS**。
 *
 * 🛑🛑 **⇒ 不要把 `ci.yml` 那一行翻成 `true`。** 該 spec 那一句**逐字**是:
 *    「在那把鑰匙就位之前,`§3` 的第 ② 步(改 `ci.yml`)不可以動 —— 先改就是把 CI 弄紅,
 *      而紅的是**每一個人的每一個 PR**,不只是我這片。」
 *    (定位 `grep -n '在那把鑰匙就位之前' <該 spec>`。⚠️ 我第一版標了「逐字」而引的不是原字串,
 *     ⇒ 拿我那句去 grep 會零命中, 而去驗的人會以為我在編。)
 *
 * 🔵 **而「CI 要不要拿到設計稿」這一題【已經存在】, 有 ID:`Q-945-1`**(在同一份 spec 裡)。
 *    ⚠️ 我第一版在這裡把它的甲/乙選項**重述了一次** —— 那會變成同一題兩套框架並存,
 *    Sean 答了其中一份、另一份仍寫著待決, **而沒有東西會叫**。⇒ 這裡只指路, 不重述選項。
 *
 * ══ ✅ **本檔的處置:沒有稿的地方 `skipIf` 而不是硬紅** ═══════════════════════════
 *
 * 形狀抄 `apps/storefront/src/components/account/tabs/WalletTab.test.tsx`
 * (定位:`grep -n 'it.skipIf(!HAS_DESIGN_SUBMODULE)' <該檔>` —— **不寫行號**,
 *  理由是 `.github/workflows/ci.yml` 自己的明文:`grep -n '用 grep 定位不用行號' .github/workflows/ci.yml`
 *  逐字「**一個指向別人檔案的行號, 會被【我這邊的編輯】弄假 —— 而兩邊都不會有東西紅**」。
 *  ⚠️ 而我第一版正是寫了行號, 並且**被我自己在同一筆 diff 裡加的 12 行弄假**。)
 *
 * 🛑 **而我只搬了那個先例的【一半】, 這一句要明寫**:
 *   先例是兩半 —— (A) 一份 `wallet-design-contract.fixture.txt`(**機械抄自稿、commit 進 repo,
 *   在每一台機器 / 沙箱 / CI 上都存在**)撐住反恆真那一格 + (B) 漂移格 `skipIf`。
 *   **本檔只做了 (B), 沒有做 (A)。**
 *   ⇒ 📌 **代價**:CI 上**沒有任何一格在比對本站 CSS 與稿** ——
 *     有人把 `search-overlay.css` 改離稿, **CI 不會紅**, 只有本機與 pre-commit 會。
 *   ⇒ **為什麼今天不做 (A)**:本檔比的是**整份 196 行逐行 diff**, 不是三個字面 ——
 *     fixture 要抄整份稿進 repo, 那是把 submodule 的內容複製一份, 屬於 `Q-945-1` 的
 *     另一個選項而不是本片的範圍。**這是取捨, 不是疏漏。**
 *
 * 🔵 **而 skip 有一個已知毒性 —— 它把【會叫的錯】換成【不會叫的錯】** ⇒ 兩件事實測過:
 *   ① 沒有稿時:`Tests 1 passed | 4 skipped (5)` ⇒ **skip 出現在摘要, 不是靜靜地綠**
 *   ② 有稿時仍會紅:把本站一處**非刻意**的宣告值改掉(`position: fixed` ⇒ `absolute`)
 *      ⇒ **1 failed / 4 passed**
 *   ⚠️ **而我第一發突變【沒落在目標上】, 照實留**:我先改 `z-index` 的**值** ⇒ **全過** ——
 *      因為那一格只數 z-index 差異的**條數**、不看值。📌 **突變全綠的第三種原因:它根本沒打中。**
 *
 * ⚠️ **下面那格「本站那份讀得到」的【邊際訊號 ≈ 0】, 不要把它讀成 CI 上的防線**:
 *   同目錄 `search-overlay-layer.test.ts`(`grep -n '.search-overlay' <該檔>`)**本來就在 CI 跑**,
 *   而且斷言更強 ⇒ `search-overlay.css` 讀不到或被清空時, **那一支已經會紅**。
 *   ⇒ 留著它的唯一理由是:讓本檔在 CI 上**不是整支零訊號**(摘要看得到 1 passed | 4 skipped)。
 *
 * 🔵 **代價的分母(2026-09-03 量)**:**只有 2 支**測試在 runtime 真的讀 `design-reference`
 *   —— 本檔與 `WalletTab.test.tsx`。
 *   **數法(帶範圍與對照)**:`grep -rln design-reference apps/<app>/src packages/<pkg>/src --include=<test glob>` ⇒ **9 支**
 *   (🔴 這裡刻意**不寫真正的 glob 字面** —— 那個字面含【星號接斜線】, 會把這個區塊註解提前關掉;
 *    本檔檔頭第 ④ 條記的就是這個坑, 而我 2026-09-03 在同一支檔裡又踩了一次。真字面見 commit body);🟢 正對照 同一把尺打 `search-overlay`
 *   ⇒ 非 0(尺會動);🔵 負對照 打一個現造字串 ⇒ 0。
 *   ⇒ **而 9 支逐支開檔後, 真的在 runtime 讀的只有 2 支**;其餘 7 支是註解 / 測試名字裡的字串 /
 *   把它**排除**在目錄走訪之外(`cron-jobs.test.ts` 的 `grep -n "design-reference" <該檔>`)
 *   ⇒ 📌 **9 是「提到」不是「讀」。**
 *   ⚠️ **而「2 支」的射程要跟著它走**:上面那個數法只涵蓋 `src/` 底下的 `.test.*` ——
 *     **漏掉 `scripts/`、`*.spec.*`、非 `src/` 的**(vitest 的 node project include 逐字含 `scripts`)。
 *     ✅ R2 複審把漏掉的那 51 支掃完 ⇒ `design-reference` 命中 **0**(正對照:51 支全含 `expect`)
 *     ⇒ **結論成立, 而它不是我原本那個數法涵蓋到的。**
 */
const HAS_DESIGN = existsSync(DESIGN_PATH);

/** 兩份的逐行差異(只要行內容不同就算,不做 LCS —— 兩份是同源、行序一致)。 */
function diffLines(): { mine: string; design: string }[] {
  const a = MINE();
  const b = DESIGN();
  expect(a.length, '兩份的行數不同 ⇒ 有人新增或刪掉了整條規則,不只是改值').toBe(b.length);
  const out: { mine: string; design: string }[] = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) out.push({ mine: a[i]!, design: b[i]! });
  return out;
}

/** 三處【刻意】的差異:token 名(10 處)、z-index(1 處)。鎖規則已在 normalize 剝掉。 */
const INTENTIONAL = /--f-sans|--f-mono|--font-sans|--font-mono|z-index/;

describe('search-overlay.css 與設計稿的差異', () => {
  // 🟢 **這一格【永遠跑】, 不 skipIf** —— 它不需要稿。
  //    留著它, 是為了讓 CI 上這支檔【不是整支零訊號】:本站那份讀不到 / 被清空時, CI 仍然會紅。
  it('🔵 前提 — 本站那份讀得到而且不是空的(這一格不需要設計稿)', () => {
    expect(MINE().length, '本站的 search-overlay.css 讀不到或是空的 ⇒ 下面每一格都零判別力').toBeGreaterThan(100);
  });

  it.skipIf(!HAS_DESIGN)('🔵 前提(有稿才跑)— 設計稿讀得到而且不是空的', () => {
    // 🧬 突變:把 DESIGN_PATH 指到一個現造檔名 ⇒ 有稿的機器上這一格會 skip(不是紅)——
    //    ⚠️ 那正是 skip 的毒性, 所以它不是本檔的證據;證據是下面三格在【有稿時】會紅。
    expect(DESIGN().length, '設計稿讀不到或是空的 ⇒ 下面每一格都零判別力').toBeGreaterThan(100);
  });

  it.skipIf(!HAS_DESIGN)('🔴 每一處差異都必須是【刻意的那三種】之一(有稿才跑)', () => {
    const unexpected = diffLines().filter((d) => !INTENTIONAL.test(d.mine));
    expect(
      unexpected.map((d) => `本站「${d.mine.trim()}」 vs 稿「${d.design.trim()}」`),
      '出現了預期外的差異 ⇒ 要嘛是不小心改到稿的樣式,要嘛是又多了一處刻意偏離而沒記錄',
    ).toEqual([]);
  });

  it.skipIf(!HAS_DESIGN)('🔴 那三種【每一種都要真的還在】(有稿才跑)', () => {
    const diffs = diffLines();
    // 🔵 少了這一格,把本檔改成與稿逐字相同(= 把 token 名與 z-index 的修法退掉)
    //    上一格會【全過】,而那正是兩個真缺陷回來的那一刻。
    expect(diffs.filter((d) => /--f-sans|--f-mono/.test(d.mine)).length, 'token 名的修法不見了').toBe(10);
    expect(diffs.filter((d) => /z-index/.test(d.mine)).length, 'z-index 的修法不見了').toBe(1);
  });

  it.skipIf(!HAS_DESIGN)('🔵 負對照(有稿才跑)— 現造一個字串當「刻意差異」的樣式,必須撈不到任何一行', () => {
    expect(diffLines().filter((d) => /zzz-not-a-real-token/.test(d.mine))).toEqual([]);
  });
});
