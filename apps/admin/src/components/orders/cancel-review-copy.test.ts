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
