// SoundClips.tsx — 排氣聲浪音檔清單(附件線片 3b-UI)。
//
// 🔴 **`pd-sound` 這個 class 在 storefront 的 CSS 裡【沒有任何規則】, 而【沒有人看過它】。**
//    2026-08-30 線G 開真瀏覽器分了那 14 個「死 class」——14 個裡我實測 7 個(全是假警報),
//    而這一個【走不到】:要有排氣聲浪檔的商品（probe 的種子資料沒有） ⇒ 標【未驗】。
//
// ⇒ **下一次有人為了任何理由走到這條動線時, 請順手看一眼它。**
//    🔴 「沒有規則」有四種解釋, 而只有第一種是問題:
//    ① 真的沒寫 CSS(可能真壞) ② 兄弟 class 撐著 ③ 完全沒有 CSS、靠父層版面
//    ④ 走 inline style ⇒ 它根本不需要 CSS 規則(而掃描器看不到 inline style)
//
// 🛑 **這句話刻意寫在這裡, 不是寫在一份清單裡** —— 一份「沒有人看過」的清單
//    若沒有人回頭讀它, 它會安靜地變成永久的。而你現在正在讀這支檔。
//    📎 兩份清單與判準見 `~/pcm-mailbox/線G-規格-死class守門兩份清單-20260830.md`。
// ⚠️ 讀碼看到它與 `pd-panel` 同掛 ⇒ 可能是兄弟撐著,而那是【讀來的、沒有量到】。
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
