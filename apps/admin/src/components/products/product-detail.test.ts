import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { availabilityLabel, formatTime } from './product-detail';
import { toProductMedia } from '../../lib/products/product-media';

// R2 nit-g:`formatTime` 的 NaN 分支原本零覆蓋 = 死防禦(沒人知道它還活著)。
// 這支檔只測那一支純函式,不渲染元件(渲染面在 `app/products/[id]/page.test.tsx`)。
describe('formatTime(#20 片1b-1)', () => {
  it('正常 ISO → 台北曆面 `YYYY-MM-DD HH:mm`', () => {
    expect(formatTime('2026-08-01T02:00:00Z')).toBe('2026-08-01 10:00');
  });

  it('🔴 nit-g:爛字串原樣回傳,不吐 Invalid Date 給員工看', () => {
    // 🔴 這是**今天走不到**的分支(`created_at`/`updated_at` 是 NOT NULL timestamptz)。
    //    釘它的理由不是「它會發生」,是「1b-2 要顯示的欄位沒有同樣的 NOT NULL 保護」。
    for (const bad of ['', 'not-a-date', '2026-13-45T99:99:99Z']) {
      expect({ [bad]: formatTime(bad) }).toEqual({ [bad]: bad });
    }
  });

  it('反面對照:合法輸入不得走進「原樣回傳」那條 —— 否則上面那格對壞實作恆綠', () => {
    // 若有人把 formatTime 寫成 `return raw;`,上一格照樣全過、這一格會紅。
    expect(formatTime('2026-08-10T02:00:00Z')).not.toBe('2026-08-10T02:00:00Z');
  });
});

// R3 n1:`availabilityLabel` 的 passthrough 分支與上面 `formatTime` 的 NaN 分支**同型**
// (都是 CHECK 保護下今天走不到的死防禦)。上一輪只折了一個 = 兩套標準,這裡補齊。
describe('availabilityLabel(#20 片1b-1)', () => {
  it('CHECK 允許的兩個值 → 中文標籤', () => {
    expect(availabilityLabel('in-stock')).toBe('有庫存');
    expect(availabilityLabel('out-of-stock')).toBe('無庫存');
  });

  it('🔴 n1:非預期值原樣顯示 —— 不猜、不吞、不顯示成「無庫存」', () => {
    // 🔴 這是**今天走不到**的分支(`availability_valid` CHECK 只允許兩值)。
    //    釘它的理由:將來要加第三個值(預購/停產)時,這裡是第一個會被碰到的地方 ——
    //    **原樣顯示會讓員工看到 `preorder` 而發現「後台還沒支援」;
    //    吞掉或猜成「無庫存」則是無聲說謊。**
    for (const odd of ['preorder', 'discontinued', '']) {
      expect({ [odd]: availabilityLabel(odd) }).toEqual({ [odd]: odd });
    }
  });

  it('反面對照:已知值不得走進 passthrough —— 否則上面那格對「全部原樣回傳」恆綠', () => {
    // 若有人把整支寫成 `return raw;`,上一格照樣全過、這一格會紅。
    expect(availabilityLabel('in-stock')).not.toBe('in-stock');
  });
});

// ── 片1b-2:jsonb 收斂 guard ──
// 🔴 這批的價值全在**髒值**上。乾淨值誰寫都會過;能不能擋住髒值才是這層存在的理由。
describe('toProductMedia(#20 片1b-2)', () => {
  it('全部欄位缺席(undefined)→ 空陣列 / null,不炸', () => {
    // 🔴 這格是**實際踩出來的**:第一版型別寫 `string | null`,fixture 少給欄位
    //    ⇒ `undefined.trim()` 直接 TypeError,八格測試同時紅。null 與 undefined 是兩件事。
    const media = toProductMedia({});
    expect(media).toEqual({
      description: null,
      highlights: [],
      fitmentCount: 0,
      images: [],
      representativeImage: null,
      videoUrl: null,
      manuals: [],
      soundClips: [],
    });
  });

  it('🔴 非陣列的 jsonb(來源髒值)→ 一律收斂成空陣列,不往畫面漏', () => {
    for (const dirty of [null, 'not-an-array', 42, {}] as unknown[]) {
      const media = toProductMedia({
        highlights: dirty as unknown[],
        images: dirty as unknown[],
        manuals: dirty as unknown[],
        sound_clips: dirty as unknown[],
        fitments: dirty as unknown[],
      });
      // 🔴 N5:標題說「一律收斂成空陣列」,就要**每個陣列欄都斷言**,不能只斷言兩個。
      expect({
        [String(dirty)]:
          media.highlights.length +
          media.images.length +
          media.manuals.length +
          media.soundClips.length,
      }).toEqual({ [String(dirty)]: 0 });
      expect(media.fitmentCount).toBe(0);
      expect(media.representativeImage).toBeNull();
    }
  });

  it('🔴 highlights / images 濾掉非字串元素,保留字串', () => {
    const media = toProductMedia({ highlights: ['好', 1, null, '棒'], images: ['a.jpg', {}, 'b.jpg'] });
    expect(media.highlights).toEqual(['好', '棒']);
    expect(media.images).toEqual(['a.jpg', 'b.jpg']);
  });

  it('🔴 manuals:缺 label 或 url 的項整項丟掉;sizeKB 有才帶', () => {
    const media = toProductMedia({
      manuals: [
        { label: '安裝說明', url: 'a.pdf', sizeKB: 120 },
        { label: '缺網址' },
        { url: 'b.pdf' },
        { label: '無大小', url: 'c.pdf' },
        'not-an-object',
      ],
    });
    expect(media.manuals).toEqual([
      { label: '安裝說明', url: 'a.pdf', sizeKB: 120 },
      { label: '無大小', url: 'c.pdf' },
    ]);
  });

  it('🔴 soundClips:url 空白的丟掉;非字串 title 收斂成 null(不讓髒值被當標題印出來)', () => {
    const media = toProductMedia({
      sound_clips: [
        { title: 'Akrapovic idle', url: 'a.mp3' },
        { title: null, url: 'b.mp3' },
        { title: 123, url: 'c.mp3' },
        { title: '沒網址', url: '   ' },
      ],
    });
    expect(media.soundClips).toEqual([
      { title: 'Akrapovic idle', url: 'a.mp3' },
      { title: null, url: 'b.mp3' },
      { title: null, url: 'c.mp3' },
    ]);
  });

  it('videoUrl:空字串 / 全空白 → null(不是「有影片」)', () => {
    expect(toProductMedia({ video_url: '' }).videoUrl).toBeNull();
    expect(toProductMedia({ video_url: '   ' }).videoUrl).toBeNull();
    expect(toProductMedia({ video_url: 'https://x/y.mp4' }).videoUrl).toBe('https://x/y.mp4');
  });

  it('🔴 MF3:fitment 鏡像前台雙空 drop —— 髒條目不算,數字不得多於前台', () => {
    const media = toProductMedia({
      fitments: [
        { motoBrand: 'Ducati', modelCode: 'V4' },
        { motoBrand: null, modelCode: null }, // 雙空 → drop(prod 實證 55 商品/82 條目)
        { motoBrand: '', modelCode: '' }, // 雙空字串 → drop
        { motoBrand: 'BMW', modelCode: null }, // 有一邊 → 保留(鏡像前台)
        'not-an-object',
      ],
    });
    expect(media.fitmentCount).toBe(2);
    // 🔴 反面對照:沒消毒的話會是 5 —— 這格證明消毒真的有跑,不是湊巧。
    expect(media.fitmentCount).not.toBe(5);
  });

  it('🔴 MF1:placeholder 代表圖視同沒有圖(同步管線沒圖時會塞它)', () => {
    expect(toProductMedia({ images: ['/placeholder-product.png'] }).representativeImage).toBeNull();
    expect(toProductMedia({ images: [] }).representativeImage).toBeNull();
    // 反面:真圖要拿得到,否則上面兩格對「永遠回 null」恆綠。
    expect(toProductMedia({ images: ['https://cdn/x.jpg'] }).representativeImage).toBe(
      'https://cdn/x.jpg',
    );
  });

  it('反面對照:乾淨輸入不得被 guard 吃掉 —— 否則上面幾格對「全部回空」恆綠', () => {
    const media = toProductMedia({
      description: '碳纖維',
      highlights: ['輕量'],
      // 🔴 真形狀:`FitmentSpec` 是 `motoBrand`/`modelCode`。第一版寫 `{a:1}`,
      //    消毒上線後會變 0 —— 反面對照本身就會失效(R1 MF3 連帶)。
      fitments: [
        { motoBrand: 'Ducati', modelCode: 'V4' },
        { motoBrand: 'BMW', modelCode: 'S1000RR' },
      ],
      images: ['a.jpg'],
      manuals: [{ label: 'L', url: 'u' }],
      sound_clips: [{ title: 't', url: 'u' }],
    });
    expect(media.description).toBe('碳纖維');
    expect(media.highlights).toHaveLength(1);
    expect(media.fitmentCount).toBe(2);
    expect(media.images).toHaveLength(1);
    expect(media.manuals).toHaveLength(1);
    expect(media.soundClips).toHaveLength(1);
  });
});
