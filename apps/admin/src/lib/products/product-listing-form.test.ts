import { describe, expect, it } from 'vitest';
import {
  parseListingToggleForm,
  parseProductsReturnTo,
  LISTING_PRODUCT_ID_FIELD,
  LISTING_DELISTED_FIELD,
  LISTING_NOTE_FIELD,
  LISTING_RETURN_TO_FIELD,
  LISTING_NOTE_MAX,
} from './product-listing-form';

// M-4b `#20` 上下架表單解析器的守門。
// 🔴 本檔守的不是「函式會不會動」,是**四件會靜默出錯的事**:
//   ① `delisted` 收到 checkbox 的 `'on'` 時必須拒(不是靜靜當成 false ⇒ 那會【上架】一件該下架的商品)
//   ② `note` **選填**這件事(照抄 tier 樣板的話它會變必填 ⇒ 員工每次都得打字)
//   ③ 同名欄位送兩份要被擋(而這裡的擋門【有判別力】,理由見被測檔的 `LISTING_SINGLE_FIELDS` docstring)
//   ④ `return_to` 只准站內

const ID = '11111111-2222-3333-4444-555555555555';

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

const base = (over: Partial<Record<string, string>> = {}) =>
  form([
    [LISTING_PRODUCT_ID_FIELD, over.product_id ?? ID],
    [LISTING_DELISTED_FIELD, over.delisted ?? 'true'],
    ...(over.note === undefined ? [] : ([[LISTING_NOTE_FIELD, over.note]] as Array<[string, string]>)),
    [LISTING_RETURN_TO_FIELD, over.return_to ?? `/products/${ID}`],
  ]);

describe('#20 parseListingToggleForm', () => {
  it('正常路徑:下架 + 帶原因', () => {
    const r = parseListingToggleForm(base({ note: '原廠停產且無現貨' }));
    expect(r).toEqual({
      ok: true,
      productId: ID,
      delisted: true,
      note: '原廠停產且無現貨',
      returnTo: `/products/${ID}`,
    });
  });

  it('正常路徑:上架(delisted=false)', () => {
    const r = parseListingToggleForm(base({ delisted: 'false', note: '補到貨了' }));
    expect(r).toMatchObject({ ok: true, delisted: false });
  });

  it('🔴 `note` 是【選填】—— 沒給、空字串、只有空白,三種都要 ok 且 note=null', () => {
    // 🔴 這一格守的是「不要照抄 tier 樣板」:那支是 Sean Q2=A 對 tier 拍的必填,
    //    而上下架沒有那個拍板(migration 20260819040000 的 1b 逐字寫了理由)。
    expect(parseListingToggleForm(base())).toMatchObject({ ok: true, note: null });
    expect(parseListingToggleForm(base({ note: '' }))).toMatchObject({ ok: true, note: null });
    expect(parseListingToggleForm(base({ note: '   ' }))).toMatchObject({ ok: true, note: null });
  });

  it('🔴 看似空白的零寬/格式字也收斂成 null(不要把一串隱形字送進稽核)', () => {
    // U+200B 零寬空格 + U+FEFF BOM —— JS trim() 不吃這兩個。
    const r = parseListingToggleForm(base({ note: '\u200B\uFEFF' }));
    expect(r).toMatchObject({ ok: true, note: null });
  });

  it('🔴🔴 `delisted` 只認 true/false 兩個字面 —— checkbox 的 `on` 必須被拒', () => {
    // 失敗情境很具體:若這裡把 'on' 以外的值靜靜當成 false,
    // 員工按「下架」會變成【上架】一件本來就下架的商品,而畫面會說「已儲存」。
    for (const bad of ['on', '1', '0', 'TRUE', 'True', 'yes', '']) {
      expect(parseListingToggleForm(base({ delisted: bad })), `delisted=${bad}`).toEqual({
        ok: false,
      });
    }
    // 完全不送那一欄也要拒(原生 checkbox 未勾就是這個形狀)。
    const noField = form([
      [LISTING_PRODUCT_ID_FIELD, ID],
      [LISTING_RETURN_TO_FIELD, '/products'],
    ]);
    expect(parseListingToggleForm(noField)).toEqual({ ok: false });
  });

  it('product_id 非 UUID → 拒', () => {
    for (const bad of ['', 'abc', `${ID}x`, '1111111-2222-3333-4444-555555555555']) {
      expect(parseListingToggleForm(base({ product_id: bad })), bad).toEqual({ ok: false });
    }
  });

  it(`note 長度上限 ${LISTING_NOTE_MAX}:剛好過、超過拒(兩側都驗,不是只驗該擋那側)`, () => {
    expect(parseListingToggleForm(base({ note: 'a'.repeat(LISTING_NOTE_MAX) }))).toMatchObject({
      ok: true,
    });
    expect(parseListingToggleForm(base({ note: 'a'.repeat(LISTING_NOTE_MAX + 1) }))).toEqual({
      ok: false,
    });
  });

  it('🔴 同名欄位送兩份 → 拒(這裡的擋門有判別力:note 的 null 在下游代表【放行】)', () => {
    const dup = form([
      [LISTING_PRODUCT_ID_FIELD, ID],
      [LISTING_DELISTED_FIELD, 'true'],
      [LISTING_NOTE_FIELD, '第一份'],
      [LISTING_NOTE_FIELD, '第二份'],
      [LISTING_RETURN_TO_FIELD, '/products'],
    ]);
    expect(parseListingToggleForm(dup)).toEqual({ ok: false });
  });

  it('return_to 只准站內 /products', () => {
    expect(parseProductsReturnTo('/products')).toBe('/products');
    expect(parseProductsReturnTo(`/products/${ID}?x=1`)).toBe(`/products/${ID}?x=1`);
    for (const bad of ['https://evil.example/x', '//evil.example', '/orders', '/products/../orders', null]) {
      expect(parseProductsReturnTo(bad as never), String(bad)).toBe('/products');
    }
  });
});
