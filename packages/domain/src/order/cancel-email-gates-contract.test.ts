import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 **本檔存在的理由是一個【跨檔假設】, 而跨檔假設沒有任何一支測試守得住** ——
 * 每支測試的分母是自己那支檔, 兩邊各自全綠, 而**合起來推翻前提**。
 *
 * ## 那個前提是什麼(M-4b 段 1 片 B)
 * 片 B 會在客人改用刷卡時, 把那張**未付款的匯款單**就地取消。
 * 而我們**刻意不通知客人** —— 理由是「取消信那條路根本收不到這種單」:
 * ```
 * 🔬 20260902140000_m4b_mark_order_cancelled.sql:450 逐字:
 *    「三道閘住在函式裡:cancelled_at IS NULL · payment_method = tappay · payment_status = refunded」
 * ⇒ 匯款單:payment_method 不是 tappay + payment_status 是 unpaid ⇒ **兩道閘都不過。**
 * ```
 * 🛑 **⇒ 而那三道閘住在【別人的檔】裡。它哪天放寬了, 我這片就開始寄信 —— 而沒有東西會叫。**
 * ⇒ 📌 **所以這一格不是一句安心話, 是一個會紅的東西。**(主視窗 2026-09-04 要求)
 *
 * ⏰ **這一檔什麼時候該重讀**:有人動 `admin_mark_order_cancelled` 的三道閘、
 *    或片 B 改成「主動通知客人」的那一刻。
 */
/**
 * 🔴🔴 **這個路徑我第一版盯錯了版本, 而那不是「忘了跑工具」。**
 * ⛔ ~~原本指 `20260902140000_m4b_mark_order_cancelled.sql`~~ —— 那是**舊那一代**。
 * 🔬 `bash scripts/latest-definition-of.sh admin_mark_order_cancelled` ⇒
 *    newest = **20260903093000**_m4b_b4cancelkind_reject_reserved_reason.sql(共 2 代)
 * 📌 **我為【我要改的兩支函式】都跑了那支工具, 而【我要引用的這一支】沒跑** ——
 *    ⇒ 我把它讀成「我在定義的那個」, 而工具的射程是【任何一個別人的東西】。
 * ✅ **判別句**:**這一片有幾個「別人的東西」被我引用了?每一個都要跑一次。**
 * 🛑 而**盯錯版本這件事沒有任何測試守得住** —— 兩邊各自全綠。
 *
 * 🔴🔴 **而換代之後【字面本身也變了】, 這一格差點又騙我一次**:
 * ```
 * 舊代(20260902140000):payment_method = 'tappay'                  ← 允許式
 * 新代(20260903093000):payment_method IS DISTINCT FROM 'tappay'   ← **拒絕式**(:729)
 * ```
 * ⇒ 📌 **我第一版的斷言字串是從【舊代的寫法】抄來的** —— 改成新檔之後它當場紅,
 *    而**紅得對**:那個字面在新代裡真的不存在。
 * ⇒ 🎯 **⇒ 「盯住最新那一代」與「照最新那一代的字面寫斷言」是兩件事, 而第二件沒做會假紅。**
 */
const CANCEL_EMAIL_MIGRATION = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql',
);

/**
 * 🔴 **剝掉 `--` 行註解再比** —— 否則一句「我們檢查 payment_method = 'tappay'」的**註解**
 * 就足以餵綠這把尺, 而真正的閘可能已經被刪掉。(codex 關卡2 must-fix ⑧)
 * 📌 這是同一族的第 N 次:**用字面比對驗「碼在不在」時, 分母天生包含註解。**
 */
function codeOnly(sql: string): string {
  // 🔴🔴 **2026-09-05:塊註解也要剝**(codex 關卡2 R3, 順路撞到 —— 修法同 `20260904050000` ②)。
  //    ⛔ ~~原本只剝 `--` 行註解~~ —— 而 codex 交了一個可以直接拿去用的假綠字面:
  //      `/* payment_method IS DISTINCT FROM 'tappay'; payment_status IS DISTINCT FROM 'refunded';
  //        cancelled_at IS NOT NULL */`
  //      ⇒ 🎯 **把真的三道閘刪光, 這支測試照樣通過。**
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/**
 * 🛑 **這把尺【還是】會壞, 而剩下的兩種我寫出來而不假裝修好了**(2026-09-05 逐項實測):
 * ```
 * 正常碼                      ⇒ 找得到  ✅
 * 行註解裡                    ⇒ 找不到  ✅
 * 塊註解裡                    ⇒ 找不到  ✅ ← 本次修的
 * 🔴 字串常值裡 '…IS DISTINCT FROM…'  ⇒ **找得到** ⇒ 假綠(碼刪光了它還說在)
 * 🔴 字串裡有 `--`(`'客服單--保留'`)  ⇒ **找不到** ⇒ 假紅(碼在而它說不在)
 * ```
 * 🎯 **兩種失效方向相反** —— 一種讓壞碼過關, 一種讓好碼被擋。
 * 📌 **要真的修它得寫一個 SQL lexer, 而那不是一支契約測試該長的樣子。**
 *    ⇒ 🔵 **所以這支測試的定位是【便宜的早期訊號】, 不是守門。**
 *      真正的判別力在**行為測試**:餵一張匯款單進去, 看它有沒有收到取消信。
 * ⚠️ **而那個行為測試現在【不存在】** —— 這句話寫在這裡, 是因為讀這支檔的人
 *    最可能誤以為「有這支測試 = 那三道閘被守住了」。
 */

describe('取消信的三道閘 · 跨檔契約(M-4b 段 1 片 B 的前提)', () => {
  it('🔴 那三道閘的字面必須都還在 —— 少一道 ⇒ 匯款單可能開始收到取消信', () => {
    const code = codeOnly(readFileSync(CANCEL_EMAIL_MIGRATION, 'utf8'));
    // 🔵 **先證這把尺接上了** —— 否則下面在量一個空字串。
    expect(code.length).toBeGreaterThan(1000);

    // 🔴 抓【SQL 實際寫的】, 不是抓我期望的。三道缺一不可。
    // 🔬 逐字取自 20260903093000_...:726 / :729 / :734(拒絕式, 不是允許式)
    expect(code).toContain("payment_method IS DISTINCT FROM 'tappay'");
    expect(code).toContain("payment_status IS DISTINCT FROM 'refunded'");
    expect(code).toContain('cancelled_at IS NOT NULL');
  });

  it('🔵 負對照:同一把尺對【改掉字面】的版本必須抓不到(否則上一格恆綠)', () => {
    // 🛑 少了這一格, 一個「永遠 toContain 成功」的寫法會在兩個世界都綠。
    //    這裡用一份**改過字面的副本**當那個世界 —— 而它是字串, 不動磁碟上任何檔。
    const code = codeOnly(readFileSync(CANCEL_EMAIL_MIGRATION, 'utf8'));
    const widened = code.replace(/payment_method IS DISTINCT FROM 'tappay'/g, 'FALSE');
    expect(widened).not.toContain("payment_method IS DISTINCT FROM 'tappay'");
    // 🔴 而它證的是「尺會因為那一道閘被放寬而變色」, 不只是「字串取代能動」。
    expect(code).toContain("payment_method IS DISTINCT FROM 'tappay'");

    // 🔴 **第三格:證明剝註解那一步真的有作用** ——
    //    餵一份「只有註解提到那道閘」的假 SQL ⇒ 剝完之後必須抓不到。
    //    🛑 少了這一格, `codeOnly` 寫成 `s => s` 也會讓上面兩格全綠。
    const commentOnly =
      "-- 我們檢查 payment_method IS DISTINCT FROM 'tappay' 而這裡沒有真的碼\nSELECT 1;";
    expect(commentOnly).toContain("payment_method IS DISTINCT FROM 'tappay'");
    expect(codeOnly(commentOnly)).not.toContain("payment_method IS DISTINCT FROM 'tappay'");
  });
});
