// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ResultBanner } from './result-banner';
import { NOTE_ADDED_RESULT_CODE } from '../../lib/orders/note-action-state';
import {
  PROCUREMENT_CREATED_RESULT_CODE,
  PROCUREMENT_NO_CHANGE_RESULT_CODE,
  PROCUREMENT_UPDATED_RESULT_CODE,
} from '../../lib/orders/procurement-action-state';
import { REFUND_SUBMITTED_RESULT_CODE } from '../../lib/payment/refund-action-state';

// M-4b E10 A9d2-1:本片只加一個成功碼 ⇒ 本檔只測那一格 + 既有行為不被打壞。
//
// 🔴 原型鏈那組向量(`?r=__proto__` 等)**已於 #332-2 補上**(Sean 2026-08-06 拍板 Q1=A;
//    2026-08-02 拍板 B 曾把修法退回、當時這裡逐字寫著「刻意不測」)⇒ 見本檔最後一個 describe。
//    姊妹元件 `settings/settings-result-banner.tsx` 有同形的一組,在
//    `settings/settings-result-banner.test.tsx` —— 兩支各自在自己的元件層被釘住。

afterEach(cleanup);

describe('ResultBanner — A9d2-1 新增的備註成功碼', () => {
  // 🔴 關卡2 MF1:action 組 URL 與本元件查表**共用同一個常數** ⇒ typo 在結構上不可能。
  //    本條再從渲染面確認那個 key 真的有一則訊息(常數存在 ≠ 表裡有它)。
  it('備註成功碼渲染得出文字(action 與本元件共用同一個常數)', () => {
    const { container } = render(<ResultBanner code={NOTE_ADDED_RESULT_CODE} />);
    expect(container.textContent).toContain('備註已新增');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // M-3 RW2c:退款成功碼(關卡2 兩線同抓:漏掛/空白/tone 錯都不會有別的守門紅)。
  it('退款成功碼渲染得出文字,且措辭守「受理 ≠ 已入帳」口徑(plan §3 第一列)', () => {
    const { container } = render(<ResultBanner code={REFUND_SUBMITTED_RESULT_CODE} />);
    expect(container.textContent).toContain('退款已送出');
    expect(container.textContent).toContain('受理不等於已入帳');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('既有改單碼未被打壞(加 key 不該動到別人)', () => {
    expect(render(<ResultBanner code='saved' />).container.textContent).toContain('已儲存變更');
    cleanup();
    expect(render(<ResultBanner code='denied' />).container.textContent).toContain('沒有權限');
  });

  it('缺 code → 不渲染', () => {
    expect(render(<ResultBanner code={undefined} />).container.textContent).toBe('');
  });
});

describe('ResultBanner — A10b 新增的三個採購成功碼', () => {
  // 🔴 關卡2 codex nit:action 測試只驗 redirect 的 URL,**沒有驗最終員工看到什麼**
  //    ⇒ 把這三格從訊息表刪掉,action 測試照樣全綠、而畫面變成一片空白。
  it.each([
    [PROCUREMENT_CREATED_RESULT_CODE, '已新增這筆採購'],
    [PROCUREMENT_UPDATED_RESULT_CODE, '已更新這筆採購'],
    [PROCUREMENT_NO_CHANGE_RESULT_CODE, '沒有變更'],
  ])('%s → 渲染得出文字', (code, text) => {
    const { container } = render(<ResultBanner code={code} />);
    expect(container.textContent).toContain(text);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // 🔴 三格**不共用同一句話**:NO_CHANGE 是零寫入,說得跟「已更新」一樣會讓員工以為改成功了。
  it('三則訊息互異', () => {
    const texts = [
      PROCUREMENT_CREATED_RESULT_CODE,
      PROCUREMENT_UPDATED_RESULT_CODE,
      PROCUREMENT_NO_CHANGE_RESULT_CODE,
    ].map((c) => render(<ResultBanner code={c} />).container.textContent);
    expect(new Set(texts).size).toBe(3);
  });
});

// 🔴 這五個字串是**原型鏈上真的存在且 truthy** 的屬性名 ⇒ 裸索引 `MESSAGES[code]` 會取到它們、
//    讓 `if (!msg) return null` 整道守門失效(memory `reference_js-index-lookup-hits-prototype-chain`)。
//    逐字寫死、**不從任何 API 導出** —— 這組向量的價值就在「攻擊者最好猜的那幾個」是**具體哪幾個**。
//    砍短這個陣列 = 測試數對不上,是刻意設計的突變靶。
//    ⚠️ `prototype` 不在本組:它不是 plain object 繼承得到的屬性(`({}).prototype === undefined`),
//    放進來會是一格恆綠、沒有判別力的假向量。
//    ⚠️ 這份陣列與 `settings/settings-result-banner.test.tsx` 的那份**刻意各留一份** ——
//    兩支元件是獨立的守門面,共用一個常數會讓「其中一支被改回裸索引」時的失敗訊息指錯地方。
const PROTOTYPE_CHAIN_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
] as const;

describe('ResultBanner — 非自有 key 一律不渲染(#332-2)', () => {
  it.each(PROTOTYPE_CHAIN_KEYS)(
    '原型鏈屬性名 %s 當作 ?r= 傳進來時什麼都不畫',
    (code) => {
      const { container } = render(<ResultBanner code={code} />);

      // 🔴 這條比「查不到文字」嚴格:守門失效時畫出來的是一個 `class="… undefined"` 的**空框**
      //    (`msg.text` 是 undefined ⇒ 沒有文字),只斷言 textContent 為空會**照樣綠**。
      expect(container.innerHTML).toBe('');
    },
  );

  // 🔴 與姊妹元件的測試對稱補上(R1 nit 8):既有的 `缺 code → 不渲染` 只覆蓋 `undefined`,
  //    沒有覆蓋「有值但不是自有 key」。⚠️ 這條**不是**「修法沒被寫成只擋那五個」的證據
  //    —— 黑名單式實作下 `'nope'` 一樣回 null、本條照樣綠。
  it('一般的未知碼同樣什麼都不畫', () => {
    const { container } = render(<ResultBanner code='nope' />);

    expect(container.innerHTML).toBe('');
  });
});
