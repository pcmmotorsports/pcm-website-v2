// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// repository 拉 server-only 模組 ⇒ 只 mock 那兩支查詢函式。
// 🔴 `resolvePrice` / `resolveListingState` **不 mock** —— 它們是本片要驗的取值落點,
//    mock 掉等於把要驗的東西換成假的(memory `feedback_assertion-measures-the-wrong-thing`)。
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  taxonomy: vi.fn(),
  notFound: vi.fn(),
  // 商品編輯片 9「最近的變更」:預設 = 沒有紀錄(既有各格不受影響)
  history: vi.fn(async () => ({ rows: [] as unknown[], loadFailed: false })),
}));
vi.mock('../../../lib/products/product-history-loader', () => ({ loadProductHistory: mocks.history }));
// 共用圖庫 G5:預設 = 圖庫沒啟用(既有各格不受影響);面板本身在自己的測試檔測
const gallery = vi.hoisted(() => ({ load: vi.fn(async (): Promise<unknown> => ({ state: 'disabled' })) }));
vi.mock('../../../lib/products/gallery-loader', () => ({ loadProductGallery: gallery.load }));
vi.mock('../../../components/products/product-gallery-panel', () => ({
  ProductGalleryPanel: ({ initialPhotos }: { initialPhotos: unknown[] }) => (
    <section data-gallery-panel>{`照片面板 ${initialPhotos.length} 張`}</section>
  ),
}));
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

async function renderPage(id = ID, search: Record<string, string> = {}) {
  const { default: Page } = await import('./page');
  // 🔴 `searchParams` 是 #20 上下架片加的(PRG 結果碼);預設空物件 = 沒有 `?r=`。
  return render(
    await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) }),
  );
}

describe('/products/[id] 詳情頁(#20 片1b-1)', () => {
  // 🔵🔵 **[2026-09-01 FIX-47 註 —— 本格的標題已經語意過期, 斷言【刻意不動】]**
  //    「六個平欄區塊都看得到」是 FIX-47 之前的事實。現在那六張收在 `<details>` 裡、**預設收合**。
  //    🔴 而 `textContent` 對收合的 `<details>` **仍然讀得到** ⇒ 這一格照樣綠,
  //       而它綠的意思從「看得到」變成了「**在 DOM 裡**」。**兩個不同的宣稱, 同一個綠。**
  //    ⇒ 斷言保留(它仍然守著逐欄取值那件事);而「看得到」那半改由
  //      FIX-47 那組的 `details[data-od-pe="other"]` 那一格守。
  // ⛔ ~~原名:「🔴 驗收 1:**六個平欄區塊都看得到**,料號 / 供應商 / 售價 / 狀態逐欄驗」~~
  //    ⇒ 🔴 **那個名稱是被【我】的改動弄成假的**(FIX-47 把六張收進 `<details>` 預設收合)
  //      ⇒ 改名是我的責任, 不是動別人的驗收。**斷言一個字都沒動。**
  it('🔴 驗收 1:六個平欄區塊都【在 DOM 裡】,料號 / 供應商 / 售價 / 狀態逐欄取值', async () => {
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
    // 🔴 **`#20` 上下架片改了這一句,而【改的是事實不是期望值】**:
    //    本頁在那一片之前是純唯讀,那句「只能查看」是真的;
    //    上下架接上之後**它變成假的** —— 而留著假的自述,正是本格要防的那件事的反面。
    //    ⇒ 現行字面必須同時說出【能改什麼】與【不能改什麼】,兩半都釘住:
    //    🔁 丙方案片 2(2026-09-27)同理再改一次:能改的多了標題、副標、賣點 ⇒ 舊句「只能改上架狀態」變成假的。
    expect(text, '沒說出「現在能改什麼」= 本頁在說謊的另一半').toContain('能改標題、副標、賣點與上架狀態');
    expect({ 只能改上架狀態: text.includes('只能改上架狀態') }).toEqual({ 只能改上架狀態: false });
    expect(text, '沒說出「其餘不能改」= 員工會以為每一欄都能編').toContain('其餘欄位仍不能修改');
    // 🔴 而反向釘住:那句已經作廢的自述不得回來
    //    (它會在有人「順手把文案改簡潔」時悄悄回來,而那一刻它就是假的)。
    expect({ 只能查看: text.includes('只能查看') }).toEqual({ 只能查看: false });
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
      '無法鎖定',
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
    for (const must of ['不能在後台改', '多數商品每天會被覆蓋一次', '都依供應商而定', '無法鎖定']) {
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

// ══════════════════════════════════════════════════════════════════════════
// FIX-47 · 三堆分組(OD 稿 `pcm-524f/HANDOFF-orders-ui.md:3666`)
// ══════════════════════════════════════════════════════════════════════════
// 🔴 **這一組要證的不是「畫面有那幾個字」, 是【看得出哪一張按得動】** ——
//    稿寫的症狀逐字:「唯一能改的那張被埋在最下面, 跟六張看不能改的長得一模一樣」。
//    ⇒ 所以每一格都成對:**能用的那張要真的能按** + **不能用的那幾張要真的按不動**。
//    一邊漏掉, 這一片就退化成「換了幾個標題」。
describe('/products/[id] · FIX-47 三堆分組', () => {
  // 🔴🔴 **這一組必須自己設 mock**(codex must-fix)。
  //    檔頭的 `afterEach` 只跑 `vi.clearAllMocks()` —— 它清呼叫紀錄, **不清 implementation**
  //    ⇒ 我第一版沒設, 這六格是靠**前面那些 it 留下來的 `mockResolvedValue`** 在跑。
  //    📌 **單獨跑這個 describe、或有人把上面的 it 刪掉/換順序 ⇒ 它們會拿到 undefined 而失真**,
  //       而那一天它們紅的理由與「我改壞了畫面」長得一樣。
  beforeEach(() => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: 'CNC RACING', categoryName: '外觀部品' });
  });

  // 商品頁改版乙 B2:「還不能用」三張灰卡收成一行字(計畫第五節), 分組抬頭剩兩個。
  it('🟢 分組抬頭是【可以改的 → 只能看的】, 「還不能用」收成一行字排在兩者之間', async () => {
    const { container } = await renderPage();
    const heads = Array.from(container.querySelectorAll('[data-od-pe="grouph"]')).map(
      (n) => n.textContent,
    );
    expect(heads).toEqual(['可以改的', '只能看的']);
    const line = container.querySelector('[data-not-yet]');
    expect(line).not.toBeNull();
    // 順序:一行字在「只能看的」之前
    const onlyView = container.querySelectorAll('[data-od-pe="grouph"]')[1]!;
    expect(line!.compareDocumentPosition(onlyView) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ⛔ ~~原名:「…而它的 form 一個字都沒改」~~ ⇒ 🔴 **名稱才是報表印出來的東西**(codex R2):
  //    刪節線寫在註解裡, 而跑測試的人看到的是那一行名稱。⇒ 名稱改成它真正守得住的。
  it('🔴 能按的那一張:上架/下架卡帶「已經可以用」, 而它那兩句文案沒被順手改掉', async () => {
    const { container } = await renderPage();
    const live = container.querySelector('[data-od-pe="live"]');
    expect(live?.textContent).toBe('已經可以用');
    // ⛔ ~~稿逐字要求「上架/下架的 form 一個字都沒改」⇒ 這兩句是它上線時的文案,
    //    在這裡當**負向對照**:我若不小心動到那個 form, 這兩格會紅。~~
    // 🔴 **上面那句講太滿(codex must-fix)**:兩句文案證得了「那兩句還在」,
    //    **證不了「form 一個字都沒改」** —— `action` / hidden 欄位 / 二次確認閘全壞掉,
    //    這兩格照樣綠。⇒ 它們守的是**文案沒被我順手改掉**, 就這樣。
    //    (「本片沒動那個 form」這件事由 `git diff` 證, 不由這兩行證。)
    expect(container.textContent).toContain('下架這件商品');
    expect(container.textContent).toContain('變更會寫入稽核紀錄');
  });

  it('🔴 還不能用的三項收成一行字:特價、分類、各規格現貨數量;不再有三張停用的灰卡', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[data-not-yet] summary')?.textContent).toBe(
      '還不能用(要先做後端):特價、分類、各規格現貨數量',
    );
    expect(container.querySelectorAll('[data-od-pe="todo"]')).toHaveLength(0);
    expect(container.querySelector('[aria-label="特價(還不能用)"]')).toBeNull();
  });

  it('未開放功能須說明使用限制(展開那一行看得到), 且不向操作人顯示資料庫欄位', async () => {
    const { container } = await renderPage();
    const line = container.querySelector('[data-not-yet]')!;
    const texts = [...line.querySelectorAll('p')].map((p) => p.textContent?.trim());
    for (const description of [
      '目前尚未支援儲存商品特價，因此無法在此設定。',
      '目前分類由供應商資料同步更新，尚未支援保留人工修改，因此無法在此調整。',
      '目前尚未支援管理各規格的現貨數量。供應狀態及訂單到貨數量都不能作為商品庫存數量。',
    ]) {
      expect(texts).toContain(description);
    }
    expect(line.textContent).not.toMatch(/sale_price|category_id|stock_quantity|NOT NULL|0 命中/);
    expect(container.textContent).not.toContain('敬請期待');
    expect(container.textContent).not.toContain('即將推出');
  });

  it('🔴 六張唯讀卡【一張都沒少】—— 收進 details 不等於刪掉', async () => {
    const { container } = await renderPage();
    const other = container.querySelector('details[data-od-pe="other"]');
    expect(other).not.toBeNull();
    // 🔴 對 details **內部**數, 不對整頁數:整頁數的話, 卡片被搬到 details 外面也照樣綠。
    const inner = other?.textContent ?? '';
    for (const must of ['基本資料', '分類', '商品說明與賣點', '適用車型', '圖片與影音', '時間']) {
      expect({ [must]: inner.includes(must) }).toEqual({ [must]: true });
    }
  });

  it('🔴 那句誠實話留著 —— 稿明寫它是這一頁自己的話', async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain('這一頁目前能改標題、副標、賣點與上架狀態,其餘欄位仍不能修改。');
    // 🛑 而稿【刻意不寫】「之後可以再調整這筆訂單的特價」:
    //    訂單金額只在建單時寫一次, 事後補等於改一筆已經發生的收款紀錄。
    //    ⇒ 這一格就是稿說的「驗收有一發專門查這句話 0 命中」。
    expect(container.textContent).not.toContain('之後可以再調整這筆訂單的特價');
  });

  it('🔴 丙方案片 2:「可以改的」底下有標題 / 副標 / 賣點三張卡,讀的是 staff_overrides', async () => {
    mocks.get.mockResolvedValue({ ...PRODUCT, staff_overrides: { title: '我們的標題' } });
    const { container } = await renderPage();
    const cards = [...container.querySelectorAll('[data-override-field]')].map((e) => e.getAttribute('data-override-field'));
    expect(cards).toEqual(['title', 'subtitle', 'highlights']);
    const title = container.querySelector('[data-override-field="title"]')!;
    expect(title.textContent).toContain('網站顯示：我們的版本');
    expect(title.textContent).toContain('碳纖維前土除'); // 供應商那一欄仍然顯示原值
    expect(container.querySelector('[data-override-field="subtitle"]')!.textContent).toContain('網站顯示：供應商的');
  });
});

describe('商品編輯片 9:最近的變更', () => {
  const ROWS = [
    { id: 'h1', at: '2026-09-27 10:14', actor: '小美', field: '賣點', from: '(用供應商的)', to: '輕量\n好裝' },
    { id: 'h2', at: '2026-09-27 10:12', actor: '阿肯(管理者)', field: '上架狀態', from: '上架中', to: '已下架' },
  ];

  it('用這件商品的 id 去讀, 每筆列出時間、誰、欄位、原本、改成', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    mocks.history.mockResolvedValueOnce({ rows: ROWS, loadFailed: false });
    const { container } = await renderPage();
    expect(mocks.history).toHaveBeenCalledWith(ID);
    const section = container.querySelector('[data-product-history]')!;
    expect(section.querySelector('h3')!.textContent).toBe('最近的變更');
    const rows = [...section.querySelectorAll('[data-history-row]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('2026-09-27 10:14');
    expect(rows[0]!.textContent).toContain('小美');
    expect(rows[0]!.querySelector('[data-history-from]')!.textContent).toBe('(用供應商的)');
    expect(rows[0]!.querySelector('[data-history-to]')!.textContent).toBe('輕量\n好裝');
    expect(rows[1]!.querySelector('[data-history-to]')!.textContent).toBe('已下架');
  });

  it('🔴 讀不到 ⇒ 說載入失敗, 不能印成「目前沒有變更紀錄」', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    mocks.history.mockResolvedValueOnce({ rows: [], loadFailed: true });
    const { container } = await renderPage();
    const section = container.querySelector('[data-product-history]')!;
    expect(section.querySelector('[data-history-failed]')).not.toBeNull();
    expect(section.textContent).not.toContain('目前沒有變更紀錄');
    // 其餘編輯功能照常
    expect(container.querySelector('[data-override-field="title"]')).not.toBeNull();
  });

  it('上方「查看變更紀錄」不再是 disabled, 而是跳到「最近的變更」', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    const jump = container.querySelector<HTMLAnchorElement>('[data-history-jump]')!;
    expect(jump.textContent).toBe('查看變更紀錄');
    expect(jump.getAttribute('href')).toBe('#product-history');
    expect(container.querySelector('#product-history')).toBe(container.querySelector('[data-product-history]'));
  });

  it('沒有紀錄 ⇒「目前沒有變更紀錄」', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const { container } = await renderPage();
    expect(container.querySelector('[data-history-empty]')!.textContent).toContain('目前沒有變更紀錄');
  });

  it('滿 20 筆 ⇒ 提示只列最近 20 筆, 並連到操作紀錄', async () => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ROWS[0]!, id: `h${i}` }));
    mocks.history.mockResolvedValueOnce({ rows: many, loadFailed: false });
    const { container } = await renderPage();
    const section = container.querySelector('[data-product-history]')!;
    expect(section.textContent).toContain('只列出最近 20 筆');
    expect(section.querySelector('a[href="/settings/audit"]')).not.toBeNull();
  });
});

describe('共用圖庫 G5:照片', () => {
  function base() {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: null, categoryName: null });
  }

  it('用這件商品(含 supplier_slug 與 external_id)去讀圖庫', async () => {
    base();
    await renderPage();
    expect(gallery.load).toHaveBeenCalledWith(expect.objectContaining({ supplier_slug: 'rpm', external_id: 'RPM-001' }));
  });

  it('沒啟用 ⇒ 只寫「圖庫尚未啟用」, 底部那句不提照片', async () => {
    base();
    const { container } = await renderPage();
    expect(container.querySelector('[data-gallery-unavailable]')!.textContent).toContain('圖庫尚未啟用。');
    expect(container.querySelector('[data-gallery-panel]')).toBeNull();
    expect(container.textContent).toContain('這一頁目前能改標題、副標、賣點與上架狀態');
  });

  it('🔴 讀不到 ⇒ 顯示原因, 不顯示成「還沒有照片」', async () => {
    base();
    gallery.load.mockResolvedValueOnce({ state: 'failed', message: '照片載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。' });
    const { container } = await renderPage();
    const box = container.querySelector('[data-gallery-unavailable]')!;
    expect(box.textContent).toContain('照片載入失敗');
    expect(box.textContent).not.toContain('圖庫尚未啟用');
    // 其餘編輯照常
    expect(container.querySelector('[data-override-field="title"]')).not.toBeNull();
  });

  it('讀到了 ⇒ 掛照片面板, 底部那句加上「照片」', async () => {
    base();
    gallery.load.mockResolvedValueOnce({ state: 'ok', curated: true, photos: [{ id: 'x' }, { id: 'y' }] });
    const { container } = await renderPage();
    expect(container.querySelector('[data-gallery-panel]')!.textContent).toBe('照片面板 2 張');
    expect(container.querySelector('[data-gallery-unavailable]')).toBeNull();
    expect(container.textContent).toContain('這一頁目前能改標題、副標、賣點、照片與上架狀態');
  });
});

// 商品頁改版乙 B1(~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第五節):頂端摘要帶。
// 員工打開就看得到重點與上下架按鈕,不用往下捲;大標題是客人看到的標題(審視 E3)。
describe("B1 頂端摘要帶", () => {
  beforeEach(() => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({
      brandName: "CNC RACING",
      categoryName: "外觀部品",
    });
  });
  const band = (c: HTMLElement) =>
    c.querySelector("[data-summary-band]") as HTMLElement | null;
  const item = (c: HTMLElement, key: string) =>
    band(c)?.querySelector(`[data-summary="${key}"]`)?.textContent ?? null;

  it("🔴 摘要帶列出料號、品牌、分類、售價、庫存、原廠供貨、上架狀態", async () => {
    const { container } = await renderPage();
    expect(band(container)).not.toBeNull();
    expect(item(container, "sku")).toBe("RPM-001");
    expect(item(container, "brand")).toBe("CNC RACING");
    expect(item(container, "category")).toBe("外觀部品");
    expect(item(container, "price")).toBe("NT$ 4,800");
    expect(item(container, "stock")).toBe("有庫存");
    expect(item(container, "source")).toBe("原廠仍有");
    expect(item(container, "listing")).toBe("上架中");
  });

  it("🔴 上下架按鈕在摘要帶裡(第一屏就按得到)", async () => {
    const { container } = await renderPage();
    expect(band(container)!.textContent).toContain("下架這件商品");
  });

  it("🔴 大標題是客人看到的標題:有我們的版本就顯示我們的,副標同理", async () => {
    mocks.get.mockResolvedValue({
      ...PRODUCT,
      staff_overrides: { title: "我們的標題", subtitle: "我們的副標" },
    });
    const { container } = await renderPage();
    const h1 = band(container)!.querySelector("h1");
    expect(h1?.textContent).toBe("我們的標題");
    expect(h1?.nextElementSibling?.textContent).toBe("我們的副標");
    expect(band(container)!.textContent).toContain("客人看到的標題");
  });

  it("🟢 對照:沒有我們的版本 ⇒ 大標題是供應商的標題", async () => {
    const { container } = await renderPage();
    expect(band(container)!.querySelector("h1")?.textContent).toBe(
      "碳纖維前土除",
    );
  });

  it("🔴 封面:有代表圖就顯示那張;只有佔位圖或沒有圖 ⇒ 寫「沒有代表圖」", async () => {
    const { container } = await renderPage();
    expect(band(container)!.querySelector("img")?.getAttribute("src")).toBe(
      "a.jpg",
    );
    mocks.get.mockResolvedValue({
      ...PRODUCT,
      images: ["/placeholder-product.png"],
    });
    cleanup();
    const again = await renderPage();
    expect(band(again.container)!.querySelector("img")).toBeNull();
    expect(band(again.container)!.textContent).toContain("沒有代表圖");
  });

  it("🔴 品牌與分類讀不到 ⇒ 摘要帶那兩格寫「讀不到」,其餘照顯示", async () => {
    mocks.taxonomy.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = await renderPage();
    expect(item(container, "brand")).toBe("讀不到");
    expect(item(container, "category")).toBe("讀不到");
    expect(item(container, "sku")).toBe("RPM-001");
  });
});

// 商品頁改版乙 B2:兩欄版面, 照片在左、文字在右(計畫第五節)。
describe('B2 兩欄版面', () => {
  beforeEach(() => {
    mocks.get.mockResolvedValue(PRODUCT);
    mocks.taxonomy.mockResolvedValue({ brandName: 'CNC RACING', categoryName: '外觀部品' });
  });

  it('🔴 照片在左欄、標題 / 副標 / 賣點在右欄', async () => {
    const { container } = await renderPage();
    const left = container.querySelector('[data-col="photos"]')!;
    const right = container.querySelector('[data-col="text"]')!;
    expect(left.querySelector('[data-gallery-unavailable]')).not.toBeNull();
    expect([...right.querySelectorAll('[data-override-field]')].map((e) => e.getAttribute('data-override-field'))).toEqual([
      'title',
      'subtitle',
      'highlights',
    ]);
    expect(left.querySelector('[data-override-field]')).toBeNull();
  });

  it('🔴 圖庫讀得到時, 照片面板在左欄', async () => {
    gallery.load.mockResolvedValueOnce({ state: 'ok', photos: [], curated: false });
    const { container } = await renderPage();
    expect(container.querySelector('[data-col="photos"] [data-gallery-panel]')).not.toBeNull();
  });
});
