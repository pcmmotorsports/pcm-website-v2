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
// 🔴 授權閘要 mock —— 它會碰 next/headers 的 cookies()/headers(),在單測環境會炸。
//    實測(2026-08-16,加閘當下):不 mock 時 **18/24 格紅**,而且紅在
//    `server-only` 的 import 錯誤、**不是紅在斷言** ⇒ 那種紅完全沒有判別力。
//    ⚠️ **而 mock 它就等於「這些格子預設活在【有身分】的世界」** ——
//       所以本檔另有一組把它設成 `null` 的負測(見「授權閘」那個 describe),
//       否則「加了閘」這件事在測試層是**零覆蓋**的。
const authorizeAdminMutation = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeAdminMutation }));

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
  // 預設:有身分。負測那組會各自覆寫成 null。
  authorizeAdminMutation.mockReset().mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
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

describe('🔴🔴 跨檔依賴 — 本檔的擋法建立在別人維護的性質上', () => {
  // 這一格不驗本檔,驗的是**本檔依賴的那個前提還在不在**。
  // 沒有它的話:有人把 repository 改成 fail-open,本檔測試全綠、線上開始替錯的人建箱。
  // 🔴 **判別力自證**:那支檔案的擁有者是 C 窗,我不能為了驗紅去改它的工作樹。
  //    改成不碰檔案也證得了 —— 直接餵一段 fail-open 的假 body 給同一條 pattern,
  //    它必須**不**命中。不做這一步的話,下面那格可能是一條永遠命中的鬆 pattern。
  const FAIL_CLOSED = /rows\.length !== wanted\.size\)\s*return new Set\(\)/;
  it('前提 — 這條 pattern 對 fail-open 的寫法必須【不】命中', () => {
    expect(FAIL_CLOSED.test('if (rows.length !== wanted.size) return new Set();'), '對真的 fail-closed 不命中 ⇒ pattern 寫壞').toBe(true);
    expect(FAIL_CLOSED.test('if (rows.length === 0) return new Set();'), '換成別的條件也命中 ⇒ pattern 太鬆').toBe(false);
    expect(FAIL_CLOSED.test('return new Set(byOrder.values());'), '只要有 new Set 就命中 ⇒ pattern 太鬆').toBe(false);
  });

  it('shipment-repository 查不到品項時必須回空集合(fail-closed)', () => {
    const REPO = strip(readFileSync(resolve(HERE, './shipment-repository.ts'), 'utf8'));
    const at = REPO.indexOf('export async function listCustomerUserIdsByOrderItemIds');
    expect(at, 'listCustomerUserIdsByOrderItemIds 不見了(改名或刪除)⇒ 本格失去判別力,不是通過').toBeGreaterThan(-1);
    const nx = REPO.indexOf('export async function', at + 1);
    const body = nx === -1 ? REPO.slice(at) : REPO.slice(at, nx);
    expect(
      body,
      '🔴 那支不再有「數量對不上就回空集合」的 fail-closed ⇒ ' +
        '本檔「恰好一位客人才建箱」的擋法會**靜默退化成放行**(本檔 code 不用改、其他格全綠)。' +
        '要放寬那裡的話,本檔的擋法必須同時重新設計。',
    ).toMatch(FAIL_CLOSED);
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

// ── `#503`(2026-08-18,關卡2 codex must-fix)────────────────────────────────
//
// 🔴 **UI 擋不住這條路**:按鈕停用只擋滑鼠;舊分頁、竄改過的請求、以及將來新增的呼叫端
//    都直接進到 server action。⇒ 寫入前這一道是**核心那道**,彈窗那道只是體驗層。
//    判定與畫面共用 `lib/shipping/recipient.ts`(兩邊各寫一份會各自漂,而漂掉時沒有東西會紅)。
describe('`#503` 收件人姓名:server 端自己擋一次', () => {
  // ⚠️ 這裡**只餵字串**(`''` / 空白):`SubmitShipmentInput.recipient` 的型別就是三個 string,
  //    餵 `null` 要 cast,而 cast 出來的世界不是這一層真的會收到的。
  //    `null` 那一半由 `recipient.test.ts` 直接打純函式驗(那一層的型別本來就允許 null)。
  //    🔴 而 `''` 正是**舊實作真的會送出來的值**(`recipient.name ?? ''`)⇒ 這格對得上真實威脅。
  it.each(['', '   '])('姓名是 %p ⇒ 不建箱、回可讀訊息', async (name) => {
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment({ ...base, recipient: { ...base.recipient, name } });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('沒有收件人姓名');
    expect(createShipment, '🔴 已經建出箱子了 —— 這一格就是要擋在寫入之前').not.toHaveBeenCalled();
  });

  // 🔴 正向對照(成對,不可只留上面那組):少了它,一個「一律拒絕」的實作也會讓上面全綠。
  it('🔴 只有電話或地址空 ⇒ 照樣建箱(那兩欄不是擋的理由)', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment({ ...base, recipient: { name: 'n', phone: '', line: '' } });
    expect(r.ok, '把合法的空電話/空地址當成拒絕理由 ⇒ 退掉自取單與沒電話的客人').toBe(true);
    expect(createShipment).toHaveBeenCalled();
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

// ═══════════════════════════════════════════════════════════════════════════
//  🔴 授權閘(Q-AUDIT-1 A1) —— 沒有具名 actor 就不得動任何東西
//
//  Sean 2026-08-16 批 `Q-AUDIT-1a`=甲「可以，被擋是對的」⇒ **不留 bypass**。
//
//  🔴 每一格都驗【兩件事】,少驗第二件這組就沒有意義:
//    ① action 回 `ok:false`
//    ② **底下那支 repository 函式【一次都沒有被呼叫】**
//  只驗 ① 的話,一個「先做事、事後才回 false」的實作也會過 ——
//  而那正是這道閘要防的東西(它要擋的是「動作發生了」,不是「訊息長怎樣」)。
// ═══════════════════════════════════════════════════════════════════════════
describe('🔴 授權閘 — 沒有具名 actor 時四支寫入 action 都要擋下', () => {
  const denied = () => authorizeAdminMutation.mockResolvedValue(null);

  it('submitShipment:回 ok:false 且三支 RPC 一次都沒被呼叫', async () => {
    denied();
    const { submitShipment } = await import('./shipment-actions');
    // 用檔內既有的 `base` fixture —— 它本來就型別正確,而且與其他格用同一份輸入
    // ⇒ 「這格失敗是因為閘」而不是「因為我另外編了一組輸入」。
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(createShipment).not.toHaveBeenCalled();
    expect(addShipmentItems).not.toHaveBeenCalled();
    expect(markShipmentShipped).not.toHaveBeenCalled();
    // 🔴 連「查這批品項屬於誰」都不該做 —— 閘在最前面,不是夾在中間
    expect(listOwners).not.toHaveBeenCalled();
  });

  it('voidShipmentAction:回 ok:false 且 voidShipment 沒被呼叫', async () => {
    denied();
    const { voidShipmentAction } = await import('./shipment-actions');
    const r = await voidShipmentAction({ idempotencyKey: 'k-2', shipmentId: 'sh-1', voidReason: '打錯' });
    expect(r.ok).toBe(false);
    expect(voidShipment).not.toHaveBeenCalled();
  });

  it('unvoidShipmentAction:回 ok:false 且 unvoidShipment 沒被呼叫', async () => {
    denied();
    const { unvoidShipmentAction } = await import('./shipment-actions');
    const r = await unvoidShipmentAction({ idempotencyKey: 'k-3', shipmentId: 'sh-1' });
    expect(r.ok).toBe(false);
    expect(unvoidShipment).not.toHaveBeenCalled();
  });

  it('markShipmentShippedAction:回 ok:false 且 markShipmentShipped 沒被呼叫', async () => {
    denied();
    const { markShipmentShippedAction } = await import('./shipment-actions');
    const r = await markShipmentShippedAction({ idempotencyKey: 'k-4', shipmentId: 'sh-1', trackingNumber: '123' });
    expect(r.ok).toBe(false);
    expect(markShipmentShipped).not.toHaveBeenCalled();
  });

  // 🔴🔴 對照組 —— 沒有這一格,上面四格可能只是「這四支永遠回 false」
  it('對照組:有身分時 voidShipmentAction 會真的呼叫下去', async () => {
    const { voidShipmentAction } = await import('./shipment-actions');
    const r = await voidShipmentAction({ idempotencyKey: 'k-5', shipmentId: 'sh-1', voidReason: '打錯' });
    expect(r.ok).toBe(true);
    expect(voidShipment).toHaveBeenCalledTimes(1);
  });

  // 🔴🔴 補齊對照組(code-reviewer must-fix 3):`unvoid` 與 `markShipped` 在【全 repo】
  //    原本零正向測試 ⇒ 把它們寫成**無條件** `return {ok:false}`,那四格負測照樣全綠。
  //    ⇒ 每一支寫入 action 都要有「有身分時真的呼叫下去」的那一格。
  it('對照組:有身分時 unvoidShipmentAction 會真的呼叫下去', async () => {
    const { unvoidShipmentAction } = await import('./shipment-actions');
    const r = await unvoidShipmentAction({ idempotencyKey: 'k-6', shipmentId: 'sh-1' });
    expect(r.ok).toBe(true);
    expect(unvoidShipment).toHaveBeenCalledTimes(1);
  });

  it('對照組:有身分時 markShipmentShippedAction 會真的呼叫下去', async () => {
    const { markShipmentShippedAction } = await import('./shipment-actions');
    const r = await markShipmentShippedAction({ idempotencyKey: 'k-7', shipmentId: 'sh-1', trackingNumber: 'T-9' });
    expect(r.ok).toBe(true);
    expect(markShipmentShipped).toHaveBeenCalledTimes(1);
  });

  it('對照組:有身分時 submitShipment 會真的呼叫下去', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(true);
    expect(createShipment).toHaveBeenCalledTimes(1);
  });

  // 🔴 訊息內容也要斷言 —— 只驗 `ok:false` 的話,回任意失敗物件都會過
  it('被擋時的訊息要給【兩條出路】,而且不得承諾稽核紀錄', async () => {
    denied();
    const { voidShipmentAction } = await import('./shipment-actions');
    const r = await voidShipmentAction({ idempotencyKey: 'k-8', shipmentId: 'sh-1', voidReason: 'x' });
    expect(r.ok).toBe(false);
    const msg = r.ok === false ? r.message : '';
    expect(msg, '沒告訴員工要去選操作人員').toMatch(/選擇操作人員/);
    expect(msg, '沒給第二條出路 —— Origin 被拒時選了也沒用,員工會鬼打牆').toMatch(/重新整理|重新登入/);
    expect(
      msg,
      '🔴 訊息承諾「會記在稽核紀錄上」,而 A1 一列 admin_audit_log 都沒寫(那是 A2 的事)' +
        ' ⇒ 給使用者看的假字面,而員工沒有任何辦法發現它不存在。',
    ).not.toMatch(/稽核紀錄/);
  });

  // 🔴 唯讀那支【不該】加閘 —— 加了會讓「開啟彈窗」也需要先選身分,而它不寫任何東西
  it('fetchShipmentCandidates 是唯讀,不受這道閘影響', async () => {
    const idx = ACTIONS.indexOf('export async function fetchShipmentCandidates');
    // 🔴 恆綠防護(code-reviewer must-fix 4):找不到時 indexOf 回 -1 ⇒ slice(-1) ⇒ body 幾乎是空的
    //    ⇒ includes 回 false ⇒ **函式被改名或刪掉,這格照樣綠**。先釘住它真的在。
    expect(idx, 'fetchShipmentCandidates 不見了(改名或刪除)⇒ 本格失去判別力,不是通過').toBeGreaterThan(-1);
    // 同上:切到下一個 export,不用 `\n}`(簽章的 `}): Promise` 會讓它提早收邊)
    const nextIdx = ACTIONS.indexOf('export async function', idx + 1);
    const body = nextIdx === -1 ? ACTIONS.slice(idx) : ACTIONS.slice(idx, nextIdx);
    expect(
      body.includes('authorizeAdminMutation'),
      'fetchShipmentCandidates 是唯讀查詢,不該被加上寫入閘 —— ' +
        '加了之後員工連「打開彈窗看有哪些品項」都要先選身分,而那一步不寫任何東西。',
    ).toBe(false);
  });

  // 🔴🔴 log 欄位白名單(codex must-fix):沒有這格的話,未來有人把整包 input 丟進 log,
  //    收件人姓名/電話/地址/追蹤碼**外洩而 37 格全綠**。log 是一份不受 service_role 邊界保護的副本。
  it('稽核 log 只能出現白名單欄位,PII 一個都不准進去', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const { submitShipment } = await import('./shipment-actions');
      await submitShipment(base);
      expect(spy.mock.calls.length, '一行 log 都沒有 ⇒ 本格沒有分母').toBeGreaterThan(0);
      const ALLOWED = new Set([
        'sid', 'actor', 'shipment_id', 'item_count', 'carrier_code', 'mark_shipped', 'has_tracking_number',
      ]);
      for (const [, payload] of spy.mock.calls) {
        for (const k of Object.keys((payload ?? {}) as object)) {
          expect(ALLOWED.has(k), `log 出現白名單外的欄位 \`${k}\` —— 先問「這一欄外洩了會怎樣」`).toBe(true);
        }
        const flat = JSON.stringify(payload);
        // fixture 的收件人是 n/p/l、追蹤碼 T-1 ⇒ 直接找值,不是找 key(換 key 名一樣要抓到)
        expect(flat, '收件人資料進了 log').not.toMatch(/"(n|p|l)"/);
        expect(flat, '追蹤碼進了 log —— 記「有沒有填」就夠了').not.toMatch(/T-1/);
      }
      // outcome 那一半也要在(codex must-fix:只記 attempt 分不出「做成了」與「試了沒成」)
      const events = spy.mock.calls.map((c) => String(c[0]));
      expect(events.some((e) => e.endsWith('.attempt')), '沒有 attempt').toBe(true);
      expect(events.some((e) => e.endsWith('.ok')), '🔴 只記 attempt ⇒ 稽核答不出「誰真的做成了」').toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('失敗時要記 fail,不能只留一行 attempt 讓人以為成功了', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      createShipment.mockRejectedValue(new Error('建立包裹:找不到這位客人'));
      const { submitShipment } = await import('./shipment-actions');
      await submitShipment(base);
      expect(
        spy.mock.calls.map((c) => String(c[0])).some((e) => e.endsWith('.fail')),
        'RPC 失敗卻只留 attempt ⇒ 讀 log 的人分不出這筆到底有沒有發生',
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  // 🔴 未來新增的寫入 action 也要有閘 —— 很便宜,而且它擋的是「下一個人忘記」
  it('本檔每一支寫入 action 都要有閘(未來新增的也算)', () => {
    // 🔴 pattern 要同時吃 `export async function f` 與 `export const f = async …`
    //    (codex must-fix:原版只認前者 ⇒ 用後者寫的新 action 不會被列進分母,**靜默漏掉**)。
    const writes = [...ACTIONS.matchAll(/export (?:async function|const) (\w+)/g)]
      .map((m) => m[1]!)
      .filter((n) => n !== 'fetchShipmentCandidates');
    expect(writes.length, '一支寫入 action 都找不到 ⇒ 本格沒有分母').toBeGreaterThan(0);
    // 🔴 切函式體要切到【下一個 export】,不能用 `indexOf('\n}')` ——
    //    簽章本身就有 `}): Promise<…>` 那個換行加大括號,會讓函式體【提早收邊】,
    //    切出來的片段連閘那一行都不含 ⇒ 這一格會在閘明明存在時報紅。**假紅,實際踩過。**
    for (const name of writes) {
      const at = ACTIONS.indexOf(`export async function ${name}`);
      const nextAt = ACTIONS.indexOf('export async function', at + 1);
      const body = nextAt === -1 ? ACTIONS.slice(at) : ACTIONS.slice(at, nextAt);
      const gateAt = body.indexOf('authorizeAdminMutation');
      expect(
        gateAt,
        `${name} 沒有授權閘 —— 出貨線的每一支寫入都要能答「是誰做的」。` +
          '新增 action 時請一併加,或把它移出本檔並說明為什麼不需要。',
      ).toBeGreaterThan(-1);
      // 🔴 閘在寫入【之前】才算數(codex must-fix):放在 RPC 後面的話字串照樣命中,
      //    而那時箱子已經建出來了 —— 擋不擋得住取決於位置,不是取決於它有沒有出現。
      const writeAt = Math.min(
        ...['createShipment(', 'addShipmentItems(', 'markShipmentShipped(', 'voidShipment(', 'unvoidShipment(']
          .map((fn) => body.indexOf(fn))
          .filter((i) => i > -1),
        Number.MAX_SAFE_INTEGER,
      );
      if (writeAt !== Number.MAX_SAFE_INTEGER) {
        expect(gateAt, `${name} 的閘在寫入之後 ⇒ 擋下來的時候東西已經寫進去了`).toBeLessThan(writeAt);
      }
    }
  });
});
