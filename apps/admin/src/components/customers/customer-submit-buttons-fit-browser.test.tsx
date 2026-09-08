// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// 真元件間接載入 `server-only` ⇒ 逐檔 mock(同 `shipment-buttons-fit-browser.test.tsx`)。
vi.mock('server-only', () => ({}));
// 🔴🔴 **只換掉 `useFormStatus` 這個 context, 不換掉那兩顆鈕本身。**
//    那兩顆是 client island(`useFormStatus`), 而 `renderToStaticMarkup` 沒有 form action context。
//    ⛔ 最省事的做法是把鈕整支 mock 成 `<button>替身</button>` —— 而那會讓本檔量到
//      **我自己畫的鈕**, 不是員工看到的那一顆(家法逐字:`page-measure.test.tsx` 檔頭
//      「那份重製忠實到連 Sean 都認得, 而【像不代表是同一份】」)。
//    ✅ 所以只 stub context, **兩顆鈕都是真的元件、真的 class、真的字**。
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return { ...actual, useFormStatus: () => ({ pending: false, data: null, method: null, action: null }) };
});
import { renderToStaticMarkup } from 'react-dom/server';
import { requireFreshBuild } from '@/lib/build-stamp';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { serveHtmlAndVisit } from '@/lib/test-support/serve-html-and-visit';
import { ProfileEditSubmitButton } from './profile-edit-submit';
import { EmailChangeSubmitButton } from './email-change-submit';

// customer-submit-buttons-fit-browser.test.tsx
// 起因是一次真實使用:Sean 2026-09-09 傳來後台截圖 —— **「儲存基本資料」在畫面上只看得到
// 「儲存基本資」, 最後一個字被切在按鈕外面。**
//
// 🔬 修前當場量到(拋棄式鑽機 `scripts/admin-probe`, 真 Chromium, 1200x948):
//    `儲存基本資料` clientHeight **36** / scrollHeight **53** ⇒ **被切 17px = 第二行整行**
//    成因:`whiteSpace: normal` + `display: block` + 固定 `h-9`(36px)⇒ 字換兩行而盒子不長。
//    🟢 同一發正對照 `Toggle Sidebar`(shadcn `<Button>`)⇒ `nowrap` / `flex` ⇒ 沒切。
//
// 🔴 **本檔量【垂直】的溢出(`scrollHeight - clientHeight`), 而同族那支
//    `shipment-buttons-fit-browser.test.tsx` 量的是【水平】** —— 兩把尺不互相涵蓋:
//    那一支問「那一排有沒有被擠出去」, 本檔問「一顆鈕的字有沒有被切在自己盒子外」。
//
// 🛑 **本檔【不用 jsdom】, 而那不是偏好** —— jsdom 沒有排版引擎, `scrollHeight` 恆等於
//    `clientHeight` ⇒ 一個 jsdom 版的本檔會**永遠綠**。而同族 `tier-edit-submit.test.tsx`
//    檔頭記過同型:「**一個標記層的不變量可以完全成立, 而它保護的那件事完全沒發生。**」
//    ⇒ 所以本檔也**不**斷言 class 字串裡有沒有 `whitespace-nowrap` —— 那是 markup 層的替身。
//
// ⚠️ **本檔驗不到什麼**:
//    ① 那兩顆鈕在**正式站真實容器寬度**下的樣子 —— 本檔用的是自己造的窄容器。
//    ② `EmailChangeSubmitButton` 那顆**只對信箱密碼註冊的客人出現**(唯讀實測 2026-09-09:
//       15 個客人 line 6 / email 4 / google 4 / manual 1 ⇒ **只有那 4 個看得到它**)
//       ⇒ 本檔直接渲染它, **繞過了資格閘** —— 那是刻意的:本檔量版面, 不量閘。

let browser: Browser;
let compiledCss: string;

/** 掃 `.next` 找編譯後的 CSS —— **找不到就紅、不 skip**(同族既有做法)。 */
function findCompiledCss(): string {
  // 🔴 先問戳記再走 `.next`:`next build` 可以 rc=1 而照樣寫出產物
  //    ⇒「產物存在」在【成功】與【失敗但寫了一半】兩個世界印同一個綠。
  requireFreshBuild();
  const hits: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full, depth + 1);
      else if (name.endsWith('.css')) hits.push(full);
    }
  };
  // 🔴 從【本檔自己的位置】往上找 `apps/admin/.next`, 不用 `process.cwd()` ——
  //    vitest 從 repo 根跑時 cwd 是根, 而 `.next` 在 app 底下 ⇒ 用 cwd 會查無,
  //    📌 而那個查無與「build 沒跑」印同一個錯誤訊息(我 2026-09-09 當場踩了一次)。
  walk(fileURLToPath(new URL('../../../.next', import.meta.url)), 0);
  if (hits.length === 0) throw new Error('找不到編譯後的 CSS ⇒ 先跑 build。不 skip:skip 與綠在報告上長一樣。');
  return hits.map((f) => readFileSync(f, 'utf8')).join('\n');
}

beforeAll(async () => {
  compiledCss = findCompiledCss();
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
}, 120_000);

type Fit = { text: string; clientH: number; scrollH: number; over: number };

/**
 * `extraCss` 是**負對照的入口**:餵一段把修法蓋掉的 CSS ⇒ 那兩顆必須變回被切。
 * 容器刻意窄(100px)—— 那是「字會換行」的世界;寬容器下這道守門是恆真的。
 * 🔴 **100 這個數是【試出來的, 不是算出來的】**:第一版寫 140 ⇒ 兩顆都塞得下
 *    ⇒ **負對照當場不叫** ⇒ 那把尺量不到那個病。⇒ 收窄到 100 才進到「會換行」那個世界。
 *    📌 一個【太寬的容器】會讓這整支測試恆綠, 而它看起來跟通過一模一樣。
 */
async function measure(extraCss = ''): Promise<Fit[]> {
  const html = renderToStaticMarkup(
    <div style={{ width: 100 }}>
      <ProfileEditSubmitButton />
      <EmailChangeSubmitButton />
    </div>,
  );
  const doc = `<html><head><style>${compiledCss}\n${extraCss}</style></head><body>${html}</body></html>`;
  return await serveHtmlAndVisit(
    browser,
    doc,
    async (page) =>
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map((el) => ({
          text: (el.textContent ?? '').trim(),
          clientH: el.clientHeight,
          scrollH: el.scrollHeight,
          over: el.scrollHeight - el.clientHeight,
        })),
      ),
    { viewport: { width: 400, height: 900 }, label: 'customer-submit-buttons-fit' },
  );
}

describe('客戶頁那兩顆送出鈕:字不得被切在按鈕外面', () => {
  it('分母:兩顆鈕真的畫出來了(少一顆 ⇒ 下面那格是半個恆真)', async () => {
    const els = await measure();
    // 🔴 第二顆的字是【改成這個信箱】不是「改成新的 Email」——
    //    後者是那一【欄】的 label(`email-change-form.tsx` 的 `AdminFormField label`), 不是鈕。
    //    📌 我 2026-09-09 第一版就把它們寫成同一個, 而【分母那一格當場紅了】——
    //       那正是這一格存在的理由:抄一個我沒有當場讀過的字面。
    expect(els.map((e) => e.text).sort()).toEqual(['儲存基本資料', '改成這個信箱']);
  });

  it('100px 窄容器下, 兩顆都沒有被切(scrollHeight 不超過 clientHeight)', async () => {
    const els = await measure();
    expect(
      els.filter((e) => e.over > 0.5).map((e) => `${e.text} 被切 ${e.over}px（clientH ${e.clientH} / scrollH ${e.scrollH}）`),
    ).toEqual([]);
  });

  // 🔴🔴 **負對照 —— 少了這一格, 上面那格在「尺根本量不到東西」時也會綠。**
  //    把 `white-space` 蓋回 `normal`(= 修之前那個世界)⇒ 至少一顆必須變回被切。
  it('負對照:把 white-space 蓋回 normal ⇒ 尺必須叫', async () => {
    const els = await measure('button{white-space:normal !important}');
    expect(
      els.filter((e) => e.over > 0.5).length,
      '蓋回 normal 之後仍然沒有任何一顆被切 ⇒ 這把尺看不到那個病, 回來修量法(不要放行)',
    ).toBeGreaterThan(0);
  });
});
