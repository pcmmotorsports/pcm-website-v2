// @vitest-environment jsdom
//
// ProductTabs smoke test — 前台 regression 安全網(M-1-13f-2)。
// 🔴 S2 / #270 B(Sean 2026-07-08 拍 A):由分頁改「長頁全展開 + 跳轉列」——驗四段內容全常駐可見
//   (無 hidden、無 role=tab)、四個 h2 landmark、跳轉列錨點 href 指向存在的 section id、
//   section aria-labelledby 指向存在 heading;內容邏輯斷言(碳纖/去碳/規格資料驅動/安裝去碳/保固/
//   highlights/安裝 CTA router.push)全保留、僅移除舊「先點 tab 才見」前綴(現全可見)。
// useRouter 走 vi.mock(同 Header.test.tsx / ProductPage.test.tsx 慣例)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { ProductTabs } from './ProductTabs';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(() => {
  cleanup();
  mockPush.mockReset();
});

const SECTION_IDS = ['description', 'specs', 'install', 'warranty'] as const;
const SECTION_LABELS = ['商品介紹', '規格 / 相容性', '安裝須知', '保固與退換'] as const;

describe('ProductTabs (長頁全展開)', () => {
  it('renders 4 section headings (h2, design 字面) and no role=tab', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    for (const label of SECTION_LABELS) {
      expect(screen.getByRole('heading', { level: 2, name: label })).toBeDefined();
    }
    // 已無分頁鈕
    expect(screen.queryAllByRole('tab').length).toBe(0);
  });

  it('renders all 4 sections simultaneously (no hidden, long-page)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    for (const id of SECTION_IDS) {
      const sec = document.getElementById(`pd-sec-${id}`);
      expect(sec).not.toBeNull();
      expect(sec?.hasAttribute('hidden')).toBe(false);
    }
  });

  it('renders jump nav with 4 links → existing section ids + valid aria-labelledby', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const nav = screen.getByRole('navigation', { name: '商品資訊快速跳轉' });
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.length).toBe(4);
    for (const a of links) {
      const href = a.getAttribute('href') ?? '';
      expect(href.startsWith('#pd-sec-')).toBe(true);
      const target = document.getElementById(href.slice(1)); // 去掉 '#'
      expect(target).not.toBeNull();
      // 每段 aria-labelledby 指向存在的 heading(移除 tab 後不得 dangling)
      const labelledby = target?.getAttribute('aria-labelledby');
      expect(labelledby).toBeTruthy();
      expect(document.getElementById(labelledby!)).not.toBeNull();
    }
  });

  it('renders install CTA that pushes /install on click (no tab switch needed)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('button', { name: /預約安裝/ }));
    expect(mockPush).toHaveBeenCalledWith('/install');
  });

  it('renders product brand / name in description section', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductTabs product={product} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.textContent).toContain(product.brand);
    expect(sec?.textContent).toContain(product.name);
  });

  // M-1-16c-4b:產品型號顯真主碼 productCode(取代 PCM-{id hash});無 productCode fallback slug
  it('renders productCode in specs when present', () => {
    const product = { ...MOCK_PRODUCTS[0]!, productCode: 'RPM-DCC01' };
    render(<ProductTabs product={product} />);
    expect(screen.getByText('RPM-DCC01')).toBeDefined();
  });

  it('falls back to slug in specs when productCode absent (no PCM-{id} hash)', () => {
    const product = MOCK_PRODUCTS[0]!; // 無 productCode
    render(<ProductTabs product={product} />);
    expect(screen.getByText(product.slug)).toBeDefined();
    expect(screen.queryByText(`PCM-${String(product.id).padStart(5, '0')}`)).toBeNull();
  });

  // M-1-16c-4b:產地泰國(Sean 拍、去義大利);P0-C-b2:產地為 RPM 專屬列 → 用 RPM fixture(brandSlug)
  it('renders 產地 泰國 (not 義大利) in specs (RPM)', () => {
    render(<ProductTabs product={{ ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' }} />);
    expect(screen.getByText('泰國')).toBeDefined();
  });

  // OD-8 碳纖維化:確認舊 hardcoded 鋁合金規格殘留(7075-T6 等)已清除、換 OD 碳纖字面。
  it('description section uses 真碳纖維 copy for RPM (no hardcoded 7075-T6 spec residue)', () => {
    render(<ProductTabs product={{ ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' }} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.textContent).toContain('真碳纖維');
    expect(sec?.textContent).not.toContain('7075');
  });

  // 🔴 P0-C-b2 去碳:非 RPM 商品介紹無碳纖框架文案;無 description → 最小事實(品牌+品名)fallback
  it('description section 去碳 for non-RPM 無描述時 (no 碳纖, keeps brand + name)', () => {
    const nonRpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'gb-racing', description: undefined };
    render(<ProductTabs product={nonRpm} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.textContent).not.toContain('真碳纖維');
    expect(sec?.textContent).not.toContain('碳纖');
    expect(sec?.textContent).toContain(nonRpm.brand);
    expect(sec?.textContent).toContain(nonRpm.name);
  });

  // 2026-07-05:非 RPM 有 product.description → 渲染真內文(修「內文寫進 DB 但前台無出口」)
  it('description section 非 RPM 有描述時渲染真內文(逐段 + 保留 LINE 提醒)', () => {
    const nonRpm = {
      ...MOCK_PRODUCTS[0]!,
      brandSlug: 'gb-racing',
      description: '玻璃纖維尼龍複合材料製成的防倒球，可吸震滑行。\n\n適用車款與年式以本頁標示為準',
    };
    render(<ProductTabs product={nonRpm} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.textContent).toContain('玻璃纖維尼龍複合材料');
    expect(sec?.textContent).toContain('適用車款與年式以本頁標示為準');
    expect(sec?.textContent).toContain('LINE'); // 通用提醒仍在
    expect(sec?.textContent).not.toContain('真碳纖維'); // 去碳
  });

  // A/#270(Sean 2026-07-08 肉眼驗改圓點):非 RPM 有 highlights → 併入 pd-list 圓點清單(賣點 + LINE 提醒同一清單)
  it('description section 非 RPM 有 highlights → 圓點清單含賣點 + LINE 提醒(pd-list)', () => {
    const nonRpm = {
      ...MOCK_PRODUCTS[0]!,
      brandSlug: 'gb-racing',
      description: '玻璃纖維尼龍複合材料製成。',
      highlights: ['6AL-4V G5 鈦合金，輕量且耐腐蝕', 'DLC 黑鈦塗層'],
    };
    render(<ProductTabs product={nonRpm} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.querySelectorAll('.pd-desc-features li').length).toBe(0); // 不再用破折號清單
    expect(sec?.querySelectorAll('.pd-list li').length).toBe(3); // 2 賣點 + 1 LINE 提醒、同一圓點清單
    expect(sec?.textContent).toContain('6AL-4V G5 鈦合金，輕量且耐腐蝕');
    expect(sec?.textContent).toContain('DLC 黑鈦塗層');
    expect(sec?.textContent).toContain('LINE');
  });

  // A/#270:非 RPM 無 highlights(空陣列)→ pd-list 只剩 LINE 提醒 1 條(不多空項)
  it('description section 非 RPM 無 highlights → pd-list 只顯 LINE 提醒 1 條', () => {
    const nonRpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'gb-racing', description: '純描述。', highlights: [] };
    render(<ProductTabs product={nonRpm} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.querySelectorAll('.pd-list li').length).toBe(1);
    expect(sec?.textContent).toContain('LINE');
  });

  // A/#270 RPM byte 不變:RPM 有 highlights 仍走碳纖框架、不渲染 product.highlights(isRpmCarbon 分支不讀)
  it('description section RPM 有 highlights 仍不渲染 product.highlights(碳纖框架 byte 不變)', () => {
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon', highlights: ['不該顯示的賣點'] };
    render(<ProductTabs product={rpm} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.textContent).not.toContain('不該顯示的賣點');
    expect(sec?.textContent).toContain('真碳纖維'); // RPM 碳纖框架維持
  });

  // 🔴 RPM byte 不變:RPM 有 product.description(舊英文 HTML)仍顯碳纖框架、絕不渲染 description
  it('description section RPM 有描述時仍顯碳纖框架、不渲染 product.description(byte 不變)', () => {
    const rpm = { ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon', description: 'OLD-ENGLISH-HTML-DESC' };
    render(<ProductTabs product={rpm} />);
    const sec = document.getElementById('pd-sec-description');
    expect(sec?.textContent).toContain('真碳纖維'); // 碳纖框架維持
    expect(sec?.textContent).not.toContain('OLD-ENGLISH-HTML-DESC'); // RPM 分支不讀 description
  });

  it('specs section shows 真碳纖維 材質 + 紋路可選 + 特殊樣式 rows for RPM (no 7075 / Hard Anodized)', () => {
    render(<ProductTabs product={{ ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' }} />);
    const sec = document.getElementById('pd-sec-specs');
    expect(sec?.textContent).toContain('真碳纖維');
    expect(sec?.textContent).toContain('紋路可選');
    expect(sec?.textContent).toContain('特殊樣式');
    expect(sec?.textContent).not.toContain('7075');
    expect(sec?.textContent).not.toContain('Hard Anodized');
  });

  // 🔴 P0-C-b2 去碳:非 RPM 規格表無碳纖列,改資料驅動讀 variant spec
  it('specs section 去碳 + 資料驅動 for non-RPM (no 碳纖 rows, renders spec rows from variant spec)', () => {
    const nonRpm = {
      ...MOCK_PRODUCTS[0]!,
      brandSlug: 'gb-racing',
      variants: [
        // note 值為純空白 → buildSpecRows「無值不渲染」該列不成(L1 harden 驗)
        { id: 'v1', sku: 'GB-1', spec: { color: '黑', material: '鋁合金', note: '  ' }, price: 8900, images: [] },
        { id: 'v2', sku: 'GB-2', spec: { color: '銀', material: '鋁合金', note: '' }, price: 8900, images: [] },
      ],
    };
    render(<ProductTabs product={nonRpm} />);
    const sec = document.getElementById('pd-sec-specs');
    // RPM 專屬碳纖列全不顯
    expect(sec?.textContent).not.toContain('真碳纖維');
    expect(sec?.textContent).not.toContain('泰國');
    expect(sec?.textContent).not.toContain('特殊樣式');
    // 通用列仍在
    expect(screen.getByText('品牌')).toBeDefined();
    expect(screen.getByText('商品分類')).toBeDefined();
    // 資料驅動列:label map(color→顏色 / material→材質)+ distinct 值去重併(黑/銀、鋁合金單一)
    expect(screen.getByText('顏色')).toBeDefined();
    expect(screen.getByText('黑 / 銀')).toBeDefined();
    expect(screen.getByText('鋁合金')).toBeDefined();
    // 無值不渲染:note key 全空/空白 → 不出列(未知 key fallback 原字面 'note' 亦不得出現)
    expect(sec?.textContent).not.toContain('note');
  });

  // P0-C-b2:安裝分頁全品牌通用去碳(Sean Q2=A)——「碳纖部品→部品」「碳纖斷裂→部品受損」、RPM 亦適用
  it('install section 全品牌去碳 (no 碳纖部品/碳纖斷裂, keeps 因品而異 + drops pd-step cards)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const sec = document.getElementById('pd-sec-install');
    expect(sec?.textContent).toContain('因品而異');
    expect(sec?.textContent).toContain('每件部品的安裝');
    expect(sec?.textContent).not.toContain('碳纖部品');
    expect(sec?.textContent).not.toContain('碳纖斷裂');
    expect(sec?.querySelector('.pd-steps')).toBeNull();
    expect(sec?.querySelector('.pd-step')).toBeNull();
  });

  // 安裝去碳對 RPM 也生效(全品牌通用、Sean Q2=A)
  it('install section 去碳 also applies to RPM (universal, no 碳纖 words)', () => {
    render(<ProductTabs product={{ ...MOCK_PRODUCTS[0]!, brandSlug: 'rpm-carbon' }} />);
    const sec = document.getElementById('pd-sec-install');
    expect(sec?.textContent).not.toContain('碳纖部品');
    expect(sec?.textContent).not.toContain('碳纖斷裂');
  });

  it('warranty section uses 客製訂製 policy 鑑賞期 clause (no 義大利 24 個月 residue)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const sec = document.getElementById('pd-sec-warranty');
    expect(sec?.textContent).toContain('不適用 7 天鑑賞期');
    expect(sec?.textContent).toContain('客製');
    expect(sec?.textContent).not.toContain('義大利');
  });

  // ── #270 安裝資源(說明書 PDF + 影片 facade、Sean 2026-07-08 Q1/Q2/Q3=A)── optional、無資料整區不顯 ──
  describe('安裝資源 (InstallResources)', () => {
    it('無 manuals / videoUrl → 整區不渲染(不是每個商品都有)', () => {
      render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
      const sec = document.getElementById('pd-sec-install');
      expect(sec?.querySelector('.pd-res')).toBeNull();
      expect(sec?.textContent).not.toContain('安裝資源');
    });

    it('有 videoUrl → facade 播放鈕、點擊才載 iframe(省流量)', () => {
      const p = { ...MOCK_PRODUCTS[0]!, videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
      render(<ProductTabs product={p} />);
      // 未點前:facade 按鈕在、無 iframe
      const facade = screen.getByRole('button', { name: '播放安裝示範影片' });
      expect(facade).toBeDefined();
      expect(document.querySelector('iframe.pd-res-frame')).toBeNull();
      // 點擊 → 載入 embed iframe(帶 videoId)
      fireEvent.click(facade);
      const frame = document.querySelector('iframe.pd-res-frame');
      expect(frame).not.toBeNull();
      expect(frame?.getAttribute('src')).toContain('/embed/dQw4w9WgXcQ');
    });

    it('videoUrl 非法(抽不到 id)→ 不渲染影片', () => {
      const p = { ...MOCK_PRODUCTS[0]!, videoUrl: 'https://example.com/not-a-video' };
      render(<ProductTabs product={p} />);
      const sec = document.getElementById('pd-sec-install');
      expect(sec?.querySelector('.pd-res-facade')).toBeNull();
      expect(sec?.querySelector('.pd-res')).toBeNull(); // 無 docs 又無有效影片 → 整區不顯
    });

    it('有 manuals → 逐筆下載鈕 + size 格式化(MB/KB)', () => {
      const p = {
        ...MOCK_PRODUCTS[0]!,
        manuals: [
          { label: '安裝說明書', url: 'https://cdn.example.com/a.pdf', sizeKB: 1843 },
          { label: '扭力規格表', url: 'https://cdn.example.com/b.pdf', sizeKB: 240 },
          { label: '保養手冊', url: 'https://cdn.example.com/c.pdf' }, // 無 size → 不顯 size 標
        ],
      };
      render(<ProductTabs product={p} />);
      const sec = document.getElementById('pd-sec-install');
      const docs = sec?.querySelectorAll('.pd-res-doc');
      expect(docs?.length).toBe(3);
      expect(screen.getByText('安裝說明書')).toBeDefined();
      expect(screen.getByText('PDF · 1.8 MB')).toBeDefined(); // 1843KB → MB 一位小數
      expect(screen.getByText('PDF · 240 KB')).toBeDefined();
      // 無 sizeKB 的項不顯 size 標
      const savBtn = screen.getByText('保養手冊').closest('a');
      expect(savBtn?.querySelector('.pd-res-doc-s')).toBeNull();
      // href 指向 PDF、新分頁開
      expect(savBtn?.getAttribute('href')).toBe('https://cdn.example.com/c.pdf');
      expect(savBtn?.getAttribute('target')).toBe('_blank');
    });

    it('只有 videoUrl(無 manuals)→ is-single 佔滿寬', () => {
      const p = { ...MOCK_PRODUCTS[0]!, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' };
      render(<ProductTabs product={p} />);
      const grid = document.querySelector('.pd-res-grid');
      expect(grid?.classList.contains('is-single')).toBe(true);
    });

    it('影片 + PDF 同時有 → 並排(非 is-single)', () => {
      const p = {
        ...MOCK_PRODUCTS[0]!,
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        manuals: [{ label: '安裝說明書', url: 'https://cdn.example.com/a.pdf' }],
      };
      render(<ProductTabs product={p} />);
      const grid = document.querySelector('.pd-res-grid');
      expect(grid?.classList.contains('is-single')).toBe(false);
    });
  });
});
