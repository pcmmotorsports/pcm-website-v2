import { test, expect } from '@playwright/test';
import { probeSql, requireProbe } from './probe';

/**
 * 後台出貨清單 E2E(2026-09-18;Sean 拍甲「只補後台出貨,刷卡那條不補」)。
 *
 * 🎯 **這支補的那一格,講窄一點**:**出貨清單那一頁的【渲染】**,對**真的頁面 + 真的庫**。
 *   ⇒ 它打真的頁面、看畫面上真的印出來的字,不是只呼叫函式。
 *
 * 🛑 **而它【不是】「後台出貨有 E2E 守著」** —— 三件事要講平,免得被讀寬:
 *   · **建箱 / 標出貨 / 作廢那三個動作,這支【一個都沒走到】** ——
 *     它們住在 `components/orders/shipment-dialog.tsx` / `shipment-mark-shipped-button.tsx` /
 *     `shipment-void-button.tsx`,而**那三支本來就各有 vitest**。
 *     ⇒ 📌 所以 a1 那句「現有測試全綠因為根本不走到那一步」**對那三支並不成立**;
 *        真正沒人守的是「**整頁渲染 + 真的庫**」那一格,而這支補的就是它。
 *   · **它不會自己跑** —— 沒掛 CI、沒進 `pnpm test`(`vitest.config.ts` 的 e2e 目錄排除規則)。
 *     要人手動起鑽機 + 帶兩顆 env 才動。**不要寫成「有 E2E 守著」。**
 *
 * ── 🛑 這片【守不到】什麼(三條,寫在最前面,免得被讀成「後台都測了」)──────────
 * ① **鑽機走 `ADMIN_DEV_BYPASS`、沒有 `/auth/v1` 替身。** `admin-probe/up.sh:32` 逐字:
 *    「這條鏈**沒有** `/auth/v1` 替身(admin 走 DEV_BYPASS)⇒ **證不了 admin 的登入閘**」
 *    ⛔ ~~「鑽機是免登入的」~~ —— 那句**比出處寬**:`env.sh:33-34` 說 `authorizeAdminMutation()`
 *       有三道閘(① session ② Origin ③ 具名 actor),而 `DEV_BYPASS` **只放寬第②道**。
 *    ⇒ 📌 **這片守得到「出貨那一頁的行為」,守不到「誰能進來」。**
 * ② **鑽機的表是空的。** 那一頁沒種子時印「沒有建立任何箱子」——
 *    🔴 而 `seed-shipment-list.sql` 檔頭自己警告過:**那與「這一頁壞了」長得一模一樣**
 *    ⇒ 一發沒種子的測試是**零判別力**,不是通過。
 *    ⇒ ✅ 所以下面第一格就是**前提格**:種子在不在。它紅 ⇒ 底下每一格都不算數。
 * ③ **鑽機的庫是 replay 全部 migrations 建的** ⇒ 出貨那幾支 RPC 都在(這是它跑得起來的原因)。
 *
 * ── 🔴 而【寄信】那一格,證法是正向的(不是「我沒看到它送」)──────────────────
 *   · `apps/admin/src/app/api/` 只有 `session` / `sso` ⇒ **admin 這個 app 沒有任何 cron route**
 *   · 實打鑽機:`/api/cron/email-sweep` ⇒ **404**(那條路在 3011 上根本不存在)
 *   · 鑽機是**零 secret**(`up.sh:9` 逐字)⇒ 沒有 `RESEND_API_KEY`,而寄信端是
 *     `requireEnv('RESEND_API_KEY')` ⇒ **建不起來、會 throw**
 *   ⇒ 🎯 三條**任一**成立就夠,而三條**同時**成立 ⇒ 所以敢說「不會送」。
 *   🛑 限度:證的是**鑽機上不會送**;正式環境那條路**本來就會送**,那是它存在的理由。
 *
 * 🔵 種子:`scripts/admin-probe/seed-shipment-list.sql`(四箱,逐欄抄自 2026-09-10 唯讀正式庫)。
 *   跑法:`psql -h 127.0.0.1 -p $ADMIN_PROBE_PG -U postgres -f scripts/admin-probe/seed-shipment-list.sql`
 */

/**
 * 🔴 那一頁**依日期過濾**,而參數名是 `day` **不是** `date`(2026-09-18 實打:`?date=` 會得到空狀態)。
 * ⚠️ **而前提格與頁面不是同一把尺**:前提格用 `created_at::date`(psql session TZ),
 *    頁面用台北窗(`app/shipments/page.tsx:80-83`)。今天那四筆兩把尺都落在 09-10 ⇒ 等價;
 *    **改種子時間的人要知道它們會分家。**
 */
const SEED_DAY = '2026-09-10';
const LIST_URL = `/shipments?day=${SEED_DAY}`;

/** 種子那四箱與它們**刻意不同**的狀態(邊界都踩到:作廢 / 已送出 / 不同物流)。 */
const SEEDED = [
  { ref: 'ZNDXJP', state: '已作廢' },
  { ref: 'ZN2HDP', state: '已作廢' },
  { ref: 'XS6XVY', state: '已作廢' },
  { ref: 'S9FC6P', state: null },
] as const;

test.describe('後台出貨清單(鑽機)', () => {
  test.beforeEach(() => requireProbe());

  test('🔴 前提:種子在不在 —— 這一格紅, 底下每一格都不算數', () => {
    // 🛑 沒有這一格, 「頁面是空的」與「頁面壞了」在下面每一格都長得一樣,
    //    而**空的那一版會全部通過** —— 那正是本檔最想防的那種綠。
    const n = probeSql(`SELECT count(*) FROM public.shipments WHERE created_at::date = '${SEED_DAY}'`);
    expect(
      Number(n),
      `鑽機裡 ${SEED_DAY} 沒有箱子 ⇒ 先跑 scripts/admin-probe/seed-shipment-list.sql`,
    ).toBe(SEEDED.length);
    // 🔴 **也要數作廢那三箱** —— 種子的第③步(翻成已出貨/已作廢)若哪天 0 列命中,
    //   箱數照樣是 4 ⇒ **前提格綠、而清單格紅** ⇒ 會被讀成「有人改壞了畫面」,
    //   而那正是這支檔最想防的混淆。⇒ 讓前提格自己說得出「種子種到第幾步」。
    const voided = probeSql(
      `SELECT count(*) FROM public.shipments WHERE created_at::date = '${SEED_DAY}' AND deleted_at IS NOT NULL`,
    );
    expect(Number(voided), '種子的第③步(翻成已作廢)沒生效 ⇒ 下面那格會紅在錯的地方').toBe(3);
  });

  test('出貨清單那一頁:四箱都印得出來, 而且狀態分得出來', async ({ page }) => {
    await page.goto(LIST_URL);
    const main = page.getByRole('main');

    // 🔵 先確認**不是空狀態** —— 空狀態下面每一格都會以「找不到」失敗, 而那讀起來像別的病。
    await expect(main.getByText('沒有建立任何箱子')).toHaveCount(0);

    for (const box of SEEDED) {
      await expect(main.getByText(box.ref, { exact: false }).first()).toBeVisible();
    }

    // 🔴 **作廢那三箱要印「已作廢」** —— 這一格守的是「狀態欄有沒有被改壞」,
    //    而那正是 a1 說的「有人改後台出貨畫面」最容易壞的地方。
    await expect(main.getByText('已作廢')).toHaveCount(3);
  });

  test('🔵 負對照:挑一個【沒有箱子的日期】⇒ 那一頁要印空狀態, 而不是照樣印那四箱', async ({ page }) => {
    // 🛑 沒有這一格, 上面那格可能只是「不管挑哪一天都印同一批」——
    //    那種頁面在畫面上看起來完全正常, 而它其實沒有在過濾。
    await page.goto('/shipments?day=2019-01-01');
    const main = page.getByRole('main');
    await expect(main.getByText('沒有建立任何箱子')).toBeVisible();
    for (const box of SEEDED) {
      await expect(main.getByText(box.ref, { exact: false })).toHaveCount(0);
    }
  });
});
