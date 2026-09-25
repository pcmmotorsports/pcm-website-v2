import 'server-only';

// 經銷商申請待審核件數(每日 LINE 摘要用;B2B 計畫 §9.5, Sean 2026-09-25 Q2)。
// client 由 `payment/composition.ts` 的 `getDealerApplicationsPendingClient` 給(storefront 只准 composition 碰 service key);
// service_role 對 dealer_applications 有 SELECT(20260925010000)。

/** 只要這一條查詢鏈。 */
export type PendingCountClient = {
  from(table: never): {
    select(columns: never, options: never): {
      eq(column: never, value: never): {
        limit(n: number): PromiseLike<{ count: number | null; error: unknown }>;
      };
    };
  };
};

/** 表不存在的兩種碼:PostgREST 的 schema cache 查無(PGRST205)與 PostgreSQL 的 undefined_table(42P01)。 */
const TABLE_MISSING = new Set(['PGRST205', '42P01']);

/**
 * number = 待審件數。
 * undefined = 表還沒建(20260925010000 還沒貼)⇒ 摘要不印也不列「讀不到」, 否則貼板前每天早上都多一行雜訊。
 * 其他錯誤 ⇒ throw(route 接成 null =「讀不到」, 不當成 0)。
 */
export async function readDealerApplicationsPendingCount(client: PendingCountClient): Promise<number | undefined> {
  // 🔴 不用 head:true(Codex R1):HEAD 回應沒有錯誤本文, SDK 拿不到 PGRST205, 表不存在會被讀成 count=null、每天多印「讀不到」。
  //    改成一般 GET 只取 1 列 id(不讀申請內容), 件數照樣由 count=exact 給。
  const { count, error } = await client
    .from('dealer_applications' as never)
    .select('id' as never, { count: 'exact' } as never)
    .eq('status' as never, 'pending' as never)
    .limit(1);
  if (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && TABLE_MISSING.has(code)) return undefined;
    throw error;
  }
  if (typeof count !== 'number') throw new Error('dealer_applications 待審件數不是數字');
  return count;
}
