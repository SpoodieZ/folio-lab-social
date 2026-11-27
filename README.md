# Folio Lab · đăng bài tự động (tuyến 1, 2 và 3)

Thư mục này tự chạy ba tuyến đã duyệt: **FUNDING RADAR** (tuyến 1), **TOP GAINERS / TOP LOSERS** (tuyến 2) và **NEW ON TXFLOW** (tuyến 3). **Mặc định TẮT HẲN**: chưa có gì chạy, chưa có gì được đăng. Bật bằng một biến duy nhất, khi bạn quyết định.

## Ba mức công tắc (biến `SOCIAL_MODE` của repo GitHub)
| Giá trị | Chuyện gì xảy ra |
|---|---|
| chưa đặt hoặc `off` | không chạy gì |
| `dry` | chạy đủ các bước, dựng bài và ảnh, **lưu thành file để bạn tải về xem**, không đăng |
| `live` | đăng thật lên X |

Còn có: file `KILL` (đặt vào gốc repo, hoặc `state/KILL`) thì dừng ngay kể cả chạy tay; `enabled: false` trong `config.json` để tạm dừng từng tuyến.

## Lịch và luật đăng (`config.json`, chốt 27/11/2026)
**Mỗi ngày 2 bài định kỳ**, thêm tuyến 3 khi có tin. Giờ chọn theo số lệnh và volume theo giờ trên TxFlow (nến 1 giờ của 237 mã, 29/10 đến 25/11); đó là giờ giao dịch, chưa phải giờ người xem lên X: sau 3 đến 4 tuần chỉnh theo X Analytics. Từ 14/3/2027 Mỹ đổi giờ mùa hè, đo lại.
| Bài | Tuyến | Giờ (UTC / VN) | Luật |
|---|---|---|---|
| 1 | `up` (gainers) | 08:00–09:00 / 15:00–16:00 | cần ít nhất 3 thị trường; trong 3 vị trí đầu, chỉ crypto có `$` |
| 2 | `funding` | 13:00–14:00 / 20:00–21:00, hết hạn 15:30 UTC (22:30 VN) | chỉ đăng khi APR cao nhất ≥ +100% hoặc thấp nhất ≤ −100%; mỗi bên tối đa 3 cặp có \|APR\| ≥ 50%; bỏ qua nếu hai danh sách giống hệt bài trước; cách bài trước ít nhất 6 giờ |
| 2 dự phòng | `down` (losers) | 16:00–17:00 / 23:00–00:00 | **chỉ khi hôm đó `funding` chưa đăng** (`onlyIfNoPost`); luật còn lại như `up` |
| thêm | `new` (tuyến 3) | khi có tin | xem mục Tuyến 3 |

Giới hạn chung **4 bài mỗi ngày** (`dailyCap`) = 2 định kỳ + 2 của tuyến 3. **Giờ đăng ngẫu nhiên:** mỗi tuyến định kỳ "thức dậy" 30 phút một lần trong khung của nó, mỗi ngày chọn một phút ngẫu nhiên trong `jitterMinutes` = 60 phút sau giờ mở cửa (cùng ngày và cùng tuyến thì luôn ra cùng một giờ) rồi đăng ở lần chạy kế tiếp, nên có thể muộn thêm khoảng 30 phút, hoặc hơn nếu GitHub chạy trễ. Hết khung (`windowMinutes`) mà chưa đăng được thì bỏ ngày đó. Chạy `dry` thì không có bài nào được ghi là đã đăng, nên cả `funding` và `down` đều dựng bài.

Mỗi bài đi qua: đọc dữ liệu một lần → dựng chữ, ảnh, alt text từ cùng lần đọc → kiểm tra mọi con số có trong dữ liệu → kiểm tra luật viết (độ dài, "not financial advice", không có lời khuyên, alt text, không có link trong bài chính, và reply theo chế độ đã chọn) → mới đăng. Quá 5 phút từ lúc đọc dữ liệu đến lúc đăng thì từ chối. Mọi quyết định (đăng, bỏ qua, lý do) ghi vào `state/log.jsonl`.

## Tuyến 3 (NEW ON TXFLOW): mã mới, mã quay lại, mã bị gỡ
`lines.new.enabled` là `true` từ 27/11/2026: tuyến này chạy theo `SOCIAL_MODE` như các tuyến khác.

- **Không có giờ đăng.** Chạy mỗi giờ (phút 53; GitHub có thể chạy trễ), chỉ đăng khi danh sách mã của TxFlow thay đổi. Tối đa 2 bài mỗi ngày (`maxPerDay`), vẫn tính vào `dailyCap`. Ngày tính theo giờ UTC.
- **Lần chạy đầu** chỉ lưu mốc vào `state/markets.json`, không đăng gì, nên thay đổi cũ không bị đăng như tin mới. Mốc này riêng, không dùng chung với công cụ thủ công trong `tools/social/`.
- **Không mất tin khi lỗi:** thay đổi vào danh sách chờ trước khi dựng bài, và chỉ ra khỏi danh sách **sau khi X nhận bài**. Lỗi ảnh, lỗi X hay hết giới hạn ngày thì lần chạy sau thử lại.
- **Quá 24 giờ chưa đăng được** (hoặc lịch bị tắt lâu rồi bật lại) thì bỏ tin đó, vì bài ghi "just appeared". Tên mã được ghi trong `state/log.jsonl` (dòng `dropped`): muốn đăng thì làm tay.
- **Chạy `dry`:** dựng mỗi bài một lần, tin vẫn nằm chờ. Đổi sang `live` trong vòng 24 giờ thì tin đó được đăng thật.
- Chỉ ghi `state/` khi có thay đổi, hoặc 6 giờ một lần (mỗi lần ghi là một commit trên GitHub). Tuyến đang tắt hoặc có file `KILL` thì không đọc, không ghi gì.
- Không đọc được nhãn phân loại của TxFlow (`marketTags`) thì không đăng, chờ lần sau.
- **Phần tự động không tìm logo** cho mã mới. Thẻ là thẻ chữ; logo trên heatmap của web vẫn làm tay (`tools/icons/add_logo.py`, xem ảnh rồi mới deploy).
- **Khi đã bật tự động** thì đừng đăng tuyến 3 bằng công cụ thủ công nữa, nếu không dễ đăng trùng.
- **Rủi ro chưa xử lý:** nếu X đã nhận bài nhưng phản hồi bị mất, hoặc bước lưu `state/` lên GitHub lỗi sau khi đăng, lần chạy sau có thể đăng trùng.

## Trạng thái (27/11/2026)
`SOCIAL_MODE` = `live` từ 15:23 giờ VN: đăng thật. Muốn dừng: đổi thành `off` hoặc `dry`. Khoá X đã lưu và đã kiểm tra; bài đăng thật đầu tiên (gainers, chạy tay) đã lên @Txfoliolab. Đến 19:00 giờ VN lịch chưa tự chạy lần nào, nên các phút hẹn đã được đổi sang :11/:41, :13/:43, :17/:47 và :53 để GitHub đọc lại lịch (chưa rõ nguyên nhân). Repo này nhận commit `state/` của bot, nên luôn `git pull --rebase` trước khi đẩy.

**Đã sửa 27/11/2026** (các lỗi thấy trong bài chạy thử đầu tiên):
1. Câu mở đầu "LED WITH" / "WAS HIT" chỉ nói về mã **đứng đầu danh sách**, và chỉ khi mã đó có volume từ $50K và biến động từ 10%; nếu không thì dùng câu thường.
2. Funding: cột "longs pay" chỉ có funding dương, "shorts pay" chỉ có funding âm (sửa trong `app/index.html`); một bên trống thì ảnh ghi rõ, chữ bỏ dòng đó, alt text ghi "none right now".
3. `$` chỉ gắn cho crypto theo phân loại của TxFlow (trong 3 vị trí đầu của gainers/losers). Cổ phiếu, ETF, chỉ số, pre-IPO, hàng hóa, FX, mã chưa có phân loại: không có `$`.
4. Tên dài trên heatmap tự thu nhỏ cho vừa ô.
Kèm theo: trang tải chậm thì chờ nút mở bảng giá thêm tối đa khoảng 30 giây; xin lại phân loại mã nếu lần đầu lỗi.
`app/` ở đây đang **mới hơn web công khai** cho đến lần deploy tiếp theo.

## Bật lần đầu: các bước (bạn làm; khoá thì không gửi qua chat)
1. **Tạo repo GitHub công khai riêng** (ví dụ `folio-lab-social`) và đẩy thư mục này lên. Công khai thì chạy miễn phí; đừng đưa file nào ngoài thư mục này vào. Trước khi đẩy chạy `./sync_app.sh` để chép bản mới nhất của trang web vào `app/` (sau mỗi lần deploy trang cũng chạy lại).
2. **Khoá X** (Settings → Secrets and variables → Actions → *Secrets*): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` của tài khoản sẽ đăng (đề xuất @Txfoliolab), tạo ở developer.x.com, quyền đọc và ghi. Tài khoản phải bật nhãn **Automated** và ghi trong bio ai điều hành.
3. **Chạy thử không đăng:** đặt biến (*Variables*) `SOCIAL_MODE` = `dry`, vào tab Actions → `social` → *Run workflow* → chọn tuyến, tick *force* (tuyến `new` lần đầu chỉ lưu mốc) → tải file ở mục *Artifacts* (có ảnh, chữ, reply, alt text). Để vài ngày cho lịch tự chạy ở chế độ `dry` rồi xem `state/log.jsonl`.
4. **Bài đăng thật đầu tiên làm cùng nhau:** phần gọi X API chưa được thử với tài khoản thật. Đặt `SOCIAL_MODE` = `live` rồi chạy tay một tuyến (tick *force*), kiểm tra bài hiện ra đúng.
5. Muốn tắt: đặt `SOCIAL_MODE` = `off` (hoặc xoá biến), hoặc thêm file `KILL`.

## Kiểm tra khoá (không đăng bài)
Tab Actions → `check-keys` → *Run workflow*. Chạy `check_keys.mjs`: một lần đọc `GET /2/users/me`, báo khoá thuộc tài khoản nào (mong đợi @Txfoliolab). Không đăng, không tải ảnh, không in khoá. X có thể tính một khoản phí đọc rất nhỏ. Đạt bước này **chưa** chứng minh đăng bài được (quyền ghi, credit cho bài đăng chỉ biết khi đăng thật).

## Reply dưới bài (`reply` trong `config.json`, mỗi tuyến một cài đặt)
| Giá trị | Chuyện gì xảy ra | Giá thêm mỗi bài |
|---|---|---|
| `none` (mặc định) | không reply. Bạn tự trả lời bằng tay với link nếu muốn (chữ để dán nằm trong file `out/`, mục "reply with the link") | $0 |
| `pointer` | reply tự động **không có link**, chỉ chỉ chỗ xem: "Folio Lab, link in our bio" | $0.015 |
| `link` | reply tự động có `txfolio.xyz` | $0.20 |
Bộ kiểm tra từ chối mọi bài mà **chữ chính hoặc reply kiểu `pointer` có tên miền hay link** (X sẽ tính $0.20 thay vì $0.015).

## Chi phí và giới hạn (đọc từ docs.x.com ngày 23/11/2026; kiểm tra lại ở Developer Console)
X tính tiền theo lần gọi: tạo bài **$0.015**, tạo bài **có link $0.20**, gắn alt text **$0.005**. Với `reply: none`, mỗi bài (có ảnh và alt text) tốn **$0.02**, 5 bài mỗi ngày khoảng **$3 mỗi tháng**; với `pointer` thì $0.035 mỗi bài, khoảng $5.25 mỗi tháng. Phí tải ảnh lên không thấy trong bảng giá (có thể $0): xem hóa đơn vài ngày đầu. Giới hạn của X: 100 bài mỗi 15 phút, không đáng lo.

## Đã thử và chưa thử
- **Đã thử thật** (chế độ `dry`, trên máy này): dựng được bài và ảnh của cả ba tuyến từ dữ liệu sống của TxFlow; công tắc `off`, cửa sổ giờ, file `KILL`, `live` thiếu khoá; chữ ký OAuth 1.0a khớp ví dụ trong tài liệu của X; `node test.mjs` (42 kiểm tra, gồm lịch 2 bài trong `config.json` và 16 kiểm tra cho tuyến 3: chạy cả luồng với X giả, giả lập lỗi từng bước). Tuyến 3 đã chạy `dry` với dữ liệu thật và Chrome thật trên máy này (27/11/2026).
- **Đã thử trên máy GitHub** (27/11/2026, `dry`, chạy tay): cả bốn tuyến chạy xong; Chrome dựng được ảnh, TxFlow trả dữ liệu cho máy GitHub; tuyến 3 đã dựng thẻ (thử bằng cách giấu `STRC` khỏi mốc, sau đó đã xoá khỏi danh sách chờ).
- **Chưa thử:** đăng thật lên X; lịch cron của GitHub tự chạy. Quy tắc của X về reply (chỉ trả lời người đã tương tác) có thể áp dụng cho reply vào bài của chính mình, chưa rõ.
- **Chưa có:** tuyến 4, tuyến 5 (xem `tools/social/README.md`).

## Các file
`run.mjs` (chạy một tuyến: `funding`, `up`, `down`, `new`) · `config.json` · `lib/lines.mjs` (dựng bài tuyến 1 và 2, chuyển từ `tools/social`) · `lib/newmarkets.mjs` (dữ liệu, chữ, ảnh của tuyến 3; công cụ thủ công cũng dùng file này) · `lib/line_new.mjs` (luồng tự động của tuyến 3) · `lib/guard.mjs` (khi nào được đăng) · `lib/check.mjs` (luật viết) · `lib/x.mjs` (gọi X API) · `lib/browser.mjs` (Chrome ẩn vẽ ảnh bằng chính mã của trang web) · `state/` (đã đăng gì, nhật ký) · `.github/workflows/social.yml` (lịch) · `test.mjs`.
