// 這一支守的是 2026-08-31 線上那一發 500:
//   `Error: Attempted to call StatementPrintButton() from the server but
//    StatementPrintButton is on the client.`
//
// 🔴🔴 **它【不能】用「渲染一次看會不會丟例外」來守 —— 那道尺在這裡是死的。**
//    那個例外來自 Next 編譯 RSC 時把 `'use client'` 檔換成的**代理物件**,
//    而 vitest 直接 import 原始碼 ⇒ 拿到的是**真的函式** ⇒ 它渲染得很順、什麼都不會發生。
// 📌 **⇒ 這正是「在測試裡跑得動」與「在線上跑得動」不是同一個宣稱的實例。**
//    ⇒ 所以本檔改問兩個**在這一層答得出來**的問題:
//      ① 那棵樹裡的 `'use client'` 檔集合有沒有變(多一支 = 多一個會炸的點)
//      ② PDF 那條 route 有沒有真的把開關關掉
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import ts from 'typescript';
import { dirname, join, resolve } from 'node:path';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';

// 🔵 訂單樣本【照抄】`statement-cascade-browser.test.tsx:61-92`, 不自己發明一份 ——
//    兩份 fixture 分岔時, 分岔本身不會有東西叫。
const twd = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });
const ORDER = {
  id: 'o1',
  displayId: 'PCM-2099-0007',
  createdAt: '2099-04-15T10:00:00Z',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentMethod: 'tappay',
  // 🔵 段 3 加欄:此 fixture 演的是【已付款的刷卡單】⇒ 'tappay'。
  paymentChannel: 'tappay' as const,
  paidAt: '2099-04-18T03:00:00Z',
  shippedAt: null,
  allItemsShipped: false,
  subtotal: twd(18000),
  shippingFee: twd(100),
  discountTotal: twd(0),
  taxTotal: twd(0),
  total: twd(18100),
  balanceDue: null,   // ⟦b4-PARTIALPAIDNOWHERE⟧ null = 算不出來(不是 0)
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelKind: 'none',
  items: [0, 1, 2].map((i) => ({
    id: `oi${i}`,
    variantSku: `SKU-100${i}`,
    brand: 'CNC RACING',
    title: `下鏈條蓋 ${i}`,
    spec: { color: 'black' },
    imageUrl: null,
    vehicle: null,
    quantity: 1,
    unitPrice: twd(6000),
    lineTotal: twd(6000),
    shipped: false,
  })),
  itemCount: 3,
  itemsTruncated: false,
} as MemberOrderDetail;

const SRC = resolve(__dirname, '../..');
const ROOT = join(SRC, 'components/print/statement-doc.tsx');
// 🔴🔴 **2026-09-01:那個呼叫從 route 搬到 lib 了**(⟦b4-MAILPDF1⟧ 的前置, 抽產檔函式)。
//    ⛔ ~~`const PDF_ROUTE = …/statement.pdf/route.ts`~~
//    🟢 **而這一格【當場紅了】, 那正是它存在的理由** —— 它的正對照
//       (`expect(args.length).toBeGreaterThan(0)`)在呼叫消失時開火:
//       `expected 0 to be greater than 0`。
//    ⇒ 📌 **少了那一行正對照, 這一格會在【它守的東西整個搬走】之後安靜地全綠**
//      (`every` 對空陣列回 true)⇒ 而那是最糟的一種:守門還在、還綠, 而它守的東西不在了。
//    ✅ 而搬過去之後那個呼叫**更安全了**:`buildStatementPdfHtml()` 收的是 `order` 不是元素,
//       `printButton: false` 鎖在函式裡 ⇒ **呼叫端漏傳這個錯, 在型別上構造不出來。**
//    🛑 而這一格仍然要留 —— 鎖在裡面的那個字面**還是可能被人改掉**。
const PDF_ROUTE = join(SRC, 'lib/print/statement-pdf.ts');

/**
 * 從 statement-doc.tsx 出發, 把 import / export-from / dynamic import 走完一遍。
 *
 * 🔴🔴 **用 TypeScript 自己的 parser, 不用正規式**(codex 關卡2 R2 must-fix) ——
 *    這是**換路**, 不是第三次補正規式。前兩版的失敗形狀一模一樣:
 *      R1 ⇒ 剝註解只剝整行 ⇒ 行尾註解假綠
 *      R2 ⇒ 剝了行尾 ⇒ **字串裡的 `//` 被誤剝、字串裡的 `printButton: false` 被誤認**
 *    📌 **⇒ 同一個病兩種症狀:我在用一個【比 JS 語法弱的工具】回答語法問題。**
 *       再補一次正規式, 下一個反例會是模板字串、或 JSX 屬性裡的字面。
 *    ✅ `ts.createSourceFile` 對【字串內容】與【註解】天生免疫 —— 它們在 AST 上根本不是節點。
 */
function walk(entry: string) {
  const seen = new Set<string>();
  const clients: string[] = [];
  const unresolved = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    // `'use client'` = 檔案第一個【語句】且是純字串 ⇒ AST 上就是這個形狀,
    // 註解不在 statements 裡 ⇒ 「檔頭有註解」那一種自動涵蓋。
    const first = sf.statements[0];
    if (
      first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === 'use client'
    ) {
      clients.push(f.slice(SRC.length + 1));
    }
    const specs: string[] = [];
    const visit = (n: ts.Node) => {
      // import … from 'x'  /  export … from 'x'  /  export * from 'x'
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
        if (ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
      }
      // import('x')  —— 含 magic comment 的動態載入也是這個節點
      // require('x') —— codex 關卡2 R3 must-fix③ 點名的另一種形狀
      if (
        ts.isCallExpression(n) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(n.expression) && n.expression.text === 'require'))
      ) {
        const a = n.arguments[0];
        if (a && ts.isStringLiteral(a)) specs.push(a.text);
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
    for (const s of specs) {
      // `@/…` = storefront 自己的 src;`@pcm/…` = workspace 套件(在 packages/ 底下)。
      const base = s.startsWith('@/')
        ? join(SRC, s.slice(2))
        : s.startsWith('@pcm/')
          ? // 🔴 `@pcm/ui/foo` ⇒ `packages/ui/src/foo`(**第一段是套件名, 其餘在 src 底下**)。
            // 第一版寫 `join(…, s.slice(5), 'src')` ⇒ 組出 `packages/ui/foo/src` ⇒ **永遠不存在**
            // ⇒ 那條腿等於沒接上, 而它不會報錯, 它只是安靜地不追。
            // 🛑 這是突變抓到的:codex 給的反例餵下去, 守門【綠】。**一條沒接上的腿,
            //    與一條不存在的腿, 在測試報表上是同一個字。**
            (() => {
              const [pkg, ...rest] = s.slice(5).split('/');
              return join(SRC, '../../../packages', pkg ?? '', 'src', ...rest);
            })()
          : /^\.\.?\//.test(s)
            ? join(dirname(f), s)
            : null;
      // 🔴🔴 **追不動的要【記下來】, 不可以安靜跳過**(codex 關卡2 R3 must-fix③):
      //    第一版對 bare package(`react` / 任何第三方 UI 套件)、沒涵蓋到的 alias、
      //    沒涵蓋到的副檔名, 一律 `continue` ⇒ **一個從第三方套件進來的 client 元件,
      //    清單完全不變、守門全綠, 而 PDF 照樣 500。**
      // 📌 ⇒ 改成「我追不動的東西要有名字」, 下面那格斷言比對的是【那個集合】——
      //    集合一變就紅, 而紅的意思是「有人要來看一眼這個新相依會不會是 client」。
      if (!base) {
        unresolved.add(s);
        continue;
      }
      let hit = false;
      for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts', '.jsx', '.js', '.mjs', '.cjs']) {
        if (existsSync(base + ext)) {
          stack.push(base + ext);
          hit = true;
          break;
        }
      }
      if (!hit) unresolved.add(s);
    }
  }
  return { seen, clients, unresolved: [...unresolved].sort() };
}

/**
 * 讀出 PDF 那條 route 傳給 `createElement(StatementDoc, {...})` 的 `printButton` 值。
 *
 * 🔴 回傳 `undefined` = **那個呼叫根本沒傳這個屬性**(或找不到那個呼叫);
 *    回傳 `true` / `false` = 它真的寫在那個 object literal 裡。
 * 🛑 **不是 grep** —— `fontFamily: "printButton: false"` 這種字串在 AST 上是一個
 *    `StringLiteral` 的 text, 不會被誤認成一個屬性(codex 給的反例)。
 */
type PrintButtonArg = 'true' | 'false' | 'not-literal' | 'absent';

function printButtonArgs(file: string): PrintButtonArg[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  // 🔴🔴 **回【陣列】不是單一值**(codex 關卡2 R3 must-fix②):第一版用一個 `found` 變數,
  //    ⇒ 檔裡有兩個 `createElement(StatementDoc,…)` 時, **後面那個會蓋掉前面那個**
  //    ⇒ 一個危險的呼叫排在一個安全的呼叫前面 ⇒ 守門恆綠。
  // 🔴🔴 **`'not-literal'` 自成一態**(同上 must-fix①):第一版寫
  //    `pr.initializer.kind === ts.SyntaxKind.TrueKeyword` ⇒ **凡不是字面 `true` 就算 false**
  //    ⇒ `printButton: someFlag` / `!false` 在執行期可能是 `true`, 而守門說它是 false。
  //    📌 **一個把「我看不懂」翻譯成「安全」的量具, 比沒有量具危險。**
  const out: PrintButtonArg[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'createElement' &&
      n.arguments[0] &&
      ts.isIdentifier(n.arguments[0]) &&
      (n.arguments[0] as ts.Identifier).text === 'StatementDoc'
    ) {
      const props = n.arguments[1];
      let v: PrintButtonArg = 'absent';
      if (props && ts.isObjectLiteralExpression(props)) {
        for (const pr of props.properties) {
          if (
            ts.isPropertyAssignment(pr) &&
            ts.isIdentifier(pr.name) &&
            pr.name.text === 'printButton'
          ) {
            v =
              pr.initializer.kind === ts.SyntaxKind.FalseKeyword
                ? 'false'
                : pr.initializer.kind === ts.SyntaxKind.TrueKeyword
                  ? 'true'
                  : 'not-literal';
          }
        }
      } else if (props) {
        // props 被抽成變數 / 展開 ⇒ 這把尺讀不出來, 不假裝讀得出來。
        v = 'not-literal';
      }
      out.push(v);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

describe('StatementDoc 的 client boundary(PDF 那條路自己 render, 沒有 Next 幫忙)', () => {
  const { seen, clients, unresolved } = walk(ROOT);

  it('量具自檢:真的走到了不只一支檔(只走到 1 支的話下面每一格都恆綠)', () => {
    expect(seen.size).toBeGreaterThan(3);
  });

  it("🔴 那棵樹裡的 'use client' 檔【只有】列印鈕那一支", () => {
    // 多一支 = PDF 那條路多一個會在線上炸而測試不會紅的點。
    // ⇒ 加新的 client 元件進這棵樹時, 這一格會紅 —— 那時要順便決定它在 PDF 路徑上怎麼辦。
    expect(clients).toEqual(['components/print/statement-print-button.tsx']);
  });

  it('🔴 這把尺【追不動】的相依必須是這一組 —— 多一個就要有人看一眼', () => {
    // 🛑 這一格不是在說那些相依有問題, 是在說**這把尺看不進去它們**。
    //    ⇒ 多出一個名字 ⇒ 紅 ⇒ 那一刻要有人回答:「它裡面有 'use client' 嗎?」
    //    ⇒ 答完之後把名字加進這個清單, 並在 commit body 寫下你怎麼答的。
    // 📌 **一個誠實的量具要能說出【我沒看的那一塊在哪】** ——
    //    而第一版是安靜地 `continue`, 那等於把盲區藏進綠燈裡。
    expect(unresolved).toEqual(['react']);
    // 🔵 只有 'react' —— 我原本【猜】會有 '@pcm/domain', 而它其實追得動(packages/domain/src)。
    //    量測改掉了我的猜測, 而如果我把猜測寫死當期望值, 這一格會恆紅然後被人放寬。
  });

  it('🟢 負對照:那把「找 use client」的尺不是恆真', () => {
    // statement-doc.tsx 自己不是 client 檔 ⇒ 它必須【不】在清單裡。
    expect(clients).not.toContain('components/print/statement-doc.tsx');
  });

  it('🔴 PDF 那條 route 的【每一個】StatementDoc 呼叫都要 printButton: false', () => {
    const args = printButtonArgs(PDF_ROUTE);
    // 🟢 正對照:真的找到了呼叫(空陣列 = 在對空氣比對, 而 `every` 對空陣列回 true)
    expect(args.length).toBeGreaterThan(0);
    // 🔴 `every` 而不是「有一個是 false」—— 多一個呼叫就多一個 500 的機會。
    expect(args).toEqual(args.map(() => 'false'));
  });

  it('🟢 那把 AST 尺的三格負對照:字串 / 非字面 / 多呼叫', () => {
    const tmp = join(dirname(PDF_ROUTE), 'zz-astctl.tmp.ts');
    const write = (body: string) =>
      writeFileSync(
        tmp,
        'import { createElement } from "react";\nconst StatementDoc = () => null;\n' + body,
      );
    try {
      // ① codex R2 反例:字串內容不是屬性
      write('export const x = createElement(StatementDoc, { fontFamily: "printButton: false" });');
      expect(printButtonArgs(tmp)).toEqual(['absent']);
      // ② codex R3 反例①:非字面值不可以被當成 false
      write('declare const f: boolean;\nexport const x = createElement(StatementDoc, { printButton: f });');
      expect(printButtonArgs(tmp)).toEqual(['not-literal']);
      // ③ codex R3 反例②:兩個呼叫, 危險的排前面 —— 不可以被後面那個蓋掉
      write(
        'export const a = createElement(StatementDoc, { printButton: true });\n' +
          'export const b = createElement(StatementDoc, { printButton: false });',
      );
      expect(printButtonArgs(tmp)).toEqual(['true', 'false']);
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  it('🔴 開關真的有接線:false 不渲染那個容器, true 才渲染', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { StatementDoc } = await import('./statement-doc');
    const off = renderToStaticMarkup(createElement(StatementDoc, { order: ORDER, printButton: false }));
    const on = renderToStaticMarkup(createElement(StatementDoc, { order: ORDER }));
    expect(off).not.toContain('stmt-actions');
    expect(on).toContain('stmt-actions');
    // 🛑 兩邊都渲染得出東西 —— 不然「不含 stmt-actions」在一個空字串上也會過。
    expect(off.length).toBeGreaterThan(500);
  });
});
