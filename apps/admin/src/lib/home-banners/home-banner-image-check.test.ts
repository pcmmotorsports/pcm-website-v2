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

  it('大小上限兩邊一樣(4 MiB)', () => {
    // 🔴 **不可以用 `sql.toContain('4194304')`** —— 那只證明「這個字串在檔案裡某處出現過」。
    //    2026-09-16 實測:把 INSERT 的值改成 5242880、而事後閘那行仍寫 4194304 ⇒ toContain 照樣綠。
    //    📌 一格「檔案裡有這個數字」的斷言,擋不住「用到那個數字的地方被改掉」。
    //    ⇒ 改成把【真正送進 INSERT 的那個值】抓出來比。
    const inserted = sql.match(/VALUES\s*\([^)]*?\btrue\s*,\s*(\d+)\s*,/);
    if (inserted?.[1] === undefined) throw new Error('SQL 的 INSERT 裡抓不到 file_size_limit 的值');
    expect(Number(inserted[1]), 'INSERT 進桶的大小上限').toBe(HB_UPLOAD.maxBytes);

    // 事後閘那一行也要是同一個數 —— 兩個地方各寫各的, 板會自己把自己擋掉
    const gate = sql.match(/file_size_limit\s*<>\s*(\d+)/);
    if (gate?.[1] === undefined) throw new Error('SQL 的事後閘裡抓不到 file_size_limit 的比較值');
    expect(Number(gate[1]), '事後閘比對的大小上限').toBe(HB_UPLOAD.maxBytes);
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

describe('🔴 第四格:框架的 body 上限 —— 真正在生效的是這個', () => {
  // 📌 R1 MF1 的教訓:桶 5MB、server 5MB、畫面 5MB 三邊一致,而**實際擋人的是第四個地方**
  //    (Next 的 serverActions.bodySizeLimit,預設 1 MB)。三格一致而第四格不同 ⇒ 全綠而功能是壞的。
  const config = readFileSync(join(process.cwd(), 'apps/admin/next.config.ts'), 'utf8');

  it('🔬 正對照:讀到的真的是後台那支 next.config(不是空字串 / 讀錯檔)', () => {
    expect(config).toContain('outputFileTracingIncludes');
    expect(config.length).toBeGreaterThan(1000);
  });

  it('後台一定要顯式設 bodySizeLimit —— 不設 = 1 MB, 而那擋得掉我們現有最大那張圖', () => {
    expect(config).toMatch(/serverActions:\s*\{[^}]*bodySizeLimit/);
  });

  it('🔴 那個值必須【大於】圖片上限 —— 等於也不行(整包 body 還有表單欄位與 multipart 信封)', () => {
    const m = config.match(/bodySizeLimit:\s*'(\d+(?:\.\d+)?)(kb|mb|gb)'/i);
    // 🔴 找不到就直接失敗, 不要讓後面那幾行用 `!` 裝作找得到 —— 那會在「有人把它刪了」時噴
    //    一個看不懂的 TypeError, 而不是這一句話。
    if (m === null) throw new Error('next.config 裡找不到 bodySizeLimit 的字面值 ⇒ 預設會退回 1 MB');
    const [, amount, rawUnit] = m;
    // tsconfig 開了 noUncheckedIndexedAccess ⇒ 分組拿出來是 string | undefined, 這裡一次擋掉
    if (amount === undefined || rawUnit === undefined) throw new Error('bodySizeLimit 的字面值解不出數字與單位');
    const UNIT: Record<string, number> = { kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
    const unit = UNIT[rawUnit.toLowerCase()];
    if (unit === undefined) throw new Error(`認不得的單位:${rawUnit}`);
    const limitBytes = Number(amount) * unit;
    expect(limitBytes).toBeGreaterThan(HB_UPLOAD.maxBytes);
  });
});
