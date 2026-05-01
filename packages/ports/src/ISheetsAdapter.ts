import type { SheetRangeSpec, SheetRow } from '@pcm/domain';

/**
 * ISheetsAdapter: Google Sheets 讀取 port。
 *
 * Phase 1 範圍只讀、不寫(M-5 sync-engine 從 Sheets 讀候選、寫候選進 Medusa、不寫回 Sheets)。
 * 對齊 PHASE-1-MILESTONES §8 M-5-02 sheets-api adapter(Service Account 認證)。
 */
export interface ISheetsAdapter {
  readRange(spec: SheetRangeSpec): Promise<SheetRow[]>;
}
