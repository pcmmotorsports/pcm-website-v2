// statement-html.ts —— 🔵 **本體 2026-09-06 搬進 `@pcm/pdf`**(⟦f3-SHIPPDF1⟧ P-2)。
//
// 🔴 **為什麼搬**:後台的出貨單要走同一條產檔路, 而它需要**同一支組裝原語**。
//    複製一份 ⇒ 兩份會分岔, 而**分岔的那一天沒有訊號**(本 repo 記過)。
// 🔴 **為什麼這支檔還在**:顧客站那一族既有測試從這個路徑 import 它們,
//    而本片(與 P-1)的驗收條件逐字是「顧客站那些測試【零改動】」
//    ⇒ 📌 **改測試去配合搬家 = 把守門搬成我要的形狀。** 所以留一層 re-export。
// 🛑 而**新的呼叫端請直接用 `@pcm/pdf`** —— 這一層只為既有的那些留著。
export {
  buildStatementHtml,
  codepointsOfHtml,
  isInsideDir,
  parseFontFaces,
  type BuildResult,
  type ParsedFace,
} from '@pcm/pdf';
