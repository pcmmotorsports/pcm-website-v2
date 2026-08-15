import { isoBackToTaipeiYmd, taipeiDayEndExclusiveIso, taipeiDayStartIso } from '@pcm/domain';

// today-view.ts — `#16` 今日對帳的**形狀層**:日界換算與加總,純函式、零 IO、零 next 依賴。
//
// 🔴 **為什麼與 `today-read.ts` 分兩支**:純函式的測試**不需要任何 mock**;
//    混在一起會讓算術那幾格也被迫扛著 `vi.mock('server-only')` 的樣板。
//    ⚠️ **本檔第一版給的理由是假的**(reviewer MF3):原寫「`server-only` 在 vitest 會 throw
//    ⇒ 純函式留在那支一格都測不到」——**不成立**,repo 有 **90 支**測試檔在 mock 它
//    (數法 `grep -rln "vi.mock('server-only'" apps packages --include='*.test.ts' --include='*.test.tsx' | wc -l`),
//    同一條線的隔壁 `lib/payment/refund-recovery-read.test.ts:1-10` 就是。
//    **分檔本身仍成立,但理由換掉了**;而那個假理由當初還被拿來免責「IO 層零覆蓋」。
//    🔴 **偏離字面更正**(R2 MF-E):原寫「本檔比 plan §3 多**一支**」= 低報。
//       plan §3 列 5 檔,實際 **8 檔** ⇒ 多的是 `today-view.ts` / `today-view.test.ts` /
//       `app/page.test.tsx` **三支**。另外 plan §2 承諾的「今日收款明細 ≤20 列 + 今日新單 ≤20 列」
//       兩張清單 **零交付**(plan §4 授權超時就拆,但拆了要明講)。**兩條都寫進 commit body。**
//
// 🔴🔴 **跨日沖銷:「已收 = SUM(amount)」是【全表】不變式,套上日期窗之後語意會變**(reviewer MF5)。
//    沖銷列的 `received_at` **跟著被沖的那一筆**(`20260812150000:492` 的 OP-A12 G9 逐字
//    「append 沖銷列(識別欄與 reviewed_* 全 NULL、**received_at 跟著被沖那筆**)」)。
//    ⇒ 員工**今天**沖掉**昨天**誤登的 +5000:**今天這格一毛都不會動**,被改寫的是**昨天**那個
//      已經沒人會再看的數字。
//    ⇒ 而且「今天 18:00 看到的今日實收」與「明天回頭看同一天」**可能不同**。
//    **這不是 bug,是這個口徑的性質** —— 但它必須被寫出來,不能停在「鏈式沖銷照樣成立」那句
//    (那句對全表為真、對日窗為假)。
//
// 🔴🔴 **本檔的 `sumReceived` 已經移除,而且那是一個要講清楚的損失**(R2 MF-A 連動):
//    收款改走 RPC ⇒ 加總搬到 SQL ⇒ 這裡的純函式變成死碼,連同它的 **6 格測試**一起刪掉,
//    其中包含鏈式沖銷、兩條負向對照(濾負列會變 1000 / 改用筆數會變 3)、零筆回 0、
//    以及上面那段跨日沖銷的可執行版本。
//    ⇒ **「已收 = SUM(amount)」這條錢的不變式,現在的可執行守門比之前少。**
//    替代品只有兩個,而且都比原本弱:
//      ① migration 的 `COMMENT`(字面,不是守門);
//      ② `today-read.test.ts` 的**源碼契約測試** —— 讀 migration 檔、斷言 SQL 沒有 `ABS(`、
//         沒有 `amount > 0` 這類過濾、且帶著 `COALESCE(SUM(...), 0)`。
//    ⚠️ ② **只證那句 SQL 還在檔裡,不證 DB 真的那樣算**。要補回同等強度只有一條路:
//       對真的資料庫跑一次。本片做不到(施工端無連線)⇒ **列為誠實缺口,不假裝等價。**

/**
 * 台北曆面「今天」的半開區間 `[from, to)`,**連同它自己用的 `ymd` 一起回**。
 *
 * 🔴 `ymd` 一定要從這裡出去(R2 nit2):呼叫端若自己再 `isoBackToTaipeiYmd(now)` 算一次,
 *    就有**兩份日界規格**;哪天日界改法只改一處,畫面標題的日期會與查詢區間**不同天**,
 *    而現有測試一格都不會紅(兩邊各自都「對」)。
 * `now` 可注入 ⇒ 邊界可單測。
 */
export function todayTaipeiRange(
  now: Date = new Date(),
): { ymd: string; fromIso: string; toIso: string } {
  const ymd = isoBackToTaipeiYmd(now);
  const fromIso = taipeiDayStartIso(ymd);
  const toIso = taipeiDayEndExclusiveIso(ymd);
  // 🔴 `isoBackToTaipeiYmd` 的輸出恆為合法 `YYYY-MM-DD` ⇒ 這兩個不可能是 null。
  //    但**型別上是 `string | null`**,而靜默 `?? ''` 會讓區間變成「查全部」= 今日數字暴衝。
  //    ⇒ 寧可炸,不要靜默放寬。
  if (fromIso === null || toIso === null) {
    throw new Error(`today-read: 台北日界換算失敗(ymd=${ymd})`);
  }
  return { ymd, fromIso, toIso };
}

// ══ 🪦 這裡曾經有一格「今日退款(已完成)」,2026-08-15 拆掉 ═══════════════════
//
// 🔴 **拆掉的原因不是做不出來,是它疊了兩層都沒查證過的假設**,而那一格是要拿來對帳的:
//    ① **`confirmed` 是否真的等於「退款完成」** —— 依據只到 migration CHECK
//       (`20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:186`
//        `CHECK (status IN ('processing','confirmed','failed','deferred'))`
//        + `20260801120000:337-339` 的 UPDATE 守門)⇒ **「repo 這樣寫」,不是「DB 查過」。**
//    ② **人工更正是否真的不動 `status`** —— `status='failed'` + `failed_reason='manual_failed'`
//       的退款事後被更正成「錢其實有動」(`money_moved`)時,**狀態機不讓它變回 `confirmed`**
//       (`20260814190000:69`、`:423`)⇒ `.eq('status','confirmed')` **永遠看不到它**,
//       而 `pcm_order_refundable_remaining`(同檔 `:414-425`)**會把它扣掉** ⇒ **兩處口徑不同。**
//       ⚠️ 這條的方向我有把握,但**我沒有跑過一筆真的更正去看 `status` 動了沒** ⇒ **它是推的。**
//
// 🔴 **Sean 2026-08-15 拍板:這一格「要拿來對帳、要分毫不差」。**
//    ⇒ 一個可能不準的對帳數字**比沒有那個數字更糟** —— 員工會拿它去對,對不起來,
//      而他不會知道是**數字錯**還是**帳錯**。
//
// 🔴🔴 **重做的時候先解那兩層,不要直接把 `reduce` 加回來。**
//    正解方向 = **與收款那格同構的唯讀 RPC**(讀 `order_refund_effective_verdict`,
//    讓「有沒有被更正掉」在 SQL 端就決定),**不是**在 TS 端撈列再加總。
//    ⚠️ 直接加回 `reduce` 會當場撞紅 `#473b-1 機制 2️⃣` 那格守門
//       (`packages/domain/src/order/refund-remaining-single-source.test.ts` 載體②)
//       —— **那格是對的,不要去改它、也不要往 `TS_ALLOWLIST` 補**:
//       白名單現有兩筆的 `why` 都是「不在本片修」= **既有債的登記**,
//       而這一筆是新長出來的、長在一個剛被指定要分毫不差的數字上。
//
// ⚠️ **下一個人看到「有收款、沒退款」很可能覺得是漏做** —— 不是。**是刻意拿掉的。**
// ══════════════════════════════════════════════════════════════════════════

