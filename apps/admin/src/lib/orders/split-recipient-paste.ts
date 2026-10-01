// split-recipient-paste.ts — 建單「收件資料」貼上整段 ⇒ 拆成收件人 / 電話 / 地址(2026-10-01, Sean Q25 甲)
//
// Sean 原話:「我可能複製姓名、電話、地址,在收件資料的欄位直接貼上,幫我分好。分隔通常是空格、換行、逗號或頓號。」
// 計畫:~/pcm-mailbox/計畫-建單收件資料合併-20261001.md 第 4 節。
// 🔴 用內容判斷, 不是只照分隔符號切:地址本身常有空白(「台北市 中正區 忠孝東路一段 1號」), 照空白切會把地址切斷。
// 🔴 拆不準時員工改那一格就好;本檔只負責「猜」, 不擋任何東西。

export type SplitRecipientResult = {
  /** 沒認出 ⇒ 空字串(呼叫端不要拿空字串蓋掉原本的字) */
  name: string;
  /** 一律純數字(分機留在 # 後面), 例 0912345678、0223456789#123 */
  phone: string;
  address: string;
  /** 貼了兩支以上電話時, 第二支以後(沒有填入, 要提示員工) */
  extraPhones: string[];
};

const toHalfWidth = (s: string): string =>
  s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');

// 台灣手機 09xx-xxx-xxx(含 +886 9xx)、市話 (0x)xxxx-xxxx;中間允許 - 空白 括號, 市話可帶分機
const PHONE = /(?:\+?886[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{3}|\(?0\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{4}(?:\s*(?:#|分機)\s*\d{1,5})?/g;
const FIELD_LABEL = /(收件人|收件者|姓名|名字|聯絡電話|電話|手機|收件地址|寄送地址|地址)\s*[:：]?/g;
const POSTAL = /^\d{3}(\d{2,3})?$/;
const ADMIN_END = /(縣|市|區|鄉|鎮)$/;
const ROAD = /(路|街|大道|段|巷|弄|號|樓)/;
const CITY = '(?:台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)[市縣]';
const STARTS_CITY = new RegExp(`^(?:\\d{3,6})?${CITY}`);
// 姓名與地址黏在一起(「王小明台北市…」):從縣市名前面切開
const NAME_GLUED = new RegExp(`^([^\\d\\s]{1,6}?)((?:\\d{3,6})?${CITY}.*)$`);

/**
 * strong:自己就看得出是地址;weak:要旁邊有地址片段才算。
 * 「中正區」單獨出現時可能是名字(「陳文區」), 所以「區、鄉、鎮、縣、市」結尾只算 weak。
 */
function addressKind(t: string): 'strong' | 'weak' | null {
  if (POSTAL.test(t) || /\d/.test(t) || STARTS_CITY.test(t)) return 'strong';
  if (ROAD.test(t) && t.length >= 3) return 'strong';
  if (/^(號|樓|巷|弄|段|之)$/.test(t) || ADMIN_END.test(t)) return 'weak';
  return null;
}

function normalizePhone(raw: string): string {
  return raw
    .replace(/^\+?886[\s-]?/, '0')
    .replace(/(?:#|分機)\s*/, '#')
    .replace(/[^\d#]/g, '');
}

export function splitRecipientPaste(raw: string): SplitRecipientResult {
  let text = toHalfWidth(raw).replace(FIELD_LABEL, ' ');
  const phones = [...text.matchAll(PHONE)].map((m) => m[0]);
  // 電話拿掉的地方當成換行:「王小明0912345678台北市…」才不會把姓名和地址接成一段
  for (const p of phones) text = text.replace(p, ' \n ');

  const addressParts: string[] = [];
  const nameParts: string[] = [];
  // 先用強分隔(換行、逗號、頓號、分號)切段, 段裡再用空白切
  for (const chunk of text.split(/[\n,，、;；]+/)) {
    const toks = chunk
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((t) => {
        const m = NAME_GLUED.exec(t);
        return m ? [m[1]!, m[2]!] : [t];
      });
    const kinds = toks.map(addressKind);
    const isAddr = kinds.map((k) => k === 'strong');
    // weak 只有在旁邊有地址片段時才算;一路往外擴到不再變動(「台北市 中正區 …」整串都要進來)
    for (let changed = true; changed; ) {
      changed = false;
      kinds.forEach((k, i) => {
        if (k === 'weak' && !isAddr[i] && (isAddr[i - 1] || isAddr[i + 1])) isAddr[i] = changed = true;
      });
    }
    // 夾在兩個地址片段中間的也算地址(「台北市 大同里 民權西路100號」)
    for (let i = 1; i < toks.length - 1; i++) if (!isAddr[i] && isAddr[i - 1] && isAddr[i + 1]) isAddr[i] = true;

    let run: string[] = [];
    toks.forEach((t, i) => {
      if (isAddr[i]) {
        run.push(t);
        return;
      }
      if (run.length > 0) addressParts.push(run.join(''));
      run = [];
      nameParts.push(t);
    });
    if (run.length > 0) addressParts.push(run.join(''));
  }

  return {
    // 英文名中間的空白要留著(Michael Chen)
    name: nameParts.join(' ').trim(),
    phone: phones[0] ? normalizePhone(phones[0]) : '',
    address: addressParts.join(''),
    extraPhones: phones.slice(1).map(normalizePhone),
  };
}
