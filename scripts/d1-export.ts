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
 *
 * 🔴 **匯出與還原共用本函式,不各抄一份**:還原必須撈回匯出撈走的同一組表、用同一組
 * 關聯(規格 §8.4 步驟 3 逐字要求「restore 與零殘留驗收使用相同關聯」)。兩份清單一旦
 * 漂移,後果是「還原少一張表」——而那要等真的需要還原的那天才會發現。
 *
 * 兩個參數就是兩邊的全部差異:
 * - `cohort`:匯出用 29 張(含留存 3 張),還原只用 26 張(留存的還在庫裡、不得重插)
 * - `source`:子查詢要指向哪裡。匯出查 `public.*`;還原時 cohort 的列已從 `public.*`
 *   刪光,只能查剛載入的暫存表 `d1r_*`
 *
 * 回傳順序 = **FK 家長優先**,對匯出無所謂、對還原是硬需求(實查 FK 圖確認:
 * order_refund_items 依賴 order_refunds 與 order_items、anomaly_events 依賴 anomalies,
 * 本順序皆滿足)。
 */
export function buildCohortSelectors(
  cohort: readonly string[],
  source: (table: string) => string,
): ReadonlyArray<readonly [table: string, where: string]> {
  const list = cohort.map((id) => `'${id}'`).join(', ');
  const orders = source('orders');
  const items = source('order_items');
  const consents = source('order_legal_consents');
  const variants = source('product_variants');

  return [
    // 🔴 **父表在前**(2026-07-29 Sean 拍板 Q1;codex R1 抓)。這五張不是 cohort 的一部分,
    //    是 cohort **指向**的東西。現在有 FK 擋著它們被刪,但 **D1c 刪掉訂單那一刻保護就消失** ——
    //    之後任何一列被刪(地址刪除是既有功能、商品會下架),還原就整批失敗,
    //    而那是唯一的救命路徑。還原時以 ON CONFLICT DO NOTHING 只補缺的、不覆蓋現值。
    // 🔴 `auth.users` **刻意不收**(Sean 拍板 Q3=A):含密碼雜湊與 token。
    //    殘餘風險 = 客人自刪帳號則 customers 連帶 CASCADE 消失、該筆救不回,已明列並拍板接受。
    [
      'customers',
      `user_id IN (SELECT customer_user_id FROM ${orders} WHERE id IN (${list}) AND customer_user_id IS NOT NULL)`,
    ],
    [
      'customer_addresses',
      `id IN (SELECT address_id FROM ${orders} WHERE id IN (${list}) AND address_id IS NOT NULL)`,
    ],
    [
      'products',
      `id IN (SELECT product_id FROM ${variants} WHERE id IN (SELECT variant_id FROM ${items} WHERE order_id IN (${list}) AND variant_id IS NOT NULL))`,
    ],
    [
      'product_variants',
      `id IN (SELECT variant_id FROM ${items} WHERE order_id IN (${list}) AND variant_id IS NOT NULL)`,
    ],
    // FK 指的是 legal_terms_versions(version),不是 id(實查 confkey 確認)。
    [
      'legal_terms_versions',
      `version IN (SELECT terms_version FROM ${consents} WHERE order_id IN (${list}))`,
    ],
    ['orders', `id IN (${list})`],
    ['order_items', `order_id IN (${list})`],
    ['order_legal_consents', `order_id IN (${list})`],
    ['payment_charge_attempts', `order_id IN (${list})`],
    ['pending_invoices', `order_id IN (${list})`],
    ['email_outbox', `order_id IN (${list})`],
    ['order_refunds', `order_id IN (${list})`],
    // 🔴 兩條路都撈:本表自己有 order_id(規格說要繞 order_refunds 是多繞的,2026-07-29
    //    實查),但備份寧可多撈不可少撈 —— 兩欄若曾不一致,少撈就救不回來。
    [
      'order_refund_items',
      `order_id IN (${list}) OR refund_id IN (SELECT id FROM ${source('order_refunds')} WHERE order_id IN (${list}))`,
    ],
    // 🔴 本表無 order_id,關聯欄是 old_order_id(實查確認,無 new_order_id 欄)。
    ['payment_double_charge_anomalies', `old_order_id IN (${list})`],
    // 🔴 本表只有 anomaly_id、完全沒有 order 欄位,必須經 anomalies 繞。
    //    restore 與「零殘留」驗收必須用同一組關聯,否則對不起來。
    [
      'payment_double_charge_anomaly_events',
      `anomaly_id IN (SELECT id FROM ${source('payment_double_charge_anomalies')} WHERE old_order_id IN (${list}))`,
    ],
  ];
}

export function buildExportScript(outDir: string): string {
  const tables = buildCohortSelectors(
    D1_COHORT.map(({ id }) => id),
    (table) => `public.${table}`,
  );

  // 🔴 **整道 \copy 必須擠在一行** —— psql 的 \copy 是客戶端 meta-command、不跨行,
  //    跨行會噴 `\copy: parse error at end of line`。2026-07-29 首次實跑踩到:
  //    十張表都過了,只有這道多行的 manifest 掛掉(測試只驗「指令內容對」、
  //    沒驗「指令是不是一行」⇒ 產出的指令對、跑起來不對)。
  // cohort manifest:記錄「這包備份的範圍是什麼、從哪裡來」。codex R1-P2 抓到原版只有
  // 檔案雜湊、沒有刪留範圍 ⇒ 備份離開這個 checkout 之後就證明不了自己涵蓋哪些單。
  // 另記 current_database() 與叢集識別碼:半年後要能證明這包確實出自正式站,而不是
  // 某次演練用的複製庫。
  const manifestRows = [
    ...D1_DELETE_COHORT.map(
      ({ id, displayId }) =>
        `('${id}'::uuid, '${displayId}', 'delete', ${evidenceNote(displayId)})`,
    ),
    ...D1_RETAIN_COHORT.map(
      ({ id, displayId }) => `('${id}'::uuid, '${displayId}', 'retain', '')`,
    ),
  ].join(', ');

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
    `\\copy (SELECT m.display_id, m.id, m.membership, m.evidence, now() AS exported_at, current_database() AS db, (SELECT system_identifier FROM pg_control_system()) AS cluster_id FROM (VALUES ${manifestRows}) AS m(id, display_id, membership, evidence) ORDER BY m.display_id) TO '${outDir}/cohort-manifest.csv' WITH (FORMAT csv, HEADER, NULL '\\N')`,
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
