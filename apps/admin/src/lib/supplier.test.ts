import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listSupplierRows } = vi.hoisted(() => ({ listSupplierRows: vi.fn() }));

vi.mock('./supplier-repository', () => ({ listSupplierRows }));

import {
  listSuppliers,
  listSuppliersForSettings,
  sortSuppliersByLabel,
} from './supplier';

const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

// 🔴 大括號 body 是必要的,不是風格:`() => mock.mockReset()` 會**回傳 mock 本身**,
//    而 vitest 把 beforeEach 的回傳函式當成 teardown callback ⇒ 每個測試跑完會**呼叫那個 mock**。
//    平常無害(回傳值被丟掉),但只要該測試把實作設成「拋錯 / 回 rejected promise」,
//    teardown 就會自己炸一次 ⇒ 測試無條件失敗,而錯誤指向 `new Error(...)` 那一行、看起來像斷言沒接住。
//    實測 vitest 4.1.5:簡潔箭頭 → 紅;大括號 → 綠。
beforeEach(() => {
  listSupplierRows.mockReset();
});

describe('listSuppliers', () => {
  // ── 驗收 14:預設只回啟用中的 ────────────────────────────────
  // 🔴 這條是「拿掉 .filter((row) => row.is_active) 必須轉紅」的那一條。
  //    停用的那筆刻意挑 zh-TW 排序會**排在最前面**的名字 ⇒ 過濾一旦拿掉,
  //    回傳長度與第一個元素**同時**改變,不會只差在尾巴而被寬鬆斷言放過。
  it('should exclude inactive suppliers even when they would sort first', async () => {
    listSupplierRows.mockResolvedValue([
      { id: id(1), label: '安豐達', is_active: false },
      { id: id(2), label: '阿毅物流', is_active: true },
      { id: id(3), label: 'AKOSO', is_active: true },
    ]);

    await expect(listSuppliers()).resolves.toEqual([
      { id: id(2), label: '阿毅物流' },
      { id: id(3), label: 'AKOSO' },
    ]);
  });

  it('should return an empty list when every supplier is inactive', async () => {
    listSupplierRows.mockResolvedValue([
      { id: id(1), label: '安豐達', is_active: false },
      { id: id(2), label: 'AKOSO', is_active: false },
    ]);

    await expect(listSuppliers()).resolves.toEqual([]);
  });

  // ── 驗收 15:zh-TW 排序,中英混排向量釘住實際順序 ──────────────
  // 🔴 輸入**刻意是亂序**,且期望順序與「JS 預設 .sort()」不同(實測 node v22.22.3):
  //      輸入        Webike TW / 阿毅物流 / AKOSO / 陳蔚仁 / WRS s.r.l / 安豐達
  //      zh-TW       安豐達 / 阿毅物流 / 陳蔚仁 / AKOSO / Webike TW / WRS s.r.l
  //      預設 sort   AKOSO / WRS s.r.l / Webike TW / 安豐達 / 阿毅物流 / 陳蔚仁
  //    ⇒ 拿掉 .sort() 會紅(變回輸入序)、把 collator 換成預設排序也會紅、換成 zh-CN 拼音也會紅。
  //    中文排在英文前面、中文之間按筆畫 —— 這是 zh-TW 規則的結果,不是任意選的。
  // 🔴 這組向量**分不出來**的變化(關卡2 實跑,六筆全部仍得到同一期望順序):
  //    `zh-Hant` / `zh-HK` / `sensitivity:'base'` / `numeric:true` / `ignorePunctuation:true`。
  //    ⇒ 本條證的是「**這六個名字的相對次序**」,**不是**「完整的 zh-TW collation 行為被釘死」。
  //    要收窄那些變化得另外挑向量(例:含數字、含標點、含異體字的名稱),本片沒做。
  // 前提斷言:整條排序驗收都建立在「這個 runtime 真的有 zh-TW 定序表」上。
  // 🔴 ICU 不完整(small-icu)時 `Intl.Collator('zh-TW')` **不會報錯**,會靜默退回**別的 locale**
  //    ⇒ 順序整個變掉。少了這條,那種環境下的失敗會顯示成一個看不懂的順序不符。
  //    (關卡2 修正字面:退回的**未必**是 root —— ICU 的協商可能先落到 default locale;
  //     能確定的只有「不是 zh-TW 的完整定序資料」,不能宣稱「必為 root、拉丁必在前」。)
  it('should have zh-TW collation available in this runtime (precondition)', () => {
    expect(new Intl.Collator('zh-TW').resolvedOptions().locale).toBe('zh-TW');
  });

  it('should sort by the pinned zh-TW rule (Chinese before Latin, strokes within Chinese)', async () => {
    listSupplierRows.mockResolvedValue([
      { id: id(1), label: 'Webike TW', is_active: true },
      { id: id(2), label: '阿毅物流', is_active: true },
      { id: id(3), label: 'AKOSO', is_active: true },
      { id: id(4), label: '陳蔚仁', is_active: true },
      { id: id(5), label: 'WRS s.r.l', is_active: true },
      { id: id(6), label: '安豐達', is_active: true },
    ]);

    const result = await listSuppliers();

    expect(result.map((s) => s.label)).toEqual([
      '安豐達',
      '阿毅物流',
      '陳蔚仁',
      'AKOSO',
      'Webike TW',
      'WRS s.r.l',
    ]);
  });

  // ── 邊界 ────────────────────────────────────────────────
  it('should return an empty list when the table is empty', async () => {
    listSupplierRows.mockResolvedValue([]);

    await expect(listSuppliers()).resolves.toEqual([]);
  });

  // 🔴 刻意與 listActiveStaff 不同:錯誤**必須往上拋**,不得吞成空陣列。
  //    空的供應商選單會讓員工以為「這家不存在」而新建重複供應商,而供應商不可刪除
  //    ⇒ 製造永久垃圾列。這條就是擋「有人日後順手加 try/catch 回 []」的守門。
  it('should propagate database errors instead of silently returning an empty list', async () => {
    const dbError = new Error('database unavailable');
    listSupplierRows.mockRejectedValue(dbError);

    await expect(listSuppliers()).rejects.toBe(dbError);
  });
});

// ── S3b-3a:共用排序的單一來源(plan §3.2 / `[K1-M10]`)──────────────
// 🔴 **兩條路各自的「結果順序」測試證明不了單一來源** —— 兩邊各 `new Intl.Collator('zh-TW')`
//    會讓兩條測試同時綠,而它們排的是兩份可以各自漂移的規則。
//    單一來源要靠**兩條性質不同**的斷言合起來釘:①行為層(下面兩支各自的向量)
//    ②結構層(整個 apps/admin/src 的非測試碼裡 collator 恰 1 處)。
describe('sortSuppliersByLabel', () => {
  it('should apply the same pinned zh-TW order to any row shape', () => {
    const rows = [
      { label: 'Webike TW' },
      { label: '阿毅物流' },
      { label: 'AKOSO' },
      { label: '陳蔚仁' },
      { label: 'WRS s.r.l' },
      { label: '安豐達' },
    ];

    expect(sortSuppliersByLabel(rows).map((r) => r.label)).toEqual([
      '安豐達',
      '阿毅物流',
      '陳蔚仁',
      'AKOSO',
      'Webike TW',
      'WRS s.r.l',
    ]);
  });

  // 🔴 collator 對「只差零寬字元」的兩個 label 回 0(親測 node v22)⇒ 沒有 tiebreak 的話
  //    這兩列的相對順序 = 輸入順序 = DB 回傳順序 = 跨請求不穩定,員工每次重整看到不同排法。
  //    而「內部零寬字造成的實質重複」正是本線明文不擋的情形 ⇒ 這種列真的會存在。
  //    兩個方向的輸入都必須得到**同一個**輸出,才證得了全序。
  it('should be a total order even when the collator calls two labels equal', () => {
    const zwsp = String.fromCharCode(0x200b);
    const plain = 'AKOSO';
    const shadowed = `AKOSO${zwsp}`;

    expect(new Intl.Collator('zh-TW').compare(plain, shadowed)).toBe(0); // 前提

    const forward = sortSuppliersByLabel([{ label: plain }, { label: shadowed }]);
    const backward = sortSuppliersByLabel([{ label: shadowed }, { label: plain }]);

    expect(forward.map((r) => r.label)).toEqual(backward.map((r) => r.label));
  });

  // 🔴 不就地排序:呼叫端拿到的若是同一個陣列,server component 的資料就會被下游改動。
  it('should not sort the caller array in place', () => {
    const rows = [{ label: 'Webike TW' }, { label: '安豐達' }];
    const before = rows.map((r) => r.label);

    sortSuppliersByLabel(rows);

    expect(rows.map((r) => r.label)).toEqual(before);
  });
});

describe('listSuppliersForSettings', () => {
  // 🔴 與 listSuppliers 的**唯一**差別:停用的列必須回得來。
  //    少了它,Sean Q2=A「撞名時定位到那一列讓員工自己按啟用」在畫面上做不到 ——
  //    因為那一列根本不在清單裡。
  it('should keep inactive suppliers and sort them with the shared order', async () => {
    listSupplierRows.mockResolvedValue([
      { id: id(1), label: 'Webike TW', is_active: true },
      { id: id(2), label: '安豐達', is_active: false },
      { id: id(3), label: 'AKOSO', is_active: true },
    ]);

    await expect(listSuppliersForSettings()).resolves.toEqual([
      { id: id(2), label: '安豐達', is_active: false },
      { id: id(3), label: 'AKOSO', is_active: true },
      { id: id(1), label: 'Webike TW', is_active: true },
    ]);
  });

  it('should propagate database errors instead of returning an empty list', async () => {
    const dbError = new Error('database unavailable');
    listSupplierRows.mockRejectedValue(dbError);

    await expect(listSuppliersForSettings()).rejects.toBe(dbError);
  });
});

// ── 結構層:collator 只准有一份 ──────────────────────────────────────
// 🔴 **誠實邊界(plan §3.2 已寫)**:這是**文字層**斷言。它保證「多出第二個 collator 建構
//    會被看見」,**不保證**「所有排序都經過 sortSuppliersByLabel」——
//    有人用 `.localeCompare()` 或不帶 `new` 的 `Intl.Collator(...)` 另排一次,本條看不見;
//    掃描範圍也只有 `apps/admin/src`(`packages/ui` 不在內)。
//    那些缺口由 code review 與各消費端自己的順序向量涵蓋,不是無縫。
// 🔴 排除測試檔是必要的:本檔上面那條 precondition 測試自己就建了一個 collator。
describe('排序來源唯一性(結構層)', () => {
  it('should construct a collator exactly once across non-test admin source', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const srcRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
    const entries = await readdir(srcRoot, {
      recursive: true,
      withFileTypes: true,
    });

    const scanned: string[] = [];
    let constructions = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      const absolute = `${entry.parentPath}/${entry.name}`;
      const relative = absolute.slice(srcRoot.length + 1);
      scanned.push(relative);
      const source = await readFile(absolute, 'utf8');
      // 🔴 數的是**建構次數**不是命中的檔案數(R1 must-fix):在 supplier.ts **同一檔內**
      //    再建第二把(最可能的落點,就在第一把旁邊)⇒ 檔案數仍是 1、舊寫法全綠。
      //    帶左括號才算,避免把註解裡提到 `new Intl.Collator` 的文字算進去。
      constructions += source.split('new Intl.Collator(').length - 1;
    }

    // 🔴 前提斷言 A:掃描真的走遍全樹,不是只掃到 lib/ 那棵子樹
    //    (R1 抓:`lib` 單獨就有 43 個非測試檔,用「檔數 > 50」當前提擋不住只掃 src 一半)。
    //    釘一個**離 lib 很遠**的已知檔,漏掃時這條先紅。
    expect(scanned).toContain('app/settings/staff/page.tsx');
    expect(scanned).toContain('components/settings/settings-result-banner.tsx');
    // 前提斷言 B:collator 就在它該在的那個檔(比對相對路徑,不是 basename ——
    //    R1 抓:比 basename 的話,搬到另一個也叫 supplier.ts 的檔照樣綠)。
    const owner = scanned.filter((relative) =>
      relative === 'lib/supplier.ts',
    );
    expect(owner).toHaveLength(1);

    expect(constructions).toBe(1);
  });
});
