// refund-action-state.test.ts — 卡片退款失敗文案的**事實守門**(2026-09-01)。
//
// 🔴🔴 **這一支釘的不是措辭,是【每一句話在它自己那一格是不是真的】。**
//    措辭以後可以改;而「錢有沒有離開我們」是那一格的事實,不會因為換句話說而改變。
//    ⇒ 所以下面每一格都寫成「**這一句不得出現 X**」或「**必須出現 X**」,
//      而不是 `toBe('某某某某。')` —— 後者會在任何一次無害的潤稿時假紅,
//      而它守不住真正要守的東西。
//
// ══ 為什麼這支檔在 2026-09-01 才出現 ═══════════════════════════════════════
//    量到的:這幾句員工看得到的失敗文案,在**測試檔裡出現 0 次**
//    ⇒ 📌 **改它、或把它改回去,都不會有任何東西紅。**
//    而本次剛好改了兩句(`⟦b4-MONEYLINE⟧` 逐條實查的結果)——
//    🔴 **改文案而不同時補守門,等於把下一次改回去的成本也一起降到零。**
//
// ══ 🔴 最重的一格:`already_refunded` 不得說「錢沒有動」 ════════════════════
//    它的觸發條件是 `refund-actions.ts:215-216` 的 `order.paymentStatus === 'refunded'`
//    ⇒ **這張單已經全額退款過 ⇒ 錢動過。**
//    ⇒ 補「錢沒有動」⇒ 員工以為客人沒收到 ⇒ **他會再退一次。**
//    ⇒ 📌 那不是文案不精確,是**一句會導致重複退款的文案**。

import { describe, expect, it } from 'vitest';

import {
  REFUND_FAILURE_CODES,
  refundFailure,
  type RefundFailureCode,
} from './refund-action-state';

const INPUT = { amount: '100', reason: '測試', confirmCode: '1234' } as const;
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function messageOf(code: RefundFailureCode): string {
  const out = refundFailure(code, INPUT as never, TOKEN);
  if (out.status !== 'failed') throw new Error(`${code} 應該是 failed`);
  return out.message;
}

/**
 * ⟦b4-CAPMSGNUM⟧ 帶 options 的版本。
 * 🔴 `RefundActionState` 是 discriminated union ⇒ **直接讀 `.message` typecheck 會紅**
 *    (`{ status: 'idle' }` 那一支沒有 `message`)⇒ 這裡與 `messageOf` 一樣先窄化。
 */
function messageWith(
  code: RefundFailureCode,
  options: { readonly remainingCap?: number | null },
): string {
  const out = refundFailure(code, INPUT as never, TOKEN, options);
  if (out.status !== 'failed') throw new Error(`${code} 應該是 failed`);
  return out.message;
}

const MONEY_LINE = '錢沒有動';
const NOT_INITIATED = '退款沒有發起';

describe('🔴 錢動過的那一格,不得說錢沒有動', () => {
  it('already_refunded 不得出現「錢沒有動」', () => {
    const msg = messageOf('already_refunded');
    // 🔵 正向對照:這一句真的有內容,不是空字串讓下面的否定式恆真。
    expect(msg.length).toBeGreaterThan(10);
    expect(msg).not.toContain(MONEY_LINE);
  });

  it('already_refunded 應該說「退款沒有發起」(前半是真的)', () => {
    expect(messageOf('already_refunded')).toContain(NOT_INITIATED);
  });
});

describe('🔴 錢狀態【不知道】的那些格,兩句都不得出現', () => {
  // 這三條在 RPC 之【後】才產生:in_flight(有一筆正在處理中)、
  // held(TapPay 已受理而金額不符)、unknown_state(請求可能已送達 TapPay)。
  // ⇒ 說「動了」或「沒動」都是在假裝知道。
  // ⚠️ `error` / `bug` 也在這一族,而它們更糟:一句話涵蓋好幾個世界
  //    (`refund-actions.ts:206` RPC 前 vs `:435` 回應斷在路上;`:430` vs `:603` vs `:676`)
  //    ⇒ 那一句話沒有資格回答「錢動了沒」。
  const UNKNOWN: RefundFailureCode[] = ['in_flight', 'held', 'unknown_state', 'error', 'bug'];

  it('五條都不得出現「錢沒有動」', () => {
    for (const code of UNKNOWN) {
      const msg = messageOf(code);
      expect(msg.length, `${code} 應該有文案`).toBeGreaterThan(10);
      expect(msg, `${code} 不得宣稱錢沒有動`).not.toContain(MONEY_LINE);
    }
  });
});

describe('🟢 錢確實沒動的那一格,兩半都要說', () => {
  it('no_card_transaction 兩句都在', () => {
    const msg = messageOf('no_card_transaction');
    expect(msg).toContain(NOT_INITIATED);
    expect(msg).toContain(MONEY_LINE);
  });
});

describe('🔵 對照:這把尺確實分得出兩種世界', () => {
  // 🔴 沒有這一格的話,上面每一條否定式都可能是因為【尺根本找不到那四個字】而過。
  //    ⇒ 那正是今晚全隊撞了八次的形狀:一把沒接上的尺,印出來的永遠是「沒問題」。
  it('至少有一條文案【真的】帶著「錢沒有動」四個字', () => {
    const withMoneyLine = (
      ['no_card_transaction', 'db_config'] as RefundFailureCode[]
    ).filter((c) => messageOf(c).includes(MONEY_LINE));
    expect(withMoneyLine.length).toBeGreaterThan(0);
  });

  it('負對照:現造的字串一條都不會命中', () => {
    const ALL: RefundFailureCode[] = [
      'already_refunded',
      'no_card_transaction',
      'in_flight',
      'held',
      'unknown_state',
      'error',
      'bug',
    ];
    for (const code of ALL) {
      expect(messageOf(code), `${code}`).not.toContain('ZZQ不存在的字串');
    }
  });
  // ── ⟦b4-CAPMSGNUM⟧ DB 算好的上限有沒有走到【員工眼前】 ──────────────────────
  //  🔴 這一組是那一列的【收工判準】:「那句話帶得出實際可退金額 = 本列可關」。
  //  🔴 而它**不釘整句話** —— 釘的是「有沒有那個數字」。字面是 Sean 的, 他隨時可以改。
  it('🔴 exceeds_remaining 帶得出 DB 算好的上限(⟦b4-CAPMSGNUM⟧ 收工判準)', () => {
    const msg = messageWith('exceeds_remaining', { remainingCap: 300 });
    expect(msg).toContain('300');
    expect(msg).toContain('元');
  });

  // 🟢 **負對照 ①:沒有 cap ⇒ 那句話必須與今天【逐字相同】** ——
  //    這一格守的是「DB 還沒 apply 新的那一支時, 畫面不會多出一個空括號或 undefined」。
  it('🟢 負對照:沒有 cap ⇒ 訊息逐字等於沒帶 options 的那一版', () => {
    const withNull = messageWith('exceeds_remaining', { remainingCap: null });
    const without = messageOf('exceeds_remaining');
    expect(withNull).toBe(without);
    expect(withNull).not.toContain('undefined');
    expect(withNull).not.toContain('()');
  });

  // ⛔ ~~負對照②「別的碼不帶 cap 時不准冒出數字」~~ **【codex R1 nit ——它是恆真的】**
  //    原版根本沒有傳 cap 進去 ⇒ 即使實作把數字附到**每一個**失敗碼, 那一格照樣綠。
  //    ⇒ 📌 **一個負對照必須【在錯的世界裡紅】—— 而它連進不進得去那個世界都沒演。**
  //    ⇒ 而正確的守門位置**不在這一層**:本層 `refundFailure` 是【刻意】與碼無關的
  //      (分支寫在值上不寫在碼上), 保證住在上游 `capFromDetails` 的 SQLSTATE 綁定
  //      ⇒ 那一格由 `refund-repository.test.ts` 的「PCM05 帶了 cap 也要回 null」承重。
  //    ⇒ ⇒ 所以這裡改成釘本層真正的契約:**有 cap 就印、沒有就一個字都不加。**
  it('🟢 本層的契約:cap 決定印不印, 而【碼】不參與(保證在上游, 見 capFromDetails)', () => {
    // 錯的世界:如果有人讓某個碼「自己生一個數字」, 這一格會紅
    expect(messageOf('exceeds_unknown')).not.toMatch(/[0-9]+ 元/);
    // 🔵 而對的世界要證明這把尺撈得到那種形狀 —— 否則上一行在任何實作下都綠
    expect(messageWith('exceeds_unknown', { remainingCap: 300 })).toMatch(/300 元/);
  });

  // 🔴 **【codex R1 MF1】那個數字是【快照】不是【現值】—— 而這一格釘的是事實不是措辭。**
  //    例外一回滾, DB 的鎖就放掉了 ⇒ 別的交易可以立刻改變 cap
  //    ⇒ **員工讀到它的時候它已經是過去式。**
  //    ⇒ 📌 所以那句話**不得宣稱它是「目前」的** —— 那與本檔的立檔精神一致:
  //      「釘的不是措辭, 是【每一句話在它自己那一格是不是真的】」。
  //    ✅ 字面仍然是 Sean 的:他可以換句話說, 只要不宣稱它是現值。
  it('🔴 只要訊息裡有金額, 就【必須】同時說「它會變」與「它不是該退的金額」(守類不守字串)', () => {
    // 🔴 **【codex R2:上一版守的是特定字串, 不是那一類語意】**
    //    上一版只禁「目前的上限是」⇒ 換成「目前上限為 / 現在上限是」照樣過。
    //    ⇒ 📌 **黑名單在跟下一個沒想到的講法賽跑**(同 `CLAUDE.md` 那條 token 前綴的形狀)。
    //    ⇒ ⇒ 改成**白名單式的不變式**:**有數字 ⇒ 必須有那一句。**
    //      它與講法無關, 而它正是那一句話唯一要成立的事實。
    //    🔵 而碼那一側本來就是這樣構造的:數字與那一句在**同一個樣板字串**裡, 拆不開。
    //      這一格釘的是「不准有人把它們拆開」。
    const VOLATILE = /會隨|以重送時|可能已|不是現值/;
    // 🔴 **【codex R3】有金額 ⇒ 還必須說出「這不是該退的金額」** ——
    //    否則員工會照著那個數字重送, 而它是【系統容許的最高額】不是【這次該退的錢】。
    //    ⇒ 📌 一個數字加上去之後, 它就帶著權威感 —— 而權威感是這片新增的風險, 不是原本就有的。
    const NOT_THE_AMOUNT = /不是這次該退的金額|不是應退金額|不是該退的金額/;
    const MONEY = /[0-9]+ 元/;
    for (const code of REFUND_FAILURE_CODES) {
      for (const cap of [300, 0, null] as const) {
        const msg = messageWith(code, { remainingCap: cap });
        if (MONEY.test(msg)) {
          expect(msg, `${code} / cap=${cap}:有金額而沒有講它會變`).toMatch(VOLATILE);
          expect(msg, `${code} / cap=${cap}:有金額而沒有講它不是該退的金額`).toMatch(NOT_THE_AMOUNT);
        }
      }
    }
    // 🔵 **正對照:這把尺真的撈得到那種形狀** —— 否則上面整個迴圈在「永遠沒有金額」時恆真
    const withCap = messageWith('exceeds_remaining', { remainingCap: 300 });
    expect(withCap).toMatch(MONEY);
    expect(withCap).toMatch(VOLATILE);
    expect(withCap).toMatch(NOT_THE_AMOUNT);
    // 🔵 **負對照:現造一句「有金額而沒有那一句」⇒ 這把尺必須紅**
    expect(MONEY.test('上限是 300 元。') && !VOLATILE.test('上限是 300 元。')).toBe(true);
  });

  // 🔴 **每一句叫員工「再試一次」的話, 都必須有一個【出口】**(codex 換角度那一問)——
  //    沒有出口的重試指示 = 員工會一直按, 而系統永遠給同一句話。
  //    ⇒ 這一格【不釘措辭】, 釘的是那個結構:**有「重新整理/再試」⇒ 必須有「還是不行怎麼辦」。**
  it('🔴 叫人重試的訊息必須帶出口(不然他會一直按)', () => {
    const RETRY = /重新整理|再試/;
    // 🔴 **第一版這把尺【太窄】, 而它產出的是【假指控】** —— 它把 3 句判成違規, 而逐句開檔看:
    //    `nothing_left` 的出口是「**勿直接重發**」;`error` 的出口是「系統會辨識這筆請求並
    //    **回報它的現況**」⇒ 兩句都有出口, 只是用了我沒想到的講法。
    //    ⇒ 📌 **一把尺太窄時, 它產出的不是漏報而是【假指控】—— 而假指控會讓人去改本來對的東西。**
    const EXIT = /若仍|仍然|勿反覆|勿直接重發|勿重發|通知系統維護|請勿重試|回報它的現況|超過/;
    const offenders: string[] = [];
    for (const code of REFUND_FAILURE_CODES) {
      const msg = messageOf(code);
      if (RETRY.test(msg) && !EXIT.test(msg)) offenders.push(code);
    }
    // 🔴 **已知欠債清單, 不是空集合** —— `record_unavailable` 逐字「稍後可再試一次。」**沒有出口**。
    //    ⇒ 它是【本片之前就在的】, 而它是員工看得到的字 ⇒ **字面是 Sean 的, 本片不改。**
    //    ⇒ 已交板 `⟦5b-RETRYNOEXIT1⟧`。
    //    🎯 **而這一格的價值不是「現在乾淨」, 是【它不准再長】**:
    //      任何人新增一句沒有出口的重試指示, 這裡就紅。
    //    🛑 而 `order_not_found`【不得】出現在這個清單裡 —— 本片剛把它修好, 而它是本片的主線。
    const KNOWN_DEBT = ['record_unavailable'];
    // 🔴 **【codex R2 新洞】原本寫 `toEqual(KNOWN_DEBT)` —— 那是【精確相等】**
    //    ⇒ 有人把 `record_unavailable` 真的修好, 這一格會【紅】
    //    ⇒ 📌 **一道防欠債長大的守門, 反而把欠債凍進綠燈基線 —— 它懲罰的正是它要鼓勵的行為。**
    //    ⇒ ⇒ 改成【子集】:不准長出新的, 而修掉舊的隨時可以。
    const grew = offenders.filter((c) => !KNOWN_DEBT.includes(c));
    expect(grew, `新長出來的「叫人重試而沒有出口」:${grew.join(', ')}`).toEqual([]);
    // 🛑 而 `order_not_found` 不得在裡面 —— 本片剛把它修好, 它是本片的主線
    expect(offenders).not.toContain('order_not_found');
    // 🔵 而基線縮小是好事, 不是壞事:這一行只是把現況印出來, 不當判準
    if (offenders.length < KNOWN_DEBT.length) {
      console.log(`🟢 重試出口欠債從 ${KNOWN_DEBT.length} 降到 ${offenders.length} —— 可以更新 KNOWN_DEBT`);
    }
    // 🔵 **正對照:這把尺撈得到那種形狀** —— 否則它在「沒有任何一句叫人重試」時恆真
    expect(REFUND_FAILURE_CODES.some((c) => RETRY.test(messageOf(c)))).toBe(true);
    // 🔵 **負對照(現造)**:一句「叫人重試而沒有出口」必須被這把尺抓到
    expect(RETRY.test('請重新整理後確認。') && !EXIT.test('請重新整理後確認。')).toBe(true);
  });

  // 🔴 **而措辭鐵律仍要成立**:加了數字之後那句話仍然不得出現「還能退」「剩餘可退」,
  //    也仍然要保留「錢沒有動」(`refund-money-line-forbidden.test.ts` 的正對照讀的就是它)。
  it('🔴 加了數字之後, 措辭鐵律與「錢沒有動」都還在', () => {
    const msg = messageWith('exceeds_remaining', { remainingCap: 300 });
    expect(msg).not.toMatch(/還能退|剩餘可退/);
    expect(msg).toContain('錢沒有動');
  });
});
