// retry-on-statement-timeout.ts — 資料庫逾時(PG 57014)就再試一次;其他錯誤照舊丟出去。
//
// 🔴 為什麼(2026-09-11 窗 A 判讀, 主視窗拍最便宜那條):
//   正式庫 anon `statement_timeout = 3s`(pg_roles 唯讀讀到)。E2E run 34564927156 第一發
//   `/search?q=DBK SPECIAL` 撞 57014 ⇒ 畫面「搜尋暫時無法使用」, 而 1.6 秒後同一發 3.1 秒就過。
//   同一段 SQL 在正式庫熱的時候 0.25~0.66 秒(唯讀實量)⇒ 第二發大概率回得來。
// 🛑 只認 57014:其他錯誤(權限、簽章不符、網路)重試也不會變好, 照舊直接回錯。
// ponytail: 固定重試一次、不等待。治本是那支 RPC 少碰頁(一次約 23.8k 個 buffer)或單獨放寬逾時(要 migration)。

export async function retryOnceOnStatementTimeout<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== '57014') throw err;
    console.warn(`[${label}] 資料庫逾時(57014)⇒ 重試一次`);
    return run();
  }
}
