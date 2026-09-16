import { describe, expect, it } from 'vitest';
import { HOME_BANNER_MOTION_MS, splitHomeBannerTitle } from './home-banner-rules';

describe('splitHomeBannerTitle', () => {
  it('🔴 第一行純英文車款 + 有第二行 ⇒ 車款小字層 + 一行大標', () => {
    expect(splitHomeBannerTitle('KTM 1390 Super Adventure', '專用風鏡到貨')).toEqual({
      model: 'KTM 1390 Super Adventure',
      main: ['專用風鏡到貨'],
    });
  });

  it('第一行有中文 ⇒ 照舊兩行大標(負對照)', () => {
    expect(splitHomeBannerTitle('Slip-On 鈦合金尾段，', '2026 年式新款到貨')).toEqual({
      model: null,
      main: ['Slip-On 鈦合金尾段，', '2026 年式新款到貨'],
    });
  });

  it('只有一行(就算是英文)⇒ 那一行是大標,不會變成只有小字', () => {
    expect(splitHomeBannerTitle('AKRAPOVIC', null)).toEqual({ model: null, main: ['AKRAPOVIC'] });
    expect(splitHomeBannerTitle('AKRAPOVIC', '  ')).toEqual({ model: null, main: ['AKRAPOVIC'] });
  });
});

describe('HOME_BANNER_MOTION_MS', () => {
  it('🔴 字的最後一段在 240ms 內起跑(三段錯開)—— 拉長會拖 LCP', () => {
    expect(HOME_BANNER_MOTION_MS.textStagger * 3).toBeLessThanOrEqual(240);
  });
});
