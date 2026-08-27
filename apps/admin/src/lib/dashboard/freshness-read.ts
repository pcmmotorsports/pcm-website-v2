import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// freshness-read.ts — 後台首頁那一行「供應商資料最後更新:N 小時前」。
//
// 🔴 **它是儀表,不是警報**(Sean 2026-08-28 拍 `q1: 甲`;端出去的題目原文與他的原話逐字在
//    `~/pcm-mailbox/pending-questions-20260827.md` 檔尾那一節)。
//    存在理由 = 2026-08-27 那件事:供應商同步排程**整次沒觸發**(不是失敗、不是被關掉,
//    是 GitHub 丟棄了那次觸發、官方未給上限也不通知),而**沒有任何東西通知任何人**。
//    📌 六種「資料沒更新」的原因,在畫面上**全部長成同一句「網站沒有新貨」**
//    ⇒ 要的不是一個該亮才亮的警報,是一個**每天都在印的值**。
//    (一個從來不叫的警報,與一個壞掉的警報,印同一句話。)
//
// 🔴🔴 **它蓋不到哪裡,寫在這裡而不是寫在 backlog** —— Sean 讀過這句才拍的,逐字:
//    「甲抓不到報價單那半(車款搜尋)⇒ 車搜變舊還是會安靜。」
//    · **報價單 repo 那半不在分母裡**:`sync_storefront_fitments`(PCM_Quote,台灣每日 11:30)
//      停了,本檔這個數字**照樣是綠的** ⇒ 客人的「依車輛搜尋」變舊而這裡不會叫。
//    · **供應商 feed 自己停更也抓不到**(b4 提案 §② 的路 f):feed 沒新東西,我們照樣每日
//      全量 upsert ⇒ `updated_at` 照動 ⇒ 這個數字**永遠新鮮**。
//    ⇒ **做完不得寫成「資料停更已解決」。它只蓋本 repo 這半的管線有沒有跑。**
//
// 🔴 為什麼讀得到:`product_variants.updated_at` **沒有 trigger、是 app 端顯式帶的**
//    (`supabase/migrations/20260531142533_init_product_variants.sql:36` 逐字
//     「updated_at 無 trigger(同 products、app 端 set;16b/16c 寫入須帶 updated_at)」、
//     `:51` `updated_at timestamptz NOT NULL DEFAULT now()`),
//    而每日全量 upsert 必帶它(`scripts/rpm-transform.ts:403` 逐字 `updated_at: now, // 顯式帶(無 trigger)`、
//    同檔 `:424`)⇒ **整條管線任何一段死掉,這個數字就會開始長大。**
//
// 🔴 **零 schema、不開 RPC**:直接走 PostgREST 取最新那一列。
//    成本量過(不是估的):2026-08-28 對正式庫 `EXPLAIN (ANALYZE, BUFFERS)`
//    `select updated_at from product_variants order by updated_at desc limit 1`
//    ⇒ **Seq Scan 54,036 列 / Execution Time 23.8ms**(`updated_at` 上沒有索引)。
//    ⚠️ 這一發**只在首頁跑**(不像退款那支被側欄接走、變成每個整頁載入都跑),
//    且與首頁另外三支查詢**併發**、不串行 ⇒ 判為可接受。
//    ⇒ **天花板寫在這裡**:哪天它被接進 layout/側欄,或列數再長一個量級,
//      就要回來加一條 `updated_at` 索引(那是 migration = 鐵則 12③,不是順手改)。

/**
 * 超過幾小時算「舊了」。
 *
 * ⚠️ **26 是 b4 從 cron 字面推的(每日跑一次 + 延遲上限觀測值),不是 Sean 拍板。**
 *    而 cron 字面本身可能已經漂了 ⇒ 這個標記不是客套。要改它先去對一次
 *    `.github/workflows/rpm-sync.yml` 的 schedule。
 */
export const FRESHNESS_STALE_HOURS = 26;

export type DataFreshness = {
  /**
   * 距離最後一次更新幾小時;**`null` = 量不到**(查詢失敗 / 一列都沒有 / 時間戳解不出來)。
   *
   * 🔴🔴 **`null` 絕不得在顯示端被兜成 `0`。**「0 小時前」的意思是「剛剛才更新過」——
   *    那是最漂亮的那一格,而它正好是**讀不到值**時最容易長出來的樣子
   *    (`new Date(undefined)` ⇒ `Invalid Date` ⇒ `getTime()` ⇒ `NaN`;而 `Number(null)` ⇒ `0`)。
   *    ⇒ 分不出「真的很新」與「沒拿到」的時候,這一格必須是 `null`。
   *    同一條理由的完整版在隔壁 `today-read.ts` 的 `readRpcInteger`。
   */
  hoursAgo: number | null;
  /** 超過 {@link FRESHNESS_STALE_HOURS} 沒更新。**量不到時是 `false`** —— 見 `hoursAgo` 的說明。 */
  stale: boolean;
  /**
   * 🔴🔴 **「這一行該不該用警示色」的【唯一】判準** —— 顯示端只准讀這一格,不准自己再組一次。
   *
   * 涵蓋三個世界:舊了(`stale`)/ 量不到(`hoursAgo === null`)/ **時間戳在未來(`hoursAgo < 0`)**。
   *
   * ⚠️ **它是被審查抓出來的,而抓到的形狀值得留著**:第一版把判準寫在 `page.tsx` 的 className 裡
   *    (`stale || hoursAgo === null`)⇒ **漏掉未來時間戳那一格** ⇒ 那一行會用**平靜的灰字**印
   *    「時間戳在未來(-3.2 小時)」。
   *    📌 而那正好是**唯一一個確定「有東西寫錯了」的世界**:`freshnessLabel` 特地不把負數夾成 0
   *    (「夾掉它會把那件事藏起來」),**而顏色那一層又把它藏回去了**。
   *    ⇒ **文字層與顏色層各判一次同一件事 ⇒ 它們一定會漂開。** 合成一格,只有一個作者。
   */
  abnormal: boolean;
  /** 量不到時,原因的一句話(顯示端要印出來,**不准留白**)。量得到 ⇒ `null`。 */
  unreadableReason: string | null;
};

/**
 * 顯示端那一行字。
 *
 * 🔴 **量不到時印「量不到」,不是印空白、也不是印一個數字。**(b4 提案 §④ 逐字:
 *    「查詢失敗那個分支要印『量不到』,不准 silent 空白」。)
 *    ⇒ 這一行在【讀得到】與【讀不到】兩個世界印不同的東西,而**兩邊都會印**。
 *      一個只在正常時出現的儀表,壞掉的樣子與「頁面還沒載完」一樣。
 */
export function freshnessLabel(f: DataFreshness): string {
  if (f.hoursAgo === null) return `供應商資料最後更新:量不到(${f.unreadableReason ?? '原因不明'})`;
  // 🔴 負數照實印,不夾成 0:未來時間戳 = 有東西寫錯了,而夾掉它會把那件事藏起來。
  if (f.hoursAgo < 0) return `供應商資料最後更新:時間戳在未來(${f.hoursAgo.toFixed(1)} 小時)`;
  if (f.hoursAgo < 1) return '供應商資料最後更新:不到 1 小時前';
  return `供應商資料最後更新:${Math.floor(f.hoursAgo)} 小時前`;
}

/**
 * 讀不到 ⇒ 帶著原因回去,**不回一個看起來正常的值**。
 *
 * 🔴 **`export` 是刻意的**(R1 nit):呼叫端(`app/page.tsx` 的 catch 分支)原本自己組了一份
 *    同形狀的字面量 ⇒ 「量不到長什麼樣」有兩個作者,而兩個作者哪天會漂開。**只留一個。**
 */
export function unreadable(reason: string): DataFreshness {
  return { hoursAgo: null, stale: false, abnormal: true, unreadableReason: reason };
}

/**
 * 供應商商品資料的新鮮度。
 *
 * 🔴 **本函式不拋** —— 首頁的失敗隔離靠 `Promise.allSettled`,而少一個會拋的來源就少一條
 *    「這一格壞掉把別格一起帶走」的路。transport 層的 reject 在下面被接成值。
 */
export async function loadDataFreshness(now: Date = new Date()): Promise<DataFreshness> {
  // 🔴 `.then(ok, err)`:supabase builder **平常**把錯誤放進 `{ error }`,但網路斷 / DNS 失敗 /
  //    fetch abort 是真的 reject。形狀抄隔壁 `today-read.ts` 的 `settle()`,不自創第二種寫法。
  const res = await createSupabaseServiceClient()
    .from('product_variants')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .then(
      (v) => v as { data: { updated_at?: unknown }[] | null; error: unknown },
      (error: unknown) => ({ data: null, error }),
    );

  if (res.error) {
    console.error('[freshness-read] 供應商資料新鮮度讀取失敗', res.error);
    return unreadable('查詢失敗');
  }
  const raw = res.data?.[0]?.updated_at;
  // 一列都沒有 = 這張表是空的。那不是「很新」,是**沒有資料可以判斷**。
  if (raw === undefined || raw === null) return unreadable('查無任何商品變體');
  if (typeof raw !== 'string') return unreadable('時間戳型別不對');

  const ms = new Date(raw).getTime();
  // 🔴 `Invalid Date` ⇒ `NaN`,而 `NaN` 一路算下去會變成 `NaN 小時前`,不會拋、不會紅。
  if (!Number.isFinite(ms)) return unreadable('時間戳解不出來');

  const hoursAgo = (now.getTime() - ms) / 3_600_000;
  if (!Number.isFinite(hoursAgo)) return unreadable('時間戳解不出來');

  const stale = hoursAgo > FRESHNESS_STALE_HOURS;
  return {
    hoursAgo,
    stale,
    // 🔴 未來時間戳(`hoursAgo < 0`)**不是** stale,而它一樣要亮 —— 見 `abnormal` 的說明。
    abnormal: stale || hoursAgo < 0,
    unreadableReason: null,
  };
}
