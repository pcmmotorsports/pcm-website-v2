// sound-clip-title.ts — 排氣聲浪音檔標題的**顯示層**中文化。
//
// 🔴 Q25=A(Sean 2026-08-08 凌晨拍板):**DB 存英文原文不動,中文化在顯示層做**。
//    背景:E 全量盤 719 段實測 = 型別詞 **112 種**、260 段(36%)塞不進原本設想的三值、
//    硬壓會讓 14 群撞名 ⇒ 不在 importer 烤標籤進 jsonb(那是片 2 doc_type 遺失的同型錯誤),
//    改成可逆、可隨時升級的顯示層對照。
//
// 🔴 **絕不編造**:對照表沒命中的詞,**逐字顯示英文原文**。寧可讓客人看到英文,
//    也不能猜一個聽起來很像的中文 —— 排氣型號猜錯的代價與車種鐵律同類(客人買錯)。
//
// ⚠️ **本表是暫定的,上線前要拿真資料補**(D-321-A ②-2 明文要求)。
//    現況:片 3a 的 migration **尚未 apply**,我看不到真實的 112 種型別詞,
//    所以這裡只收**語意上明確、猜錯風險低**的詞:
//      · 「含/不含消音塞」這種功能描述 —— 客人真的需要看懂(影響能不能上路/音量)
//      · 材質詞 —— 對照唯一、無歧義
//    **刻意不翻產品線名**(Slip-On / Evolution / Racing 這些是 Akrapovič 的**產品線商標**,
//    台灣車友本來就講英文;翻成中文既不通用、也等於替原廠發明譯名 = 編造)。
//    ⇒ 命中率一定不高,那是**刻意的**:fallback 顯示英文原文是正確行為,不是缺陷。

/** 對照表:key 一律小寫、去頭尾空白後比對。value = 顯示用中文。 */
const TITLE_TERMS: Readonly<Record<string, string>> = {
  // 消音塞(功能性,影響音量與可否上路 —— 這是客人最需要看懂的一組)
  'with muffler insert': '含消音塞',
  'without muffler insert': '不含消音塞',
  'with db killer': '含消音塞',
  'without db killer': '不含消音塞',
  'with dbkiller': '含消音塞',
  'without dbkiller': '不含消音塞',
  // 原廠對照音(客人拿來 A/B 比較)
  stock: '原廠排氣',
  original: '原廠排氣',
  oem: '原廠排氣',
  'stock exhaust': '原廠排氣',
  // 材質(對照唯一、無歧義)
  titanium: '鈦合金',
  carbon: '碳纖維',
  'stainless steel': '不鏽鋼',
  inconel: 'Inconel 合金',
};

/** 分隔符:實測資料**逗號與分號並存**(E 全量盤),兩種都要切。 */
const SEPARATOR = /[,;]/;

/**
 * 把一段英文標題逐詞中文化。
 *
 * - 命中對照表 → 中文
 * - 沒命中 → **原文逐字保留**(絕不猜)
 * - `null` / 空白(實測約 4% 無標題)→ 回 `null`,由呼叫端決定顯示什麼
 *   (不在這裡回「未命名」之類的字面 —— 那是顯示決策,不是翻譯決策)
 */
export function localizeSoundClipTitle(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parts = trimmed
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (parts.length === 0) return null;

  const localized = parts.map((part) => TITLE_TERMS[part.toLowerCase()] ?? part);
  // 用「・」串接:中英混排時比逗號好斷,且不會與原文裡殘留的標點打架。
  return localized.join('・');
}

/** 對照表目前收了幾條 —— 給守門當「表被清空就紅」的前提斷言用。 */
export const SOUND_CLIP_TERM_COUNT = Object.keys(TITLE_TERMS).length;
