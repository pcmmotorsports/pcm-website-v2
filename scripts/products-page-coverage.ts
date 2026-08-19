/**
 * products-page-coverage.ts —— 「第 N 頁有沒有漏掉東西」的**完整**證明。
 *
 * 🔴 **這支腳本是寫給【有正式庫存取權的人】跑的(= Sean)。G3 沒有跑過它。**
 *    plan(`docs/specs/2026-08-19-admin-products-pagination-plan.md` §3)明寫:
 *    「我不會真的翻完 102 頁去比對 20,341 個 id … 我會把那支腳本寫好放著,**不自己跑**」。
 *    ⇒ 本檔的存在就是那句話的兌現。**它從未對真資料庫執行過。**
 *
 * ── 它證什麼 ──────────────────────────────────────────────
 * 用**與後台商品列表完全相同的查詢形狀**(同樣的排序、同樣的 `.range()` 偏移)
 * 把每一頁翻完,收集所有 `id`,然後回答:
 *      看到的列數 === total ?      有沒有重複 ?      有沒有短頁(被砍過的頁) ?
 *
 * ── 它【證不了】什麼(先寫,不要等人問)────────────────────
 * 🔴 **翻頁期間有人寫 `products`**(每日同步就是 writer)⇒ 這叫 plan §3 的「病 C」。
 *    本腳本**偵測得到**它(比對開頭與結尾的 `total`),但**修不了、也繞不過**:
 *    ⇒ 兩個 total 不同 ⇒ 判 `INCONCLUSIVE`,**不判 PASS 也不判 FAIL**。
 *    ⇒ 想拿到乾淨的一發,挑同步沒在跑的時段。
 *
 * ── 怎麼跑 ────────────────────────────────────────────────
 *      pnpm tsx scripts/products-page-coverage.ts --self-test     # 不連 DB,先驗這把尺會不會叫
 *      pnpm tsx scripts/products-page-coverage.ts --size=200      # 連正式庫,唯讀
 *
 * 🔴 **請先跑 `--self-test`。** 它拿五組**已知答案**的假資料餵這把尺,其中四組**必須被判紅**。
 *    沒過那一關,底下對真資料庫的「PASS」什麼都不代表 —— 一把恆綠的尺量什麼都綠。
 *
 * 唯讀:全檔只有 `.select()`,零 `insert/update/delete/rpc`。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 🔴 **不用 `@pcm/adapters/server` 的 `createSupabaseServiceClient()`** —— 那支帶 `server-only`,
 *    在 Next 以外的 runtime **一 import 就 throw**(實測:`This module cannot be imported from
 *    a Client Component module`)。本檔是 tsx 腳本,不是 Next ⇒ 自己建 client。
 *    env 變數名**與那支逐字相同**(`packages/adapters/src/supabase/client.ts:60-63`):
 *    `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`。
 * ⚠️ 本檔**只讀 `process.env`,不讀任何 `.env*` 檔**。跑的人自己把值帶進環境。
 */
function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '缺 env:需要 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY(本檔不讀 .env* 檔)',
    );
  }
  return createClient(url, key);
}

/** 一頁的觀測結果。 */
export type ObservedPage = {
  readonly page: number;
  readonly offset: number;
  readonly ids: readonly string[];
};

export type CoverageVerdict = {
  readonly status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly reasons: readonly string[];
  readonly rowsSeen: number;
  readonly uniqueIds: number;
  readonly duplicates: readonly string[];
  readonly shortPages: readonly number[];
};

/**
 * 判官(**純函式,不碰 DB** ⇒ 它自己測得起來,這正是 `--self-test` 能存在的原因)。
 *
 * 判定順序是刻意的:**先判 INCONCLUSIVE**。
 * 🔴 集合在翻頁期間變過的話,「少了 3 筆」這種結論**沒有意義** ——
 *    那 3 筆可能只是還沒被寫進來。先把不可判的情況擋掉,才不會產出一個看起來很具體的錯誤結論。
 */
export function judgeCoverage(input: {
  readonly totalBefore: number;
  readonly totalAfter: number;
  readonly pageSize: number;
  readonly pages: readonly ObservedPage[];
}): CoverageVerdict {
  const { totalBefore, totalAfter, pageSize, pages } = input;

  const allIds = pages.flatMap((p) => [...p.ids]);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) dup.add(id);
    else seen.add(id);
  }

  // 短頁 = 不滿 pageSize、而**後面還有頁**(最後一頁不滿是正常的)。
  // 🔴 這與畫面上的 `detectPageTruncation` 是**同一個不變式的兩種形狀**:
  //    那個問「這一頁」,這個問「整趟」。
  const shortPages = pages
    .filter((p, i) => i < pages.length - 1 && p.ids.length !== pageSize)
    .map((p) => p.page);

  const reasons: string[] = [];

  if (totalBefore !== totalAfter) {
    reasons.push(
      `翻頁期間 total 從 ${totalBefore} 變成 ${totalAfter}(差 ${totalAfter - totalBefore})` +
        ` —— 集合被寫過,本趟不可判。這是 plan §3 的病 C,不是本次改動造成的。`,
    );
    return {
      status: 'INCONCLUSIVE',
      reasons,
      rowsSeen: allIds.length,
      uniqueIds: seen.size,
      duplicates: [...dup],
      shortPages,
    };
  }

  if (shortPages.length > 0) {
    reasons.push(
      `有 ${shortPages.length} 個【非最後一頁】的頁不滿 ${pageSize} 筆(頁碼:${shortPages.join(', ')})` +
        ` —— 伺服器單次回傳上限被踩到的典型症狀。`,
    );
  }
  if (dup.size > 0) {
    reasons.push(`有 ${dup.size} 個 id 跨頁重複出現 —— 排序鍵不唯一或偏移算錯。`);
  }
  if (seen.size !== totalBefore) {
    reasons.push(
      `看到 ${seen.size} 個不重複的 id,而 total 說有 ${totalBefore} 個` +
        `(差 ${seen.size - totalBefore})。`,
    );
  }

  return {
    status: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons,
    rowsSeen: allIds.length,
    uniqueIds: seen.size,
    duplicates: [...dup],
    shortPages,
  };
}

/** 安全上限:避免任何情況下的無窮迴圈。踩到它 = **throw**,不是 break(分頁準則 3)。 */
const MAX_PAGES = 10_000;

async function walk(pageSize: number): Promise<void> {
  const db = serviceClient();

  // 🔴 排序**必須**與 `product-repository.ts` 逐字相同,否則量的是另一個東西。
  //    `created_at DESC, id ASC` —— `id` 是必要的第二鍵(該檔 :125 寫了為什麼)。
  const queryPage = async (offset: number) => {
    const { data, error, count } = await db
      .from('products')
      .select('id', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    // 分頁準則 3:任一頁失敗 ⇒ 整趟失敗。**不得 break/continue** ——
    // break 會把「第 3 頁掛了」變成「總共只有 3 頁」,而那兩件事形狀完全相同。
    if (error) throw new Error(`第 ${offset / pageSize + 1} 頁查詢失敗:${error.message}`);
    return { ids: (data ?? []).map((r) => r.id as string), count: count ?? 0 };
  };

  const first = await queryPage(0);
  const totalBefore = first.count;
  const pages: ObservedPage[] = [{ page: 1, offset: 0, ids: first.ids }];

  console.log(`total(開頭)= ${totalBefore};每頁 ${pageSize} ⇒ 預期約 ${Math.ceil(totalBefore / pageSize)} 頁`);

  // 🔴 終止條件 = **這一頁空了**,不是「翻到 count/pageSize 頁」(分頁準則 4:count 是 TOCTOU)。
  //    短頁**不終止**,交給判官處理 —— 短頁可能是末頁,也可能是被砍過的頁,迴圈分不出來。
  let n = 1;
  let last = first;
  while (last.ids.length > 0) {
    if (++n > MAX_PAGES) throw new Error(`超過 ${MAX_PAGES} 頁仍未結束,中止(疑似迴圈條件壞掉)`);
    const offset = (n - 1) * pageSize;
    last = await queryPage(offset);
    if (last.ids.length > 0) pages.push({ page: n, offset, ids: last.ids });
    if (n % 20 === 0) console.log(`  … 已翻到第 ${n} 頁`);
  }

  const totalAfter = (await queryPage(0)).count;
  const verdict = judgeCoverage({ totalBefore, totalAfter, pageSize, pages });

  console.log('\n──────── 結果 ────────');
  console.log(`判定        ${verdict.status}`);
  console.log(`翻了        ${pages.length} 頁`);
  console.log(`收到        ${verdict.rowsSeen} 列,其中不重複 ${verdict.uniqueIds} 個 id`);
  console.log(`total       開頭 ${totalBefore} / 結尾 ${totalAfter}`);
  for (const r of verdict.reasons) console.log(`🔴 ${r}`);
  if (verdict.duplicates.length > 0) {
    console.log(`重複的 id(最多列 10 個):${verdict.duplicates.slice(0, 10).join(', ')}`);
  }
  if (verdict.status === 'FAIL') process.exitCode = 1;
  if (verdict.status === 'INCONCLUSIVE') process.exitCode = 2;
}

// ─────────────────────────── self-test(不連 DB)───────────────────────────

function ids(from: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `id-${from + i}`);
}

/**
 * 🔴 **五組已知答案,其中四組必須被判紅。**
 * 沒有這一段,`judgeCoverage` 可能是一個恆回 PASS 的函式,而對真 DB 的那個 PASS 就什麼都不是。
 */
function selfTest(): void {
  const cases: readonly { name: string; input: Parameters<typeof judgeCoverage>[0]; want: CoverageVerdict['status'] }[] = [
    {
      name: '① 乾淨的一趟:250 筆、每頁 100 ⇒ 3 頁(末頁 50)',
      input: {
        totalBefore: 250, totalAfter: 250, pageSize: 100,
        pages: [
          { page: 1, offset: 0, ids: ids(1, 100) },
          { page: 2, offset: 100, ids: ids(101, 100) },
          { page: 3, offset: 200, ids: ids(201, 50) },
        ],
      },
      want: 'PASS',
    },
    {
      name: '② 中間某頁被砍(第 2 頁只回 60 筆)⇒ 必須紅',
      input: {
        totalBefore: 250, totalAfter: 250, pageSize: 100,
        pages: [
          { page: 1, offset: 0, ids: ids(1, 100) },
          { page: 2, offset: 100, ids: ids(101, 60) },
          { page: 3, offset: 200, ids: ids(201, 50) },
        ],
      },
      want: 'FAIL',
    },
    {
      name: '③ 跨頁重複一個 id(排序鍵不唯一的典型症狀)⇒ 必須紅',
      input: {
        totalBefore: 250, totalAfter: 250, pageSize: 100,
        pages: [
          { page: 1, offset: 0, ids: ids(1, 100) },
          { page: 2, offset: 100, ids: ['id-100', ...ids(101, 99)] },
          { page: 3, offset: 200, ids: ids(200, 50) },
        ],
      },
      want: 'FAIL',
    },
    {
      name: '④ 翻頁期間 total 變了 ⇒ 必須 INCONCLUSIVE(不是 PASS 也不是 FAIL)',
      input: {
        totalBefore: 250, totalAfter: 253, pageSize: 100,
        pages: [
          { page: 1, offset: 0, ids: ids(1, 100) },
          { page: 2, offset: 100, ids: ids(101, 100) },
          { page: 3, offset: 200, ids: ids(201, 50) },
        ],
      },
      want: 'INCONCLUSIVE',
    },
    {
      name: '⑤ 數量對、而少了一筆又多了一筆(重複掩蓋漏列)⇒ 必須紅',
      input: {
        totalBefore: 250, totalAfter: 250, pageSize: 100,
        pages: [
          { page: 1, offset: 0, ids: ids(1, 100) },
          { page: 2, offset: 100, ids: ['id-1', ...ids(102, 99)] },
          { page: 3, offset: 200, ids: ids(201, 50) },
        ],
      },
      want: 'FAIL',
    },
  ];

  let bad = 0;
  for (const c of cases) {
    const got = judgeCoverage(c.input).status;
    const ok = got === c.want;
    if (!ok) bad++;
    console.log(`${ok ? '✅' : '🔴'} ${c.name}\n     期望 ${c.want} / 實得 ${got}`);
  }
  console.log(
    bad === 0
      ? '\n✅ 這把尺會叫:四組壞資料全部被判紅、好資料沒有被誤判。可以拿去量真的了。'
      : `\n🔴 ${bad} 組不符 —— 這把尺壞了,不要拿它的結果下任何結論。`,
  );
  if (bad > 0) process.exitCode = 1;
}

// ─────────────────────────── 入口 ───────────────────────────

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
  selfTest();
} else {
  const sizeArg = argv.find((a) => a.startsWith('--size='));
  const size = sizeArg ? Number(sizeArg.slice('--size='.length)) : 200;
  if (!Number.isInteger(size) || size < 1 || size > 1000) {
    console.error('--size 必須是 1..1000 的整數(上限對齊 PAGE_SIZE_OPTIONS 的封頂)');
    process.exitCode = 1;
  } else {
    walk(size).catch((e: unknown) => {
      console.error('🔴 中止:', e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
  }
}
