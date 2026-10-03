import { afterEach, describe, expect, it } from 'vitest';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// 測自己這個 app 的根 `next.config`(同 admin 那支)。
// 🔴 **2026-08-29 codex must-fix:原寫的理由是錯的** —— 實跑訊息逐字是
//    「apps/storefront → apps/storefront 沒有一條規則允許」⇒ **成因是「app 讀自己」,不是型別。**
// 🔴 **重判時機**:`boundaries/dependencies` 多一條允許「app 讀自己」⇒ 下面那行 disable 就該刪。
// eslint-disable-next-line boundaries/dependencies
import nextConfig from './next.config';
// 🔴 **這是真的跨 app import,而它是刻意的。**
// 下面那段註解(接線測試 MAIN-127 ④)逐字說明為什麼:**判定層的測試在 `apps/admin/src/lib/`,
// 這裡只驗「真的裝在路上」** —— storefront 是量到「實際打過正式庫」痕跡的那個入口。
// 🔴 **重判的時機(這是一把尺,不是一句「請相信我」)**:
// 哪一天 `DB_KEY_PATTERN` 不再住在 `apps/admin/src/lib/dev-db-guard`(判定層搬家 / 抽進
// `packages/`)⇒ **下面那行 disable 與這個 import 都要重判**,而那時正確的做法多半是
// 把它抽成共用,不是繼續跨過來拿。
// 🔴🔴 **2026-08-29 codex 對【這一行豁免本身】投了 FAIL,而我保留它 —— 理由要寫下來**:
//    codex 逐字:「這是真正的跨 app 匯入,卻把新啟用的 `boundaries/dependencies` 警報壓掉…
//    修法:將 `DB_KEY_PATTERN`/guard 抽到共用 `packages/`,兩個 app 分別匯入,並刪除豁免。」
//    ✅ **它是對的,而那是一個【搬碼】的改動** —— 本片的界是「讓 lint 掃測試檔」,
//    而不給豁免的代價是**全隊 `pnpm lint` 立刻紅**,那道閘會被關掉(今晚量過那個下場)。
//    ⇒ **保留豁免 = 刻意的技術債,不是判它沒問題。** 已登記進工作池
//      (`Sat Aug 29 12:01:07 CST 2026`,獨立一件,不需要 Sean)。
// 🔴 **什麼時候該還** —— 「已登記」會讓下一個人以為**有人在追**,而工作池是一份會被
//    清空的檔 ⇒ 那筆債會跟著消失。**所以還款的觸發條件寫在這裡,不是只寫在池子上**:
//    **① 下一次有人要動 `apps/admin/src/lib/dev-db-guard.*` 的介面 ⇒ 當場還**
//       (那正是 codex 指的失敗情境:admin 重構連帶弄壞 storefront,而 lint 不會攔)
//    **② 或 `packages/` 底下開始有共用的 env / DB 判定 ⇒ 那時搬過去幾乎零成本**
//    📌 **一筆沒有還款觸發條件的債,與一個永遠不會被想起的決定,在 code 上長得一樣。**
// eslint-disable-next-line boundaries/dependencies
import { DB_KEY_PATTERN } from '../admin/src/lib/dev-db-guard';

// 🔴 **接線測試(MAIN-127 ④,與 admin 的同型)**:storefront 是量到「實際打過正式庫」痕跡的
//    那個入口,而它原本沒接閘。判定層的測試在 apps/admin/src/lib/;這裡只驗「真的裝在路上」——
//    把 next.config.ts 裡的 gate 呼叫刪掉,下面該紅的兩案一案都不會紅,正是要防的形態。

// 獨立字面(同 must-fix-5 慣例)。
const PROD_URL = 'https://bmpnplmnldofgaohnaok.supabase.co';

describe('storefront next.config 真的呼叫了那道正式庫閘', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  // vitest 不載 .env*,但開發者 shell 可能全域 export DB 類變數 ⇒ 先清乾淨,
  // 「該綠」那案才有判別力(否則外洩的遠端變數會把它變成假紅)。
  function scrubDbEnv(): void {
    // 逃生門也要清(codex R1 nit):shell 若全域 export =1,「該擋」案會靜默變放行。
    // key 清單直接用 guard 的 DB_KEY_PATTERN(R2 N-3:兩份復刻會各自漂)。
    delete process.env.PCM_ALLOW_PROD_DB_DEV;
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && (DB_KEY_PATTERN.test(k) || v.includes('bmpnplmnldofgaohnaok'))) {
        delete process.env[k];
      }
    }
  }

  it('dev phase + 正式庫 ref ⇒ next.config 本身要 throw', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).toThrowError(/next dev 已停止/);
  });

  it('🔴 build phase + 同一組 env ⇒ 不得 throw(Vercel / next build 不能被擋掉)', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_URL;
    expect(() => nextConfig(PHASE_PRODUCTION_BUILD)).not.toThrow();
  });

  it('🔴 dev phase + 只有本機 DB ⇒ 不 throw(證明不是恆擋)', () => {
    scrubDbEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    expect(() => nextConfig(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 舊 WordPress `/index.html` 的轉址(2026-09-17)
//
// 🔴 **這一格守的是【射程】,不是「有沒有這條規則」** —— 寫成 `/:path*.html` 或
//    `/(.*)/index.html` 會把 Search Console 那 29 筆【本來就該 404】的舊網址
//    一起導去首頁 = 假的相關性,Google 判 soft-404。
// 🛑 **它證不到真的狀態碼**(這裡沒有伺服器)⇒ 真值要靠 plan §4 那幾發 curl。
describe('舊站 /index.html 轉址', () => {
  // 🔵 `PHASE_PRODUCTION_BUILD` ⇒ 不走 dev DB 閘(那道閘只在 dev phase 跑)
  //    ⇒ 這裡不必動任何 env,`redirects()` 本來就與資料庫無關。
  const redirectsOf = async () => {
    const cfg = nextConfig(PHASE_PRODUCTION_BUILD);
    return (await cfg.redirects?.()) ?? [];
  };

  it('首頁舊網址仍精準導向 /，不被新增分類規則改寫', async () => {
    const rules = await redirectsOf();
    expect(rules).toContainEqual({ source: '/index.html', destination: '/', permanent: true });
  });

  it('🔴 是永久(308)不是暫時 —— 307 的話 Google 會一直回來看, 「已修正」永遠不會通過', async () => {
    const rules = await redirectsOf();
    expect(rules.every((rule) => rule.permanent === true)).toBe(true);
  });

  // 🔴🔴 **負對照 —— 這一格 2026-09-17 R1 審查判為【空包彈】,整個重寫。**
  //    ⛔ ~~舊版拿 `rules[0].source` 去跟舊網址**比字串相不相等**~~
  //    ⇒ 把規則寫成 `/:path*/index.html`(正是註解裡點名最怕的那種寫寬),
  //      `source` 當然還是不等於 `/author/index.html` ⇒ **它照樣綠。**
  //    📌 **比字串相等,量不到「這條規則吃不吃得到那個網址」——那是兩件事。**
  //
  // 🔵 **本版改成擋【會讓射程變寬的語法】。** 為什麼不直接編譯 source 去比對命中:
  //    Next 那顆 `next/dist/compiled/path-to-regexp` **沒有附型別檔** ⇒ import 它會
  //    TS7016 而 `as unknown as` 救不了(錯在 import 本身,不在賦值)⇒ 要嘛加 `.d.ts`、
  //    要嘛 disable 一條 lint。**兩個都比這道閘本身貴。**
  //
  // 🔴 **而【實際射程】我用 Next 自己的編譯器算過(2026-09-17),逐字記在這裡**:
  //      ^(?!\/_next)\/index\.html(?:\/)?$        旗標 i
  //    ⇒ 大小寫不分、尾斜線可有可無。CSV 那 29 筆**逐一丟進去 0 命中**。
  //    重算(不用 build):
  //      N=$(ls -d node_modules/.pnpm/next@*/node_modules/next | head -1)
  //      node -e "const b='$PWD/'+'$N';
  //        const {pathToRegexp}=require(b+'/dist/compiled/path-to-regexp');
  //        const {modifyRouteRegex}=require(b+'/dist/lib/redirect-status');
  //        console.log(modifyRouteRegex(pathToRegexp('/index.html',[],
  //          {strict:true,sensitive:false,delimiter:'/'}).source,['/_next']));"
  //
  // 🛑 **所以這一格守的是【語法】,不是【命中】** —— 它擋得住所有把射程寫寬的寫法,
  //    而「這條規則會不會吃到某個網址」的真值,靠 plan §4 那幾發 curl。**講清楚它守不到什麼。**
  it('🔴 source 不得帶任何會讓射程變寬的語法(冒號參數 / 萬用字元 / 群組)', async () => {
    // 2026-10-04 Sean 批 Q2 甲:唯一例外是「只限根網域」的整站轉址(下面〈根網域轉址〉那組逐欄守它);
    //   它的射程靠 host 條件收窄, 不靠 source。其他舊網址規則照舊一條都不准寬。
    const rules = (await redirectsOf()).filter((r) => !r.has?.some((h) => h.type === 'host'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const [token, why] of [
        [':', '冒號參數(例 /:path*/index.html)會吃到任意前綴'],
        ['*', '萬用字元會吃到任意深度'],
        ['(', '正則群組會讓射程變成另一件事'],
        ['?', '選擇性區段會多吃一層'],
      ] as const) {
        expect(rule.source.includes(token), `${rule.source} 帶了 \`${token}\` ⇒ ${why}`).toBe(false);
      }
    }
  });

  it.each([
    ['/原廠零件-pcm-重機零件販售-pcm-motor', '/'],
    ['/category/brands', '/brands'],
    ['/category/brands/index.html', '/brands'],
  ])('舊站有明確替代內容：%s 永久導向 %s', async (source, destination) => {
    const rules = await redirectsOf();
    // Next 收到的中文 pathname 是 percent-encoded；source 留中文字面時設定物件看似正確，
    // 但 production server 實際匹配不到。encodeURI 保留 `/`，只編碼中文與空白。
    expect(rules).toContainEqual({
      source: encodeURI(source),
      destination,
      permanent: true,
    });
  });

  it.each([
    '/author/blueplustsai',
    '/hello-world',
    '/comments/feed',
    '/category/brands/feed',
    '/改裝精品',
    '/耗材零件工具',
    '/車身改裝精品',
    '/category/cases',
  ])('沒有可信替代內容：%s 不得被假導向', async (source) => {
    const rules = await redirectsOf();
    expect(rules.some((rule) => decodeURI(rule.source) === source)).toBe(false);
  });
});

// 2026-09-25 Q7 甲:註冊頁的 BotID 靠這兩條改寫從我們自己的網域載入檢查腳本。
// 拿掉 withBotId ⇒ 瀏覽器端拿不到檢查資料 ⇒ 正式站每一筆註冊都會被判成機器人。
describe('BotID 改寫規則', () => {
  it('正式建置的設定帶有 BotID 的轉接改寫', async () => {
    const rewrites = await nextConfig(PHASE_PRODUCTION_BUILD).rewrites?.();
    const list = Array.isArray(rewrites) ? rewrites : [...(rewrites?.beforeFiles ?? []), ...(rewrites?.afterFiles ?? [])];
    const botid = list.filter((r) => r.destination.startsWith('https://api.vercel.com/bot-protection/'));
    expect(botid.map((r) => r.destination)).toEqual([
      'https://api.vercel.com/bot-protection/v1/challenge',
      'https://api.vercel.com/bot-protection/v1/proxy/:path*',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 安全標頭(2026-09-29;計畫 ~/pcm-mailbox/計畫-安全標頭-20260928.md)
describe('安全標頭', () => {
  const globalHeaders = async () => {
    const rules = (await nextConfig(PHASE_PRODUCTION_BUILD).headers?.()) ?? [];
    // withBotId 會在後面替自己的路徑再補一條 ⇒ 只看 /:path* 那條,不斷言陣列長度。
    return rules.find((r) => r.source === '/:path*')?.headers ?? [];
  };
  const valueOf = async (key: string) => (await globalHeaders()).find((h) => h.key === key)?.value;

  it('全站有 nosniff、防嵌入、權限、Referrer-Policy 與 CSP Report-Only', async () => {
    const keys = (await globalHeaders()).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining([
      'X-Content-Type-Options', 'X-Frame-Options', 'Content-Security-Policy',
      'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy-Report-Only',
    ]));
  });

  it("🔴 防嵌入是 'self' 不是 'none'(BotID 用同網域框架,設 'none' 註冊頁可能壞掉)", async () => {
    expect(await valueOf('Content-Security-Policy')).toBe("frame-ancestors 'self'");
    expect(await valueOf('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('🔴 直接生效的 CSP 只有 frame-ancestors;其他規則只在 Report-Only(不擋客人)', async () => {
    expect(await valueOf('Content-Security-Policy')).not.toMatch(/script-src|img-src|default-src/);
    expect(await valueOf('Content-Security-Policy-Report-Only')).toContain('report-uri https://www.pcmmotorsports.com/api/csp-report');
  });

  it('不送 X-Powered-By', () => {
    expect(nextConfig(PHASE_PRODUCTION_BUILD).poweredByHeader).toBe(false);
  });

  // 🔴 路由自己 set 過的標頭,next.config 不能再設同名的:Next 會以 next.config 為準、把路由的丟掉。
  //    只掃 apps/storefront/src;packages/ 今天 0 處自己設標頭。
  it('🔴 沒有任何路由自己設了 next.config 也在設的標頭', async () => {
    const keys = (await globalHeaders()).map((h) => h.key.toLowerCase());
    const files = readdirSync(join(__dirname, 'src'), { recursive: true })
      .filter((p): p is string => typeof p === 'string' && /\.(ts|tsx)$/.test(p) && !p.includes('.test.'));
    const clash = files.flatMap((p) => {
      const code = readFileSync(join(__dirname, 'src', p), 'utf8').toLowerCase();
      return keys.filter((k) => code.includes(`'${k}'`) || code.includes(`"${k}"`)).map((k) => `${p}: ${k}`);
    });
    expect(files.length).toBeGreaterThan(100);
    expect(clash).toEqual([]);
  });

  // 2026-10-04 Sean 批 Q2 甲(~/pcm-mailbox/計畫-網站安全標頭與網域-20261004.md §二):
  //   HSTS 要帶 includeSubDomains 才涵蓋全部子網域;不加 preload(進了瀏覽器內建清單要幾個月才撤得回)。
  it('🔴 HSTS 送兩年 + includeSubDomains, 不帶 preload', async () => {
    expect(await valueOf('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
  });
});

// 2026-10-04 Sean 批 Q2 甲:根網域原本由 Vercel 網域設定直接轉到 www, 不經過網站程式 ⇒ 根網域收不到 HSTS。
//   改成網站程式轉址, 根網域的 308 回應才會帶上 next.config 的安全標頭(含 includeSubDomains)。
// 🛑 這組守的是設定物件;根網域實際有沒有走到這條規則, 要等 Sean 把 Vercel 網域設定的轉址拿掉後用真瀏覽器驗。
describe('根網域轉址', () => {
  const apexRules = async () =>
    ((await nextConfig(PHASE_PRODUCTION_BUILD).redirects?.()) ?? []).filter((r) => r.has?.some((h) => h.type === 'host'));

  it('🔴 只有一條 host 條件規則, 只限根網域, 整站永久轉到 www 並保留路徑', async () => {
    expect(await apexRules()).toEqual([
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'pcmmotorsports.com' }],
        destination: 'https://www.pcmmotorsports.com/:path*',
        permanent: true,
      },
    ]);
  });
});
