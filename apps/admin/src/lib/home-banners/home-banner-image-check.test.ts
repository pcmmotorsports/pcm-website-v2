import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HB_UPLOAD } from './home-banner-constants';
import { bannerObjectPath, checkBannerUpload, sniffImageType } from './home-banner-image-check';

// home-banner-image-check.test.ts — 片 B 的守門。
// 🔴 重點不是「函式回對的值」,是**兩個地方的數字沒有漂開** —— 桶(板 20260916230000)與 server 端
//    擋的是同一組上限與型別;**只有一邊擋 = 繞過 UI 就沒人擋;兩邊不一致 = 會出事的那個縫**。

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const WEBP = bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'));

describe('認圖片型別 · 看位元組不看檔名', () => {
  it('三種認得出來', () => {
    expect(sniffImageType(JPEG)?.contentType).toBe('image/jpeg');
    expect(sniffImageType(PNG)?.contentType).toBe('image/png');
    expect(sniffImageType(WEBP)?.contentType).toBe('image/webp');
  });

  it('🔴 RIFF 開頭但不是 WEBP(wav / avi)不可以過', () => {
    // `RIFF....WAVE` —— 只認前四格 `RIFF` 的寫法會把它放進來
    expect(sniffImageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeNull();
  });

  it('🔴 PNG 只對前四格、後四格是別的 ⇒ 不可以過', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
  });

  it('🔴 把別的檔改名成 .jpg 擋得下來(這是這支測試存在的理由)', () => {
    // 內容是 `MZ`(Windows 執行檔)—— 檔名與瀏覽器給的 file.type 都可以說它是 jpg,而位元組不會說謊
    expect(sniffImageType(bytes(0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
    expect(checkBannerUpload(1024, bytes(0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toEqual({
      ok: false, reject: 'badtype',
    });
  });

  it('太短的位元組不會炸,只是認不出來', () => {
    expect(sniffImageType(bytes(0xff))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('大小與空檔', () => {
  it('剛好等於上限 ⇒ 過;多一個位元組 ⇒ 擋', () => {
    expect(checkBannerUpload(HB_UPLOAD.maxBytes, JPEG).ok).toBe(true);
    expect(checkBannerUpload(HB_UPLOAD.maxBytes + 1, JPEG)).toEqual({ ok: false, reject: 'toobig' });
  });

  it('0 位元組 ⇒ empty,不是 badtype', () => {
    expect(checkBannerUpload(0, JPEG)).toEqual({ ok: false, reject: 'empty' });
  });

  it('🔴 太大的檔【在讀位元組之前】就被擋掉 —— 給一個過大又認不出型別的檔,回的要是 toobig', () => {
    // 若順序反了(先認型別), 這格會回 badtype ⇒ 代表大檔已經被讀進來了
    expect(checkBannerUpload(HB_UPLOAD.maxBytes + 1, bytes(0x4d, 0x5a))).toEqual({ ok: false, reject: 'toobig' });
  });
});

describe('檔名由伺服器產', () => {
  it('只有 uuid 加副檔名,原名一個字都不進去', () => {
    expect(bannerObjectPath('11111111-2222-3333-4444-555555555555', 'jpg'))
      .toBe('11111111-2222-3333-4444-555555555555.jpg');
  });
});

describe('🔴 桶與 server 兩邊的數字必須一致(主視窗點名的那一格)', () => {
  // 讀那支 migration 的**字面**來比 —— 不是比另一份 TS 常數(那樣是自己比自己)
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260916230000_m4b_home_banner_storage_bucket.sql'),
    'utf8',
  );

  it('🔬 正對照:讀到的真的是那支板(不是空字串 / 讀錯檔)', () => {
    expect(sql).toContain('INSERT INTO storage.buckets');
    expect(sql.length).toBeGreaterThan(1000);
  });

  it('桶名兩邊一樣', () => {
    expect(HB_UPLOAD.bucket).toBe('home-banners');
    expect(sql).toContain("'home-banners'");
  });

  it('大小上限兩邊一樣(5 MiB)', () => {
    expect(HB_UPLOAD.maxBytes).toBe(5_242_880);
    expect(sql).toContain('5242880');
  });

  it('允許的型別兩邊一樣,而且沒有多也沒有少', () => {
    expect([...HB_UPLOAD.types]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    for (const t of HB_UPLOAD.types) expect(sql).toContain(`'${t}'`);
    // 反面:SQL 裡不可以偷偷多收別的圖 —— 多一種而 server 端不認 ⇒ 桶收得下而我們擋掉,兩邊就漂了
    for (const t of ['image/gif', 'image/svg+xml', 'image/avif', 'image/heic']) {
      expect(sql, `SQL 收了 ${t} 而 HB_UPLOAD 沒有`).not.toContain(`'${t}'`);
    }
  });

  it('🔴 那支板仍然一條 policy 都不建(加了就是放寬)', () => {
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
  });
});
