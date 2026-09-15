import { describe, expect, it } from 'vitest';
import { HB_FIELD } from './home-banner-constants';
import { parseHomeBannerDraftForm, parseHomeBannerIdForm, parseHomeBannerPublishForm } from './home-banner-form';

const ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';

function form(fields: Record<string, string>) {
  const d = new FormData();
  for (const [k, v] of Object.entries(fields)) d.set(k, v);
  return d;
}

const base = {
  [HB_FIELD.title1]: 'Slip-On 鈦合金尾段,',
  [HB_FIELD.link]: '/search?pbrands=akrapovic',
  [HB_FIELD.imgDesktop]: 'https://cdn.example.com/a.jpg',
};

describe('parseHomeBannerDraftForm', () => {
  it('新草稿:空字串變 null、沒勾授權 = false、圖種預設 scene', () => {
    const r = parseHomeBannerDraftForm(form({ ...base, [HB_FIELD.subtitle]: '  ', [HB_FIELD.id]: '' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBeNull();
    expect(r.value.subtitle).toBeNull();
    expect(r.value.rightsConfirmed).toBe(false);
    expect(r.value.imageKind).toBe('scene');
  });

  it('勾授權送 1、白底商品照、上下架時間以台北時間轉 +08:00', () => {
    const r = parseHomeBannerDraftForm(
      form({ ...base, [HB_FIELD.id]: ID, [HB_FIELD.rights]: '1', [HB_FIELD.kind]: 'product', [HB_FIELD.starts]: '2026-09-16T08:00', [HB_FIELD.ends]: '2026-09-30T00:00' }),
    );
    expect(r.ok && r.value).toMatchObject({ id: ID, rightsConfirmed: true, imageKind: 'product', startsAt: '2026-09-16T08:00:00+08:00', endsAt: '2026-09-30T00:00:00+08:00' });
  });

  it.each([
    ['外站連結 //evil.com', { [HB_FIELD.link]: '//evil.com' }],
    ['反斜線連結 /\\evil.com', { [HB_FIELD.link]: '/\\evil.com' }],
    ['https 外站連結', { [HB_FIELD.link]: 'https://evil.com' }],
    ['http 圖片', { [HB_FIELD.imgDesktop]: 'http://cdn.example.com/a.jpg' }],
    ['圖種亂寫', { [HB_FIELD.kind]: 'banner' }],
    ['授權值不是 1', { [HB_FIELD.rights]: 'on' }],
    ['id 不是 uuid', { [HB_FIELD.id]: 'abc' }],
    ['不存在的日期', { [HB_FIELD.starts]: '2026-02-31T08:00' }],
    ['下架早於上架', { [HB_FIELD.starts]: '2026-09-20T00:00', [HB_FIELD.ends]: '2026-09-19T00:00' }],
    ['副標超過 DB 上限 60', { [HB_FIELD.subtitle]: '字'.repeat(61) }],
    ['標題含控制字元', { [HB_FIELD.title1]: 'ab' }],
  ])('%s ⇒ invalid', (_label, over) => {
    expect(parseHomeBannerDraftForm(form({ ...base, ...over })).ok).toBe(false);
  });

  it('超過稿的建議字數(12)但沒超過 DB 上限 ⇒ 照收(系統草稿可能比較長)', () => {
    expect(parseHomeBannerDraftForm(form({ ...base, [HB_FIELD.title1]: '字'.repeat(20) })).ok).toBe(true);
  });
});

describe('parseHomeBannerPublishForm', () => {
  it('🔴 updated_at 原字串原樣帶回(微秒不能掉)', () => {
    const r = parseHomeBannerPublishForm(form({ [HB_FIELD.id]: ID, [HB_FIELD.expected]: '2026-09-16T00:12:34.123456+00:00' }));
    expect(r).toEqual({ ok: true, id: ID, expectedUpdatedAt: '2026-09-16T00:12:34.123456+00:00' });
  });

  it.each([
    ['沒帶 updated_at', { [HB_FIELD.id]: ID }],
    ['updated_at 形狀不對', { [HB_FIELD.id]: ID, [HB_FIELD.expected]: 'yesterday' }],
    ['沒帶 id', { [HB_FIELD.expected]: '2026-09-16T00:12:34+00:00' }],
  ])('%s ⇒ invalid', (_label, fields) => {
    expect(parseHomeBannerPublishForm(form(fields)).ok).toBe(false);
  });
});

describe('parseHomeBannerIdForm', () => {
  it('uuid ⇒ 原樣;亂寫 ⇒ null', () => {
    expect(parseHomeBannerIdForm(form({ [HB_FIELD.id]: ID }))).toBe(ID);
    expect(parseHomeBannerIdForm(form({ [HB_FIELD.id]: '../x' }))).toBeNull();
  });
});
