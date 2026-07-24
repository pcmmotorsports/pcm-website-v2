// @vitest-environment jsdom
//
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Header 依賴 Next app router + cart context、HomeFooter 為站台外框 → 與本頁契約無關,
// 依既有慣例 stub 掉(對齊 CheckoutSuccess.test.tsx:12-13)。
vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => null }));

afterEach(cleanup);

import { LegalDocPage } from './LegalDocPage';
import {
  TERMS_SECTIONS,
  PRIVACY_SECTIONS,
  LEGAL_LAST_UPDATED,
  LEGAL_UI_STRINGS,
} from '@/data/legal-content';
import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_EMAIL,
  TAX_ID,
  LEGAL_NAME,
  LEGAL_REPRESENTATIVE,
  OPENING_HOURS,
} from '@/lib/site-config';
import { LINE_OA_ID } from '@/lib/line-cta';

// LegalDocPage smoke(#291、2026-07-24)
//
// 這兩頁是**法律頁**:客人在結帳勾「我已閱讀並同意」時要真的讀得到。
// 因此本檔守的不是版面美觀,而是「該有的法定內容真的渲染得出來」——
// 空陣列 / 漏渲染 items / 只渲染標題不渲染內文,都會讓法律頁變成空殼卻仍然「有頁面」。

function renderTerms() {
  return render(
    <LegalDocPage
      screenLabel="Terms"
      title="服務條款"
      subtitle="網路交易定型化契約條款"
      sections={TERMS_SECTIONS}
    />,
  );
}

describe('LegalDocPage', () => {
  it('渲染標題、副標與麵包屑', () => {
    const { container } = renderTerms();
    expect(container.querySelector('.page-hero-title')?.textContent).toBe('服務條款');
    expect(container.querySelector('.page-hero-subtitle')?.textContent).toBe('網路交易定型化契約條款');
    expect(container.querySelector('[data-screen-label="Terms"]')).toBeTruthy();
  });

  it('🔴 每個 section 都渲染成一個 .policy-block,標題數 = 資料筆數(+1 最後更新)', () => {
    const { container } = renderTerms();
    const blocks = container.querySelectorAll('.policy-block');
    // 每個 section 一塊 + 結尾「最後更新」一塊
    expect(blocks.length).toBe(TERMS_SECTIONS.length + 1);
    const headings = Array.from(container.querySelectorAll('.policy-block h3')).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(TERMS_SECTIONS.map((s) => s.heading));
  });

  it('🔴 內文(paragraphs)與條列(items)都真的渲染出來,不是只有標題', () => {
    const { container } = renderTerms();
    const text = container.textContent ?? '';
    // 取每個 section 的第一段內文 / 第一條條列,逐一確認出現在畫面上
    for (const section of TERMS_SECTIONS) {
      const firstPara = section.paragraphs?.[0];
      const firstItem = section.items?.[0];
      const probe = firstPara ?? firstItem;
      expect(probe, `section「${section.heading}」既無 paragraphs 也無 items`).toBeTruthy();
      expect(text).toContain(probe as string);
    }
    // items 必須是 <li>(語意 + 版面都靠它)
    expect(container.querySelectorAll('.policy-block li').length).toBeGreaterThan(0);
  });

  it('顯示最後更新日', () => {
    renderTerms();
    expect(screen.getByText(new RegExp(LEGAL_LAST_UPDATED))).toBeTruthy();
  });

  it('🔴 版面固定字真的取自 LEGAL_UI_STRINGS(渲染後 DOM 驗、非只驗來源物件)', () => {
    // codex 關卡2 R2 B3:雜湊涵蓋測試只證明「這些字在 canonical payload 裡」,
    // 不證明「元件真的用了它們」—— 若日後有人把麵包屑改回硬編碼 '首頁',
    // payload 照樣含 LEGAL_UI_STRINGS.breadcrumbHome、hash 不變,而畫面已與雜湊脫鉤。
    // ⇒ 這裡改驗**渲染後的 DOM 文字**,把「消費端有用 SSoT」也釘住。
    const { container } = renderTerms();
    const breadcrumb = container.querySelector('.pp-breadcrumb');
    expect(breadcrumb?.textContent, '麵包屑首段未使用 LEGAL_UI_STRINGS.breadcrumbHome').toContain(
      LEGAL_UI_STRINGS.breadcrumbHome,
    );
    expect(
      container.textContent,
      '最後更新標籤未使用 LEGAL_UI_STRINGS.lastUpdatedLabel',
    ).toContain(LEGAL_UI_STRINGS.lastUpdatedLabel);
  });

  it('🔴 隱私政策資料同樣渲染得出來(與條款共用版面)', () => {
    const { container } = render(
      <LegalDocPage
        screenLabel="Privacy"
        title="隱私政策"
        subtitle="個人資料蒐集、處理及利用告知"
        sections={PRIVACY_SECTIONS}
      />,
    );
    const headings = Array.from(container.querySelectorAll('.policy-block h3')).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(PRIVACY_SECTIONS.map((s) => s.heading));
  });
});

describe('legal-content 法定必要內容(空殼守門)', () => {
  it('🔴 條款/隱私政策皆非空,且每個 section 都有實際內容', () => {
    expect(TERMS_SECTIONS.length).toBeGreaterThan(0);
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    for (const s of [...TERMS_SECTIONS, ...PRIVACY_SECTIONS]) {
      expect(s.heading.trim().length).toBeGreaterThan(0);
      expect((s.paragraphs?.length ?? 0) + (s.items?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('🔴 條款含法定必要項:企業經營者資訊 / 鑑賞期口徑之事前告知 / 瑕疵擔保 / 爭議處理', () => {
    const all = TERMS_SECTIONS.flatMap((s) => [
      s.heading,
      ...(s.paragraphs ?? []),
      ...(s.items ?? []),
    ]).join('\n');
    expect(all).toContain('統一編號');

    // 🔴 鑑賞期口徑 = Sean 2026-07-24 拍板 B(全站主張客製化委任代購排除七日解除權)。
    //   準則第 2 條序文把「經企業經營者**告知**消費者」列為主張排除的**要件** ——
    //   條款裡沒有這段告知,排除主張自始不成立。故這裡釘的是「有沒有做到告知」。
    //   ⚠️ 舊版只斷言 `toContain('七日')`:寫成「您享有七日解除權」也會綠,
    //     兩種**相反**口徑都通過 = 等於沒有守門。改為釘住法源與排除語意。
    expect(all).toContain('通訊交易解除權合理例外情事適用準則');
    expect(all).toMatch(/排除.{0,20}七日解除權|七日解除權.{0,20}排除/);

    // 🔴 瑕疵擔保(民法 354 以下)與七日解除權無關,**不得**一併被排除 ——
    //   排除它會是比鑑賞期爭議更嚴重的違法。這裡釘住「明示不受影響」那句還在。
    expect(all).toContain('瑕疵擔保');
    expect(all).toMatch(/不受.{0,10}排除.{0,10}影響/);

    expect(all).toContain('消費爭議');
  });

  it('🔴🔴 內部註記絕不可外洩到對外法律頁', () => {
    // 草稿含「標記給 Sean/律師」「L1 實作註」等內部段落(例:客製品排除是否成立的律師提醒)。
    // 那些若被複製進 legal-content.ts 就會出現在客人眼前 —— 法律頁最貴的一種事故。
    const all = [...TERMS_SECTIONS, ...PRIVACY_SECTIONS]
      .flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? [])])
      .join('\n');
    for (const marker of ['標記給 Sean', '標記給', 'L1 實作註', '待法務', '待核准', '草稿']) {
      expect(all, `對外文字混入內部註記標記「${marker}」`).not.toContain(marker);
    }
    // 🔴 頁面是**純文字**渲染(<p>/<li>,非 markdown)→ 任何 markdown 語法或內部紅點標記
    //    都會原樣顯示給客人看。實際踩過:codex 關卡2 修正時誤把 `**粗體**` 與 🔴 寫進條文。
    expect(all, '對外文字含 markdown 粗體標記,會原樣顯示為 **').not.toContain('**');
    for (const marker of ['🔴', '⚠️', '✅']) {
      expect(all, `對外文字含內部標記 emoji「${marker}」`).not.toContain(marker);
    }
  });

  it('🔴 聯絡資訊必須是 site-config SSoT 的值(接錯不會紅 → 這裡釘住)', () => {
    const all = [...TERMS_SECTIONS, ...PRIVACY_SECTIONS]
      .flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? [])])
      .join('\n');
    expect(all).toContain(CONTACT_PHONE_DISPLAY);
    expect(all).toContain(CONTACT_EMAIL);
    expect(all).toContain(LINE_OA_ID);
    expect(all).toContain(TAX_ID);
    expect(all).toContain(LEGAL_NAME);
    expect(all).toContain(LEGAL_REPRESENTATIVE);
    // 營業時間由 OPENING_HOURS 衍生(非寫死)→ 改 SSoT 這裡要跟著動
    expect(all).toContain(OPENING_HOURS.opens);
    expect(all).toContain(OPENING_HOURS.closes);
  });

  it('🔴 隱私政策含個資法第 8 條要件:蒐集目的 / 類別 / 期間 / 得行使之權利', () => {
    const all = PRIVACY_SECTIONS.flatMap((s) => [
      s.heading,
      ...(s.paragraphs ?? []),
      ...(s.items ?? []),
    ]).join('\n');
    expect(all).toContain('蒐集目的');
    expect(all).toContain('個人資料類別');
    expect(all).toContain('期間');
    expect(all).toContain('權利');
  });
});
