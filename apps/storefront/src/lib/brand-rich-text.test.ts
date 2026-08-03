// brand-rich-text.test.ts — D1a 白名單標記解析(2026-08-04)
//
// 這支的價值全在**負向面**:parser 的正向行為(粗體、換行)肉眼就看得出來,
// 真正會出事的是「白名單以外的東西有沒有被當成標記」。所以下面每一組
// 「不得變成標記」的案例都比正向案例重要。
//
// 🔴 案例來源不是想像:標籤與 entity 的全集是 2026-08-04 對
//    `brand-content-data.js` 全部 1335 個字串實跑量出來的
//    (`<strong>`×168 零巢狀零未配對 / `<br>`×98 無變體 / entity 只有 `&amp;`)。

import { describe, expect, it } from 'vitest';
import { brandRichTextToPlain, parseBrandRichText, type BrandRichNode } from './brand-rich-text';

const text = (t: string): BrandRichNode => ({ kind: 'text', text: t });
const strong = (t: string): BrandRichNode => ({ kind: 'strong', text: t });
const br: BrandRichNode = { kind: 'break' };

describe('parseBrandRichText — 白名單內(真實內容的形狀)', () => {
  it('純文字原樣一個節點', () => {
    expect(parseBrandRichText('斯洛維尼亞的排氣系統製造商。')).toEqual([text('斯洛維尼亞的排氣系統製造商。')]);
  });

  it('<strong> 成對 → strong 節點,標籤本身不出現在文字裡', () => {
    expect(parseBrandRichText('<strong>聲浪之前,先有賽道。</strong>1991 年起。')).toEqual([
      strong('聲浪之前,先有賽道。'),
      text('1991 年起。'),
    ]);
  });

  it('<br> → break 節點', () => {
    expect(parseBrandRichText('聲浪只是結果,<br>材料才是原因。')).toEqual([
      text('聲浪只是結果,'),
      br,
      text('材料才是原因。'),
    ]);
  });

  it('about.lead 的真實形狀:strong 起頭 + 段落間 <br><br>', () => {
    // 取自 akrapovic about.lead 的骨架(內容縮短、結構相同)
    expect(parseBrandRichText('<strong>甲。</strong>乙。<br><br>丙。')).toEqual([
      strong('甲。'),
      text('乙。'),
      br,
      br,
      text('丙。'),
    ]);
  });

  it('同一段多個 <strong>(highlights.cards 的 d 欄常見)', () => {
    expect(parseBrandRichText('取得 <strong>ISO 9001</strong> 與 <strong>ISO 50001</strong> 認證。')).toEqual([
      text('取得 '),
      strong('ISO 9001'),
      text(' 與 '),
      strong('ISO 50001'),
      text(' 認證。'),
    ]);
  });

  it('&amp; 解碼成 &(資料裡唯一出現過的 entity:aside.note 的「PUSH &amp; PULL」)', () => {
    expect(parseBrandRichText('整塊切削、PUSH &amp; PULL,義大利製。')).toEqual([
      text('整塊切削、PUSH & PULL,義大利製。'),
    ]);
  });

  it('entity 在 <strong> 內也解碼', () => {
    expect(parseBrandRichText('<strong>PUSH &amp; PULL</strong>')).toEqual([strong('PUSH & PULL')]);
  });

  it('裸 & 原樣通過(資料真的兩種都有:PUSH &amp; PULL 是跳脫的,Materials & Lab 是裸的)', () => {
    // 2026-08-04 實測:1335 個字串裡,含跳脫 &amp; 的 1 筆、含裸 & 的 1 筆(craft.rows 的 step)。
    // 兩種都必須渲染成同一個 &,否則畫面上會出現「&amp;」四個字。
    expect(parseBrandRichText('01 — Materials & Lab')).toEqual([text('01 — Materials & Lab')]);
  });

  it('空字串 → 空陣列(不產出空的 text 節點)', () => {
    expect(parseBrandRichText('')).toEqual([]);
  });

  it('標記相鄰時不產出空 text 節點', () => {
    expect(parseBrandRichText('<br><strong>甲</strong>')).toEqual([br, strong('甲')]);
  });
});

describe('parseBrandRichText — 白名單外一律當純文字(這組才是安全性)', () => {
  // 🔴 每一條的斷言形狀都是「整串原樣出現在 text 節點裡」。
  //    若哪天有人把這支改成真的 HTML 解析器,這些案例會全部轉紅。
  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror=alert(1)>', 'img onerror'],
    ['<a href="https://evil.example">連結</a>', 'a href'],
    ['<STRONG>大寫</STRONG>', '大寫標籤名(白名單區分大小寫)'],
    ['<strong class="x">帶屬性</strong>', 'strong 帶屬性'],
    ['<br/>', 'br 自閉合變體'],
    ['<br />', 'br 帶空白變體'],
    ['<em>斜體</em>', 'em'],
    ['<div>區塊</div>', 'div'],
  ])('%s 原樣當文字(%s)', (input) => {
    expect(parseBrandRichText(input)).toEqual([text(input)]);
  });

  it('🔴 &lt;strong&gt; 解碼後不得再被當成標籤(順序:先解析標籤、後解碼 entity)', () => {
    // 若實作把 decode 提到 parse 之前,這串會變成一個 strong 節點 = 內容可以自己造標記。
    expect(parseBrandRichText('&lt;strong&gt;假粗體&lt;/strong&gt;')).toEqual([
      text('<strong>假粗體</strong>'),
    ]);
  });

  it('🔴 &amp;lt; 不得被 double-decode 成 <', () => {
    // 擋的是「先把 &amp; 解成 & 、再掃其他 entity」那個順序:&amp;lt; → &lt; → < 。
    // ⚠️ 措辭經實測校正(2026-08-04):本條**不是**擋掉所有的連續 .replace() ——
    //    連續 replace 只要把 &amp; 排在最後就是對的(實測該變體 28/28 全綠、本條不紅),
    //    真正被擋掉的是 &amp; 排在最前面的那種寫法。單次掃描的好處是「順序無關」,
    //    不是「唯一正確解」。
    expect(parseBrandRichText('&amp;lt;')).toEqual([text('&lt;')]);
  });

  it('未閉合的 <strong> 不吞掉後面的文字(寧可讓人看到壞標記)', () => {
    expect(parseBrandRichText('<strong>沒關閉的粗體')).toEqual([text('<strong>沒關閉的粗體')]);
  });

  it('落單的 </strong> 當文字', () => {
    expect(parseBrandRichText('文字</strong>')).toEqual([text('文字</strong>')]);
  });

  it('未知 entity 原樣保留(不猜、不吞)', () => {
    expect(parseBrandRichText('&nbsp;&copy;')).toEqual([text('&nbsp;&copy;')]);
  });

  it('兩個 <strong> 之間的內容不會被貪婪吃掉', () => {
    // 貪婪版 /<strong>([\s\S]*)<\/strong>/ 會把「乙」也吃進同一個 strong。
    expect(parseBrandRichText('<strong>甲</strong>乙<strong>丙</strong>')).toEqual([
      strong('甲'),
      text('乙'),
      strong('丙'),
    ]);
  });
});

describe('brandRichTextToPlain', () => {
  it('去掉標記只留文字', () => {
    expect(brandRichTextToPlain('<strong>甲</strong>乙')).toBe('甲乙');
  });

  it('🔴 <br> 換成一個空格,不是直接刪掉(刪掉會把兩邊黏成一個詞)', () => {
    expect(brandRichTextToPlain('A<br>B')).toBe('A B');
  });

  it('entity 一併解碼', () => {
    expect(brandRichTextToPlain('PUSH &amp; PULL')).toBe('PUSH & PULL');
  });

  it('白名單外的標籤原樣留著(alt 裡看到壞標記 = 內容要修的訊號)', () => {
    expect(brandRichTextToPlain('<em>x</em>')).toBe('<em>x</em>');
  });
});
