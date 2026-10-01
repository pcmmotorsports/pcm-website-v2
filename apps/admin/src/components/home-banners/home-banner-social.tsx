'use client';

import { useState } from 'react';
import { saveHomeBannerSocialAction } from '../../lib/home-banners/home-banner-actions';
import { HB_FIELD, HB_SOCIAL_MAX } from '../../lib/home-banners/home-banner-constants';
import { socialTextState } from '../../lib/home-banners/home-banner-social';
import type { HomeBannerRow } from '../../lib/home-banners/home-banner-view';

// home-banner-social.tsx — 首頁大圖面板裡的「FB / IG 貼文」區塊(每日自動新品草稿片 4, 2026-10-01)。
// 放在編輯面板【同一個 form】裡, 用自己的 formAction 存檔(不能在 form 裡再包 form)。
// 🔴 不在大圖的 <fieldset disabled> 裡:已發布的大圖, 貼文文字照樣可以改(那不是首頁上的內容)。封存的不畫。
// 🔴 有紅字 ⇒ 複製與下載都按不下去(Sean 2026-10-01:標紅不能發)。按鈕停用不是安全邊界, 只是擋手滑;
//    FB / IG 目前是小編自己貼, 系統沒有替他發。

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

async function downloadImage(url: string, baseName: string): Promise<'saved' | 'opened' | 'blocked'> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${baseName}.${EXT[blob.type] ?? 'jpg'}`;
    a.click();
    // 馬上收回會讓部分瀏覽器取消下載 ⇒ 晚一點再收
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return 'saved';
  } catch {
    // 圖放在別的網站、不讓瀏覽器直接下載 ⇒ 開新分頁讓他自己另存;瀏覽器擋新分頁時照實說
    return window.open(url, '_blank', 'noopener') === null ? 'blocked' : 'opened';
  }
}

function SocialBox({
  label,
  name,
  value,
  onChange,
  brandNames,
  imageUrl,
  baseName,
}: {
  label: 'FB' | 'IG';
  name: string;
  value: string;
  onChange: (v: string) => void;
  brandNames: readonly string[];
  imageUrl: string | null;
  baseName: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const { issues, blockedWhy } = socialTextState(value, brandNames);
  return (
    <div className='hb-social-box' data-testid={`hb-social-${label.toLowerCase()}`}>
      <label className='f full'>{label} 貼文文字
        <textarea name={name} value={value} onChange={(e) => onChange(e.target.value)} maxLength={HB_SOCIAL_MAX} rows={8} />
        <span className='hint'>{[...value].length} / {HB_SOCIAL_MAX}</span>
      </label>
      {issues.length > 0 ? (
        <ul className='hb-red' role='status' data-testid={`hb-social-${label.toLowerCase()}-red`}>
          {issues.map((i) => <li key={`${i.code}-${i.word}`}>{i.message}</li>)}
        </ul>
      ) : null}
      <div className='hb-social-act'>
        <button
          type='button'
          className='hb-btn'
          disabled={blockedWhy !== null}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setNote(`已複製 ${label} 文字,可以貼到 ${label} 了。`);
            } catch {
              setNote('瀏覽器不讓複製,請把上面的文字全選後自己複製。');
            }
          }}
        >
          複製 {label} 文字
        </button>
        <button
          type='button'
          className='hb-btn'
          disabled={blockedWhy !== null || !imageUrl}
          onClick={async () => {
            if (!imageUrl) return;
            const r = await downloadImage(imageUrl, baseName);
            setNote(
              r === 'saved' ? '圖片已下載。'
              : r === 'opened' ? '圖片已在新分頁開啟,請在圖上按右鍵另存。'
              : '瀏覽器擋下了新分頁,請點上方預覽的圖片另存,或允許這個網站開新分頁。',
            );
          }}
        >
          下載圖片
        </button>
        {blockedWhy !== null ? <span className='why'>{blockedWhy}</span> : !imageUrl ? <span className='why'>這張沒有桌機圖,沒有圖可以下載</span> : null}
        {note !== null ? <span className='hint' role='status'>{note}</span> : null}
      </div>
    </div>
  );
}

export function HomeBannerSocial({ banner }: { banner: HomeBannerRow }) {
  const [fb, setFb] = useState(banner.fbText ?? '');
  const [ig, setIg] = useState(banner.igText ?? '');
  // 資料庫存檔會去掉頭尾空白 ⇒ 比對也去掉, 不然存完還一直顯示「有改動還沒存」(R1 建議 2)
  // 資料庫的 btrim 只去空格、不去換行 ⇒ 兩邊都 trim 再比(R2 建議 1)
  const dirty = fb.trim() !== (banner.fbText ?? '').trim() || ig.trim() !== (banner.igText ?? '').trim();
  // 品牌名開頭的原廠保固放行(主視窗 2026-10-01 Q1 甲):用來源商品的品牌名, 手動新增的不放行(R1 必修 1)
  const brandNames = banner.sourceBrandName ? [banner.sourceBrandName] : [];
  const baseName = `pcm-${banner.id.slice(0, 8)}`;
  return (
    <div className='sec hb-social' data-testid='hb-social'>
      <h4>FB / IG 貼文</h4>
      <p className='hint'>
        確認文字沒有紅字後,按「複製 FB 文字」或「複製 IG 文字」貼到平台,再按「下載圖片」取得圖片。
        網址結尾的來源參數請保留。系統不會替你發文。
      </p>
      <SocialBox label='FB' name={HB_FIELD.fbText} value={fb} onChange={setFb} brandNames={brandNames} imageUrl={banner.imageDesktopUrl} baseName={baseName} />
      <SocialBox label='IG' name={HB_FIELD.igText} value={ig} onChange={setIg} brandNames={brandNames} imageUrl={banner.imageDesktopUrl} baseName={baseName} />
      <div className='hb-social-act'>
        <button type='submit' formAction={saveHomeBannerSocialAction} className='hb-btn' disabled={!dirty} data-testid='hb-social-save'>
          儲存 FB / IG 文字
        </button>
        {dirty ? <span className='why'>FB / IG 文字有改動還沒存</span> : null}
      </div>
    </div>
  );
}
