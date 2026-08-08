// dev-preview/sound-clips — 排氣聲浪音檔清單的預覽頁(附件線片 3b-UI)。
//
// 🔴 存在理由:片 3a 的 migration **尚未 apply**、真資料進不來,而 Sean 要看的是**畫面**。
//    ⇒ 用真實形狀的 fixtures 掛出來截圖(390 / 1280),與 `dev-preview/*` 既有慣例同款。
//    真正接進商品頁是 apply + 重 gen 型別之後的另一小片,不在本片。
//
// ⚠️ 這是 dev-preview,**不是**上線路徑;音檔 URL 是假的(cdn.example),按下去不會有聲音,
//    那是預期的 —— 這頁看的是版面與標題中文化,不是播放行為。

// 🔴 `product-page.css` **不在 layout 的全域清單裡**(它由商品頁自己載入)⇒ 預覽頁要自己 import,
//    否則 `.pd-panel` / `.pd-sound-*` 全部不生效、截圖出來會是沒有樣式的裸清單(第一版就是這樣拍的)。
//    同款做法在 `dev-preview/brands/page.tsx` 已有先例。
import '@/styles/product-page.css';
import { SoundClips, type SoundClip } from '@/components/SoundClips';

/** 真實形狀(合約 v5 + E 全量盤實測描述):多段 / 逗號分號並存 / 約 4% 無標題。 */
const FIXTURE: SoundClip[] = [
  { title: 'Stock', url: 'https://cdn.example/sound/stock.wav' },
  { title: 'Slip-On Line, with muffler insert', url: 'https://cdn.example/sound/slip-on-with.wav' },
  { title: 'Slip-On Line; without db killer', url: 'https://cdn.example/sound/slip-on-without.wav' },
  { title: 'Evolution Line (Titanium), with db killer', url: 'https://cdn.example/sound/evo-with.wav' },
  { title: 'Titanium; Racing Line', url: 'https://cdn.example/sound/racing.wav' },
  { title: null, url: 'https://cdn.example/sound/unnamed.wav' },
];

export default function SoundClipsPreviewPage() {
  return (
    // `.pd-page`:商品頁的 scope,`--f-mono` 等 token 定義在它底下 ⇒ 少了它眉標會換一張臉。
    <main className="pd-page" style={{ padding: '24px 16px', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>排氣聲浪音檔 — 預覽(fixtures)</h1>
      <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 20 }}>
        資料為假、URL 不可播放;本頁看的是版面與標題中文化。
      </p>

      <h2 style={{ fontSize: 14, margin: '20px 0 8px' }}>① 有音檔(六段;akrapovic 一群的上限)</h2>
      <SoundClips clips={FIXTURE} />

      <h2 style={{ fontSize: 14, margin: '28px 0 8px' }}>② 空陣列 → 整區不渲染(下方應該什麼都沒有)</h2>
      <SoundClips clips={[]} />

      <h2 style={{ fontSize: 14, margin: '28px 0 8px' }}>③ null(14 家)→ 整區不渲染</h2>
      <SoundClips clips={null} />

      <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 28 }}>
        ②③ 之間與之後沒有任何框線 = 空狀態正確(不留空面板)。
      </p>
    </main>
  );
}
