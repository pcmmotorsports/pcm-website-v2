import ts from 'typescript';

/**
 * 原始碼字面守門用的註解剝除器(storefront 共用)。
 *
 * 🔴 **為什麼不用 regex**(2026-08-30/31 線【客人帳戶區】`-08`;成因是量到的, 不是偏好):
 *    `scripts/storefront-projection-leak-guard.test.ts` 那道守門用 regex 剝註解, 被對抗審查
 *    **連打穿三次**, 而第二版**當天就在漏** ——
 *    `app/dev-preview/_components/PreviewHarness.tsx:8` 逐字 `// dev-preview/* 全部 route …`,
 *    收尾由 `:17` 的 `*​/` 提供 ⇒ 中間 **206 行真程式碼 / 27 支檔**從掃描裡消失。
 *    📌 **供給源是「`*​/` 這兩個字元」, 不是「註解」** —— 字串裡的 glob `'src/*'`、
 *       正則字面 `/a*​/` 自己就含收尾, 都會開/關一個假區塊。
 *    📌 **⇒ regex 當不了 tokenizer:「這兩個字元在不在」答不出「它在哪個語境裡」。**
 *
 * 🔴 **裸 `ts.createScanner` 也不夠**(第三版):它答不出帶 `${}` 的 template
 *    (那要 parser 驅動 `reScanTemplateToken`)⇒ 一支檔從第一個 `` `x${y}` `` 起整段錯讀,
 *    **而它的表現是「有剝掉一些」不是「整個壞掉」** ⇒ 半對的輸出最難發現。
 *
 * ✅ **本版用 parser**:走過**每一個 token**(`getChildren`, 不是 `forEachChild` ——
 *    後者跳過標點 token, 而 JSX 的 `{/* … *​/}` 正好掛在 `}` 上), 收 leading/trailing
 *    comment ranges, 只挖那些區間。字串 / template(含 `${}`)/ 正則字面 / JSX /
 *    U+2028 / 單獨 CR **全部由 parser 免費答對**。
 *
 * ⚠️ **`fileName` 不是裝飾**:`.tsx` / `.jsx` 要走 `ScriptKind.TSX` ——
 *    `<Foo>` 在兩種 ScriptKind 下語意相反(型別斷言 vs JSX 元素), 判錯會整支檔錯讀。
 * ⚠️ **殘留盲區**:①parser 對語法壞掉的檔容錯, 可能少認一段註解 ⇒ 方向是**多留**(誤紅), 不是漏放。
 *    ②只做文字層:跳脫序列拼出來的字面(`"shipments"`)照樣掃不到。
 *
 * 🛑 **admin 側同名的 `apps/admin/src/lib/test-support/strip-comments.ts` 仍是 regex 版** ——
 *    那三支受影響的 guard 由 admin 那條線處理, 本檔**不跨線改它**。兩份會有一段時間不一致。
 */
export function stripComments(source: string, fileName = 'probe.ts'): string {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const cuts: Array<[number, number]> = [];
  const add = (rs: readonly ts.CommentRange[] | undefined) => {
    for (const r of rs ?? []) cuts.push([r.pos, r.end]);
  };
  const visit = (n: ts.Node): void => {
    add(ts.getLeadingCommentRanges(source, n.getFullStart()));
    add(ts.getTrailingCommentRanges(source, n.getEnd()));
    for (const c of n.getChildren(sf)) visit(c);
  };
  visit(sf);
  // 同一段註解會被相鄰 token 各報一次 ⇒ 排序後跳過已涵蓋的區間(否則 slice 會把碼切碎)
  cuts.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = '';
  let last = 0;
  for (const [a, b] of cuts) {
    if (b <= last) continue;
    out += source.slice(last, Math.max(a, last));
    last = b;
  }
  return out + source.slice(last);
}
