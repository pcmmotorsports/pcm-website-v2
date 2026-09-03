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
//    · **報價單 repo 那半不在分母裡**:`sync_storefront_fitments`(PCM_Quote,~~台灣每日 11:30~~
//      ⇒ 🔵 **2026-08-31 實量更正:台灣每日 07:01**;舊字面留著,免得搜「11:30」的人以為沒人動過。
//      數法 = 對正式庫 `product_fitments_effective_sync_log` 依台北時刻分組:
//      `11:31` 跑 33 次(至 08-24)、`07:01` 跑 6 次(08-26 起);**08-25 一列都沒有**(換班空一天))
//      停了,本檔這個數字**照樣是綠的** ⇒ 客人的「依車輛搜尋」變舊而這裡不會叫。
//      🔵 **2026-08-31 起這一句只剩前半成立** —— 下面的 `loadFitmentFreshness` 把「車搜那半」補上了;
//         而 `feed 自己停更` 那一格(下一段)**仍然沒有人蓋**。
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
//    且與首頁其他查詢**併發**、不串行 ⇒ 判為可接受。
//    🔴 **併發支數:原記【另外三支】(`85599ee1` 之前);2026-08-28 起是【另外四支】;
//       ~~四支~~ ⇒ 🔵 **2026-09-01 起是【另外五支】**(codex R2 nit 更正清單:那五支是
//       `actor` / `staff` / `today` / **`fitment`** / `cronHeartbeats`;首頁共六支)**
//       (`actor` / `staff` / `today` / 本支 / `cronHeartbeats`,同一個 `Promise.allSettled`)
//       —— **兩個值之下,Seq Scan 23.8ms 的判定都成立 ⇒ 本段結論不受影響。**
//       (形狀抄 `today-read.ts` 那段「當時記載 1000、2026-08-18 起實測 2000,兩個值之下都成立」。)
//    🔴🔴 **而這一格本身是一個紀錄,不要刪**:下面那句天花板寫的是「哪天…就要回來加索引」,
//       而**觸發它的人就是寫下它的那個人**(我,2026-08-28 把第五支併發加進去)——
//       **而我沒有回頭看。** 📌 他當時想的是「哪天有人」,而他自己動它的那天不覺得自己是「有人」。
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
 * 🔴 ~~**本函式不拋**~~ ⇒ 🔵 **2026-09-01 codex nit 收窄:應為「查詢層的錯誤與 reject 都接成值」**。
 *    `createSupabaseServiceClient()` 自己拋的(例如缺 env)**不在** `.then(ok, err)` 的射程裡,
 *    那一種仍會讓這個 Promise reject,由首頁的 `allSettled` + `unreadable()` 接住。
 *    ⇒ 少一個會拋的來源就少一條「這一格壞掉把別格一起帶走」的路 —— 那個意圖沒變,**只是原句講太滿**。
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
  return freshnessFromTimestamp(res.data?.[0]?.updated_at, now, FRESHNESS_STALE_HOURS, '查無任何商品變體');
}

/**
 * 一個時間戳 ⇒ 一份 {@link DataFreshness}。
 *
 * 🔴 **抽出來是刻意的,不是為了少打字**:`null` 不得兜成 `0`、`Invalid Date` 不得變成
 *    `NaN 小時前`、未來時間戳要亮 —— 這三條規矩本檔上方各寫了一段理由,而**它們只能有一個作者**。
 *    第二個讀時間戳的來源(`loadFitmentFreshness`)若自己再寫一份,那三條哪天會漂開,
 *    而漂開的那一側**不會紅**(它只是印一個看起來正常的數字)。
 *    ⇒ 形狀同本檔對 `unreadable()` 的處理:「量不到長什麼樣」只留一個作者。
 */
function freshnessFromTimestamp(
  raw: unknown,
  now: Date,
  staleHours: number,
  emptyReason: string,
): DataFreshness {
  // 一列都沒有 = 這張表是空的。那不是「很新」,是**沒有資料可以判斷**。
  if (raw === undefined || raw === null) return unreadable(emptyReason);
  if (typeof raw !== 'string') return unreadable('時間戳型別不對');

  const ms = new Date(raw).getTime();
  // 🔴 `Invalid Date` ⇒ `NaN`,而 `NaN` 一路算下去會變成 `NaN 小時前`,不會拋、不會紅。
  if (!Number.isFinite(ms)) return unreadable('時間戳解不出來');

  const hoursAgo = (now.getTime() - ms) / 3_600_000;
  if (!Number.isFinite(hoursAgo)) return unreadable('時間戳解不出來');

  const stale = hoursAgo > staleHours;
  return {
    hoursAgo,
    stale,
    // 🔴 未來時間戳(`hoursAgo < 0`)**不是** stale,而它一樣要亮 —— 見 `abnormal` 的說明。
    abnormal: stale || hoursAgo < 0,
    unreadableReason: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 車款搜尋(fitment)那一半 —— `⟦b4-FIT1⟧`,2026-09-01 加
// ════════════════════════════════════════════════════════════════════════════
//
// 🔴 **為什麼這一格要存在**:上面那行灰字讀 `product_variants.updated_at`,
//    而客人「依車輛搜尋」吃的是另一張表 `product_fitments_effective`,
//    由**另一個 repo**(PCM_Quote)的 `sync_storefront_fitments.py` 每日寫進來。
//    ⇒ 那條線停了,上面那行**照樣是綠的**(本檔檔頭那句就是這件事,作者自己寫的)。
//
// 🔴🔴 **而真正的缺陷不是「資料舊了」,是【停更時沒有任何訊號】**(2026-08-31 逐條實查):
//    · **本片之前**,本 repo 讀那張 sync_log 的檔數 = **1**,而那 1 支是自動產生的 `database.types.ts`
//      (型別,不是讀取)⚠️ **這個 1 是【2026-08-31 量的歷史值】** —— 本片自己就把它變成 3
//      (本檔 + 本檔的測試 + types)⇒ **再引用這個數字要當場重量,不要抄。**
//      ⇒ 實質 0。(正對照:同一把尺量 `product_variants` ⇒ 29 支;負對照現造表名 ⇒ 0。)
//    · 對方腳本的告警面 = **launchd log**(`sync_storefront_fitments.py` 檔頭第 5 點逐字
//      「失敗非零退出(launchd log 即告警面)」)⇒ 那個 log 在**另一台 Mac mini** 上。
//    · LINE 每日摘要(`daily_digest.py`,`--send # 真的推 LINE`)**通道在、Sean 看得到**,
//      而 grep 那條線的三個字面 ⇒ **0** ⇒ **通道在,訊號沒掛上去。**
//    🔴 **最硬的一格:同步與告警住在同一台機器上。** 本機 `launchctl list` 實際載入的 pcm 排程
//      只有 `com.pcm.warroom-daily`;`movedtomini` 9 支裡同時有
//      `com.pcm.storefront-fitments-sync` 與 `com.pcm.daily-fetchers`。
//      ⇒ 那台關機 ⇒ 同步不跑(sync_log 沒有列)+ 摘要不推(LINE 沒訊息)⇒ **兩個訊號同時消失**,
//        而「今天沒收到訊息」與「今天一切正常」在 Sean 手機上**長一模一樣**。
//    📌 **⇒ 本函式之所以放在【我們自己的庫】這一側,理由就是這個** ——
//       那張 sync_log 在 `bmpnplmnldofgaohnaok`(我們的庫)⇒ **與被監控的東西不共用失效點**。
//       一個與監控對象共用失效點的告警,在它最該叫的那一天正好也不會叫。
//    ⚠️ 同一個母題的另一個實例在板上 `⟦b4-CRON6⟧`(「告警器與它要監控的排程走同一條線」)——
//       **不同的排程、不同的機器,不要合併成一列。**
//
// 🛑 **它蓋不到哪裡(照實寫)**:
//    · 它與上面那行一樣是**儀表不是警報**(Sean 2026-08-28 拍 `q1: 甲`)⇒ **要有人打開後台才看得到**。
//    · 它答不出「那台 mini 現在通不通電」—— 它答的是**那條線有沒有留下痕跡**。兩個不同的宣稱。
//    · 「每日 07:01」是**從 sync_log 的時刻反推的**,不是讀那台機器上的 plist
//      ⇒ **plist 現在寫什麼,未確認。**
//    · 🔴🔴 **它信任那張 sync_log 說的話, 而【沒有東西在 DB 層保證那句話是真的】**
//      (codex R3 角度A):寫那張表的是 `service_role`,而同一把鑰匙也改得動 `product_fitments_effective`
//      本身 ⇒ **理論上可以有人只 INSERT 一列 success 而沒有真的替換資料** ⇒ 這裡會印綠。
//      ⇒ **本片不解它**(要解 = 由 DB 端保證兩者原子綁定 = schema/約束 = 鐵則 12③)⇒ **單獨立一列**。
//      📌 而它與下面那一格是同一句話的兩半:**這道儀表量的是【那條線說它成功了】, 不是【資料真的變了】。**
//    · 🔴🔴 **它抓不到「同步一直成功,而【來源】凍結了」**(codex 2026-09-01 must-fix,判定成立)——
//      上游 view 不再變新,而同步照樣每天成功寫一列 ⇒ 這裡的天數**永遠是 0**。
//      📌 **與本檔上面那句『供應商 feed 自己停更也抓不到』是【同一個形狀】** ——
//         兩支儀表都在量【管線有沒有跑】,而沒有一支在量【內容有沒有變】。
//      ⇒ **本片刻意不解它**(要比 `new_count` 或內容雜湊的跨日變化 = 另一個設計)⇒ **單獨立一列**,
//        不要當成本片的第二階段。

/**
 * 車款搜尋資料超過幾小時算「舊了」= **7 天**。
 *
 * 🔴 **7 是 Sean 給的數,不是我們算的** —— 他 2026-08-29 逐字答 `A: 7天`
 *    (題目原文「資料幾天沒更新,就算太舊該通知你?」;
 *     落點 `~/pcm-mailbox/等Sean決策-20260829.md` 的「✅ 已答:資料多久沒更新算太舊」那一節)。
 *    ⚠️ 對照上面的 {@link FRESHNESS_STALE_HOURS} = 26:**那個 26 是推的、這個 7 天是拍的。**
 *    ⇒ 要改這個數,是回去問他,不是自己重算。
 */
export const FITMENT_STALE_DAYS = 7;
export const FITMENT_STALE_HOURS = FITMENT_STALE_DAYS * 24;

/**
 * 車款搜尋的**排程**多久沒成功,就算「它可能掛了」= **26 小時**。
 *
 * 🔴🔴 **它與上面那個 7 【回答的是兩個不同的問題】,而先前只有一個數字在回答兩個。**
 * ```
 * FITMENT_STALE_DAYS = 7      答的是:【資料多舊算舊】
 *                                (Sean 2026-08-29 逐字答 `A: 7天`;題目原文
 *                                 「資料幾天沒更新, 就算太舊該通知你?」)
 * 本常數             = 26 小時  答的是:【排程掛了多久才該有人知道】
 * ```
 * 🛑 **而 7 那個【一個字都沒動】** —— 他是【加了第二個】, 不是推翻第一個。
 * 📌 **⇒ 為什麼需要第二個**:這支排程是**每日**跑的
 *    ⇒ 用 7 天當警戒 ⇒ **它可以連續漏 6 天而那行字仍然是綠的**。
 *    ⇒ 而那正是這道儀表最該叫的那一種。
 *
 * 🔴🔴 **這個數 Sean 拍過【兩次】, 而兩次都寫「甲」、值不同 —— 兩筆都留著, 不要只留新的**:
 * ```
 * 2026-09-02 Q5  ⇒ 甲, 值【2 天】(他自己給的值, 不是選項給的)
 *                  📎 ~/pcm-mailbox/拍板-20260902-06題.md:36-40 · docs/launch-todo.md:1722
 * 2026-09-03 Q27 ⇒ 甲 =【1 天】「隔天沒跑就變色」(值寫在選項字面上)
 *                  📎 ~/pcm-mailbox/等Sean拍的題-20260903.md:1341
 * ```
 * 🛑 **而那【不是他改主意】** —— 09-03 那題的內文逐字只提「你 8/29 答過 7 天」,
 *    **一個字都沒提 09-02 那個 2** ⇒ 🎯 **出題的人不知道兩天前問過了。**
 *    ⇒ 📌 **他是在【不知道自己前天剛拍過】的情況下改了這個數字。** 主視窗 2026-09-03 已端給他知會。
 * ⚠️ **引用時一定要帶日期**:`Q27` 這個題號在 mailbox 被用過三次(隱私政策 / 訂單配色 / 本題),
 *    **三次的答案互不相干** ⇒ 光寫「Q27」指不到東西。
 *
 * 🔵 **為什麼是 26 小時而不是他字面的 24**(主視窗 2026-09-03 批准, 理由照抄):
 *    排程台北每日 07:01 ⇒ **24 小時整的門檻正好壓在下一班身上**
 *    ⇒ 「還沒到時間」與「掛了」在那一分鐘之內分不開。
 *    判準是 `hoursAgo > 門檻`(嚴格大於), 而 `ran_at` 是 commit RPC 那筆交易的 `now()`
 *    (`supabase/migrations/20260902210000_...sql:130` 的 `DEFAULT now()`;寫入點在
 *     `20260902200000_...sql:156`, 由 RPC 自己 INSERT, 不是腳本帶時間)
 *    ⇒ **紅的那一段 = 今天的 `ran_at` − 昨天的 `ran_at` − 門檻**
 *    ⇒ 只要今天比昨天慢一點, 那行字就會紅一段。
 *    🛑 **而【本排程的抖動有多大】我沒有量到, 而現有的證據比它看起來的弱**:
 *       · 線 `-f7` 2026-08-31 量到 `11:31` **33 次**全落在同一分鐘 —— 🔴 **而那 33 次屬於
 *         【已經被取代的 11:30 排程】**(見本檔 `:19`)。**現行 07:01 的樣本數是 6, 不是 33。**
 *         ⇒ 📌 拿 n=33 去替現行排程的穩定度作證 = **用另一個世界的讀數**。標「是引用」擋得住
 *           「這是我量的」那種誤讀, **擋不住「它量的是另一個世界」**。
 *       · ⚠️ 兩個數字都是**引用**, 不是本片量的。
 *    🔵 **而同艦隊有兩筆【相關但不同題】的實測, 它們是這 2 小時寬限的間接依據**
 *       (`docs/handoff/CURRENT.md:1430` / `:1437`):**GitHub Actions** 的排程延遲實測
 *       最小 55 / 中位 72 / 最大 111 分鐘;而跑本排程的那台機器 `pmset` **閒置 1 分鐘即睡**,
 *       `sync_storefront_fitments` 落在防睡鎖放開後 4 小時。
 *       🛑 **兩筆都不是本排程的讀數** —— GH Actions 是另一條管線(排隊機制不同, launchd 不排隊),
 *          而睡眠那筆講的是**假失敗**不是**遲到**。⇒ **不得拿它們當本排程的延遲分佈。**
 *          它們證明的只有一件事:**這個艦隊裡「排程沒有準時跑」是量到過的事, 不是我想像的。**
 *    ⇒ 🎯 **能讓參數不重要的結構, 優先於挑對的參數** —— 24 讓這片的正確性掛在一個
 *      **我沒有量到、而手邊樣本只有 6 筆**的抖動上, 而 26 不掛。
 * 🔵 **它對 24 而言【就是放寬 2 小時】—— 這一句要照實寫, 不要用「不是放寬」帶過。**
 *    ~~26 > 24 不是放寬~~ ⛔ 那句話沒有跟 24 比, 它偷偷改成跟「隔天」比 ⇒ **會讓下一個人
 *    不去注意那 2 小時是放寬的。**
 *    ✅ 正確的說法:**放寬 2 小時, 而仍然在漏班的【當天早上 09:01】變色** ——
 *    比 Sean 選項字面的「隔天沒跑就變色」還早。⇒ 📌 **放寬的是對 24 的邊界, 不是對他要的效果。**
 * ⚠️ **而這 2 小時買得夠不夠, 有一個【推得出來、而未量到】會吃掉它的情境**(⛔ ~~已知~~ —— 那個詞讀起來像量到過):那台機器睡著、隔天早上才醒
 *    ⇒ 07:01 那班延到約 09:00 才跑 ⇒ 距前一天的 `ran_at` 恰好接近 26 小時 ⇒ **會壓在邊界上。**
 *    🛑 那一天它亮燈**不算誤報**(資料確實 26 小時沒更新了), 但**它會亮**, 寫在這裡免得有人當 bug 修。
 * ⚠️ **它的天花板**:任何小時門檻都與那支排程的時刻耦合, **而那個時刻已經漂過一次**
 *    (~~台灣每日 11:30~~ ⇒ 07:01, 而我們這邊完全沒有訊號)。它哪天改成一天跑兩次、或再移一次,
 *    這個 26 就要重估 —— **而沒有任何東西會在那一天叫。**
 * 🛑 **考慮過而否決的另一案**(寫下來, 免得下一個人重想一次):改成看**日曆班次**
 *    (最近一個已經過去的 07:01 之後有沒有成功過)⇒ 正常狀態誤報**結構性為 0**。
 *    **否決理由**:它要把 `07:01` 這個**已經漂過一次的外部字面**寫進我們 repo ⇒ **更脆, 不是更穩。**
 *
 * ⛔ ~~`export const FITMENT_SCHEDULER_DEAD_DAYS = 2`~~ ⇒ 2026-09-03 起本常數改以**小時**為單位,
 *    那個 `_DAYS` 常數**已刪除**。舊名留在這行刪除線裡, 讓搜 `FITMENT_SCHEDULER_DEAD_DAYS` 的人
 *    同一發撞到這段訂正, 而不是撞到「查無」。
 */
export const FITMENT_SCHEDULER_DEAD_HOURS = 26;

/**
 * 車款搜尋那一行字。**印出來的單位是天**(讓讀的人自己把小時換算成天 = 多一個出錯的地方)。
 *
 * ⚠️ ~~「門檻是天」~~ ⇒ 🔵 **2026-09-03 起那半不成立**:資料舊不舊的門檻仍是天
 *    ({@link FITMENT_STALE_DAYS} = 7), 而**排程死沒死的門檻改成小時**
 *    ({@link FITMENT_SCHEDULER_DEAD_HOURS} = 26)—— 理由在那個常數的說明裡。
 *    📌 **⇒ 印出來的單位與判斷用的單位從此不同**, 而這一句就是它們的接縫, 不要再合併回去。
 *
 * 🔴 與上面 {@link freshnessLabel} 同一條規矩:**量不到時印「量不到」,不印空白、不印數字。**
 *
 * 🔴🔴 **字面刻意寫「同步」而不是「資料最後更新」**(codex R2 must-fix,判定成立):
 *    ~~「車款搜尋資料最後更新:N 天前」~~ 那句話**宣稱了資料變新**,而我量到的只是
 *    **那條線成功跑完了**。上游 view 凍結而同步照樣天天成功時,舊字面會印出一個**假的綠**。
 *    ⇒ 改成「**已 N 天沒有成功過**」⇒ 這一行說的與量到的**逐字相同**,不多也不少。
 *    📌 **⇒ 那個缺口的正解不是加一個偵測不到的偵測,是【不要宣稱超過你量到的東西】。**
 *    ⚠️ 而「內容有沒有真的變新」**仍然沒有人在量**(同上面那句「供應商 feed 停更也抓不到」)
 *       ⇒ **單獨立一列**,本片不解。
 */
export function fitmentFreshnessLabel(f: DataFreshness): string {
  if (f.hoursAgo === null) return `車款搜尋同步:量不到(${f.unreadableReason ?? '原因不明'})`;
  // 🔴 負數照實印,不夾成 0 —— 同上面那條:未來時間戳 = 有東西寫錯了。
  if (f.hoursAgo < 0) return `車款搜尋同步:時間戳在未來(${(f.hoursAgo / 24).toFixed(1)} 天)`;
  if (f.hoursAgo < 24) return '車款搜尋同步:最後一次成功在 1 天內';
  const days = Math.floor(f.hoursAgo / 24);
  // 🔴🔴 兩個門檻 ⇒ **兩句話**, 而分開的理由是【看到的人下一步不同】:
  //    ~~2-6 天~~ ⇒ 🔵 **26 小時 ~ 7 天** ⇒ 去看那支排程還活著嗎(問題在【機器】)
  //    ≥ 7 天 ⇒ 資料也已經算舊了(問題在【客人看到的東西】)
  //    ⚠️ 而 24~26 小時那一段【刻意不亮】—— 它是「今天比昨天慢了一點」, 不是「掛了」。
  //    ⇒ 📌 那與 `⟦b4-PCM05SPLIT⟧` 是同一條:一個碼兩個語意, 而兩者的下一步相反 ⇒ 要拆。
  if (f.hoursAgo >= FITMENT_STALE_HOURS) {
    return `車款搜尋同步:已 ${days} 天沒有成功過(排程可能掛了, 而資料也已經算舊了)`;
  }
  if (f.hoursAgo >= FITMENT_SCHEDULER_DEAD_HOURS) {
    return `車款搜尋同步:已 ${days} 天沒有成功過(排程可能掛了 —— 它本來每天跑)`;
  }
  return `車款搜尋同步:已 ${days} 天沒有成功過`;
}

/**
 * 車款搜尋(fitment)同步的新鮮度。
 *
 * ⚠️ **「不拋」要講準**(codex 2026-09-01 nit):本函式把**查詢層**的錯誤與 reject 都接成值,
 *    **但 `createSupabaseServiceClient()` 自己**(例如缺 env)拋出來的東西**不在** `.then(ok, err)`
 *    的射程裡 ⇒ 那一種仍會讓這個 Promise reject,由首頁的 `allSettled` + `unreadable()` 接住。
 *    📌 隔壁 {@link loadDataFreshness} 檔頭那句「本函式不拋」**有同一個誤差**,一併照實收窄。
 *
 * 🔴🔴 **判準是「最後一次【成功】」,不是「最後一次跑」** ——
 *    等價於 `max(ran_at) filter (where status = 'success')`,**不是** `max(ran_at)`。
 *    理由:那條線 abort 的時候**照樣會寫一列**(`status='abort'`,實際發生過:
 *    2026-08-28 07:01 那班 `abort` / `old_count=null`)⇒ 只看 `max(ran_at)` 會把
 *    **「天天 abort」讀成「天天有更新」**,而那正是這道儀表最該叫的那一種。
 *    📌 **兩種寫法在【今天的資料】上印同一個數** ⇒ 所以測試裡有一發專門演它:
 *       塞一列「今天的 abort」+ 一列「10 天前的 success」⇒ 這裡必須回 10 天。
 *
 * ⚠️ 而「沒有任何一列」與「abort」是**兩種不同的停更**:
 *    · abort ⇒ 有列,只是 status 不是 success ⇒ 看得出來
 *    · 那台機器關機 ⇒ **一列都不會寫** ⇒ 而「沒有新的列」與「還沒到時間」長一樣
 *    ⇒ 本函式用「距最後一次成功幾天」當判準,**兩種都蓋得到**(它問的是「多久沒成功過」)。
 */
/**
 * 本支自己的逾時上限。
 *
 * 🔴🔴 **為什麼只有這一支有**(codex R2 must-fix,判定成立):首頁那六支都沒有自己的 timeout,
 *    而 `Promise.allSettled` **隔離得了【失敗】,隔離不了【永遠不回】** ⇒ 任何一支卡住整頁跟著卡。
 *    R1 我主張「那個缺口對原本五支一樣成立、不是本片帶進來的」—— **codex 兩輪都判那站不住**,
 *    理由逐字:**「原五支也有問題不能免除新增第六個失效點,且可只替新查詢加 timeout」**。
 *    ⇒ 它是對的:**「別人也有」不是「我可以再加一個」的理由**,而最小修法就在它那句話裡。
 *    ⇒ 所以這裡只包**本支**,**一個字都不碰另外五支**(碰它們 = 範圍擴張)。
 * 🔴🔴 **而它【做不到什麼】要寫在旁邊,不能只寫它做得到什麼**(codex R3 角度B,判定成立):
 *    ~~「我們要的是首頁不卡」~~ **那句話講太滿。** 同一個庫整個變黑洞時,另外五支**仍然沒有 timeout**
 *    ⇒ `Promise.allSettled` **永遠不回** ⇒ **整頁不會渲染,而這兩行字一個都不會出現。**
 *    ⇒ 本支的 timeout 真正做到的只有一件事:**它自己不再是那個把整頁吊住的人。**
 *    📌 **⇒ 「我這一格不卡」與「首頁不卡」是兩個宣稱, 而我原本把前者寫成了後者。**
 * ⚠️ **另外五支仍然沒有 timeout** ⇒ 那一格**單獨立一列**,本片不解。
 * ⚠️ 逾時之後**那個 fetch 仍在背景跑**(這裡只是不再等它),我們沒有取消請求。
 */
const FITMENT_QUERY_TIMEOUT_MS = 5_000;

export async function loadFitmentFreshness(now: Date = new Date()): Promise<DataFreshness> {
  const query = createSupabaseServiceClient()
    .from('product_fitments_effective_sync_log')
    .select('ran_at')
    // 🔴 這一行就是上面那段判準的落點 —— 拿掉它,這道儀表對「天天 abort」失明。
    .eq('status', 'success')
    .order('ran_at', { ascending: false })
    .limit(1)
    .then(
      (v) => v as { data: { ran_at?: unknown }[] | null; error: unknown },
      (error: unknown) => ({ data: null, error }),
    );

  // 🔴 逾時走的是 `TIMEOUT` 這個哨兵值,不是 reject —— 因為「逾時」與「查詢失敗」要印**不同的原因**,
  //    而讀的人看到哪一個,決定他下一步去查哪裡(去看那台 mini vs 去看我們的庫)。
  const TIMEOUT = Symbol('fitment-query-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const res = await Promise.race([
    query,
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), FITMENT_QUERY_TIMEOUT_MS);
    }),
  ]).finally(() => {
    // 🔴 沒有這一行,測試環境會被那顆 timer 吊著不結束(而正常路徑上它永遠不會觸發)。
    if (timer !== undefined) clearTimeout(timer);
  });

  if (res === TIMEOUT) {
    console.error('[freshness-read] 車款搜尋同步新鮮度查詢逾時', FITMENT_QUERY_TIMEOUT_MS);
    return unreadable(`查詢逾時(${FITMENT_QUERY_TIMEOUT_MS / 1000} 秒)`);
  }
  if (res.error) {
    console.error('[freshness-read] 車款搜尋同步新鮮度讀取失敗', res.error);
    return unreadable('查詢失敗');
  }
  // 「一列成功都沒有」不是「很新」—— 它是最壞的那一種(這條線從來沒成功過 / 紀錄被清了)。
  // 🔴🔴 **亮燈用【短的那個】(⛔ ~~2 天~~ ⇒ 🔵 2026-09-03 起 **26 小時**), 不是 7 天**
  //    —— 那正是 Sean 2026-09-02 加它的目的:
  //    7 天答的是「資料多舊算舊」, 而這道儀表要答的是「排程掛了有沒有人知道」。
  //    ⇒ 用 7 當警戒 ⇒ 每日排程可以連漏 6 天而這一行仍然是綠的。
  // ⚠️ 而 7 【沒有消失】—— 它活在 `fitmentFreshnessLabel` 的第二句裡(≥7 天時話會變)。
  //    ⇒ 📌 兩個數字都還在, 而它們各自回答自己那一題。
  return freshnessFromTimestamp(
    res.data?.[0]?.ran_at,
    now,
    FITMENT_SCHEDULER_DEAD_HOURS,
    '查無任何成功同步紀錄',
  );
}
