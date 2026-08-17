// markdown-in-jsx-text.test.ts — 全 admin 守門:**JSX 純文字裡不得寫 markdown**。
// ============================================================================
// 病:有人在 JSX 文字節點裡寫 `**建立後不可刪除**`。
//    **JSX 不解析 markdown ⇒ 員工看到的是逐字的星號。**
//    實錘 = `app/settings/suppliers/page.tsx:72-76` 的註解,它自己記著:
//      「第一版寫了 `**建立後不可刪除**`,員工看到的是逐字的星號(R1 抓;
//        🔴 **三綠看不見,因為沒有任何測試斷言這段開場白**)」
//    ⇒ 「壞掉而且完全沒有訊號」那一族 ⇒ 機制優先律:做成守門,不是寫規則。
//
// ── 🔴 為什麼是【原始碼掃描】而不是【渲染產物掃描】(與 C 窗的形狀刻意不同)──────
//   C 窗(列印線)的同族守門掃渲染產物,理由是「grep 原始碼會漏掉組出來的字串」。
//   **我這一側刻意不照抄**,而理由是它自己給我的那句:
//     🔴 **「共用【判別句】,不共用【判定式】—— 兩側的假陽性集合不同。」**
//   逐條:
//     ① 覆蓋面差很多:admin 有 109 個 .tsx,而 jsdom render 得起來的只有少數幾支
//        (多數是 server component + 打 DB)⇒ 渲染層守門只守得到「剛好有測試的那幾頁」。
//     ② 它擔心的失效模式在這個病上不成立:**沒有人會用 `'**' + x + '**'` 組出粗體**,
//        這個錯是【手打】出來的 ⇒ 原始碼就是它出生的地方。
//     ③ 反過來,原始碼掃描有它自己的坑,而那兩個我都量到了(見下面「假陽性」段)。
//   ⚠️ **代價寫在明處**:CSS `content:` 放的文字、以及真的由變數組出來的 markdown,
//      這支尺**看不到**。那一半沒有守門 —— **不要把本檔讀成「全站不可能有 markdown」。**
//
// ── 🔴 假陽性:兩個都是【量到的】,不是防禦性想像 ────────────────────────
//   ① 反引號:原始碼裡的 `` ` `` 是 **template literal**(語言特性),不是 markdown code span。
//      第一版把它當規則 ⇒ **185 命中,全是 `` `${TD} text-right` `` 這種。** ⇒ 規則刪掉。
//   ② 底線:`sidebar.tsx:331` 有 `[[data-side=left][data-state=collapsed]_&]:cursor-e-resize`
//      —— 那是 **Tailwind 的 arbitrary variant**,住在 `className` 字串裡。
//      ⇒ 修法不是開白名單(白名單在本 repo 被穿透過兩次),
//         是**把射程收到「只看 JSX 文字節點」** —— 字串字面與屬性值一律不看。
//   🔴 這兩個假陽性一起指向同一件事:**病在【文字節點】,那就只量文字節點。**
//
// ── 判別句(C 窗給的,共用這個而不是共用 code)────────────────────────
//   **「我禁的這個東西,真實資料裡會不會合法出現?」**
//     答【不會】⇒ 可以禁整個範圍;答【會】⇒ 只能禁形狀。
//   本案答【會】:商品名 / 規格 / 備註都可能合法帶 `*` 或 `_`
//   ⇒ **只禁【成對包住非空白內容】的形狀**,不禁單獨出現的符號。
// ============================================================================
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN_SRC = join(__dirname);

/** 剝註解。順序重要:先 JSX `{/* *​/}`、再 block、最後 line。 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:"'`])\/\/[^\n]*/g, ' ');
}

/**
 * 只取 **JSX 文字節點** —— `>` 與 `<` 之間、且不含 `{}`(排除表達式)。
 * 🔴 這一步就是把「字串字面 / 屬性值」整類排除掉的地方(見檔頭假陽性②)。
 */
function jsxTextNodes(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/>([^<>{}]+)</g)) {
    const t = (m[1] ?? '').trim();
    if (t) out.push(t);
  }
  return out;
}

/** 成對包住【非空白】內容才算 markdown 形狀。 */
const MARKDOWN_SHAPES: readonly { name: string; rx: RegExp }[] = [
  { name: '**粗體**', rx: /\*\*[^\s*][^*]*\*\*/ },
  { name: '*斜體*', rx: /(?<!\*)\*[^\s*][^*]*\*(?!\*)/ },
  { name: '_底線_', rx: /(?<![A-Za-z0-9_])_[^\s_][^_]*_(?![A-Za-z0-9_])/ },
  { name: '`程式碼`', rx: /`[^`\n]+`/ },
  { name: '[連結](url)', rx: /\[[^\]\n]+\]\([^)\n]+\)/ },
];

function findMarkdown(text: string): string | null {
  for (const { name, rx } of MARKDOWN_SHAPES) {
    if (rx.test(text)) return name;
  }
  return null;
}

function listTsx(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listTsx(p, acc);
    else if (e.endsWith('.tsx') && !e.endsWith('.test.tsx')) acc.push(p);
  }
  return acc;
}

describe('JSX 純文字裡不得出現 markdown 語法', () => {
  // 🔴🔴 **兩個世界要先各表演一次** —— 沒有這一格,下面那格在「偵測器整支壞掉」時
  //    也會全綠,而它看起來與「全站真的很乾淨」一模一樣。
  it('量具活性:該抓的抓得到、該放的放得過', () => {
    // 該抓
    expect(findMarkdown('**建立後不可刪除**')).toBe('**粗體**');
    expect(findMarkdown('請看 *這裡*')).toBe('*斜體*');
    expect(findMarkdown('欄位 _slug_ 不可改')).toBe('_底線_');
    expect(findMarkdown('輸入 `SKU-1`')).toBe('`程式碼`');
    expect(findMarkdown('見 [說明](https://x.tw)')).toBe('[連結](url)');

    // 🔴 該放 —— 這幾條是「真實資料裡會合法出現」的那一類,禁整字就會誤傷
    expect(findMarkdown('尺寸 5*8 公分')).toBeNull(); // 單獨的星號
    expect(findMarkdown('必填 *')).toBeNull(); // 表單必填標記
    expect(findMarkdown('料號 ABC_123_X')).toBeNull(); // 識別字裡的底線
    expect(findMarkdown('共 3 筆 · 已告知 1 筆')).toBeNull(); // 一般文案
    expect(findMarkdown('顏色: 黑 · 規格: 通用')).toBeNull(); // C 窗踩過的分隔符
  });

  it('分母:掃到的檔數要與實際檔數相符(先證尺量得到東西)', () => {
    const files = listTsx(ADMIN_SRC);
    // 🔴 這一格擋的是「路徑寫錯 ⇒ 掃到 0 個檔 ⇒ 下面那格恆綠」。
    //    2026-08-18 我在文案審查時真的踩過一次:`suppliers` 找錯目錄、掃到 0 檔,
    //    而報告上長得像「掃過了」。⇒ **宣稱掃過某個範圍之前,先把檔數印出來當分母。**
    expect(files.length).toBeGreaterThan(80);
    // 而且要真的抽得出文字節點,否則「零命中」只是因為抽不到東西
    const totalNodes = files.reduce((n, f) => n + jsxTextNodes(readFileSync(f, 'utf8')).length, 0);
    expect(totalNodes).toBeGreaterThan(200);
  });

  it('全 admin 的 JSX 文字節點零 markdown', () => {
    const offenders: string[] = [];
    for (const f of listTsx(ADMIN_SRC)) {
      const src = readFileSync(f, 'utf8');
      for (const text of jsxTextNodes(src)) {
        const shape = findMarkdown(text);
        if (shape) offenders.push(`${f.replace(ADMIN_SRC, 'src')} [${shape}] ${text.slice(0, 60)}`);
      }
    }
    expect(offenders, `JSX 文字寫了 markdown（員工會看到逐字符號）:\n${offenders.join('\n')}`).toEqual([]);
  });
});
