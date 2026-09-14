import { test, expect } from '@playwright/test';
import { loginAsProbeUser, probeSql, requireProbe } from './probe';

/**
 * 顧客站 happy path(M-6-05;Sean 2026-09-14 拍 Q13 甲:只做這一條 + 出過事的點, 不掛 CI)。
 *
 * 找商品 → 看商品 → 加入購物車 → 結帳(登入 → 收件地址 → ATM 轉帳 → 同意 → 送出)
 * → 訂單明細頁 → DB:orders 有這張單、寄信線的掃描面看得到它。
 *
 * 🔴 走【匯款】不走刷卡:鑽機的 next dev 是在 worktree 起的, 沒有 TapPay 伺服端金鑰,
 *    刷卡那條在這裡永遠走不到 TapPay ⇒ 不假裝。刷卡 sandbox 要在主樹或補 env 才驗得到。
 *
 * 🔴 「outbox 有一封」這一格, 這支證到的是【掃描面】`pcm_bank_order_created_email_pending` 有這張單 ——
 *    那正是 `/api/cron/email-sweep` 每輪 `enqueueBankOrderCreatedEmails` 讀的那一張。真的寫進 `email_outbox`
 *    要跑那條 cron, 而它 `requireEnv('RESEND_API_KEY')` 且會真的寄(up.sh 檔頭明令不打 /api/cron/*)⇒ 不在這裡做。
 *
 * 種子:`scripts/storefront-probe/seed.sql` 的 `g3-probe-0002`(BONAMICI 鋁合金腳踏後移組, 兩個顏色變體,
 * 預設「黑」= 料號 G3-0002-BLK, NT$ 4,140;運費 100 ⇒ 總額 4,240)。
 */

const PRODUCT_HANDLE = 'g3-probe-0002';
const PRODUCT_TITLE = '鋁合金腳踏後移組 — BONAMICI RACING';
const ADDRESS = {
  name: '探針測試客人',
  phone: '0912345678',
  line: '台北市中山區南京東路一段 1 號',
  email: 'probe@example.com',
} as const;

test.describe('顧客站 happy path(鑽機)', () => {
  test.beforeEach(() => requireProbe());

  test('找商品 → 看商品 → 加購 → 匯款結帳 → 訂單明細 → 寄信線看得到', async ({ page }) => {
    // ── 找商品:目錄搜尋關鍵字, 結果裡有那一件 ──
    await page.goto(`/products?search=${encodeURIComponent('鋁合金腳踏後移組')}`);
    await expect(page.getByRole('main').getByText(/^[1-9]\d* 件商品$/).first()).toBeVisible();
    const card = page.locator(`a[href^="/products/${PRODUCT_HANDLE}"]`).first();
    await expect(card).toBeVisible();
    await card.click();

    // ── 看商品:標題、價格、加入購物車 ──
    await expect(page.getByRole('heading', { level: 1, name: PRODUCT_TITLE })).toBeVisible();
    await expect(page.getByText('NT$ 4,140').first()).toBeVisible();
    await page.getByRole('button', { name: '加入購物車' }).click();
    await expect(page.locator('.pcm-cart-dot')).toBeVisible(); // Header 角標:車裡真的有東西

    // ── 購物車:一件、總計對 ──
    await page.goto('/cart');
    await expect(page.getByText('1 種商品 · 共 1 件')).toBeVisible();
    await expect(page.getByText('料號 G3-0002-BLK')).toBeVisible();
    await expect(page.getByRole('complementary').getByText('NT$ 4,240')).toBeVisible(); // 訂單摘要那格
    await page.getByRole('button', { name: /前往結帳/ }).first().click();

    // ── 結帳要登入(守門本身是 account-guard.spec.ts 在守;這裡只走過去)──
    await page.waitForURL(/\/login\?next=%2Fcheckout/);
    await loginAsProbeUser(page, '/checkout');

    // ── 步驟 1:收件資料。沒有地址就當場新增(客人第一次買就是這樣)──
    await expect(page.getByRole('heading', { level: 1, name: '結帳' })).toBeVisible();
    const hasAddress = await page.getByRole('radio', { name: new RegExp(ADDRESS.name) }).count();
    if (hasAddress === 0) {
      await page.getByRole('button', { name: /新增收件人地址/ }).click();
      await page.getByRole('textbox', { name: '收件人' }).fill(ADDRESS.name);
      await page.getByRole('textbox', { name: '手機' }).fill(ADDRESS.phone);
      await page.getByRole('textbox', { name: '地址' }).fill(ADDRESS.line);
      await page.getByRole('textbox', { name: /^Email/ }).fill(ADDRESS.email);
      await page.getByRole('button', { name: '儲存' }).click();
    }
    await expect(page.getByRole('radio', { name: new RegExp(ADDRESS.name) })).toBeChecked();
    await page.getByRole('button', { name: /下一步/ }).click();

    // ── 步驟 2:ATM 轉帳、同意條款、送出 ──
    await page.getByText('ATM 轉帳', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'ATM 轉帳' })).toBeChecked();
    await page.getByRole('checkbox', { name: /我已閱讀並同意/ }).check();
    await page.getByRole('button', { name: /確認付款 NT\$ 4,240/ }).click();

    // ── 成功:匯款單直接進訂單明細頁, 網址段就是 display_id ──
    await page.waitForURL(/\/account\/orders\/[^/]+$/, { timeout: 30_000 });
    const displayId = decodeURIComponent(page.url().split('/').pop() ?? '');
    expect(displayId).toMatch(/^[A-Z0-9]{6}$|^PCM-\d{4}-\d{4}$/);
    await expect(page.getByText(displayId).first()).toBeVisible();
    await expect(page.getByText('NT$ 4,240').first()).toBeVisible();

    // ── DB:訂單真的落地, 而且是匯款單、總額 4240 ──
    const row = probeSql(
      `SELECT payment_channel || '|' || total || '|' || payment_status || '|' || coalesce(notification_email, '')
         FROM public.orders WHERE display_id = '${displayId}'`,
    );
    expect(row).toBe(`bank_transfer|4240|unpaid|${ADDRESS.email}`);

    // ── 寄信線:匯款建單信的掃描面看得到這張單(cron 每輪就是從這裡撈去排 outbox)──
    const pending = probeSql(
      `SELECT count(*) FROM public.pcm_bank_order_created_email_pending WHERE display_id = '${displayId}'`,
    );
    expect(pending).toBe('1');
  });
});
