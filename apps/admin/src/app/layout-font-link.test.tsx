import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * layout-font-link.test.tsx —— **後台的字型 `<link>` 要完整;顧客站已改 next/font(刻意分歧)**。
 *
 * ══ 沿革 ══════════════════════════════════════════════════════════════════
 * ⛔ ~~`Q-FONT2`(2026-08-29):後台與顧客站的字型 `<link>` 逐字相同,分歧就紅~~
 *    Sean 2026-08-29 逐字答「**甲 後台接上顧客站已經在用的那條**」(他重答過,原答是「把字型檔放進來」)。
 * 🔴 **2026-09-15 Sean Q5 甲 推翻 link**(顧客站那一側):顧客站拿掉 Google Fonts `<link>`,
 *    英文字改 `next/font`、中文改裝置內建字(首頁輪播大標另載 Noto Sans TC 700,Sean 乙)。
 *    plan = `docs/plans/2026-09-15-storefront-mobile-lcp-plan.md` §3。
 *
 * ══ 為什麼後台【不跟著】改(設計窗 2026-09-16 決定,主視窗推薦過「跟著改」)════════════
 * ```
 * · 後台的列印紙靠 Noto Sans TC:`app/print/print-a4.css` 的 --pd-body 前兩順位
 *   'Noto Sans' → 'Noto Sans TC',同檔 22 條 font-weight:700
 *   ⇒ 顧客站那組 next/font【刻意沒有】Noto Sans TC 內文 ⇒ 「同一組設定」會改掉列印紙的字
 * · 後台 layout 自己寫過不用 next/font 的理由:它把字型綁在被 import 那一層的 class 上
 *   ⇒ 「接上了而列印時仍然沒生效」的形狀(`app/layout.tsx` 那段註解)
 * · 顧客站改的理由是【客人手機的載入速度】;後台是員工工具,這個理由不成立
 * ```
 * ⇒ **兩邊分歧是刻意的。** 什麼時候要回頭對齊:
 *   ① 後台要改 next/font / 自己放字型 ⇒ 先在真瀏覽器量列印頁(下方「行為層驗收」那一組)
 *   ② 顧客站又把 Google Fonts `<link>` 加回來 ⇒ 下面「顧客站沒有 link」那格會紅 ⇒ 回來重看要不要再合成一條
 *
 * ══ 它守什麼(分歧【之外】的變動都要紅)═══════════════════════════════════════
 * · 後台的 link 被刪 / 被註解掉 / 掉了 Noto Sans TC 400 或 700 / 掉了 preconnect ⇒ 紅
 * · 顧客站偷偷加回 Google Fonts link、或不再走 next/font ⇒ 紅(分歧的前提變了,要有人重看)
 *
 * ══ ⚠️ 這道守門【不能】證明什麼 ═════════════════════════════════════════════
 * · 它證的是【字面】—— 不證明那條 URL 真的載得到字型、不證明列印路徑吃得到、不證明線上長什麼樣
 */

const ROOT = resolve(__dirname, '../../../..');
const ADMIN_LAYOUT = resolve(ROOT, 'apps/admin/src/app/layout.tsx');
const STOREFRONT_LAYOUT = resolve(ROOT, 'apps/storefront/src/app/layout.tsx');

/**
 * 剝掉註解之後的原始碼 —— 註解掉的東西不會被渲染。
 *
 * 🔴 codex/code-reviewer 2026-08-29 must-fix:對【整支檔案字串】跑 regex 的話,把整塊 `<head>`
 *    用 `{/* … *\/}` 註解掉,URL 的字面仍在檔案裡 ⇒ 假綠。⇒ 先剝 JSX 註解與 `//` 行。
 * ⚠️ 射程:只剝【註解】;`{false && (<head>…</head>)}` 這種沒被註解也不會被渲染的形狀抓不到(R2 實測,構造性極低)。
 */
function liveSource(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

/** 剝註解後的 `<head>…</head>` 內容;切不出來回 null。 */
function liveHead(file: string): string | null {
  return /<head>([\s\S]*?)<\/head>/.exec(liveSource(file))?.[1] ?? null;
}

/** `<head>` 裡的 Google Fonts stylesheet URL;抓不到回 null。 */
function fontCssUrl(file: string): string | null {
  const m = /href=['"](https:\/\/fonts\.googleapis\.com\/css2[^'"]*)['"]/.exec(liveHead(file) ?? '');
  return m?.[1] ?? null;
}

/** `<head>` 裡的 preconnect host(先切出單一 `<link …/>` 再同時要求 rel 與 href,不跨元素邊界 —— R2 nit)。 */
function preconnectHosts(file: string): string[] {
  return [...(liveHead(file) ?? '').matchAll(/<link\b[^>]*\/>/g)]
    .map((x) => x[0])
    .filter((tag) => /rel=['"]preconnect['"]/.test(tag))
    .map((tag) => /href=['"]([^'"]+)['"]/.exec(tag)?.[1] ?? '')
    .sort();
}

describe('後台的字型 link(Q-FONT2 後台那一半仍成立)', () => {
  it('🔴 後台 <head> 裡有 Google Fonts 那條 link(被刪、被註解掉都紅)', () => {
    expect(
      fontCssUrl(ADMIN_LAYOUT),
      '後台 layout 的 <head> 裡找不到 `fonts.googleapis.com/css2` ⇒ 列印紙的第一順位 Noto Sans TC 變成 no-op,' +
        'macOS 上看起來正常、Linux 上是豆腐字。若是刻意改成自己放字型,先量列印頁(本檔檔尾)再改這一格。',
    ).not.toBeNull();
  });

  it('🔴 那條 URL 含 Noto Sans TC 的 400 與 700(列印紙內文 + 22 條粗體)', () => {
    const url = fontCssUrl(ADMIN_LAYOUT) ?? '';
    const noto = /family=Noto\+Sans\+TC:wght@([0-9;]+)/.exec(url)?.[1]?.split(';') ?? [];
    expect(noto, '沒有 Noto Sans TC ⇒ 接上了一條不含中文字型的樣式表').not.toEqual([]);
    expect(noto, '少了 400 ⇒ 列印紙內文退回機器字型').toContain('400');
    expect(noto, '少了 700 ⇒ 列印紙 22 條粗體變假粗體').toContain('700');
  });

  it('🔴 兩顆 preconnect 都在(掉了不會有錯誤,只會慢,而「慢」不會有人回報)', () => {
    expect(preconnectHosts(ADMIN_LAYOUT)).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  });

  it('🔴 負對照:不含 Noto Sans TC 的 URL 抓出來是空的(上面那格不是恆真)', () => {
    const fake = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
    expect(/family=Noto\+Sans\+TC:wght@([0-9;]+)/.exec(fake)).toBeNull();
  });
});

describe('顧客站已改 next/font(2026-09-15 Sean Q5 甲 推翻 link)—— 分歧的前提', () => {
  it('前提:顧客站 layout 的 <head> 切得出來(否則下一格的「沒有 link」只是尺壞了)', () => {
    expect(liveHead(STOREFRONT_LAYOUT), '顧客站 layout 剝註解後找不到 <head> ⇒ 這把尺沒接上').not.toBeNull();
  });

  it('🔴 顧客站 <head> 裡【沒有】Google Fonts link —— 加回來了就紅,回頭重看兩邊要不要再合成一條', () => {
    expect(
      fontCssUrl(STOREFRONT_LAYOUT),
      '顧客站又出現 Google Fonts <link> ⇒ Q5 甲的前提變了。先決定兩邊是否重新共用同一條(檔頭「什麼時候要回頭對齊」②),' +
        '再改本檔,不要只把期望值翻過來。',
    ).toBeNull();
  });

  it('🔴 顧客站確實走 next/font/google(不是「兩邊都沒載字型」那個世界)', () => {
    expect(
      liveSource(STOREFRONT_LAYOUT),
      '顧客站 layout 沒有 import next/font/google ⇒ 它現在用什麼載英文字型?分歧的理由要重寫。',
    ).toMatch(/from ['"]next\/font\/google['"]/);
  });
});

/**
 * ══ ✅ 行為層驗收 —— **已由線D(`pcm-website-v2-e2`)量到,2026-08-29**(後台列印頁,仍有效)════
 *
 * 🔴 **本檔只證【字面】** —— 下面這些是**別人在真瀏覽器上量的**,不是本檔跑出來的。
 *
 * ```
 * 路由 /print/orders/<id>/shipping/<shipmentId>（出貨單）：
 *   .pd-sheet computed font-family ⇒ 'Noto Sans TC' 排【第 1】
 *   .pd-items 底下的 td            ⇒ 同上
 *   而同一頁的 body                ⇒ Noto 排【第 6】（全站堆疊）
 *   document.fonts 裡 Noto face status=loaded ⇒ 36 個；fonts.gstatic.com 請求 ⇒ 16 筆
 * ```
 * 📌 **body 第 6 / `.pd-sheet` 第 1 這兩個數字並存, 就是這一發的判別力證明** ——
 *    若 CSS 沒載到,`.pd-sheet` 會退回第 6 那組,而量得出來。
 *
 * ⚠️ **量測範圍跟著數字走(不要把它讀寬)**:
 * ```
 * · 那是【拋棄式 DB 上種的一筆】出貨單，且**尚未標記寄出**
 * · 量的是【本機】。線上長什麼樣仍然是第三個世界，無人證明
 * · 揀貨單那一頁 Noto 排第 6 ⇒ **那是對的**：picking-doc 渲染的 `pd-` class = 0 個，
 *   它整份是 Tailwind、不吃 `--pd-body`。**兩張列印紙不是同一種紙。**
 * · ⚠️ 2026-09-08 起 print-a4.css 的 --pd-body 前面多了 'Noto Sans'(拉丁,⟦ship-PRINTCARON1⟧),
 *   上面「Noto Sans TC 排第 1」是 08-29 當時的量測,之後沒有重量。
 * ```
 */
