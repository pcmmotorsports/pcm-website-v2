import { rpcTrim } from './supplier-form';

// supplier-candidates.ts — M-4b E10 S3b-3:新增供應商時的 typeahead 候選過濾。
//
// 🔴 **純函式、零 React 依賴、零 IO**。理由是 Sean D1=B 的整個成立基礎:
//    原生 `<datalist>` 的比對規則由**瀏覽器**決定、各家不同 ⇒ 「打 Webike 恰 3 筆」
//    這種驗收在單元測試裡釘不住。自己寫比對才測得住 —— 但只有在**邏輯不在元件裡**時才成立。
//    ⇒ 元件只准呼叫本函式,不准自己另寫一套比對(否則「恰 3 筆」又退回 jsdom 才測得到)。
//
// 🔴 **它是提醒,不是關卡**(Sean D2=A):員工無視候選照樣送得出去,而那正是拍板 1
//    「供應商可自行再增加」的字面要求。母 plan 驗收 16 後半「不得變成自由文字新增」
//    已移交 A10b 採購表單 —— **不要在這裡加擋人的邏輯**。
//
// 🔴 **這條防線擋得住什麼、擋不住什麼**(不得說成「撞名問題解決了」):
//    擋得住 = 員工打字時**看得到**已存在的同名/近似名(含已停用的)。
//    擋不住 = 大小寫變體、內部連續空白、標點差異所造成的**實質重複**
//             —— `suppliers_label_unique` 是區分大小寫的普通 UNIQUE,
//             `akoso` 與 `AKOSO` 會被 DB 視為兩家、乾脆回 `CREATED`、零錯誤、且**永久刪不掉**。
//    ⇒ 真正的防線是**人眼**。本函式的工作是讓那雙眼睛看得到東西。

/** 候選列。刻意用結構型別而非綁死 `SupplierRow` —— 測試餵得進最小向量。 */
export interface SupplierCandidateLike {
  readonly label: string;
  readonly is_active: boolean;
}

/**
 * 過濾候選:**包含**比對、大小寫不敏感、前後空白不影響、**含已停用的列**。
 *
 * 🔴 `toLowerCase()` 不是 `toLocaleLowerCase()`：後者吃**執行環境的**地區設定,
 *    土耳其語 locale 會把 `I` 映成 `ı` ⇒ 同一份名單在不同機器上得到不同候選。
 *    這是 S3a 的 `lower()` collation 坑的 JS 版(memory `project_m4b-a5b-canonical-key-decisions`)。
 * 🔴 **但 `toLowerCase()` 不是 case folding、也不做 Unicode 正規化**(R1 要求說滿):
 *    `Straße` 與 `STRASSE` 永不互相命中(`'STRASSE'.toLowerCase()` = `strasse`、
 *    `'Straße'.toLowerCase()` = `straße`);`İ`(U+0130)小寫成 `i`+U+0307 兩碼位
 *    ⇒ 打 `istanbul` 找不到 `İSTANBUL`;NFC/NFD 不同寫法的同一個字也不互相命中。
 *    CJK 沒有大小寫映射 ⇒ 中文名不受這三點影響。**這些都是「人眼防線」本來就漏的**,
 *    不是本函式該補的 —— 但不得說成「大小寫已經處理好了」。
 * 🔴 **含已停用的列是刻意的**(plan §3.5 契約債②的**送出前**防線):
 *    停用的同名供應商照樣會讓 RPC 回 `DUPLICATE_LABEL`,員工若在候選裡看不到它,
 *    就只能在送出後才撞牆。這裡讓他送出**之前**就看到,連同「(已停用)」標記。
 * 🔴 **不排序**:輸入該是已經排好的(`sortSuppliersByLabel`),本函式只做過濾,
 *    保持輸入順序 ⇒ 單一排序來源那條結構斷言才守得住。
 */
export function filterSupplierCandidates<T extends SupplierCandidateLike>(
  rows: readonly T[],
  query: string,
): T[] {
  // 用 rpcTrim 而非 `.trim()`:同一把尺(31 碼位全集),否則使用者貼上帶零寬空白的
  // 名稱時,這裡判「有查詢字串」而解析器判「空白」⇒ 候選空掉但表單過得了。
  // 空 query ⇒ needle 是 `''` ⇒ `includes('')` 恆真 ⇒ 自然回全部。
  // 🔴 這裡**刻意沒有** `if (needle === '') return [...rows]` 的 early return(R1 抓):
  //    那行是語意冗餘 —— 刪掉行為完全相同,所以它**突變不掉**,留著只是假裝有一道分支。
  const needle = rpcTrim(query).toLowerCase();
  return rows.filter((row) => row.label.toLowerCase().includes(needle));
}
