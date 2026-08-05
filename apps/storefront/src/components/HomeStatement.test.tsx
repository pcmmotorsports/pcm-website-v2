// @vitest-environment jsdom
//
// HomeStatement smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeStatement } from './HomeStatement';

afterEach(cleanup);

describe('HomeStatement', () => {
  it('should render the service statement section without crashing', () => {
    render(<HomeStatement />);
    expect(screen.getByText('N°04 · Service')).toBeDefined(); // D5a:編號隨位置(原 N°05)
    expect(screen.getByText('原廠授權')).toBeDefined();
  });

  // ── 對外家數宣稱(D5d 起;2026-08-05 文案片把最後一顆也拿掉) ──
  // 🔴 這條是**機制**、不是文案測試:首頁對外報的家數必須真(廣告不實風險)。歷來三顆:
  //    第 01 格「8 大品牌」(repo 舊字面)/「17 家品牌」(design 稿)—— 兩個都查不到來源;
  //    第 02 格「全台 9 家合作店家」—— 同族,Sean 2026-08-05 拍 C 一併拿掉。
  //    完整依據 = `docs/design-storefront-manifest.yaml` 的 `HomeStatement.business_overrides`
  //   (唯一權威,不在這裡再抄一份)。
  //    ⇒ 只斷言「新字面在」擋不住下一個人**又**填一個數字進去(他會順手把那條斷言一起改掉);
  //    要釘死的是「不得出現未經查證的家數宣稱」這個**形狀**。
  //    🔴 **本段現在是全面掃描、零豁免**:上一版為第 02 格那句留了扣除字串,那個豁免隨 Q4 消失。
  it('🔴 整段不得出現任何「數字 + 大/家/個」的家數宣稱(零豁免;廣告不實風險)', () => {
    const { container } = render(<HomeStatement />);
    const cols = [...container.querySelectorAll('.ed-statement-col')];
    // 🔴 掃 `<p>` 不掃整格:整格的 textContent 開頭是版面編號 `01`(`.ed-statement-col-num`)
    //    ⇒ 負向 pattern 會永遠從一個數字起跑,只要 `<h3>` 首字是「大/家/個」就假紅(R2 F8 實測)。
    const col1 = cols[0]?.textContent ?? '';
    const body1 = cols[0]?.querySelector('p')?.textContent ?? '';
    // 前提斷言(三條):①三欄都渲染出來 ②第 01 格真的是「原廠授權」那一格(不是掃錯格子)
    // ③這一格的 `<p>` 有內容 —— 少了任何一條,下面的負向斷言都會變成恆真
    //(fixture 讓守門恆真那一族,memory `feedback_fixture-value-makes-guard-vacuous`)。
    expect(cols, '三欄沒渲染出來 ⇒ 負向斷言恆真、這條等於沒有').toHaveLength(3);
    expect(col1, '第 01 格不是「原廠授權」⇒ 欄序被改過,這條掃錯格子了').toContain('原廠授權');
    expect(body1.length, '第 01 格的 <p> 是空的 ⇒ 負向斷言恆真').toBeGreaterThan(10);
    // 半形與全形數字都收:`8 大品牌` / `17 家品牌` / `８大品牌` / `20 家國際品牌` /
    // `20 多家品牌` / `20 家原廠正式代理` 都要紅(六組突變親跑驗過)。
    // ⚠️ 它擋不住什麼:改用國字數字(「八大品牌」「數十家品牌」)會漏 ——
    //    這條擋的是**回歸**(把原字面抄回來、或照 OD 稿的 17 抄一次),不是窮舉所有寫法。
    // ⚠️ **已上膛的誤紅地雷**(R1 nit):字元類裡的 `個` 是通用量詞。`brand-content.ts` 有一句
    //    「60,000 **個**料號」—— 今天沒渲染到首頁,但 D5e-2 補第三欄說明句、或 D5f 把磚牆一句話
    //    搬進來,它就會落到首頁 ⇒ 這條會紅、訊息卻寫「家數宣稱、廣告不實風險」= 誤導。
    //    屆時的正解是**收窄字元類**(拿掉 `個`)或加白名單,不是把整條放寬。
    const COUNT_CLAIM = /[0-9０-９]+\s*[多餘]?\s*[大家個]/;
    expect(body1, '家數宣稱又出現了 ⇒ 無可查證來源、屬廣告不實風險,要先問 Sean').not.toMatch(
      COUNT_CLAIM,
    );
    // 正向:拍板選定的不報數說法還在(有人把整格內容刪掉的話,上面那條負向會恆真放行)
    expect(body1, 'Q3 定稿的不報數說法不見了').toContain('全站皆為原廠正品');

    // 🔴 全段掃描(擋「有人把家數宣稱搬到 <h2> 或別格」),**現在零豁免**:
    //    上一版為第 02 格的「全台 9 家合作店家」留了一個扣除字串,Q4 把那句拿掉之後
    //    豁免一併移除 ⇒ 這條的覆蓋從「第 01 格 + 扣掉一句的其餘」變成**整段無死角**。
    const whole = container.textContent ?? '';
    expect(whole, '整段沒渲染出來 ⇒ 下面的負向斷言恆真').toContain('終身技術諮詢');
    // 🔴 第 02 格也要有自己的正向錨(R2 nit):上面的前提斷言錨在第 03 格的「終身技術諮詢」、
    //    第 01 格錨在「全站皆為原廠正品」,**第 02 格兩層都沒有錨** ⇒ 整格被刪掉的話
    //    「不出現家數宣稱」照樣成立、四條守門全綠,而首頁少一格。錨在不報數的定稿字面上,
    //    它同時證明「這一格還在」與「還在的是拍板那一版」。
    expect(whole, 'Q4 定稿的第 02 格說法不見了 ⇒ 整格可能被刪掉了').toContain('全台合作店家');
    expect(whole, '整段任何地方出現了家數宣稱(<h2>?第 02/03 格?)').not.toMatch(COUNT_CLAIM);
  });

  // ── 「每件商品附原廠序號與保固卡」永久退場(Sean 2026-08-05 拍 B) ──
  // 🔴 這一條與上面的家數守門是**不同的族**,所以分開寫:
  //    家數宣稱錯在「數字沒來源」,這一句錯在「**對平行輸入品不成立**」——
  //    Sean 逐字「平行輸入品不一定都有 ⇒ 該句**永久拿掉、不是暫時**」。
  //    🔴 我第一版漏了這條:五組突變裡「把這句加回去」那組**全綠通過**
  //    ⇒ Sean 拍的「永久」在 code 裡當時只有註解、沒有機制。這條把它補成機制。
  it('🔴 不得出現「附原廠序號與保固卡」這類保固宣稱(對平行輸入品不成立;Sean 拍板永久拿掉)', () => {
    const { container } = render(<HomeStatement />);
    const whole = container.textContent ?? '';
    expect(whole, '整段沒渲染出來 ⇒ 負向斷言恆真').toContain('原廠授權');
    // 錨在「保固卡」:那是這句宣稱的承重詞,換個說法也繞不開(「附保固卡」「保固卡齊全」都收)。
    // ⚠️ 它擋不住什麼(兩件,講完整):
    //    ① 改寫成「原廠保固」「原廠序號」而不提保固卡會漏 —— 這條擋的是**回歸**,不是窮舉寫法。
    //    ② **只掃這個元件**:宣稱搬到別的元件(例如 D5f 給 BrandIndex 的 logo `alt`)這裡零紅。
    //       真正涵蓋「首頁不做這個宣稱」那個不變量的是 `app/page.test.tsx` 的同名整頁版(含 attribute);
    //       這一條留著是因為它指得出「是服務宣言那一段壞的」,訊息更精準(R1 must-fix 的處置)。
    expect(whole, '保固卡宣稱又出現了 ⇒ 對平行輸入品不成立,Sean 已拍板永久拿掉').not.toMatch(/保固卡/);
  });
});
