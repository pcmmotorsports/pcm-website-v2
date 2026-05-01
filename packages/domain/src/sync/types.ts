/**
 * SheetRangeSpec: Google Sheets 讀取範圍(value-object)。
 *
 * 對齊 PHASE-1-MILESTONES §8 M-5-02 sheets-api adapter;
 * `range` 字面為 Google Sheets API A1 notation(例:'Sheet1!A:Z' / 'A1:Z1000')。
 * 命名為 wire-aligned(adapter 內部用)、業務語意層用 SyncResult。
 */
export type SheetRangeSpec = {
  spreadsheetId: string;
  /** A1 notation、例:'Sheet1!A:Z' */
  range: string;
};

/**
 * SheetRow: Google Sheets 單筆 row(value-object)。
 *
 * `rowIndex` 為 Sheets 原始 1-based row index;
 * `values` 為該 row 各欄位字串值。命名 wire-aligned(adapter 內部用)。
 */
export type SheetRow = {
  /** 1-based row index(對齊 Sheets API) */
  rowIndex: number;
  /** 各欄位字串值 */
  values: string[];
};

/**
 * SyncResult: sync-engine 同步結果(domain value-object)。
 *
 * 對齊 PHASE-1-MILESTONES §8 M-5-03(sync-product-candidates 等);
 * 業務語意層、不對齊任何 wire format。
 */
export type SyncResult = {
  rowsRead: number;
  rowsWritten: number;
  /** 錯誤行的描述、空陣列表示無錯 */
  errors: string[];
};
