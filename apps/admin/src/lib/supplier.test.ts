import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listSupplierRows } = vi.hoisted(() => ({ listSupplierRows: vi.fn() }));

vi.mock('./supplier-repository', () => ({ listSupplierRows }));

import { listSuppliers } from './supplier';

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
