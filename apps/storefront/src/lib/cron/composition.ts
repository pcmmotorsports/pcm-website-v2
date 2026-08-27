import 'server-only';

// lib/cron/composition.ts — 排程自己的 composition root(⟦b4-CRON6⟧ 片1)
//
// ══ 🔴🔴 這是 storefront 第【六】道 service_role 受控門。出處寫在這裡,不寫在別處 ══════
//
// **為什麼要開**:5 支 cron route 現在**全部透過【別人的】composition root** 拿窄 adapter
//   (`@/lib/payment/composition` ×3:anomaly-alert / capture-recheck / settle-sweep;
//    `@/lib/email/composition` ×2:email-sweep / order-ineligible-gate)。
//   而**心跳是第一件「屬於排程自己、不屬於金流也不屬於信件」的事**。
//
// **為什麼不掛進既有 adapter**:那會讓**寄信的 adapter 開始管排程健康**
//   ⇒ 下一個人找不到它(他會去 `lib/cron/` 找,而它住在 `lib/email/`)。
//
// **為什麼不放 DB 那一側**:`pcm_cron.invoke_cron_route` 的 HTTP 回應層是 **fire-and-forget**
//   (`net.http_get(...) INTO v_req; RETURN v_req;` —— 回的是 request id 不是回應)
//   ⇒ 寫在那裡的心跳只證「請求丟出去了」⇒ 資訊量 ≈ `cron.job_run_details`,而它對 http 型 job
//   **恆 `succeeded`**(503 也寫 succeeded)⇒ 等於把一個已知沒有判別力的東西複製一份。
//
// **誰決定的**:主視窗 2026-08-28。
//   🔴 **而這個裁定翻過一次,翻面紀錄在**
//      `~/pcm-mailbox/pending-questions-20260827.md` 的 **`Q25` 作廢段(2026-08-29 04:xx 補)**。
//      原裁定是「**乙:不開第六道門**」,建立在一個**被量測證偽的前提**上(以為那 5 道是 5 把外流的
//      service_role 鑰匙;實測 `grep -rnE '^export .*: *(Promise<)?SupabaseClient' apps/storefront/src/lib/`
//      ⇒ **0**、正對照 6、負對照 0 ⇒ 它們是 5 個把鑰匙關在裡面的盒子)。
//      📌 **改變一個既有裁定,比下一個新裁定更需要落檔** —— 新裁定沒落檔只是「查不到」;
//         **舊裁定沒撤銷是【查得到而且是錯的】。**
//   🔴 **而 Sean 沒有拍這一板** —— 他被問到時逐字回「你覺得勒?我實在不懂」
//   ⇒ 那是**授權主視窗決定**,**不是他拍板**。**兩個強度,照這樣寫,不要在下游被寫成「Sean 批准」。**
//
// **本門的射程**:🔴 **只寫 `public.sweeper_heartbeat` 一張表。**
//   **加第二張表 = 回來重看上面這一整段**,不是順手加一個 method。
//   ⚠️ 而射程不是靠這句話守的 —— `composition.test.ts` 有一格釘住 `.from()` 的字面,
//      改成別張表那一格會紅(否則「只寫一張表」只是一句註解)。
//
// ══ ⚠️ 而這道門為什麼要寫出處(那 4 道說不出的門,是這件事真正的問題)══════════════
//   數法(自己跑,不要抄數字;⚠️ 這把尺**帶行首錨**,它會漏掉任何一道【縮排過的】真例外,
//   而拿掉行首錨它會**數到寫在註解裡的命令本身**):
//     git grep -nE "^// eslint-disable-next-line no-restricted-imports" -- 'apps/storefront/src/**'
//   2026-08-28 實查:本檔之前有 **5** 道,而**只有 `lib/auth/line-admin.ts:32` 標得出出處**
//   (逐字「Sean 2026-05-25 Q1=A 拍板、ADR-0005 §8」)。其餘四道寫的是「引 ADR」或「**鏡像另一支**」。
//   📌 **「鏡像另一支」把一道門的正當性外包給另一道門,而被鏡像的那一支自己也可能是鏡像來的**
//      ⇒ 一條沒有源頭的授權鏈,而每一環讀起來都很正當。⇒ 板子 ⟦b4-SRV5⟧ 在追這件事。
//
// 🔴 **anon 不是「比較麻煩」,是【沒有那條路】**(2026-08-28 對正式庫唯讀量到):
//   `sweeper_heartbeat` 的 `role_table_grants` 只有 `service_role` 的 SELECT/INSERT/UPDATE 與 owner;
//   `anon` / `authenticated` **零列**;RLS on + 3 條 policy 皆 `TO service_role`。
//   ⇒ 用 anon factory 寫進去 = `42501`,不是風格差別。

// eslint-disable-next-line no-restricted-imports -- 受控門,理由與射程見正上方那整段(ADR-0005 §8 形狀)
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * 心跳表的**窄通道**。刻意只有兩支、刻意不吐 client 出去。
 *
 * 🔴 **不要在這個型別上加 `client` 或任何能打到別張表的東西** —— 那一刻這道門就從
 *    「一個把鑰匙關在裡面的盒子」變成「一把外流的鑰匙」,而那正是 `no-restricted-imports` 在防的事。
 */
/**
 * 一列心跳。
 *
 * 🔴 **刻意不寫成 `Record<string, unknown>`**(第一版就是那樣,而 `tsc` 當場擋下來了):
 *    寬型別會讓**欄名打錯完全不紅** —— `last_sucess_at`(少一個 c)照樣編譯過、照樣送出去、
 *    PostgREST 回一個錯而我們**全程 catch** ⇒ **心跳從此不前進,而沒有任何東西會叫。**
 *    ⇒ 這裡窄著寫,讓生成型別(`database.types.ts`)去比對真正的欄名。
 * ⚠️ 而它擋的是**打錯字**,不是**用錯欄** —— 把 `last_success_at` 寫進失敗那一發,型別一樣過。
 *    那一格由 `heartbeat.test.ts` 的兩格 `not.toHaveProperty` 守。
 */
export type HeartbeatRow = {
  job_name: string;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  consecutive_failures?: number;
  updated_at?: string;
};

export type HeartbeatStore = {
  /** 目前的連續失敗次數;`null` = 沒有那一列或讀不到(呼叫端據此從 0 起算)。 */
  readFailureCount(jobName: string): Promise<number | null>;
  /** upsert 一列。**不拋** —— 錯誤用回傳值表達,理由見 `heartbeat.ts` 檔頭。 */
  write(row: HeartbeatRow): Promise<{ error: unknown }>;
};

/** 心跳表名。**單一字面** —— 射程守門(`composition.test.ts`)釘的就是它。 */
export const HEARTBEAT_TABLE = 'sweeper_heartbeat';

/**
 * 🔴 **lazy per-call**(與既有三道 composition root 同契約):client 在**呼叫時**才建,
 *    不在 module top —— route 的認證/限流沒過就不會走到這裡,零 env 依賴。
 */
export function getHeartbeatStore(): HeartbeatStore {
  const client = createSupabaseServiceClient();
  return {
    async readFailureCount(jobName: string): Promise<number | null> {
      const { data, error } = await client
        .from(HEARTBEAT_TABLE)
        .select('consecutive_failures')
        .eq('job_name', jobName)
        .maybeSingle();
      if (error) {
        console.error(`[heartbeat] ${jobName} 讀取失敗計數失敗`, error);
        return null;
      }
      const v = (data as { consecutive_failures?: unknown } | null)?.consecutive_failures;
      return typeof v === 'number' ? v : null;
    },
    async write(row: HeartbeatRow): Promise<{ error: unknown }> {
      // 🔴 `onConflict` 不能省:少了它 upsert 會退化成 insert ⇒ 第二輪起每次撞 PK
      //    ⇒ 心跳從此停在第一次,而**畫面上那是「很久沒有心跳」= 假陽性**。
      return client.from(HEARTBEAT_TABLE).upsert(row, { onConflict: 'job_name' });
    },
  };
}
