// statement-html.ts —— 片 C2:把「一張明細單」組成一份**自足的 HTML 字串**。
//
// ══ 它為什麼存在 ═══════════════════════════════════════════════════════════
// 片 C 要在伺服器上把這張紙產成 PDF。兩條路(比較與量測在
// `docs/plans/2026-08-31-statement-pdf-slice-c-plan.md` §0):
//   設計 A  headless Chrome 去 goto 我們自己的 URL ⇒ 要轉發客人的 session cookie
//   設計 B  自己組 HTML ⇒ `page.setContent(html)`  ⇒ 零 cookie 轉發、零對外請求
// 主視窗 `-2d [16689c]` 2026-08-31 批**設計 B**。本檔是設計 B 的那個「組」。
//
// 🔴 **自足 = 這份 HTML 送進一個【沒有網路】的瀏覽器也要長得對。**
//    ⇒ 字型不能靠 `<link>`、不能靠 `file://`(片 A 實測:`file://` 的字型 Chrome
//      **靜默不載** —— 零錯誤零警告,而它照樣印出一張漂亮的中文 PDF)
//    ⇒ 所以字型檔**內嵌成 `data:` URI**。實測那條路可行:
//      有內嵌 ⇒ 用到 `Noto Sans TC`;拿掉 ⇒ 掉回系統字;**兩個世界的對外請求都是 0**。
//
// ══ 🛑 這支【不做】什麼 ═══════════════════════════════════════════════════
// · 它**不碰 puppeteer / chromium** —— 那是 C1/C3。本檔是純函式, 沒有新相依。
// · 它**不讀檔** —— 字型怎麼從磁碟拿到,由呼叫端注入 `readFont`。
//   ⇒ 這樣它在單元測試裡測得起來, 而且**在 C1 被否決的世界裡照樣是完成品**。
// · 它**不保證那張紙好不好看** —— 版面是 `StatementDoc` + 那兩支 CSS 的事。

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
 * 🔴 **正規式吃的是【編譯後】的 CSS**(沒有換行、沒有註解)。餵原始碼進來會拆不乾淨 ——
 *    那不是本函式該補的洞,是呼叫端餵錯東西。呼叫端請餵 `.next` 的產物。
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
 * @param bodyHtml  `renderToStaticMarkup(<StatementDoc …/>)` 的結果
 * @param pageCss   版面 CSS(`print-a4.css` + `statement.css` 的編譯產物, 依序)
 * @param fontCss   `next/font` 的編譯產物(含 `@font-face`)
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
