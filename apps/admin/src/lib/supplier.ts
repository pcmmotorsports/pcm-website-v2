import { listSupplierRows } from './supplier-repository';

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
  return rows
    .filter((row) => row.is_active)
    .map(({ id, label }) => ({ id, label }))
    .sort((a, b) => SUPPLIER_COLLATOR.compare(a.label, b.label));
}
