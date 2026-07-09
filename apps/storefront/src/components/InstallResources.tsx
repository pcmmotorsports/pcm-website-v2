// InstallResources.tsx — 安裝須知內的「安裝資源」區(說明書 PDF 下載 + 安裝影片)。
//
// #270 / Sean 2026-07-08 Q1/Q2/Q3=A:
// - 影片用 facade(縮圖 + 紅播放鈕、點擊才載 iframe → 省流量、不拖慢整頁)、桌機/手機同一 inline 換入。
// - PDF 用下載鈕(0-3 個)。
// - 皆 optional:兩者皆無 → 回 null 整區不渲染(不是每個商品都有影片 / 說明書)。
//   只有其一 → is-single 佔滿寬;兩者皆有 → 桌機左右並排、手機上下堆疊(見 product-page.css .pd-res-grid)。
// 🟢 #270 S2 已接線(2026-07-09):product.manuals / videoUrl 由 toUIProduct ← domain ← products.manuals/video_url
//   (來源報價單 pdf_urls/video_urls、rpm 同步管線)。有來源商品即顯、無資料不渲染(optional)。
//
// 從 ProductTabs.tsx 抽出成獨立檔(鐵則 6:ProductTabs 併入本區後 >400 行必拆)。
// 'use client' 必要:facade 播放 onClick → useState 換入 iframe。

'use client';

import { useState } from 'react';
import type { ProductManual } from '@/data/mock-products';

/**
 * 從 YouTube watch / youtu.be / embed / shorts URL 抽 videoId。
 * 抽不到、或字元不合 YouTube id 規則(僅 [A-Za-z0-9_-])→ 回 null(不渲染影片、防 query/path 夾帶)。
 */
function parseYoutubeId(url: string): string | null {
  let id: string | null = null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      id = u.pathname.split('/')[1] ?? null;
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v');
      } else {
        const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/);
        id = m ? (m[1] ?? null) : null;
      }
    }
  } catch {
    return null;
  }
  return id && /^[\w-]{6,}$/.test(id) ? id : null;
}

/** 檔案大小 KB → 顯示字串(≥1024 轉 MB 一位小數)。 */
function formatSize(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

export type InstallResourcesProps = { manuals?: ProductManual[]; videoUrl?: string };

export function InstallResources({ manuals, videoUrl }: InstallResourcesProps) {
  const [videoOpen, setVideoOpen] = useState(false);
  const videoId = videoUrl ? parseYoutubeId(videoUrl) : null;
  const hasVideo = videoId !== null;
  // http(s) 白名單:防未來 adapter 餵入 javascript: 等非法 scheme(React 不擋 href scheme)。
  const docs = (manuals ?? []).filter((m) => /^https?:\/\//i.test(m.url));
  const hasDocs = docs.length > 0;
  if (!hasVideo && !hasDocs) return null;

  return (
    <div className="pd-res">
      <div className="pd-res-eyebrow">安裝資源</div>
      <div className={`pd-res-grid${hasVideo && hasDocs ? '' : ' is-single'}`}>
        {hasVideo && (
          <div className="pd-res-video">
            {videoOpen ? (
              <iframe
                className="pd-res-frame"
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                title="安裝示範影片"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <button
                type="button"
                className="pd-res-facade"
                onClick={() => setVideoOpen(true)}
                aria-label="播放安裝示範影片"
              >
                {/* 外部 YouTube 縮圖(非站內資產)→ 用原生 img、不進 next/image 遠端白名單 */}
                <img
                  className="pd-res-thumb"
                  src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                  alt=""
                  loading="lazy"
                />
                <span className="pd-res-tag">影片</span>
                <span className="pd-res-play">
                  <span className="pd-res-tri" />
                </span>
                <span className="pd-res-vlabel">安裝示範影片</span>
              </button>
            )}
          </div>
        )}
        {hasDocs && (
          <div className="pd-res-docs">
            <div className="pd-res-docs-label">說明書 / 規格</div>
            {docs.map((m, i) => (
              <a
                key={i}
                className="pd-res-doc"
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                download
              >
                <span className="pd-res-doc-ic" aria-hidden="true" />
                <span className="pd-res-doc-tx">
                  <span className="pd-res-doc-n">{m.label}</span>
                  {typeof m.sizeKB === 'number' && (
                    <span className="pd-res-doc-s">PDF · {formatSize(m.sizeKB)}</span>
                  )}
                </span>
                <span className="pd-res-doc-dl" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
