/**
 * ⟦supply-SYNCTIMEOUTPARTIAL⟧ 每日同步的留痕 —— **活著的兩端各寫一次**
 *
 * 🔴 **為什麼是兩端, 不是「結束時寫一列」**(整段理由在 migration 20260906340000 的檔頭段二):
 *    「被砍的時候寫一列」的前提是【被砍的那一刻還能寫】—— 而那是最不能假設的一刻。
 *    ⇒ ✅ 開工 `INSERT`、收工 `UPDATE` ⇒ **被砍 = 那一列永遠停在只有 `started_at`**
 *    ⇒ 🎯 **它不需要任何訊號, 缺席本身就是訊號。**
 *
 * 🔵 **它與 `installKillReporter()` 不衝突也不取代**:那一行答「停在哪一群」(診斷),
 *    本檔答「有沒有停」(告警)。**兩個問題, 兩個機制。**
 *
 * 🛑 **為什麼要獨立成一支檔而不是寫在 `rpm-import.ts` 裡**:
 *    `rpm-import.ts` 檔尾直接 `main()`(無 `import.meta` 守衛)⇒ **一被 import 就整支跑起來**
 *    ⇒ 📌 **寫在那裡的東西, 結構上沒有辦法被單元測試碰到。**
 *    (同樣的理由讓 `installKillReporter` 住在 `rpm-partial-report.ts`。)
 */

/** 只要求我們真正用到的那兩個方法 —— 不吃整個 SupabaseClient 型別, 測試才造得出替身。 */
export type SyncRunLogClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: number } | null; error: { message: string } | null }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: number) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export type SyncOutcome = 'completed' | 'failed';

const TABLE = 'supplier_sync_runs';

/**
 * 開工:寫下 `started_at`。回傳那一列的 id;**寫不進去回 `null`**。
 *
 * 🔴 **寫不進去【不擋同步】, 而那是刻意的**(plan 的障礙④):
 *    為了觀測而讓同步變脆, 是把一個「有時候沒留痕」的問題換成「有時候不同步」——
 *    ⇒ 📌 **後者的傷害大得多。** 所以這裡大聲 log 然後回 `null`。
 * 🛑 **而代價要明寫**:那一班就**沒有留痕** ⇒ 它在告警上與「從來沒跑過」同形。
 *    ⇒ 而那個世界會被 log 裡這一行抓到 —— 它是**人**的線索, 不是機器的。
 */
export async function openSyncRun(
  client: SyncRunLogClient,
  supplierSlug: string,
  runRef: string | null,
): Promise<number | null> {
  try {
    const { data, error } = await client
      .from(TABLE)
      .insert({ supplier_slug: supplierSlug, run_ref: runRef })
      .select('id')
      .single();
    if (error || !data) {
      console.error(
        `[rpm-sync-run-log] 🔴 開工留痕寫不進去(supplier=${supplierSlug}):${error?.message ?? '沒有回傳列'}` +
          ' —— 同步【照常進行】, 而這一班不會有留痕 ⇒ 它在告警上與「從來沒跑過」同形。',
      );
      return null;
    }
    return data.id;
  } catch (e) {
    console.error(
      `[rpm-sync-run-log] 🔴 開工留痕丟例外(supplier=${supplierSlug}):${String(e)} —— 同步照常進行。`,
    );
    return null;
  }
}

/**
 * 收工:回填 `completed_at` 與 `outcome`。
 *
 * 🔴 **這一次失敗要 `throw`, 與開工那一端【相反】** ——
 *    開工寫不進去 ⇒ 只是少了留痕;而**收工回填失敗 ⇒ 那一列會停在「只有 started_at」**
 *    ⇒ 📌 **它會被告警當成【被砍】** ⇒ 🛑 **一個安靜的回填失敗會製造一個假的告警**,
 *      而假告警比沒有告警更快讓人學會忽略它。⇒ 所以這一端 fail-loud。
 *
 * 🔵 `id` 是 `null`(開工那一端沒寫成)⇒ 直接返回, 不是錯 —— 沒有列可以回填。
 */
export async function closeSyncRun(
  client: SyncRunLogClient,
  id: number | null,
  outcome: SyncOutcome,
  note: string | null,
): Promise<void> {
  if (id === null) return;
  const { error } = await client
    .from(TABLE)
    .update({ completed_at: new Date().toISOString(), outcome, note })
    .eq('id', id);
  if (error) {
    throw new Error(
      `[rpm-sync-run-log] 收工回填失敗(id=${id}, outcome=${outcome}):${error.message}` +
        ' —— 🔴 那一列會停在「只有 started_at」而被告警讀成【被砍】(假告警)⇒ 這裡刻意 fail-loud。',
    );
  }
}

/** GitHub Actions 給的執行識別;不在 Actions 上跑就回 null(那不是錯)。 */
export function currentRunRef(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.GITHUB_RUN_ID;
  if (!id) return null;
  const attempt = env.GITHUB_RUN_ATTEMPT ?? '1';
  return `${id}/${attempt}`;
}
