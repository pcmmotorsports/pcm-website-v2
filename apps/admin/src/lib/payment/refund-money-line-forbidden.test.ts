import { describe, expect, it } from 'vitest';
import { EMPTY_REFUND_INPUT, refundFailure } from './refund-action-state';

/**
 * ⟦b4-MONEYLINE⟧ **的【不得補】那一半** —— 2026-08-31,線【DB 與金流】。
 *
 * 🔴 **那一列有兩半, 而只有一半是我的**:
 * · **補字**那半(`already_refunded` / `no_card_transaction` 要不要加「錢沒有動」)
 *   = **員工看得到的字** ⇒ Sean 拍板 ⇒ **本檔不碰, 也不預先鎖住它們。**
 * · **不得補**那半 = **事實, 不是品味** ⇒ 本檔就是它。
 *
 * ## 為什麼這半急
 * 那一列自己逐字寫著:「**一條只寫「補滿」的判準, 會讓人把那兩條也補上**」。
 * 而今天**沒有任何東西**在擋那個動作:
 * `FAILURE_MESSAGES` 是一張表, 一個 `sed` 就補滿了, **三綠不會紅**。
 *
 * ## 這五個碼為什麼不得寫「錢沒有動」(逐個追過 return 點, 不是憑語意猜)
 * 📌 **一個失敗碼會從【好幾個地方】回, 而它們與「動錢那一步」的相對位置不一樣。**
 * **訊息綁在【碼】上, 而事實綁在【位置】上。**
 * ```
 * bug          :424 在 RPC catch(沒動)  🔴 而 :597 在 finalizeSafely 之後的 **accepted** 分支
 *                                          ⇒ TapPay 已受理、錢動了 ⇒ 補那句 = 直接的假話
 * error        :200 讀單失敗(沒動)      🔴 而 :429 是 initiate 的 transient ⇒ INSERT 可能已 commit
 * in_flight    RPC 回 IN_FLIGHT ⇒ **這一次**沒發起, 而【另一筆正在跑】
 *                                          ⇒ 「錢沒有動」會被讀成「完全沒有錢在動」= 誤導
 * held         真的不知道錢動了沒        ⇒ 寫「錢沒有動」是說謊
 * unknown_state 真的不知道錢動了沒       ⇒ 同上
 * ```
 * (行號取自 `refund-actions.ts`, 2026-08-31 板 `:729` 那一列逐條追出來的;
 *  ⚠️ **行號會漂** —— 本檔釘的是**那句話在不在**, 不是那些行號。)
 *
 * ## 🛑 而本檔【不】是「文案測試」
 * 它不管那五句話怎麼寫、寫多長、用什麼語氣。它只擋一件事:
 * **在這五個碼上出現一句【關於錢的、而且是假的】斷言。**
 * ⇒ 所以它用的是**否定**斷言, 而不是比對整句字面 —— 文案改了本檔不會假紅。
 */

// 🔵 這五個是【禁止清單】, 不是全集 —— 全集裡其他碼帶不帶那句話, 本檔不管。
const MUST_NOT_CLAIM_NO_MONEY_MOVED = [
  'bug',
  'error',
  'in_flight',
  'held',
  'unknown_state',
] as const;

// 🔴 為什麼不只比「錢沒有動」四個字:同義的講法一樣是假話。
//    ⚠️ 而這條 regex 【自己】要有負對照(下面那個 describe)——
//       一條抓不到東西的 regex, 與一份乾淨的訊息表, 印同一個綠。
const CLAIMS_NO_MONEY_MOVED = /錢沒有動|錢沒動|沒有動到錢|沒有扣款|款項未動/;

function messageOf(code: Parameters<typeof refundFailure>[0]): string {
  const state = refundFailure(code, EMPTY_REFUND_INPUT, 'tok');
  if (state.status !== 'failed') throw new Error(`refundFailure('${code}') 回了非 failed 狀態`);
  return state.message;
}

describe('⟦b4-MONEYLINE⟧ 這五個碼不得宣稱「錢沒有動」', () => {
  it.each(MUST_NOT_CLAIM_NO_MONEY_MOVED)(
    '%s ⇒ 訊息裡沒有那句話(它的 return 點【不是全部】都在動錢之前)',
    (code) => {
      expect(messageOf(code)).not.toMatch(CLAIMS_NO_MONEY_MOVED);
    },
  );

  it('🔵 正對照:`exceeds_remaining` 就是帶那句話的 —— 證明這把尺讀得到它', () => {
    // 🔴 沒有這一格, 上面那五格在【regex 壞掉】與【訊息真的乾淨】兩個世界印同一個綠。
    expect(messageOf('exceeds_remaining')).toMatch(CLAIMS_NO_MONEY_MOVED);
  });

  it('🔵 負對照:regex 對一句不談錢的話不開火', () => {
    expect('請重新整理後再試一次。').not.toMatch(CLAIMS_NO_MONEY_MOVED);
  });

  it('🔴 regex 的同義詞那幾項【每一項】都要能單獨開火(否則它們是裝飾)', () => {
    for (const s of ['錢沒有動', '錢沒動', '沒有動到錢', '沒有扣款', '款項未動']) {
      expect(s, `「${s}」這一項沒開火 ⇒ 它在 regex 裡是死的`).toMatch(CLAIMS_NO_MONEY_MOVED);
    }
  });

  it('🛑 本檔【不】主張另外兩個碼該不該補 —— 那是 Sean 的字', () => {
    // ⟦b4-MONEYLINE⟧ 的另一半:`already_refunded` / `no_card_transaction` 的 return 點
    // 確實全部在動錢之前 ⇒ **可以**補。而「要不要補、補什麼字」是文案 ⇒ 未問, 未鎖。
    // 📌 這一格存在的理由:**讓下一個讀本檔的人不要把「本檔沒管它們」讀成「它們不該補」。**
    //    ⇒ 一份禁止清單, 最容易被讀成一份完整清單。
    expect(MUST_NOT_CLAIM_NO_MONEY_MOVED).not.toContain('already_refunded');
    expect(MUST_NOT_CLAIM_NO_MONEY_MOVED).not.toContain('no_card_transaction');
  });
});
