# HEARTSENSE v4.0 - Tài liệu giải thích code theo từng tính năng trên `index.html`

Tài liệu này bám theo toàn bộ các phần đang hiển thị ở màn hình local host `8010` từ file `index.html`. Mỗi mục đều có bốn phần:

- **Hiển thị ở đâu:** vị trí UI trong `index.html`.
- **Mục đích:** tính năng dùng để làm gì.
- **Cách hoạt động:** giải thích logic/hàm chính.
- **Code liên quan:** file, dòng và hàm đang xử lý.

Lưu ý: Dòng code bên dưới được lấy theo trạng thái hiện tại của dự án. Tài liệu chỉ giải thích hệ thống, không thay đổi logic app.

---

## 1. Khung ứng dụng, trạng thái hệ thống và PWA

**Hiển thị ở đâu:** `index.html` dòng 14, 17, 24, 35-42, 47.

**Mục đích:** Đây là phần đầu trang gồm toast thông báo, thanh báo mất mạng, trạng thái kết nối backend, nút cài PWA, nút bật thông báo và nút đo nhanh. Ban giám khảo nhìn vào phần này sẽ thấy app không chỉ là trang đo tim, mà có cơ chế vận hành như một PWA y tế: kiểm tra server, hỗ trợ offline, thông báo, cài đặt trên điện thoại.

**Cách hoạt động:** Khi app khởi động, hàm `init()` gọi `detectPlatform()`, `renderQrFallback()`, `bindPwa()`, `bindEvents()`, `updateOnlineStatus()` và `checkHealth()`. `checkHealth()` gọi `/api/health` để đổi trạng thái "Đang kết nối..." thành trạng thái hoạt động thật. `bindPwa()` bắt sự kiện cài PWA, còn `requestNotifications()` xin quyền notification. Nếu trình duyệt offline, `updateOnlineStatus()` hiện thanh offline và các phiên đo sẽ được giữ lại bằng IndexedDB thông qua `saveOfflineMeasurement()` rồi đồng bộ lại bằng `syncOfflineMeasurements()`.

**Code liên quan:**

- `index.html` dòng 14: `#toastContainer`.
- `index.html` dòng 17: `#offlineIndicator`.
- `index.html` dòng 24: `#healthStatus`.
- `index.html` dòng 38-42: `#installBtn`, `#requestNotificationBtn`, `#quickStartBtn`.
- `app.js` dòng 76-201: object `el` map toàn bộ DOM cần dùng.
- `app.js` dòng 204: `api(path, options)` gọi API với header CSRF.
- `app.js` dòng 220: `showToast()` hiển thị thông báo nổi.
- `app.js` dòng 244: `openOfflineDb()`.
- `app.js` dòng 252: `saveOfflineMeasurement()`.
- `app.js` dòng 260: `syncOfflineMeasurements()`.
- `app.js` dòng 290: `updateOnlineStatus()`.
- `app.js` dòng 6769: `detectPlatform()`.
- `app.js` dòng 6782: `checkHealth()`.
- `app.js` dòng 6798: `requestNotifications()`.
- `app.js` dòng 9208: `quickStart()`.
- `app.js` dòng 9417: `bindPwa()`.
- `app.js` dòng 9427: `bindEvents()`.
- `app.js` dòng 9522: `init()`.
- `server.js` dòng 4115: route `GET /api/health`.

---

## 2. Đăng ký, đăng nhập, hồ sơ cá nhân

**Hiển thị ở đâu:** `index.html` dòng 62-99, 126-131.

**Mục đích:** Phần "Thiết lập & Cá nhân hóa" cho phép người dùng tạo tài khoản, đăng nhập, đăng xuất, mở report và xem hồ sơ cá nhân. Đây là nền để app cá nhân hóa nguy cơ đột quỵ, baseline, thuốc, người giám hộ, lịch sử đo.

**Cách hoạt động:** Form đăng ký gửi tên, email, tuổi, giới tính, bệnh nền, số điện thoại lên backend. Backend tạo user, hash mật khẩu bằng `hashPassword()`, trả session token. Form đăng nhập gọi backend kiểm tra mật khẩu bằng `verifyPassword()`, có rate limit chống thử sai liên tục. Sau khi có token, frontend gọi `restoreSession()` và `loadDashboard()` để dựng lại toàn bộ dữ liệu cá nhân.

**Code liên quan:**

- `index.html` dòng 72-86: `#registerForm`.
- `index.html` dòng 89-97: `#loginForm`, `#logoutBtn`, `#reportLink`.
- `index.html` dòng 126-131: `#profileSummary`, `#baselineSummary`.
- `app.js` dòng 300: `setAuthState()` cập nhật trạng thái đăng nhập.
- `app.js` dòng 306: `setReportLink()` tạo link báo cáo.
- `app.js` dòng 8617: `renderProfile(user)` hiển thị hồ sơ.
- `app.js` dòng 8946: `restoreSession()`.
- `app.js` dòng 8958: `handleRegister(event)`.
- `app.js` dòng 8971: `handleLogin(event)`.
- `app.js` dòng 8984: `logout()`.
- `app.js` dòng 9429-9431: gắn submit/click cho đăng ký, đăng nhập, đăng xuất.
- `server.js` dòng 169: `checkLoginRateLimit(email)`.
- `server.js` dòng 331: `hashPassword()`.
- `server.js` dòng 336: `verifyPassword()`.
- `server.js` dòng 341: `summarizeUser(user)`.
- `server.js` dòng 2965: `handleRegister(body, res)`.
- `server.js` dòng 2993: `handleLogin(body, res)`.
- `server.js` dòng 3017: `handleSession(urlObject, body, res)`.
- `server.js` dòng 4119-4121: routes `/api/auth/register`, `/api/auth/login`, `/api/session`.

---

## 3. Người giám hộ, Mắt thần cho con xa và báo cáo tự động

**Hiển thị ở đâu:** `index.html` dòng 101-107, 850-894.

**Mục đích:** Người dùng nhập email/số điện thoại người thân để app gửi cảnh báo, báo cáo định kỳ hoặc báo cáo từ xa. Đây là phần quan trọng với bối cảnh chăm sóc người lớn tuổi: con/cháu có thể nhận thông tin khi có kết quả bất thường hoặc khi bố mẹ đo xong.

**Cách hoạt động:** `saveGuardian()` lưu thông tin người giám hộ qua `PUT /api/guardian`. Form "Mắt thần cho con xa" dùng `saveSchedule()` để bật/tắt gửi báo cáo tự động, bật thông báo khi đo xong và đặt giờ gửi báo cáo. Nút gửi báo cáo gọi `sendParentReport()`, backend dựng HTML email bằng `buildReportEmailHtml()`, có thể kèm nhận xét AI qua `generateGuardianAiComment()`, rồi gửi bằng Resend hoặc Gmail.

**Code liên quan:**

- `index.html` dòng 101-107: `#guardianForm`, `#guardianStatus`.
- `index.html` dòng 855-884: `#scheduleForm`, `#notifyOnMeasurement`, `#autoReportEnabled`, `#autoReportTime`.
- `index.html` dòng 890-894: `#parentReportMessage`, `#sendParentReportBtn`, `#parentReportStatus`.
- `app.js` dòng 8993: `saveGuardian(event)`.
- `app.js` dòng 9004: `saveSchedule(event)`.
- `app.js` dòng 9389: `sendParentReport()`.
- `app.js` dòng 9432-9433: binding guardian/schedule.
- `app.js` dòng 9457: binding nút gửi report cho người thân.
- `server.js` dòng 466: `buildReportEmailHtml()`.
- `server.js` dòng 531: `buildAiAnalysisEmailHtml()`.
- `server.js` dòng 582: `buildMeasurementEmailHtml()`.
- `server.js` dòng 639: `generateGuardianAiComment()`.
- `server.js` dòng 686: `sendGuardianMeasurementNotification()`.
- `server.js` dòng 3024: `handleGuardian()`.
- `server.js` dòng 3659: `handleSendRemoteParentReport()`.
- `server.js` dòng 3688: `runSchedulerCheck()`.
- `server.js` dòng 3779: `startAutoReportScheduler()`.
- `server.js` dòng 4122, 4198: routes guardian và remote parent.

---

## 4. Baseline Heart-Print 3 lần sáng sớm

**Hiển thị ở đâu:** `index.html` dòng 116-122, 130-131.

**Mục đích:** Baseline là "dấu vân tay tim" cá nhân. Thay vì chỉ so với ngưỡng chung, app lưu 3 lần đo buổi sáng 5-7h để biết nhịp tim/HRV bình thường của riêng người dùng, từ đó phát hiện lệch bất thường chính xác hơn.

**Cách hoạt động:** Sau khi đo có kết quả, nút `recordBaselineBtn` gọi `recordBaseline()`. Backend `handleRecordBaseline()` kiểm tra session, lấy measurement mới nhất, lưu vào baseline. Dashboard trả về baseline để `renderBaseline()` hiển thị số lần đã lưu và trạng thái đủ/chưa đủ.

**Code liên quan:**

- `index.html` dòng 116-122: `#baselineCountBadge`, `#recordBaselineBtn`, `#refreshDashboardBtn`.
- `index.html` dòng 130-131: `#baselineSummary`.
- `app.js` dòng 8648: `renderBaseline(baseline)`.
- `app.js` dòng 9028: `recordBaseline()`.
- `app.js` dòng 9434-9435: binding lưu baseline và tải dashboard.
- `server.js` dòng 3152: `handleRecordBaseline()`.
- `server.js` dòng 4125: route `POST /api/baseline`.

---

## 5. Camera, chọn mode đo và điều khiển flash

**Hiển thị ở đâu:** `index.html` dòng 137-203, 186-197.

**Mục đích:** Đây là khu vực đo chính. Người dùng bật camera, chọn camera, bật/tắt flash, chọn mode "Ngón trỏ", "Khuôn mặt" hoặc "Tập thở". App ưu tiên finger PPG trên điện thoại có flash và face rPPG trên webcam.

**Cách hoạt động:** `startCamera()` xin quyền `getUserMedia()`, chọn camera phù hợp, gắn stream vào `#cameraVideo`, khởi động preview loop. Với finger mode trên mobile, `findTorchCamera()` và `setTorch(true)` tìm camera hỗ trợ torch để bật flash. `setMeasurementMode(mode)` đổi UI, mô tả, hướng dẫn đặt tay/nhìn camera. `stopCamera()` dừng track và tắt flash.

**Code liên quan:**

- `index.html` dòng 145-146: `#cameraVideo`, `#cameraCanvas`.
- `index.html` dòng 186-191: `#cameraSelect`, `#startCameraBtn`, `#stopCameraBtn`, `#torchBtn`.
- `index.html` dòng 195-197: `button[data-mode]`.
- `index.html` dòng 200: `#modeDescription`.
- `app.js` dòng 6803: `loadCameraDevices()`.
- `app.js` dòng 6816: `setMeasurementMode(mode)`.
- `app.js` dòng 6843: `setTorch(enable)`.
- `app.js` dòng 6864: `updateTorchBtn()`.
- `app.js` dòng 6872: `toggleTorch()`.
- `app.js` dòng 6884: `findTorchCamera()`.
- `app.js` dòng 6912: `startCamera()`.
- `app.js` dòng 6958: `stopCamera()`.
- `app.js` dòng 9436-9439: binding camera, torch và bắt đầu đo.

---

## 6. Checklist trước khi đo và ngữ cảnh đo

**Hiển thị ở đâu:** `index.html` dòng 203-217.

**Mục đích:** Checklist hỏi người dùng đã nghỉ 5 phút, không uống cà phê, không vận động mạnh, nhập huyết áp tâm thu và ghi chú. Các dữ liệu này giúp app giải thích kết quả, tránh cảnh báo nhầm do cà phê/stress/vận động.

**Cách hoạt động:** Khi `runMeasurement()` gửi kết quả, payload có mode đo, systolic, context note, checklist và trạng thái cảm xúc. Backend `analyzeMeasurement()` dùng các dữ liệu này để tính `strokeRiskScore`, shock index, khuyến nghị, đồng thời `handleMeasurementContext()` có thể lưu lý do bất thường sau khi đo.

**Code liên quan:**

- `index.html` dòng 203-207: các checkbox checklist.
- `index.html` dòng 212-213: `#systolicInput`, `#measurementContextInput`.
- `app.js` dòng 7362: `runMeasurement()`.
- `app.js` dòng 9199: `saveAbnormalReason(reason)`.
- `server.js` dòng 1223: `generateRecommendations(classification, extras)`.
- `server.js` dòng 1305: `analyzeMeasurement({ user, type, payload })`.
- `server.js` dòng 3133: `handleMeasurementContext()`.
- `server.js` dòng 4124: route `POST /api/measurements/context`.

---

## 7. Đo Finger PPG qua ngón tay

**Hiển thị ở đâu:** `index.html` dòng 137-299, đặc biệt mode `data-mode="finger"` dòng 195 và nút đo dòng 232.

**Mục đích:** Finger PPG đo nhịp tim bằng biến thiên màu khi máu đi qua ngón tay được camera/flash chiếu sáng. Đây là mode chính để lấy tín hiệu mạnh, phù hợp điện thoại.

**Cách hoạt động:** `sampleFrame("finger")` lấy toàn khung hình, downscale để giảm chi phí xử lý, đọc trung bình RGB. `extractPbvFingerSignal()` kết hợp kênh R/G/B theo trọng số và SNR; nếu PBV tốt hơn kênh đơn thì dùng PBV. `analyzePPGSignal()` bỏ warmup, lọc Butterworth, tính BPM bằng nhiều phương pháp và kiểm tra chất lượng. `lockCameraExposure()` khóa exposure/white balance để tránh camera tự chỉnh sáng làm nhiễu sóng.

**Code liên quan:**

- `index.html` dòng 195: nút mode ngón trỏ.
- `index.html` dòng 232: `#startMeasureBtn`.
- `app.js` dòng 6978: `lockCameraExposure()`.
- `app.js` dòng 7039: `unlockCameraExposure()`.
- `app.js` dòng 7050: `sampleFrame(mode)`.
- `app.js` dòng 7122-7131: nhánh finger mode trong `sampleFrame()`.
- `app.js` dòng 1304: `extractPbvFingerSignal(samples, fps)`.
- `app.js` dòng 1781: `analyzePPGSignal(rawSamples, mode, fps)`.
- `app.js` dòng 7362: `runMeasurement()`.
- `ppg-worker.js` dòng 183: `workerAnalyzeBpm()` chạy phân tích BPM trong WebWorker.

---

## 8. Đo Face rPPG qua khuôn mặt

**Hiển thị ở đâu:** `index.html` dòng 137-299, mode `data-mode="face"` dòng 196.

**Mục đích:** Face rPPG đo nhịp tim không chạm bằng thay đổi màu da rất nhỏ trên trán/má/mũi/glabella. Đây là điểm mạnh khi dùng laptop/webcam hoặc khi không muốn đặt ngón tay lên camera.

**Cách hoạt động:** `snapFaceROI()` dùng MediaPipe FaceLandmarker để khóa vùng trán, má trái, má phải, mũi, glabella. `sampleFrame("face")` lấy RGB theo vùng và gán trọng số. `analyzePPGSignal()` chạy nhiều thuật toán: CHROM, POS, Region-Fused, Green Residual ICA, MTTS-CAN và model rPPG nếu có. Mỗi phương pháp được tính SNR rồi chọn kết quả có độ tin cậy cao hơn.

**Code liên quan:**

- `index.html` dòng 196: nút mode khuôn mặt.
- `app.js` dòng 431: `extractChromSignal(samples)`.
- `app.js` dòng 839: `extractPosSignal(samples)`.
- `app.js` dòng 868: `loadMttsModel()`.
- `app.js` dòng 919: `extractMttsSignal(frameBuffer, warmupFrames)`.
- `app.js` dòng 954: `extractFaceRegionFusedSignal(samples, fps)`.
- `app.js` dòng 985: `extractGreenResidualICA(samples)`.
- `app.js` dòng 1042: `loadRppgModel()`.
- `app.js` dòng 1156: `runRppgModelInference(frameBuffer, fps)`.
- `app.js` dòng 6459: `snapFaceROI()`.
- `app.js` dòng 7068-7103: nhánh face mode trong `sampleFrame()`.
- `app.js` dòng 1781: `analyzePPGSignal()`.

---

## 9. Bộ lọc tín hiệu PPG, BPM và HRV

**Hiển thị ở đâu:** `index.html` dòng 284-288, 312-334.

**Mục đích:** Sau khi đo, app hiển thị sóng PPG/rPPG, nhịp tim, HRV Score, SDNN, RMSSD. Đây là tầng phân tích lõi để chứng minh app không chỉ đọc camera mà có xử lý tín hiệu sinh học.

**Cách hoạt động:** Tín hiệu thô được detrend, lọc Butterworth bandpass để giữ dải nhịp tim. BPM được tính bằng FFT, autocorrelation, peak detection, multi-window, Kalman series. HRV được tính từ RR intervals: SDNN, RMSSD, pNN50, SD1/SD2, Sample Entropy, LF/HF. `renderMeasurementResult()` hiển thị kết quả, `renderWaveformWithPeaks()` vẽ sóng và đánh dấu peak.

**Code liên quan:**

- `index.html` dòng 284-288: `#waveChart`, `#wavePath`.
- `index.html` dòng 312-319: `#bpmResult`, `#hrvResult`, `#strokeRiskResult`, `#afibResult`.
- `index.html` dòng 329-334: `#sdnnResult`, `#rmssdResult`, `#hrvAdvancedBox`.
- `app.js` dòng 403: `butterworthBandpass(signal, fps)`.
- `app.js` dòng 736: `kalmanBpmSmooth(bpmSeries, ...)`.
- `app.js` dòng 756: `computeKalmanBpmSeries(filtered, fps, mode)`.
- `app.js` dòng 1397: `fftBpm(signal, fps)`.
- `app.js` dòng 1512: `autocorrBpm(signal, fps)`.
- `app.js` dòng 1582: `detectPeaksAdaptive(signal, fps, mode)`.
- `app.js` dòng 1762: `multiWindowBpm(filtered, fps, mode)`.
- `app.js` dòng 2547: `sampleEntropy(rrs)`.
- `app.js` dòng 2573: `poincarePlot(rrs)`.
- `app.js` dòng 2585: `computeLfHfRatio(rrs, fps)`.
- `app.js` dòng 7927: `renderHrvAdvanced(result)`.
- `app.js` dòng 8023: `renderWaveformWithPeaks(waveform, rrIntervals)`.
- `app.js` dòng 8059: `renderMeasurementResult(record)`.
- `ppg-worker.js` dòng 34: `butterworthBandpass()`.
- `ppg-worker.js` dòng 44: `fftBpm()`.
- `ppg-worker.js` dòng 71: `autocorrBpm()`.
- `ppg-worker.js` dòng 112: `detectPeaksAdaptive()`.
- `ppg-worker.js` dòng 144: `multiWindowBpm()`.
- `ppg-worker.js` dòng 170: `kalmanBpmSmooth()`.

---

## 10. Phát hiện rung nhĩ AFib và bằng chứng nhịp không đều

**Hiển thị ở đâu:** `index.html` dòng 306, 317, 341-349, 980-988.

**Mục đích:** Tính năng chính của HeartSense là phát hiện rung nhĩ và loạn nhịp. App không kết luận chỉ bằng BPM, mà dùng RR irregularity, entropy, DFA, Poincare, Wiesel IRR, Lorenz sector, temporal consistency và các điểm loại trừ PAC/PVC.

**Cách hoạt động:** `analyzePPGSignal()` lấy RR intervals từ peak, tính các metric bất thường. `checkAfibQualityGate()` đảm bảo tín hiệu đủ chất lượng trước khi cho phép cảnh báo. `detectEctopicPattern()` phát hiện ngoại tâm thu kiểu "nhịp ngắn rồi nhịp bù dài" để giảm false positive. Sau khi backend nhận measurement, `analyzeMeasurement()` phân loại kết quả cuối cùng, có thể kích hoạt xác nhận AFib hoặc SOS.

**Code liên quan:**

- `index.html` dòng 306: `#afibConfirmBox`.
- `index.html` dòng 317: `#afibResult`.
- `index.html` dòng 341-349: khuyến nghị và lý do bất thường.
- `index.html` dòng 980-988: `#rhythmClassBox`, `#rsaIndexBox`.
- `app.js` dòng 490: `checkTemporalConsistency(rrs)`.
- `app.js` dòng 527: `dfaAlpha1(rrs)`.
- `app.js` dòng 570: `permutationEntropy(rrs)`.
- `app.js` dòng 594: `lorenzSectorAnalysis(rrs)`.
- `app.js` dòng 637: `waldWolkowitzZ(rrs)`.
- `app.js` dòng 661: `wieselIrr(rrs)`.
- `app.js` dòng 695: `detectEctopicPattern(rrs)`.
- `app.js` dòng 809: `checkAfibQualityGate(...)`.
- `app.js` dòng 4068: `classifyRhythmType(rrs)`.
- `app.js` dòng 7747: `startAfibConfirmation(measurement)`.
- `app.js` dòng 8333: `renderRhythmClassification(result)`.
- `app.js` dòng 8349: `renderRSAIndex(rsa)`.
- `server.js` dòng 1305: `analyzeMeasurement()`.
- `server.js` dòng 1471: `logAfibEpisode()`.

---

## 11. Chất lượng tín hiệu, live BPM, live quality và cảnh báo đo lại

**Hiển thị ở đâu:** `index.html` dòng 161-178, 217, 324, 1056-1058.

**Mục đích:** Người dùng cần biết lần đo có đáng tin hay không. App hiển thị độ sáng, độ ổn định, chất lượng, live BPM, thanh chất lượng và lịch sử chất lượng đo.

**Cách hoạt động:** Trong preview loop, `derivePreviewMetrics()` tính độ sáng/chuyển động và `renderPreviewMetrics()` đẩy lên UI. Trong lúc đo, `quickLiveBpm()` cho BPM gần thời gian thực, `liveQualityBar` đổi màu theo chất lượng. Sau khi phân tích, `renderMeasurementResult()` thêm quality gate, warning nhiễu, cảnh báo FPS, hướng dẫn đo lại. `renderMeasurementQualityHistory()` tổng hợp chất lượng các lần đo cũ.

**Code liên quan:**

- `index.html` dòng 161-178: `#liveBpmDisplay`, `#liveQualityBar`, `#lightMetric`, `#stabilityMetric`, `#qualityMetric`.
- `index.html` dòng 217: `#ambientLightHint`.
- `index.html` dòng 324: `#crossValidateBox`.
- `index.html` dòng 1056-1058: `#qualityHistoryBox`.
- `app.js` dòng 7222: `derivePreviewMetrics(sample)`.
- `app.js` dòng 7229: `renderPreviewMetrics(m)`.
- `app.js` dòng 7236: `startPreviewLoop()`.
- `app.js` dòng 7264: `quickLiveBpm(samples, fps)`.
- `app.js` dòng 7314: `extractRespiratoryRate(signal, fps)`.
- `app.js` dòng 7340: `detectAmbientLight(samples)`.
- `app.js` dòng 7353: `crossValidateResults(faceResult, fingerResult)`.
- `app.js` dòng 8059: `renderMeasurementResult(record)`.
- `app.js` dòng 5405: `getSignalQualityGuidance(...)`.
- `app.js` dòng 6312: `renderMeasurementQualityHistory(measurements)`.

---

## 12. Đo 60/90 giây, đo 2 tay và hướng dẫn đặt tay

**Hiển thị ở đâu:** `index.html` dòng 225-241, 264.

**Mục đích:** Cho phép người dùng đổi thời lượng đo 60/90 giây, chọn tay trái/phải và nhận nhắc đo tay còn lại. Với PPG, đo hai tay giúp so sánh tuần hoàn ngoại biên và giảm sai lệch do đặt tay.

**Cách hoạt động:** Nút `measureDuration90Toggle` đổi `state.measurementDuration` giữa 60 và 90 giây. `handToggleBtn` gọi `toggleMeasurementHand()`. Sau khi đo, `scheduleHandReminder()` nhắc đo tay còn lại nếu cần. Hướng dẫn UI trong `captureGuide` đổi theo mode đo.

**Code liên quan:**

- `index.html` dòng 225-232: `#measureDuration90Toggle`, `#startMeasureBtn`.
- `index.html` dòng 239-241: `#handToggleBtn`.
- `index.html` dòng 264: `#captureGuide`.
- `app.js` dòng 8581: `scheduleHandReminder(measuredHand)`.
- `app.js` dòng 8607: `toggleMeasurementHand()`.
- `app.js` dòng 9462-9469: binding đổi thời lượng đo.
- `app.js` dòng 9473: binding đổi tay.

---

## 13. Emotional Artifact Filter và AI nhận diện cảm xúc

**Hiển thị ở đâu:** `index.html` dòng 249-259, 1200.

**Mục đích:** Cảm xúc như stress, đau, mệt có thể làm nhịp tim tăng tạm thời. Tính năng này ghi nhận trạng thái trước khi đo để backend/frontend giải thích kết quả và giảm cảnh báo nhầm.

**Cách hoạt động:** Người dùng chọn emoji hoặc bấm AI Nhận diện. `initMediaPipeFaceExpression()` nạp MediaPipe FaceLandmarker, `autoDetectMoodFromCamera()` đọc blendshapes khuôn mặt, `_mpMapToMood()` map sang great/ok/tired/stressed/pain, `setPreMoodState()` lưu vào biến `_preMoodState`. Sau đo, `getEmotionalArtifactNote()` tạo ghi chú nếu nghi ngờ chỉ số bị ảnh hưởng bởi cảm xúc.

**Code liên quan:**

- `index.html` dòng 249: `#autoDetectMoodBtn`.
- `index.html` dòng 252-256: `.mood-btn[data-mood]`.
- `index.html` dòng 258-259: `#mpMoodStatus`, `#moodHint`.
- `index.html` dòng 1200: `#emotionalArtifactNote`.
- `app.js` dòng 6354: `initMediaPipeFaceExpression()`.
- `app.js` dòng 6388: `_mpGetBlendshape(categories, name)`.
- `app.js` dòng 6392: `_mpMapToMood(categories)`.
- `app.js` dòng 6410: `autoDetectMoodFromCamera()`.
- `app.js` dòng 6533: `setPreMoodState(btn, mood)`.
- `app.js` dòng 6541: `getEmotionalArtifactNote(afibLikelihood, bpm)`.

---

## 14. Breathing Coach 4-4-6

**Hiển thị ở đâu:** `index.html` dòng 197, 232-233, 273-281.

**Mục đích:** Breathing Coach hướng dẫn thở 4 giây hít vào, 4 giây giữ, 6 giây thở ra để giảm stress và hỗ trợ ổn định nhịp tim trước/sau đo.

**Cách hoạt động:** Khi người dùng chọn mode breathing hoặc bấm "Tập thở 4-4-6", `startBreathingCoach()` chạy vòng thời gian, đổi `breathingPhase`, trạng thái và animation vòng tròn. Nếu đăng nhập, kết quả bài tập thở được gửi lên backend qua `handleCreateBreathing()`.

**Code liên quan:**

- `index.html` dòng 197: mode breathing.
- `index.html` dòng 233: `#startBreathingBtn`.
- `index.html` dòng 273-281: `#breathingStatus`, `#breathingCircle`, `#breathingPhase`.
- `app.js` dòng 9221: `startBreathingCoach()`.
- `app.js` dòng 9440: binding nút breathing.
- `server.js` dòng 3201: `handleCreateBreathing()`.
- `server.js` dòng 4126: route `POST /api/breathing`.

---

## 15. Kết quả tức thì, khuyến nghị và lý do bất thường

**Hiển thị ở đâu:** `index.html` dòng 299-349.

**Mục đích:** Sau khi đo, app trả về nhịp tim, HRV score, stroke risk, AFib index, nhịp thở, headline, mô tả, khuyến nghị và prompt hỏi nguyên nhân nếu kết quả bất thường.

**Cách hoạt động:** `runMeasurement()` phân tích local trước, sau đó gửi measurement lên backend nếu đã đăng nhập. Backend `handleCreateMeasurement()` gọi `analyzeMeasurement()`, lưu record, trả dashboard mới. Frontend dùng `renderMeasurementResult()`, `renderRecommendationBox()`, `renderHrvAdvanced()`, `renderShockIndex()` để cập nhật UI. Nếu không đăng nhập, `renderGuestResult()` vẫn hiển thị phân tích local nhưng không có lưu lịch sử/server risk.

**Code liên quan:**

- `index.html` dòng 299-349: result card, recommendation và abnormal prompt.
- `app.js` dòng 7362: `runMeasurement()`.
- `app.js` dòng 7840: `renderGuestResult(localResult)`.
- `app.js` dòng 7852: `renderRecommendationBox(recs)`.
- `app.js` dòng 8059: `renderMeasurementResult(record)`.
- `server.js` dòng 1223: `generateRecommendations(classification, extras)`.
- `server.js` dòng 1305: `analyzeMeasurement()`.
- `server.js` dòng 3072: `handleCreateMeasurement()`.
- `server.js` dòng 4123: route `POST /api/measurements`.

---

## 16. Stroke Risk Score

**Hiển thị ở đâu:** `index.html` dòng 316, 487-488, 572-611.

**Mục đích:** Stroke Risk là điểm nguy cơ đột quỵ tổng hợp 0-100, dựa trên tuổi, bệnh nền, huyết áp, nhịp tim, HRV, AFib, baseline cá nhân và chất lượng đo.

**Cách hoạt động:** Backend `analyzeMeasurement()` tính điểm mỗi lần đo. Dashboard sau đó gom lịch sử bằng `buildDashboard()`, dự báo 72h bằng `predictStroke72h()`, tính IRS/PRP bằng `computeIRS()` và `buildPRP()`. Frontend hiển thị ở result card, stroke predictor box và bản đồ sinh tồn.

**Code liên quan:**

- `index.html` dòng 316: `#strokeRiskResult`.
- `index.html` dòng 487-488: `#strokePredictorBox`.
- `index.html` dòng 572-611: `#irsBox`, `#prpComparisonBox`, `#prpAnomalyBox`, `#prpBehaviorBox`, `#prpHistoryBox`.
- `app.js` dòng 7893: `renderStrokePredictor(sp)`.
- `app.js` dòng 10573: `renderPRP(prp)`.
- `server.js` dòng 975: `computeIRS(user, measurements, afibBurden7d)`.
- `server.js` dòng 1014: `buildPRP(...)`.
- `server.js` dòng 1106: `predictStroke72h(user, measurements)`.
- `server.js` dòng 1305: `analyzeMeasurement()`.
- `server.js` dòng 2010: `buildDashboard(userId, opts)`.

---

## 17. Bioshield dự báo nguy cơ 24h

**Hiển thị ở đâu:** `index.html` dòng 358-361, 1016-1022.

**Mục đích:** Bioshield dự báo khung giờ nguy cơ trong 24h bằng cách kết hợp HRV, AFib burden, thời tiết, nhịp sinh học và kết quả hiện tại.

**Cách hoạt động:** Frontend dùng `computeBioshieldForecast()` để lấy các tín hiệu đo mới nhất, tính risk score, peak risk hour và lời khuyên. `computeAfibHourlyForecast()` dựng bản đồ nguy cơ theo từng giờ. `renderBioshieldStatus()` và `renderAfibHourlyForecast()` hiển thị kết quả.

**Code liên quan:**

- `index.html` dòng 358-361: `#bioshieldBox`.
- `index.html` dòng 1016-1022: `#afibForecastBox`, `#afibHourlyBox`.
- `app.js` dòng 4596: `computeAfibForecast(measurements, weatherTemp)`.
- `app.js` dòng 4646: `computePeakRiskHour(currentHour)`.
- `app.js` dòng 4668: `computeBioshieldForecast(measurements, currentResult, weatherTemp)`.
- `app.js` dòng 8365: `renderBioshieldStatus(forecast)`.
- `app.js` dòng 9612: `computeAfibHourlyForecast(...)`.
- `app.js` dòng 9639: `renderAfibHourlyForecast(forecast)`.

---

## 18. CCI, hình thái sóng mạch, huyết áp ước tính và xu hướng CCI

**Hiển thị ở đâu:** `index.html` dòng 370-407.

**Mục đích:** Nhóm này phân tích sâu từ waveform PPG: chỉ số dẫn truyền tim CCI, gợi ý block nhánh, độ cứng động mạch, PAV, huyết áp tâm thu ước tính và xu hướng CCI 6 tháng.

**Cách hoạt động:** `analyzePPGMorphology()` cắt từng chu kỳ sóng mạch, tính biên độ, thời gian lên đỉnh, diện tích sóng. `computeArterialStiffnessIndex()`, `computePAV()`, `computeHemodynamicCapacitance()` tạo đặc trưng mạch máu. `detectBundleBranchHint()` suy luận gợi ý hình thái bất thường. `computeSystolicBPEstimate()` ước tính huyết áp từ BPM, HRV, tuổi và dữ liệu người dùng.

**Code liên quan:**

- `index.html` dòng 370-407: `#cciBox`, `#bundleBranchBox`, `#bpEstimateBox`, `#cciTrendBox`.
- `app.js` dòng 4291: `analyzePPGMorphology(filtered, peaks, fps)`.
- `app.js` dòng 4376: `computeArterialStiffnessIndex(morphology, age)`.
- `app.js` dòng 4399: `computePAV(filtered, peaks)`.
- `app.js` dòng 4418: `computeHemodynamicCapacitance(filtered, peaks, fps)`.
- `app.js` dòng 4450: `detectBundleBranchHint(filtered, peaks, fps)`.
- `app.js` dòng 4492: `computeBilateralCCI(rightMeasurement, leftMeasurement)`.
- `app.js` dòng 4521: `computeSystolicBPEstimate(result, user)`.
- `app.js` dòng 4568: `renderSystolicBPPanel(bpEst)`.
- `app.js` dòng 8407: `renderCCIPanel(result, measurements)`.
- `app.js` dòng 8467: `renderBundleBranchPanel(bbHint)`.
- `app.js` dòng 8490: `renderCCITrendChart(measurements)`.

---

## 19. Clot-Risk và phục hồi mạch máu sáng sớm

**Hiển thị ở đâu:** `index.html` dòng 417-429.

**Mục đích:** Clot-Risk ước tính nguy cơ huyết khối khi AFib/HRV xấu kéo dài. Vascular Recovery đánh giá phục hồi mạch máu buổi sáng, giúp phát hiện ngày cơ thể hồi phục kém.

**Cách hoạt động:** Backend `computeClotRiskScore()` dùng waveform, BPM, irregularityIndex, CV, SDNN, RMSSD, pNN50, tuổi và bệnh nền để tính điểm. `computeVascularRecovery()` phân tích waveform, HRV, BPM, huyết áp tâm thu để đánh giá phục hồi. Frontend render bằng `renderClotRisk()` và `renderVascularRecovery()`.

**Code liên quan:**

- `index.html` dòng 417-429: `#clotRiskBox`, `#vascularRecoveryBox`.
- `app.js` dòng 9811: `renderClotRisk(cr)`.
- `app.js` dòng 9848: `renderVascularRecovery(vr)`.
- `server.js` dòng 856: `computeClotRiskScore(...)`.
- `server.js` dòng 926: `computeVascularRecovery(...)`.
- `server.js` dòng 2010: `buildDashboard()`.

---

## 20. Pocket Cardiologist - bác sĩ ảo trong túi

**Hiển thị ở đâu:** `index.html` dòng 438-441.

**Mục đích:** Đây là box hỏi đáp y tế dựa trên kết quả đo gần nhất và hồ sơ người dùng. Nó giúp người dùng hiểu "vì sao kết quả này đáng chú ý" bằng ngôn ngữ dễ hiểu.

**Cách hoạt động:** Frontend `renderPocketCardiologist()` dựng panel hỏi đáp. Khi người dùng hỏi, `askPocketCardiologist()` gửi câu hỏi, kết quả đo và hồ sơ lên `/api/pocket-cardiologist`. Backend `handlePocketCardiologist()` ưu tiên AI provider nếu có, nếu không fallback rule-based theo ngữ cảnh.

**Code liên quan:**

- `index.html` dòng 438-441: `#pocketCardiologistBox`.
- `app.js` dòng 10163: `_pcContextualAnswer(q, r, u)`.
- `app.js` dòng 10193: `getPocketCardiologistConsultation(result, user)`.
- `app.js` dòng 10298: `_updateMicBtn()`.
- `app.js` dòng 10313: `pcToggleMic()`.
- `app.js` dòng 10348: `renderPocketCardiologist(result, user)`.
- `app.js` dòng 10439: `_pcRuleBasedAnswer(q, r, u)`.
- `app.js` dòng 10468: `askPocketCardiologist(question, evt)`.
- `server.js` dòng 2625: `handlePocketCardiologist(urlObject, body, res)`.
- `server.js` dòng 4131: route `POST /api/pocket-cardiologist`.

---

## 21. Shock Index và Thermal Strain

**Hiển thị ở đâu:** `index.html` dòng 449-454.

**Mục đích:** Shock Index = nhịp tim / huyết áp tâm thu, giúp cảnh báo tình huống huyết động xấu. Thermal Strain kết hợp nhiệt độ môi trường và nhịp tim để cảnh báo stress nhiệt/sốc nhiệt.

**Cách hoạt động:** Backend `evaluateShockIndex()` tính SI theo BPM và systolic. `calculateThermalStrain()` lấy nhiệt độ thời tiết, BPM, baseline BPM để đánh giá nguy cơ. Frontend `renderShockIndex()` và `renderThermalStrain()` hiển thị. Nếu thermal strain nguy hiểm, frontend có thể gọi `startSosCountdown()`.

**Code liên quan:**

- `index.html` dòng 449-454: `#shockIndexBox`, `#thermalStrainBox`.
- `app.js` dòng 7870: `renderShockIndex(si)`.
- `app.js` dòng 7903: `renderThermalStrain(ts)`.
- `server.js` dòng 837: `calculateThermalStrain(temp, bpm, baselineBpm)`.
- `server.js` dòng 1163: `evaluateShockIndex(bpm, systolic)`.
- `server.js` dòng 1305: `analyzeMeasurement()`.

---

## 22. SOS, hành lang xanh, gọi 115 và gọi người thân

**Hiển thị ở đâu:** `index.html` dòng 461-475.

**Mục đích:** Khi phát hiện AFib mạnh, shock index cao, té ngã hoặc người dùng bấm thủ công, app có cơ chế đếm ngược SOS, cho phép hủy nếu ổn, gọi 115 hoặc gọi người thân.

**Cách hoạt động:** `startSosCountdown()` đếm 15 giây và phát âm báo. Nếu không hủy, `triggerSos()` gửi `/api/sos/trigger`. Backend `handleTriggerSos()` lưu sự kiện, gửi email người giám hộ. `cancelSos()` gọi `/api/sos/cancel`, còn `handleEmergencyCall()` mở số 115. `renderSosState()` và `renderSosHistory()` hiển thị trạng thái/lịch sử.

**Code liên quan:**

- `index.html` dòng 461-472: `#sosBadge`, `#sosBox`, `#cancelSosBtn`, `#triggerSosBtn`, `#callEmergencyBtn`, `#guardianCallBtn`.
- `app.js` dòng 328: `ensureAudioContext()`.
- `app.js` dòng 333: `playAlarmTone()`.
- `app.js` dòng 8730: `renderSosHistory(events)`.
- `app.js` dòng 8742: `renderSosBox(headline, lines)`.
- `app.js` dòng 8746: `renderSosState(events)`.
- `app.js` dòng 9124: `resetSosUi()`.
- `app.js` dòng 9126: `startSosCountdown(reason)`.
- `app.js` dòng 9139: `triggerSos(reason)`.
- `app.js` dòng 9188: `cancelSos()`.
- `app.js` dòng 9412: `handleEmergencyCall()`.
- `server.js` dòng 3279: `handleTriggerSos()`.
- `server.js` dòng 3376: `handleCancelSos()`.
- `server.js` dòng 4129-4130: routes SOS.

---

## 23. AI y khoa chủ động: Stroke Predictor, AFib Burden, bệnh án AFib

**Hiển thị ở đâu:** `index.html` dòng 480-498.

**Mục đích:** Nhóm này dùng lịch sử đo để chuyển app từ "đo một lần" thành "theo dõi bệnh mạn tính": dự báo đột quỵ 72h, tính gánh nặng AFib theo tuần/tháng và ghi bệnh án từng cơn rung nhĩ.

**Cách hoạt động:** Backend `calculateAfibBurden()` tính tỷ lệ thời gian/phiên đo có AFib. `predictStroke72h()` dùng đo gần đây, triệu chứng, HRV, BPM, bệnh nền để dự báo. `logAfibEpisode()` lưu cơn AFib; `buildAfibDiseaseSummary()` tổng hợp tần suất, thời điểm, BPM. Frontend render bằng `renderStrokePredictor()`, `renderAfibBurden()`, `renderAfibDiseaseLog()`.

**Code liên quan:**

- `index.html` dòng 487-498: `#strokePredictorBox`, `#afibBurdenBox`, `#afibDiseaseLog`.
- `app.js` dòng 7881: `renderAfibBurden(b7, b30)`.
- `app.js` dòng 7893: `renderStrokePredictor(sp)`.
- `app.js` dòng 7913: `renderAfibDiseaseLog(afibDisease)`.
- `server.js` dòng 1081: `calculateAfibBurden(userId, days)`.
- `server.js` dòng 1106: `predictStroke72h(user, measurements)`.
- `server.js` dòng 1471: `logAfibEpisode(...)`.
- `server.js` dòng 1523: `buildAfibDiseaseSummary(userId)`.

---

## 24. CHA2DS2-VASc, HAS-BLED, BP Trend, Circadian, Poincare, SampEn, Population Benchmark

**Hiển thị ở đâu:** `index.html` dòng 505-533.

**Mục đích:** Đây là cụm chỉ số lâm sàng và thống kê nâng cao: điểm nguy cơ đột quỵ/chảy máu, xu hướng huyết áp, nhịp sinh học theo giờ, phân tích Poincare SD1/SD2, Sample Entropy/LF-HF và so sánh với dân số.

**Cách hoạt động:** Backend tính CHA2DS2-VASc và HAS-BLED từ hồ sơ bệnh nền. `buildBpTrend()` lấy systolic qua lịch sử. `buildCircadianPattern()` gom measurement theo giờ trong ngày. Frontend tính/hiển thị Poincare, SampEn, population benchmark dựa trên kết quả và thống kê dân số từ `/api/population-stats`.

**Code liên quan:**

- `index.html` dòng 505-533: `#cha2ds2Box`, `#bpTrendBox`, `#circadianBox`, `#poincareBox`, `#sampEnBox`, `#populationBenchmarkBox`.
- `app.js` dòng 7947: `renderCha2ds2(cha2ds2, hasbled)`.
- `app.js` dòng 7960: `renderBpTrend(bpTrend)`.
- `app.js` dòng 7974: `renderCircadian(circadian)`.
- `app.js` dòng 7998: `renderPoincare(result)`.
- `app.js` dòng 8011: `renderSampEn(result)`.
- `app.js` dòng 9560: `renderPopulationBenchmark(measurements, userAge)`.
- `server.js` dòng 1570: `calculateCha2ds2Vasc(user)`.
- `server.js` dòng 1593: `calculateHasbled(user)`.
- `server.js` dòng 1607: `buildCircadianPattern(userId, allMeasurements)`.
- `server.js` dòng 1626: `buildBpTrend(userId, allMeasurements)`.
- `server.js` dòng 4057: `handlePopulationStats(res)`.
- `server.js` dòng 4187: route `GET /api/population-stats`.

---

## 25. Tuổi tim sinh học và liều vận động an toàn hôm nay

**Hiển thị ở đâu:** `index.html` dòng 539-564.

**Mục đích:** Tuổi tim sinh học giúp diễn giải sức khỏe tim thành một con số dễ hiểu. Liều vận động an toàn đưa ra khuyến nghị hôm nay nên nghỉ, đi bộ nhẹ hay tập vừa dựa trên kết quả hiện tại.

**Cách hoạt động:** Backend `computeHeartBiologicalAge()` kết hợp tuổi thật, HRV, BPM, AFib burden và kết quả gần nhất. `computeSafeExerciseDose()` xét thời tiết, AFib burden, HRV, BPM và bệnh nền để đề xuất mức vận động. Frontend render bằng `renderHeartBiologicalAge()` và `renderSafeExerciseDose()`.

**Code liên quan:**

- `index.html` dòng 550-564: `#heartBioAgeBox`, `#safeExerciseBox`.
- `app.js` dòng 10707: `renderHeartBiologicalAge(hba)`.
- `app.js` dòng 10791: `renderSafeExerciseDose(dose)`.
- `server.js` dòng 1837: `computeHeartBiologicalAge(user, measurements, afibBurden7d, latestResult)`.
- `server.js` dòng 1917: `computeSafeExerciseDose(user, latestResult, weatherAlert, afibBurden7d)`.

---

## 26. Bản đồ sinh tồn, IRS và PRP

**Hiển thị ở đâu:** `index.html` dòng 572-611.

**Mục đích:** IRS là điểm rủi ro cá nhân tổng hợp, còn PRP là bản đồ so sánh 4 chiều: cùng tuổi, cùng bệnh nền, cùng khu vực và chính người dùng hôm qua. Nó biến dữ liệu rời rạc thành câu chuyện theo dõi dài hạn.

**Cách hoạt động:** `computeIRS()` tạo điểm rủi ro từ hồ sơ, lịch sử đo và AFib burden. `buildPRP()` tạo comparison/anomaly/behavior/history. `renderPRP()` hiển thị điểm hiện tại, bất thường cá nhân, dự báo nếu thay đổi hành vi và xu hướng 7 ngày.

**Code liên quan:**

- `index.html` dòng 578-611: `#irsBadge`, `#irsBox`, `#prpComparisonBox`, `#prpAnomalyBox`, `#prpBehaviorBox`, `#prpHistoryBox`.
- `app.js` dòng 10573: `renderPRP(prp)`.
- `server.js` dòng 975: `computeIRS(user, measurements, afibBurden7d)`.
- `server.js` dòng 1014: `buildPRP(userId, irs, afibBurden7d, allMeasurements, weatherAlert)`.

---

## 27. Hiệu quả thuốc, tiến triển bệnh, HRR, hồ sơ khẩn cấp và phục hồi sau AFib

**Hiển thị ở đâu:** `index.html` dòng 616-656.

**Mục đích:** Nhóm lâm sàng này trả lời các câu hỏi ban giám khảo hay hỏi: thuốc có hiệu quả không, bệnh đang xấu lên hay tốt lên, tim phục hồi sau vận động thế nào, cấp cứu cần biết gì, sau cơn AFib nên làm gì.

**Cách hoạt động:** Backend `computeMedicationEffectiveness()` so trước/sau khi dùng thuốc. `computeDiseaseProgression()` đọc xu hướng 90 ngày và dự báo 6 tháng. HRR dùng `startHRRTest()` và `doHRRMeasure()` để đo phục hồi nhịp tim sau vận động, lưu qua `/api/hrr-result`. `renderEmergencyMedicalID()` tạo thông tin khẩn cấp. `renderPostEpisodeProtocol()` hiện hướng dẫn sau cơn AFib.

**Code liên quan:**

- `index.html` dòng 622-656: `#medEffectivenessBox`, `#diseaseProgressionBox`, `#hrrTestBox`, `#emergencyMedIDBox`, `#postEpisodePanel`, `#postEpisodeBox`.
- `app.js` dòng 10894: `renderMedicationEffectiveness(data)`.
- `app.js` dòng 10929: `renderDiseaseProgression(data)`.
- `app.js` dòng 10957: `startHRRTest()`.
- `app.js` dòng 10968: `doHRRMeasure()`.
- `app.js` dòng 11023: `renderHRRHistory(hrrResult)`.
- `app.js` dòng 11034: `renderEmergencyMedicalID(user)`.
- `app.js` dòng 11068: `renderPostEpisodeProtocol(result)`.
- `server.js` dòng 1639: `computeMedicationEffectiveness(user, measurements)`.
- `server.js` dòng 1665: `computeDiseaseProgression(...)`.
- `server.js` dòng 1701: `saveHRRResult(userId, body)`.
- `server.js` dòng 4133: route `POST /api/hrr-result`.

---

## 28. Nhắc thuốc thông minh và bản đồ bệnh viện tim mạch

**Hiển thị ở đâu:** `index.html` dòng 661-672.

**Mục đích:** Nhắc thuốc thông minh giải thích vì sao hôm nay không nên quên thuốc dựa trên rủi ro hiện tại. Bản đồ bệnh viện tim mạch giúp người dùng biết nơi cần đến khi khẩn cấp.

**Cách hoạt động:** `renderSmartMedReminder()` kết hợp exercise dose và hiệu quả thuốc để tạo nội dung nhắc theo ngữ cảnh. `renderCardiologyMap()` hiển thị danh sách bệnh viện/số điện thoại/link bản đồ dựa trên dữ liệu người dùng hoặc danh sách mặc định.

**Code liên quan:**

- `index.html` dòng 667-672: `#smartMedReminderBox`, `#cardiologyMapBox`.
- `app.js` dòng 11101: `renderSmartMedReminder(exerciseDose, medEffect)`.
- `app.js` dòng 11114: `renderCardiologyMap(hospitals, user)`.

---

## 29. Coherence, điện giải, lịch 30 ngày và phân tích theo mùa

**Hiển thị ở đâu:** `index.html` dòng 678-699.

**Mục đích:** Đây là phần phân tích sâu giúp giải thích nguy cơ tái phát AFib: cân bằng thần kinh tự chủ, nguy cơ thiếu điện giải, lịch rủi ro 30 ngày, mùa nào dễ xấu hơn.

**Cách hoạt động:** Backend `computeCoherenceScore()` dùng LF/HF và HRV để tạo điểm tim-não. `computeElectrolyteRisk()` ước tính nguy cơ thiếu K/Mg từ kết quả PPG. `buildMonthlyRiskCalendar()` dựng lịch 30 ngày; `computeSeasonalPattern()` nhóm lịch sử theo mùa. Frontend render bằng các hàm cùng tên.

**Code liên quan:**

- `index.html` dòng 684-699: `#coherenceScoreBox`, `#electrolyteRiskBox`, `#monthlyCalendarBox`, `#seasonalPatternBox`.
- `app.js` dòng 11139: `renderCoherenceScore(cs)`.
- `app.js` dòng 11159: `renderElectrolyteRisk(data)`.
- `app.js` dòng 11176: `renderMonthlyCalendar(calendar)`.
- `app.js` dòng 11203: `renderSeasonalPattern(data)`.
- `server.js` dòng 1712: `buildMonthlyRiskCalendar(userId, allMeasurements, circadian)`.
- `server.js` dòng 1732: `computeSeasonalPattern(userId, allMeasurements)`.
- `server.js` dòng 1749: `computeElectrolyteRisk(result)`.
- `server.js` dòng 1769: `computeCoherenceScore(result)`.

---

## 30. Chuẩn bị tái khám, dashboard gia đình và link chia sẻ

**Hiển thị ở đâu:** `index.html` dòng 705-721.

**Mục đích:** Phần này biến dữ liệu app thành tài liệu giao tiếp: người dùng biết hỏi bác sĩ gì, gia đình xem bản tóm tắt nào và có link chia sẻ nhanh.

**Cách hoạt động:** Backend `buildDoctorVisitPrep()` tạo checklist tái khám từ dashboard. Nút tạo link gia đình gọi `generateFamilyLink()`, backend `generateFamilyToken()` sinh token. Frontend `renderDoctorVisitPrep()` và `renderFamilyDashboard()` hiển thị.

**Code liên quan:**

- `index.html` dòng 711-721: `#doctorVisitPrepBox`, `#familyDashboardBox`, `#familyLinkResult`.
- `app.js` dòng 11231: `renderDoctorVisitPrep(data)`.
- `app.js` dòng 11256: `renderFamilyDashboard(familyToken)`.
- `app.js` dòng 11272: `generateFamilyLink()`.
- `server.js` dòng 1796: `buildDoctorVisitPrep(user, dashboard)`.
- `server.js` dòng 1825: `generateFamilyToken(userId)`.
- `server.js` dòng 4142: route `POST /api/family-token`.

---

## 31. Doctor Mode Export, PDF/QR, Post-Ablation Monitor, Telehealth Clean Data

**Hiển thị ở đâu:** `index.html` dòng 728-754.

**Mục đích:** Doctor Mode Export tạo hồ sơ chuẩn y khoa để đưa bác sĩ: kết quả gần nhất, ECG giả lập, AFib burden, thuốc, triệu chứng, QR/link chia sẻ. Post-ablation monitor theo dõi tái phát sau cắt đốt. Telehealth Clean Data giúp lọc dữ liệu nhiễu khi khám từ xa.

**Cách hoạt động:** `generateDoctorExport()` gọi `/api/export-token` hoặc `/api/users/:id/doctor-export`. Backend dùng `buildDoctorExportHtml()` dựng HTML y khoa và `buildPrintableReport()` dựng report in được. `computeAblationRisk()` tính nguy cơ tái phát dựa trên tuổi, BMI, loại AFib, LAVI, thời gian bệnh, triệu chứng.

**Code liên quan:**

- `index.html` dòng 734-740: `#doctorExportBtn`, `#reportLink2`, `#doctorExportBox`.
- `index.html` dòng 744-754: Post-Ablation và Clean Data.
- `app.js` dòng 5844: `computeAblationRisk(inputs)`.
- `app.js` dòng 9246: `getExportUrl()`.
- `app.js` dòng 9253: `generateDoctorExport()`.
- `app.js` dòng 9273: `openDoctorExportPdf()`.
- `app.js` dòng 9453-9454: binding export.
- `server.js` dòng 2107: `generateExportToken(userId)`.
- `server.js` dòng 2117: `buildEcgSvg(waveform)`.
- `server.js` dòng 2138: `buildDoctorExportHtml(dashboard, exportToken)`.
- `server.js` dòng 2619: `buildPrintableReport(dashboard)`.
- `server.js` dòng 3409: `handleDoctorExport()`.
- `server.js` dòng 3430: `handleGenerateExportToken()`.
- `server.js` dòng 4183, 4197: export routes.

---

## 32. Nhật ký triệu chứng

**Hiển thị ở đâu:** `index.html` dòng 766-790.

**Mục đích:** Người dùng ghi triệu chứng, mức độ, thời điểm để liên kết với nhịp tim/AFib. Đây là dữ liệu quan trọng cho bác sĩ vì AFib có thể không triệu chứng hoặc triệu chứng không trùng thời điểm đo.

**Cách hoạt động:** Form `symptomForm` gọi `saveSymptom()`, backend `handleSymptom()` lưu vào data store. Dashboard trả lại danh sách triệu chứng để `renderSymptoms()` hiển thị.

**Code liên quan:**

- `index.html` dòng 774-790: `#symptomForm`, `#symptomList`.
- `app.js` dòng 8670: `renderSymptoms(symptoms)`.
- `app.js` dòng 9037: `saveSymptom(event)`.
- `app.js` dòng 9444: binding form triệu chứng.
- `server.js` dòng 3217: `handleSymptom()`.
- `server.js` dòng 4127: route `POST /api/symptoms`.

---

## 33. Nhắc thuốc OCR + màu viên và danh sách lịch nhắc

**Hiển thị ở đâu:** `index.html` dòng 795-810.

**Mục đích:** Người dùng chụp nhãn thuốc, app hỗ trợ điền tên thuốc và tạo lịch nhắc có màu viên trực quan. Đây là tính năng chăm sóc dài hạn cho bệnh nhân tim mạch dùng nhiều thuốc.

**Cách hoạt động:** Khi chọn ảnh, `hydrateMedicineNameFromFile()` đọc tên thuốc từ ảnh hoặc fallback nhập tay. `saveReminder()` gửi lịch nhắc lên backend `handleReminder()`. Dashboard trả reminders để `renderReminders()` hiển thị.

**Code liên quan:**

- `index.html` dòng 795-810: `#reminderForm`, `#labelImageInput`, `#medicineNameInput`, `#ocrStatus`, `#reminderList`.
- `app.js` dòng 8681: `renderReminders(reminders)`.
- `app.js` dòng 9056: `hydrateMedicineNameFromFile()`.
- `app.js` dòng 9101: `saveReminder(event)`.
- `app.js` dòng 9445-9446: binding reminder và OCR file input.
- `server.js` dòng 3256: `handleReminder()`.
- `server.js` dòng 4128: route `POST /api/reminders`.

---

## 34. Báo cáo tuần và thời tiết

**Hiển thị ở đâu:** `index.html` dòng 815-817, 1026-1027.

**Mục đích:** Báo cáo tuần tóm tắt diễn biến gần đây. Thời tiết dùng để cảnh báo yếu tố môi trường ảnh hưởng tim mạch như lạnh, nóng, độ ẩm.

**Cách hoạt động:** Backend `buildWeeklyReport()` tổng hợp measurement theo tuần. `getWeatherAlert()` gọi Open-Meteo nếu có tọa độ, hoặc `pseudoWeather()` nếu không có. Frontend `renderWeeklyReport()`, `renderWeather()` và `renderWeatherAfibAlert()` hiển thị cảnh báo.

**Code liên quan:**

- `index.html` dòng 815-817: `#weeklyReportBox`, `#weatherBox`.
- `index.html` dòng 1026-1027: `#weatherAfibBox`.
- `app.js` dòng 8711: `renderWeeklyReport(report)`.
- `app.js` dòng 8720: `renderWeather(weather)`.
- `app.js` dòng 5450: `renderWeatherAfibAlert(weather, measurements)`.
- `server.js` dòng 720: `fetchOpenMeteoWeather(query)`.
- `server.js` dòng 794: `pseudoWeather(user)`.
- `server.js` dòng 811: `getWeatherAlert(user, coordsOverride)`.
- `server.js` dòng 1552: `buildWeeklyReport(userId, allMeasurements)`.

---

## 35. Smart Pill-in-the-Pocket và kiểm tra tương tác thuốc

**Hiển thị ở đâu:** `index.html` dòng 824-846.

**Mục đích:** Người dùng thiết lập phác đồ pill-in-the-pocket cho AFib, app chỉ nhắc khi phù hợp. Kiểm tra tương tác thuốc giúp phát hiện nguy cơ khi dùng nhiều thuốc tim mạch.

**Cách hoạt động:** `savePillProtocol()` lưu phác đồ lên backend. Khi đo phát hiện AFib phù hợp, backend trả `pillAlert`, frontend `renderPillAlert()` hiển thị thuốc/liều/hướng dẫn. Form tương tác thuốc gọi `checkInteractions()`, backend chuẩn hóa tên thuốc bằng RxNav (`resolveRxCUI()`, `fetchRxNavInteractions()`), kiểm tra local rule và có thể gọi Gemini qua `callGeminiDrugInteraction()`.

**Code liên quan:**

- `index.html` dòng 824-846: `#pillProtocolForm`, `#pillProtocolStatus`, `#interactionForm`, `#interactionResult`.
- `index.html` dòng 308: `#pillAlertBox`.
- `app.js` dòng 7812: `renderPillAlert(pillAlert)`.
- `app.js` dòng 8753: `renderPillProtocol(protocol, protocols)`.
- `app.js` dòng 8764: `deletePillProtocol(protocolId)`.
- `app.js` dòng 9287: `checkInteractions(event)`.
- `app.js` dòng 9367: `savePillProtocol(event)`.
- `server.js` dòng 1183: `normalizeDrugName(name)`.
- `server.js` dòng 1188: `checkDrugInteractions(drugs)`.
- `server.js` dòng 3460: `resolveRxCUI(drugName)`.
- `server.js` dòng 3480: `fetchRxNavInteractions(drugNames)`.
- `server.js` dòng 3515: `callGeminiDrugInteraction(drugs, localInteractions)`.
- `server.js` dòng 3566: `handleCheckInteractions()`.
- `server.js` dòng 3616: `handleSavePillProtocol()`.
- `server.js` dòng 4181-4182: routes thuốc.

---

## 36. Mẹo sức khỏe hôm nay, chế độ ông/bà và cảnh báo pin

**Hiển thị ở đâu:** `index.html` dòng 905-909.

**Mục đích:** Tăng tính dùng thực tế hằng ngày: chữ to cho người lớn tuổi, cảnh báo pin ban đêm và mẹo sức khỏe theo thời tiết/kết quả đo.

**Cách hoạt động:** `toggleElderlyMode()` bật class chữ lớn. `checkBatteryForNight()` dùng Battery API nếu trình duyệt hỗ trợ. `showDailyHealthTip()` tạo mẹo dựa trên weather và kết quả gần nhất, `_getWeatherTips()` sinh nội dung theo nhiệt độ/độ ẩm/mô tả thời tiết.

**Code liên quan:**

- `index.html` dòng 905-909: `#elderlyModeBtn`, `#batteryWarningBox`, `#dailyTipBox`.
- `app.js` dòng 5279: `toggleElderlyMode()`.
- `app.js` dòng 5289: `checkBatteryForNight()`.
- `app.js` dòng 5327: `_getWeatherTips(temp, humidity, desc)`.
- `app.js` dòng 5366: `showDailyHealthTip(weather, lastResult)`.
- `app.js` dòng 9472: binding elderly mode.

---

## 37. Skin Calibration và BPM calibration cá nhân

**Hiển thị ở đâu:** `index.html` dòng 916-969.

**Mục đích:** Da sáng/tối, BMI và sai số camera làm thay đổi biên độ PPG. Tính năng hiệu chỉnh giúp app công bằng hơn với nhiều màu da và thiết bị. BPM calibration cho phép nhập BPM tham chiếu từ máy đo ngoài để học sai số riêng theo mode finger/face.

**Cách hoạt động:** `snapFaceROI()` có bước suy ra skin tone từ tỷ lệ Red/Green ở trán. Form skin calibration gọi `saveCalibrationSettings()`, lưu vào localStorage. `applySkinToneCalibration()` điều chỉnh quality theo da/BMI. BPM calibration dùng `addCalibSession()`, `_computeCalibCoeffs()` để tính hệ số tuyến tính, `applyBpmCalibration()` áp vào BPM sau đo.

**Code liên quan:**

- `index.html` dòng 916-930: Skin Calibration form.
- `index.html` dòng 944-969: `#calibStatus_finger`, `#calibRefBpm_finger`, `#calibStatus_face`, `#calibRefBpm_face`.
- `app.js` dòng 6459: `snapFaceROI()`.
- `app.js` dòng 6576: `applySkinToneCalibration(signalQuality, mode)`.
- `app.js` dòng 6587: `saveCalibrationSettings(e)`.
- `app.js` dòng 6606: `initSkinCalibFromStorage()`.
- `app.js` dòng 6620: `loadCalibData()`.
- `app.js` dòng 6627: `addCalibSession(mode, appBpm, refBpm)`.
- `app.js` dòng 6637: `_computeCalibCoeffs(sessions)`.
- `app.js` dòng 6658: `applyBpmCalibration(bpm, mode)`.
- `app.js` dòng 6664: `getCalibStatus(mode)`.
- `app.js` dòng 6694: `resetCalibData(mode)`.
- `app.js` dòng 6701: `saveCalibFromLastMeasure(mode)`.

---

## 38. Phát hiện thay đổi nhịp tim đột ngột

**Hiển thị ở đâu:** `index.html` dòng 934-936.

**Mục đích:** Nếu BPM tăng/giảm bất thường so với các lần đo gần đây, app cảnh báo người dùng theo dõi lại thay vì chỉ nhìn vào một con số hiện tại.

**Cách hoạt động:** `detectSuddenHRChange(measurements)` đọc lịch sử measurement, so kết quả mới với baseline/gần đây để xác định tăng/giảm đột ngột. Kết quả được render trong dashboard/result flow.

**Code liên quan:**

- `index.html` dòng 934-936: `#suddenHRBox`.
- `app.js` dòng 6553: `detectSuddenHRChange(measurements)`.
- `app.js` dòng 8773: `renderDashboard(dashboard)`.

---

## 39. Digital Twin, Synthetic ECG, SpO2 ước tính và Heart-Print ID

**Hiển thị ở đâu:** `index.html` dòng 996-1008.

**Mục đích:** Digital Twin mô phỏng trái tim theo BPM/nhịp. Synthetic ECG dựng sóng ECG giả lập từ RR intervals để bác sĩ nhìn dạng nhịp. SpO2 ước tính dùng finger PPG như chỉ báo tham khảo, không thay máy SpO2 y tế. Heart-Print ID là fingerprint từ RR intervals.

**Cách hoạt động:** `renderDigitalTwin()` vẽ lên canvas theo nhịp hiện tại. `synthesizeECGWaveform()` tạo waveform ECG giả lập, `renderSyntheticECGDisplay()` hiển thị SVG. `estimateSpO2()` dùng quan hệ kênh màu từ finger sample. `computePPGFingerprint()` hash đặc trưng RR để tạo mã Heart-Print.

**Code liên quan:**

- `index.html` dòng 996-1008: `#digitalTwinCanvas`, `#heartPrintId`, `#syntheticECGBox`, `#spO2EstResult`.
- `app.js` dòng 4209: `synthesizeECGWaveform(rrIntervals, bpm, numBeats)`.
- `app.js` dòng 5165: `renderDigitalTwin(bpm, rhythmType, rrIntervals)`.
- `app.js` dòng 5247: `renderSyntheticECGDisplay(rrIntervals, bpm)`.
- `app.js` dòng 6331: `computePPGFingerprint(rrIntervals)`.
- `app.js` dòng 6747: `estimateSpO2(samples)`.
- `app.js` dòng 8263-8288: gọi render Digital Twin, ECG, Heart-Print, SpO2 sau khi đo.

---

## 40. AFib Trigger Map

**Hiển thị ở đâu:** `index.html` dòng 1035-1039.

**Mục đích:** Khi phát hiện AFib, app không chỉ nói "có nguy cơ" mà phân tích nguyên nhân có thể: thời tiết, caffeine, stress, mất ngủ, giờ sinh học, lịch sử gần đây.

**Cách hoạt động:** `computeAfibTriggerContext()` kết hợp measurement, weather và recentMeasurements. `renderAfibTriggerContext()` hiển thị trigger map. Nếu cần AI, `fetchAfibTriggerAi()` gọi backend `/api/afib-context` để tạo phân tích văn bản.

**Code liên quan:**

- `index.html` dòng 1035-1039: `#afibTriggerBox`.
- `app.js` dòng 9666: `computeAfibTriggerContext(measurement, weather, recentMeasurements)`.
- `app.js` dòng 9734: `renderAfibTriggerContext(ctx)`.
- `app.js` dòng 9766: `fetchAfibTriggerAi(record, weather)`.
- `server.js` dòng 3871: `handleAfibContext(urlObject, body, res)`.
- `server.js` dòng 4192: route `POST /api/afib-context`.

---

## 41. BCG chuột/chạm và vi rung ngón tay

**Hiển thị ở đâu:** `index.html` dòng 1046-1052.

**Mục đích:** BCG dùng vi rung khi người dùng di chuột/chạm màn hình để ước tính nhịp cơ học, là kênh phụ ngoài camera.

**Cách hoạt động:** `startMouseBCGTracking()` bắt `mousemove` hoặc `touchmove`, lưu tọa độ theo thời gian. `analyzeBCGMouse()` resample về lưới đều, lọc và tìm BPM từ dao động. `renderBCGResult()` hiển thị kết quả. Trên thiết bị cảm ứng, có nhánh `startTouchBCGResting()`.

**Code liên quan:**

- `index.html` dòng 1046-1052: `#startBCGBtn`, `#stopBCGBtn`, `#bcgResultBox`.
- `app.js` dòng 4779: `_bcgResample(events, fps)`.
- `app.js` dòng 4799: `_bcgCorrAtBpm(signal, fps, bpm)`.
- `app.js` dòng 4818: `startTouchBCGResting()`.
- `app.js` dòng 4873: `_analyzeBCGResting(events)`.
- `app.js` dòng 4938: `startMouseBCGTracking()`.
- `app.js` dòng 4980: `stopMouseBCGTracking()`.
- `app.js` dòng 5006: `analyzeBCGMouse(events)`.
- `app.js` dòng 5086: `renderBCGResult(result)`.
- `app.js` dòng 9482, 9500: binding BCG.

---

## 42. Khung giờ vàng đo tim và so sánh xu hướng 7 ngày

**Hiển thị ở đâu:** `index.html` dòng 1065-1072.

**Mục đích:** App gợi ý thời điểm đo ổn định nhất trong ngày và so sánh xu hướng 7 ngày để người dùng duy trì lịch đo chất lượng.

**Cách hoạt động:** `computeGoldenWindow()` phân tích lịch sử measurement theo giờ và chất lượng. `renderTrendComparison()` so các chỉ số gần đây với 7 ngày trước. Kết quả được render trong dashboard.

**Code liên quan:**

- `index.html` dòng 1065-1072: `#goldenWindowBox`, `#trendComparisonBox`.
- `app.js` dòng 5426: `computeGoldenWindow(measurements)`.
- `app.js` dòng 6199: `renderTrendComparison(measurements)`.
- `app.js` dòng 8773: `renderDashboard(dashboard)`.

---

## 43. Chế độ theo dõi chuyên sâu 7 ngày - giả lập Holter

**Hiển thị ở đâu:** `index.html` dòng 1080-1092.

**Mục đích:** Giả lập Holter giúp người dùng đo theo nhiều khung giờ cố định trong 7 ngày, tạo dữ liệu dày hơn cho bác sĩ mà không cần thiết bị chuyên dụng.

**Cách hoạt động:** `toggleExpertMode()` bật/tắt chế độ. `startHolterMode()` tạo log và lịch nhắc. `_getCurrentHolterWindow()`, `_checkHolterWindowPrompt()` kiểm tra có đang đến giờ đo không. `_logHolterMeasurement()` tự ghi kết quả đo vào log. `shareHolterReport()` tạo báo cáo chia sẻ qua Zalo/Gmail/copy link. Backend `handleExpertMode()` và `handleSaveHolterLog()` lưu trạng thái/log.

**Code liên quan:**

- `index.html` dòng 1080-1092: `#expertModeBtn`, `#shareReportBtn`, `#holterZaloBtn`, `#holterGmailBtn`, `#expertModeStatus`, `#holterNotifSetup`.
- `app.js` dòng 5503: `_holterDay()`.
- `app.js` dòng 5507: `_getCurrentHolterWindow()`.
- `app.js` dòng 5533: `_logHolterMeasurement(result)`.
- `app.js` dòng 5555: `_checkHolterWindowPrompt()`.
- `app.js` dòng 5603: `_scheduleHolterNotify()`.
- `app.js` dòng 5619: `renderHolterNotifSetup()`.
- `app.js` dòng 5699: `renderHolterDashboard()`.
- `app.js` dòng 5782: `restoreExpertMode()`.
- `app.js` dòng 5805: `toggleExpertMode()`.
- `app.js` dòng 5808: `startHolterMode()`.
- `app.js` dòng 5833: `stopHolterMode()`.
- `app.js` dòng 5947: `shareHolterReport(target)`.
- `server.js` dòng 3441: `handleSaveHolterLog()`.
- `server.js` dòng 3843: `handleExpertMode()`.
- `server.js` dòng 4184, 4190: Holter/expert routes.

---

## 44. OCR huyết áp từ ảnh

**Hiển thị ở đâu:** `index.html` dòng 1099-1111.

**Mục đích:** Người dùng chụp ảnh máy đo huyết áp, app đọc tâm thu/tâm trương hoặc cho nhập tay rồi lưu vào hệ thống để các tính toán stroke risk, shock index, BP trend chính xác hơn.

**Cách hoạt động:** Nút chụp ảnh kích hoạt `#bpPhotoInput`. `ocrBloodPressure(file)` đọc ảnh, trích chỉ số nếu được, điền vào input. `saveBpOcrReading()` lưu chỉ số lên backend bằng measurement/context phù hợp rồi render dashboard mới.

**Code liên quan:**

- `index.html` dòng 1099-1111: `#bpPhotoInput`, `#bpOCRStatus`, `#bpSysInput`, `#bpDiaInput`, `#saveBpOcrBtn`, `#bpOCRSaveStatus`.
- `app.js` dòng 6225: `ocrBloodPressure(file)`.
- `app.js` dòng 6273: `saveBpOcrReading()`.
- `app.js` dòng 9483-9490: binding OCR và nút lưu.

---

## 45. Dự báo tái phát sau cắt đốt Ablation

**Hiển thị ở đâu:** `index.html` dòng 1115-1139.

**Mục đích:** Người dùng sau ablation nhập tuổi, BMI, loại AFib, LAVI, thời gian mắc, triệu chứng để ước tính nguy cơ tái phát.

**Cách hoạt động:** Form `ablationRiskForm` được bind trong `bindEvents()`. Khi submit, frontend gọi `computeAblationRisk()` và hiển thị risk %, mức LOW/MEDIUM/HIGH cùng khuyến nghị vào `#ablationRiskResult`.

**Code liên quan:**

- `index.html` dòng 1115-1139: `#ablationRiskForm`, `#ablationRiskResult`.
- `app.js` dòng 5844: `computeAblationRisk(inputs)`.
- `app.js` dòng 9502-9519: binding submit form ablation.

---

## 46. Ambient rPPG - sàng lọc thầm lặng liên tục

**Hiển thị ở đâu:** `index.html` dòng 1147-1155.

**Mục đích:** Ambient rPPG chạy nền theo chu kỳ khi có webcam để sàng lọc bất thường mà người dùng không cần bấm đo chính thức.

**Cách hoạt động:** `toggleAmbientRPPG()` bật/tắt. `startAmbientRPPG()` mở camera và lên lịch mini scan. `_scheduleNextAmbientScan()` đặt lần quét tiếp theo. `runAmbientMiniScan()` lấy mẫu ngắn, phân tích BPM/quality/irregularity, tăng anomaly streak nếu bất thường. `renderAmbientDashboard()` cập nhật log.

**Code liên quan:**

- `index.html` dòng 1147-1155: `#ambientRPPGBtn`, `#ambientRPPGStatus`, `#ambientRPPGResult`.
- `app.js` dòng 2656: `startAmbientRPPG()`.
- `app.js` dòng 2691: `stopAmbientRPPG()`.
- `app.js` dòng 2702: `toggleAmbientRPPG()`.
- `app.js` dòng 2704: `_scheduleNextAmbientScan(ms)`.
- `app.js` dòng 2726: `runAmbientMiniScan()`.
- `app.js` dòng 2931: `renderAmbientDashboard()`.
- `app.js` dòng 9493: binding Ambient rPPG.

---

## 47. SCG + Bi-Modal cơ học tim

**Hiển thị ở đâu:** `index.html` dòng 1162-1169.

**Mục đích:** SCG dùng cảm biến gia tốc điện thoại để đo rung cơ học lồng ngực, bổ sung cho PPG quang học.

**Cách hoạt động:** `startSCGChestSensor()` xin quyền DeviceMotion trên mobile, lưu accelerometer samples. `_scgMotionHandler()` thu dữ liệu. `analyzeSCG()` tìm peak cơ học, ước tính BPM và quality. `renderSCGResult()` hiển thị, `stopSCGChestSensor()` dừng.

**Code liên quan:**

- `index.html` dòng 1162-1169: `#startSCGBtn`, `#stopSCGBtn`, `#scgStatus`, `#scgResultBox`.
- `app.js` dòng 2996: `startSCGChestSensor()`.
- `app.js` dòng 3045: `_scgMotionHandler(e)`.
- `app.js` dòng 3054: `stopSCGChestSensor()`.
- `app.js` dòng 3076: `detectSCGPeaks(signal, fps)`.
- `app.js` dòng 3097: `_scgTemplateMatch(signal, fps, initBpm)`.
- `app.js` dòng 3169: `analyzeSCG(samples)`.
- `app.js` dòng 3272: `renderSCGResult(result)`.
- `app.js` dòng 9494-9495: binding SCG.

---

## 48. Voice-rPPG qua giọng nói

**Hiển thị ở đâu:** `index.html` dòng 1172-1179.

**Mục đích:** Voice-rPPG dùng đặc trưng giọng nói như RMS, zero-crossing, F0 để suy luận nhịp/biến động sinh lý khi không dùng camera.

**Cách hoạt động:** `startVoiceRPPG()` xin quyền microphone, đọc audio buffer, tính RMS/ZCR/F0. `_analyzeVoiceRPPGBuffer()` phân tích chuỗi đặc trưng để ước tính BPM, confidence và trạng thái. `renderVoiceRPPGResult()` hiển thị. `stopVoiceRPPG()` dừng mic.

**Code liên quan:**

- `index.html` dòng 1172-1179: `#startVoiceRPPGBtn`, `#stopVoiceRPPGBtn`, `#voiceRPPGStatus`, `#voiceRPPGResultBox`.
- `app.js` dòng 3360: `_computeVoiceF0(floatBuf, sampleRate, minF0, maxF0)`.
- `app.js` dòng 3376: `startVoiceRPPG()`.
- `app.js` dòng 3465: `stopVoiceRPPG()`.
- `app.js` dòng 3488: `_voiceACFPeriod(signal, fps, minHz, maxHz)`.
- `app.js` dòng 3507: `_analyzeVoiceRPPGBuffer(rmsData, zcrData, f0Data, envFps)`.
- `app.js` dòng 3670: `renderVoiceRPPGResult(r)`.
- `app.js` dòng 9496-9497: binding Voice-rPPG.

---

## 49. Keyboard BCG - phân tích nhịp gõ phím

**Hiển thị ở đâu:** `index.html` dòng 1186-1193.

**Mục đích:** Keyboard BCG là kênh digital phenotyping: đo nhịp/dao động qua thời gian gõ phím tự nhiên.

**Cách hoạt động:** `startKeyboardBCGTracking()` bắt `keydown`, `_kbcgKeyHandler()` lưu timestamp phím, `analyzeKeyboardBCG()` phân tích khoảng cách phím, tìm nhịp lặp và biến thiên. `renderKeyboardBCGResult()` hiển thị.

**Code liên quan:**

- `index.html` dòng 1186-1193: `#startKBCGBtn`, `#stopKBCGBtn`, `#kbcgStatus`, `#kbcgResultBox`.
- `app.js` dòng 3721: `startKeyboardBCGTracking()`.
- `app.js` dòng 3739: `_kbcgKeyHandler(e)`.
- `app.js` dòng 3743: `stopKeyboardBCGTracking()`.
- `app.js` dòng 3760: `analyzeKeyboardBCG(events)`.
- `app.js` dòng 3861: `renderKeyboardBCGResult(result)`.
- `app.js` dòng 9498-9499: binding keyboard BCG.

---

## 50. PPG-Thermal Cross-Map

**Hiển thị ở đâu:** `index.html` dòng 1196-1198.

**Mục đích:** Tính năng này dùng PPG/rPPG để ước tính tưới máu ngoại vi và trạng thái co mạch/giãn mạch, giúp giải thích khi lạnh, stress hoặc tuần hoàn kém.

**Cách hoạt động:** `analyzePPGThermalProxy()` so tỷ lệ vùng mặt, PI và các đặc trưng perfusion. `renderThermalProxyResult()` hiển thị trạng thái tưới máu, màu cảnh báo và giải thích.

**Code liên quan:**

- `index.html` dòng 1196-1198: `#thermalProxyBox`.
- `app.js` dòng 3890: `analyzePPGThermalProxy(samples)`.
- `app.js` dòng 3979: `renderThermalProxyResult(tp)`.
- `app.js` dòng 7696: gọi render thermal proxy sau đo.

---

## 51. Mã hóa đầu cuối dữ liệu y tế AES-256

**Hiển thị ở đâu:** `index.html` dòng 1207-1209.

**Mục đích:** Bảo vệ dữ liệu y tế local-first bằng Web Crypto AES-GCM. Đây là câu trả lời cho phần bảo mật/quyền riêng tư khi demo trước ban giám khảo.

**Cách hoạt động:** `initLocalEncryption()` tạo/khôi phục khóa local. `encryptLocalData()` mã hóa object thành ciphertext, `decryptLocalData()` giải mã, `saveEncryptedMeasurement()` lưu measurement mã hóa. `renderEncryptionStatus()` hiển thị trạng thái mã hóa.

**Code liên quan:**

- `index.html` dòng 1207-1209: `#encryptionStatusBox`.
- `app.js` dòng 4010: `initLocalEncryption()`.
- `app.js` dòng 4025: `encryptLocalData(data)`.
- `app.js` dòng 4034: `decryptLocalData(encrypted)`.
- `app.js` dòng 4044: `saveEncryptedMeasurement(data)`.
- `app.js` dòng 4051: `renderEncryptionStatus()`.

---

## 52. Zalo Tele-Clinic và đăng ký nghiên cứu AFib Việt Nam

**Hiển thị ở đâu:** `index.html` dòng 1216-1225.

**Mục đích:** Zalo Tele-Clinic là hướng tích hợp y tế từ xa tại Việt Nam. Research Mode cho phép người dùng đồng ý đóng góp dữ liệu ẩn danh cho nghiên cứu AFib.

**Cách hoạt động:** `openZaloClinicInfo()` hiển thị thông tin đăng ký và nút chia sẻ. `toggleResearchMode()` đổi trạng thái đồng ý nghiên cứu, `renderResearchPanel()` cập nhật UI, backend `handleResearchConsent()` lưu consent. Zalo webhook backend nhận `/api/zalo-clinic`.

**Code liên quan:**

- `index.html` dòng 1216-1225: `#zaloClinicInfoBtn`, `#zaloClinicBox`, `#researchModeBtn`, `#researchModeDetail`.
- `app.js` dòng 6071: `renderResearchPanel()`.
- `app.js` dòng 6188: `toggleResearchMode()`.
- `app.js` dòng 6719: `openZaloClinicInfo()`.
- `app.js` dòng 9475, 9479: binding research và Zalo info.
- `server.js` dòng 3857: `handleResearchConsent()`.
- `server.js` dòng 4040: `handleZaloWebhook()`.
- `server.js` dòng 4191-4193: routes research/Zalo.

---

## 53. Lịch sử đo, nhật ký SOS và ledger đồng bộ

**Hiển thị ở đâu:** `index.html` dòng 1234-1243.

**Mục đích:** Đây là phần audit trail: lịch sử đo tim, lịch sử SOS và ledger sự kiện hệ thống. Nó giúp chứng minh app có lưu vết, đồng bộ và minh bạch.

**Cách hoạt động:** `loadDashboard()` gọi backend dashboard. `renderDashboard()` điều phối các hàm render con. `renderHistory()` hiển thị timeline measurement, `renderSosHistory()` hiển thị sự kiện SOS, `renderLedger()` hiển thị sự kiện đồng bộ/hệ thống. Backend `appendLedgerEntry()` ghi ledger mỗi khi có thao tác quan trọng.

**Code liên quan:**

- `index.html` dòng 1234-1243: `#historyChart`, `#sosHistory`, `#ledgerList`.
- `app.js` dòng 8660: `renderHistory(measurements)`.
- `app.js` dòng 8730: `renderSosHistory(events)`.
- `app.js` dòng 8736: `renderLedger(entries)`.
- `app.js` dòng 8773: `renderDashboard(dashboard)`.
- `app.js` dòng 8916: `loadDashboard(showError)`.
- `server.js` dòng 373: `appendLedgerEntry(userId, type, summary, detail)`.
- `server.js` dòng 2010: `buildDashboard(userId, opts)`.
- `server.js` dòng 3389: `handleDashboard(...)`.
- `server.js` dòng 4195: route dashboard.

---

## 54. Modal, toast, loading và thao tác UI chung

**Hiển thị ở đâu:** `index.html` dòng 1252-1258 và toàn bộ các nút/form.

**Mục đích:** Các helper UI giúp app nhất quán: toast để báo thành công/lỗi, modal xác nhận, loading cho button, format ngày giờ.

**Cách hoạt động:** `showToast()` thêm toast vào `#toastContainer`. `setLoading()` khóa nút khi đang gửi request. `showModal()` và `closeModal()` điều khiển `#modalOverlay`. Các hàm render gọi helper này để không lặp code.

**Code liên quan:**

- `index.html` dòng 1252-1258: `#modalOverlay`, `#modalTitle`, `#modalBody`, `#modalConfirmBtn`, `#modalCancelBtn`.
- `app.js` dòng 220: `showToast(msg, type, duration)`.
- `app.js` dòng 234: `setLoading(btn, loading, text)`.
- `app.js` dòng 312: `formatDateTime(iso)`.
- `app.js` dòng 314: `showModal(title, body, onConfirm)`.
- `app.js` dòng 322: `closeModal()`.
- `app.js` dòng 9449-9452: binding modal và abnormal buttons.

---

## 55. API backend, data store, email provider và static server

**Hiển thị ở đâu:** Không hiện trực tiếp trong UI, nhưng phục vụ toàn bộ `index.html`.

**Mục đích:** Backend `server.js` chịu trách nhiệm lưu dữ liệu, xác thực session, phân tích kết quả, gửi email, trả dashboard/report/export và phục vụ file tĩnh.

**Cách hoạt động:** `handleRequest()` phân route theo method/path. Dữ liệu đọc/ghi qua `readJson()`/`writeJson()` hoặc Supabase nếu cấu hình. Email đi qua `sendEmail()` với Resend/Gmail. Static frontend được phục vụ bởi `serveStatic()`.

**Code liên quan:**

- `server.js` dòng 211: `sbGet(key)`.
- `server.js` dòng 221: `sbSet(key, value)`.
- `server.js` dòng 238: `readJson(key)`.
- `server.js` dòng 250: `writeJson(key, value)`.
- `server.js` dòng 265: `initDataStore()`.
- `server.js` dòng 386: `getProviderStatus()`.
- `server.js` dòng 411: `sendResendEmail()`.
- `server.js` dòng 437: `sendGmailEmail()`.
- `server.js` dòng 451: `sendEmail()`.
- `server.js` dòng 4067: `serveStatic(urlObject, res)`.
- `server.js` dòng 4086: `handleRequest(req, res)`.
- `server.js` dòng 4115-4199: toàn bộ route API chính.

---

## 56. Luồng đo đầy đủ từ nút "Bắt đầu đo" đến dashboard

**Hiển thị ở đâu:** `index.html` dòng 137-349 và các panel dashboard phía dưới.

**Mục đích:** Đây là luồng quan trọng nhất để trình bày: từ camera -> lấy mẫu -> phân tích local -> gửi server -> lưu lịch sử -> cập nhật dashboard -> cảnh báo nếu nguy hiểm.

**Cách hoạt động từng bước:**

1. Người dùng bấm `#startMeasureBtn`.
2. `runMeasurement()` đảm bảo camera bật, khóa exposure, đếm thời gian 60/90 giây.
3. Mỗi frame gọi `sampleFrame(mode)` để lấy RGB/region.
4. Sau khi đo xong, `analyzeSamples()` chuẩn hóa FPS và gọi `analyzePPGSignal()`.
5. Local result được hiệu chỉnh BPM, kiểm tra chất lượng, render sóng/kết quả.
6. Nếu đăng nhập, frontend gọi `POST /api/measurements`.
7. Backend `handleCreateMeasurement()` gọi `analyzeMeasurement()`, lưu record, cập nhật AFib episode/SOS/pill alert/dashboard.
8. Frontend `renderDashboard()` dựng lại toàn bộ panel.

**Code liên quan:**

- `app.js` dòng 2414: `resampleToUniformFps(samples, targetFps)`.
- `app.js` dòng 2456: `computeActualFps(samples)`.
- `app.js` dòng 2511: `analyzeSamples(samples, mode)`.
- `app.js` dòng 7362: `runMeasurement()`.
- `app.js` dòng 8059: `renderMeasurementResult(record)`.
- `app.js` dòng 8773: `renderDashboard(dashboard)`.
- `server.js` dòng 1305: `analyzeMeasurement()`.
- `server.js` dòng 2010: `buildDashboard()`.
- `server.js` dòng 3072: `handleCreateMeasurement()`.
- `server.js` dòng 4123: route `POST /api/measurements`.

---

## 57. Hàm khởi tạo và binding sự kiện toàn app

**Hiển thị ở đâu:** Toàn bộ trang `index.html`.

**Mục đích:** Đây là phần nối HTML với JavaScript. Nếu ban giám khảo hỏi "nút này chạy hàm nào", phần này trả lời rõ: mọi form/nút chính được bind trong `bindEvents()`.

**Cách hoạt động:** `init()` chạy khi app tải, gọi detect platform, render QR fallback, bind PWA, bind event, chọn mode finger mặc định, cập nhật offline, khôi phục session, init encryption/research/skin calibration/expert mode. `bindEvents()` gắn submit/click/change cho từng form/nút.

**Code liên quan:**

- `app.js` dòng 9427: `bindEvents()`.
- `app.js` dòng 9429-9457: bind auth, guardian, camera, đo, breathing, SOS, symptom, reminder, doctor export, thuốc, parent report.
- `app.js` dòng 9459-9479: bind quick start, offline, duration, elderly, hand, expert, research, share, Zalo.
- `app.js` dòng 9482-9500: bind BCG, OCR, Ambient, SCG, Voice, Keyboard.
- `app.js` dòng 9502-9519: bind ablation form.
- `app.js` dòng 9522: `init()`.

---

## 58. Tóm tắt route API dùng bởi từng nhóm tính năng

Phần này không phải bảng tra nhanh thay cho giải thích, mà là danh sách route để ban giám khảo đối chiếu khi hỏi "frontend gọi backend ở đâu".

- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `/api/session` - `server.js` dòng 4119-4121.
- Guardian: `PUT /api/guardian` - `server.js` dòng 4122.
- Measurement: `POST /api/measurements`, `POST /api/measurements/context`, `POST /api/measurements/delete` - `server.js` dòng 4123-4124, 4186.
- Baseline: `POST /api/baseline` - `server.js` dòng 4125.
- Breathing: `POST /api/breathing` - `server.js` dòng 4126.
- Symptoms/reminders: `POST /api/symptoms`, `POST /api/reminders` - `server.js` dòng 4127-4128.
- SOS: `POST /api/sos/trigger`, `POST /api/sos/cancel` - `server.js` dòng 4129-4130.
- Pocket Cardiologist: `POST /api/pocket-cardiologist`, `POST /api/pocket-cardiologist/send-family-report` - `server.js` dòng 4131-4132.
- HRR: `POST /api/hrr-result` - `server.js` dòng 4133.
- Family: `POST /api/family-token` - `server.js` dòng 4142.
- Thuốc: `POST /api/medications/check-interactions`, `POST /api/pill-protocol`, `POST /api/medications/adherence` - `server.js` dòng 4181-4182, 4185.
- Export/Holter: `POST /api/export-token`, `POST /api/holter-log`, `GET /api/users/:id/doctor-export` - `server.js` dòng 4183-4184, 4197.
- Dashboard/report: `/api/users/:id/dashboard`, `/api/users/:id/report` - `server.js` dòng 4195-4196.
- Research/Zalo/AFib context: `POST /api/research-consent`, `POST /api/afib-context`, `POST /api/zalo-clinic` - `server.js` dòng 4191-4193.

---

## 59. Các file chính và vai trò

**`index.html`**: định nghĩa toàn bộ UI trên localhost 8010, từ auth, đo PPG, kết quả, dashboard lâm sàng, chăm sóc dài hạn đến các tính năng nâng cao.

**`app.js`**: xử lý frontend, camera, PPG/rPPG, Web Crypto, MediaPipe, render UI, gọi API, dashboard và các tính năng tương tác.

**`ppg-worker.js`**: chạy các phép tính BPM nặng trong WebWorker để tránh đơ giao diện: lọc, FFT, autocorrelation, peak detection, multi-window, Kalman.

**`server.js`**: backend Node.js, xác thực, lưu dữ liệu, phân tích kết quả server-side, dashboard, email, SOS, thuốc, export, AI report và API routes.

**`data/*.json`**: dữ liệu local như measurements, reminders, symptoms, SOS, ledger, pill protocols, AFib episodes.

**`styles.css`**: giao diện, card, layout, badge, responsive và các trạng thái UI.

---

## 60. Kết luận trình bày cho ban giám khảo

HeartSense không phải một demo chỉ hiển thị BPM. Luồng chính gồm:

1. Thu tín hiệu sinh học bằng camera, microphone, cảm biến chuyển động hoặc hành vi nhập liệu.
2. Lọc tín hiệu, tính BPM/HRV/AFib bằng nhiều thuật toán độc lập.
3. Chặn false positive bằng quality gate, temporal consistency, PAC/PVC detection, emotional artifact filter và calibration cá nhân.
4. Cá nhân hóa nguy cơ bằng hồ sơ, baseline, bệnh nền, thuốc, huyết áp, lịch sử đo và thời tiết.
5. Biến kết quả thành hành động: khuyến nghị, SOS, báo cáo bác sĩ, báo cáo gia đình, nhắc thuốc, Holter 7 ngày và dashboard dài hạn.

Nếu cần bảo vệ tính năng trước hội đồng, hãy bắt đầu từ `runMeasurement()` trong `app.js` dòng 7362, `analyzePPGSignal()` dòng 1781, `analyzeMeasurement()` trong `server.js` dòng 1305 và `renderDashboard()` trong `app.js` dòng 8773. Đây là bốn điểm nối quan trọng nhất giữa UI, thuật toán, backend và hiển thị kết quả.
