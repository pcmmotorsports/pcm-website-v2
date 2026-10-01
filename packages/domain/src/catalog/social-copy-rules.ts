// social-copy-rules.ts — 首頁大圖與 FB / IG 草稿的紅字檢查【唯一一份】(2026-10-01, 每日自動新品草稿片 1)
//
// 誰讀:建草稿的程式(packages/use-cases)、後台首頁大圖編輯畫面(標紅、擋發布與複製)、發布前檢查。
// 規則來源:Sean 2026-10-01 批准的計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md;
//   社群研究 ~/pcm-mailbox/社群研究-20261001/分析與建議.md 二之 5「自動產草稿前要先擋掉」。
// 🔴 放 packages/domain:後台、cron、之後的發布檢查都要讀同一份, 不要各抄一份。

export interface SocialCopyIssue {
  /** 機器用的分類 */
  code: 'stock_promise' | 'legal_claim' | 'quality_promise' | 'warranty_not_maker';
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

// 「確保固定」不算保固;「保修」與保固同義(與報價單 storefront_copy_auto 同一條)。
const WARRANTY = /(?<!確)保(?:固|修)/;
// 一句話的切法:句號、驚嘆號、問號、分號、換行、逗號。逗號也切 ——
//   「原廠提供一年保固，本店延長至兩年保固」後半是本店保固, 不切就會因為前半是原廠提供而放過(R1 建議 3)。
//   「原廠提供兩年保固，限正常使用」切開後, 後半沒有保固二字, 照樣不紅。
//   ⚠️ 代價:「原廠提供兩年保固，保固期自購買日起算」後半會紅(R2 建議 2)。員工改成兩句或刪掉後半即可。
//   右引號也切:「「原廠提供兩年保固」本店再加一年保固」後半要獨立判斷(R2 建議 3)。
const SENTENCE_SPLIT = /[。！？!?；;\n，,」』]/;
// 句首的條列符號、編號(1. 1、 1))、引號與空白不算(「・原廠提供…」「1. 原廠提供…」也是原廠提供開頭)
const LEADING_MARKS = /^(?:[\s・•\-–—*·「『"“]|\d+[.、)）])+/;

/** 一段文字的紅字問題;空陣列 = 可以發。同一個字只報一次。 */
export function checkSocialCopy(text: string): SocialCopyIssue[] {
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
    if (m && !s.startsWith('原廠提供')) {
      out.push({
        code: 'warranty_not_maker',
        word: m[0],
        message: `「${s.slice(0, 20)}」：寫保固要用「原廠提供」開頭，例如「原廠提供兩年保固」。`,
      });
      break;
    }
  }
  return out;
}

/** 多段文字一起檢查(大圖的眉標、標題、副標、按鈕字)。 */
export function checkSocialCopyFields(fields: ReadonlyArray<string | null | undefined>): SocialCopyIssue[] {
  return checkSocialCopy(fields.filter((f): f is string => !!f).join('\n'));
}
