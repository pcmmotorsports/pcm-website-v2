// @pcm/pdf/html —— 「把一份紙的 HTML + CSS + 字型組成【自足的 HTML 字串】」。
//
// 📎 **2026-09-06 從 `apps/storefront/src/lib/print/statement-html.ts` 原字面搬過來**
//    (⟦f3-SHIPPDF1⟧ P-2)。🔴 **搬的是原字面, 註解跟著它解釋的那段碼一起過來**(鐵則 6)。
//
// 🔴 **為什麼它算【產檔】不算【版面】**(P-1 立的那條界線, 這裡沿用):
//    它**不知道紙上有什麼** —— 它收 `bodyHtml` / `pageCss` / `fontCss` / `readFont` 四個參數,
//    做的是「掃出用到哪些字 → 只留涵蓋得到的 face → 把字型內嵌成 data: URI」。
//    ⇒ 📌 **版面是那四個參數的【內容】, 而它們由各自的 app 提供** ——
//      顧客站給對帳單、後台給出貨單。**它一個字都不知道。**
//    ⇒ 🛑 而它只 import `node:path`(搬家前後都是)⇒ 零 app 耦合。
//
// 🔵 而名字裡的 `statement` 留在**函式名**上沒有改(`buildStatementHtml`)——
//    改名會動到顧客站那一族既有測試, 而本片的驗收條件是「那些測試零改動」。
//    ⇒ ⚠️ **所以它的名字比它的職責窄**, 讀的人不要被騙。

import { isAbsolute as nodeIsAbsolute, relative as nodeRelative, sep as nodeSep } from 'node:path';

/** 一個 `@font-face` 區塊拆解後的樣子。`url` 為 `null` = 它沒有可內嵌的來源(例如 `src:local(Arial)`)。 */
export type ParsedFace = {
  /** 原始的宣告內容(大括號裡那一段),用來重組。 */
  body: string;
  /** `src:url(...)` 裡那一段;沒有就是 `null`。 */
  url: string | null;
  /** `unicode-range` 攤平成 [起, 迄] 的閉區間。 */
  ranges: Array<[number, number]>;
  /**
   * 🔴 有沒有【宣告過】 `unicode-range` —— 與 `ranges.length === 0` **不是同一件事**。
   * codex 抓到:宣告了但一段都沒解出來(例如小寫 `u+4e00`)時, 空陣列會被當成「不限」
   * ⇒ 那個 face 會被判成涵蓋所有字 ⇒ `uncovered` 從此永遠是空的, **而它是一個假的安心**。
   */
  declaredRanges: boolean;
};

/**
 * 從一份 CSS 裡拆出所有 `@font-face`。
 *
 * ⛔ ~~正規式吃的是【編譯後】的 CSS…呼叫端請餵 `.next` 的產物~~
 *    🔴 **那個契約已作廢**(codex 2026-08-31 抓到它與實作相反):route 與瀏覽器守門
 *    現在餵的都是 **`@fontsource` 的原始 CSS**,而它跑得起來(212 個 face 全部拆得出來)。
 * 🛑 **仍然成立的限制**:這支正規式**不解析 CSS 註解**。`@fontsource` 的 CSS 每個 face
 *    前面有一行 `/* … *\/` 註解而它們不含 `@font-face` 字面 ⇒ 今天不受影響。
 *    ⇒ 餵一份**註解裡含 `@font-face` 的 CSS** 會拆出多的東西 —— 那一格**未防**。
 */
export function parseFontFaces(css: string): ParsedFace[] {
  return [...css.matchAll(/@font-face\s*\{(.*?)\}/gs)].map((m) => {
    const body = m[1] ?? '';
    // 🔴 不能只認「`src:` 後面【緊接著】 url」——`src:local(Arial),url(x.woff2)` 是合法的,
    //    而第一版那條正規式會把它判成「沒有 url」⇒ 我們會丟掉一支其實嵌得進去的子集(codex 抓)。
    const srcDecl = /src:\s*([^;}]+)/i.exec(body)?.[1] ?? '';
    const url = /url\(([^)]+)\)/.exec(srcDecl)?.[1]?.replace(/^["']|["']$/g, '') ?? null;
    const rangeDecl = /unicode-range:\s*([^;}]+)/i.exec(body)?.[1];
    const rangeSpec = rangeDecl ?? '';
    const ranges: Array<[number, number]> = [];
    for (const piece of rangeSpec.split(',')) {
      // `U+4E00-9FFF` / `U+3000` / `U+1F9?`(問號 = 萬用字元, Google 的 CSS 會用)
      // 🔴 `i` 旗標:規格允許小寫 `u+`。少了它 ⇒ 那一段解不出來 ⇒ 見 `declaredRanges` 那段。
      const m2 = /u\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/i.exec(piece.trim());
      if (!m2 || m2[1] === undefined) continue;
      if (m2[1].includes('?')) {
        // 🔴 萬用字元要展開成區間, **不能當成單一 codepoint** ——
        //    `U+1F9?` 是 U+1F90–U+1F9F 那 16 格。漏掉展開 ⇒ 那些字會被判成「沒人涵蓋」
        //    ⇒ 我們會少內嵌一支子集, 而**畫面上是一個豆腐字, 程式不會叫**。
        ranges.push([
          parseInt(m2[1].replaceAll('?', '0'), 16),
          parseInt(m2[1].replaceAll('?', 'F'), 16),
        ]);
        continue;
      }
      const lo = parseInt(m2[1], 16);
      ranges.push([lo, m2[2] === undefined ? lo : parseInt(m2[2], 16)]);
    }
    return { body, url, ranges, declaredRanges: rangeDecl !== undefined };
  });
}

/**
 * 把 HTML 裡**真的會被畫出來的字**抽成 codepoint 集合。
 *
 * 🔴 標籤與屬性要先拿掉 —— 不拿掉的話 `class="pd-sheet"`、`data:image/png;base64,…`
 *    那一大串都會被當成「要畫的字」⇒ 我們會多內嵌好幾支拉丁子集。
 *    (多內嵌只是浪費, 不會壞;而**少內嵌會豆腐** ⇒ 這個方向的錯是安全的那一邊。)
 */
export function codepointsOfHtml(html: string): Set<number> {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    // 🔴 entity 要【解碼】不是刪掉(codex must-fix):刪掉的話 `&euro;` 那個字元
    //    從來沒進過集合 ⇒ 我們不會嵌那支子集 ⇒ 瀏覽器照樣畫出 €, 而它是豆腐。
    //    ⚠️ 只認數字型與那五個具名的 —— `renderToStaticMarkup` 只會吐這五個
    //    (`& < > " '`), 其餘具名 entity **不解**, 而它們會留下原樣的 ASCII 字母
    //    ⇒ 那個方向是安全的(多算幾個拉丁字元, 不會少算)。
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?apos;/g, "'");
  const out = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp > 0x20) out.add(cp);
  }
  return out;
}

const covers = (face: ParsedFace, cps: Set<number>): boolean => {
  // 沒宣告 = 不限 ⇒ 留。宣告了而一段都沒解出來 ⇒ **也留**(多嵌只是浪費, 少嵌會豆腐),
  // 🔴 但它【不算涵蓋任何字】—— 見下面 `coveredCps` 那一段。兩件事分開。
  if (face.ranges.length === 0) return true;
  for (const cp of cps) {
    for (const [lo, hi] of face.ranges) if (cp >= lo && cp <= hi) return true;
  }
  return false;
};

export type BuildResult = {
  html: string;
  /** 真的內嵌進去的 face 數。 */
  embedded: number;
  /** 這張紙用不到、被丟掉的 face 數。 */
  skippedUnused: number;
  /** 用得到、但 `readFont` 拿不到檔的 face 數。🔴 這個數不是 0 就代表有字會變豆腐。 */
  skippedMissing: number;
  /** 內嵌字型的原始位元組合計(不是 base64 之後的)。 */
  fontBytes: number;
  /**
   * 紙上有、而**沒有任何一個被留下的 face 【宣稱】涵蓋**的非 ASCII 字元。
   *
   * 🛑 **射程(codex must-fix 要求寫死)**:它讀的是 CSS 上的 `unicode-range` **宣告**,
   *    **不是字型檔裡真的有那個字**、也不分字重。
   *    ⇒ `uncovered` 是空的 **推不出**「這張紙不會有豆腐字」;
   *      它非空**倒是**一個確定的壞消息(連宣告都沒人涵蓋它)。
   *    ⇒ 真的要答「畫不畫得出來」得解字型檔的 cmap —— 本檔不做。
   */
  uncovered: string[];
};

/**
 * 組出一份自足的 HTML。
 *
 * ⚠️ **這三個 @param 原本寫的是顧客站那一個呼叫端的形狀**(codex R1 nit, 2026-09-06)——
 *    而本函式搬進 `@pcm/pdf` 之後**多了一個後台的呼叫端**, 它三個都不一樣:
 *    `<ShippingDoc/>` · 未編譯的原始 `print-a4.css` · `@fontsource` 的 `400.css`/`700.css`。
 *    ⇒ 📌 共用函式的文件寫成第一個呼叫端的樣子, 下一個人會照著它去對, 然後對不上。
 *    ⇒ 下面改寫成**這個函式真正要求的東西**, 呼叫端各自舉例。
 *
 * @param bodyHtml  一段已經是純字串的 HTML(誰產的不管;
 *                  顧客站 `<StatementDoc/>` · 後台 `<ShippingDoc/>`, 都走 `renderToStaticMarkup`)
 * @param pageCss   版面 CSS 的**內容**(編譯產物或原始碼皆可;
 *                  顧客站 = `print-a4.css` + `statement.css` 依序, 後台 = 原始 `print-a4.css`)
 * @param fontCss   含 `@font-face` 的 CSS 內容(顧客站 = `next/font` 編譯產物,
 *                  後台 = `@fontsource` 的 `400.css` / `700.css`)
 * @param readFont  拿字型檔;拿不到回 `null`(**不要 throw** —— 少一支子集不該讓整張單產不出來)
 */
export function buildStatementHtml({
  bodyHtml,
  pageCss,
  fontCss,
  readFont,
}: {
  bodyHtml: string;
  pageCss: string;
  fontCss: string;
  readFont: (relativeUrl: string) => Uint8Array | null;
}): BuildResult {
  const cps = codepointsOfHtml(bodyHtml);
  const faces = parseFontFaces(fontCss);

  const kept: string[] = [];
  let embedded = 0;
  let skippedUnused = 0;
  let skippedMissing = 0;
  let fontBytes = 0;
  const coveredCps = new Set<number>();

  for (const face of faces) {
    if (face.url === null) {
      // `src:local(...)` 這一種在伺服器上沒有意義(容器裡沒有那些本機字型)⇒ 丟掉。
      skippedUnused += 1;
      continue;
    }
    if (!covers(face, cps)) {
      skippedUnused += 1;
      continue;
    }
    const bytes = readFont(face.url);
    if (bytes === null) {
      skippedMissing += 1;
      continue;
    }
    fontBytes += bytes.length;
    const b64 = Buffer.from(bytes).toString('base64');
    // 🔴 **整條 `src` 丟掉重寫, 不做 regex 取代**(codex must-fix):
    //    原本那條 `replace(/src:url\(…\)/)` 只換第一個 `url()` ⇒ 一個
    //    `src:url(a.woff2),url(b.woff2)` 會留下 `b.woff2` 這個**外部來源**
    //    ⇒ 而它只在 data 那支載失敗時才會被抓 ⇒ 那一刻就是一個對外請求,
    //      而本設計的核心承諾是【零對外請求】。⇒ 重寫保證只有一個來源。
    const rebuilt = face.body
      .split(';')
      .filter((decl) => !/^\s*src\s*:/i.test(decl))
      .concat(`src:url(data:font/woff2;base64,${b64}) format("woff2")`)
      .join(';');
    kept.push(`@font-face{${rebuilt}}`);
    embedded += 1;
    // 🔴 只有【真的解出區間】或【根本沒宣告】才算涵蓋。
    //    宣告了而解不出來 ⇒ 這支照樣嵌(安全方向), 但它**不替任何字背書**
    //    ⇒ 那些字會留在 `uncovered` 裡叫。
    for (const [lo, hi] of face.ranges) {
      for (const cp of cps) if (cp >= lo && cp <= hi) coveredCps.add(cp);
    }
    if (!face.declaredRanges) for (const cp of cps) coveredCps.add(cp);
  }

  // 🔴 只算**非 ASCII** 的沒涵蓋字元:ASCII 一定有系統字畫得出來, 把它們算進來會讓
  //    這個訊號**每次都非空** ⇒ 一個永遠在叫的警報等於沒有警報。
  const uncovered = [...cps]
    .filter((cp) => cp > 0x7f && !coveredCps.has(cp))
    .map((cp) => String.fromCodePoint(cp));

  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<style>${pageCss}</style>
<style>${kept.join('')}</style>
</head><body>${bodyHtml}</body></html>`;

  return { html, embedded, skippedUnused, skippedMissing, fontBytes, uncovered };
}

/**
 * `child` 是不是真的落在 `parent` 這個目錄【裡面】。
 *
 * 🔴 **這是一道信任邊界, 而它被 codex 抓過一次**:第一版寫 `child.startsWith(parent)`,
 *    **那不是目錄邊界** —— `parent=/x/noto-sans-tc` 而 `child=/x/noto-sans-tc-evil/a`
 *    的字串前綴是成立的, 它會通過。
 * ⇒ 改用 `relative()`:落在裡面 ⇒ 得到一段非空、不以 `..` 開頭、且不是絕對路徑的相對路徑。
 */
export function isInsideDir(parent: string, child: string): boolean {
  const rel = nodeRelative(parent, child);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${nodeSep}`) && !nodeIsAbsolute(rel);
}
