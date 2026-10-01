// home-banner-social.ts — 首頁大圖草稿的 FB / IG 文字與紅字判斷(每日自動新品草稿片 4, 2026-10-01)。
// 紅字規則只有一份, 在 packages/domain(checkSocialCopy / checkBannerCopy);這裡只把結果轉成畫面要講的話。

import { checkBannerCopy, checkSocialCopy, type SocialCopyIssue } from '@pcm/domain';
import type { HomeBannerRow } from './home-banner-view';

/** 列表與面板上的「來源」字樣。 */
export function bannerSourceLabel(b: Pick<HomeBannerRow, 'sourceProductId' | 'sourceEmailId'>): string {
  if (b.sourceProductId !== null) return '每日新品';
  if (b.sourceEmailId !== null) return '廠商來信';
  return '手動新增';
}

/** FB / IG 一段文字:紅字清單, 以及複製 / 下載按不下去的理由(null = 可以按)。 */
export function socialTextState(
  text: string,
  brandNames: readonly string[],
): { issues: SocialCopyIssue[]; blockedWhy: string | null } {
  if (text.trim() === '') return { issues: [], blockedWhy: '還沒有文字' };
  const issues = checkSocialCopy(text, brandNames);
  return { issues, blockedWhy: issues.length > 0 ? '有紅字,改好才能複製或下載' : null };
}

/** 大圖的眉標、標題、副標、按鈕字的紅字(比 FB / IG 嚴, 保固一律不寫;同資料庫發布那一道)。 */
export function bannerTextIssues(fields: readonly (string | null | undefined)[]): SocialCopyIssue[] {
  return checkBannerCopy(fields);
}
