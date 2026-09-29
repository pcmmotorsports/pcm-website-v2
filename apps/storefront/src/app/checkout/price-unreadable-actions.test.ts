import { describe, expect, it, vi } from 'vitest';

import { reportPriceUnreadableAction } from './price-unreadable-actions';

describe('reportPriceUnreadableAction(P-M5 紀錄:前台擋下「價格讀不到」)', () => {
  it('印一行固定格式:只有原因碼、購物車列數、讀不到的列數', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await reportPriceUnreadableAction(3, 1);
    expect(info).toHaveBeenCalledWith('[checkout] pcm_price_unreadable 前台擋下 價格讀不到', { reason: 'price_unreadable', lines: 3, unreadable: 1 });
    info.mockRestore();
  });

  it('數字不合理(不是 1–200 的整數、讀不到的比列數多)⇒ 寫成 null, 不把任意值寫進紀錄', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await reportPriceUnreadableAction('x' as unknown as number, 500);
    await reportPriceUnreadableAction(2, 3);
    expect(info.mock.calls).toEqual([
      ['[checkout] pcm_price_unreadable 前台擋下 價格讀不到', { reason: 'price_unreadable', lines: null, unreadable: null }],
      ['[checkout] pcm_price_unreadable 前台擋下 價格讀不到', { reason: 'price_unreadable', lines: 2, unreadable: null }],
    ]);
    info.mockRestore();
  });
});
