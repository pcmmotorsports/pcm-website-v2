// social-copy-rules.ts — 首頁大圖與 FB / IG 草稿的紅字檢查【唯一一份】(2026-10-01, 每日自動新品草稿片 1)
//
// 誰讀:建草稿的程式(packages/use-cases)、後台首頁大圖編輯畫面(標紅、擋發布與複製)、發布前檢查。
// 規則來源:Sean 2026-10-01 批准的計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md;
//   社群研究 ~/pcm-mailbox/社群研究-20261001/分析與建議.md 二之 5「自動產草稿前要先擋掉」。
// 🔴 放 packages/domain:後台、cron、之後的發布檢查都要讀同一份, 不要各抄一份。

export interface SocialCopyIssue {
  /** 機器用的分類 */
  code: 'stock_promise' | 'legal_claim' | 'quality_promise' | 'warranty_not_maker' | 'banner_blocked';
  /** 觸發的那幾個字 */
  word: string;
  /** 給員工看的說明:哪裡有問題、要怎麼改 */
  message: string;
}

const BLOCKED_WORDS: ReadonlyArray<{ word: string; code: SocialCopyIssue['code']; why: string }> = [
  { word: '現貨', code: 'stock_promise', why: '不寫庫存或出貨承諾' },
  { word: '到貨', code: 'stock_promise', why: '不寫庫存或出貨承諾' },
  { word: '庫存', code: 'stock_promise', why: '不寫庫存或出貨承諾' },
  { word: '合法上路', code: 'legal_claim', why: '認證只寫名稱，不寫「合法上路」' },
  { word: '免登記', code: 'legal_claim', why: '認證只寫名稱，不寫「免登記」' },
  { word: '品質保證', code: 'quality_promise', why: '不寫本店的品質保證' },
];

// 保固寫法清單:逐字照抄報價單 scripts/storefront_copy_lint.py 的 WARRANTY_RE(主視窗 2026-10-01 Q2 甲)。
//   「保固/保修」裸抓;「保證/保用/保障/擔保/質保」只有黏著期間或補償行為才算 ——
//   裸抓會誤殺「保證同心度精度」這種規格說法(報價單全庫實測 90 處)。
//   「確保固定」不算保固(lookbehind)。改字表時兩邊一起改。
const WARRANTY_NUM = '(?:\\d+|[一二三四五六七八九十兩半])';
const WARRANTY = new RegExp(
  '(?<!確)保(?:固|修)' +
    '|無限(?:期|里程)保' +
    '|終身(?:免費)?(?:更換|保養|維修|服務|保固)' +
    `|(?:終身|無限期|${WARRANTY_NUM}\\s*年|${WARRANTY_NUM}\\s*個?月)[^。，；！？\\n]{0,8}?(?:保證|保用)` +
    `|(?:保證|保用)\\s*(?:期|${WARRANTY_NUM}\\s*年|${WARRANTY_NUM}\\s*個?月)` +
    '|保證\\s*(?:更換|換新|退換|退貨|維修|修復|賠償)' +
    `|(?:終身|無限期|${WARRANTY_NUM}\\s*年|${WARRANTY_NUM}\\s*個?月)[^。，；！？\\n]{0,8}?(?:保障|擔保|質保)` +
    `|(?:保障|擔保|質保)\\s*(?:期|${WARRANTY_NUM}\\s*年)` +
    `|${WARRANTY_NUM}\\s*(?:年|個?月)\\s*內[^。，；！？\\n]{0,6}?免費\\s*(?:維修|更換|換新|保養)` +
    '|終身免(?:更換|維修|保養)',
);
// 一句話的切法:句號、驚嘆號、問號、分號、換行、逗號。逗號也切 ——
//   「原廠提供一年保固，本店延長至兩年保固」後半是本店保固, 不切就會因為前半是原廠提供而放過(R1 建議 3)。
//   「原廠提供兩年保固，限正常使用」切開後, 後半沒有保固二字, 照樣不紅。
//   ⚠️ 代價:「原廠提供兩年保固，保固期自購買日起算」後半會紅(R2 建議 2)。員工改成兩句或刪掉後半即可。
//   右引號也切:「「原廠提供兩年保固」本店再加一年保固」後半要獨立判斷(R2 建議 3)。
const SENTENCE_SPLIT = /[。！？!?；;\n，,」』]/;
// 句首的條列符號、編號(1. 1、 1))、引號與空白不算(「・原廠提供…」「1. 原廠提供…」也是原廠提供開頭)
const LEADING_MARKS = /^(?:[\s・•\-–—*·「『"“]|\d+[.、)）])+/;

/**
 * 這一句是不是寫明原廠:「原廠提供…」開頭, 或品牌名開頭再接「(原廠)提供」
 * (「Samco Sport 原廠提供終身保固」「Samco Sport 提供終身保固」;主視窗 2026-10-01 Q1 甲, 與報價單一致)。
 */
function namesTheMaker(sentence: string, brandNames: ReadonlyArray<string>): boolean {
  if (sentence.startsWith('原廠提供')) return true;
  const lower = sentence.toLowerCase();
  return brandNames.some((b) => {
    const name = b.trim().toLowerCase();
    if (!name || !lower.startsWith(name)) return false;
    return /^\s*(?:原廠)?提供/.test(sentence.slice(name.length));
  });
}

/**
 * 一段文字的紅字問題;空陣列 = 可以發。同一個字只報一次。
 * `brandNames`:這件商品的品牌名(顯示名與英文名都可以給);品牌名開頭的保固句視為原廠提供。
 */
export function checkSocialCopy(text: string, brandNames: ReadonlyArray<string> = []): SocialCopyIssue[] {
  const out: SocialCopyIssue[] = [];
  const body = text ?? '';
  for (const b of BLOCKED_WORDS) {
    if (body.includes(b.word)) {
      out.push({ code: b.code, word: b.word, message: `出現「${b.word}」：${b.why}，請刪掉或改寫。` });
    }
  }
  for (const sentence of body.split(SENTENCE_SPLIT)) {
    const s = sentence.replace(LEADING_MARKS, '');
    const m = WARRANTY.exec(s);
    if (m && !namesTheMaker(s, brandNames)) {
      out.push({
        code: 'warranty_not_maker',
        word: m[0],
        message: `「${s.slice(0, 20)}」：寫保固要寫明是原廠，例如「原廠提供兩年保固」或「品牌名 原廠提供終身保固」。`,
      });
      break;
    }
  }
  return out;
}

/** 多段文字一起檢查(大圖的眉標、標題、副標、按鈕字)。 */
export function checkSocialCopyFields(
  fields: ReadonlyArray<string | null | undefined>,
  brandNames: ReadonlyArray<string> = [],
): SocialCopyIssue[] {
  return checkSocialCopy(fields.filter((f): f is string => !!f).join('\n'), brandNames);
}

/**
 * 首頁大圖文字的禁用字 —— 與資料庫 admin_home_banner_publish 的檢查【逐字同一串】
 * (migration 20261001120000;social-copy-rules.test.ts 會讀 migration 檔比對, 兩邊不一致就紅)。
 * 大圖只是短標題 ⇒ 比 FB / IG 嚴:保固一律不寫, 「原廠提供」也不放行(R1 F1)。
 */
export const BANNER_BLOCKED_PATTERN = '現貨|到貨|庫存|合法上路|免登記|品質保證|保固|保修';

/** 首頁大圖的眉標、標題、副標、按鈕字;後台要用這支, 不可用 FB / IG 那套(那套會放行原廠保固, 資料庫不會)。 */
export function checkBannerCopy(fields: ReadonlyArray<string | null | undefined>): SocialCopyIssue[] {
  const text = fields.filter((f): f is string => !!f).join(' ');
  const words = [...new Set(text.match(new RegExp(BANNER_BLOCKED_PATTERN, 'g')) ?? [])];
  return words.map((word) => ({
    code: 'banner_blocked' as const,
    word,
    message: `大圖文字出現「${word}」：首頁大圖不寫庫存、法規結論、品質保證或保固，請改字。`,
  }));
}
