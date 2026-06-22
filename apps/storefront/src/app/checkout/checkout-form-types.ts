// app/checkout/checkout-form-types.ts — 結帳表單欄位錯誤型別(charge-actions live 路徑共用)
//
// 純型別模組(無 'use server';型別編譯期擦除)。原寄居於 checkout/actions.ts(隨退役建單 action
// placeOrderAction 一起),#246 死碼清理刪除 actions.ts 時,抽出這兩個被 live 刷卡路徑
// charge-actions.ts 共用的欄位錯誤型別、獨立成命名檔(PlaceOrderActionResult 隨死碼一併移除)。

// invoice 巢狀 fieldErrors(對齊 CheckoutInput superRefine path ['invoice','title'|'taxId'|'donateCode'])。
export type CheckoutInvoiceFieldErrors = Partial<
  Record<'carrier' | 'title' | 'taxId' | 'donateCode', string>
>;
// 結帳表單頂層欄(addressId/shippingMethod)+ 巢狀 invoice。
export type CheckoutFieldErrors = {
  addressId?: string;
  shippingMethod?: string;
  invoice?: CheckoutInvoiceFieldErrors;
};
