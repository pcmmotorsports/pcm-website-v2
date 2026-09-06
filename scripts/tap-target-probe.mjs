#!/usr/bin/env node
// tap-target-probe.mjs —— 第三把尺:**量【誰接到了那一下】, 不量【點不點得到】。**
//
// 🔴🔴 **為什麼要有第三把**(前兩把各自壞在不同地方, 而它們都印得出一個看起來合理的數字):
//   尺A `getBoundingClientRect`  看不到 `::after` 撐出來的命中區
//        ⇒ 對【已經修好的】hero tick 照樣印 `3px` ⇒ 用它判合格會把修好的東西報成沒修。
//   尺B `elementFromPoint` 從中心逐 px 往外探
//        ⇒ 2026-09-05 實測 **42 個元素全部回同一個值 `1`** ⇒ 🛑 **對任何輸入回同一個值 = 零判別力**。
//        🎯 而事後看, 它回的那個「沒命中」很可能是【命中了別人】(卡片上有覆蓋連結)
//        ⇒ 📌 **尺B 把「被別人接走」與「按不到」印成同一個數, 而前者比後者更該修。**
//
// ✅ **本尺的形狀**:在 `document` 掛 capture 階段 listener 記下 `e.target`,
//    然後從中心往四個方向逐格 `page.mouse.click`, 讀回**那一下實際落在誰身上**。
//    ⇒ `::after` 外擴與可點祖先**自動被算進來**, 因為問的是事件不是幾何。
//
// 🔴🔴 **讀數有【兩欄】不是一欄** —— `可點區` 與 `中心那一下被誰接到`。
//    第二欄不是裝飾:2026-09-05 做這把尺時**它自己壞過兩次, 兩次都是第二欄先叫的**
//    (①沒先捲進畫面 ⇒ 點在視窗外被夾住落到 `<html>`, 四個方向全 0 ——
//      而那印出來是「可點 = 盒子」這個【看起來完全合理】的數字;
//     ②拿 `e.target` 逐字比 ⇒ header 那顆的中心是它的 `<svg>` ⇒ 正對照當場紅而功能完全正常
//      ⇒ 改成判「被量的那顆是不是 e.target 的祖先」)。
//
// 🛑 **`preventDefault()` + `stopPropagation()` 兩個缺一不可** ——
//    不擋的話這把尺會**真的按下去**(收藏會寫進帳號、連結會導航)⇒ **量測本身變成寫入。**
//
// 🔵 **判準 = 24, 不是 44**(Sean 2026-08-09 `Q3=A`, WCAG 2.2 SC 2.5.8)。
//    ⛔ ~~44~~ 是 Apple/WCAG 的**建議值**, 本 repo 的拍板是 24。拿 44 判會把過關的東西報成要修。
//
// 用法
//   node scripts/tap-target-probe.mjs --selftest              三道對照(= 本尺的自檢), 不印目標讀數
//   node scripts/tap-target-probe.mjs                         三道對照 + 目標讀數
//   node scripts/tap-target-probe.mjs --reveal                「這顆鈕在手機上活著沒」那三步(見下)
//   node scripts/tap-target-probe.mjs --desktop               切回「390 寬 + 滑鼠」那個世界(要比較兩邊時)
//   node scripts/tap-target-probe.mjs --url http://localhost:3020
//   node scripts/tap-target-probe.mjs --json                  給程式讀的形狀(帶 controlsOk)
//
// ⚠️ **它量不到什麼(先寫, 免得下一個人以為它全能)**:桌面瀏覽器的**合成點擊**, 不是真手指;
//    `touch-action` / 捲動中的手勢 / 兩指縮放期間的行為, 它一個都答不出。
// 🔴 **`@playwright/test` 不在 repo 根的 node_modules** —— 它裝在 `apps/storefront/node_modules`
//    ⇒ 從根目錄直接 `import` 會 `ERR_MODULE_NOT_FOUND`(2026-09-06 實測)。
//    ⇒ 用 `createRequire` 從那支 package.json 解析, 這樣**在哪個目錄呼叫本腳本都跑得起來**。
import { createRequire } from 'node:module';
const require_ = createRequire(new URL('../apps/storefront/package.json', import.meta.url));
const { chromium, devices } = require_('@playwright/test');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const URL_ = val('--url', 'https://shop.pcmmotorsports.com/');
const SELFTEST = has('--selftest');
const JSON_OUT = has('--json');
const STANDARD = 24;            // Sean 2026-08-09 Q3=A
const EXTRA = 24;               // 中心往外, 超出盒子之後還要再探多遠
const STEP = 1;

/** 三道對照 —— 這就是本尺的 selftest。少任何一道, 本尺與尺A / 尺B 分不出來。 */
const CONTROLS = [
  { key: 'pos',   label: '🟢 正對照 header 搜尋商品', sel: 'header [aria-label="搜尋商品"], header button[aria-label*="搜尋"]',
    expect: (r) => r.reachW >= 44 && r.reachH >= 44, why: '已知 44×44 ⇒ 必須量到 ≥44(證明它看得見大的)' },
  { key: 'after', label: '🔴 外擴對照 .b-hero-tick',  sel: '.b-hero-tick',
    // ⚠️ **這裡不寫死盒寬** —— `.b-hero-tick` 基底 `width:34px`, 而 `.is-on` 那一根是 `46px`
    //   (`home.css:204`), `.first()` 抓到誰要看當下輪到第幾張 ⇒ 🔴 **寫死一個數字會與它正下方的實測盒自打嘴巴**
    //   (2026-09-06 R1 抓到:我寫 34 而實測印 46)。**判別力在【高】那一維**:本體 3px, `::after` 上下各 20.5。
    expect: (r) => r.reachH > 3 * 3, why: '本體高 3px 而 CSS 有 ::after 上下外擴 ⇒ 可點高必須遠大於 3 —— 🎯 這一道專門用來殺尺A 的那個病(盒寬會隨 .is-on 在 34/46 之間變, 不是判準)' },
];

const TARGETS = [
  { label: '收藏',        sel: 'button.pcard-heart' },
  { label: '選擇規格',    sel: 'button.pcard-quick-btn' },
  { label: '箭頭',        sel: 'button.b-select-arrow' },
];

async function install(page) {
  await page.evaluate(() => {
    window.__tap = { hit: false, desc: null };
    document.addEventListener('click', (e) => {
      // 🛑 兩個都要:preventDefault 擋元素自己的 default action(導航),
      //    stopPropagation 擋祖先 handler。少一個, 這把尺會真的按下去。
      e.preventDefault();
      e.stopPropagation();
      const t = e.target;
      const probed = document.querySelector('[data-tapprobe="1"]');
      // 🔴 判「被量的那顆是不是 e.target 的祖先」, 不是逐字比 —— header 那顆的中心是它的 <svg>。
      window.__tap.hit = !!(probed && (probed === t || probed.contains(t)));
      window.__tap.desc = t
        ? t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/)[0] : '')
        : 'null';
    }, true);
  });
}

/** 點一下 (x,y), 回傳 {hit, desc}。hit=false 時 desc 就是【接走它的那個人】。 */
async function tap(page, x, y) {
  await page.evaluate(() => { window.__tap = { hit: false, desc: 'null' }; });
  await page.mouse.click(x, y);
  return page.evaluate(() => window.__tap);
}

async function probe(page, handle) {
  await handle.scrollIntoViewIfNeeded().catch(() => {});
  const box = await handle.boundingBox();
  if (!box) return { skipped: '沒有 boundingBox(不可見)' };
  await handle.evaluate((el) => el.setAttribute('data-tapprobe', '1'));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const center = await tap(page, cx, cy);
  const reach = {};
  for (const [dir, dx, dy, half] of [
    ['L', -1, 0, box.width / 2], ['R', 1, 0, box.width / 2],
    ['U', 0, -1, box.height / 2], ['D', 0, 1, box.height / 2],
  ]) {
    const max = Math.ceil(half) + EXTRA;
    let best = 0;
    for (let d = 0; d <= max; d += STEP) {
      const r = await tap(page, cx + dx * d, cy + dy * d);
      if (!r.hit) break;
      best = d;
    }
    reach[dir] = best;
  }
  await handle.evaluate((el) => el.removeAttribute('data-tapprobe'));
  return {
    boxW: Math.round(box.width), boxH: Math.round(box.height),
    // 🔴 **盒子是不是整數 px 決定 `L+R+1` 準不準** —— 非整數時取樣格點與盒邊界不對齊,
    //   估計式誤差落在 (−1, +1) ⇒ 一個「剛好等於判準」的讀數在誤差內可能是不及格的。
    //   ⇒ 把原始浮點值留著, 讓「±1 要不要跟著這個數字走」變成**看得出來的**, 不是靠記得。
    exactBox: box.width % 1 === 0 && box.height % 1 === 0,
    rawW: Number(box.width.toFixed(2)), rawH: Number(box.height.toFixed(2)),
    // 🔴 **`+1` 不是湊數, 是【端點都算】** —— 命中的整數座標從 `cx-L` 到 `cx+R`,
    //   相異點數 = `L + R + 1`。少了它每個讀數都少 1px。
    //   🟢 而它有**兩個獨立確認**, 不是靠正對照湊出來的:
    //     · header 那顆 CSS 就是 44×44 ⇒ 本式回 44
    //     · hero tick 的高由 CSS 算得出 `3 + 20.5×2 = 44` ⇒ 本式也回 44
    //   ⇒ 📌 **兩個【事先就知道答案】的目標各自吻合 ⇒ 這一項是對的, 不是我把尺改成讓它過。**
    reachW: reach.L + reach.R + 1, reachH: reach.U + reach.D + 1,
    centerHit: center.hit ? `自己(${center.desc})` : `🔴 被 ${center.desc} 接走`,
    centerOk: center.hit,
    // 🔴 撞到上限的方向, 那個數字是【下界不是精確值】—— 而它答的問題只有「≥24 嗎」, 不受上限影響。
    // 🔴 四個方向都要看 —— ⛔ ~~原本只看 L 與 U~~ ⇒ 右/下撞上限時會靜靜回一個假精確值(2026-09-06 R1)。
    capped: reach.L >= Math.ceil(box.width / 2) + EXTRA || reach.R >= Math.ceil(box.width / 2) + EXTRA
         || reach.U >= Math.ceil(box.height / 2) + EXTRA || reach.D >= Math.ceil(box.height / 2) + EXTRA,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 `--reveal` —— **回答「這顆鈕在手機上到底活著沒」, 而那不是一個尺寸問題。**
//   來源:2026-09-06 R1 Critical。我原本斷言「`.pcard-quick` 手機上看不見也按不到」,
//   而**那是推論** —— reviewer 指出第二條路徑:`ProductCard.tsx` 的 `onMouseEnter → setHover(true)`
//   ⇒ `.pcard-quick.is-visible { pointer-events: auto }`, 而**真觸控會補發相容滑鼠事件**。
//   🔬 實測(本模式印的就是這張表)⇒ 他是對的:
//     ① 什麼都沒做       opacity=0 pointer-events=none
//     ② 真 tap 卡片一下  opacity=1 pointer-events=auto   ← 它活過來了
//     ③ 再 tap 按鈕      那一下落在 button.pcard-quick-btn ← 按得到
//   🛑 **而 ② 那一下【會跳走】**(本模式會數被擋下的導航次數)
//   ⇒ ✅ **精確的說法**:它不是死的, 是**只有在客人按下那一下、而那一下會把他帶去商品頁時才亮起來。**
//   📌 **為什麼要做成模式而不是寫在註解裡**:上面那張表是【電腦讀數】,
//     而 R1 逐字指出「這份 diff 裡沒有任何工具產得出它」⇒ 一張沒有人重跑得出來的表, 下一個人只能相信我。
async function reveal(browser) {
  // 🔴 **`--reveal` 只有手機世界一種** —— 它問的就是「觸控上活著沒」。
  //   ⛔ 而它原本【收下 `--desktop` 卻照樣跑手機】並印同一個標籤(2026-09-06 R3 must-fix)
  //   ⇒ 📌 一個被忽略的旗標比一個不支援的旗標危險:使用者以為他量的是另一個世界。
  if (has('--desktop')) {
    console.log('🔴 `--reveal` 不支援 `--desktop` —— 它問的是【觸控裝置上】活著沒, 桌機世界沒有這個問題。');
    return 1;
  }
  const page = await browser.newPage({ ...devices['iPhone 12'] });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2500);
  // 擋掉導航, 否則第一下就跳走 —— 而「它會跳走」本身是答案的一部分, 所以要數。
  await page.evaluate(() => {
    window.__nav = 0; window.__hit = null;
    document.addEventListener('click', (e) => {
      // 🔴 **只數【真的會導航】的那一下**(2026-09-06 R3 must-fix)——
      //   ⛔ 原本對任何被捕捉到的 click 都 `++` ⇒ 卡片就算沒有連結, `tapLanded` 照樣成立
      //   ⇒ 📌 那個計數器答的是「有沒有人點到東西」, 而我拿它當「那一下會跳走」的證據。
      if (e.target instanceof Element && e.target.closest('a[href]')) window.__nav++;
      window.__hit = e.target.tagName.toLowerCase() + (typeof e.target.className === 'string' && e.target.className.trim()
        ? '.' + e.target.className.trim().split(/\s+/)[0] : '');
      // 🛑 **兩個都要**(2026-09-06 R2 nit)—— 本檔 `:77` 自己寫了「缺一不可」, 而這裡原本只有前者。
      //   今天不出事**只因為** `ProductCard.tsx` 的 `quickAdd` 對每個 variantCount 都提早 return
      //   ⇒ 📌 **安全來自別處的產品決定, 不是這支量具**。而預設靶是 production ⇒ 不賭。
      e.preventDefault();
      e.stopPropagation();
    }, true);
  });
  const snap = () => page.evaluate(() => {
    const q = document.querySelector('.pcard-quick');
    if (!q) return null;
    const cs = getComputedStyle(q);
    return { cls: q.className.trim(), opacity: cs.opacity, pe: cs.pointerEvents, nav: window.__nav, hit: window.__hit };
  });
  const rows = [];
  rows.push(['① 什麼都還沒做', await snap()]);
  // 🔴 **靶上沒有商品卡時要印【前提失效】, 不是丟一個 TimeoutError 出去**(2026-09-06 自驗負對照:
  //   拿 `/stores` 當靶 ⇒ 原本 rc=1 而那是**當掉**, 不是本模式的判定 ——
  //   📌 **當掉與 FAIL 在 rc 上都是 1**, 而讀的人分不出「量到它壞了」與「量具自己爆了」。)
  const cards = await page.locator('.pcard').count();
  if (cards > 0) {
    await page.locator('.pcard').first().tap();
  } else {
    console.log(`\n靶 ${URL_}\n\n🔴 前提失效:這一頁上【沒有商品卡】(.pcard 命中 0)⇒ 本模式量不了任何東西。`);
    await page.close();
    return 1;
  }
  await page.waitForTimeout(600);
  rows.push(['② 真觸控 tap 卡片一下', await snap()]);
  // 🔴 **按鈕不存在 ⇒ 走【前提失效】, 不要讓 `boundingBox()` 等到 timeout**(2026-09-06 R3 must-fix)
  //   ⇒ 📌 timeout 會變成「當掉」, 而**當掉與 FAIL 在 rc 上都是 1**。
  if (await page.locator('button.pcard-quick-btn').count() === 0) {
    console.log(`\n靶 ${URL_}\n\n🔴 前提失效:頁面上有商品卡而【沒有 button.pcard-quick-btn】⇒ 本模式量不了。`);
    await page.close();
    return 1;
  }
  const bb = await page.locator('button.pcard-quick-btn').first().boundingBox();
  if (bb) { await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(400); }
  rows.push(['③ 再 tap 按鈕一下', await snap()]);
  await page.close();
  console.log(`\n靶 ${URL_}  ·  真手機模擬 iPhone 12  ·  \`.pcard-quick\` 在手機上活著沒\n`);
  for (const [tag, r] of rows) {
    if (!r) { console.log(`  ${tag.padEnd(24)} 🔴 頁面上沒有 .pcard-quick ⇒ 前提失效, 本次作廢`); continue; }
    console.log(`  ${tag.padEnd(24)} class="${r.cls}"  opacity=${r.opacity}  pointer-events=${r.pe}  (被擋下的導航 ${r.nav} 次)`);
  }
  console.log(`  第三步那一下實際落在:${rows[2][1]?.hit ?? '(量不到)'}`);
  // 🔴🔴 **這句結論【由讀數決定】, 不是無條件印**(2026-09-06 R2 must-fix ——
  //   而它是 R1 C3 那個病【在新模式裡復發】:同一顆 commit 裡我才剛修掉一個「判定標籤不由結果決定」)。
  //   前提有兩個, 兩個都要真:②那一下**真的落地了**(nav 有增加)· ②**真的把它打開了**(opacity 變 1)。
  //   任一不成立 ⇒ 印「前提失效」並 **rc=1**, 而不是印那句讀法。
  const s1 = rows[0][1], s2 = rows[1][1], s3 = rows[2][1];
  const tapLanded = !!(s1 && s2 && s2.nav > s1.nav);
  // 🔴 **要比【前後】, 不是只看後面那一格**(2026-09-06 R3 must-fix)——
  //   ⛔ 原本 `opacity !== '0'` ⇒ 一個本來就 `opacity:.5; pointer-events:auto` 的世界也會過,
  //     而那個世界裡「它是被我這一下打開的」根本不成立。
  //   ⇒ ✅ 三個條件一起:①之前是關的 ②之後是開的 ③**第三下真的落在那顆鈕上**。
  const wasClosed = !!(s1 && s1.opacity === '0' && s1.pe === 'none');
  const nowOpen = !!(s2 && Number(s2.opacity) === 1 && s2.pe === 'auto');
  const btnGotIt = !!(s3 && s3.hit && s3.hit.startsWith('button.pcard-quick-btn'));
  const opened = wasClosed && nowOpen && btnGotIt;
  if (tapLanded && opened) {
    console.log('\n🛑 讀法:② 那一下【會跳走】(導航被擋下才看得到這一格)⇒ 客人在真手機上拿不到這個狀態。');
    return 0;
  }
  console.log(`\n🔴 前提失效, 本次不下結論:${tapLanded ? '' : '那一下沒有落在會導航的東西上 '}${wasClosed ? '' : '①本來就不是關的 '}${nowOpen ? '' : '②沒有變成完全打開 '}${btnGotIt ? '' : '③那一下沒落在 pcard-quick-btn 上 '}`);
  console.log('   ⇒ 這一發【不能】拿來說「客人拿不到」, 也不能說「客人拿得到」。先查靶或選擇器。');
  return 1;
}

const out = { url: URL_, standard: STANDARD, controls: [], targets: [], neg: null };
const browser = await chromium.launch();
if (has('--reveal')) { const rc = await reveal(browser); await browser.close(); process.exit(rc); }
// 🔴🔴 **預設用【真手機模擬】, 不是「把視窗縮到 390 寬」** —— 這兩個世界不一樣,
//   而它們的差別正好落在本尺要回答的那件事上(2026-09-06 實測):
//     390 寬 + 滑鼠   `matchMedia('(hover: none)')` = false ⇒ `@media (hover: none)` 那些規則【不生效】
//     真手機模擬      = true ⇒ 生效 ⇒ `.pcard-heart` 從 opacity:0/pointer-events:none 變成 1/auto
//   ⇒ 📌 **只縮視窗去量手機, 會量到一個【客人不會遇到的】頁面。**
//   `--desktop` 可以切回舊世界(要比較兩邊時用)。
const page = has('--desktop')
  ? await browser.newPage({ viewport: { width: 390, height: 844 } })
  : await browser.newPage({ ...devices['iPhone 12'] });
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2500);
await install(page);

let bad = 0;
for (const c of CONTROLS) {
  const h = await page.locator(c.sel).first().elementHandle().catch(() => null);
  if (!h) { out.controls.push({ ...c, expect: undefined, why: c.why, fail: '選擇器查無' }); bad++; continue; }
  const r = await probe(page, h);
  const ok = !r.skipped && c.expect(r);
  if (!ok) bad++;
  out.controls.push({ key: c.key, label: c.label, why: c.why, ok, ...r });
}

// ⚪ 負對照:中心 +200px 那一點【不得】記到該控制項 ⇒ 證明這把尺說得出「不是」。
{
  const h = await page.locator(CONTROLS[0].sel).first().elementHandle().catch(() => null);
  if (h) {
    const b = await h.boundingBox();
    await h.evaluate((el) => el.setAttribute('data-tapprobe', '1'));
    const r = await tap(page, b.x + b.width / 2, b.y + b.height / 2 + 200);
    await h.evaluate((el) => el.removeAttribute('data-tapprobe'));
    out.neg = { ok: !r.hit, desc: r.desc };
    if (r.hit) bad++;
  } else { out.neg = { ok: false, desc: '選擇器查無' }; bad++; }
}

if (!SELFTEST) {
  for (const t of TARGETS) {
    const n = await page.locator(t.sel).count();
    for (let i = 0; i < Math.min(n, 10); i++) {
      const h = await page.locator(t.sel).nth(i).elementHandle();
      out.targets.push({ label: `${t.label} #${i + 1}`, ...(await probe(page, h)) });
    }
  }
}
await browser.close();

// 🔴🔴 **對照沒過 ⇒ 讀數作廢, 而【作廢的東西不可以印成一張表】**(2026-09-06 R1 Critical)。
//   ⛔ ~~原本:讀數照樣整段印, 每列還自帶 ✅/❌, 而「讀數作廢」印在最下面一行~~
//   ⇒ 📌 撞上本 repo 記過的「判定標籤不由結果決定」—— 一張帶勾的表, 沒有人會捲到最後一行才決定要不要信它。
//   ✅ 現在:`bad > 0` ⇒ **讀數不印**, 只印哪一道對照沒過。`--json` 也帶 `controlsOk`, 讓程式讀的那一端擋得住。
out.controlsOk = bad === 0;
if (!out.controlsOk) out.targets = [];
if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(bad ? 1 : 0); }

console.log(`\n靶 ${out.url}  ·  ${has('--desktop') ? '390×844 + 滑鼠(hover: hover)' : '真手機模擬 iPhone 12(hover: none)'}  ·  判準 ≥ ${STANDARD}(Sean 2026-08-09 Q3=A, 不是 44)\n`);
console.log('── 三道對照(= 本尺的 selftest;少一道就與尺A / 尺B 分不出來)──');
for (const c of out.controls) {
  console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}  盒 ${c.boxW}×${c.boxH} ⇒ 可點 ${c.reachW}×${c.reachH}`);
  console.log(`      ${c.why}`);
}
console.log(`  ${out.neg.ok ? '✅' : '❌'} ⚪ 負對照 中心 +200px ⇒ 接到 ${out.neg.desc}(不得是它自己)`);
if (bad > 0) {
  console.log(`\n🔴 ${bad} 道對照沒過 ⇒ **讀數作廢, 本次不印** —— 先修對照, 不要拿這一發的數字去回報任何事。`);
} else if (!SELFTEST && out.targets.length) {
  console.log('\n── 讀數(兩欄:可點區 + 中心那一下被誰接到)──');
  for (const t of out.targets) {
    if (t.skipped) { console.log(`  ${t.label.padEnd(14)} ⚠️ ${t.skipped}`); continue; }
    const v = Math.min(t.reachW, t.reachH);
    // ⚠️ `±1` 與「撞上限」要**印在數字旁邊**跟著走 —— 只進 `--json` 的守門等於沒有(R1 nit)。
    const flags = `${t.exactBox ? '' : ' ⚠️±1(盒非整數 ' + t.rawW + '×' + t.rawH + ')'}${t.capped ? ' ⚠️撞探測上限(下界)' : ''}`;
    console.log(`  ${t.label.padEnd(14)} 盒 ${String(t.boxW).padStart(3)}×${String(t.boxH).padStart(3)}  可點 ${String(t.reachW).padStart(3)}×${String(t.reachH).padStart(3)}  ${v >= STANDARD ? '✅' : '❌'} ${t.centerHit}${flags}`);
  }
  const fails = out.targets.filter((t) => !t.skipped && Math.min(t.reachW, t.reachH) < STANDARD);
  console.log(`\n量到 ${out.targets.filter((t) => !t.skipped).length} 個 · 跳過 ${out.targets.filter((t) => t.skipped).length} · < ${STANDARD} 的有 ${fails.length} 個`);
}
console.log(`\n${bad === 0 ? '🟢 三道對照全過 —— 上面的讀數才算數' : '🔴 對照沒過(詳見上一行)'}`);
process.exit(bad ? 1 : 0);
