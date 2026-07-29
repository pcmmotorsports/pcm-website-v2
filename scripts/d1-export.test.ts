import { describe, expect, it } from 'vitest';

import { D1_COHORT } from './d1-cohort';
import { buildExportScript } from './d1-export';

const script = buildExportScript('/tmp/d1');

/** 相依表清單 = 規格 §8.4 步驟 3 逐字;少一張 = 那張表的資料刪掉就回不來。 */
const REQUIRED_TABLES = [
  'orders',
  'order_items',
  'order_legal_consents',
  'payment_charge_attempts',
  'pending_invoices',
  'email_outbox',
  'order_refunds',
  'order_refund_items',
  'payment_double_charge_anomalies',
  'payment_double_charge_anomaly_events',
] as const;

describe('buildExportScript', () => {
  it('十張相依表一張都不能少', () => {
    // 只抓 \copy 的主表,不抓子查詢裡的 FROM(order_refunds / anomalies 都會在子查詢出現)。
    const copied = [...script.matchAll(/^\\copy \(SELECT \* FROM public\.(\w+) WHERE/gm)].map(
      ([, t]) => t,
    );

    expect(copied).toEqual([...REQUIRED_TABLES]);
  });

  it('29 個 cohort UUID 全數帶進 SQL', () => {
    for (const { id } of D1_COHORT) {
      expect(script).toContain(`'${id}'`);
    }
  });

  // 🔴 這兩張表沒有 order_id(anomalies 只有 old_order_id、events 只有 anomaly_id)。
  //    用通用的 `order_id IN (...)` 對它們必然出錯 —— 規格 R13 抓過同一個坑。
  it('無 order_id 的兩張表走各自的關聯欄,不是通用 order_id', () => {
    expect(script).toContain('payment_double_charge_anomalies WHERE old_order_id IN');
    expect(script).toMatch(
      /payment_double_charge_anomaly_events WHERE anomaly_id IN \(SELECT id FROM public\.payment_double_charge_anomalies/,
    );
    expect(script).not.toMatch(/payment_double_charge_anomal\w+ WHERE order_id/);
  });

  // 🔴 server-side `COPY ... TO` 寫的是資料庫伺服器的檔案系統,在 Supabase 上拿不到檔案。
  //    只有 psql 客戶端的 `\copy` 會寫本機。
  it('用客戶端 \\copy 而非 server-side COPY', () => {
    expect(script).not.toMatch(/^COPY /m);
    expect([...script.matchAll(/^\\copy /gm)]).toHaveLength(REQUIRED_TABLES.length);
  });

  // 🔴 CSV 預設把 NULL 與空字串混同,還原時會違反部分唯一索引語意。restore 端需同格式。
  it('每張表都定死 CSV 格式與 NULL 表示法', () => {
    expect([...script.matchAll(/WITH \(FORMAT csv, HEADER, NULL '\\N'\)/g)]).toHaveLength(
      REQUIRED_TABLES.length,
    );
  });

  it('產出 manifest:時間戳 + 行數 + sha256', () => {
    expect(script).toContain('manifest.txt');
    expect(script).toMatch(/date -u/);
    expect(script).toMatch(/wc -l/);
    expect(script).toMatch(/shasum -a 256/);
  });
});
