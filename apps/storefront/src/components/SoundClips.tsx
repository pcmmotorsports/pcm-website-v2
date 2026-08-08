// SoundClips.tsx — 排氣聲浪音檔清單(附件線片 3b-UI)。
//
// 資料形狀:`products.sound_clips jsonb [{ title: string|null, url: string }]`
//   · **僅 akrapovic 有值**(364 群、最多 6 段),其餘 14 家恆 `null`。
//   · 🔴 **`null` ≠ `[]`**:兩者都要當「沒有」處理,但它們在 DB 是不同的東西(活雷,見
//     memory `project_product-attachments-relocation-line`)。
//
// 🔴 **本元件不碰 DB、不 import adapter**(D-321-A ①):片 3a 的 migration **尚未 apply**、
//    `database.types.ts` 的型別也還沒補 `sound_clips`(已知滯後)。本片只做顯示層、收 typed props;
//    真正接線是 apply + 重 gen 之後的另一小片。
//
// 🔴 **禁 autoplay、禁 preload**:WAV 檔很大(合約 v5 明文)。`preload="none"` ⇒ 客人按了才下載。
//    這不是效能微調,是「開一頁商品頁不該吃掉幾十 MB 行動網路」。
//
// 空狀態:`null` / `[]` / 整欄缺 → **回 null、整區不渲染**(與 InstallResources 同一慣例:
//    六家零附件不得在頁面上留一個空面板)。

import { localizeSoundClipTitle } from '@/lib/sound-clip-title';

/** 與 `products.sound_clips` jsonb 的元素逐欄對齊(顯示層自持型別,不 import adapter)。 */
export type SoundClip = {
  title: string | null;
  url: string;
};

export type SoundClipsProps = {
  /** `null` / `undefined` / `[]` 皆視為「沒有音檔」⇒ 整區不渲染。 */
  clips: SoundClip[] | null | undefined;
};

export function SoundClips({ clips }: SoundClipsProps) {
  // 🔴 `null`(14 家)與 `[]`(akrapovic 但該群無音檔)在這裡收斂成同一個結果,
  //    但**判斷式不能寫成 `!clips.length`** —— 那會在 clips 是 null 時 throw。
  const list = (clips ?? []).filter((c) => typeof c?.url === 'string' && c.url !== '');
  if (list.length === 0) return null;

  return (
    <div className="pd-panel pd-sound">
      <div className="pd-panel-label">排氣聲浪</div>
      <ul className="pd-sound-list">
        {list.map((clip, i) => {
          const zh = localizeSoundClipTitle(clip.title);
          return (
            <li className="pd-sound-item" key={`${clip.url}-${i}`}>
              {/* 🔴 無標題(實測約 4%)不編一個假名字,也不留空 —— 用序號當可辨識標籤。
                  序號是**畫面上的順序**,不宣稱它有任何資料意義。 */}
              <span className="pd-sound-title">{zh ?? `音檔 ${i + 1}`}</span>
              {/* 🔴 preload="none":WAV 大,按了才下載。autoplay 一律不加。 */}
              <audio className="pd-sound-audio" src={clip.url} controls preload="none" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
