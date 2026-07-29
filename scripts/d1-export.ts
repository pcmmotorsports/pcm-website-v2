/**
 * D1a1:cohort 匯出腳本產生器。
 *
 * **這支程式不連資料庫、不寫檔案 —— 它把 psql 指令印到 stdout,由 psql 去做事。**
 * 匯出用 psql 的 `\copy`(客戶端寫本機檔);server-side `COPY ... TO` 寫的是資料庫
 * 伺服器的檔案系統,在 Supabase 上拿不到。`pg_dump --data-only` 也不行 —— 不能按列篩。
 *
 * 用法(輸出目錄必須已存在):
 *   npx tsx scripts/d1-export.ts <輸出目錄> | psql "$D1_DB_URL" -v ON_ERROR_STOP=1
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
import { D1_COHORT } from './d1-cohort';

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

  return [
    `\\echo D1a1 cohort 匯出:${D1_COHORT.length} 張訂單 / ${tables.length} 張表`,
    ...tables.flatMap(([table, where]) => [
      `\\echo -- ${table}`,
      `\\copy (SELECT * FROM public.${table} WHERE ${where}) TO '${outDir}/${table}.csv' WITH (FORMAT csv, HEADER, NULL '\\N')`,
    ]),
    // manifest:時間戳(判 24 小時新鮮度)+ 逐檔行數 + sha256(判有沒有被動過)。
    `\\! date -u '+匯出時間 (UTC) %Y-%m-%dT%H:%M:%SZ' > '${outDir}/manifest.txt'`,
    `\\! wc -l '${outDir}'/*.csv >> '${outDir}/manifest.txt'`,
    `\\! shasum -a 256 '${outDir}'/*.csv >> '${outDir}/manifest.txt'`,
    `\\echo 完成。manifest = ${outDir}/manifest.txt`,
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
