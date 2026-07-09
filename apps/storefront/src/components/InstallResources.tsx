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
// 🟢 2026-07-10 混格式放寬(品牌放量 kickoff §2、報價單 INSTALL_RESOURCES_EMBED_GUIDE §4):影片欄是混格式——
//   youtube(Bonamici)/vimeo(Lightech·CNC)= iframe facade 點擊載入;.mp4 直檔(Evotech cdn.shopify/S3)
//   = <video controls preload="metadata" playsInline>。resolveVideo 三分流;Vimeo facade 無外部縮圖
//   (Vimeo 無免驗證縮圖端點、vumbnail 等第三方服務不引入)、用 facade 深色底 + 標籤。
//   🔴 與管線 scripts/rpm-transform.ts pickInstallVideo 家族(extractYoutubeId/extractVimeoId/isVideoFileUrl)
//   邏輯對齊,改一邊要同步另一邊。
//
// 'use client' 必要:facade 播放 onClick → useState 換入 iframe。

'use client';

import { useState } from 'react';
import type { ProductManual } from '@/data/mock-products';

/** 影片解析結果:youtube/vimeo=iframe facade、file=<video> 直播(混格式指南 §4 三分流)。 */
type ResolvedVideo =
  | { kind: 'youtube'; id: string }
  | { kind: 'vimeo'; id: string; hash: string | null }
  | { kind: 'file'; src: string };

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

/**
 * 從 Vimeo URL 抽數字 id(+unlisted privacy hash):vimeo.com/<id>[/<hash>] | player.vimeo.com/video/<id>[?h=<hash>]。
 * host 白名單(去 www.)+ http(s) 守衛;id 必純數字(擋 /channels/staffpicks 等非影片路徑)。
 * unlisted hash 一併帶出——embed 需附 ?h= 才有播放權限(code-reviewer R1:只取 id 會渲染 facade、點了報無權限)。
 */
function parseVimeo(url: string): { id: string; hash: string | null } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
    const segs = u.pathname.split('/').filter(Boolean);
    let id: string | null;
    let hash: string | null;
    if (host === 'player.vimeo.com') {
      id = segs[0] === 'video' ? (segs[1] ?? null) : null;
      hash = u.searchParams.get('h');
    } else {
      id = segs[0] ?? null;
      hash = segs[1] ?? null;
    }
    if (!id || !/^\d+$/.test(id)) return null;
    return { id, hash: hash && /^[a-z0-9]+$/i.test(hash) ? hash : null };
  } catch {
    return null;
  }
}

/**
 * 影片直檔判定:http(s) + pathname 副檔名白名單(query string 不干擾)。
 * 🔴 刻意窄於嵌入指南 §4「其餘一律視為 file」——任意網頁 URL 不當影片渲染(fail-closed);
 *    Evotech 實料為 cdn.shopify.com/videos/*.mp4 與 S3 .mp4、在名單內。
 */
const VIDEO_FILE_EXTS = ['.mp4', '.webm', '.m4v', '.mov'];
function parseVideoFileSrc(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const p = u.pathname.toLowerCase();
    return VIDEO_FILE_EXTS.some((ext) => p.endsWith(ext)) ? url : null;
  } catch {
    return null;
  }
}

/** 混格式三分流(指南 §4):youtube → vimeo → 直檔;全不中 → null(不渲染)。 */
function resolveVideo(url: string): ResolvedVideo | null {
  const yt = parseYoutubeId(url);
  if (yt) return { kind: 'youtube', id: yt };
  const vm = parseVimeo(url);
  if (vm) return { kind: 'vimeo', ...vm };
  const file = parseVideoFileSrc(url);
  if (file) return { kind: 'file', src: file };
  return null;
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
 * 是否有可渲染的安裝資源(可解析影片〔youtube/vimeo/直檔〕或 ≥1 個 http(s) 說明書)。
 * ProductTabs 用此決定安裝段版面:有→右側欄(sec-split-media);無→主文全寬。
 * 與元件本體 return null 條件同源、不會漂移。
 */
export function hasInstallResources(manuals?: ProductManual[], videoUrl?: string): boolean {
  const hasVideo = videoUrl ? resolveVideo(videoUrl) !== null : false;
  return hasVideo || validDocs(manuals).length > 0;
}

export type InstallResourcesProps = { manuals?: ProductManual[]; videoUrl?: string };

export function InstallResources({ manuals, videoUrl }: InstallResourcesProps) {
  const [videoOpen, setVideoOpen] = useState(false);
  const video = videoUrl ? resolveVideo(videoUrl) : null;
  const docs = validDocs(manuals);
  const hasDocs = docs.length > 0;
  if (!video && !hasDocs) return null;

  return (
    <div className="pd-panel pd-res">
      <div className="pd-panel-label">安裝資源</div>

      {/* 影片直檔(.mp4 等):原生 <video>、preload=metadata 輕量、無需 facade(指南 §4) */}
      {video?.kind === 'file' && (
        <video className="pd-res-video" src={video.src} controls preload="metadata" playsInline />
      )}

      {/* youtube / vimeo(大):側欄頂 16:9 facade;點擊才換入 iframe(省流量) */}
      {(video?.kind === 'youtube' || video?.kind === 'vimeo') &&
        (videoOpen ? (
          <iframe
            className="pd-res-frame"
            src={
              video.kind === 'youtube'
                ? `https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0`
                : `https://player.vimeo.com/video/${video.id}?autoplay=1${video.hash ? `&h=${video.hash}` : ''}`
            }
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
            {/* 外部 YouTube 縮圖(非站內資產)→ 用原生 img、不進 next/image 遠端白名單。
                Vimeo 無免驗證縮圖端點 → 無縮圖、靠 facade 深色底(第三方 vumbnail 不引入)。 */}
            {video.kind === 'youtube' && (
              <img
                className="pd-res-thumb"
                src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                alt=""
                loading="lazy"
              />
            )}
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
