// 選車草稿被出口丟棄時的提示文案(Sean 2026-08-07 拍板 Q22=A「照樣讓他走、走完講一聲」)。
// 🔴 單一來源:**目前 2 個消費端共用**這一支(`MobileVehicleSheet` 套用 / `CartVehicleField`
//    的四個離開編輯態出口),不得各自寫一句 —— 同族前例 `VEHICLE_EMPTY_HINTS`(VehicleSelect.tsx)
//    就是因為四句零命中文案逐檔硬編、分佈連錯兩次才收成常數的。
//    ⚠️ PDP(`ProductFitmentCheck`)目前**不是**消費端 —— 但**理由已經過期,別照抄**:
//    🔴 債⑥ 當初(2026-08-08 凌晨)撤回的依據是「年份欄從未啟用 ⇒ 那層不可能有草稿」。
//    **同日稍晚的 Q27 片(qualified 態回填 + 年份欄解鎖)把那個前提證偽了** ⇒ 客人現在可以在
//    年份欄打字不選,而任何一次 `commit`(選車型 / 套愛車)都會卸載 picker、那串字無聲消失。
//    ⇒ **債⑥ 復活、待重排**;撤回的推理鏈與這次證偽都記在 manifest 的 blurDraftRetentionAndEmptyHint。
// ⚠️ 全形逗號 `，` 沿站上既有慣例(Sean 2026-08-03 拍 Q2=A:照正式站現顯示)。

/** 三層選車欄位。順序即提示裡的排列順序(廠牌 → 車型 → 年份)。 */
export type VehicleDraftField = 'brand' | 'model' | 'year';

const FIELD_LABEL: Record<VehicleDraftField, string> = {
  brand: '廠牌',
  model: '車型',
  year: '年份',
};

const FIELD_ORDER: readonly VehicleDraftField[] = ['brand', 'model', 'year'];

/** 一層的草稿:`text` 是客人打了但沒選中的字。空字串/全空白 = 沒有草稿。 */
export type VehicleDraftTexts = Partial<Record<VehicleDraftField, string>>;

/**
 * 把「被丟棄的草稿」組成一句提示;沒有任何草稿 → `null`(呼叫端據此決定不渲染)。
 * 🔴 回 `null` 而不是空字串:空字串在 JSX 裡是 falsy 但仍是合法 children,
 *    呼叫端若寫 `{msg && <p>{msg}</p>}` 兩者行為同、寫 `{<p>{msg}</p>}` 就會畫出空框。
 *    用 `null` 讓「沒有提示」這件事在型別上就明確。
 */
export function formatSkippedDraftNotice(drafts: VehicleDraftTexts): string | null {
  const parts = FIELD_ORDER.filter((f) => (drafts[f] ?? '').trim() !== '').map(
    (f) => `「${(drafts[f] as string).trim()}」沒有對應到${FIELD_LABEL[f]}`,
  );
  if (parts.length === 0) return null;
  return `${parts.join('、')}，已略過`;
}
