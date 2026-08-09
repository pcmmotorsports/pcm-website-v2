/**
 * 原始碼字面守門用的註解剝除器(admin 共用)。
 *
 * 🔴 **住在非 `.test.ts` 檔**:原本它 `export` 在 `app-sidebar.test.ts` 裡,而別的測試 import 它時
 * vitest 會把**那支檔的 `describe` 一起註冊進 importer** ⇒ 同一組測試被跑兩次
 * (code-reviewer 實測輸出可見重複)。搬出來就沒有這個副作用。
 *
 * 🔴 剝 `/* *​/` 是必要的:守門若只剝 `//`,把違規那行用區塊註解包起來就全綠 —— 而 CSS 只有區塊註解。
 * 🔴 行註解那一步用 `(?<!:)` 排除 `https://` 這種**字串裡的**雙斜線(codex K2 R2 nit:
 *    裸 `\/\/[^\n]*` 會把 `href: 'https://example.com/x'` 截斷 ⇒ 那一項從解析結果消失、測試假紅)。
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');
}
