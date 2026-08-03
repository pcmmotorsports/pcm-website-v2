// brand-rich-text.ts — 品牌內容欄位的極小白名單標記解析(D1a;2026-08-04)
//
// 為什麼需要這支:設計側的品牌內容(Open Design `pcm-home-redesign` 的
// `brand-content-data.js`,20 家 / 1188 行)在文案欄位裡直接寫了 HTML 片段 ——
// 實測 `<strong>` 168 處、`<br>` 98 處,分佈於 lede / slogan / about.lead /
// about.pull / about.tail / title / caption。所以資料層不是「JS 物件換成 TS 物件」
// 就結束,得決定這些標記怎麼進 React。
//
// 三個選項與取捨寫在 `docs/specs/2026-08-03-storefront-home-brand-page-wire-plan.md` §5.1;
// Sean 2026-08-04 指定走 **c 案:白名單極小 parser**,不引入 `dangerouslySetInnerHTML`。
//
// 🔴 這支不是 HTML 解析器,也不打算變成 HTML 解析器。
//    它只認三樣東西:`<strong>…</strong>`、`<br>`、五個具名 XML entity。
//    **白名單以外的一切一律當純文字**——包含長得像標籤的東西。
//    所以哪天內容裡混進 `<script>` 或 `<img onerror=…>`,結果是「畫面上看得到那串字」,
//    不是「瀏覽器執行它」。安全性由此而來,而不是由「我們相信內容是乾淨的」而來
//    (內容現在是 L2 hardcode,但 backlog #271 要接後台 CRUD ⇒ 那天會有人編輯它)。
//
// 實測支撐(2026-08-04,對 `brand-content-data.js` 全部 1335 個字串跑過):
//   · `<strong>` 內從未含其他標籤(0 處)⇒ **扁平節點串足夠,不需要巢狀樹**
//   · `<strong>` 全數配對(未配對 0 處)
//   · 無 `<br/>` / `<br />` 變體(0 處)、無白名單外標籤(0 處)
//   · entity 全集只有 `&amp;`(1 處)
//   上述任一條在未來的內容裡被打破時,本檔的行為是「當純文字顯示」而不是壞掉或漏字。

/** 解析後的節點。刻意扁平(無 children):實測內容零巢狀,樹狀結構會是為了不存在的情境而多養的複雜度。 */
export type BrandRichNode =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'break' };

/**
 * 具名 entity 白名單。
 * 🔴 只用**單次** regex 掃描取代,不要拆成一串 `.replace()` ——
 *    連續取代會讓 `&amp;lt;` 先變 `&lt;` 再變 `<`(double-decode),
 *    等於在一支標榜「不解析 HTML」的函式裡開了一條產生標記的路。
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const ENTITY_RE = /&(?:amp|lt|gt|quot|#39);/g;

/** 只在**產出文字節點時**做,不在解析標籤前做 —— 否則 `&lt;strong&gt;` 會被解讀成標籤。 */
function decodeEntities(raw: string): string {
  return raw.replace(ENTITY_RE, (m) => ENTITIES[m] ?? m);
}

/** 白名單標記:`<br>` 或成對的 `<strong>…</strong>`(非貪婪、不跨越下一個 `</strong>`)。 */
const MARKUP_RE = /<br>|<strong>([\s\S]*?)<\/strong>/g;

/** 把純文字片段推進結果(空字串不推,避免產出無意義的空節點)。 */
function pushText(out: BrandRichNode[], raw: string): void {
  if (raw === '') return;
  out.push({ kind: 'text', text: decodeEntities(raw) });
}

/**
 * 把品牌內容字串解析成可直接 map 成 React 節點的扁平串。
 *
 * @example
 *   parseBrandRichText('<strong>先有賽道。</strong><br>1991 年起。')
 *   // [{kind:'strong',text:'先有賽道。'}, {kind:'break'}, {kind:'text',text:'1991 年起。'}]
 *
 * 未閉合的 `<strong>`(實測不存在,但內容可編輯後就可能出現)不會吞掉後面的文字 ——
 * regex 配不上就整段落回純文字,`<strong>` 四個字會**顯示出來**。
 * 這是刻意的:寧可讓人看到壞掉的標記去修內容,也不要靜默吃掉一段文案。
 */
export function parseBrandRichText(source: string): BrandRichNode[] {
  const out: BrandRichNode[] = [];
  let cursor = 0;
  for (const match of source.matchAll(MARKUP_RE)) {
    pushText(out, source.slice(cursor, match.index));
    if (match[0] === '<br>') out.push({ kind: 'break' });
    else out.push({ kind: 'strong', text: decodeEntities(match[1] ?? '') });
    cursor = match.index + match[0].length;
  }
  pushText(out, source.slice(cursor));
  return out;
}

/**
 * 取純文字(供 `alt` / `title` / `aria-label` / metadata 等不能放標記的地方用)。
 * 🔴 `<br>` 換成一個半形空格而非直接刪掉:`A<br>B` 刪掉會黏成 `AB`。
 */
export function brandRichTextToPlain(source: string): string {
  return parseBrandRichText(source)
    .map((node) => (node.kind === 'break' ? ' ' : node.text))
    .join('');
}
