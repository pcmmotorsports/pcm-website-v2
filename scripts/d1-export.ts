/**
 * D1a1:cohort 匯出腳本產生器。
 *
 * **這支程式不連資料庫、不寫檔案 —— 它把 psql 指令印到 stdout,由 psql 去做事。**
 * 匯出用 psql 的 `\copy`(客戶端寫本機檔);server-side `COPY ... TO` 寫的是資料庫
 * 伺服器的檔案系統,在 Supabase 上拿不到。`pg_dump --data-only` 也不行 —— 不能按列篩。
 *
 * 用法(輸出目錄必須已存在)—— 🔴 **兩段必須用 && 串接**:
 *   npx tsx scripts/d1-export.ts <輸出目錄> | psql "$D1_DB_URL" -v ON_ERROR_STOP=1 \
 *     && shasum -a 256 <輸出目錄>/*.csv > <輸出目錄>/checksums.txt
 *
 * 🔴 校驗碼**故意不放在 psql 的 `\!` 裡**(codex R1-P2):`\!` 的失敗只會更新
 * `SHELL_EXIT_CODE`,psql 不會因此中止,結果是磁碟滿或工具缺了照樣印「完成」、
 * 交出一份沒有校驗碼的備份。改用 `&&` 串接:psql 失敗就不會跑到 shasum,
 * shasum 失敗操作者當場看到非零退出。
 *
 * 🔴 cohort 直接 import `d1-cohort.ts`,**不在本檔重抄一份 UUID** —— 兩份清單會漂移,
 * 而漂移的後果是「匯出的不是即將被刪的那批」,出事時才會發現救不回來。
 *
 * 🔴 這份匯出是 D1c 刪除後**唯一的還原路徑**(保存 180 天)。因此:
 * ①0 列的表也要匯,留一個只有表頭的空檔證明「當時就是 0 列」——
 *   「沒有檔案」跟「當時是 0 列」在事後長得一樣,意義卻完全不同。
 * ②格式定死 `FORMAT csv, HEADER, NULL '\N'` —— CSV 預設會把 NULL 與空字串混同,
 *   還原時會違反部分唯一索引的語意。restore 端必須用同一組設定。
 *
 * 2026-07-29 以唯讀 count 對 production 實跑十張表的 selector,數字與規格 §8.4
 * 逐格相符:orders 29 / order_items 39 / order_legal_consents 4 /
 * payment_charge_attempts 27 / pending_invoices 3,其餘五張 0 列。
 */
import { D1_COHORT, D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { D1_TRANSACTION_GUARD_SQL } from './d1-guard';

/**
 * `PCM-2026-0101` 的「沒扣到錢」是 **Sean 本人查 TapPay 後確認、非系統 read-back**
 * (2026-07-29 拍板 A0a-1)。半年後看這包備份的人必須看得到這件事的證據等級,
 * 否則會誤以為每一筆都有系統證據。規格要求寫進 migration 註解 / manifest / audit 三處。
 */
function evidenceNote(displayId: string): string {
  return displayId === 'PCM-2026-0101'
    ? "'未扣款證據 = Sean 本人查 TapPay 確認(2026-07-29),非系統 read-back'"
    : "''";
}

/**
 * 逐表 selector。**每張表寫死自己的條件、不共用一句通用 WHERE** ——
 * 有兩張表根本沒有 order 欄位,通用寫法在它們身上必然出錯(規格 R13 抓過)。
 */
export function buildExportScript(outDir: string): string {
  const cohort = D1_COHORT.map(({ id }) => `'${id}'`).join(', ');

  const tables: ReadonlyArray<readonly [table: string, where: string]> = [
    ['orders', `id IN (${cohort})`],
    ['order_items', `order_id IN (${cohort})`],
    ['order_legal_consents', `order_id IN (${cohort})`],
    ['payment_charge_attempts', `order_id IN (${cohort})`],
    ['pending_invoices', `order_id IN (${cohort})`],
    ['email_outbox', `order_id IN (${cohort})`],
    ['order_refunds', `order_id IN (${cohort})`],
    // 🔴 兩條路都撈:本表自己有 order_id(規格說要繞 order_refunds 是多繞的,2026-07-29
    //    實查),但備份寧可多撈不可少撈 —— 兩欄若曾不一致,少撈就救不回來。
    [
      'order_refund_items',
      `order_id IN (${cohort}) OR refund_id IN (SELECT id FROM public.order_refunds WHERE order_id IN (${cohort}))`,
    ],
    // 🔴 本表無 order_id,關聯欄是 old_order_id(實查確認,無 new_order_id 欄)。
    ['payment_double_charge_anomalies', `old_order_id IN (${cohort})`],
    // 🔴 本表只有 anomaly_id、完全沒有 order 欄位,必須經 anomalies 繞。
    //    restore 與「零殘留」驗收必須用同一組關聯,否則對不起來。
    [
      'payment_double_charge_anomaly_events',
      `anomaly_id IN (SELECT id FROM public.payment_double_charge_anomalies WHERE old_order_id IN (${cohort}))`,
    ],
  ];

  // cohort manifest:記錄「這包備份的範圍是什麼、從哪裡來」。codex R1-P2 抓到原版只有
  // 檔案雜湊、沒有刪留範圍 ⇒ 備份離開這個 checkout 之後就證明不了自己涵蓋哪些單。
  // 另記 current_database() 與叢集識別碼:半年後要能證明這包確實出自正式站,而不是
  // 某次演練用的複製庫。
  const manifestRows = [
    ...D1_DELETE_COHORT.map(
      ({ id, displayId }) =>
        `      ('${id}'::uuid, '${displayId}', 'delete', ${evidenceNote(displayId)})`,
    ),
    ...D1_RETAIN_COHORT.map(
      ({ id, displayId }) => `      ('${id}'::uuid, '${displayId}', 'retain', '')`,
    ),
  ].join(',\n');

  return [
    `\\echo D1a1 cohort 匯出:${D1_COHORT.length} 張訂單 / ${tables.length} 張表`,
    // 🔴 codex R1-P1:十道 \copy 在 autocommit 下各自取到**不同時間點**的快照。
    //    正式匯出期間只要 sweeper 或付款回寫動到 cohort,還原出來就會是一個
    //    **從來沒存在過的狀態**(A 表是 10:00 的、B 表是 10:02 的)。
    //    這是刪除後唯一的還原路徑,必須整包同一個快照。
    //    READ ONLY 是第二道:本腳本在任何情況下都不該寫到 production。
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    // 🔴 **重用 D1a0 的守門,不另寫一套**(2026-07-29 教訓:同一題在 repo 裡已有解時
    //    自創第二套,結果是兩套都要維護、而且新的那套漏洞更多)。
    //    連錯資料庫的後果:拿到一份看起來正常、其實是別的庫的備份,而它是刪除後
    //    唯一的還原路徑 —— 發現時已經來不及。守門在交易第一步,不符即整個交易中止。
    D1_TRANSACTION_GUARD_SQL,
    ...tables.flatMap(([table, where]) => [
      `\\echo -- ${table}`,
      `\\copy (SELECT * FROM public.${table} WHERE ${where}) TO '${outDir}/${table}.csv' WITH (FORMAT csv, HEADER, NULL '\\N')`,
    ]),
    `\\echo -- cohort-manifest(刪留範圍 + 匯出時間)`,
    `\\copy (SELECT m.display_id, m.id, m.membership, m.evidence, now() AS exported_at, current_database() AS db, (SELECT system_identifier FROM pg_control_system()) AS cluster_id FROM (VALUES\n${manifestRows}\n    ) AS m(id, display_id, membership, evidence) ORDER BY m.display_id) TO '${outDir}/cohort-manifest.csv' WITH (FORMAT csv, HEADER, NULL '\\N')`,
    'COMMIT;',
    `\\echo 完成。校驗碼請接著跑(見本檔用法):shasum -a 256 ${outDir}/*.csv`,
  ].join('\n');
}

if (process.argv[1]?.endsWith('d1-export.ts')) {
  const outDir = process.argv[2];

  if (!outDir) {
    console.error('用法:npx tsx scripts/d1-export.ts <輸出目錄> | psql "$D1_DB_URL" -v ON_ERROR_STOP=1');
    process.exit(1);
  }

  console.log(buildExportScript(outDir));
}
