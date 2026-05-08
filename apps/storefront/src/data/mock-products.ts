/**
 * Mock product catalog — 字面從 design-reference/data/products.js @ d5ea3aa 直接搬
 * 對齊 main-d-d1 拍板「直接搬、不翻譯」精神
 *
 * d2 接 SupabaseProductAdapter 真資料時、本檔保留作 fallback / Storybook 樣本(待 d2 拍板)
 */

export type MockProduct = {
  id: number;
  brand: string;
  name: string;
  fits: string;
  price: number;
  origPrice: number | null;
  isNew: boolean;
  isSale: boolean;
  inStock: boolean;
  category: string;
  color: string;
  imgTone: string;
};

export const MOCK_PRODUCTS: MockProduct[] = [
  { id: 1, brand: 'LIGHTECH', name: 'Lightech 鋁合金腳踏組', fits: 'CBR600RR', price: 12800, origPrice: null, isNew: true, isSale: false, inStock: true, category: '操控部品 · 腳踏後移', color: 'silver', imgTone: 'cool' },
  { id: 2, brand: 'LIGHTECH', name: 'Lightech 可調式拉桿組', fits: 'YAMAHA R6', price: 5800, origPrice: 7200, isNew: false, isSale: true, inStock: true, category: '操控部品 · 拉桿', color: 'red', imgTone: 'red' },
  { id: 3, brand: 'CNC RACING', name: 'CNC Racing 油箱蓋', fits: 'Ducati Panigale V4', price: 6500, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · 油箱蓋', color: 'silver', imgTone: 'neutral' },
  { id: 4, brand: 'GB RACING', name: 'GB Racing 引擎護蓋套組', fits: 'BMW S1000RR', price: 8900, origPrice: null, isNew: false, isSale: false, inStock: true, category: '車身套件 · 引擎護蓋', color: 'black', imgTone: 'dark' },
  { id: 5, brand: 'RIZOMA', name: 'RIZOMA CIRCUIT 959 後視鏡', fits: '通用款', price: 4200, origPrice: null, isNew: true, isSale: false, inStock: true, category: '精品配件 · 後視鏡', color: 'silver', imgTone: 'cool' },
  { id: 6, brand: 'AKRAPOVIČ', name: 'Akrapovič 鈦合金全段排氣', fits: 'Panigale V4', price: 98000, origPrice: 112000, isNew: false, isSale: true, inStock: false, category: '引擎部品 · 排氣管', color: 'titanium', imgTone: 'warm' },
  { id: 7, brand: 'BREMBO', name: 'Brembo GP4-RX 輻射卡鉗', fits: 'BMW S1000RR', price: 52000, origPrice: null, isNew: true, isSale: false, inStock: true, category: '煞車系統 · 卡鉗', color: 'gold', imgTone: 'warm' },
  { id: 8, brand: 'ÖHLINS', name: 'Öhlins TTX GP 後避震', fits: 'ZX-10R', price: 68000, origPrice: null, isNew: false, isSale: false, inStock: true, category: '避震 · 後避震', color: 'yellow', imgTone: 'gold' },
  { id: 9, brand: 'RIZOMA', name: 'RIZOMA 鋁合金油箱蓋', fits: 'MT-09', price: 3800, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · 油箱蓋', color: 'silver', imgTone: 'cool' },
  { id: 10, brand: 'CNC RACING', name: 'CNC 可折式拉桿組', fits: 'Panigale V2', price: 7200, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品 · 拉桿', color: 'red', imgTone: 'red' },
  { id: 11, brand: 'LIGHTECH', name: 'Lightech 車架防倒球', fits: 'MT-10', price: 2400, origPrice: 2800, isNew: false, isSale: true, inStock: true, category: '車身套件 · 防倒球', color: 'black', imgTone: 'dark' },
  { id: 12, brand: 'TERMIGNONI', name: 'Termignoni 碳纖維中段', fits: 'Streetfighter V4', price: 42000, origPrice: null, isNew: true, isSale: false, inStock: true, category: '引擎部品 · 排氣管', color: 'black', imgTone: 'dark' },
  { id: 13, brand: 'GB RACING', name: 'GB Racing 變速箱護蓋', fits: 'ZX-10R', price: 3600, origPrice: null, isNew: false, isSale: false, inStock: true, category: '車身套件 · 引擎護蓋', color: 'black', imgTone: 'dark' },
  { id: 14, brand: 'RIZOMA', name: 'RIZOMA Quantum 方向燈', fits: '通用款', price: 2800, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · LED', color: 'silver', imgTone: 'cool' },
  { id: 15, brand: 'BREMBO', name: 'Brembo T-Drive 浮動碟盤', fits: 'RSV4', price: 18500, origPrice: null, isNew: false, isSale: false, inStock: true, category: '煞車系統 · 碟盤', color: 'silver', imgTone: 'neutral' },
  { id: 16, brand: 'CNC RACING', name: 'CNC 鑰匙蓋防盜組', fits: 'Monster', price: 2100, origPrice: null, isNew: false, isSale: false, inStock: true, category: '精品配件 · 鑰匙蓋', color: 'silver', imgTone: 'cool' },
  { id: 17, brand: 'LIGHTECH', name: 'Lightech 碳纖維土除', fits: 'Tuono V4', price: 9200, origPrice: null, isNew: true, isSale: false, inStock: true, category: '車身套件 · 土除', color: 'black', imgTone: 'dark' },
  { id: 18, brand: 'AKRAPOVIČ', name: 'Akrapovič Slip-On 尾段', fits: 'MT-09', price: 38000, origPrice: 45000, isNew: false, isSale: true, inStock: true, category: '引擎部品 · 排氣管', color: 'titanium', imgTone: 'warm' },
  { id: 19, brand: 'ÖHLINS', name: 'Öhlins FGK 前叉套件', fits: 'Panigale V4', price: 125000, origPrice: null, isNew: false, isSale: false, inStock: false, category: '避震 · 前叉', color: 'gold', imgTone: 'gold' },
  { id: 20, brand: 'RIZOMA', name: 'RIZOMA 腳踏後移', fits: 'MT-10', price: 18500, origPrice: null, isNew: false, isSale: false, inStock: true, category: '操控部品 · 腳踏後移', color: 'silver', imgTone: 'cool' },
];
