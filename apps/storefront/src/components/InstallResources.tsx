// InstallResources.tsx — 安裝須知側欄的「安裝資源」面板(安裝影片大 + 說明書 PDF 小 chip)。
//
// #270 / Sean 2026-07-08 Q1/Q2/Q3=A + 2026-07-09 中段 B 收合改良:
// - 影片用 facade(縮圖 + 紅播放鈕、點擊才載 iframe → 省流量、不拖慢整頁)、桌機/手機同一 inline 換入。
// - 中段 B 版面(Sean 2026-07-09 拍板「影片欄位大、說明書等下載按鈕小」):影片置側欄頂、16:9 大尺寸;
//   說明書 PDF 改「小型下載 chip」列(不再與影片左右並排)。整塊坐落於安裝段右側欄 .pd-panel。
// - 皆 optional:兩者皆無 → 回 null 整區不渲染(hasInstallResources 同一判準、ProductTabs 據此決定
//   安裝段是否排側欄:有資源→sec-split-media 兩欄;無資源→主文全寬)。
// 🟢 #270 S2 已接線(2026-07-09):product.manuals / videoUrl 由 toUIProduct ← domain ← products.manuals/video_url
//   (來源報價單 pdf_urls/video_urls、rpm 同步管線)。有來源商品即顯、無資料不渲染(optional)。
//
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

/** http(s) 白名單:防未來 adapter 餵入 javascript: 等非法 scheme(React 不擋 href scheme)。 */
function validDocs(manuals?: ProductManual[]): ProductManual[] {
  return (manuals ?? []).filter((m) => /^https?:\/\//i.test(m.url));
}

/**
 * 是否有可渲染的安裝資源(有效 YouTube 影片 或 ≥1 個 http(s) 說明書)。
 * ProductTabs 用此決定安裝段版面:有→右側欄(sec-split-media);無→主文全寬。
 * 與元件本體 return null 條件同源、不會漂移。
 */
export function hasInstallResources(manuals?: ProductManual[], videoUrl?: string): boolean {
  const hasVideo = videoUrl ? parseYoutubeId(videoUrl) !== null : false;
  return hasVideo || validDocs(manuals).length > 0;
}

export type InstallResourcesProps = { manuals?: ProductManual[]; videoUrl?: string };

export function InstallResources({ manuals, videoUrl }: InstallResourcesProps) {
  const [videoOpen, setVideoOpen] = useState(false);
  const videoId = videoUrl ? parseYoutubeId(videoUrl) : null;
  const hasVideo = videoId !== null;
  const docs = validDocs(manuals);
  const hasDocs = docs.length > 0;
  if (!hasVideo && !hasDocs) return null;

  return (
    <div className="pd-panel pd-res">
      <div className="pd-panel-label">安裝資源</div>

      {/* 影片(大):側欄頂 16:9 facade;點擊才換入 iframe(省流量) */}
      {hasVideo &&
        (videoOpen ? (
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
        ))}

      {/* 說明書 PDF(小):影片下方小型下載 chip 列(Sean:下載按鈕小) */}
      {hasDocs && (
        <div className="pd-ir-docs-sm">
          {docs.map((m, i) => (
            <a
              key={i}
              className="pd-ir-doc-sm"
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              <span className="pd-ir-doc-n">{m.label}</span>
              {typeof m.sizeKB === 'number' && (
                <span className="pd-ir-doc-s">PDF · {formatSize(m.sizeKB)}</span>
              )}
              <span className="pd-ir-doc-dl" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
