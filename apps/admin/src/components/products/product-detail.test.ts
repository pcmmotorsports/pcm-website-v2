import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { availabilityLabel, formatTime } from './product-detail';

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

// R3 n1:`availabilityLabel` 的 passthrough 分支與上面 `formatTime` 的 NaN 分支**同型**
// (都是 CHECK 保護下今天走不到的死防禦)。上一輪只折了一個 = 兩套標準,這裡補齊。
describe('availabilityLabel(#20 片1b-1)', () => {
  it('CHECK 允許的兩個值 → 中文標籤', () => {
    expect(availabilityLabel('in-stock')).toBe('有庫存');
    expect(availabilityLabel('out-of-stock')).toBe('無庫存');
  });

  it('🔴 n1:非預期值原樣顯示 —— 不猜、不吞、不顯示成「無庫存」', () => {
    // 🔴 這是**今天走不到**的分支(`availability_valid` CHECK 只允許兩值)。
    //    釘它的理由:將來要加第三個值(預購/停產)時,這裡是第一個會被碰到的地方 ——
    //    **原樣顯示會讓員工看到 `preorder` 而發現「後台還沒支援」;
    //    吞掉或猜成「無庫存」則是無聲說謊。**
    for (const odd of ['preorder', 'discontinued', '']) {
      expect({ [odd]: availabilityLabel(odd) }).toEqual({ [odd]: odd });
    }
  });

  it('反面對照:已知值不得走進 passthrough —— 否則上面那格對「全部原樣回傳」恆綠', () => {
    // 若有人把整支寫成 `return raw;`,上一格照樣全過、這一格會紅。
    expect(availabilityLabel('in-stock')).not.toBe('in-stock');
  });
});
