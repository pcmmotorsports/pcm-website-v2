import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { formatTime } from './product-detail';

// R2 nit-g:`formatTime` 的 NaN 分支原本零覆蓋 = 死防禦(沒人知道它還活著)。
// 這支檔只測那一支純函式,不渲染元件(渲染面在 `app/products/[id]/page.test.tsx`)。
describe('formatTime(#20 片1b-1)', () => {
  it('正常 ISO → 台北曆面 `YYYY-MM-DD HH:mm`', () => {
    expect(formatTime('2026-08-01T02:00:00Z')).toBe('2026-08-01 10:00');
  });

  it('🔴 nit-g:爛字串原樣回傳,不吐 Invalid Date 給員工看', () => {
    // 🔴 這是**今天走不到**的分支(`created_at`/`updated_at` 是 NOT NULL timestamptz)。
    //    釘它的理由不是「它會發生」,是「1b-2 要顯示的欄位沒有同樣的 NOT NULL 保護」。
    for (const bad of ['', 'not-a-date', '2026-13-45T99:99:99Z']) {
      expect({ [bad]: formatTime(bad) }).toEqual({ [bad]: bad });
    }
  });

  it('反面對照:合法輸入不得走進「原樣回傳」那條 —— 否則上面那格對壞實作恆綠', () => {
    // 若有人把 formatTime 寫成 `return raw;`,上一格照樣全過、這一格會紅。
    expect(formatTime('2026-08-10T02:00:00Z')).not.toBe('2026-08-10T02:00:00Z');
  });
});
