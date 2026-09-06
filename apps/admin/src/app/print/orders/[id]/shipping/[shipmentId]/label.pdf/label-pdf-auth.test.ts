import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_SESS_COOKIE, buildAdminSession, signSession } from '@/lib/session/session';
import { config, proxy } from '@/proxy';

// 🔴 **本檔問的是【這條 `label.pdf` 路由有沒有被登入閘蓋到】** —— 逐條照 P-2 的孿生檔
//    (`shipping.pdf/shipping-pdf-auth.test.ts`), 而**它與那一支不是同一條路徑**:
//    matcher 若哪天被改成排除帶點的路徑, 兩條會一起靜默失去 auth ——
//    而**那張標籤上有收件人姓名 / 電話 / 地址**。
//
// 🛑🛑 **本檔【證不到】的東西, 逐條照抄 P-2 那支的射程**(它們是同一個量具):
//   ① 證不到「Next 真的會為這條 URL 呼叫 `proxy`」—— 下面是**直接呼叫 `proxy()`**, 繞過 Next 的 dispatch。
//   ② 證不到「有權限的人拿得到 PDF」—— 「有效 session」那一格拿到的 200 是
//      `NextResponse.next()`(閘放行), **那條 route 一次都沒有被呼叫**。
//   ③ 證不到「那份 PDF 產得出來」—— `@sparticuz/chromium` 是 Linux binary, macOS `spawn ENOEXEC`。
// ✅ **證得到的只有一句**:在 `proxy` 被呼叫到的前提下, 一個真的沒有 cookie 的請求, 拿到的東西不是 PDF。

const PDF_PATH =
  '/print/orders/6f1c2a80-0000-4000-8000-000000000001/shipping/6f1c2a80-0000-4000-8000-000000000002/label.pdf';

// 簽 session 要金鑰;沒設 ⇒ signSession 回 null,而「有權限」那一格會紅在錯的理由上。
const SECRET = 'test-admin-session-secret-0123456789abcdef';

describe('新竹託運標籤 .pdf 路由的登入閘(兩個世界)', () => {
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
    // ⚠️ 量具邊界:Next 的 matcher 語意不是裸 JS regex, 本格是逼近值(同 P-2 那支)。
    const pattern = config.matcher[0] ?? '';
    expect(pattern).toBeTruthy();
    const re = new RegExp(`^${pattern}$`);
    expect(re.test(PDF_PATH), 'matcher 沒蓋到這條 label.pdf 路由 ⇒ 它的登入閘不存在').toBe(true);
    expect(re.test('/_next/static/chunks/main.js')).toBe(false);
  });

  it('沒有 cookie ⇒ 303 導登入,而且拿到的東西不是 PDF', async () => {
    const res = await proxy(new NextRequest(`http://localhost:3001${PDF_PATH}`));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/api/sso/start');
    // 🔴 直接去問那四個位元組 —— 「303」與「不是 PDF」是兩個不同的宣稱, 而客人要的是後者。
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
