import { listSupplierRows, type SupplierRow } from './supplier-repository';

// M-4b E10 S3a:供應商選單的業務層(只做讀;寫入呼叫端在 S3b)。

/** 供應商選單項目。id 寫進採購列的 supplier_id;label 供 UI 顯示。 */
export interface SupplierOption {
  readonly id: string;
  readonly label: string;
}

// Sean 2026-08-01 深夜拍板 B:排序在程式碼裡做、釘死 zh-TW,不交給 DB 的 ORDER BY。
// 🔴 實測(node v22.22.3)zh-TW 的順序 = **中文全部排在英文前面,中文之間按筆畫**:
//    安豐達 / 老吳精品 / 阿毅物流 / 陳蔚仁 / 豪元國際 / AKOSO / E PLOT / Webike TW / WRS s.r.l
//    (JS 預設 .sort() 是 code point ⇒ 英文在前、中文在後,兩者不同。)
//    這個順序被 supplier.test.ts 的中英混排向量釘死 ⇒ 換掉 collator 或改回預設排序會轉紅。
const SUPPLIER_COLLATOR = new Intl.Collator('zh-TW');

/**
 * 讀取**啟用中**的供應商,依 zh-TW 規則排序。
 *
 * 🔴 錯誤**往上拋**,不照 `listActiveStaff` 那樣吞掉回空陣列 —— 兩者的空清單意義不同:
 *    員工挑選器空掉只是擋住操作;**供應商選單空掉會讓員工以為「這家不存在」而建立重複供應商**,
 *    而供應商**不可刪除** ⇒ 製造永久垃圾列。由呼叫端(S3b 頁面)接住並顯示「載入失敗」,
 *    形狀對齊 `app/settings/staff/page.tsx` 的 loadFailed banner。
 */
export async function listSuppliers(): Promise<SupplierOption[]> {
  const rows = await listSupplierRows();
  return sortSuppliersByLabel(
    rows.filter((row) => row.is_active).map(({ id, label }) => ({ id, label })),
  );
}

/**
 * 依釘死的 zh-TW 規則排序。**本檔唯一的排序入口**(S3b-3)。
 *
 * 🔴 **為什麼要抽出來**:設定頁要顯示**全部**列(含停用),選單只要啟用的 ——
 *    兩條路各自 `new Intl.Collator` 的話,兩組「結果順序」測試會**同時綠**,
 *    而它們排的其實是兩份各自獨立、可以各自漂移的規則(plan §3.2 `[K1-M10]`)。
 *    單一來源要靠**兩條性質不同**的斷言合起來釘:①行為層(兩支各用中英混排亂序向量)
 *    ②結構層(`apps/admin/src` 非測試碼裡 `new Intl.Collator` 恰 1 處)。
 * 🔴 **誠實**:第 2 條是文字層斷言,擋不住「在別的檔案裡另建一份**並且**繞過本函式」——
 *    它只保證「多出第二份 collator 會被看見」,不保證「所有排序都經過這裡」。
 *
 * 不就地排序(`toSorted` 語意):輸入是唯讀陣列,回傳新陣列。
 *
 * 🔴 **同分要有 tiebreak**(R1 抓):collator 對「只差零寬字元」的兩個 label 回 **0**
 *    (親測 node v22:`compare('AKOSO\u200b','AKOSO') === 0`),而 `listSupplierRows`
 *    刻意不下 `ORDER BY` ⇒ 同分兩列的相對順序 = DB 回傳順序 = **跨請求不保證穩定**。
 *    而「內部零寬字造成的實質重複」正是本線明文不擋的情形 ⇒ 這種列真的會存在。
 *    退回碼位比較把它全序化,員工不會看到清單每次重整就換位。
 */
export function sortSuppliersByLabel<T extends { readonly label: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      SUPPLIER_COLLATOR.compare(a.label, b.label) ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
}

/**
 * 設定頁用:**全部**供應商(含已停用),同一把排序。
 *
 * 🔴 與 `listSuppliers` 的差別只有「不過濾 `is_active`」—— 停用的列必須回得來,
 *    否則 S3b-3 做不到「撞到已停用同名時定位到那一列 + 讓員工自己按啟用」(Sean Q2=A)。
 * 🔴 錯誤同樣**往上拋**(理由見 `listSuppliers`:供應商清單空掉會製造永久垃圾列)。
 */
export async function listSuppliersForSettings(): Promise<SupplierRow[]> {
  return sortSuppliersByLabel(await listSupplierRows());
}
