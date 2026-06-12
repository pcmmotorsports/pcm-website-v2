/**
 * @module @pcm/adapters/payment/supabase-ca — Supabase Root 2021 CA(內嵌、供 payment_confirmer pg 連線 CA 驗證)
 *
 * 🔴 公開 CA 憑證(非機密、可入 git);內嵌為字串常數(非 fs.readFileSync)以利 Vercel serverless bundle
 * 必含(讀 .pem 檔在 serverless 可能未被打包)。
 *
 * 用途:`PaymentConfirmerAdapter` 連 Supabase **session pooler**(`*.pooler.supabase.com`)時
 * `ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true, servername: host }` 做 **verify-full**(完整鏈 +
 * hostname);adapter 另把 host 釘死 pooler DNS 網域(非 IP/非空)+ 顯式 servername,令 hostname 驗證對所有輸入強制
 * (MITM 縱深、不依賴 pg 隱式 IP 判斷)。Supabase pooler 憑證鏈 = leaf(CN=*.pooler.supabase.com)← Supabase
 * Intermediate 2021 CA ← 本 root(自簽)。
 *
 * 來源 + 驗證(2026-06-12 實測):
 * - 從 session pooler TLS 鏈第 3 張(自簽 root)取出,經 `rejectUnauthorized:true` 對 live pooler 握手成功反證為真。
 * - Subject/Issuer:`CN=Supabase Root 2021 CA, O=Supabase Inc`(自簽);有效期 2021-04-28 ~ 2031-04-26。
 * - SHA256 指紋:`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
 *   (可在 Supabase Dashboard → Settings → Database → SSL Configuration 下載憑證比對指紋)。
 */
export const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;
