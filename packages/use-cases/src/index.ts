// @pcm/use-cases — business logic 編排、跨 domain context 流程
//
// 對應 ADR-0002 §4.1(monorepo 結構)/ §5.3(bug 可追蹤性 — 業務邏輯錯找 use case)。
//
// M-1-14e-1b:會員 use-cases(register / login / logout / update-profile)。
// M-1-14e-2a:地址 CRUD use-cases(add / update / delete / set-default address)。
// M-1-14e-2b:車輛 CRUD use-cases(add / update / delete / set-primary vehicle;鏡像 e-2a、isPrimary)。
// 守 boundaries(ADR-0002 §4.2、use-cases ⊥ schemas):use-case 只收已驗證的 domain 型別;
// 表單 @pcm/schemas parse / strip 未知欄 / 取 session userId 在 delivery 層(f1 storefront
// server action、server 端、不信 client)。auth 走 IAuthService(e-1a)、profile 走
// ICustomerRepository、address 走 IAddressRepository、vehicle 走 IVehicleRepository(皆 M-1-14d);concrete adapter 由 f 段 wire-up 注入。

export { registerCustomer } from './register-customer';
export { loginCustomer } from './login-customer';
export { logoutCustomer } from './logout-customer';
export { updateProfile } from './update-profile';

export { addAddress, type AddressCreateInput } from './add-address';
export { updateAddress, type AddressPatch } from './update-address';
export { deleteAddress } from './delete-address';
export { setDefaultAddress } from './set-default-address';

export { addVehicle, type VehicleCreateInput } from './add-vehicle';
export { updateVehicle, type VehiclePatch } from './update-vehicle';
export { deleteVehicle } from './delete-vehicle';
export { setPrimaryVehicle } from './set-primary-vehicle';
