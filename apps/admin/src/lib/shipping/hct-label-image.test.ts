import { describe, expect, it } from 'vitest';
import { extractHctLabelImage } from './hct-label-image';
import { buildLabelPages } from './hct-label-layout';

// hct-label-image.test.ts — ⟦ship-HCTLABELCAPTURE⟧ 片 D1 的守門。
//
// 🔴 **這一片的正確性完全靠這支檔** —— 它零網路零 env 零 DB。
// 🛑 **而它證不到「新竹真的送的是這幾種格式其中之一」** —— 我一張真圖都沒看過,
//    下面每一組測資都是我自己造的。第一張真圖到的那天, 請回來加一格。

/**
 * 一張假 PNG:魔術位元組 + 補到 64 bytes。
 * 🔴 **長度是刻意的, 不是隨手** —— 下游 `hct-label-layout.ts` 逐字
 *    `if (b64.replace(/\s/g, '').length < 64) return 'too_short'`
 *    ⇒ 太短的 fixture 會讓「這一層說 ok 而下一層說 broken」那條縫**寫不出測試**
 *    (code-reviewer 2026-09-06)。64 bytes ⇒ base64 88 字元 ⇒ 跨得過。
 */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(56, 0x7f),
]);
const PNG_HEX = PNG_BYTES.toString('hex');
const PNG_B64 = PNG_BYTES.toString('base64');

const wrap = (image: unknown) => [{ success: 'Y', edelno: '123', image }];

describe('extractHctLabelImage', () => {
  it('hex 字串 ⇒ 認出來, 而回傳一律換成 base64', () => {
    const got = extractHctLabelImage(wrap(PNG_HEX));
    expect(got).toEqual({ ok: true, imageBase64: PNG_B64, mime: 'image/png', encoding: 'hex' });
  });

  it('base64 字串 ⇒ 原樣認出來', () => {
    const got = extractHctLabelImage(wrap(PNG_B64));
    expect(got).toEqual({ ok: true, imageBase64: PNG_B64, mime: 'image/png', encoding: 'base64' });
  });

  it('不是陣列(單一物件)也吃', () => {
    expect(extractHctLabelImage({ image: PNG_HEX })).toMatchObject({ ok: true, encoding: 'hex' });
  });

  it('SOAP 那層塞進來的換行與空白不算數', () => {
    const withWs = `${PNG_HEX.slice(0, 6)}\n  ${PNG_HEX.slice(6)}`;
    expect(extractHctLabelImage(wrap(withWs))).toMatchObject({ ok: true, encoding: 'hex' });
  });

  // 🔴🔴 **本檔存在的理由那一格**(主視窗 2026-09-06 裁 `Q-標籤8=甲` 時逐字點名):
  //    一個 hex 字串**通得過** `hct-label-layout.ts` 的 base64 字元檢查 `/^[A-Za-z0-9+/=\s]+$/`
  //    ⇒ 在那一層它是「好的」⇒ 會變成一張**安靜的空白圖**。
  it('通得過 base64 字元檢查、而解不出圖的字串 ⇒ broken 帶 reason(不是空白)', () => {
    // 全是 hex 字元、偶數長度 ⇒ 兩把都解得出位元組, 而**兩把解出來都不像圖**。
    const poison = 'deadbeef'.repeat(16);
    // 🔴🔴 **這一行要【真的去問舊那一層】, 不是自己抄一份 regex 再對自己跑**
    //    (code-reviewer 2026-09-06:抄來的副本對 SUT 零判別力, 而它讀起來像在舉證)。
    //    ⇒ 直接餵給 `buildLabelPages` —— 它判 `label`(= 放行)才證明這個病灶真的存在。
    const oldLayer = buildLabelPages({ labels: [{ imageBase64: poison, shipmentRef: 'x' }], sheet: 'single' });
    expect(oldLayer[0]!.slots[0]!.kind, '舊那層不再放行 poison ⇒ 本格的病灶前提沒了, 回來重寫').toBe('label');
    const got = extractHctLabelImage(wrap(poison));
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error('unreachable');
    // 🔵 整串比 —— 只 `toContain` 的話, **candidate 迴圈少跑一把也會過**。
    expect(got.reason).toBe('not_an_image(hex:unknown_magic,base64:unknown_magic)');
  });

  it('是一份 PDF ⇒ reason 要講得出它是 PDF(而不是一句「不是圖」)', () => {
    const pdf = Buffer.from('%PDF-1.4 xx').toString('hex');
    const got = extractHctLabelImage(wrap(pdf));
    expect(got).toEqual({ ok: false, reason: expect.stringContaining('is_pdf') });
  });

  // 🔴🔴 code-reviewer 2026-09-06 **實測構造出來**的那一個:兩位元組的魔術位元組擋不住純文字。
  it('一段【剛好以 BM 開頭的純文字】⇒ 不得判成 BMP(那就是空白貼上箱子)', () => {
    const textish = Buffer.from('BM,edelno,error,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,').toString('hex');
    const got = extractHctLabelImage(wrap(textish));
    expect(got.ok, '它被判成一張圖了 —— 那正是本檔要擋的那個世界').toBe(false);
  });

  it('真的 BMP(檔頭長度欄對得上)照過', () => {
    const bmp = Buffer.alloc(64, 0x11);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    bmp.writeUInt32LE(64, 2);
    expect(extractHctLabelImage(wrap(bmp.toString('hex')))).toMatchObject({ ok: true, mime: 'image/bmp' });
  });

  it('帶 data URI 前綴的 base64 ⇒ 認得出來(不要回一個把人指向錯方向的 reason)', () => {
    const got = extractHctLabelImage(wrap(`data:image/png;base64,${PNG_B64}`));
    expect(got).toMatchObject({ ok: true, encoding: 'base64', mime: 'image/png' });
  });

  // 🔴 **兩層之間那條縫**:這一層說 ok 的東西, 下一層不可以說 broken ——
  //    否則員工按下去拿到的是一張少一格的紙, 而**兩層各自都是綠的**。
  it('接縫:本層說 ok 的字串, buildLabelPages 一定不判 broken', () => {
    const got = extractHctLabelImage(wrap(PNG_HEX));
    if (!got.ok) throw new Error('前提壞了');
    const pages = buildLabelPages({
      labels: [{ imageBase64: got.imageBase64, shipmentRef: 'x' }],
      sheet: 'single',
    });
    expect(pages[0]!.slots[0]!.kind).toBe('label');
  });

  it('多列 ⇒ 拒絕, 不取第一列(那是把別人的貨號貼上我們的箱子)', () => {
    expect(extractHctLabelImage([{ image: PNG_HEX }, { image: PNG_HEX }])).toEqual({
      ok: false,
      reason: 'row_count_2',
    });
  });

  it.each([
    ['null 整包', null, 'not_object'],
    ['沒有 image 欄', [{ success: 'Y' }], 'no_image_field'],
    ['image 是數字', wrap(123), 'no_image_field'],
    ['image 是空字串', wrap('   '), 'empty_image'],
    ['既不是 hex 也不是 base64', wrap('★★★'), 'not_hex_nor_base64'],
  ])('%s ⇒ %s', (_name, raw, reason) => {
    expect(extractHctLabelImage(raw)).toEqual({ ok: false, reason });
  });

  it('JPEG / GIF / BMP 也認得(而它們的 mime 各不相同)', () => {
    const mk = (b: number[]) => Buffer.from([...b, 0, 1, 2, 3]).toString('hex');
    expect(extractHctLabelImage(wrap(mk([0xff, 0xd8, 0xff])))).toMatchObject({ mime: 'image/jpeg' });
    expect(extractHctLabelImage(wrap(mk([0x47, 0x49, 0x46, 0x38])))).toMatchObject({ mime: 'image/gif' });
    // 🔵 BMP 另有長度那一道 ⇒ 它的正例在上面自己一格(不能用這個 mk 造)。
  });
});
