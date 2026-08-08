import { describe, expect, it } from 'vitest';
import { localizeSoundClipTitle, SOUND_CLIP_TERM_COUNT } from './sound-clip-title';

describe('localizeSoundClipTitle(Q25=A:DB 存英文、顯示層中文化)', () => {
  it('🔴 前提 — 對照表不是空的(空表會讓下面每一條「fallback 原文」恆真)', () => {
    expect(SOUND_CLIP_TERM_COUNT, '對照表被清空 ⇒ 所有輸入都走 fallback,中文化那半等於沒做').toBeGreaterThan(5);
  });

  it('命中對照表 → 中文', () => {
    expect(localizeSoundClipTitle('with muffler insert')).toBe('含消音塞');
    expect(localizeSoundClipTitle('without db killer')).toBe('不含消音塞');
    expect(localizeSoundClipTitle('Stock')).toBe('原廠排氣');
  });

  it('大小寫與前後空白不影響命中', () => {
    expect(localizeSoundClipTitle('  WITH MUFFLER INSERT  ')).toBe('含消音塞');
    expect(localizeSoundClipTitle('TiTaNiUm')).toBe('鈦合金');
  });

  // 🔴🔴 本檔最重要的一條:沒命中**絕不編造**。
  //    排氣型號猜錯的代價與車種鐵律同類(客人照著買、裝不上或聲音不是他要的)。
  it('🔴 沒命中 → 逐字保留英文原文,不猜、不省略', () => {
    expect(localizeSoundClipTitle('Slip-On Line')).toBe('Slip-On Line');
    expect(localizeSoundClipTitle('Evolution Line (Titanium)')).toBe('Evolution Line (Titanium)');
    expect(localizeSoundClipTitle('某個沒人看過的型號 XYZ-9')).toBe('某個沒人看過的型號 XYZ-9');
  });

  it('🔴 分隔符逗號與分號**並存**(實測資料如此),兩種都要切、逐段各自查表', () => {
    expect(localizeSoundClipTitle('Slip-On Line, with muffler insert')).toBe('Slip-On Line・含消音塞');
    expect(localizeSoundClipTitle('Slip-On Line; without db killer')).toBe('Slip-On Line・不含消音塞');
    // 混用:一段命中、一段不命中 ⇒ 一中一英,不因為有一段不認識就整串放棄
    expect(localizeSoundClipTitle('Titanium; Evolution Line, with db killer')).toBe(
      '鈦合金・Evolution Line・含消音塞',
    );
  });

  it('🔴 無標題(實測約 4%)→ null,由呼叫端決定顯示什麼(不在這裡發明「未命名」)', () => {
    expect(localizeSoundClipTitle(null)).toBeNull();
    expect(localizeSoundClipTitle(undefined)).toBeNull();
    expect(localizeSoundClipTitle('')).toBeNull();
    expect(localizeSoundClipTitle('   ')).toBeNull();
    // 只有分隔符 ⇒ 切完沒有任何有效段落,同樣回 null(不回空字串讓畫面出現一個空標籤)
    expect(localizeSoundClipTitle(' , ; ')).toBeNull();
  });

  it('🔴 不翻產品線名是刻意的(翻了等於替原廠發明譯名 = 編造)', () => {
    for (const line of ['Slip-On Line', 'Evolution Line', 'Racing Line']) {
      expect(localizeSoundClipTitle(line), `${line} 被翻成中文 ⇒ 那是商標、不是可翻譯的描述`).toBe(line);
    }
  });
});
