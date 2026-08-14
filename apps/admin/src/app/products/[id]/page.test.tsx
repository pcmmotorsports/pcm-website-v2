// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// repository 拉 server-only 模組 ⇒ 只 mock 那兩支查詢函式。
// 🔴 `resolvePrice` / `resolveListingState` **不 mock** —— 它們是本片要驗的取值落點,
//    mock 掉等於把要驗的東西換成假的(memory `feedback_assertion-measures-the-wrong-thing`)。
const mocks = vi.hoisted(() => ({ get: vi.fn(), taxonomy: vi.fn(), notFound: vi.fn() }));
vi.mock('../../../lib/products/product-repository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../lib/products/product-repository')>();
  return {
    ...actual,
    getProductForAdmin: mocks.get,
    getProductTaxonomyNames: mocks.taxonomy,
  };
});
vi.mock('server-only', () => ({}));
// `notFound()` 真的會 throw ⇒ 用可觀察的 spy 取代,才驗得到「有沒有被呼叫」而不是靠例外形狀。
vi.mock('next/navigation', () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '11111111-2222-4333-8444-555555555555';
const PRODUCT = {
  id: ID,
  title: '碳纖維前土除',
  subtitle: '亮面 3K',
  external_id: 'RPM-001',
  supplier_slug: 'rpm',
  handle: 'carbon-front-fender',
  brand_id: '22222222-2222-4222-8222-222222222222',
  category_id: '33333333-3333-4333-8333-333333333333',
  price_general: 4800,
  availability: 'in-stock',
  delisted_at: null,
  created_at: '2026-08-01T02:00:00Z',
  updated_at: '2026-08-10T02:00:00Z',
  // 片1b-2 媒體欄。刻意混入髒值:`highlights` 含非字串、`manuals` 有缺 url 的項、
  // `sound_clips` 有非字串 title —— 渲染面要證明它吃得下,不是只吃乾淨資料。
  description: '碳纖維前土除,亮面 3K 編織。',
  highlights: ['輕量化', 42, '原廠級密合度'],
  // 🔴 MF3 連帶:第一版用 `{brand:…}` —— **那不是 `FitmentSpec` 的形狀**(真欄名是
  //    `motoBrand`/`modelCode`,`domain/catalog/types.ts:109-113`)⇒ 消毒上線後會全變 0,
  //    而測試會「照樣綠」地測著一個假形狀。這裡換成真形狀,並刻意混一筆雙空髒條目。
  fitments: [
    { motoBrand: 'Ducati', modelCode: 'Panigale V4' },
    { motoBrand: 'BMW', modelCode: 'S1000RR' },
    { motoBrand: null, modelCode: null },
  ],
  // 🔴 R2 N-f:**這個形狀寫入端造不出來**(`rpm-transform.ts:347` 恆 `[repImage]` 單元素)。
  //    **刻意保留不真實**:多元素才讓「畫面上不得出現張數」那兩條否定斷言有東西可否定;
  //    真實單元素的話,`not.toContain('3 張')` 會變成無事可做的空斷言。
  images: ['a.jpg', 'b.jpg', 'c.jpg'],
  video_url: 'https://example.com/install.mp4',
  manuals: [{ label: '安裝說明書', url: 'm.pdf', sizeKB: 320 }, { label: '缺網址' }],
  sound_clips: [{ title: 'Idle', url: 's1.mp3' }, { title: 123, url: 's2.mp3' }],
};

/**
 * 🔴 **按欄位取值,不要對整頁 textContent 做子字串比對**(R3 Q1「生成器 A」)。
 *
 * 病根逐字:**斷言宇宙(整頁)恆大於意圖宇宙(單一 dd 格)⇒ 碰撞必然重演。**
 * 同形狀今晚出現**三次**:R1 MF2 的 `toContain('2')`(頁面日期 `2026-…` 自帶 2)、
 * R2 N-c、R3 F1 的 `toContain('有')`(「**有**的供應商」「沒**有**鎖住」「**有**庫存」都無條件渲染)。
 * ⇒ 這支 helper 讓「代表圖那一格的值」變成可獨立斷言的東西,碰撞面從整頁縮成一格。
 */
function fieldValue(container: HTMLElement, label: string): string | null {
  const dt = Array.from(container.querySelectorAll('dt')).find(
    (node) => node.textContent === label,
  );
  const dd = dt?.nextElementSibling;
  return dd instanceof HTMLElement ? dd.textContent : null;
}

async function renderPage(id = ID) {
  const { default: Page } = await import('./page');
  return render(await Page({ params: Promise.resolve({ id }) }));
}

describe('/products/[id] 詳情頁(#20 片1b-1)', () => {
  it('🔴 驗收 1:六個平欄區塊都看得到,料號 / 供應商 / 售價 / 狀態逐欄驗', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: 'CNC RACING', categoryName: '外觀部品' });
    const { container } = await renderPage();

    // 🔴 **R3 Q1 生成器 A 的系統性修法**:欄位值一律**按欄位斷言**,不對整頁做子字串比對。
    //    舊寫法 `text.includes('rpm')` 的斷言宇宙是整頁 ⇒ 供應商欄被刪掉、而頁面別處剛好
    //    出現 `rpm`(例如網址代稱 `carbon-front-fender` 換成含 rpm 的字串)也照樣綠。
    const FIELDS: ReadonlyArray<readonly [string, string]> = [
      ['料號', 'RPM-001'],
      ['供應商', 'rpm'],
      ['網址代稱', 'carbon-front-fender'],
      ['上架狀態', '上架中'],
      ['庫存狀態', '有庫存'],
      ['售價', 'NT$ 4,800'],
      ['品牌', 'CNC RACING'],
      ['分類', '外觀部品'],
    ];
    for (const [label, value] of FIELDS) {
      expect({ [label]: fieldValue(container, label) }).toEqual({ [label]: value });
    }
    // 🔴 **R4 M2:上一版寫「字串夠長、碰撞面可忽略」—— 那句被我自己的 fixture 推翻。**
    //    `PRODUCT.description` 逐字是「碳纖維前土除,亮面 3K 編織。」⇒ **同時含 title 與 subtitle**
    //    ⇒ E 實測把 `title` 改成 `'ZZZ_MUTANT'`,這格**仍然 PASS**(而且它附了負向對照證明
    //    h1 真的印了突變值 —— 不是渲染沒發生)。**「碰撞面可忽略」是我沒量就寫的。**
    //    ⇒ 改成指名節點取值,標題/副標各自有自己的觀察點。
    expect(container.querySelector('h1')?.textContent).toBe('碳纖維前土除');
    const subtitle = container.querySelector('h1')?.nextElementSibling;
    expect(subtitle?.textContent).toBe('亮面 3K');
  });

  it('🔴 MF2:時間欄要釘台北曆面 —— 這格不存在時 MF1(差 8 小時)全綠溜過去', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';

    // `created_at = 2026-08-01T02:00:00Z` ⇒ 台北是 **08-01 10:00**;UTC 印出來會是 02:00。
    // 🔴 兩條缺一不可:只斷言「有 10:00」而不斷言「沒有 02:00」,
    //    在某些格式下仍可能兩個都印(例如同時印了 UTC 與本地)。
    expect(fieldValue(container, '建立時間')).toBe('2026-08-01 10:00');
    expect(fieldValue(container, '最後更新')).toBe('2026-08-10 10:00');
    // 🔴 UTC 印出來會是 02:00 —— 這條**維持整頁**否定:要擋的是「02:00 出現在畫面任何地方」。
    expect(text).not.toContain('2026-08-01 02:00');

    // 格式字面也釘住(`YYYY-MM-DD HH:mm`):改回 `toLocaleString('zh-TW')` 會印成
    // `2026/8/1 上午10:00:00`。⚠️ **這兩條只擋格式,不擋時區** —— 見下一格。
    expect(text).not.toContain('上午');
    expect(text).not.toContain('2026/8/1');
  });

  it('🔴 R2 MF2:執行環境在 UTC 時仍印台北時間(唯一能證明 timeZone 有效的一格)', async () => {
    // ⚠️ **上一格對「沒釘 timeZone」零判別力,我 R1 折的時候寫反了。**
    //    `vitest.config.ts:64` 把 `env: { TZ: 'Asia/Taipei' }` 釘死在所有測試上
    //    ⇒ 我當時寫的「測試程序自己不在台北時區也會紅」**永遠不會發生**。
    //    實測:不帶 `timeZone` 的 `toLocaleDateString('en-CA')` + `toLocaleTimeString('en-GB',…)`
    //    在 Taipei 下輸出 `2026-08-01 10:00` —— **與正確實作逐字相同、五條斷言全綠**。
    //    🔴 病根:**判別力要對著「壞實作」量,不能對著「好實作」量** ——
    //    我為了修一個恆綠格,做出了另一個恆綠格。
    //    形狀照抄屋內既有解(`lib/orders/payment-list-view.test.ts:96-107`),不自己想新寫法。
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });

    vi.stubEnv('TZ', 'UTC');
    try {
      // 前置斷言:先確認 stub 真的改到執行期時區 —— 沒改到的話下面那句在台北下恆綠,
      // 又是一個「偵測器根本沒吐東西」的假綠。
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
      const { container } = await renderPage();
      // 🔴 這一條是「`formatOrderDateTime` 裡那兩行 `timeZone` 消失就會紅」的唯一憑據。
      expect(fieldValue(container, '建立時間')).toBe('2026-08-01 10:00');
      expect(container.textContent ?? '').not.toContain('2026-08-01 02:00');
    } finally {
      vi.unstubAllEnvs();
    }
    // 收尾也驗:時區有還原,否則本檔後面的格子會在 UTC 下跑。
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
  });

  it('🔴 驗收 2:已下架的商品進得去,而且狀態顯示「已下架」(不是 404)', async () => {
    mocks.get.mockResolvedValue({ ...PRODUCT, delisted_at: '2026-08-01T00:00:00Z' });
    mocks.taxonomy.mockResolvedValue({ brandName: 'X', categoryName: 'Y' });
    const { container } = await renderPage();
    expect(container.textContent ?? '').toContain('已下架');
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('🔴 驗收 3:非 UUID → 404,而且完全不打 DB', async () => {
    await expect(renderPage('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
    // 🔴 這一格才是重點:形狀不對就不該讓路由參數進到查詢裡。
    expect(mocks.get).not.toHaveBeenCalled();

    // 負向對照:合法 UUID 一定要打得到 DB,否則上面那條對「永遠不查」也會綠。
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    await renderPage();
    expect(mocks.get).toHaveBeenCalledWith(ID);
  });

  it('🔴 驗收 4a:查無此商品 → 404', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('🔴 驗收 4b:讀取失敗 → 錯誤態,不 404、DB error 不外洩到畫面', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.get.mockRejectedValue(new Error('PGRST301 permission denied for table products'));
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('商品資料載入失敗');
    expect(text).not.toContain('PGRST301');
    expect(text).not.toContain('permission denied');
    // 🔴 讀取失敗**不得**退化成 404 —— 兩者混在一起,員工會以為商品被刪了。
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 品牌/分類壞掉只壞那一區塊,其餘欄位照看得到', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('品牌與分類載入失敗');
    // 這才是「單區塊容錯」的意思:料號還在 —— 按欄位斷言,不靠整頁碰運氣。
    expect(fieldValue(container, '料號')).toBe('RPM-001');
    expect(fieldValue(container, '售價')).toBe('NT$ 4,800');
    spy.mockRestore();
  });

  it('🔴 本頁不得宣稱尚未存在的功能', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    for (const promise of ['即將推出', '敬請期待', '可以編輯', '點擊修改', '編輯商品']) {
      expect({ [promise]: text.includes(promise) }).toEqual({ [promise]: false });
    }
    expect(text).toContain('只能查看');
    expect(text).toContain('返回商品列表');
  });

  it('🔴🔴 驗收 6:圖片區必須寫明「同步會蓋回去」—— 這句從 plan 寫下起一直不存在,1b-2 才補上', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    // 依據 = plan §0 承重前提 3:圖片今天**只有防洗網、沒有旗標鎖** ⇒ 供應商換圖直接蓋掉。
    // 🔴 **三個承重片段逐條正向斷言**(R1 MF4:上一版只釘了前兩段,
    //    「沒有鎖住不給改的機制」——**最承重的那半句**——零斷言,而交件信說「測試釘死該字串」)。
    for (const must of [
      '不能在後台改',
      // 🔴 R2 MF-a:必須是「多數」不是「每天都會」——`extreme` 不排每日同步
      //    (`rpm-sync.yml:72` matrix 逐字「extreme 刻意不列」)。
      '多數商品每天會被覆蓋一次',
      '都依供應商而定',
      '沒有「鎖住不給改」的機制',
    ]) {
      expect({ [must]: text.includes(must) }).toEqual({ [must]: true });
    }
    // 🔴 反向:不得把「沒有鎖」講成「有鎖」—— 那會讓員工以為改了就守得住。
    //    R1 N7:上一版只擋兩個字面,近義改寫照樣全綠 ⇒ 這裡列近義詞,
    //    但**真正的判別力在上面那組正向斷言**,反向只是補漏。
    // 🔴 R2 MF-a 的反向:**不得再出現全稱句**。
    for (const forbidden of [
      '每天都會被供應商的資料蓋過去',
      '所有商品每天',
      '已鎖定',
      '已鎖住',
      '不會被覆蓋',
      '不會被蓋掉',
      '可以編輯',
    ]) {
      expect({ [forbidden]: text.includes(forbidden) }).toEqual({ [forbidden]: false });
    }
  });

  it('🔴 片1b-2:三個區塊都渲染,而且髒值不會漏到畫面上', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';

    expect(text).toContain('碳纖維前土除,亮面 3K 編織。');
    expect(text).toContain('輕量化');
    expect(text).toContain('原廠級密合度');
    // 🔴 髒值不得出現:highlights 裡的 42 被濾掉、manuals 缺 url 的整項丟掉。
    expect(text).not.toContain('42');
    expect(text).not.toContain('缺網址');
    // 手冊只剩一份、且帶大小。
    expect(text).toContain('安裝說明書');
    expect(text).toContain('320 KB');
    expect(fieldValue(container, '安裝手冊')).toBe('1 份');
    // 🔴 MF1:不再有「N 張」。同步管線 `rpm-transform.ts:347` 寫的永遠是 `[repImage]`
    //    ⇒ 張數對每件商品恆等於 1、資訊量為零,而且沒圖時塞 placeholder 也算 1 張。
    //    ⚠️ 不能斷言「整頁沒有『張』字」—— 說明文案本身就有「只有一張代表圖」。
    //    要釘的是**計數形式消失了**,不是那個字消失了。
    // 🔴 「代表圖」那格的**值**已由下面 `fieldValue` 正向釘住;這兩條字面否定改為
    //    **整頁**確認「張數這種說法沒有出現在任何地方」—— 意圖宇宙本來就是整頁,不是欄位。
    expect(text).not.toContain('3 張');
    expect(text).not.toContain('1 張');
    // 🔴 **R3 F1:上一版我在這裡寫 `toContain('有')` —— 那是 no-op。**
    //    「有的供應商」「沒有『鎖住不給改』」「有庫存」都無條件渲染 ⇒ **沒有任何可達狀態讓它紅**,
    //    把 `representativeImage` 突變成恆「沒有(顯示預設圖)」照樣全綠。
    //    🔴 而 N-b 這條 finding 的本體**就是**「補值面正向斷言」—— 我宣稱折了,折出來是 no-op。
    //    ⇒ 改成**按欄位取值**:這格只看「代表圖」那一格的 dd,不看整頁。
    expect(fieldValue(container, '代表圖')).toBe('有');
    expect(text).toContain('完整圖庫在「變體」那一層');
    expect(fieldValue(container, '聲浪音檔')).toBe('2 段');
    // 🔴 N6:髒 title(數字 123)不得外洩;它應被收斂成 null 並顯示 `(無標題)`。
    expect(text).not.toContain('123');
    expect(text).toContain('(無標題)');
  });

  it('🔴 適用車型只報 direct 筆數,而且畫面上要講明它不完整', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    // 🔴 R1 MF2:上一版寫 `toContain('2')` = **恆綠** —— 同頁 `created_at` 渲染成
    //    `2026-08-01 10:00` 本身就含 `2`,把 fitmentCount 改成恆 0 這格照樣過。
    //    改釘完整片語,而且數字是**消毒後**的:三筆進去、一筆雙空被 drop ⇒ 2。
    expect(text).toContain('2 條適用車型設定');
    // 🔴 R2 N-c:上一版寫 `not.toContain('3 條…')`,在上一行已通過的前提下**恆真、零判別力**。
    //    改成斷言「未消毒的原始筆數(3)不會出現在任何形式的句子裡」——
    //    這條在「消毒被拿掉」時才會紅,而那正是要擋的事。
    expect(text).not.toMatch(/3\s*條/);
    // 🔴 這句是「不對員工說謊」的機制面:`products.fitments` 只有 direct 那一半,
    //    而且我沒消毒的話數字會比前台**多**(前台雙空 drop)。
    expect(text).toContain('不含');
    expect(text).toContain('不會多於前台看到的');
    expect(text).toContain('完整清單還沒做');
  });

  it('媒體欄全空 → 各區塊顯空狀態,不炸也不留空白格', async () => {
    mocks.get.mockResolvedValue({
      ...PRODUCT,
      description: null,
      highlights: [],
      fitments: [],
      images: [],
      video_url: null,
      manuals: [],
      sound_clips: [],
    });
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('沒有商品說明');
    // 🔴 空的時候警語仍要在 —— 「沒有圖片」不代表「同步不會蓋」。三段都要在。
    for (const must of ['不能在後台改', '多數商品每天會被覆蓋一次', '都依供應商而定', '沒有「鎖住不給改」的機制']) {
      expect({ [must]: text.includes(must) }).toEqual({ [must]: true });
    }
    // 🔴 無圖時代表圖欄要說「沒有」,不得因為 placeholder 而說「有」——同樣按欄位取值。
    expect(fieldValue(container, '代表圖')).toBe('沒有(顯示預設圖)');
  });

  it('沒值的欄位顯「—」,不留空白格', async () => {
    // 🔴 **R4 M3:上一版 `expect(text).toContain('—')` 是恆綠格,而且這個 `it` 只有那一條斷言
    //    ⇒ 整格零判別力。** 病根不是 scope,是**警語本身無條件渲染 `——`**
    //    (`product-detail.tsx` 的「有的供應商是一次性匯入」那段有破折號)
    //    ⇒ E 實測把同一條斷言塞進「驗收 1」(全欄位皆有值、**零 fallback**)⇒ **照樣 PASS**。
    //    改成:**指名那些真的沒值的欄位**,逐欄斷言它們顯示 `—`,並附反面對照。
    mocks.get.mockResolvedValue({ ...PRODUCT, subtitle: null, price_general: null });
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();

    for (const label of ['售價', '品牌', '分類']) {
      expect({ [label]: fieldValue(container, label) }).toEqual({ [label]: '—' });
    }
    // 🔴 反面對照:有值的欄位**不得**顯示 `—`,否則「全部欄位都印 —」的壞實作也會通過。
    expect(fieldValue(container, '料號')).toBe('RPM-001');
    // 副標為 null ⇒ 整個節點不渲染(不是印 `—`)—— 那是刻意的:h1 底下多一個空殼會像壞掉。
    expect(container.querySelector('h1')?.nextElementSibling?.tagName).not.toBe('P');
  });
});
