// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { stripComments } from '../../lib/test-support/strip-comments';
import type { AdminOrderItemQuantitySummary } from '@pcm/domain';
import {
  ItemAxisMissingNote,
  ItemAxisValue,
  ItemCancelledNote,
} from './order-detail-items-table';

// order-detail-items-table-shape.test.tsx — 品項區的結構守門。
//
// 🔴🔴 **2026-08-19 片6a 重寫:結構從 `<table>` 換成 `.ihead` + 每列一個 `<details class="icard">`。**
//    本檔原本有 7 格守著表格的不變量。**重寫的原則是「不變量還在不在」,不是「測試紅不紅」** ——
//    所以下面每一格都標了它是【原樣保留 / 換了定位方式 / 這個不變量真的消失了】三者之一。
//    ⚠️ **消失的那兩格我明寫理由,不靜靜刪掉** —— 「守門被弄丟」與「不變量不存在了」
//    在 diff 上長得一模一樣,而只有寫下來才分得開。(線主 W1 明確要求這一點。)
//
// 📌 分工:結構長什麼樣是 W1 的決定;**這一份只回答「新結構下那些不變量還守不守得住」**。
//    我不在這裡替它決定結構。

afterEach(cleanup);

const DIR = dirname(fileURLToPath(import.meta.url));
const RAW_TABLE = readFileSync(resolve(DIR, 'order-detail-items-table.tsx'), 'utf8');
const RAW_ROW = readFileSync(resolve(DIR, 'item-amount-row.tsx'), 'utf8');
const RAW_CSS = readFileSync(resolve(DIR, '../../app/globals.css'), 'utf8');

/**
 * 🔴 原始碼層的斷言一律對【剝掉註解之後】的碼跑。
 * 理由是被自己踩出來的:註解裡的 `<tfoot>` / `<th>` 與 code 裡的長得一模一樣,
 * 而尺量的是**字元**、宣稱量的是**結構**。用 repo 既有的剝除器,不各寫各的。
 */
const TABLE = stripComments(RAW_TABLE);
const ROW = stripComments(RAW_ROW);
const CSS = stripComments(RAW_CSS);

const summary = (over: Partial<AdminOrderItemQuantitySummary> = {}): AdminOrderItemQuantitySummary =>
  ({
    quantity: 2,
    orderedQuantity: 2,
    instockQuantity: 1,
    shippedQuantity: 0,
    cancelledQuantity: 0,
    ...over,
  }) as AdminOrderItemQuantitySummary;

/** 六軌:品名 | 料號 | 訂到出 | 數量 | 單價 | 小計(CSS `grid-template-columns` 那一行)。 */
const TRACKS = 6;

describe('🔴🔴 【換了定位方式】欄頭與每一列必須共用同一組 grid 軌道', () => {
  // 舊版對應格:「`ITEMS_TABLE_COLSPAN` 與 `<th>` 數逐字相同」。
  // 舊的不變量是「展開列跨的欄數 == 表頭欄數」;新結構沒有 colSpan,而**同一個病換了形狀**:
  // 🔴 設計稿 `:119-120` 自己記著:兩個【各自宣告】的 grid,`auto` 欄會各自依內容算寬
  //    ⇒ 欄頭與資料列**整排錯開 8px**,而那是會靜默錯開、沒有東西會紅的東西。
  // 🔴 **逐條解析 CSS 規則,不用「找 `.iline {`」那種字面比對** ——
  //    共用那條規則長成 `.ihead,\n.iline {`,而它**自己就含有字面 `.iline {`**
  //    ⇒ 拿字面去找「`.iline` 自己的區塊」會抓到共用那條,然後這一格就恆綠。
  //    (寫這份守門時當場踩到:負向斷言對著共用規則跑,而它當然含 grid-template-columns。)
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1]!.trim(),
    body: m[2]!,
  }));
  /** 選擇器裡點名了 `.ihead` 或 `.iline`(不含後代選擇器如 `.ihead .three`)的規則。 */
  const trackRules = rules.filter((r) =>
    r.sel.split(',').some((one) => ['.ihead', '.iline'].includes(one.trim())),
  );

  it('軌道只被宣告【一次】,而且是被兩個選擇器共用的那一次', () => {
    expect(rules.length).toBeGreaterThan(10); // 正向對照:真的解析到規則
    expect(trackRules.length).toBeGreaterThan(0); // 正向對照:真的找到那一族

    const withTracks = trackRules.filter((r) => r.body.includes('grid-template-columns'));
    // 🔴 恰好一條 —— 兩條就是「各自宣告」那個 8px 坑回來了;零條就是軌道不見了。
    expect(withTracks).toHaveLength(1);
    // 而那一條必須【同時】管到兩個選擇器
    const sels = withTracks[0]!.sel.split(',').map((x) => x.trim());
    expect(sels).toContain('.ihead');
    expect(sels).toContain('.iline');
  });

  it('那一行的軌道數 = 六(品名/料號/訂到出/數量/單價/小計)', () => {
    const rule = trackRules.find((r) => r.body.includes('grid-template-columns'))!;
    const decl = /grid-template-columns:\s*([^;]+);/.exec(rule.body)![1]!;
    // `minmax(0, 1fr)` 裡面有逗號與空白 ⇒ 先折疊成一個標記再數,否則會數成 7。
    const tracks = decl.replace(/minmax\([^)]*\)/g, 'X').trim().split(/\s+/);
    expect(tracks).toHaveLength(TRACKS);
  });

  it('🔴 膠囊寬度與欄頭那三格共用同一個變數(不得各自寫死)', () => {
    // 設計稿 `:143` 逐字:`128 = 3×40 + 2×4 gap` ⇒ 兩邊寫死就會在改寬度那天錯開。
    const shared = /\.ihead \.three span,\s*\.pcm-pill\s*\{([\s\S]*?)\}/.exec(CSS);
    expect(shared).toBeTruthy();
    expect(shared![1]).toContain('var(--pcm-pill-w)');
  });
});

describe('🔴 【換了定位方式】一列的格數必須等於軌道數,而它跨兩支檔', () => {
  // 舊版對應格:「`<tbody>` 內 `<td>` 數 = 總欄數 − 1」。
  // 同一個不變量,只是 `<td>` 變成 `.iline` 的直接子元素。
  it('`before` 四格 + 單價一格 + `after` 一格 = 六格', () => {
    // before 的四個直接子元素在本檔;單價那格與 after 的殼在 item-amount-row.tsx
    // ⇒ 🔴 **一列的格數跨兩支檔**,單看任一支都數不出來(舊版就是這樣被我釘住的,保留)。
    const before = /before=\{[\s\S]*?<>([\s\S]*?)<\/>/.exec(TABLE)?.[1] ?? '';
    expect(before.length).toBeGreaterThan(0); // 正向對照:真的抓到 before
    const beforeCells = (before.match(/^\s{16}<div/gm) ?? []).length;
    expect(beforeCells).toBe(4);

    // 對面那支:card-line 殼裡 `.iline` 底下,除了 `{before}` 之外還有幾個直接子元素
    const iline = /<div className='iline'>([\s\S]*?)<\/div>\s*<\/summary>/.exec(ROW)?.[1] ?? '';
    expect(iline.length).toBeGreaterThan(0); // 正向對照:真的抓到 .iline
    expect(iline).toContain('{before}');
    expect(iline).toContain('{after}');
  });
});

describe('🔴 【原樣保留】欄名與順序 = 設計稿 08-17 那一行', () => {
  it('六格逐字、依序', () => {
    const ihead = /<div className='ihead'>([\s\S]*?)<\/div>\s*<ItemAmountRowGroup>/.exec(TABLE)?.[1] ?? '';
    expect(ihead.length).toBeGreaterThan(0); // 正向對照
    // `.three` 那一格內含三個 span ⇒ 先把整塊換成一個標記再數,否則會數成八。
    const flat = ihead.replace(/<span className='three'>[\s\S]*?<\/span>\s*<\/span>/, '<span>三軸</span>');
    const headers = [...flat.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => (m[1] ?? '').trim());
    expect(headers).toEqual(['商品名稱', '料號', '三軸', '數量', '單價', '小計']);
  });

  it('🔴 三軸欄頭逐字依序 訂 / 到 / 出', () => {
    // 🔴 不用非貪婪配對到 `</span></span>` —— 內層有三個 `</span>`,
    //    非貪婪會停在第一組,只抓到「訂/到」。(寫這格時當場踩到。)
    //    ⇒ 改成:從 `three` 那一格起算,取到「數量」那個欄頭之前為止。
    const start = TABLE.indexOf("className='three'>");
    const end = TABLE.indexOf('數量', start);
    expect(start).toBeGreaterThan(-1); // 正向對照
    expect(end).toBeGreaterThan(start);
    const three = TABLE.slice(start, end);
    expect([...three.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['訂', '到', '出']);
  });

  it('🔴 舊的四合一欄名不得再存在(片5 把那三個字搬到欄頭,搬乾淨了沒)', () => {
    expect(TABLE).not.toContain('訂貨 · 到貨 · 出貨');
  });
});

describe('🔴 【新增】總計那一區每一列恰好兩格(標籤 + 金額)', () => {
  // 舊版對應格:「`<tfoot>` 每一列恰好兩個 `<td>`」。
  // 🔴 **`<tfoot>` 這個不變量【消失了】** —— 沒有表格就沒有 colSpan,也沒有裸 `<td />` 的殘骸。
  //    ⚠️ 但它守的**那件事**還在:金額欄要對齊,而一列多一格就會歪。
  //    ⇒ 換成數 flex 列的 span 數。**這不是把舊格刪掉,是同一個不變量換了載體。**
  it('小計 / 運費 / 折扣 / 總計 每一列都是 label + 金額 兩個 span', () => {
    const totals = /border-t pt-3 text-sm'>([\s\S]*?)<\/div>\s*<\/div>\s*\);/.exec(TABLE)?.[1] ?? '';
    expect(totals.length).toBeGreaterThan(0); // 正向對照:真的抓到總計區
    // 🔴 用「切段」而不是「配對整塊」—— 巢狀 `</div>` 讓非貪婪的邊界抓不準
    //    (第一版抓到 4 個 span,因為它吃進了下一列)。
    //    ⇒ 以 `flex justify-between` 為分隔切開,每一段就是一列的內容。
    const rows = totals.split(/<div className='[^']*flex justify-between[^']*'>/).slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(3); // 小計/運費/總計 至少三列
    for (const r of rows) {
      // 每一段取到它自己的第一個 `</div>` 為止 = 這一列的內容
      const own = r.slice(0, r.indexOf('</div>') + 6);
      expect((own.match(/<span/g) ?? []).length).toBe(2);
    }
  });

  it('🔴 總計區【刻意保留】—— 設計稿沒有它,而拿掉會刪掉真的資訊', () => {
    // 這一格守的是「別人看到設計稿沒畫就順手刪掉」。
    for (const label of ['小計', '運費', '總計']) expect(TABLE).toContain(label);
  });
});

describe('🗑 【這兩個不變量真的消失了】—— 寫下來,不要靜靜刪掉', () => {
  it('沒有 `<table>` / `<tfoot>` / `colSpan` 寫死數字這一族了', () => {
    // 🔴 **消失的理由**:結構換成 `.ihead` + `<details class="icard">`,
    //    而 `colSpan` 這個概念在 grid 版面裡不存在 ⇒ 「footer 跨幾欄」沒有對象可守。
    //    ⇒ 它守的那件事(金額對不對得齊)由上面那個「每列兩格」接手。
    // ⚠️ 而 `ITEMS_TABLE_COLSPAN` **仍然存在**(`table-row` 殼還吃它),所以這裡不斷言它消失 ——
    //    斷言它消失會在 W1 哪天刪掉那個殼之前就先紅,而那不是我要守的東西。
    expect(TABLE).not.toContain('<tfoot');
    expect(TABLE).not.toContain('<thead');
    expect(TABLE.match(/colSpan=\{\d+\}/g)).toBeNull();
  });
});

describe('🔴 【原樣保留】`ItemAxisValue`:缺值印「—」,不是 `0/0`', () => {
  it('有 summary ⇒ 印「本軸/總數」', () => {
    const { container } = render(<ItemAxisValue summary={summary()} pick={(q) => q.instockQuantity} />);
    expect(container.textContent).toBe('1/2');
  });

  it('🔴🔴 summary 為 null ⇒ 印「—」——「不知道」與「確定是零」必須分得開', () => {
    const { container } = render(<ItemAxisValue summary={null} pick={(q) => q.instockQuantity} />);
    expect(container.textContent).toBe('—');
    expect(container.textContent).not.toContain('0/0');
  });

  it('✅ 真的是 0 才印 0 —— 正向對照,證明上一格不是把 0 也吃掉了', () => {
    const { container } = render(
      <ItemAxisValue summary={summary({ shippedQuantity: 0 })} pick={(q) => q.shippedQuantity} />,
    );
    expect(container.textContent).toBe('0/2');
  });

  it('🔴 三軸共用同一個分母', () => {
    const s = summary({ quantity: 7, orderedQuantity: 5, instockQuantity: 3, shippedQuantity: 1 });
    for (const [pick, expected] of [
      [(q: AdminOrderItemQuantitySummary) => q.orderedQuantity, '5/7'],
      [(q: AdminOrderItemQuantitySummary) => q.instockQuantity, '3/7'],
      [(q: AdminOrderItemQuantitySummary) => q.shippedQuantity, '1/7'],
    ] as const) {
      const { container } = render(<ItemAxisValue summary={s} pick={pick} />);
      expect(container.textContent).toBe(expected);
      cleanup();
    }
  });
});

describe('🔴 【原樣保留】缺值那句話只講一次;「已取消」是例外不是第四軸', () => {
  it('summary 為 null ⇒ 出現「數量資料尚未就緒」', () => {
    const { container } = render(<ItemAxisMissingNote summary={null} />);
    expect(container.textContent).toContain('數量資料尚未就緒');
  });

  it('✅ 負向對照:有 summary ⇒ 什麼都不畫', () => {
    const { container } = render(<ItemAxisMissingNote summary={summary()} />);
    expect(container.innerHTML).toBe('');
  });

  it('cancelledQuantity > 0 ⇒ 出現並帶得走數字', () => {
    const { container } = render(<ItemCancelledNote summary={summary({ cancelledQuantity: 3 })} />);
    expect(container.textContent).toContain('已取消');
    expect(container.textContent).toContain('3');
  });

  it('✅ 負向對照:0 件取消 / summary 缺值 ⇒ 都不畫', () => {
    const { container: a } = render(<ItemCancelledNote summary={summary({ cancelledQuantity: 0 })} />);
    expect(a.innerHTML).toBe('');
    cleanup();
    const { container: b } = render(<ItemCancelledNote summary={null} />);
    expect(b.innerHTML).toBe('');
  });
});


// ── codex 關卡2(2026-08-19)兩條 must-fix 的守門 ────────────────────────────
//
// 🔴 它們**不是版面問題**,而兩條都會**靜默**:
//   · 受控 details 分岔 ⇒ 表單被藏住、按鈕仍寫「收起」,而沒有東西會紅
//   · 截斷沒有逃生門 ⇒ 長料號變成畫面上讀不出來的值,而沒有東西會紅
describe('codex 關卡2 must-fix 的守門', () => {
  // 🔴 用的是【剝過註解】的 `ROW`/`TABLE` —— 那是必要的:
  //    我在原始碼裡寫的解釋文字裡就含 `open || undefined` 這個字面,
  //    不剝的話**負向那條會被我自己的註解打紅**(今天已經有人踩過同款)。
  it('🔴 `<details>` 是**單一狀態模型**:`open={open}` + `onToggle` 同步回 context', () => {
    // 負向:`open || undefined` 那個寫法會讓 DOM 與 context 分岔(使用者手動收合時)。
    expect({ 有半受控寫法: /open=\{open \|\| undefined\}/.test(ROW) }).toEqual({
      有半受控寫法: false,
    });
    expect(ROW).toMatch(/open=\{open\}/);
    expect(ROW).toMatch(/onToggle=\{/);
    // 🔴 `onToggle` 必須真的寫回 context —— 只掛一個空 handler 也會讓上面兩條綠。
    expect(ROW).toMatch(/setOpenId\(next \? /);
  });

  it('🔴 被 `truncate` 的兩格都要有 `title`(否則長值在畫面上讀不出來,而那是行為退化)', () => {
    // 只看品項列那一段,不掃全檔。
    const i = TABLE.indexOf('variant=\'card-line\'');
    expect(i).toBeGreaterThan(-1);
    const block = TABLE.slice(i, TABLE.indexOf('blockedReason=', i));
    const truncs = [...block.matchAll(/className='[^']*truncate[^']*'/g)];
    // 正向對照:真的有截斷的格子(沒有的話下面那條是恆真)
    expect(truncs.length).toBeGreaterThan(0);
    expect(block).toMatch(/title=\{item\.title \?\? undefined\}/);
    expect(block).toMatch(/title=\{item\.variantSku\}/);
  });
});


// ── 片6a-2:缺料那一項自己打開 ──────────────────────────────────────────────
//
// 🔴 本組動手前跑過一次:接完線之後 `components/orders` + `lib/orders` **2011 格全綠**
//    ⇒ **沒有任何一格在看這件事**。「改了沒東西紅」在這裡不代表沒破壞,代表沒有人在看。
describe('片6a-2 缺料自動展開', () => {
  it('🔴 「卡住」的判斷來自 `item-stuck.ts`,**本檔零判斷邏輯**', () => {
    expect(TABLE).toContain('resolveItemStuck');
    expect(TABLE).toContain('describeItemStuck');
    // 🔴 負向:本檔不得自己再判一次 —— 兩邊各判各的,症狀是畫面自洽而互相矛盾,且不會有東西紅。
    // 🔴 **字集要蓋住那支 predicate 真正用到的每一個欄位**(`W6-030` N1)——
    //    上一版只有 `out_of_stock|replyStatus`,**漏了 `voidedAt`**,
    //    而 `voidedAt` 正是 W3 R3 抓到那個「功能長期說謊」的真 bug 的欄位
    //    (作廢的採購列會讓品項永遠回 stuck)⇒ **守門漏掉的剛好是最該守的那一個。**
    //
    // ⚠️ **而我第一版把字集開太寬,當場自打**:`procurementTruncated` 命中了 `:262`
    //    `resolveItemStuck(item.procurements, item.procurementTruncated)` ——
    //    那是**把參數交給 predicate**,正是本片要的做法,**不是自己判**。
    //    ⇒ 🔴 **寬掉的尺會回一個看起來很負責的紅**,而它指著一行沒有問題的 code。
    //    ⇒ 收窄成「**這些欄位被拿來做判斷**」的形狀:比較 / 邏輯運算,而不是出現即算。
    const 自己判 = [
      /replyStatus\s*[=!]==?/, // 比對回覆狀態
      /'out_of_stock'/, // 硬寫那個值
      /voidedAt\s*[=!]=/, // 自己過濾作廢列
      /procurements\.(find|some|filter|length)/, // 自己走那個陣列
    ].some((re) => re.test(TABLE));
    expect({ 自己判 }).toEqual({ 自己判: false });
  });

  it('🔴🔴 **`stuck` 一定自動展開** —— `unknown` 不是「不卡」的一種', () => {
    // `item-stuck.ts` 檔頭逐字:靜靜把 unknown 當成 not-stuck ⇒ 卡住的那一項不會自己打開,
    // 而畫面看起來完全正常。
    //
    // 🔴🔴 **2026-08-19 片7:條件【放寬】了,而這一格要守的東西沒有變。**
    //    ~~原本斷 `defaultOpen={stuck.kind === 'stuck'}`(恰好等於)~~ ⇒ 現在是
    //    `stuck.kind === 'stuck' || hasProcurementRows` —— 主視窗裁「有採購資料的也預設展開」,
    //    依據是 Sean 自己的字「看得完整,但佔高度」(他接受的是高度,不是多點一下)。
    //    ⇒ **本格改成斷「`stuck` 仍是其中一個成立條件」**:放寬是往「更常打開」的方向,
    //      而這一格從頭到尾防的是**往【更少打開】的方向**漂(卡住的那項不打開)。
    //    ⚠️ 誠實代價:斷「包含」比斷「恰好等於」**弱** —— 有人把它改成
    //      `stuck.kind === 'stuck' && 別的條件` 時,這一格**不會紅**。
    //      那一格由 `item-amount-open-behavior.test.tsx` 的行為測試守(缺料那張初始必須是開的)。
    expect(TABLE).toMatch(/defaultOpen=\{stuck\.kind === 'stuck'/);
  });

  it('🔴 `unknown` 那兩種**必須把話講出來**(只有 not-stuck 可以沉默)', () => {
    // describeItemStuck 對 not-stuck 回 null ⇒ 呼叫端要畫 non-null 的那幾種。
    expect(TABLE).toMatch(/stuckNote !== null/);
  });

  // 🔴🔴 **上一版這一格釘的是原始碼字面 `openId == null ? defaultOpen`,而【那一行就是 bug 本體】**
  //    (`W6-030` M1)⇒ **它確認了 bug 在場,不是抓到它。它綠,而功能是壞的。**
  //    ⇒ 已改成**行為測試**,在 `item-amount-open-behavior.test.tsx`(開→收→必須維持關著)。
  //    📌 **字面守門只能證明「code 裡有這段字」,證不了「這段字做對了事」。**
  //    這裡只留一格**負向**:那個錯的判準不得復活。
  it('🔴 `defaultOpen` 的判準**不得**是 `openId == null`(那個值正是「收起來」的結果)', () => {
    expect({ 用了錯的判準: /openId == null \? defaultOpen/.test(ROW) }).toEqual({
      用了錯的判準: false,
    });
    expect(ROW).toMatch(/touched/);
  });
});
