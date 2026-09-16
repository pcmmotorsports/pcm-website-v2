import { HB_UPLOAD } from './home-banner-constants';

// home-banner-image-check.ts — 「這個檔可不可以收」的純函式(片 B)。
// 🔴 **這一檔刻意不帶 `server-only`** —— 它不碰 Storage、不碰 env,只看位元組與數字。
//    帶了就沒辦法單元測,而**這裡正是最需要被測的那一段**(型別嗅探、上限、檔名)。
//    真的碰外面那一段在 `home-banner-image-upload.ts`,那支才帶 server-only。

export type SniffedImage = { ext: 'jpg' | 'png' | 'webp'; contentType: (typeof HB_UPLOAD.types)[number] };

/** 驗不過的原因 —— 逐個對到一句給員工看的話(constants 的 HOME_BANNER_RESULT_MESSAGES)。 */
export type UploadReject = 'empty' | 'toobig' | 'badtype';

export type UploadCheck =
  | { ok: true; ext: 'jpg' | 'png' | 'webp'; contentType: (typeof HB_UPLOAD.types)[number] }
  | { ok: false; reject: UploadReject };

/**
 * 從**實際位元組**認圖片型別 —— 🔴 不看檔名、不看瀏覽器給的 `file.type`。
 * 那兩個都是使用者說了算的字串:把 .exe 改名成 .jpg,兩者都會說它是 jpg。
 * 只有前幾個位元組是檔案自己說的。
 */
export function sniffImageType(head: Uint8Array): SniffedImage | null {
  // JPEG:FF D8 FF
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  // PNG:89 50 4E 47 0D 0A 1A 0A(八個位元組都要對 —— 只比前四個會把別的東西放進來)
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && PNG.every((b, i) => head[i] === b)) {
    return { ext: 'png', contentType: 'image/png' };
  }
  // WEBP:RIFF....WEBP —— 🔴 `RIFF` 也是 wav / avi 的開頭 ⇒ 第 8-11 那四格必須是 WEBP,不能只認 RIFF
  const ascii = (i: number, s: string) => [...s].every((c, k) => head[i + k] === c.charCodeAt(0));
  if (head.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

/** 大小 + 型別一起驗。`head` 給前 12 個位元組就夠(上面三種特徵都在前 12 格內)。 */
export function checkBannerUpload(size: number, head: Uint8Array): UploadCheck {
  if (size <= 0) return { ok: false, reject: 'empty' };
  // 🔴 先驗大小再驗型別:型別要讀位元組,而大小是元資料 ⇒ 順序反過來等於先把大檔讀進記憶體
  if (size > HB_UPLOAD.maxBytes) return { ok: false, reject: 'toobig' };
  const sniffed = sniffImageType(head);
  if (sniffed === null) return { ok: false, reject: 'badtype' };
  return { ok: true, ext: sniffed.ext, contentType: sniffed.contentType };
}

/**
 * 產檔名 —— **伺服器產,不用使用者給的原名**。
 * 原名會帶路徑分隔符、`..`、控制字元與別人的商標;而我們唯一需要它的地方(來源)寫在 `rights_note`。
 */
export function bannerObjectPath(uuid: string, ext: string): string {
  return `${uuid}.${ext}`;
}
