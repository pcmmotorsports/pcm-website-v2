import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_SESS_COOKIE, buildAdminSession, signSession } from '@/lib/session/session';
import { config, proxy } from '@/proxy';

// 🔴 **本檔問的是【這條 `.pdf` 路由有沒有被登入閘蓋到】** —— 而它與 `proxy.test.ts` 的差別
//    只有一個字:**副檔名**。既有那族全部用 `/orders`(無副檔名),
//    而「matcher 排除帶點的路徑」是 Next middleware 設定裡最常見的一種寫法
//    ⇒ 若哪天有人把 matcher 改成 `((?!_next|.*\..*).*)`,`/orders` 那族【全綠】
//      而這條路由的 auth 靜默消失,連同紙上的收件人姓名 / 電話 / 地址一起。
//    ⛔ ~~所以這一格是那個突變【唯一】會紅的地方~~ —— **那句是假的**(codex R2 nit):
//      `proxy-matcher.test.ts:27` 對 matcher 做逐字相等斷言, 那個突變它也會紅。
//      ✅ 本格加的是**另一個角度**:那一格問「字面有沒有被改」, 本格問
//        「這條**具體的**帶副檔名網址落不落在覆蓋面裡」—— 改 matcher 而字面照舊的寫法它擋不到。
//
// 🛑🛑 **本檔【證不到】的東西, 逐條寫在這裡 —— 不要把它讀成比這更多**(codex R2 must-fix-2):
//   ① **證不到「Next 真的會為這條 URL 呼叫 `proxy`」** —— 下面是直接呼叫 `proxy()` 這個函式,
//      那繞過了 Next 自己的 dispatch。支撐那一步的只有 `config.matcher` 那個字面,
//      而下面那一格用**裸 JS regex** 去逼近它 —— **Next 的 matcher 語意不是裸 JS regex**。
//      ⇒ 那一格是逼近值, 不是證明(同 `proxy-matcher.test.ts` 檔頭那句射程)。
//   ② **證不到「有權限的人拿得到 PDF」** —— 「有效 session」那一格拿到的 200 是
//      `NextResponse.next()`(閘放行), **那條 route 一次都沒有被呼叫**。
//   ③ **證不到「那份 PDF 產得出來」** —— `@sparticuz/chromium` 是 Linux binary,
//      macOS `spawn ENOEXEC` ⇒ 驗收條件 ① 的前半(200 且前四位元組 `%PDF`)本機量不到,
//      要線上有人下載一次才算數。
// ✅ **本檔證得到的, 只有一句**:在 `proxy` 被呼叫到的前提下,
//    **一個真的沒有 cookie 的請求, 拿到的東西不是 PDF**(驗收條件 ① 的後半)。

// 🔵 兩個 id 用**真的 UUID 形狀**(route.ts 的 `isOrderId` 是 UUID regex)——
//    今天本檔只呼叫 `proxy()`, id 長什麼樣它不在乎;
//    而下一個人照檔頭②去補「有權限拿得到 PDF」那一格時, ULID 形狀會讓它**紅在錯的理由上**。
const PDF_PATH =
  '/print/orders/6f1c2a80-0000-4000-8000-000000000001/shipping/6f1c2a80-0000-4000-8000-000000000002/shipping.pdf';

// 簽 session 要金鑰;沒設 ⇒ signSession 回 null,而「有權限」那一格會紅在錯的理由上。
// 同 proxy.test.ts:13 的慣例(獨立字面,不 import 別支測試的常數)。
const SECRET = 'test-admin-session-secret-0123456789abcdef';

describe('後台出貨單 .pdf 路由的登入閘(兩個世界)', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = prev;
  });

  it('前置:測試環境沒有 dev bypass(否則整族靜默放行)', () => {
    expect(process.env.ADMIN_DEV_BYPASS).not.toBe('1');
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('覆蓋邊界:matcher 匹配這條【帶 .pdf 副檔名】的路徑(負對照:靜態資源不匹配)', () => {
    // ⚠️ 量具邊界(沿用 proxy-matcher.test.ts 檔頭那句):Next 的 matcher 語意不是裸 JS regex,
    //    本格是逼近值。它殺得掉「排除清單多一段把帶點路徑掃掉」這個突變,那正是本檔的來意。
    const pattern = config.matcher[0] ?? '';
    expect(pattern).toBeTruthy();
    const re = new RegExp(`^${pattern}$`);
    expect(re.test(PDF_PATH), 'matcher 沒蓋到這條 .pdf 路由 ⇒ 它的登入閘不存在').toBe(true);
    expect(re.test('/_next/static/chunks/main.js')).toBe(false);
  });

  it('沒有 cookie ⇒ 303 導登入,而且拿到的東西不是 PDF', async () => {
    const res = await proxy(new NextRequest(`http://localhost:3001${PDF_PATH}`));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/api/sso/start');
    // 🔴 驗收條件 ① 後半逐字是「拿不到(而不是回一份 PDF)」⇒ 直接去問那四個位元組,
    //    不要只斷言 status —— 一個 200 的 PDF 與一個 303 的重導在「不是 PDF」這件事上
    //    是兩個不同的宣稱,而客人要的是後面那個。
    const head = new Uint8Array(await res.arrayBuffer()).subarray(0, 4);
    expect(new TextDecoder().decode(head)).not.toBe('%PDF');
  });

  it('壞掉的 cookie ⇒ 一樣被擋(閘不只看 cookie 在不在)', async () => {
    const res = await proxy(
      new NextRequest(`http://localhost:3001${PDF_PATH}`, {
        headers: { cookie: `${ADMIN_SESS_COOKIE}=garbage-not-a-token` },
      }),
    );
    expect(res.status).toBe(303);
  });

  // ⚠️ 名字寫「通得過閘」不寫「拿得到 PDF」是刻意的:下面拿到的 200 是 `NextResponse.next()`,
  //    那條 route **一次都沒有被呼叫**(見檔頭②)。
  it('有效 session ⇒ 通得過閘(只證這個:不被導走。route 沒有被呼叫)', async () => {
    const token = await signSession(buildAdminSession(['pwd', 'totp'], Math.floor(Date.now() / 1000)));
    expect(token).toBeTruthy();
    const res = await proxy(
      new NextRequest(`http://localhost:3001${PDF_PATH}`, {
        headers: { cookie: `${ADMIN_SESS_COOKIE}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
