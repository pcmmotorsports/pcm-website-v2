// BrandPageMedia.tsx — 品牌介紹頁 About 右欄的官方影片(D2c-2;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1395-1408、組裝與掛載邏輯 :1862-1956、CSS :977-1037 與 :1055-1072)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// 🔴 **點了才掛播放器**(設計稿 :1951-1955 逐字):沒按過封面就完全不建 iframe、
//    不對 YouTube / Vimeo 送任何請求。這不是效能優化,是設計稿記載的行為修正 ——
//    2026-08-02 Sean 回報「youtube 影片在我們這個畫面點不開」,自動掛 iframe 在
//    擋第三方框架的環境下會蓋掉本地封面變全黑。封面圖是本站資產,一定顯示得出來。
//
// 實測 12 家有影片:youtube 6 / file 5 / vimeo 1;其中 4 家 portrait(cnc-racing /
// front3d / lightech / materya)。四種來源分流的判別力**不是**由真資料提供 —— vimeo 只有一家、
// `mutedOnly` 零家(見下方註解)—— 由測試的合成 fixture 提供。
//
// 🔴 對設計稿字面的四處偏離(逐條理由寫在對應位置,這裡只列清單):
//   ① `watchLink()` 三種來源全無時回 null(設計稿 :1890 會組出 `?v=undefined` 的死連結)
//   ② `mutedOnly` 未實作 —— 20 家資料零出現、D1a 的型別也沒這欄,`!!undefined` 恆 false
//   ③ 退路面板的連結用 `rel="noopener noreferrer"`,設計稿 :1945 只有 `noopener`
//      (與同檔圖說連結 :1406 的寫法對齊;noreferrer 只多擋一個 referrer 外洩,不改行為)
//   ④ 影片 id 過 `encodeURIComponent`(設計稿只在 watch 網址用、embed 網址沒用);
//      對 12 家的合法 id 是 identity,純粹讓「哪天有人貼進奇怪字元」不會拼出壞網址
// (CSS 側另有兩處,寫在 `styles/brand-page.css`:`.bp-film-cap` 死規則未搬、
//  播放鈕的 `:focus-visible` 負 offset。)

'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrandVideo } from '@/data/brand-content-types';
import { brandAsset } from '@/lib/brand-asset';
import '@/styles/brand-page.css';

/** 播放器載不出來的判定窗(設計稿 :1948 的 4000ms)。 */
const BLOCKED_TIMEOUT_MS = 4000;

/**
 * 圖說右邊的外開連結(設計稿 :1882-1894)。
 *
 * 🔴 設計稿的 else 分支無條件用 `brand.video.youtube` 組 watch 網址 ——
 *    三種來源都沒有的資料會生出 `?v=undefined` 的死連結。實測 12 家都有來源
 *    ⇒ 那條路不可達;這裡回 `null` 讓連結整個不建(= 設計稿骨架 :1406 的 `hidden` 初始態),
 *    而不是把死連結印給客人。這是補設計稿的邊界、不是改它的行為。
 */
function watchLink(video: BrandVideo): { href: string; label: string } | null {
  if (video.source) return { href: video.source, label: video.sourceLabel ?? '看原始貼文' };
  if (video.vimeo) return { href: `https://vimeo.com/${video.vimeo}`, label: '在 Vimeo 開啟' };
  if (video.youtube) {
    return {
      href: `https://www.youtube.com/watch?v=${encodeURIComponent(video.youtube)}`,
      label: '在 YouTube 開啟',
    };
  }
  return null;
}

export function BrandPageMedia({ video }: { video: BrandVideo }) {
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // ref 而不是 state:load 只是「還活著」的訊號,不需要重畫。
  const loaded = useRef(false);

  // ⚠️ OD 預覽 / 部分沙箱 / 客人的網路或擴充套件會擋掉第三方 iframe,結果是一塊全黑而且
  //    沒有任何提示。iframe 的 load 事件跨網域仍會觸發 ⇒ 拿它當存活訊號,4 秒內沒 load
  //    就換成說明 + 外開連結(設計稿 :1928-1949;文案是中性說法,客人真的看得到)。
  //    🔴 自架 mp4 不走這條:`<video>` 沒有跨網域框架的問題,掛這個計時器只會讓
  //       載得慢的影片被誤判成被擋。設計稿的存活偵測也只包在 `el.tagName === 'IFRAME'` 裡。
  const isIframe = !video.file;
  useEffect(() => {
    if (!playing || !isIframe) return;
    const timer = setTimeout(() => {
      if (!loaded.current) setBlocked(true);
    }, BLOCKED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [playing, isIframe]);

  const link = watchLink(video);
  const frameClass = [
    'bp-film-frame',
    video.portrait ? 'is-portrait' : '',
    playing ? 'is-playing' : '',
  ].filter(Boolean).join(' ');
  // 設計稿 :1923:標題掛在播放器元素上(報讀器對 iframe 只念得到 title)。
  const playerTitle = video.title || 'brand film';

  return (
    <aside className="bp-media">
      <div className={frameClass}>
        {blocked ? (
          <div className="bp-film-blocked">
            <p>影片載不出來,可能是網路或瀏覽器擋下了播放器。</p>
            {/* 出處與圖說那個連結同一組來源優先序(設計稿 :1939-1941 與 :1883-1891
                逐字相同),所以直接共用。
                ⚠️ 這裡**不能**宣稱「一定有連結」:`isIframe = !video.file`,所以三種來源
                   全空的資料也會走 iframe 這條、而 watchLink() 對它回 null ⇒ 退路面板只剩
                   一行文案、沒有出口。那是 watchLink 的 null 分支自己造出來的形狀
                   (真資料 12 家皆有來源 ⇒ 不可達;判別力由測試 fixture 提供)。 */}
            {link && (
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                在新分頁開啟影片 →
              </a>
            )}
          </div>
        ) : playing ? (
          <BrandFilmPlayer video={video} title={playerTitle} onLoad={() => { loaded.current = true; }} />
        ) : (
          // 圖本身是裝飾(按鈕才是操作對象)⇒ alt="",名稱掛在按鈕上並講明「播放」,
          // 否則報讀器只會念出影片標題、聽不出這是可以按的(設計稿 :1871-1874)。
          // ⚠️ 按下去之後這個按鈕整個消失,React 不轉移焦點 ⇒ 鍵盤使用者焦點掉回 <body>。
          //    設計稿 :1926 的 poster.remove() 同樣如此,屬繼承;修法要新增設計稿沒有的行為
          //    = 鐵則 1 拍板路徑 ⇒ **backlog #309**。(焦點框被裁那條已在本片修掉,見 CSS。)
          <button
            type="button"
            className="bp-film-poster"
            aria-label={`播放影片:${video.title || '品牌影片'}`}
            onClick={() => setPlaying(true)}
          >
            <img src={brandAsset(video.poster)} alt="" />
            <span className="bp-film-play" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      {/* 圖說永遠建(即使 caption 空字串):`.bp-media-cap` 是 space-between,
          少了左邊那格連結會跑到左側。設計稿骨架 :1404-1407 同樣是兩格都在。 */}
      <div className="bp-media-cap">
        <span>{video.caption}</span>
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${link.label}(另開新分頁)`}
          >
            {link.label}
          </a>
        )}
      </div>
    </aside>
  );
}

/** 播放器本體:自架 mp4 / Vimeo / YouTube 三選一(設計稿 :1901-1922)。 */
function BrandFilmPlayer({
  video,
  title,
  onLoad,
}: {
  video: BrandVideo;
  title: string;
  onLoad: () => void;
}) {
  if (video.file) {
    // 自架檔案:不經第三方,擋掉第三方框架的環境也放得動。
    // 🔴 設計稿寫 `el.muted = !!brand.video.mutedOnly`,而 `mutedOnly` 在 20 家資料裡
    //    **零次出現**(D1a 的型別是求值量出來的,所以也沒有這個欄位)⇒ `!!undefined`
    //    恆為 false ⇒ 這裡不設 muted 與設計稿等價。
    // 🔴🔴 **原註解寫「掛載必定發生在點擊之後(同一個手勢鏈)⇒ 自動播有聲不會被拒」——
    //    那句對 iOS Safari 是錯的**(2026-08-04 / D2f 關卡2 R3 更正;backlog #320)。
    //    WebKit 官方逐字要求 `play()` 必須 **directly** 由手勢處理器觸發 = **同步**;
    //    而這裡是 `setPlaying(true)` → React 重繪 → `<video>` 才進 DOM,晚於手勢。
    //    ⇒ iOS 上可能靜音播放或不播。桌機 Chromium 實測有聲(`muted=false` +
    //      `webkitAudioDecodedByteCount>0`)**證不了 iOS**,兩者政策不同。
    //    影響 5 家自架片品牌,不只 materya。修法與真機驗證在 #320。
    return (
      <video
        src={brandAsset(video.file)}
        title={title}
        controls
        loop
        autoPlay
        playsInline
        preload="metadata"
      />
    );
  }
  if (video.vimeo) {
    const query =
      `h=${encodeURIComponent(video.vimeoHash ?? '')}` +
      '&autoplay=1&loop=1&title=0&byline=0&portrait=0&dnt=1';
    return (
      <iframe
        src={`https://player.vimeo.com/video/${encodeURIComponent(video.vimeo)}?${query}`}
        title={title}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        onLoad={onLoad}
      />
    );
  }
  // youtube-nocookie:同設計稿 :1919。`loop` 需要 `playlist=` 指向自己;
  // `controls` 留著(不寫 controls=0),客人才有辦法開聲音。
  const id = encodeURIComponent(video.youtube ?? '');
  const query = `autoplay=1&mute=0&loop=1&playlist=${id}&modestbranding=1&rel=0&playsinline=1`;
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${id}?${query}`}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      onLoad={onLoad}
    />
  );
}
