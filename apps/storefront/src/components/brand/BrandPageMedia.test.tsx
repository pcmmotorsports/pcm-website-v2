// @vitest-environment jsdom
//
// BrandPageMedia smoke test — D2c-2(2026-08-04)
//
// 這一支守的四件事,每一件壞掉都是「畫面看起來完全正常」的形狀:
//   ① 沒按過封面就先掛 iframe ⇒ 每個看品牌頁的人都被送去 YouTube 一次(隱私 + 那塊會變全黑)
//   ② 來源分流走錯家 ⇒ vimeo 只有 1 家、file 5 家,真資料的判別力薄,靠合成 fixture 補
//   ③ 4 秒退路對 `<video>` 也生效 ⇒ 載得慢的自架影片會被誤判成「被擋下」而整塊換掉
//   ④ 外開連結的優先序寫反 ⇒ 5 家自架片會連到 `youtube.com/watch?v=undefined`

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { BrandPageMedia } from './BrandPageMedia';
import { BRAND_CONTENT } from '@/data/brand-content';
import type { BrandVideo } from '@/data/brand-content-types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const videos = BRAND_CONTENT.filter((b) => b.video).map((b) => b.video!);
/** 三種來源各挑一家真資料;挑不到就讓測試自己講話,不要 fallback 成別的形狀。 */
const youtubeVideo = videos.find((v) => v.youtube) as BrandVideo;
const vimeoVideo = videos.find((v) => v.vimeo) as BrandVideo;
// 🔴 這裡刻意挑**非** portrait 的自架片(gilles)。第一版寫 `find(v => v.file)` 挑到
//    cnc-racing,而它自己就是 portrait ⇒ 下面 `{...fileVideo, portrait: true}` 的 spread
//    是 no-op、那條測試沒有它自稱的判別力,而且橫式自架片零覆蓋(關卡2 nit)。
const fileVideo = videos.find((v) => v.file && !v.portrait) as BrandVideo;

const play = (container: HTMLElement) => {
  const poster = container.querySelector('.bp-film-poster');
  expect(poster, '封面按鈕不見了 ⇒ 下面在測一個按不到的東西').not.toBeNull();
  fireEvent.click(poster!);
};

describe('🔴 BrandPageMedia · 點了才掛播放器', () => {
  it('未點擊時只有封面,DOM 裡連一個 iframe / video 都沒有', () => {
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    expect(container.querySelector('.bp-film-poster')).not.toBeNull();
    // 🔴 這一條就是「沒捲到就完全不載 YouTube、不送請求」的可觀察形式。
    //    jsdom 不會真的發請求,所以只能守「節點不存在」——節點不存在 ⇒ 請求不可能發生。
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    // 封面態不得帶 is-playing(帶了的話框會用 16:9,封面圖被裁掉上下)
    expect(container.querySelector('.bp-film-frame')?.classList.contains('is-playing')).toBe(false);
  });

  it('點下封面 → 掛 iframe、封面移除、框轉 is-playing', () => {
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    play(container);
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.querySelector('.bp-film-poster')).toBeNull();
    expect(container.querySelector('.bp-film-frame')?.classList.contains('is-playing')).toBe(true);
  });

  it('封面圖是裝飾(alt=""),名稱掛在按鈕上並講明「播放」', () => {
    // 反過來寫(alt 放標題、按鈕沒名稱)報讀器只會念出影片標題,聽不出這是可以按的。
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    expect(container.querySelector('.bp-film-poster img')?.getAttribute('alt')).toBe('');
    expect(container.querySelector('.bp-film-poster')?.getAttribute('aria-label'))
      .toBe(`播放影片:${youtubeVideo.title}`);
    // 圖走資產前綴
    expect(container.querySelector('.bp-film-poster img')?.getAttribute('src'))
      .toBe(`/brand-assets/${youtubeVideo.poster}`);
  });
});

describe('🔴 BrandPageMedia · 三種來源分流', () => {
  it('youtube → youtube-nocookie 的 embed,且 loop 靠 playlist 指向自己', () => {
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    play(container);
    const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src).toContain('https://www.youtube-nocookie.com/embed/');
    expect(src).toContain(youtubeVideo.youtube!);
    // playlist 少了的話 loop=1 完全不生效(YouTube 的 API 規定),而畫面看起來一模一樣
    expect(src).toContain(`playlist=${youtubeVideo.youtube}`);
    expect(src).toContain('loop=1');
  });

  it('vimeo → player.vimeo.com,且未公開影片的 h= hash 要帶上', () => {
    // 🔴 實測只有 1 家走 vimeo,而它正好是未公開影片:h= 掉了會 403。
    const { container } = render(<BrandPageMedia video={vimeoVideo} />);
    play(container);
    const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src).toContain(`https://player.vimeo.com/video/${vimeoVideo.vimeo}`);
    expect(vimeoVideo.vimeoHash, '前提:挑到的樣本要有 hash,否則下一條測不到東西').toBeDefined();
    expect(src).toContain(`h=${vimeoVideo.vimeoHash}`);
  });

  it('🔴 file → 用 <video>、完全不建 iframe(自架片不該經過第三方)', () => {
    const { container } = render(<BrandPageMedia video={fileVideo} />);
    play(container);
    const el = container.querySelector('video');
    expect(el).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(el?.getAttribute('src')).toBe(`/brand-assets/${fileVideo.file}`);
    expect(el?.hasAttribute('controls')).toBe(true);
    expect(el?.hasAttribute('loop')).toBe(true);
  });

  it('🔴 播放器一定要帶 title(報讀器對 iframe 只念得到 title),空標題退回 brand film', () => {
    // 突變實測補進來的:拿掉 title 時上面所有分流測試照樣全綠(設計稿 :1923 有這一行)。
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    play(container);
    expect(container.querySelector('iframe')?.getAttribute('title')).toBe(youtubeVideo.title);
    cleanup();
    const { container: blank } = render(<BrandPageMedia video={{ ...fileVideo, title: '' }} />);
    play(blank);
    expect(blank.querySelector('video')?.getAttribute('title')).toBe('brand film');
  });

  it('三個樣本兩兩互斥 —— 前提斷言,挑錯樣本上面幾條會互相蓋過去', () => {
    // 六格全列,不靠 BrandFilmPlayer 的 file→vimeo→youtube 分支序兜住(關卡2 nit)。
    expect(youtubeVideo.file).toBeUndefined();
    expect(youtubeVideo.vimeo).toBeUndefined();
    expect(vimeoVideo.file).toBeUndefined();
    expect(vimeoVideo.youtube).toBeUndefined();
    expect(fileVideo.youtube).toBeUndefined();
    expect(fileVideo.vimeo).toBeUndefined();
    // 自架片樣本必須是橫式,直式那條路由下面 portrait 那組單獨走
    expect(fileVideo.portrait).toBeUndefined();
    expect(videos.some((v) => v.file && v.portrait), '前提:直式自架片真的存在').toBe(true);
  });

  it('🔴 播放參數齊全 —— 少任何一個都是「點了封面卻沒動靜」而截圖看起來正常', () => {
    // 關卡2 nit:第一版對 autoPlay / allow / playsInline / mute / preload 零斷言,
    // 那五個突變全部存活。它們的共同症狀是「畫面對、行為不對」,真機驗也很容易漏看。
    const { container: v } = render(<BrandPageMedia video={fileVideo} />);
    play(v);
    const el = v.querySelector('video')!;
    expect(el.hasAttribute('autoplay'), '自架片點了不播 = 一格暫停畫面').toBe(true);
    // playsInline:iOS Safari 少了它會直接全螢幕接管,而桌機驗證完全看不到這個差別
    expect(el.hasAttribute('playsinline')).toBe(true);
    expect(el.getAttribute('preload')).toBe('metadata');
    // 設計稿的 muted 只跟著不存在的 mutedOnly 走 ⇒ 恆為 false(見元件註解偏離②)
    expect(el.hasAttribute('muted')).toBe(false);
    cleanup();

    const { container: y } = render(<BrandPageMedia video={youtubeVideo} />);
    play(y);
    const frame = y.querySelector('iframe')!;
    // allow 少了 autoplay ⇒ 點了封面得到一格靜止畫面(6 家 YouTube 全中)
    expect(frame.getAttribute('allow')).toContain('autoplay');
    expect(frame.hasAttribute('allowfullscreen')).toBe(true);
    // mute=1 會讓「按封面才有聲音」這個設計整個失效
    expect(frame.getAttribute('src')).toContain('mute=0');
    cleanup();

    const { container: vi_ } = render(<BrandPageMedia video={vimeoVideo} />);
    play(vi_);
    const vf = vi_.querySelector('iframe')!;
    expect(vf.getAttribute('allow')).toContain('autoplay');
    expect(vf.hasAttribute('allowfullscreen')).toBe(true);
    // dnt=1 = 不讓 Vimeo 追蹤我們的客人;autoplay=1 同上
    expect(vf.getAttribute('src')).toContain('dnt=1');
    expect(vf.getAttribute('src')).toContain('autoplay=1');
  });
});

describe('🔴 BrandPageMedia · 播放器被擋下的退路', () => {
  it('iframe 4 秒內沒 load → 換成說明 + 外開連結', () => {
    vi.useFakeTimers();
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    play(container);
    expect(container.querySelector('.bp-film-blocked')).toBeNull();
    act(() => { vi.advanceTimersByTime(4000); });
    const note = container.querySelector('.bp-film-blocked');
    expect(note).not.toBeNull();
    expect(container.querySelector('iframe'), '被擋下時舊的 iframe 要移掉').toBeNull();
    expect(note?.querySelector('a')?.getAttribute('href'))
      .toBe(`https://www.youtube.com/watch?v=${youtubeVideo.youtube}`);
  });

  it('iframe 有 load → 4 秒後仍是影片,不得跳退路', () => {
    // 🔴 沒有這條反面,上面那條在「永遠顯示退路」的壞實作下照樣綠。
    vi.useFakeTimers();
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    play(container);
    fireEvent.load(container.querySelector('iframe')!);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(container.querySelector('.bp-film-blocked')).toBeNull();
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('🔴 自架 <video> 不掛 4 秒偵測(載得慢不等於被擋下)', () => {
    vi.useFakeTimers();
    const { container } = render(<BrandPageMedia video={fileVideo} />);
    play(container);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(container.querySelector('.bp-film-blocked')).toBeNull();
    expect(container.querySelector('video')).not.toBeNull();
  });
});

describe('BrandPageMedia · 圖說與外開連結', () => {
  it('caption 走資料、是純文字', () => {
    const { container } = render(<BrandPageMedia video={youtubeVideo} />);
    expect(container.querySelector('.bp-media-cap span')?.textContent).toBe(youtubeVideo.caption);
  });

  it('🔴 連結優先序 = source → vimeo → youtube(4 家自架片全靠第一順位)', () => {
    const cases: Array<[BrandVideo, string, string]> = [
      [fileVideo, fileVideo.source!, fileVideo.sourceLabel!],
      [vimeoVideo, `https://vimeo.com/${vimeoVideo.vimeo}`, '在 Vimeo 開啟'],
      [youtubeVideo, `https://www.youtube.com/watch?v=${youtubeVideo.youtube}`, '在 YouTube 開啟'],
    ];
    for (const [video, href, label] of cases) {
      const { container } = render(<BrandPageMedia video={video} />);
      const a = container.querySelector('.bp-media-cap a');
      expect(a?.getAttribute('href'), label).toBe(href);
      expect(a?.textContent).toBe(label);
      expect(a?.getAttribute('target')).toBe('_blank');
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a?.getAttribute('aria-label')).toBe(`${label}(另開新分頁)`);
      cleanup();
    }
  });

  it('sourceLabel 省略時退回「看原始貼文」', () => {
    // 實測 4 家 source 都自帶 label ⇒ 這條路真資料不可達,判別力由這個 fixture 提供。
    const video: BrandVideo = { ...fileVideo, sourceLabel: undefined };
    const { container } = render(<BrandPageMedia video={video} />);
    expect(container.querySelector('.bp-media-cap a')?.textContent).toBe('看原始貼文');
  });

  it('🔴 三種來源都沒有 → 連結整個不建(不是印一個 ?v=undefined 的死連結)', () => {
    // 設計稿 :1890 的 else 分支無條件組 youtube watch 網址;真資料 12 家都有來源
    // ⇒ 不可達,判別力同樣由 fixture 提供。圖說本身仍要在(space-between 的左格)。
    const video: BrandVideo = {
      poster: fileVideo.poster, title: '無來源', caption: '無來源',
    };
    const { container } = render(<BrandPageMedia video={video} />);
    expect(container.querySelector('.bp-media-cap a')).toBeNull();
    expect(container.querySelector('.bp-media-cap span')?.textContent).toBe('無來源');
  });
});

describe('BrandPageMedia · 直式影片', () => {
  it('portrait → 框掛 is-portrait;非 portrait 不得掛', () => {
    const { container: p } = render(
      <BrandPageMedia video={{ ...youtubeVideo, portrait: true }} />,
    );
    expect(p.querySelector('.bp-film-frame')?.classList.contains('is-portrait')).toBe(true);
    cleanup();
    const { container: l } = render(<BrandPageMedia video={youtubeVideo} />);
    expect(l.querySelector('.bp-film-frame')?.classList.contains('is-portrait')).toBe(false);
  });

  it('播放後 is-portrait 與 is-playing 並存(9:16 靠兩個 class 一起選)', () => {
    // 只留其中一個 ⇒ CSS 的 `.is-portrait.is-playing` 選不到,直式片會展成 16:9 被裁掉上下。
    const { container } = render(<BrandPageMedia video={{ ...fileVideo, portrait: true }} />);
    play(container);
    const cls = container.querySelector('.bp-film-frame')?.classList;
    expect(cls?.contains('is-portrait')).toBe(true);
    expect(cls?.contains('is-playing')).toBe(true);
  });
});

describe('BrandPageMedia · 12 家實資料', () => {
  it('每家都渲染得出封面 + 圖說,且封面圖路徑指得到資產', () => {
    expect(videos.length, '前提:實測 12 家有影片').toBe(12);
    for (const video of videos) {
      const { container } = render(<BrandPageMedia video={video} />);
      expect(container.querySelector('.bp-film-poster img')?.getAttribute('src'), video.title)
        .toBe(`/brand-assets/${video.poster}`);
      expect(container.querySelector('.bp-media-cap a'), video.title).not.toBeNull();
      cleanup();
    }
  });
});

// ── #311 標題階層(關卡2 R2 補):本區在 About 右欄裡,**不得帶任何標題元素** ──────
// 12 家走這條分流。整頁大綱的不變式清單見 `BrandPageHeader.test.tsx` 檔尾那段。
describe('BrandPageMedia · 標題階層(#311)', () => {
  it('🔴 不得出現任何標題元素(未播 / 播放中 / 退路面板三態都要)', () => {
    for (const [name, node] of [
      ['未播', <BrandPageMedia video={fileVideo} />],
      ['直式', <BrandPageMedia video={{ ...fileVideo, portrait: true }} />],
    ] as const) {
      const { container } = render(node);
      expect(
        container.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        `${name}:圖說要用 <span>/<p>,不能順手升級成標題`,
      ).toBe(0);
      cleanup();
    }
  });
});
