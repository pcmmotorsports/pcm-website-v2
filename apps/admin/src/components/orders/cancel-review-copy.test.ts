// cancel-review-copy.test.ts —— `charge_attempt_blocked` 那一格文案的兩道守門。
//
// 🔴 **為什麼這一格要單獨守,而不是併進 cancel-review-section.test.tsx**:
//   那支測的是「元件怎麼渲染」;本支測的是「**Sean 逐字定稿的字面沒有被改掉**」——
//   兩者失敗時要修的東西不同(前者改元件、後者去問 Sean),混在一起會讓紅燈指錯方向。
//
// 兩發各守一個世界,而【第二發不是第一發的重複】:
//   ① 逐字釘死  ⇒ 有人動 Sean 的字（含潤飾、改標點）就紅
//   ② 舊字面不得回來 ⇒ 「請重新整理」這句**永遠不會有結果**的話跑回來就紅
//      🔴 ② 守的不是字面,是**理由**:正式庫此刻有 5 張單卡在這個狀態（含 Sean 自己問的
//         `2SQH2P` / `GVRDMH`),重整一百次都不會變 ⇒ 叫人去重整 = 叫人做一件做不到的事。
//         ⚠️ 只有 ① 的話,有人把 hint 改寫成「請稍後重新整理」會**通過**——字面不同、病一樣。
import { describe, expect, it } from 'vitest';
import { BLOCK_REASON_TEXT } from './cancel-review-section';

describe('charge_attempt_blocked 文案(Sean 2026-08-21 逐字定稿)', () => {
  const entry = BLOCK_REASON_TEXT.charge_attempt_blocked;

  it('① 逐字釘死 —— 改任何一個字都要先問 Sean', () => {
    expect(entry.title).toBe('這張單有一筆刷卡還沒有結束');
    expect(entry.hint).toBe(
      '要等那筆刷卡有結果(成功或失敗)才能取消。重整沒有用,卡住的話去 TapPay 後台查那筆。',
    );
  });

  it('② 🔴 不得叫員工去做一件永遠沒有結果的事(舊字面與它的近親都不准回來)', () => {
    const all = `${entry.title}${entry.hint}`;
    // 「重新整理」= 舊字面本體;而「重整沒有用」是新文案刻意保留的字,所以只擋「重新整理」。
    expect(all).not.toContain('重新整理');
    expect(all).not.toContain('稍後再試');
    expect(all).not.toContain('通知系統維護');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 `#808`/`#387` gate 拆四態(2026-08-21,Sean 答甲)之後新長出來的那一格。
//
// ⚠️ **與上面那個 describe 的證據等級【不同】,不要一起讀成「Sean 定稿的兩格」**:
//   · `charge_attempt_blocked` ⇒ 🟢 Sean 2026-08-21 親自逐字定稿(他選甲)
//   · `charge_attempt_stuck`   ⇒ 🟡 **實作者照他那格的語氣寫的草稿,他還沒看過**
//   ⇒ 本 describe 守的**不是**「Sean 的字沒被改掉」,而是「這段話沒有退化成叫人做做不到的事」。
//     Sean 定稿之後,把本段升級成逐字釘死、並把這段註解改掉。
// ─────────────────────────────────────────────────────────────────────────────
describe('charge_attempt_stuck 文案(🟡 待 Sean 逐字定稿)', () => {
  const entry = BLOCK_REASON_TEXT.charge_attempt_stuck;

  it('① 🔴 三句禁語 —— 全部是「他做不到」或「沒有收訊者」的動作', () => {
    const all = `${entry.title}${entry.hint}`;
    // 重整:那是跑了 12 天的死迴圈本體(`expire_stuck_attempts_at_ceiling` 只舉手、不改狀態)。
    expect(all).not.toContain('重新整理');
    expect(all).not.toContain('稍後再試');
    // 通知系統維護:後台沒有這個窗口 ⇒ 那句話送不到任何人手上。
    expect(all).not.toContain('通知系統維護');
    // 標記免處理:告警信逐字叫收件人做這件事,而那顆按鈕在後台不存在(`#818` 實查零命中)。
    expect(all).not.toContain('免處理');
  });

  it('②-b 🔴 不得斷言「它不會自己變」—— 2026-08-22 實查 CRON_SWEEPER_ENABLED=true', () => {
    // 🔴 上一版 hint 逐字寫「**不要坐著等它自己變**」，而那句話被證偽了:
    //   `20260627120000_..._b1a_claim_expired_pending_attempts.sql:16` 逐字「不濾 needs_manual_review、
    //   繞 sweeper 的 ceiling」，接在 `settle-sweep/route.ts:226` 的 `reconfirmExpiredOrphans`，
    //   而唯一的閘 `route.ts:156` `CRON_SWEEPER_ENABLED !== 'true'`
    //   ⇒ **Sean 2026-08-22 親自去 Vercel 看，逐字回報 `CRON_SWEEPER_ENABLED : true`。**
    //   ⇒ 被舉手的單**仍會**每隔幾小時被低頻再確認 ⇒ TapPay 一回 paid，它就會自己變。
    // 🔴 這一格守的是**方向**:上一版防「叫他等一件不會來的事」，
    //   而它自己犯了反面 ——「叫他別等一件可能會來的事」。**兩個方向都不許斷言。**
    const all = `${entry.title}${entry.hint}`;
    for (const 斷言句 of ['不會自己變', '不要坐著等', '永遠不會']) {
      expect(all, `這句話在 sweeper 開著時是假的:${斷言句}`).not.toContain(斷言句);
    }
    // 🔴 正向對照:證明它有把「可能會好」這件事講出來，而不是靠【什麼都不說】通過上面那圈。
    expect(all).toContain('不保證');
  });

  it('② 🔴 要說出他今天【唯一做得到】的那件事', () => {
    // 少了這一格,①那三條禁語可以靠「把話全部刪光」通過 —— 空字串滿足所有 not.toContain。
    expect(entry.hint).toContain('TapPay');
  });

  it('③ 🔴 要說出「這張單不會自己好」—— 那正是本片存在的理由', () => {
    // Sean 看到並選了甲的那一句:「而重整永遠不會有變化」。
    // 這一格把那句話變成守門:有人把文案改回「等它跑完」的語氣,這裡紅。
    expect(`${entry.title}${entry.hint}`).toContain('停止自動重試');
  });

  it('④ 🔴 這一格的話在【整張文案表】裡是獨一無二的', () => {
    // 🔴 **第一版只跟 `charge_attempt_blocked` 比,而那是一格【永遠不可能紅】的守門**
    //   (對抗審查 R1 F4 抓到):③ 已經要求本格含「停止自動重試」,而 blocked 那格兩句都沒有這五個字
    //   ⇒ ④ 在邏輯上被 ③ 嚴格蘊含。它讀起來像多守了一個軸,實際判別力是 0。
    //   (同族病例:`SupabaseOrderAdapter.test.ts` 自己記過的「拿掉②或③,85 格全綠」。)
    // ⇒ 改成對**整張表**比對:任何一格被複製貼上到另一格都會紅,而這不被 ③ 蘊含。
    const all = Object.entries(BLOCK_REASON_TEXT).filter(([code]) => code !== 'charge_attempt_stuck');
    for (const [code, other] of all) {
      expect(other.title, `${code} 的 title 與 charge_attempt_stuck 撞了`).not.toBe(entry.title);
      expect(other.hint, `${code} 的 hint 與 charge_attempt_stuck 撞了`).not.toBe(entry.hint);
    }
    // 🔴 正向對照:證明上面那個迴圈不是空的(分母 > 0),否則整格恆真。
    expect(all.length).toBeGreaterThan(5);
  });
});
