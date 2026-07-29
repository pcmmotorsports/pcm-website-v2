import { describe, expect, it } from 'vitest';

import { D1_COHORT } from './d1-cohort';
import { buildExportScript } from './d1-export';
import { D1_TRANSACTION_GUARD_SQL } from './d1-guard';

const script = buildExportScript('/tmp/d1');

/**
 * 相依表清單 = 規格 §8.4 步驟 3 逐字;少一張 = 那張表的資料刪掉就回不來。
 * 前五張是 2026-07-29 Sean 拍板 Q1 補的**父表** —— cohort 指向它們,D1c 之後 FK 保護消失。
 */
const REQUIRED_TABLES = [
  'customers',
  'customer_addresses',
  'products',
  'product_variants',
  'legal_terms_versions',
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

  // 🔴 只看匯出那幾行,不看整份腳本 —— manifest 段落也帶了 29 個 UUID,
  //    拿整份腳本比對的話,「selector 只帶前 5 筆」這種缺陷會被 manifest 蓋掉
  //    (突變測試實測抓到)。
  it('29 個 cohort UUID 全數帶進每一道匯出 selector', () => {
    const copyLines = script.split('\n').filter((l) => l.startsWith('\\copy (SELECT * FROM public.'));

    expect(copyLines).toHaveLength(REQUIRED_TABLES.length);
    for (const line of copyLines) {
      for (const { id } of D1_COHORT) {
        expect(line).toContain(`'${id}'`);
      }
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
  // 11 = 十張相依表 + 一份 cohort manifest。
  it('用客戶端 \\copy 而非 server-side COPY', () => {
    expect(script).not.toMatch(/^COPY /m);
    expect([...script.matchAll(/^\\copy /gm)]).toHaveLength(REQUIRED_TABLES.length + 1);
  });

  // 🔴 CSV 預設把 NULL 與空字串混同,還原時會違反部分唯一索引語意。restore 端需同格式。
  it('每份輸出都定死 CSV 格式與 NULL 表示法(含 manifest)', () => {
    expect([...script.matchAll(/WITH \(FORMAT csv, HEADER, NULL '\\N'\)/g)]).toHaveLength(
      REQUIRED_TABLES.length + 1,
    );
  });

  // 🔴 codex R1-P1:十道 \copy 在 autocommit 下各自取到不同時間點的快照,還原出來
  //    會是一個從來沒存在過的狀態。整包必須框在同一個唯讀快照裡。
  it('十張表框在同一個 REPEATABLE READ READ ONLY 交易內', () => {
    const lines = script.split('\n');
    const begin = lines.findIndex((l) => l.startsWith('BEGIN '));
    const commit = lines.findIndex((l) => l.startsWith('COMMIT;'));

    expect(lines[begin]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    expect(commit).toBeGreaterThan(begin);
    // 每一道 \copy 都必須落在 BEGIN 與 COMMIT 之間。
    lines.forEach((line, i) => {
      if (line.startsWith('\\copy ')) {
        expect(i).toBeGreaterThan(begin);
        expect(i).toBeLessThan(commit);
      }
    });
  });

  // 🔴 codex R1-P2:`\!` 的失敗只更新 SHELL_EXIT_CODE、psql 不會中止 ⇒ 磁碟滿時
  //    照樣印「完成」、交出沒有校驗碼的備份。改用 && 串接,失敗當場非零退出。
  it('校驗碼不放在 psql 的 \\! 裡(失敗不會中止 psql)', () => {
    expect(script).not.toMatch(/\\!/);
  });

  // 🔴 2026-07-29 首次實跑踩到:psql 的 \\copy 是客戶端 meta-command、**不跨行**,
  //    多行會噴 `\\copy: parse error at end of line`。原測試只驗「指令內容對」、
  //    沒驗「指令是不是一行」⇒ 十張表都過、manifest 那道掛掉。
  it('每一道 \\copy 都必須在自己那一行結束(psql meta-command 不跨行)', () => {
    const copyLines = script.split('\n').filter((l) => l.startsWith('\\copy '));

    expect(copyLines).toHaveLength(REQUIRED_TABLES.length + 1);
    // 🔴 只數「有幾道 \copy」抓不到折行 —— 折行之後它還是只出現一次。
    //    要驗的是每一行自己有沒有走完整道指令:結尾必須是 WITH 子句。
    for (const line of copyLines) {
      expect(line.endsWith("WITH (FORMAT csv, HEADER, NULL '\\N')")).toBe(true);
    }
  });

  // 🔴 codex R1-P2:manifest 要能獨立證明「這包備份涵蓋誰、誰該刪誰該留」。
  // 🔴 重用 D1a0 守門(不自創第二套)。連錯資料庫 = 拿到一份看起來正常、
  //    其實出自別的庫的備份,而它是刪除後唯一的還原路徑。
  it('交易第一步就是 D1a0 的環境守門', () => {
    const body = script.slice(script.indexOf('BEGIN ISOLATION LEVEL'));
    const guardAt = body.indexOf(D1_TRANSACTION_GUARD_SQL);
    const firstCopyAt = body.indexOf('\\copy ');

    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(firstCopyAt);
  });

  it('manifest 記錄來源資料庫與叢集識別碼', () => {
    expect(script).toContain('current_database() AS db');
    expect(script).toContain('system_identifier FROM pg_control_system()) AS cluster_id');
  });

  it('cohort manifest 記錄刪留範圍、匯出時間與 0101 的證據等級', () => {
    expect(script).toContain('cohort-manifest.csv');
    expect(script).toContain('now() AS exported_at');
    expect([...script.matchAll(/, 'delete', /g)]).toHaveLength(26);
    expect([...script.matchAll(/, 'retain', /g)]).toHaveLength(3);
    expect(script).toContain('非系統 read-back');
  });
});
