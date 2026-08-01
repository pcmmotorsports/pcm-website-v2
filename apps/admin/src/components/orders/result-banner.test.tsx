// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ResultBanner } from './result-banner';

afterEach(cleanup);

// result-banner.test.tsx — S3b-2 的 code review 在 `settings-result-banner.tsx` 抓到
// 「`messages[code]` 會取到原型鏈屬性」之後,發現**本元件有完全相同的缺陷且零測試**。
// 本檔是那次修正的回歸守門。三個呼叫端:orders 列表 / 訂單詳情 / 客戶詳情。

describe('ResultBanner', () => {
  it('should render the mapped message for a known code', () => {
    render(<ResultBanner code='saved' />);

    expect(screen.getByRole('status').textContent).toBe('已儲存變更。');
  });

  it.each([undefined, 'nope', 'created'])(
    'should render nothing for the absent or unknown code %s',
    (code) => {
      const { container } = render(<ResultBanner code={code} />);

      expect(container.innerHTML).toBe('');
    },
  );

  // 🔴 承重點:`code` 來自 `searchParams.r` = URL 上的任意字串。
  //    直接索引查表時 `MESSAGES['__proto__']` 取到 `Object.prototype`(truthy)
  //    ⇒ `if (!msg)` 放行 ⇒ 畫出 `class="… undefined"` 的空框。
  //    把 `Object.hasOwn(...)` 改回 `MESSAGES[code]` ⇒ 本組轉紅。
  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'should not resolve the prototype-chain property %s as a message',
    (code) => {
      const { container } = render(<ResultBanner code={code} />);

      expect(container.innerHTML).toBe('');
      // 🔴 同上:空 innerHTML 已嚴格蘊含這一條,**不是**第二份獨立證據。
      expect(screen.queryByRole('status')).toBeNull();
    },
  );
});
