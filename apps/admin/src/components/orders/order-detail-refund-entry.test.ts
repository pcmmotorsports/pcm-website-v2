import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { shouldShowRefundEntry } from './refund-entry-gate';

// order-detail-refund-entry.test.ts — #445a-3。
//
// 🔴 這支測試的存在理由:445a-3 刪掉 `order-detail-route.tsx` 裡「有帳本列才查未登記額」
//    的短路 ⇒ **每一張訂單**都新增一條對 `pcm_order_refundable_remaining` 可用性的
//    fail-closed 依賴(以前零帳本列時根本不呼叫、不可能失敗)。
// ⚠️ **更正(關卡2 codex nit)**:我原本寫「這個入口閘在 445a-3 之前零測試覆蓋」,
//    量法是 `grep -rln "refundUnregisteredFailed" --include="*.test.tsx"` = 零命中。
//    **那句是假的** —— `app/orders/[id]/refund-wiring.test.tsx:293-309` 早就用整頁渲染
//    覆蓋了「讀取失敗 ⇒ 入口 fail-closed」,字面是 `getLedgerUnregisteredAmount.mockRejectedValue`
//    + `hasRefundEntry()`,**我的 grep 掃不到**。同日第三次「掃描字集比宣稱窄」。
// ⇒ 本檔的定位因此收窄:**補「條件級」的窮舉**(0 / null / 負值 / 各單一條件),
//    頁級行為的 oracle 在 `refund-wiring.test.tsx`,兩者不重疊。

const OK = {
  refundEnabled: true,
  refundsFailed: false,
  refundUnregisteredFailed: false,
  refundUnregisteredAmount: 1000,
  refundsTruncated: false,
  hasStuckRefundVerdict: false,
  paymentChannel: 'tappay',
  paymentStatus: 'paid',
} as const satisfies Parameters<typeof shouldShowRefundEntry>[0];

describe('shouldShowRefundEntry — #445a-3 入口閘', () => {
  it('[正向] 全部條件成立 ⇒ 開', () => {
    expect(shouldShowRefundEntry(OK)).toBe(true);
  });

  // 🔴 **原本這裡有一格標 `[§6-1] 零帳本列 ⇒ 入口開著`,已刪。**
  //    code-reviewer 抓到:它的輸入與上面 `[正向]` **逐字相同**(`OK` 的 amount 本來就是 1000)
  //    ⇒ 兩格同生同死、零邊際判別力;而且它宣稱覆蓋「零帳本列」,
  //    但這個 gate **根本收不到 rows**、分辨不了有沒有帳本列。**量錯東西。**
  //    ⇒ §6-1 的真 oracle 在頁層:`app/orders/[id]/refund-wiring.test.tsx` 的
  //    「零帳本列也要查未登記額」與「零列+成功仍不渲染」兩格(那裡才跑得到 route)。

  // 🔴 §6-2:**這是 445a-3 新增的行為,不是回歸格。**
  //    以前零列時不呼叫 RPC ⇒ 這個 true 不可能出現;現在會。
  it('[§6-2] 🔴 未登記額讀取失敗 ⇒ 入口 fail-closed 關閉(445a-3 的新依賴)', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredFailed: true })).toBe(false);
  });

  it('[既有] 帳本本身讀取失敗 ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, refundsFailed: true })).toBe(false);
  });

  // 負值 = 帳本登記已超過訂單總額(對帳異常),區塊明寫「勿再發起」⇒ 入口不能還亮著。
  it('[既有] 未登記額為負(對帳異常)⇒ 關,不留「文字叫你別按、按鈕還亮著」', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredAmount: -1 })).toBe(false);
  });

  it('[既有] 未登記額 0 ⇒ 開(0 是合法值,不是「讀不到」)', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredAmount: 0 })).toBe(true);
  });

  it('[既有] 未登記額 null(查無)⇒ 開 —— null 不等於失敗,失敗有自己的旗標', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredAmount: null })).toBe(true);
  });

  it('[既有] 旗標關 ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, refundEnabled: false })).toBe(false);
  });

  // 型別逐字 = `packages/domain/src/order/types.ts:208`
  //   `export type PaymentChannel = 'tappay' | 'bank_transfer' | 'cash' | 'none';`
  //   ⚠️ 第一版我寫 `'transfer'`(不存在的值)—— typecheck 當場紅,已改。窮舉非 tappay 三值。
  it('[既有] 非 tappay 管道 ⇒ 關(轉帳/現金單不該看到線上退款)', () => {
    for (const ch of ['bank_transfer', 'cash', 'none'] as const) {
      expect(shouldShowRefundEntry({ ...OK, paymentChannel: ch })).toBe(false);
    }
  });

  it('[既有] payment status 不在 allowlist ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, paymentStatus: 'unpaid' })).toBe(false);
    expect(shouldShowRefundEntry({ ...OK, paymentStatus: 'refunded' })).toBe(false);
    expect(shouldShowRefundEntry({ ...OK, paymentStatus: 'partiallyRefunded' })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SUB2-009(2026-08-24):帳本列截斷時,入口必須暗掉
// ═══════════════════════════════════════════════════════════════════════════
describe('SUB2-009:refundsTruncated', () => {
  it('🔴 截斷 ⇒ 關。這一格就是那個 bug 本身', () => {
    // 病徵(修之前):`refund-ledger-section.tsx:94` 的紅區逐字對值班說
    //   「也不要在這個狀態下發起退款」,而入口就亮在同一個收合塊裡、同一頁。
    //   而那個收合塊在截斷時 `defaultOpen` 是 true ⇒ **兩者必然同時出現在畫面上**。
    expect(shouldShowRefundEntry({ ...OK, refundsTruncated: true })).toBe(false);
  });

  it('[負對照] 沒截斷 ⇒ 這一條不影響任何東西', () => {
    // 沒有這一格,上面那格會被「其他條件也剛好關掉入口」滿足而變成恆真。
    expect(shouldShowRefundEntry({ ...OK, refundsTruncated: false })).toBe(true);
  });

  it('🔴 截斷【單獨】就足以關掉 —— 不依賴任何其他條件也成立', () => {
    // 形狀:其餘每一格都擺成「最開」的狀態,只翻這一格。
    // 少了這一格,一個把 refundsFailed 也設成 true 的測資會讓上面那格假綠。
    expect(
      shouldShowRefundEntry({
        refundEnabled: true,
        refundsFailed: false,
        refundUnregisteredFailed: false,
        refundUnregisteredAmount: 0,
        refundsTruncated: true,
        hasStuckRefundVerdict: false,
        paymentChannel: 'tappay',
        paymentStatus: 'partiallyRefunded',
      }),
    ).toBe(false);
  });
});

// 🔴 這一格守的是【跨檔的理由】,不是行為:
//    本閘多出 `refundsTruncated` 這條的**唯一理由**,是截斷紅區真的對值班說了那句話。
//    哪天有人把那句文案改軟(或整段拿掉),這條閘就失去它的依據 ——
//    而**行為測試一格都不會紅**,因為閘照樣關得掉。⇒ 讓它在這裡紅一次,逼人回來重想。
// ⚠️ 它的能力邊界:只比對**字面**。文案換句話說(語意不變)也會紅 ⇒ 那時請改這裡的字面錨,
//    而**不要**只是把它刪掉。
describe('SUB2-009:這條閘的理由必須還在', () => {
  it('截斷紅區仍然逐字寫著「不要在這個狀態下發起退款」', () => {
    const src = readFileSync(join(__dirname, 'refund-ledger-section.tsx'), 'utf8');
    expect(src).toContain('也不要在這個狀態下發起退款');
  });

  it('[前提] 那支檔讀得到而且不是空的(不然上面那格是恆真)', () => {
    const src = readFileSync(join(__dirname, 'refund-ledger-section.tsx'), 'utf8');
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('rowsTruncated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SUB2-009 丙(2026-08-24):**藏起來之後,那句「他該怎麼辦」不得消失**
// ═══════════════════════════════════════════════════════════════════════════
// codex R1 finding ②:入口被藏起來 ⇒ 值班的出路變成【繞去 TapPay Portal】,
// 而那筆退款**不會進本系統帳本** ⇒ 「藏起來」比「亮著」更糟。
// ⇒ 修法不是把閘改回去, 是補【出口】。而那個出口是一句文案 ——
//    🔴 **文案沒有型別, 潤稿一次就會不見, 而不會有任何東西紅。** 所以釘在這裡。
// ⚠️ 能力邊界:只比對**字面**。換句話說(語意不變)也會紅 ⇒ 那時請改這裡的錨,
//    而**不要**只是把它刪掉 —— 刪掉等於把那條 finding 靜靜地退回未修狀態。
describe('SUB2-009 丙:截斷紅區必須留著那條出路', () => {
  const src = () =>
    readFileSync(join(__dirname, 'refund-ledger-section.tsx'), 'utf8');

  it('🔴 攔住「繞去 TapPay 後台退」那一句還在(整段唯一在攔【動作】的句子)', () => {
    expect(src()).toContain('不要改用 TapPay 後台直接退');
  });

  it('🔴 而它必須說出【為什麼】—— 只說不要, 值班照樣會做', () => {
    expect(src()).toContain('不會進本系統帳本');
  });

  /**
   * 截斷分支裡**真的會印給值班看的那一段**(`<p>…</p>` 的內容)。
   *
   * 🔴 **不是「從分支開頭數 N 個字元」** —— 我第一版是那樣寫的,而它同時壞了兩頭:
   *   ① 窗口太短 ⇒ **搆不到真正的文案**(突變把文案換成被禁止的句子,那一格沒紅)
   *   ② 窗口裡有我自己的**註解**,而那段註解**引用了**要比對的字面
   *      ⇒ `toContain('若原本有')` 被【註解裡的引用】滿足 ⇒ **假綠**
   *   📌 一句「掃到了」與「掃到的是會印出來的那一份」是兩件事。
   * ⇒ 改成鎖 `<p>` 的內容:JSX 註解 `{…}` 在 `<p>` 外面,天生不進來。
   */
  const truncatedCopy = () => {
    const body = src();
    const i = body.indexOf('if (rowsTruncated)');
    if (i < 0) throw new Error('找不到 `if (rowsTruncated)` 分支 ⇒ 本組失去座標,不是通過');
    const open = body.indexOf("<p className='text-destructive'>", i);
    const close = body.indexOf('</p>', open);
    if (open < 0 || close < 0) throw new Error('截斷分支裡找不到 <p>…</p> ⇒ 失去座標,不是通過');
    return body.slice(open, close);
  };

  it('🔴 講入口那句必須保持【條件句】—— 本區塊看不到 channel/status/旗標', () => {
    // :70 明文禁止宣稱「退款按鈕被關掉了」:轉帳/現金/未付款/旗標關著的單,入口本來就不存在。
    // 那個「若」是承重的 —— 改成肯定句就是對值班說一句假話。
    expect(truncatedCopy()).toContain('若原本有');
  });

  it('🔴 而那句被禁止的肯定句不得【真的印出來】', () => {
    // ⚠️ 這一格量的是**截斷分支**,不是整支檔 —— 我第一版寫成整檔掃,當場紅:
    //    那句字面在 `:72` 的註解裡**本來就有**(它被當成反例引用著)。
    //    ⇒ 掃碼與掃註解是兩件事,而它們在 `toContain` 眼裡長得一樣。
    expect(truncatedCopy()).not.toContain('退款按鈕暫時收起來');
  });

  it('[前提] 上面幾格量到的是【會印出來的那一段】,而且它不含註解', () => {
    const copy = truncatedCopy();
    expect(copy.length).toBeGreaterThan(120);
    expect(copy).toContain('不要改用 TapPay 後台直接退');
    // 🔴 負對照:註解裡的字**不得**被算進來。`{/*` 是 JSX 註解的開頭,
    //    它若出現在這一段裡,代表我的座標又把註解吃進來了(第一版的病)。
    expect(copy).not.toContain('{/*');
    expect(copy).not.toContain('TODO');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SUB2-009 第 7 格(2026-08-24):卡住的人工判定 ⇒ 入口必須暗掉
// ═══════════════════════════════════════════════════════════════════════════
// 與 `processing` 的處置**刻意相反**,而依據是兩題:
//   Q1 這一頁算得出退過多少嗎 ⇒ 算不準,且錯在**不安全方向**(failed 不佔額 ⇒ 未登記額高估)
//   Q2 server 端擋得住嗎     ⇒ 擋不住(`S5` 只認 processing;超退閘吃的是同一個高估的數字)
// ⇒ 兩題都危險 ⇒ 藏。而 `processing` 兩題都安全 ⇒ 不藏(按下去會拿到具名訊息)。
describe('SUB2-009:hasStuckRefundVerdict', () => {
  it('🔴 有卡住的人工判定 ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, hasStuckRefundVerdict: true })).toBe(false);
  });

  it('[負對照] 沒有 ⇒ 這一條不影響任何東西', () => {
    expect(shouldShowRefundEntry({ ...OK, hasStuckRefundVerdict: false })).toBe(true);
  });

  it('🔴 它【單獨】就足以關掉 —— 其餘全擺成最開,只翻這一格', () => {
    expect(
      shouldShowRefundEntry({
        refundEnabled: true,
        refundsFailed: false,
        refundUnregisteredFailed: false,
        refundUnregisteredAmount: 0,
        refundsTruncated: false,
        hasStuckRefundVerdict: true,
        paymentChannel: 'tappay',
        paymentStatus: 'partiallyRefunded',
      }),
    ).toBe(false);
  });
});

// 🔴 出路那一句(同 §丙 的形狀):藏起來之後必須有人告訴他為什麼 + 下一步。
//    這一段量的是**卡住那一列旁邊會印出來的 `<p>`**,不是整支檔、也不是註解。
describe('SUB2-009 第 7 格:藏起來之後那句話不得消失', () => {
  /** 卡住列旁邊那個 `<p>` 的內容(座標鎖 `{stuck &&`,再取其後第一個 `<p …>…</p>`)。 */
  const stuckCopy = () => {
    const body = readFileSync(join(__dirname, 'refund-ledger-section.tsx'), 'utf8');
    const i = body.indexOf('{stuck && (');
    if (i < 0) throw new Error('找不到 `{stuck && (` ⇒ 本組失去座標,不是通過');
    const open = body.indexOf('<p className=', i);
    const close = body.indexOf('</p>', open);
    if (open < 0 || close < 0) throw new Error('卡住列旁找不到 <p>…</p> ⇒ 失去座標,不是通過');
    return body.slice(open, close);
  };

  it('🔴 那個「若」是承重的 —— 本區塊看不到 channel/status/旗標(:70-73 禁令)', () => {
    expect(stuckCopy()).toContain('若原本有');
  });

  it('🔴 必須講出「這一頁算不準」+ 下一步找誰', () => {
    const copy = stuckCopy();
    expect(copy).toContain('算不準');
    expect(copy).toContain('聯絡工程師');
  });

  it('[前提] 量到的是會印出來的那一段,而且沒把註解吃進來', () => {
    const copy = stuckCopy();
    expect(copy.length).toBeGreaterThan(40);
    expect(copy).not.toContain('{/*');
    expect(copy).not.toContain('#890');
  });
});
