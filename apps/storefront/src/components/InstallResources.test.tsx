// @vitest-environment jsdom
//
// InstallResources 混格式影片測試 — youtube/vimeo(iframe facade)+ .mp4 直檔(<video>)三分流
// (2026-07-10 品牌放量 kickoff §2、報價單 INSTALL_RESOURCES_EMBED_GUIDE §4/§5 驗收案例的 fixture 層)。
// 與 scripts/rpm-transform.test.ts pickInstallVideo 系列成對:管線挑得出的 URL、UI 必渲染得出來。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { InstallResources, hasInstallResources } from './InstallResources';

afterEach(cleanup);

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/123456';
const MP4 = 'https://cdn.shopify.com/videos/c/o/v/abc123.mp4';
const DOCS = [{ label: '安裝說明書', url: 'https://x.com/a.pdf' }];

describe('hasInstallResources(混格式)', () => {
  it('youtube / vimeo / mp4 任一可解析 → true', () => {
    expect(hasInstallResources(undefined, YT)).toBe(true);
    expect(hasInstallResources(undefined, VIMEO)).toBe(true);
    expect(hasInstallResources(undefined, MP4)).toBe(true);
  });
  it('影片不可解析(網頁 URL / 非 http scheme)且無說明書 → false', () => {
    expect(hasInstallResources(undefined, 'https://example.com/page.html')).toBe(false);
    expect(hasInstallResources(undefined, 'javascript://vimeo.com/123456')).toBe(false);
    expect(hasInstallResources([], undefined)).toBe(false);
  });
  it('影片不可解析但有 http(s) 說明書 → true(說明書獨立成立)', () => {
    expect(hasInstallResources(DOCS, 'https://example.com/page.html')).toBe(true);
  });
});

describe('InstallResources(三型渲染)', () => {
  it('YouTube:facade 帶 i.ytimg 縮圖 → 點擊換入 youtube embed iframe', () => {
    render(<InstallResources videoUrl={YT} />);
    const thumb = document.querySelector('img.pd-res-thumb');
    expect(thumb?.getAttribute('src')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    fireEvent.click(screen.getByRole('button', { name: '播放安裝示範影片' }));
    const frame = document.querySelector('iframe.pd-res-frame');
    expect(frame?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
  });

  it('Vimeo:facade 無外部縮圖(深色底)→ 點擊換入 player.vimeo.com iframe', () => {
    render(<InstallResources videoUrl={VIMEO} />);
    expect(document.querySelector('img.pd-res-thumb')).toBeNull(); // Vimeo 無免驗證縮圖端點
    fireEvent.click(screen.getByRole('button', { name: '播放安裝示範影片' }));
    const frame = document.querySelector('iframe.pd-res-frame');
    expect(frame?.getAttribute('src')).toBe('https://player.vimeo.com/video/123456?autoplay=1');
  });

  it('mp4 直檔:直接渲染 <video controls playsInline preload=metadata>、無 facade', () => {
    render(<InstallResources videoUrl={MP4} />);
    const video = document.querySelector('video.pd-res-video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe(MP4);
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.hasAttribute('playsinline')).toBe(true);
    expect(screen.queryByRole('button', { name: '播放安裝示範影片' })).toBeNull();
  });

  it('影片不可解析且無說明書 → 整區 null 不渲染(指南 §5 案例 4)', () => {
    const { container } = render(<InstallResources videoUrl="https://example.com/page.html" />);
    expect(container.firstChild).toBeNull();
  });

  it('說明書 chip 照常渲染、javascript: URL 被濾掉', () => {
    render(
      <InstallResources
        manuals={[...DOCS, { label: '偽裝', url: 'javascript:alert(1)' }]}
        videoUrl={undefined}
      />,
    );
    expect(screen.getByText('安裝說明書')).toBeDefined();
    expect(screen.queryByText('偽裝')).toBeNull();
    expect(document.querySelectorAll('.pd-ir-doc-sm').length).toBe(1);
  });
});
