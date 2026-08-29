import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * layout-font-link.test.tsx —— **後台與顧客站的字型 `<link>` 不得分歧**(`Q-FONT2`,2026-08-29)。
 *
 * ══ 它在守什麼 ══════════════════════════════════════════════════════════
 * Sean 2026-08-29 逐字答「**甲 後台接上顧客站已經在用的那條**」。
 * ⚠️ **他重答過** —— 原答是「把字型檔放進來」(= 那次的乙)。引用時不要只引後面那次。
 * ⇒ 「接上**同一條**」這件事,今天是靠**人記得照抄**維持的 ⇒ 而那不是機制。
 * ⇒ **本格讓它變成機制**:兩邊的 Google Fonts URL 逐字不同 ⇒ 紅。
 *
 * ══ 🔴 為什麼它值得一道守門(而不是「照抄一次就好」)═══════════════════════
 * 這件事的失敗形狀是**安靜的**:
 * ```
 * admin 的 --font-sans（globals.css:244-246）第 6 順位是 'Noto Sans TC'
 * 而列印那支的【第一順位】就是它（app/print/print-a4.css:244）
 * ⇒ 沒載入時，macOS 落到 'PingFang TC' ⇒ **畫面完全正常**
 * ⇒ 而 Vercel 是 Linux 容器 ⇒ 那一格是豆腐字
 * 📌 **本機驗證、三綠、截圖對這一格【零判別力】。**
 * ```
 * ⇒ 所以哪天有人動了其中一邊的 URL(加一個 family、改 `display=swap`…),
 *   **另一邊不會有任何症狀,直到有人在 Linux 上開那一頁。**
 *
 * ══ ⚠️ 這道守門【不能】證明什麼(射程,寫出來免得被讀大)═════════════════════
 * ```
 * · 它證的是【兩邊的字面一致】——**不證明那條 URL 真的載得到字型**
 * · 它不證明【列印路徑】吃得到（那要真瀏覽器 + 列印預覽，見下方「還沒做的驗收」）
 * · 它不證明【線上】長什麼樣 —— 線I 逐字：「一發證明了『本機看起來好』、
 *   另一發證明了『我們沒帶字型』，而【線上長什麼樣】是第三個世界，目前無人證明」
 * ```
 */

const ROOT = resolve(__dirname, '../../../..');
const ADMIN_LAYOUT = resolve(ROOT, 'apps/admin/src/app/layout.tsx');
const STOREFRONT_LAYOUT = resolve(ROOT, 'apps/storefront/src/app/layout.tsx');

/**
 * 抓那支 layout 裡【沒有被註解掉的】Google Fonts stylesheet URL(抓不到就回 null)。
 *
 * 🔴 **這個限定是 R2 逼我改的, 而它是我今天第四次犯同一個病**:
 *    ~~原本寫「真的會被渲染的」~~ —— **那比機制寬**。它只剝【註解】,
 *    而 `{false && (<head>…</head>)}` 這種【沒被註解、也不會被渲染】的形狀
 *    仍然抓得到 URL ⇒ **假綠**(R2 實測)。
 * 📌 **⇒ 一個寫大的射程宣告, 在所有自動量具底下全綠** —— 而下一個人照那個宣告去用它。
 *    (構造性極低 ⇒ 不修機制, 而**把話改成真的**。)
 *
 * 🔴 **codex/code-reviewer 2026-08-29 must-fix:第一版對【整支檔案字串】跑 regex** ——
 *    把整塊 `<head>` 用 `{/* … *\/}` 註解掉之後,那條 URL 的**字面仍然在檔案裡**
 *    ⇒ 兩邊逐字相同、`Noto+Sans+TC` 仍在 ⇒ **四格全綠, 而 admin 一條字型都沒載。**
 *    (審查逐字:`mutant still matches (green?): True`)
 * 📌 **⇒ 那不是射程外 —— 本格自稱「分歧就紅」, 而【被註解掉】正是一種分歧。**
 *
 * ⇒ 修法兩步, 順序不可換:
 *   ① 先剝掉 JSX 註解 `{/* … *\/}` 與 `//` 行 —— **註解掉的東西不會被渲染**
 *   ② 再切出 `<head>…</head>` 那一塊, 只在那裡面找
 *   ⇒ 註解掉 ⇒ 切不出來 ⇒ null ⇒ **紅**
 */
function fontCssUrl(file: string): string | null {
  const raw = readFileSync(file, 'utf8');
  const live = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  const head = /<head>([\s\S]*?)<\/head>/.exec(live);
  if (head === null) return null;
  const m = /href=['"](https:\/\/fonts\.googleapis\.com\/css2[^'"]*)['"]/.exec(head[1] ?? '');
  return m?.[1] ?? null;
}

/** 那兩顆 `preconnect` 也要在分母裡(reviewer nit:掉了不會紅, 而症狀只是「慢」)。 */
function preconnectHosts(file: string): string[] {
  const raw = readFileSync(file, 'utf8');
  const live = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  const head = /<head>([\s\S]*?)<\/head>/.exec(live);
  // 🔴 R2 nit:~~`rel=preconnect[\s\S]*?href=`~~ **跨得過元素邊界** —— 把屬性順序寫成
  //   `<link href='…' rel='preconnect' />` ⇒ `rel` 會去配【下一個元素】的 href。
  //   (它的失效方向是**假紅**, 不擋事;而收窄它幾乎零成本 ⇒ 收。)
  //   ⇒ 改成先切出**單一** `<link …/>`, 再在那一顆裡面同時要求 rel 與 href。
  return [...(head?.[1] ?? '').matchAll(/<link\b[^>]*\/>/g)]
    .map((x) => x[0])
    .filter((tag) => /rel=['"]preconnect['"]/.test(tag))
    .map((tag) => /href=['"]([^'"]+)['"]/.exec(tag)?.[1] ?? '')
    .sort();
}

describe('Q-FONT2 · 後台與顧客站的字型 link', () => {
  it('前提:顧客站那一條抓得到(抓不到 = 尺沒接上,不是沒問題)', () => {
    expect(
      fontCssUrl(STOREFRONT_LAYOUT),
      '在 storefront layout 裡找不到 `fonts.googleapis.com/css2` 的 href ⇒ **這把尺沒接上**' +
        '(它改用 next/font 了?搬檔了?)。先修尺,不要相信下面那一格。',
    ).not.toBeNull();
  });

  it('🔴 後台那一條與顧客站【逐字相同】—— 分歧了就紅', () => {
    expect(
      fontCssUrl(ADMIN_LAYOUT),
      [
        '🔴 後台與顧客站的字型 `<link>` 不一樣了。',
        '',
        '**這一格不是在說「字串不對」——它是在說【兩邊會長出不同的字型】。**',
        '',
        '而它的症狀是安靜的：`--font-sans` 與 `print-a4.css` 的 `--pd-body` 都寫著',
        "'Noto Sans TC'，而在 macOS 上落到 'PingFang TC' ⇒ **畫面看起來完全正常**。",
        '只有 Linux 容器（Vercel）上那一格是豆腐字。',
        '',
        '⇒ 若你是【刻意】要讓兩邊不同：把理由寫在這裡，並改掉本格的比對方式，',
        '  不要只把期望值更新掉。',
        '參考：`Q-FONT2`（Sean 2026-08-29 答「甲 後台接上顧客站已經在用的那條」）',
      ].join('\n'),
    ).toBe(fontCssUrl(STOREFRONT_LAYOUT));
  });

  it('🔴 而那條 URL 真的含 Noto Sans TC(否則接上了也沒有中文)', () => {
    const url = fontCssUrl(ADMIN_LAYOUT) ?? '';
    expect(
      url.includes('Noto+Sans+TC'),
      '那條 URL 裡沒有 `Noto+Sans+TC` ⇒ **接上了一條不含中文字型的樣式表** ——' +
        '而它會安靜地什麼都不改變。',
    ).toBe(true);
  });

  it('🔴 兩顆 preconnect 也要在分母裡(reviewer nit:掉了不會紅, 而症狀只是【慢】)', () => {
    expect(
      preconnectHosts(ADMIN_LAYOUT),
      '後台的 `preconnect` 與顧客站不一樣 ⇒ 掉了不會有任何錯誤, **只會慢** ——' +
        '而「慢」不會有人回報。',
    ).toEqual(preconnectHosts(STOREFRONT_LAYOUT));
    // 正對照:它真的抓得到東西(空陣列對空陣列也會過 ⇒ 那個相等是恆真)
    expect(
      preconnectHosts(STOREFRONT_LAYOUT).length,
      '顧客站抓不到任何 preconnect ⇒ 上面那個相等是【兩個空陣列】⇒ 恆真, 零判別力。',
    ).toBeGreaterThan(0);
  });

  it('🔴 負對照:一條【不含】Noto Sans TC 的 URL 必須被上面那格擋下', () => {
    // 這一格證明上面那個 includes 不是恆真 —— 它餵一個現造的 URL。
    const fake = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
    expect(fake.includes('Noto+Sans+TC'), '負對照本身壞了 ⇒ 上面那格的綠沒有意義。').toBe(false);
  });
});

/**
 * ══ 🛑 還沒做的驗收(明寫,不要把本檔的綠讀成「這件事驗完了」)══════════════
 * ```
 * 本檔只證【字面一致】。而真正要量的兩個值，需要真瀏覽器 + 列印預覽狀態：
 *   ① Network 面板有沒有 fonts.gstatic.com 的 woff2 請求
 *   ② Computed 面板的 font-family 解析到誰
 * 🔴 而【不能用本機截圖驗】—— 線A 實測：macOS 拿掉 mac 字型之後，
 *    畫面【仍然是完好中文】⇒ 截圖在這件事上零判別力
 * ⇒ 器材：`bash scripts/admin-probe/up.sh`（它的 REPO 從腳本自己的位置推 ⇒ worktree 可跑）
 * ⇒ 而要在【列印預覽】那個狀態下量，不是一般畫面
 * ```
 * 📌 **⇒ 這一格是【已知未做】,不是【做完了】。**
 */
