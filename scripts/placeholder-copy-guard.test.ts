import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// placeholder-copy-guard.test.ts — **佔位文案不得上線**(板子 `docs/launch-todo.md` 錨
// `佔位文案沒有任何東西擋它上線`;來源 = 線E `-77` 2026-08-28 提報,`-c8` 代開,線F 2026-08-29 裝)。
//
// ── 🔴 這支檔在補的那個洞,逐字抄板子那一列 ──────────────────────────────
//   「`TODO-E2` 這個標記擋的是【被 commit 進去沒人發現】,擋不住【被發現得太晚】——
//     **現在沒有任何東西會在上線前因為它紅**:三綠不掃字面、沒有測試斷言它、CI 也沒有。
//     ⇒ 它會直接印在客人眼前,而防護只有「有人記得」。」
//   📏 線F 2026-08-29 14:0x 當場複量那三句:測試檔 **0** 支 · `scripts/` **0** 支 · CI **0** 支
//      ⇒ 「沒有任何東西」是真的。本檔就是那個「任何東西」。
//
// ── 🔴 為什麼是【現在的形狀】而不是線E 當時說的那個 ──────────────────────
//   線E 明說它不自己裝,理由(板上原句)是:
//     **「一個沒有人維護的守門,比沒有守門更糟 —— 它會讓下一個人以為那件事有人在管。」**
//   ⇒ 所以本檔**住在既有的測試套件裡**(vitest `node` project,`vitest.config.ts` 的
//     include `{packages,apps,scripts}/**/*.{test,spec}.{ts,tsx}`),而 CI 的 `pnpm test` 已經在跑它。
//   🔴 **不新開任何需要有人記得去跑的東西** —— 那一課是 2026-08-29 在板子 ⑲ 上量到的:
//      那條裁決要把一個掃描併進「每晚已經在跑的那支掃描器」,而**那支掃描器不會自己跑**
//      (CI 0 · crontab 0 · husky 0 · launchd 0/15,而正對照 `pcm` ⇒ 13 ⇒ 讀得到)。
//      📌 **沒有宿主的守門,等於沒有守門。**
//
// ── ⚠️ 它守不到什麼(照實寫,不要讀得比它大)──────────────────────────────
//   · **它只認字面 `TODO-`** ⇒ **不帶這個標記的佔位文案,它一個都看不到。**
//     ⇒ 板子那一列自己就寫過同一句:那個數是**下界不是總數**。
//   · **它不判斷那個字面在不在「會被客人看到」的路徑上** —— 它只答「有沒有」。
//   · 字面組裝(`'TODO' + '-X'`)掃不到。
//
// ── 🔴 為什麼【連註解裡也不准】(這是刻意的,不是懶) ──────────────────────
//   剝註解要一個認得字串的詞法器(同 repo `storefront-tier-cookie-surface-guard.test.ts`
//   有一支,而它是被 codex R5 must-fix 3 打出來的:字串裡的 `//` 曾經吃掉後面的真程式)。
//   本檔**不複製那支**,也不去改它 —— 而是把規則收緊成一句好記的:
//     🔴 **`TODO-` 是【佔位文案專用】的保留字, 會讓 build 紅。一般待辦請寫 `TODO:`。**
//   📏 而這個收緊今天**零成本**(線F 2026-08-29 當場量):
//      `TODO-` 全樹 ⇒ **0** · 而 `TODO`(不帶 dash)⇒ **27** ⇒ **一般待辦沒有在用這個形狀。**
//   ⚠️ 代價明寫:哪天有人**想**在註解裡寫 `TODO-123`,本檔會紅 ——
//      **那時候要改的是這條規則(或那個人的寫法), 不是把本檔關掉。**
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
/** 掃描根 = 會出貨的原始碼。⚠️ `scripts/` 不在裡面(它不出貨,而本檔自己住在那裡)。 */
const SCAN_ROOTS = ['apps', 'packages'];
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
/**
 * 🔴 **這個常數本身【不能】寫成完整字面** —— 否則本檔一被掃到就是自紅。
 * 而本檔住在 `scripts/`(不在 `SCAN_ROOTS` 裡)已經擋了一層;這裡再擋一層,
 * 是為了**哪天有人把本檔搬進 `apps/` 也不會自己咬自己**。
 * 📌 母題:**一個掃字面的守門,最先撞到的就是它自己。**(2026-08-29 線F 當天踩過兩次同族)
 */
const MARK = `TODO${'-'}`;

function listFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.next' || e === '.turbo') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(listFiles(p));
    // 測試檔排除:守門的訊息與歷史留痕會自己命中。
    else if (EXTS.some((x) => p.endsWith(x)) && !/\.(test|spec)\.[jt]sx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => listFiles(join(REPO_ROOT, r)));
const hits = files.filter((f) => readFileSync(f, 'utf8').includes(MARK));

describe('佔位文案不得上線(板子:佔位文案沒有任何東西擋它上線)', () => {
  it('🔴 前提:掃描分母不是空的(空 = 本守門瞎了,不是通過)', () => {
    // 分母塌掉時,下面那格會因為「沒東西可掃」而恆真 —— 那是這一族最常見的假綠。
    expect(files.length, '掃不到任何出貨原始碼 ⇒ 路徑或忽略規則壞了').toBeGreaterThan(300);
  });

  it(`出貨原始碼零 \`${MARK}\` 佔位標記`, () => {
    expect(
      hits.map((f) => f.replace(`${REPO_ROOT}/`, '')),
      `🔴 有佔位文案要上線了。\n` +
        `   \`${MARK}\` 是【佔位文案專用】的保留標記 —— 它會直接印在客人眼前。\n` +
        '   ⇒ 換成定稿文案再 commit;若這是一般待辦,請改寫成 `TODO:`(不帶 dash)。',
    ).toEqual([]);
  });

  it('🔴 正對照:掃描器真的找得到東西(否則上一格是恆綠的)', () => {
    // 拿一個一定存在的字面掃同一批檔 —— 找不到就是讀檔或路徑壞了,不是「很乾淨」。
    const probe = files.filter((f) => readFileSync(f, 'utf8').includes('export'));
    expect(probe.length, '連 `export` 都掃不到 ⇒ 掃描器本身壞了').toBeGreaterThan(100);
  });

  it('🔴 負對照:現造一個不存在的標記 ⇒ 必須零命中(否則它對什麼都說有)', () => {
    const never = `TODO${'-'}NEVER-${Date.now()}`;
    const bogus = files.filter((f) => readFileSync(f, 'utf8').includes(never));
    expect(bogus).toEqual([]);
  });

  it('🔴 本檔不得咬到自己:repo 根的 `scripts/` 不在掃描根裡', () => {
    // 母題:一個掃字面的守門,最先撞到的就是它自己。
    expect(SCAN_ROOTS).not.toContain('scripts');
    // 🔴 **我第一版寫成 `f.includes('/scripts/')` ⇒ 這一格【當場紅了】,而它紅得對**:
    //    `apps/storefront/scripts/` 與 `packages/adapters/scripts/` 是【巢狀】的 scripts 目錄,
    //    它們在 `apps`/`packages` 底下 ⇒ **本來就該掃**。
    //    ⇒ 要排除的是【repo 根那一個】,不是路徑裡任何一段叫 scripts 的。
    //    📌 兩者在字串上長得一樣,而只有其中一個是「本檔的家」。
    expect(files.some((f) => f.startsWith(`${REPO_ROOT}/scripts/`))).toBe(false);
  });

  // 🔴 **本檔的分母在【本機】與【CI】不一樣, 而那差額今天是 4 支**(線F 2026-08-29 當場量):
  //    本機 769 支, 其中未追蹤 4 支(`next-env.d.ts` ×2 / `test-results/…` / `adapters/scripts/spikes/…mjs`)
  //    ⇒ 乾淨 checkout 會少那 4 支。**門檻設 300 是為了讓兩邊都過, 不是抓一個精確數。**
  //    ⚠️ 這一格是抄同 repo `storefront-tier-cookie-surface-guard.test.ts` 的教訓 ——
  //    那支曾經把「差集不是空的」建立在一支**沒進版控的實驗檔**上 ⇒ **本機永遠綠、CI 永遠紅**。
  //    📌 **一個分母如果含未追蹤檔, 它在兩個世界是兩個數。**
  it('🔴 分母不得依賴未追蹤檔:門檻要低到乾淨 checkout 也過得了', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('🔴 判別力:餵它一段含標記的原始碼,判定函式必須說「有」', () => {
    // 這一格釘的是【判定那一步】,不是磁碟上的現況 ——
    // 現況是 0 命中,而「0 命中」與「判定永遠回 false」在上面那格印同一個綠。
    const withMark = `export const COPY = '${MARK}E2 尚未定稿';`;
    const without = `export const COPY = '品牌商品狀態讀取失敗';`;
    expect(withMark.includes(MARK), '含標記的字串沒被判成命中').toBe(true);
    expect(without.includes(MARK), '不含標記的字串被誤判成命中').toBe(false);
  });
});
