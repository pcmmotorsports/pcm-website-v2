import { describe, it, expect } from 'vitest';
import {
  normalizeSupplierOrderNoSearch,
  MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH,
  SupplierOrderNoSearchTooManyError,
  SupplierOrderNoSearchShapeError,
} from './supplier-order-no-search';

describe('normalizeSupplierOrderNoSearch(M-4b E10 A9b2-A)', () => {
  describe('empty(不篩選)', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['非字串(數字)', 123 as unknown as string],
      ['空字串', ''],
      ['純空白', '   '],
      ['全形空白', '　　'],
    ])('%s → empty', (_label, input) => {
      expect(normalizeSupplierOrderNoSearch(input as string)).toEqual({ kind: 'empty' });
    });
  });

  describe('ok(合法 → 大寫形)', () => {
    it('小寫轉大寫', () => {
      expect(normalizeSupplierOrderNoSearch('so-123')).toEqual({ kind: 'ok', value: 'SO-123' });
    });

    it('前後空白先 trim 再判', () => {
      expect(normalizeSupplierOrderNoSearch('  so-123  ')).toEqual({
        kind: 'ok',
        value: 'SO-123',
      });
    });

    it.each([
      ['斜線', 'PO/2026/0042', 'PO/2026/0042'],
      ['井號', '#4471', '#4471'],
      ['底線', 'abc_12345', 'ABC_12345'],
      ['百分號', 'a%b', 'A%B'],
      ['已是大寫', 'SO-123', 'SO-123'],
      ['恰好 32 字', 'x'.repeat(32), 'X'.repeat(32)],
    ])('%s 放行', (_label, input, expected) => {
      expect(normalizeSupplierOrderNoSearch(input)).toEqual({ kind: 'ok', value: expected });
    });

    it('🔴 底線與百分號**必須放行** —— 它們是 ILIKE 的萬用字元,而本線刻意走 .eq 等值比對', () => {
      // 這條是 A9b2 整條線的設計理由的反面斷言:選產生欄 + .eq() 而不是 .ilike(),
      // 正是因為 PostgREST 沒有 ESCAPE 機制、`_`/`%` 會變萬用字元 = 搜尋 fail-open。
      // 若哪天有人「順手」把這兩個字元擋掉,等於預設呼叫端會用 ilike ⇒ 前提反轉,本條要紅。
      expect(normalizeSupplierOrderNoSearch('ab/9_x')).toEqual({ kind: 'ok', value: 'AB/9_X' });
      expect(normalizeSupplierOrderNoSearch('50%off')).toEqual({ kind: 'ok', value: '50%OFF' });
    });
  });

  describe('invalid — 每格都斷言 reason,不是只斷言 kind', () => {
    it('超長 → too_long,且 input 截到 **上限+1**(不把超長字串原樣帶進 URL)', () => {
      const input = 'x'.repeat(MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH + 5);
      expect(normalizeSupplierOrderNoSearch(input)).toEqual({
        kind: 'invalid',
        reason: 'too_long',
        input: 'x'.repeat(MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH + 1),
      });
    });

    it('🔴🔴 `too_long` 的 input 再正規化一次**必須仍是 invalid** —— 這是真正要守的不變量', () => {
      // 呼叫鏈真的會再正規化一次:parse 層把 `input` 放進 filter → adapter 收到後重跑本函式。
      // 若截到剛好 MAX,那個值自己會通過 ⇒ 橫幅說「太長」、列表卻顯示「前 32 字」的真實命中,
      // 翻頁後警告還會消失(URL 只剩截斷值)。實測(修前)= `kind:'ok'`。
      // 🔴 這一格才是不變量本身;只斷言「截到某長度」會把實作細節當規格,改個數字就失守。
      for (const raw of [
        'PO-' + 'A'.repeat(40),
        'x'.repeat(MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH + 1),
        ' ' + 'z'.repeat(200) + ' ',
      ]) {
        const first = normalizeSupplierOrderNoSearch(raw);
        expect(first.kind).toBe('invalid');
        const carried = (first as { input: string }).input;
        expect(normalizeSupplierOrderNoSearch(carried).kind).toBe('invalid');
      }
    });

    it.each([
      ['德文 ß', 'so-123ß'],
      ['中文', '單號123'],
      ['連字 ﬁ', 'ﬁle-1'],
      ['零寬空格', 'SO​123'],
      ['控制字元', 'SO123'],
    ])('%s → non_ascii', (_label, input) => {
      expect(normalizeSupplierOrderNoSearch(input)).toEqual({
        kind: 'invalid',
        reason: 'non_ascii',
        input,
      });
    });

    it('🔴 非 ASCII 必須擋在 toUpperCase() 之前 —— ß 不得被膨脹成 SS', () => {
      // `'ß'.toUpperCase()` === 'SS'。若順序寫反,'so-123ß' 會變成合法的 'SO-123SS',
      // 也就是**另一張真實訂單的單號**(A9b1 order-number-search.ts:72-77 同一個坑)。
      const got = normalizeSupplierOrderNoSearch('so-123ß');
      expect(got.kind).toBe('invalid');
      expect(JSON.stringify(got)).not.toContain('SO-123SS');
    });

    it.each([
      ['逗號', 'SO,123'],
      ['左括號', 'SO(123'],
      ['右括號', 'SO)123'],
      ['雙引號', 'SO"123'],
      ['反斜線', 'SO\\123'],
    ])('%s → reserved_char', (_label, input) => {
      expect(normalizeSupplierOrderNoSearch(input)).toEqual({
        kind: 'invalid',
        reason: 'reserved_char',
        input,
      });
    });
  });

  describe('🔴 判斷順序本身是規格的一部分', () => {
    it('又超長又含非 ASCII → too_long(長度先於一切,理由=避免超長字串進 URL)', () => {
      const input = `${'學'.repeat(MAX_SUPPLIER_ORDER_NO_SEARCH_LENGTH + 1)}`;
      expect(normalizeSupplierOrderNoSearch(input).kind).toBe('invalid');
      expect(
        (normalizeSupplierOrderNoSearch(input) as { reason: string }).reason,
      ).toBe('too_long');
    });

    it('又含非 ASCII 又含保留字元 → non_ascii(非 ASCII 先判,因為它才是會被大寫化改寫的那個)', () => {
      expect((normalizeSupplierOrderNoSearch('SO,ß') as { reason: string }).reason).toBe(
        'non_ascii',
      );
    });
  });
});

describe('SupplierOrderNoSearchTooManyError', () => {
  it('帶 cap、code 與 name 可供消費端判別(不靠比對 message 字面)', () => {
    const err = new SupplierOrderNoSearchTooManyError(200);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('supplier_order_no_search_too_many');
    expect(err.name).toBe('SupplierOrderNoSearchTooManyError');
    expect(err.cap).toBe(200);
  });
});

describe('SupplierOrderNoSearchShapeError', () => {
  it('帶 rowCount、code 與 name 可供消費端判別', () => {
    const err = new SupplierOrderNoSearchShapeError(7);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('supplier_order_no_search_bad_shape');
    expect(err.name).toBe('SupplierOrderNoSearchShapeError');
    expect(err.rowCount).toBe(7);
  });

  it('🔴 與 TooMany 是**不同**的錯誤類別 —— A10c2 要顯示的訊息不一樣', () => {
    // 「太多筆、請縮小範圍」是使用者可以自己處理的;
    // 「回傳形狀不符」是程式壞了、要工程師看 —— 混成同一種會讓後者被當成前者忽略掉。
    expect(new SupplierOrderNoSearchShapeError(1)).not.toBeInstanceOf(
      SupplierOrderNoSearchTooManyError,
    );
    expect(new SupplierOrderNoSearchTooManyError(1)).not.toBeInstanceOf(
      SupplierOrderNoSearchShapeError,
    );
  });
});
