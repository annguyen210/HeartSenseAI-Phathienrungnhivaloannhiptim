# FACE PPG - Giải pháp — 5 thuật toán song song chạy cùng lúc:

1. CHROM (De Haan 2013): Ánh sáng đèn làm R, G, B thay đổi cùng tỉ lệ → đặc trưng "chrominance" của da giúp tách riêng nhiễu ánh sáng ra khỏi tín hiệu tim. Tốt nhất khi đèn huỳnh quang nhấp nháy.
2. POS (Wang 2017): Chiếu tín hiệu lên hướng vuông góc với màu da → chuyển động đầu (dọc theo hướng màu da) bị triệt tiêu, tim (vuông góc màu da) giữ lại. Tốt nhất khi người gật đầu nhẹ.
3. Region-Fused (4 vùng mặt): Chia mặt thành 4 vùng (Trán / Má trái / Má phải / Mũi), mỗi vùng tính SNR riêng. Vùng nào tín hiệu tốt hơn → đóng góp nhiều hơn. Thích ứng theo từng khuôn mặt.
4. ICA Green Residual (Poh 2010): Kênh Green chứa nhiều tín hiệu tim nhất. Dùng R và B làm "reference nhiễu" → trừ đi → còn lại tín hiệu tim thuần túy.
5. MTTS-CAN (Liu 2020): So sánh frame liên tiếp theo thời gian → ánh sáng thay đổi chậm (background noise) gần bằng 0, tín hiệu tim thay đổi nhanh → nổi bật lên.

Hệ thống tự chọn phương pháp tốt nhất: Sau khi chạy cả 5, tính SNR (Signal-to-Noise Ratio) của từng phương pháp → chọn phương pháp có SNR cao nhất sau lọc.

BlazeFace (TensorFlow.js): Tự động xác định vị trí khuôn mặt trong frame → chỉ đo đúng vùng da, không đo nền nhà hoặc áo.

Điều chỉnh cho người da sẫm màu: Người da sẫm (Fitzpatrick V-VI) hấp thụ nhiều ánh sáng hơn → tín hiệu yếu hơn → hệ thống điều chỉnh skinTone='dark' → hạ bias của POS (ít hiệu quả hơn với da sẫm), ưu tiên CHROM và Region-Fused hơn.

File & Code: app.js → analyzePPGSignal() dòng 1806–1847. extractChromSignal() dòng 431, extractPosSignal() dòng 812, extractFaceRegionFusedSignal() dòng 924, extractGreenResidualICA() dòng 956, extractMttsSignal() dòng 894. BlazeFace: TensorFlow.js library. Dữ liệu: camera stream, tất cả xử lý trong trình duyệt. """

# 1 Đo ngón trỏ lên camera """ Code:
- app.js · analyzePPGSignal() · dòng 1769–1805 — thu tín hiệu, chọn kênh màu tốt nhất
- app.js · butterworthBandpass() · dòng 403–409 — lọc nhiễu, giữ lại tần số tim
- ppg-worker.js · fftBpm() · dòng 44–68 — biến đổi Fourier ra BPM
- ppg-worker.js · autocorrBpm() · dòng 71–109 — tự tương quan xác nhận chu kỳ """

# 2 Phát hiện AFib (Rung nhĩ) """ Code:
- app.js · analyzePPGSignal() · dòng 2105–2296 — toàn bộ 17 nguồn bằng chứng tính điểm
- app.js · checkTemporalConsistency() · dòng 490–500 — kiểm tra loạn nhịp kéo dài liên tục
- app.js · hampelFilter() · dòng 451–466 — lọc nhịp ngoại lai trước khi phân tích
- server.js · analyzeMeasurement() · dòng 1340–1364 — phân loại cuối: normal / elevated / afib """

#  3 Kết quả tức thì (BPM · HRV · Stroke Risk · AFib Index) """ Code:
- app.js · dòng 2299 — hrvScore = (SDNN/90 × 55) + (RMSSD/65 × 45)
- app.js · dòng 2296 — afibScore = min(95, afibEvidence × 0.413)
- server.js · dòng 1306–1309 — strokeRiskScore tổng hợp 8 thành phần
- app.js · renderMeasurementResult() · dòng 7456–7512 — hiển thị toàn bộ kết quả lên màn hình """

# 4 Pocket Cardiologist AI — Bác sĩ ảo tiếng Việt 
""" Code:
- app.js · askPocketCardiologist() · dòng 9747–9806 — flow chính: nhận câu hỏi → gọi Gemini → fallback rule-based
- app.js · dòng 9784 — api("/api/pocket-cardiologist", { question, history, ctx }) — gửi kèm kết quả đo thực tế
- app.js · _pcRuleBasedAnswer() · dòng 9803 — fallback offline khi Gemini lỗi
- app.js · dòng 9738 — pcSpeak(answer) — đọc to câu trả lời bằng giọng nói tiếng Việt """

# ⑤ SOS + Người giám hộ """ Code:
- app.js · startSosCountdown() · dòng 8516–8527 — bắt đầu đếm ngược 15 giây, phát chuông báo
- app.js · triggerSos() · dòng 8529–8565 — lấy GPS, hiển thị nút gọi người thân, gửi alert lên server
- app.js · dòng 8537–8546 — navigator.geolocation.getCurrentPosition(...) lấy tọa độ GPS thực
- app.js · dòng 7129–7134 — kích hoạt SOS tự động sau khi server xác nhận AFib """

# 6. Holter 7 ngày — Phát hiện AFib từng cơn """ Code:
- app.js · dòng 4920–4929 — định nghĩa cấu trúc Holter, 6 khung giờ/ngày
- app.js · _getCurrentHolterWindow() · dòng 4935–4946 — kiểm tra có đang trong khung giờ hợp lệ không
- app.js · _logHolterMeasurement() · dòng 4961–4969 — ghi kết quả đo vào đúng slot ngày/giờ
- app.js · dòng 7124 — if (_holter.active) _logHolterMeasurement(localResult) — tự động ghi sau mỗi lần đo

# 7 Xuất báo cáo bác sĩ — Chia sẻ qua Zalo/Gmail  Code:
- app.js · shareReport() · dòng 5347–5369 — tạo link + tóm tắt kết quả đo gần nhất
- app.js · _doShare() · dòng 5309–5345 — phân nhánh: Zalo (Web Share API) vs Gmail (mailto/web)
- app.js · dòng 5312–5322 — navigator.share(...) → Zalo mobile; fallback → dialog copy link
- app.js · dòng 5324–5334 — Gmail mobile dùng mailto:, desktop dùng Gmail web compose """

# HEARTSENSE Workspace

Workspace nay hien co 2 lop song song:

- Lop 1: prototype web/PWA dang chay ngay o root workspace de ban test flow tuc thi.
- Lop 2: scaffold production moi gom `apps/web`, `apps/mobile`, `apps/api`, `packages/shared`, `prisma`.

## 1. Prototype dang test ngay

Ban co the chay ngay:

```powershell
node server.js
```

Sau do mo [http://localhost:8080](http://localhost:8080).

Prototype hien co:

- Dang ky / dang nhap va luu ho so tim mach co tuoi, gioi tinh, benh nen.
- Guardian setup voi phone/email va mo phong kenh SMS, Zalo, Email.
- Camera selector, huong dan quyen webcam, fallback khi khong co webcam.
- Face PPG demo qua webcam, Finger PPG demo mode, breathing coach.
- Heart-Print baseline 3 lan, ket qua so sanh voi resting BPM/HRV ca nhan.
- Phan loai normal / elevated / AFib nghi ngo, popup hoi ly do bat thuong nhe.
- SOS 15 giay, huy SOS, nhac goi 115, benh vien gan nhat, thong bao web va alarm tone.
- Nhat ky trieu chung, lich nhac thuoc OCR prototype tu ten file anh, bao cao hang tuan.
- Report HTML de in / luu PDF bang trinh duyet.
- Polling dashboard dinh ky de mo phong dong bo cross-platform.

## 2. Scaffold production moi

### `apps/web`

- Next.js app scaffold de dua giao dien production len domain web.
- Du kien noi TensorFlow.js Face rPPG, OCR that, auth that, push subscription va dashboard production.

### `apps/mobile`

- Expo/native wrapper scaffold cho iOS va Android.
- Duong nang cap de them `expo-camera`, push notification, Finger PPG camera sau + flash, offline sync.

### `apps/api`

- API service production scaffold.
- Duong nang cap de noi PostgreSQL/Prisma, Twilio SMS, Zalo ZNS, Resend Email, Web Push, weather API.

### `packages/shared`

- Module dung chung cho Finger PPG, Face rPPG, OCR parser va notification adapters.
- Day la noi de dong bo thuat toan giua web, mobile va backend.

### `prisma`

- Schema database production cho user, guardian, baseline, measurement, symptom, reminder, push device, SOS.

## 3. File quan trong

- `server.js`: prototype server dang runnable.
- `index.html`, `styles.css`, `app.js`: prototype UI/UX de test ngay.
- `.env.example`: bien moi truong cho ban production.
- `apps/api/src/server.js`: production API scaffold.
- `apps/web/app/page.tsx`: production web scaffold.
- `apps/mobile/App.tsx`: production mobile scaffold.
- `packages/shared/src/*`: signal processing va adapters dung chung.
- `prisma/schema.prisma`: database schema production.

## 4. Ghi chu quan trong

- Prototype root dang test duoc ngay, nhung chua la he thong y te duoc kiem dinh.
- Scaffold production moi da co cau truc va diem noi tich hop, nhung de chay that can cai dependency, tao DB, them credential va deploy.
- OCR, SMS, Zalo, Email, Push, weather va mobile native hien moi o muc scaffold/provider adapter, chua active vi chua co key va moi truong that.
- De deploy web that, ban nen dung HTTPS bat buoc de `getUserMedia()` hoat dong.
