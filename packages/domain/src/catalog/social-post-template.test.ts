import { describe, expect, it } from 'vitest';
import { checkSocialCopy } from './social-copy-rules';
import { buildNewProductPost, socialUtmUrl, utmCampaign } from './social-post-template';

const BASE = {
  brandName: 'Materya',
  title: 'Lever Guard 拉桿護弓',
  vehicleLabel: 'Yamaha YZF-R9 2024+',
  highlights: ['主體：實心鋁合金 CNC 切削', '端部：鈦金屬', '原廠提供兩年保固'],
  sku: 'MTY033N',
  priceTwd: 3200,
  productUrl: 'https://www.pcmmotorsports.com/products/materya-mty033',
  partTag: '拉桿護弓',
  modelTag: 'YZF-R9',
};

describe('buildNewProductPost', () => {
  it('FB:第一行品牌｜品名｜車款, 賣點條列, 料號價格, 帶 facebook UTM 的連結', () => {
    const { fbText, fbUrl } = buildNewProductPost(BASE);
    expect(fbText.split('\n')[0]).toBe('Materya｜Lever Guard 拉桿護弓｜Yamaha YZF-R9 2024+');
    expect(fbText).toContain('・端部：鈦金屬');
    expect(fbText).toContain('料號 MTY033N｜NT$3,200');
    expect(fbUrl).toBe('https://www.pcmmotorsports.com/products/materya-mty033?utm_source=facebook&utm_medium=social&utm_campaign=mty033n');
    expect(fbText).toContain(`官網商品頁：${fbUrl}`);
    expect(fbText.trim().split('\n').at(-1)).toBe('#materya #YZFR9 #拉桿護弓 #PCM重機零件販售');
  });

  it('IG:內文不放連結, 改寫料號搜尋;限動用的連結帶 instagram UTM', () => {
    const { igText, igUrl } = buildNewProductPost(BASE);
    expect(igText).not.toContain('http');
    expect(igText).toContain('官網搜尋料號 MTY033N，或點個人檔案連結。');
    expect(new URL(igUrl).searchParams.get('utm_source')).toBe('instagram');
  });

  it('沒有的資料整行不寫:沒車款、沒價格、沒賣點、沒分類', () => {
    const { fbText } = buildNewProductPost({ ...BASE, vehicleLabel: null, priceTwd: null, highlights: [], partTag: null, modelTag: null });
    expect(fbText.split('\n')[0]).toBe('Materya｜Lever Guard 拉桿護弓');
    expect(fbText).toContain('料號 MTY033N\n');
    expect(fbText).not.toContain('NT$');
    expect(fbText).not.toMatch(/\n{3,}/);
  });

  it('賣點最多 5 條', () => {
    const { fbText } = buildNewProductPost({ ...BASE, highlights: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(fbText).toContain('・e');
    expect(fbText).not.toContain('・f');
  });

  it('範本本身不會產生紅字(賣點乾淨時)', () => {
    const { fbText, igText } = buildNewProductPost(BASE);
    expect(checkSocialCopy(fbText)).toEqual([]);
    expect(checkSocialCopy(igText)).toEqual([]);
  });
});

describe('R1 修正', () => {
  it('hashtag 去掉 - + & 等會讓平台斷字的符號', () => {
    const { fbText } = buildNewProductPost({ ...BASE, brandName: 'Eazi-Grip', modelTag: 'Tracer 9 GT+', title: '油箱止滑貼' });
    expect(fbText).toContain('#eazigrip #Tracer9GT #拉桿護弓');
  });
  it('品名已經以品牌開頭就不重複品牌(不分大小寫、變音)', () => {
    const { fbText } = buildNewProductPost({ ...BASE, brandName: 'Öhlins', title: 'Ohlins TTX GP 後避震' });
    expect(fbText.split('\n')[0]).toBe('Ohlins TTX GP 後避震｜Yamaha YZF-R9 2024+');
  });
  it('價格不是整數就不印', () => {
    expect(buildNewProductPost({ ...BASE, priceTwd: 3200.5 }).fbText).not.toContain('NT$');
  });
  it('料號全是非英數時 campaign 不留空', () => {
    expect(utmCampaign('日本限定')).toBe('new-product');
  });
});

describe('utm', () => {
  it('campaign 只留小寫英數與 - _', () => {
    expect(utmCampaign('PRN041338 -042719')).toBe('prn041338-042719');
  });
  it('原本就有查詢字串也能加', () => {
    expect(socialUtmUrl('https://x.test/p?a=1', 'facebook', 'k')).toBe('https://x.test/p?a=1&utm_source=facebook&utm_medium=social&utm_campaign=k');
  });
});
