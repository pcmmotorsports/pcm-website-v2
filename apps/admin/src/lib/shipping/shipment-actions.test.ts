// shipment-actions.test.ts — 建箱送出流程的守門(片 2b-2b-2)。
//
// 🔴 **主守兩件**:
//   ① **三支 RPC 共用同一把冪等鍵**,且**本檔不得自己產鍵**。
//      自己產 ⇒ 重試是新鍵 ⇒ 冪等層失效**而且零症狀**(連按兩次真的建兩個箱、兩次都成功)。
//   ② **失敗時要把已建出的箱號帶回去**。三支不在同一個交易裡,掛品項失敗時箱子已經存在
//      ⇒ 不告訴員工箱號的話,那個草稿箱就變成沒人知道的孤兒(而 DB 禁刪、只能作廢)。
//
// ⚠️ **它擋不住什麼**:全是 mock ⇒ 證不了 RPC 真的接受這些參數、也證不了冪等層真的認得同一把鍵。
//    真行為要收割端的 write smoke(建箱→作廢→回可選)。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const createShipment = vi.fn();
const addShipmentItems = vi.fn();
const markShipmentShipped = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./shipment-candidates', () => ({ loadShipmentCandidates: vi.fn() }));
const voidShipment = vi.fn();
const unvoidShipment = vi.fn();
const listOwners = vi.fn();
vi.mock('./shipment-repository', () => ({
  createShipment,
  addShipmentItems,
  markShipmentShipped,
  voidShipment,
  unvoidShipment,
  listCustomerUserIdsByOrderItemIds: listOwners,
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
const ACTIONS = strip(readFileSync(resolve(HERE, 'shipment-actions.ts'), 'utf8'));
const BAR = strip(
  readFileSync(resolve(HERE, '../../components/orders/shipping-selection.tsx'), 'utf8'),
);
/**
 * 🔴 2026-08-09 起開窗流程(取候選 → 生冪等鍵 → 開窗)**不在勾單列裡**了 ——
 * 出貨長出第二個入口(詳情頁出貨卡)之後整段搬到 `shipment-launcher.tsx`、兩個入口共用一份。
 * 本檔守的**性質沒變**(鍵在開窗時生成一次、只有一個生成點),變的只是它住在哪個檔。
 */
const LAUNCHER = strip(
  readFileSync(resolve(HERE, '../../components/orders/shipment-launcher.tsx'), 'utf8'),
);

const base = {
  idempotencyKey: 'KEY-1',
  recipient: { name: 'n', phone: 'p', line: 'l' },
  carrierCode: 'hct' as const,
  items: [{ orderItemId: 'oi-1', quantity: 2 }],
  markShipped: true,
  trackingNumber: 'T-1',
};

beforeEach(() => {
  createShipment.mockReset().mockResolvedValue({
    shipmentId: 'sh-1',
    shipmentReference: 'K7X2MP',
    customerUserId: 'cu-1',
    idempotent: false,
  });
  addShipmentItems.mockReset().mockResolvedValue({ idempotent: false });
  markShipmentShipped.mockReset().mockResolvedValue({ idempotent: false });
  voidShipment.mockReset().mockResolvedValue({ idempotent: false });
  unvoidShipment.mockReset().mockResolvedValue({ idempotent: false });
  // 預設:送出的品項都屬於同一位客人(常態);0 位與 2 位以上另外構造。
  listOwners.mockReset().mockResolvedValue(new Set(['cu-1']));
});

describe('🔴🔴 箱子掛誰 — 由 server 從品項反查,client 送不進來', () => {
  it('建箱用的客人來自 `listCustomerUserIdsByOrderItemIds`(不是 input)', async () => {
    // 🔴 值刻意與 fixture 的 `cu-1` **不同**:相同的話,「照抄 input」的實作也會全綠。
    listOwners.mockResolvedValue(new Set(['cu-derived-by-server']));
    const { submitShipment } = await import('./shipment-actions');
    await submitShipment(base);
    expect(listOwners, '沒去反查品項的擁有者').toHaveBeenCalledWith(['oi-1']);
    expect(
      createShipment.mock.calls[0]?.[0]?.customerUserId,
      '建箱用的客人不是 server 反查出來的那位 ⇒ 它的來源仍是瀏覽器裡的一個字串。',
    ).toBe('cu-derived-by-server');
  });

  it('🔴 client 硬塞 `customerUserId` 也沒有用(型別外的欄位被完全忽略)', async () => {
    listOwners.mockResolvedValue(new Set(['cu-real-owner']));
    const { submitShipment } = await import('./shipment-actions');
    // 模擬竄改過的 client:多送一個別人的客人 id。
    await submitShipment({ ...base, customerUserId: 'cu-attacker' } as never);
    expect(
      createShipment.mock.calls[0]?.[0]?.customerUserId,
      '竄改的客人 id 被拿去建箱 ⇒ 會先替錯的人建出一個空箱(半成品,只能作廢),' +
        '要到掛品項才被 DB 的 pcm_b2_w3b2_item_not_customers 擋下。',
    ).toBe('cu-real-owner');
  });

  it('🔴 品項跨兩位客人 → 直接失敗,**一個箱子都不建**', async () => {
    listOwners.mockResolvedValue(new Set(['cu-A', 'cu-B']));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(
      createShipment,
      '跨客人卻仍去建箱 ⇒ 箱子建出來了、掛品項才失敗,員工得自己去作廢那個孤兒箱。',
    ).not.toHaveBeenCalled();
    expect(r.ok === false && r.shipmentReference, '沒建箱卻回了箱號').toBeNull();
  });

  it('🔴 一個品項都查不到 → 失敗(fail-closed,不是「沒有限制」)', async () => {
    listOwners.mockResolvedValue(new Set());
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(createShipment, '查無擁有者卻照樣建箱').not.toHaveBeenCalled();
  });

  it('前提 — `SubmitShipmentInput` 型別上沒有 customerUserId 這個欄位', () => {
    const inputBlock = ACTIONS.slice(
      ACTIONS.indexOf('export type SubmitShipmentInput'),
      ACTIONS.indexOf('export type SubmitShipmentResult'),
    );
    expect(inputBlock.length, '找不到 SubmitShipmentInput 宣告 ⇒ 本條要重寫').toBeGreaterThan(0);
    expect(
      inputBlock,
      'SubmitShipmentInput 又長回 customerUserId ⇒ client 可以送客人 id,反查那道就被繞過了。',
    ).not.toMatch(/customerUserId/);
  });
});

describe('🔴 冪等鍵 — 三支共用同一把,且本檔不得自己產', () => {
  it('三支 RPC 收到的是**同一把**鍵', async () => {
    const { submitShipment } = await import('./shipment-actions');
    await submitShipment(base);
    const keys = [
      createShipment.mock.calls[0]?.[0]?.idempotencyKey,
      addShipmentItems.mock.calls[0]?.[0]?.idempotencyKey,
      markShipmentShipped.mock.calls[0]?.[0]?.idempotencyKey,
    ];
    expect(new Set(keys).size, `三支收到不同的鍵:${JSON.stringify(keys)} ⇒ 重放對不起來`).toBe(1);
    expect(keys[0]).toBe('KEY-1');
  });

  it('🔴 action 檔內不得出現任何鍵產生器(產了就等於重試每次換新鍵、冪等層失效且零症狀)', () => {
    expect(
      ACTIONS,
      'shipment-actions.ts 自己產冪等鍵 ⇒ 使用者連按兩次會真的建出兩個箱子,而兩次都回報成功',
    ).not.toMatch(/randomUUID|uuidv4|Date\.now\(\)/);
  });

  it('🔴 鍵在**開窗**時生成一次(不是送出時)—— 生成點只有一個', () => {
    const hits = [...LAUNCHER.matchAll(/randomUUID\(\)/g)].length;
    expect(
      hits,
      `shipment-launcher.tsx 裡 randomUUID() 出現 ${hits} 次,期望恰好 1(開窗那一處)。` +
        '出現在送出路徑上 = 每次重試換新鍵;完全不出現 = 沒有鍵可用。',
    ).toBe(1);
    // 生成點必須在 setOpen(開窗)那一段,不在 submit 相關的 callback 裡
    const at = LAUNCHER.indexOf('randomUUID()');
    expect(
      LAUNCHER.slice(Math.max(0, at - 200), at),
      'randomUUID() 不在 setOpen(…) 附近 ⇒ 可能被移到了送出路徑上',
    ).toMatch(/setOpen\(/);
    // 🔴 舊生成點必須真的不見了 —— 只加新斷言、舊檔還留一份的話,線上會有兩個鍵源。
    expect(
      BAR,
      'shipping-selection.tsx 還留著一份 randomUUID() ⇒ 搬家沒搬乾淨,兩個入口各自產鍵。',
    ).not.toMatch(/randomUUID\(\)/);
  });
});

describe('🔴 半成品 — 失敗時要把已建出的箱號帶回去', () => {
  it('掛品項失敗 → ok:false,且帶回箱號(否則那個草稿箱變孤兒,而 DB 禁刪只能作廢)', async () => {
    addShipmentItems.mockRejectedValue(new Error('掛品項:同一份清單裡有 1 個品項重複了。'));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.shipmentReference, '失敗時沒帶回箱號 ⇒ 員工不知道要去作廢哪一箱').toBe('K7X2MP');
  });

  it('建箱本身就失敗 → 箱號為 null(還沒有東西被建出來)', async () => {
    createShipment.mockRejectedValue(new Error('建立包裹:找不到這位客人'));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok === false && r.shipmentReference).toBeNull();
  });

  // 🔴 2026-08-16:成功時要回 `shipmentId`(uuid)。**唯一理由是列印網址吃 uuid**
  //    (`/print/orders/{訂單id}/shipping/{箱id}`,見 `components/orders/shipment-section.tsx`)——
  //    在此之前只回箱號 ⇒ 建完箱**無法直接跳列印**,員工得回訂單頁再點一次。
  // ⚠️ **落地當下它還沒有 production 消費端** —— 消費端是「建立並列印」,排在合併片(`D-044`)。
  //    本格就是它的覆蓋:house 禁的是「零消費端**且**零覆蓋」的死碼
  //    (`lib/orders/order-list-view.ts:191` 逐字)⇒ 有這格,它不是死碼,是有名字的前置。
  //    🔴 若合併片最後沒做,**這個欄位要跟著撤**,不要留成永遠沒人用的回傳面。
  it('🔴 成功時回 `shipmentId`(uuid)—— 列印網址吃的是它,不是箱號', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.shipmentId, '成功卻沒回 uuid ⇒ 呼叫端組不出列印網址').toBe('sh-1');
    // 反面:別把箱號當 uuid 用。兩者不同值,而且只有 uuid 進得了列印路由。
    expect(r.ok === true && r.shipmentReference).toBe('K7X2MP');
  });

  // 🔴 失敗分支**刻意不帶** `shipmentId`:那條的 `shipmentReference` 是給員工看的
  //    「半成品箱號」(去作廢或重試用),不是拿來組網址的 —— 失敗時本來就不該跳列印。
  //    這格擋的是「順手也加上去」。
  it('🔴 失敗時**不**回 `shipmentId`(失敗不該跳列印)', async () => {
    addShipmentItems.mockRejectedValue(new Error('掛品項失敗'));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(Object.hasOwn(r, 'shipmentId'), '失敗分支多了 shipmentId ⇒ 有人順手加了').toBe(false);
  });

  it('🔴 錯誤訊息原樣帶出、不改寫(DB 的 RAISE 寫的就是給員工看的中文)', async () => {
    const msg = '出貨:包裹 K7X2MP 已經寄出了(可能是別人剛按過)。不需要再出一次。';
    markShipmentShipped.mockRejectedValue(new Error(msg));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(
      r.ok === false && r.message,
      '訊息被改寫了 ⇒ 這裡等於另立一份文案表,DB 那邊改字時不會知道',
    ).toBe(msg);
  });
});

describe('只建箱 / 建箱並出貨', () => {
  it('markShipped=false → 不呼叫 markShipmentShipped', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment({ ...base, markShipped: false });
    expect(markShipmentShipped).not.toHaveBeenCalled();
    expect(r.ok === true && r.shipped).toBe(false);
  });

  it('可選參數未給時不送出該鍵(帶 DEFAULT 的參數送 undefined 是另一種形狀)', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const { trackingNumber: _t, ...noTracking } = base;
    await submitShipment({ ...noTracking, carrierCode: 'other', carrierNote: '客人自取' });
    const createArgs = createShipment.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs.carrierNote).toBe('客人自取');
    const shipArgs = markShipmentShipped.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(shipArgs)).not.toContain('trackingNumber');
  });
});

describe('作廢 / 復原(片 2c)', () => {
  it('🔴 作廢按鈕的冪等鍵:失敗重按沿用同一把、成功後才清掉', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(
      resolve(HERE, '../../components/orders/shipment-void-button.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m: string) => m.replace(/[^\n]/g, ' '));
    // 生成點恰好 1 個,且必須是 `key ?? crypto.randomUUID()` 這種「沒有才生」的形狀 ——
    // 寫成無條件 `crypto.randomUUID()` = 每次重按換新鍵、冪等失效(連按兩次會作廢兩次)。
    expect([...src.matchAll(/randomUUID\(\)/g)].length, '鍵生成點不是恰好 1 個').toBe(1);
    expect(src, '不是「沒有才生」的形狀 ⇒ 每次重按都換新鍵').toMatch(/key\s*\?\?\s*crypto\.randomUUID\(\)/);
    expect(src, '成功後沒有把鍵清掉 ⇒ 下一次作廢別箱會沿用舊鍵').toMatch(/setKey\(null\)/);
  });

  it('作廢必須帶原因(RPC 的 p_void_reason 是必填)', async () => {
    const { voidShipmentAction } = await import('./shipment-actions');
    await voidShipmentAction({ idempotencyKey: 'K', shipmentId: 's', voidReason: '客人改地址' });
    expect(voidShipment).toHaveBeenCalledWith({
      idempotencyKey: 'K',
      shipmentId: 's',
      voidReason: '客人改地址',
    });
  });

  it('作廢失敗 → ok:false 帶原訊息(不改寫)', async () => {
    voidShipment.mockRejectedValue(new Error('作廢:包裹 K7X2MP 已經寄出了,不能作廢。'));
    const { voidShipmentAction } = await import('./shipment-actions');
    const r = await voidShipmentAction({ idempotencyKey: 'K', shipmentId: 's', voidReason: 'r' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('已經寄出');
  });
});

// ─────────────────────────────────────────────────────────────
// 2026-08-09 Sean 正式站實測回報的三族 bug(D-364-A)。守門逐條。
// ─────────────────────────────────────────────────────────────
describe('🔴 Bug 2 — 錯誤物件要轉人話,不得吐 [object Object]', () => {
  // 病根:Supabase 丟的是 PostgrestError 這種**普通物件**、不是 Error 實例
  // ⇒ 舊寫法落到字串化分支 ⇒ 畫面出現 `[object Object]`,
  //   而 DB RAISE 的中文就在那個物件的 message 欄裡 —— 等於把唯一能給員工看的訊息丟掉。
  it('丟 PostgrestError 形狀的普通物件 → 取得 message,不是 [object Object]', async () => {
    createShipment.mockRejectedValue({
      message: '建立包裹:找不到這位客人(user_id=x),請確認是從客人頁面進來的',
      code: 'P0001',
      details: null,
      hint: null,
    });
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message, '錯誤物件沒轉字串 ⇒ 員工看到 [object Object]').toContain(
      '找不到這位客人',
    );
    expect(r.ok === false && r.message).not.toContain('[object Object]');
  });

  it('沒有 message 但有 details / hint → 退而取它們(仍然不吐 [object Object])', async () => {
    createShipment.mockRejectedValue({ details: '違反 shipments_carrier_domain' });
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok === false && r.message).toContain('shipments_carrier_domain');
  });

  it('🔴 完全沒有可讀欄位 → 吐 JSON,**仍然不得**是 [object Object](那對排查零幫助)', async () => {
    createShipment.mockRejectedValue({ weird: 1 });
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok === false && r.message).not.toContain('[object Object]');
    expect(r.ok === false && r.message).toContain('weird');
  });

  it('作廢路徑同樣不得吐 [object Object]', async () => {
    voidShipment.mockRejectedValue({ message: '作廢:找不到這個包裹' });
    const { voidShipmentAction } = await import('./shipment-actions');
    const r = await voidShipmentAction({ idempotencyKey: 'K', shipmentId: 's', voidReason: 'r' });
    expect(r.ok === false && r.message).toBe('作廢:找不到這個包裹');
  });
});

describe('🔴 Bug 1 — 彈窗不得靠繼承拿字色', () => {
  const read = (p: string) =>
    readFileSync(resolve(HERE, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) =>
      m.replace(/[^\n]/g, ' '),
    );

  it('彈窗面板**自己**設了字色(不論掛在哪都不再繼承)', () => {
    const src = read('../../components/orders/shipment-dialog.tsx');
    const at = src.indexOf('bg-card');
    expect(at, 'shipment-dialog.tsx 找不到 bg-card 面板 ⇒ 結構變了,本條要重寫').toBeGreaterThan(-1);
    expect(
      src.slice(at, at + 120),
      '面板設了 bg-card(白底)卻沒有自己的 text-* ⇒ 會繼承祖先的字色。' +
        '2026-08-09 就是這樣白底白字:它掛在 `bg-foreground text-background` 的動作列裡。',
    ).toMatch(/text-(foreground|card-foreground)/);
  });

  it('🔴 彈窗不得是那個 `text-background` 動作列的子節點', () => {
    const src = read('../../components/orders/shipping-selection.tsx');
    const barOpen = src.indexOf('bg-foreground text-background');
    const barClose = src.indexOf('</div>', barOpen);
    // 🔴 2026-08-09 起彈窗由 `useShipmentLauncher()` 回傳、在這裡以 `{dialog}` 掛出來。
    //    要守的性質完全沒變:**它掛的位置**不得落在那個深底動作列裡面。
    const dialogAt = src.indexOf('{dialog}');
    expect(barOpen).toBeGreaterThan(-1);
    expect(dialogAt, 'shipping-selection.tsx 掃不到 {dialog} ⇒ 掛法變了,本條要重寫').toBeGreaterThan(-1);
    expect(
      dialogAt > barClose,
      '<ShipmentDialog> 又被放回 `bg-foreground text-background` 容器裡 ⇒ 整個彈窗會繼承白字、' +
        '在白底面板上全部隱形(Sean 2026-08-09 正式站實測的症狀)。它是 fixed 覆蓋層,不該是某列的子節點。',
    ).toBe(true);
  });
});
