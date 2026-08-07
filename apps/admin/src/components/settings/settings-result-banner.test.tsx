// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SettingsResultBanner,
  type SettingsResultMessages,
} from './settings-result-banner';

afterEach(cleanup);

// #332-2(Sean 2026-08-06 拍板 Q1=A)。
//
// 🔴 **為什麼這個檔開在元件層,而不是回去加在 `lib/supplier-result-messages.test.tsx`**:
//    要釘的不變量是「**本元件**對任何非自有 key 都不渲染」——它在**元件層**成立,
//    與傳進來的是哪一張碼表完全無關。當初把這組向量放在供應商碼表的測試裡,
//    正是讓這個缺陷看起來像「供應商那片專屬」的原因
//    (memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。
//    ⇒ 姊妹元件 `orders/result-banner.tsx` 有自己那份對照測試,兩支各自在自己的元件層被釘住。

// 🔴 這五個字串是**原型鏈上真的存在且 truthy** 的屬性名 ⇒ 裸索引 `messages[code]` 會取到它們、
//    讓 `if (!msg) return null` 整道守門失效(memory `reference_js-index-lookup-hits-prototype-chain`)。
//    逐字寫死、**不從任何 API 導出** —— 這組向量的價值就在「攻擊者最好猜的那幾個」是**具體哪幾個**。
//    砍短這個陣列 = 測試數對不上,是刻意設計的突變靶。
//    ⚠️ `prototype` 不在本組:它不是 plain object 繼承得到的屬性(`({}).prototype === undefined`),
//    放進來會是一格恆綠、沒有判別力的假向量。
const PROTOTYPE_CHAIN_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
] as const;

// 🔴 fixture 的鍵**刻意避開**上面那五個字串:若碼表自己就有一個叫 `toString` 的碼,
//    那個字串就**不再是有效的負向量** —— 正確的修法會認定它是自有鍵而照常渲染,
//    該格於是恆紅(不是恆綠),但無論紅綠它都已經量不到「守門擋不擋得住非自有 key」這件事
//    (memory `feedback_fixture-value-makes-guard-vacuous`;關卡2 codex 校正了本註解原本
//    寫成「變成恆真」的說法 —— 方向講反了,失去的是判別力不是紅綠)。
const FIXTURE: SettingsResultMessages = {
  saved: { text: '已儲存變更。', tone: 'ok' },
  denied: { text: '沒有權限或登入狀態已失效,未儲存。', tone: 'error' },
};

describe('SettingsResultBanner — 非自有 key 一律不渲染', () => {
  it.each(PROTOTYPE_CHAIN_KEYS)(
    '原型鏈屬性名 %s 當作 ?r= 傳進來時什麼都不畫',
    (code) => {
      const { container } = render(
        <SettingsResultBanner code={code} messages={FIXTURE} />,
      );

      // 🔴 守門失效時畫出來的是一個 `class="… undefined"` 的**空框**
      //    (`msg.text` 是 undefined ⇒ 框裡沒有文字)⇒ 只斷言 `textContent === ''`
      //    會**照樣綠**。要釘的是「連框都不該有」。
      //    ⚠️ 這裡**不比** `queryByRole('status')` 嚴格(關卡2 codex 校正):那個空框自己就帶
      //    `role='status'`,查得到 ⇒ 兩者判別力相同。真正會假綠的只有 `textContent` 那種寫法。
      expect(container.innerHTML).toBe('');
    },
  );

  // ⚠️ 這條**不是**「修法沒被寫成只擋那五個」的證據:黑名單式實作
  //    (`PROTO_KEYS.includes(code) ? undefined : messages[code]`)下,`'nope'` 走
  //    `messages['nope'] === undefined` 一樣回 null、本條照樣綠。它證的只是一般未知碼這條路徑。
  it('一般的未知碼同樣什麼都不畫', () => {
    const { container } = render(
      <SettingsResultBanner code='nope' messages={FIXTURE} />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('SettingsResultBanner — 自有碼照常渲染', () => {
  // 🔴 這組是修法的**反面保險**,防的是「守門過度封鎖」:例如把變數名誤加引號寫成
  //    `Object.hasOwn(messages, 'code')`,那麼**每一個**碼都查不到 ⇒ 上面那組(五向量 + `nope`)
  //    全綠、只有這組紅。實測過:2 紅 / 6 綠。少了它,過度封鎖的修法會完全無感通過。
  //    ⚠️ 反過來把三元運算寫成 `!Object.hasOwn(...)` **不是**只紅這組(關卡2 codex 校正本註解
  //    原本的說法):那樣五個原型鍵會取到繼承值而畫出空框 ⇒ 兩組一起紅。
  // 🔴 走 `Object.entries` 而不是 `Object.keys` + `FIXTURE[code]`:後者在
  //    `noUncheckedIndexedAccess` 下是 `possibly undefined`(typecheck 實測紅),
  //    而用 `!` 壓掉等於把「查得到」這件事變成假設。entries 直接帶出值,沒有這個洞。
  it.each(Object.entries(FIXTURE))(
    '自有碼 %s 渲染得出它自己的文案',
    (code, message) => {
      render(<SettingsResultBanner code={code} messages={FIXTURE} />);

      // 🔴 本 repo **沒有** jest-dom(root vitest.config 無 setupFiles)⇒ 用原生 textContent。
      //    只比對「等於碼表裡那則」就夠:fixture 是本檔自己的常數、非 production 碼表,
      //    再加一條 `.not.toBe('')` 沒有自己的突變靶(R1 nit 4)。
      expect(screen.getByRole('status').textContent).toBe(message.text);
    },
  );
});
