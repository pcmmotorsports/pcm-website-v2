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

  // ── D5d:品牌家數字面(Sean 拍板 Q1=B「不報數」) ──
  // 🔴 這條是**機制**、不是文案測試:首頁對外報的家數必須真(廣告不實風險),而 repo 舊字面
  //    「8 大品牌」與 design 稿的「17 家品牌」**都沒有可查證的來源**。完整的依據、兩個數字各自
  //    的出處、以及為什麼「不報數」= `docs/design-storefront-manifest.yaml` 的
  //    `HomeStatement.business_overrides.brandCountClaimRemoved`(唯一權威,不在這裡再抄一份)。
  //    ⇒ 只斷言「新字面在」擋不住下一個人**又**填一個數字進去(他會順手把那條斷言一起改掉);
  //    要釘死的是「不得出現未經查證的家數宣稱」這個**形狀**。
  it('🔴 原廠授權那格不得出現任何「數字 + 大/家/個」的家數宣稱(Q1=B 不報數;廣告不實風險)', () => {
    const { container } = render(<HomeStatement />);
    const cols = [...container.querySelectorAll('.ed-statement-col')];
    // 🔴 只掃**第 01 格**,不掃全段:第 02 格的「全台 9 家合作店家」是同一族事實宣稱但
    //    **不在 Q1 的範圍內**(Sean 只被問了品牌家數)、本片刻意未動 ⇒ 全段掃描會為它假紅。
    //    範圍縮小換來的是 pattern 可以放寬到不綁「品牌」二字,擋掉「20 家國際品牌」
    //    「20 多家品牌」「20 家原廠正式代理」這類插了修飾語、或整句不含「品牌」的改寫。
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
    const COUNT_CLAIM = /[0-9０-９]+\s*[多餘]?\s*[大家個]/;
    expect(body1, '家數宣稱又出現了 ⇒ 無可查證來源、屬廣告不實風險,要先問 Sean').not.toMatch(
      COUNT_CLAIM,
    );
    // 正向:拍板選定的不報數說法還在(有人把整格內容刪掉的話,上面那條負向會恆真放行)
    expect(body1, 'Q1=B 選定的不報數說法不見了').toContain('原廠正式代理');

    // 🔴 R2 F9:只掃第 01 格會漏掉「有人把家數宣稱搬到 <h2> 或第 03 格」。補一條全段掃描,
    //    但先把第 02 格那句**刻意未動**的「全台 9 家合作店家」扣掉(它不在 Q1 範圍內、
    //    不扣會為它假紅)。⚠️ 這個扣除是承重的:那句字面一改,這條就會為它紅
    //    —— 那時該做的是回來問 Sean,不是把扣除字串跟著改。
    const EXEMPT = '全台 9 家合作店家';
    const whole = container.textContent ?? '';
    expect(whole, `豁免字面「${EXEMPT}」不在了 ⇒ 第 02 格被改過,回頭確認是誰改的`).toContain(EXEMPT);
    expect(
      whole.replace(EXEMPT, ''),
      '第 01 格以外的地方出現了家數宣稱(<h2> 或其他欄?)',
    ).not.toMatch(COUNT_CLAIM);
  });
});
