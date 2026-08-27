# OD `orders-admin-v2.html`:真正生效的是【payload】不是明文 `<style>`

> 這份檔回答 `CLAUDE.md` 路由表那句掛了很久、沒人答過的警告:
> 「`orders-admin-v2.html:4608` 有一段 `<script type="text/plain" id="od-payload">`(gzip+base64)
>  ⇒ 先確認真正生效的是 `<style>` 還是那段 payload。」
> 🔴 **答案:payload。而每一次對稿的人都會撞到這格 —— 這份檔就是不用再撞的那個答案。**
> (量測時點 2026-08-27;稿 sha `fc4a24a5…` / 6795 行,與路由表記載一致=現行權威。sha 對不上 ⇒ 本檔全部重驗。)

## 1. payload 解開之後是什麼
一個 **JSON 陣列,95 個頁面物件**(解開後 2.7 MB;`kind` 分佈:`page` 76 + `panel` 19)。
每個物件 = `{"url","title","kind","html"}`,`html` 欄是那一頁**完整的 unescaped HTML**。
⇒ 它不是「另一版 CSS」也不是「編輯器狀態」——**它就是那 95 個畫面本身**。

## 2. 🔴 誰在畫面上生效 = payload(有碼去讀它、解開、注入)
`<script type="text/plain">` 自己不執行,**但它【後面】那段真 `<script>` 會讀它**:
```
orders-admin-v2.html:4640-4649(boot script)
  document.getElementById('od-payload').textContent  → atob(base64)
  → new DecompressionStream('gzip')  → .text().then(boot)
  → boot() 把 95 頁 innerHTML 注入 #od-stage
開檔時的「正在解開 95 個畫面…」就是它。
```
⇒ **畫面上生效的是【解開後的 payload】,不是明文那幾個 `<style>`。**
⇒ **對稿要對 payload,`grep` 明文 HTML 只會拿到「殼」。**

## 3. 三格具體差異(明文殼 vs 注入畫面/payload)
| 語意 | grep 明文殼 | 解開 payload | 意思 |
|---|---|---|---|
| FIX-01 焦點列 `data-od-id="order-focal"` | **1** | **38** | 明文那 1 個是殼裡的殘留;真正的 38 個 panel 在 payload |
| FIX-02 三欄壓密 `bg-card px-4 py-3 text-card-foreground` | **0** | **114** | 明文【完全看不到】,payload 才有 |
| FIX-07 面板外框 `panel-width-locked sticky top-0 flex` | **1** | **19** | 同上,19 個 panel 在 payload |
📌 **這就是「order-focal 明文 1 個 / payload 38 個」那格的根**:grep 明文得到 1,會誤判「稿幾乎沒畫」。

## 4. 🔴 判別動作(可重跑,不是「我看過了」)
🔴 **陷阱**:payload 是 **JSON(引號被 escape 成 `\"`)** ⇒ 直接 grep `class="..."` 這種帶引號的字面**在 payload 裡數到 0**。
必須**先 parse JSON 再數 `html` 欄**(下面這行做的就是這件事)。

```bash
# 用法:數某個 marker 在【真正生效的 payload】裡出現幾次(H=稿路徑,M=要數的字面)
H=~/Library/Application\ Support/Open\ Design/namespaces/release-stable/data/projects/pcm-524f/orders-admin-v2.html
python3 -c 'import re,base64,gzip,io,json,sys; h=io.open(sys.argv[1],encoding="utf-8",errors="replace").read(); m=re.search(r"id=\"od-payload\"[^>]*>(.*?)</script>",h,re.S); pages=json.loads(gzip.decompress(base64.b64decode(m.group(1).strip())).decode()); print("pages",len(pages),"|",sys.argv[2],"=",sum(p["html"].count(sys.argv[2]) for p in pages))' "$H" 'data-od-id="order-focal"'
# ⇒ pages 95 | data-od-id="order-focal" = 38
```
負對照:把最後那個 marker 換成一個不存在的字面 ⇒ 應印 `= 0`(證明尺會歸零、不是恆印 38)。

## 效度限制
- 本檔數的是【稿 payload 內含幾個】,不是【後台實作有幾個】——後者用 `grep -rn <marker> apps/admin`。
- sha 綁在檔頭;稿被 Sean 改過 ⇒ sha 變 ⇒ 上面所有數字要重跑那行指令重取。
