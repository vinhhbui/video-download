# DOUYIN TREND INSIGHT SYSTEM — CODEX BUILD SPECIFICATION

## 1. Mục tiêu dự án

Xây dựng một hệ thống tự động thu thập dữ liệu video từ Douyin, theo dõi sự thay đổi chỉ số theo thời gian, phát hiện video có khả năng lên xu hướng, đánh giá mức độ phù hợp với khán giả Việt Nam và xác định tiềm năng affiliate.

Hệ thống phục vụ quy trình:

```text
Nguồn dữ liệu Douyin hợp lệ
        ↓
Thu thập video và chỉ số thật
        ↓
Lưu snapshot theo thời gian
        ↓
Tính tốc độ tăng trưởng
        ↓
Phân tích nội dung bằng AI
        ↓
Gom cụm xu hướng
        ↓
Chấm điểm và giải thích
        ↓
Dashboard đề xuất video
        ↓
Người dùng phê duyệt
        ↓
Chuyển sang workflow biên tập
```

Hệ thống này chỉ thực hiện chức năng thu thập, phân tích và đề xuất. Không tự động tải xuống, chỉnh sửa hoặc đăng lại video nếu chưa có phê duyệt và xác nhận quyền sử dụng nội dung.

---

## 2. Yêu cầu bắt buộc

### 2.1. Không sử dụng dữ liệu giả

Không được xây dựng hoặc sử dụng:

- `MockDataProvider`
- Dữ liệu seed giả
- Video giả
- Metrics giả
- Dashboard hiển thị dữ liệu mô phỏng
- Cơ chế tự tạo dữ liệu khi API chưa được cấu hình

Khi chưa có nguồn dữ liệu thật hoặc credential hợp lệ, hệ thống phải:

1. Khởi động được phần giao diện và backend quản trị.
2. Hiển thị trạng thái `DATA_SOURCE_NOT_CONFIGURED`.
3. Không tự tạo bản ghi video hoặc metrics.
4. Hướng dẫn người dùng cấu hình nguồn dữ liệu trong trang Settings hoặc trong `README.md`.
5. Không crash toàn bộ ứng dụng.
6. Không tính Trend Score khi chưa đủ dữ liệu thật.

### 2.2. Không hard-code secret

Không được ghi trực tiếp vào source code:

- API key
- Cookie
- Session token
- Mật khẩu
- Proxy credential
- OpenAI API key
- Database password

Mọi secret phải được lấy từ:

- Biến môi trường
- Secret manager của nền tảng triển khai
- File `.env` cục bộ đã được thêm vào `.gitignore`

### 2.3. Không tự động vượt cơ chế bảo vệ

Không xây tính năng:

- Phá CAPTCHA tự động
- Né rate limit
- Bypass đăng nhập
- Truy cập dữ liệu riêng tư không được cấp quyền
- Vượt cơ chế chống bot
- Dùng cookie của người khác
- Tự động luân chuyển proxy để né chặn

Khi gặp CAPTCHA, session hết hạn hoặc bị rate limit, collector phải dừng an toàn và ghi nhận trạng thái lỗi.

---

## 3. Phạm vi hệ thống

### 3.1. Trong phạm vi

- Kết nối nguồn dữ liệu Douyin hợp lệ.
- Theo dõi creator, keyword, hashtag, music hoặc video URL.
- Thu thập metadata và metrics công khai hoặc được cấp quyền.
- Lưu lịch sử metrics theo thời gian.
- Tính velocity, acceleration và engagement.
- Phân tích caption, nội dung và sản phẩm bằng AI.
- Gom các video thành trend cluster.
- Chấm Trend Score.
- Chấm Vietnam Fit Score.
- Chấm Affiliate Potential Score.
- Đánh giá rủi ro bản quyền và trạng thái quyền sử dụng.
- Hiển thị dashboard đề xuất.
- Cho phép người dùng phê duyệt hoặc loại bỏ video.
- Cung cấp API để kết nối workflow biên tập trong tương lai.

### 3.2. Ngoài phạm vi phiên bản đầu

- Tự động đăng nhập bằng username/password.
- Tự động giải CAPTCHA.
- Tự động tải video.
- Tự động xóa watermark.
- Tự động đăng YouTube.
- Tự động mua proxy.
- Tự động xin quyền creator.
- Tự động quyết định rằng một video được phép sử dụng thương mại.
- Tự động đăng lại video chưa có phê duyệt.

---

## 4. Kiến trúc đề xuất

Thiết kế hệ thống theo module độc lập:

```text
apps/
├── api/
├── dashboard/
└── worker/

packages/
├── config/
├── database/
├── data-provider/
├── collector/
├── scoring/
├── ai-analysis/
├── trend-clustering/
├── rights-management/
├── observability/
└── shared-types/
```

Các thành phần chính:

### 4.1. Dashboard

Chức năng:

- Hiển thị video được đề xuất.
- Hiển thị cluster đang tăng.
- Quản lý nguồn dữ liệu.
- Quản lý creator, keyword, hashtag và music.
- Quản lý API key thông qua backend.
- Xem trạng thái collector.
- Xem lỗi gần nhất.
- Phê duyệt hoặc loại bỏ video.
- Quản lý quyền sử dụng nội dung.
- Cấu hình trọng số scoring.
- Cấu hình chu kỳ thu thập.

### 4.2. Backend API

Chức năng:

- Xác thực người dùng quản trị.
- CRUD source configuration.
- CRUD tracked targets.
- Truy vấn video, metrics và score.
- Điều khiển collector.
- Gửi job sang worker.
- Quản lý approval.
- Quản lý usage rights.
- Cung cấp audit log.
- Cung cấp health check.

### 4.3. Collector Worker

Chức năng:

- Lấy video mới từ provider.
- Cập nhật metrics của video cũ.
- Lưu snapshot.
- Tôn trọng rate limit.
- Retry có giới hạn.
- Dừng khi credential không hợp lệ.
- Dừng khi CAPTCHA xuất hiện.
- Ghi log lỗi có cấu trúc.
- Không ghi trùng snapshot trong cùng thời điểm thu thập.

### 4.4. Scoring Engine

Chức năng:

- Tính các chỉ số tăng trưởng.
- Chuẩn hóa dữ liệu.
- Chấm điểm.
- Phân loại trạng thái.
- Giải thích lý do đề xuất.
- Không tính điểm khi dữ liệu chưa đủ.

### 4.5. AI Analysis Service

Chức năng:

- Dịch caption tiếng Trung sang tiếng Việt.
- Tóm tắt video.
- Phân loại chủ đề.
- Xác định đối tượng xem.
- Xác định sản phẩm.
- Đề xuất hook.
- Đề xuất tiêu đề.
- Đề xuất caption.
- Tạo keyword affiliate.
- Đánh giá Vietnam Fit.
- Đánh giá Affiliate Potential.
- Đánh giá mức độ phụ thuộc ngôn ngữ.
- Đánh giá rủi ro bản quyền ở mức tham khảo.

### 4.6. Rights Management

Chức năng:

- Lưu trạng thái quyền sử dụng.
- Lưu bằng chứng creator cho phép.
- Lưu phạm vi sử dụng.
- Chặn chuyển video sang workflow xuất bản khi quyền chưa rõ.
- Tách biệt quyền xem dữ liệu và quyền sử dụng nội dung.

---

## 5. Nguồn dữ liệu thật

Hệ thống phải hỗ trợ kiến trúc provider có thể thay thế.

### 5.1. Interface bắt buộc

```ts
interface DataProvider {
  getProviderName(): string;
  healthCheck(): Promise<ProviderHealth>;
  discoverVideos(input: DiscoverVideosInput): Promise<DiscoveredVideo[]>;
  getVideoDetails(videoId: string): Promise<VideoDetails>;
  getVideoMetrics(videoId: string): Promise<VideoMetrics>;
  listCreatorVideos?(creatorId: string): Promise<DiscoveredVideo[]>;
  searchByKeyword?(keyword: string): Promise<DiscoveredVideo[]>;
  searchByHashtag?(hashtag: string): Promise<DiscoveredVideo[]>;
  searchByMusic?(musicId: string): Promise<DiscoveredVideo[]>;
}
```

### 5.2. Provider được phép

#### ThirdPartyApiProvider

Dùng khi có nhà cung cấp API hỗ trợ Douyin.

Yêu cầu:

- Đọc `API_BASE_URL` và `API_KEY` từ biến môi trường.
- Có timeout.
- Có retry theo exponential backoff.
- Có rate limit.
- Có circuit breaker.
- Có mapping schema.
- Lưu raw response có kiểm soát để debug.
- Không ghi secret vào log.
- Có health check.
- Có trạng thái quota.
- Có khả năng thay đổi endpoint qua config.

#### AuthorizedBrowserProvider

Dùng khi người dùng có tài khoản Douyin hợp lệ và được phép truy cập dữ liệu.

Yêu cầu:

- Sử dụng browser profile cục bộ.
- Người dùng tự đăng nhập thủ công.
- Không lưu mật khẩu trong source code.
- Không export raw cookie ra frontend.
- Phát hiện `LOGIN_REQUIRED`.
- Phát hiện `SESSION_EXPIRED`.
- Phát hiện `CAPTCHA_DETECTED`.
- Phát hiện `RATE_LIMITED`.
- Dừng an toàn khi bị chặn.
- Không bypass CAPTCHA.
- Không chạy nếu browser profile chưa được cấu hình.

#### OfficialOrPartnerProvider

Tạo adapter để kết nối API chính thức hoặc API đối tác nếu người dùng có quyền.

Không được giả định endpoint hoặc quyền truy cập khi chưa có tài liệu API.

### 5.3. Không tạo MockDataProvider

Không được triển khai `MockDataProvider` trong production hoặc development runtime.

Các unit test cho hàm thuần có thể dùng test vectors nhỏ, nhưng:

- Không được seed dữ liệu giả vào database runtime.
- Không được dùng dữ liệu giả để hiển thị dashboard.
- Không được dùng dữ liệu giả để giả lập kết nối provider.
- Không được tự chuyển sang dữ liệu giả khi provider lỗi.

---

## 6. Dữ liệu người dùng cần cung cấp

Hệ thống cần hỗ trợ người dùng nhập hoặc cấu hình:

### 6.1. Credential

Tùy provider:

```env
DATA_PROVIDER=third_party_api

DOUYIN_API_BASE_URL=
DOUYIN_API_KEY=

DOUYIN_BROWSER_PROFILE_PATH=

OPENAI_API_KEY=
OPENAI_MODEL=

DATABASE_URL=
REDIS_URL=

COLLECT_INTERVAL_MINUTES=120
COLLECT_BATCH_SIZE=50
REQUEST_TIMEOUT_SECONDS=30
MAX_RETRY_ATTEMPTS=3
```

### 6.2. Danh sách theo dõi

Người dùng có thể thêm:

- Creator ID hoặc creator URL.
- Keyword tiếng Trung.
- Hashtag.
- Music ID hoặc music URL.
- Video URL cụ thể.
- Category.
- Priority.
- Trạng thái active/inactive.

Ví dụ keyword ban đầu:

```text
好物推荐
家居好物
数码好物
穿搭
搞笑
生活技巧
学生党好物
```

Không hard-code danh sách này. Cho phép quản lý trong dashboard.

---

## 7. Schema dữ liệu

Khuyến nghị dùng PostgreSQL.

### 7.1. Bảng `data_sources`

```text
id
provider_type
provider_name
status
last_health_check_at
last_success_at
last_error_at
last_error_code
last_error_message
configuration_json
created_at
updated_at
```

Không lưu secret dạng plain text trong `configuration_json`.

### 7.2. Bảng `tracked_targets`

```text
id
target_type
target_value
display_name
category
priority
is_active
last_collected_at
created_at
updated_at
```

`target_type`:

```text
creator
keyword
hashtag
music
video_url
```

### 7.3. Bảng `creators`

```text
id
provider_creator_id
username
display_name
profile_url
avatar_url
follower_count
following_count
total_likes
verified
raw_metadata_json
first_seen_at
last_seen_at
created_at
updated_at
```

### 7.4. Bảng `videos`

```text
id
provider_video_id
provider_name
video_url
author_id
caption_original
caption_vi
hashtags_json
music_id
music_title
duration_seconds
publish_time
thumbnail_url
category
language
product_detected
product_keywords_json
raw_metadata_json
first_seen_at
last_seen_at
created_at
updated_at
```

Tạo unique constraint:

```text
(provider_name, provider_video_id)
```

### 7.5. Bảng `video_metrics`

```text
id
video_id
collected_at
views
likes
comments
shares
saves
favorites
raw_metrics_json
created_at
```

Tạo index:

```text
(video_id, collected_at DESC)
```

Không giả định provider luôn có đủ `views`, `shares` hoặc `saves`. Các trường có thể nullable.

### 7.6. Bảng `video_scores`

```text
id
video_id
calculated_at
view_velocity
like_velocity
comment_velocity
share_velocity
save_velocity
growth_acceleration
engagement_rate
share_rate
comment_rate
save_rate
velocity_score
acceleration_score
engagement_score
vietnam_fit_score
affiliate_potential_score
copyright_risk_score
trend_score
recommendation_status
recommendation_reason_json
scoring_version
created_at
```

### 7.7. Bảng `ai_analyses`

```text
id
video_id
provider
model
summary_vi
category
audience
language_dependency
visual_hook_score
suggested_hook_vi
suggested_title_vi
suggested_caption_vi
detected_products_json
affiliate_keywords_json
vietnam_fit_reason_json
affiliate_reason_json
copyright_risk
copyright_risk_reason_json
raw_response_json
analyzed_at
created_at
```

### 7.8. Bảng `trend_clusters`

```text
id
cluster_key
cluster_name
category
music_id
hashtags_json
product_keywords_json
video_count
creator_count
new_video_count_24h
total_view_growth
total_like_growth
total_comment_growth
total_share_growth
average_trend_score
average_vietnam_fit_score
average_affiliate_score
cluster_velocity
cluster_acceleration
first_seen_at
last_seen_at
created_at
updated_at
```

### 7.9. Bảng `trend_cluster_videos`

```text
cluster_id
video_id
similarity_score
added_at
```

### 7.10. Bảng `content_approvals`

```text
id
video_id
status
reviewer_id
review_note
approved_at
rejected_at
created_at
updated_at
```

`status`:

```text
pending
approved_for_editing
rejected
needs_review
```

### 7.11. Bảng `usage_rights`

```text
id
video_id
rights_status
creator_permission
commercial_use_allowed
editing_allowed
youtube_allowed
permission_source
permission_evidence_url
permission_note
valid_from
valid_until
verified_by
verified_at
created_at
updated_at
```

`rights_status`:

```text
unknown
requested
granted
denied
expired
not_required_confirmed
```

### 7.12. Bảng `collector_runs`

```text
id
provider_name
target_id
started_at
finished_at
status
discovered_count
updated_count
snapshot_count
error_code
error_message
metadata_json
created_at
```

### 7.13. Bảng `audit_logs`

```text
id
actor_type
actor_id
action
entity_type
entity_id
before_json
after_json
ip_address
created_at
```

---

## 8. Logic thu thập dữ liệu

### 8.1. Discovery flow

```text
Scheduler
   ↓
Đọc tracked_targets đang active
   ↓
Gọi provider phù hợp
   ↓
Lấy danh sách video thật
   ↓
Upsert creator
   ↓
Upsert video
   ↓
Lưu metrics snapshot
   ↓
Ghi collector run
```

### 8.2. Metrics refresh flow

```text
Chọn video cần cập nhật
   ↓
Gọi getVideoMetrics()
   ↓
Lưu snapshot mới
   ↓
So sánh với snapshot trước
   ↓
Đưa vào scoring queue
```

### 8.3. Chu kỳ thu thập đề xuất

Cho phép cấu hình:

- Video mới dưới 6 giờ: cập nhật thường xuyên hơn.
- Video từ 6–24 giờ: cập nhật theo chu kỳ chuẩn.
- Video từ 1–3 ngày: giảm tần suất.
- Video cũ không còn tăng: ngừng theo dõi tự động.
- Video được đánh dấu quan trọng: tiếp tục theo dõi.

Không hard-code lịch. Cho phép chỉnh trong Settings.

### 8.4. Idempotency

Collector phải:

- Không tạo trùng video.
- Không tạo trùng creator.
- Không tạo trùng snapshot cùng `video_id + collected_at`.
- Retry không làm nhân đôi dữ liệu.
- Có transaction khi ghi dữ liệu liên quan.

---

## 9. Chỉ số insight

### 9.1. View Velocity

```text
view_velocity =
(current_views - previous_views) / elapsed_hours
```

Chỉ tính khi có `views`.

### 9.2. Like Velocity

```text
like_velocity =
(current_likes - previous_likes) / elapsed_hours
```

### 9.3. Comment Velocity

```text
comment_velocity =
(current_comments - previous_comments) / elapsed_hours
```

### 9.4. Share Velocity

```text
share_velocity =
(current_shares - previous_shares) / elapsed_hours
```

### 9.5. Save Velocity

```text
save_velocity =
(current_saves - previous_saves) / elapsed_hours
```

### 9.6. Engagement Rate

```text
engagement_rate =
(likes + comments + shares + saves) / views
```

Chỉ tính khi `views > 0`.

Nếu provider không có `views`, dùng chỉ số thay thế theo cấu hình và đánh dấu độ tin cậy thấp hơn.

### 9.7. Share Rate

```text
share_rate = shares / views
```

### 9.8. Comment Rate

```text
comment_rate = comments / views
```

### 9.9. Save Rate

```text
save_rate = saves / views
```

### 9.10. Growth Acceleration

```text
growth_acceleration =
current_velocity - previous_velocity
```

### 9.11. Video Age

```text
video_age_hours =
current_time - publish_time
```

Không so sánh trực tiếp video mới và video cũ nếu chưa chuẩn hóa theo tuổi video.

---

## 10. Chuẩn hóa điểm

Không dùng giá trị thô trực tiếp để cộng điểm.

Hệ thống phải hỗ trợ:

- Percentile rank theo category.
- Percentile rank theo video age bucket.
- Robust scaling.
- Winsorization để giảm ảnh hưởng outlier.
- Minimum sample size.
- Confidence score.
- Fallback khi thiếu một số metric.

Các nhóm tuổi đề xuất:

```text
0–3 giờ
3–6 giờ
6–12 giờ
12–24 giờ
24–72 giờ
trên 72 giờ
```

Các nhóm category phải cấu hình được.

---

## 11. Trend Score

Công thức mặc định:

```text
Trend Score =
30% Velocity Score
+ 20% Growth Acceleration Score
+ 15% Share Rate Score
+ 10% Comment Rate Score
+ 10% Save Rate Score
+ 10% Vietnam Fit Score
+ 5% Affiliate Potential Score
```

Các trọng số phải:

- Lưu trong database hoặc config.
- Sửa được trong dashboard.
- Có version.
- Có audit log.
- Không áp dụng hồi tố nếu chưa được yêu cầu.
- Tổng trọng số phải bằng 100%.

### 11.1. Trạng thái đề xuất

```text
80–100: process_now
65–79: watch
50–64: optional
0–49: skip
```

Cho phép cấu hình ngưỡng.

### 11.2. Điều kiện dữ liệu tối thiểu

Không chấm Trend Score khi:

- Chưa có ít nhất hai snapshot.
- Khoảng cách snapshot quá ngắn.
- Không có metric tăng trưởng nào khả dụng.
- Provider đang ở trạng thái lỗi.
- Dữ liệu bị xác định là không hợp lệ.

Trạng thái thay thế:

```text
INSUFFICIENT_DATA
WAITING_FOR_NEXT_SNAPSHOT
PROVIDER_ERROR
INVALID_METRICS
```

---

## 12. Vietnam Fit Score

Điểm từ 0 đến 100 dựa trên:

- Nội dung dễ hiểu với người Việt.
- Không phụ thuộc quá nhiều vào bối cảnh nội địa Trung Quốc.
- Có thể hiểu khi tắt tiếng.
- Dễ thêm voice-over tiếng Việt.
- Phù hợp giới trẻ.
- Có yếu tố tò mò, hài hước hoặc bất ngờ.
- Có hook sớm.
- Có khả năng tạo bình luận hoặc chia sẻ.
- Có thể chuyển thành YouTube Shorts.
- Không chứa nội dung quá nhạy cảm hoặc khó kiểm chứng.

AI phải trả về:

```json
{
  "score": 0,
  "confidence": 0,
  "reasons": [],
  "risks": []
}
```

Không chỉ trả về một con số.

---

## 13. Affiliate Potential Score

Điểm từ 0 đến 100 dựa trên:

- Sản phẩm xuất hiện rõ.
- Có thể xác định tên hoặc từ khóa sản phẩm.
- Sản phẩm có khả năng tìm thấy tại Việt Nam.
- Phù hợp người trẻ.
- Giá có khả năng tiếp cận.
- Có nhu cầu sử dụng thực tế.
- Video thể hiện rõ công dụng.
- Có yếu tố trước/sau hoặc demo.
- Có khả năng kích thích nhu cầu mua.
- Có thể liên kết với Shopee, TikTok Shop, Lazada hoặc nền tảng affiliate khác.

Nhóm ưu tiên:

- Đồ gia dụng thông minh.
- Phụ kiện điện thoại.
- Đồ trang trí phòng.
- Đồ dùng học tập.
- Phụ kiện thời trang.
- Dụng cụ nhà bếp.
- Chăm sóc cá nhân.
- Đồ dùng thú cưng.

AI phải trả về:

```json
{
  "score": 0,
  "confidence": 0,
  "detected_products": [],
  "search_keywords_vi": [],
  "search_keywords_zh": [],
  "reasons": [],
  "risks": []
}
```

---

## 14. Trend Clustering

Gom video thành cluster dựa trên:

- Hashtag.
- Music.
- Caption embedding.
- Product keyword.
- Category.
- Visual concept.
- Meme format.
- Creator overlap.
- Thời gian xuất hiện.

Mỗi cluster cần có:

- Tên cluster.
- Số video.
- Số creator.
- Số video mới trong 24 giờ.
- Tổng tăng trưởng.
- Velocity.
- Acceleration.
- Vietnam Fit trung bình.
- Affiliate Potential trung bình.
- Hashtag phổ biến.
- Music phổ biến.
- Sản phẩm phổ biến.
- Độ tin cậy cluster.

Không gộp cluster chỉ dựa vào một hashtag chung quá rộng.

---

## 15. AI Analysis

### 15.1. Input

AI có thể nhận:

- Caption.
- Hashtag.
- Metadata.
- OCR text nếu hệ thống có module OCR hợp lệ.
- Transcript nếu có.
- Thumbnail hoặc keyframes nếu đã có quyền xử lý.
- Metrics.
- Category context.

### 15.2. Output chuẩn

```json
{
  "summary_vi": "",
  "translated_caption_vi": "",
  "category": "",
  "audience": "",
  "language_dependency": "low | medium | high",
  "visual_hook_score": 0,
  "detected_products": [],
  "vietnam_fit": {
    "score": 0,
    "confidence": 0,
    "reasons": [],
    "risks": []
  },
  "affiliate_potential": {
    "score": 0,
    "confidence": 0,
    "reasons": [],
    "risks": [],
    "keywords_vi": [],
    "keywords_zh": []
  },
  "copyright_risk": {
    "level": "low | medium | high | unknown",
    "reasons": []
  },
  "suggested_hook_vi": "",
  "suggested_title_vi": "",
  "suggested_caption_vi": ""
}
```

### 15.3. Quy tắc AI

- Không bịa sản phẩm.
- Không bịa quyền sử dụng.
- Không khẳng định nội dung không vi phạm bản quyền.
- Không coi AI score là quyết định pháp lý.
- Ghi lại model và prompt version.
- Có retry giới hạn.
- Có schema validation.
- Không lưu API key trong prompt log.
- Cho phép tắt AI analysis khi chưa có API key.
- Khi không có API key, hiển thị `AI_NOT_CONFIGURED`.
- Không tự tạo kết quả AI giả.

---

## 16. Quyền sử dụng nội dung

Mỗi video phải có trạng thái riêng:

```text
unknown
requested
granted
denied
expired
not_required_confirmed
```

Thông tin cần lưu:

- Creator ID.
- Video ID.
- Ngày xin phép.
- Ngày được cấp quyền.
- Phạm vi nền tảng.
- Có được chỉnh sửa hay không.
- Có được dùng thương mại hay không.
- Có được đăng YouTube hay không.
- Thời hạn.
- Bằng chứng.
- Người xác nhận.

Luồng phê duyệt:

```text
Video được đề xuất
        ↓
Người dùng đánh giá
        ↓
Kiểm tra quyền sử dụng
        ↓
Nếu chưa rõ: giữ trạng thái pending
        ↓
Nếu hợp lệ: approved_for_editing
```

Không được tự động chuyển video sang workflow đăng bài khi `rights_status` chưa phù hợp.

---

## 17. API backend

### 17.1. Data source

```text
GET    /api/data-sources
POST   /api/data-sources
GET    /api/data-sources/:id
PATCH  /api/data-sources/:id
POST   /api/data-sources/:id/health-check
POST   /api/data-sources/:id/run
```

### 17.2. Tracked targets

```text
GET    /api/tracked-targets
POST   /api/tracked-targets
PATCH  /api/tracked-targets/:id
DELETE /api/tracked-targets/:id
POST   /api/tracked-targets/:id/run
```

### 17.3. Videos

```text
GET    /api/videos
GET    /api/videos/:id
GET    /api/videos/:id/metrics
GET    /api/videos/:id/scores
GET    /api/videos/:id/analysis
POST   /api/videos/:id/reanalyze
POST   /api/videos/:id/recalculate
```

### 17.4. Trend clusters

```text
GET    /api/trend-clusters
GET    /api/trend-clusters/:id
GET    /api/trend-clusters/:id/videos
```

### 17.5. Approval

```text
POST   /api/videos/:id/approve
POST   /api/videos/:id/reject
POST   /api/videos/:id/needs-review
```

### 17.6. Usage rights

```text
GET    /api/videos/:id/usage-rights
PUT    /api/videos/:id/usage-rights
```

### 17.7. Settings

```text
GET    /api/settings/scoring
PUT    /api/settings/scoring
GET    /api/settings/collector
PUT    /api/settings/collector
GET    /api/settings/ai
PUT    /api/settings/ai
```

### 17.8. System

```text
GET    /health
GET    /ready
GET    /api/system/status
GET    /api/collector-runs
GET    /api/audit-logs
```

---

## 18. Dashboard

### 18.1. Trang Overview

Hiển thị:

- Data source status.
- AI service status.
- Database status.
- Collector status.
- Lần thu thập gần nhất.
- Số video mới.
- Số video đủ dữ liệu để chấm điểm.
- Số video `process_now`.
- Số video đang chờ phê duyệt.
- Số lỗi trong 24 giờ.

### 18.2. Trang Trending Now

Bảng:

- Thumbnail.
- Caption.
- Creator.
- Tuổi video.
- Metrics hiện tại.
- Velocity.
- Acceleration.
- Trend Score.
- Vietnam Fit.
- Affiliate Potential.
- Rights status.
- Recommendation status.
- Lý do đề xuất.

Bộ lọc:

- Category.
- Score.
- Status.
- Video age.
- Creator.
- Rights status.
- Product detected.
- Data confidence.

### 18.3. Trang Trend Clusters

Hiển thị:

- Cluster name.
- Video count.
- Creator count.
- New videos 24h.
- Cluster velocity.
- Cluster acceleration.
- Top hashtag.
- Top music.
- Top product.
- Average score.

### 18.4. Trang Video Detail

Hiển thị:

- Metadata.
- Lịch sử metrics.
- Biểu đồ tăng trưởng.
- Score breakdown.
- AI analysis.
- Cluster.
- Rights status.
- Approval action.
- Audit history.

### 18.5. Trang Tracked Targets

Cho phép quản lý:

- Creator.
- Keyword.
- Hashtag.
- Music.
- Video URL.
- Priority.
- Active status.
- Last run.
- Error status.

### 18.6. Trang Settings

Bao gồm:

- Data provider.
- Provider health.
- Collector interval.
- Batch size.
- Rate limit.
- Scoring weights.
- Score thresholds.
- AI provider.
- AI model.
- Feature flags.
- Retention policy.
- Notification settings.

Không hiển thị secret đầy đủ. Chỉ hiển thị masked value.

### 18.7. Trang Rights Management

Hiển thị:

- Video.
- Creator.
- Rights status.
- Commercial use.
- Editing allowed.
- YouTube allowed.
- Evidence.
- Expiration.
- Reviewer.

---

## 19. Trạng thái hệ thống

Chuẩn hóa error code:

```text
DATA_SOURCE_NOT_CONFIGURED
PROVIDER_UNREACHABLE
INVALID_CREDENTIALS
LOGIN_REQUIRED
SESSION_EXPIRED
CAPTCHA_DETECTED
RATE_LIMITED
QUOTA_EXCEEDED
PROVIDER_RESPONSE_INVALID
VIDEO_NOT_FOUND
METRICS_NOT_AVAILABLE
INSUFFICIENT_DATA
WAITING_FOR_NEXT_SNAPSHOT
AI_NOT_CONFIGURED
AI_RATE_LIMITED
AI_RESPONSE_INVALID
DATABASE_UNAVAILABLE
UNKNOWN_ERROR
```

Mỗi lỗi cần:

- `code`
- `message`
- `provider`
- `timestamp`
- `retryable`
- `recommended_action`

---

## 20. Scheduler và queue

Khuyến nghị:

- Queue cho discovery.
- Queue cho metrics refresh.
- Queue cho scoring.
- Queue cho AI analysis.
- Queue cho clustering.
- Dead-letter queue.
- Retry giới hạn.
- Job idempotency.
- Job timeout.
- Job status.
- Job audit.

Không để collector chạy chồng lặp cùng target nếu job trước chưa hoàn thành.

---

## 21. Bảo mật

Bắt buộc:

- `.env` trong `.gitignore`.
- Không log API key.
- Không gửi secret xuống frontend.
- Mã hóa credential khi lưu.
- RBAC tối thiểu cho admin và reviewer.
- CSRF protection nếu dùng cookie auth.
- Rate limit backend.
- Input validation.
- Output encoding.
- SQL parameterization.
- Dependency audit.
- Secret rotation support.
- Audit log cho thay đổi cấu hình.
- Mask dữ liệu nhạy cảm.
- Không lưu raw cookie nếu không cần thiết.

---

## 22. Observability

Bắt buộc có:

- Structured logging.
- Request ID.
- Job ID.
- Provider name.
- Target ID.
- Video ID.
- Metrics cho success/failure.
- Dashboard health.
- Alert khi collector lỗi liên tiếp.
- Alert khi credential hết hạn.
- Alert khi CAPTCHA xuất hiện.
- Alert khi quota gần hết.
- Không ghi secret vào log.

---

## 23. Testing

Không dùng dữ liệu giả làm nguồn runtime.

Yêu cầu test:

### 23.1. Unit test

- Công thức velocity.
- Acceleration.
- Rate.
- Normalization.
- Trend Score.
- Threshold.
- Fallback khi thiếu metric.
- Validation.
- Mapping schema.

Các test này dùng test vectors cục bộ cho hàm thuần, không seed vào application database.

### 23.2. Integration test

- Chỉ chạy khi có credential test hợp lệ.
- Được đánh dấu riêng.
- Không chạy mặc định trong CI nếu chưa cấu hình.
- Không gọi production provider vượt quota.
- Có timeout.
- Không ghi dữ liệu production.

### 23.3. Database test

- Migration.
- Unique constraint.
- Idempotent upsert.
- Snapshot ordering.
- Transaction rollback.
- Rights status validation.

### 23.4. End-to-end test

Chỉ chạy trên môi trường staging có nguồn dữ liệu hợp lệ.

Không tạo dashboard demo bằng dữ liệu giả.

---

## 24. Deployment

Hỗ trợ Docker.

Tối thiểu:

```text
docker-compose.yml
Dockerfile.api
Dockerfile.dashboard
Dockerfile.worker
.env.example
```

Các service:

```text
postgres
redis
api
worker
dashboard
```

Production phải hỗ trợ:

- Managed PostgreSQL.
- Managed Redis.
- Secret manager.
- HTTPS.
- Backup database.
- Log aggregation.
- Health check.
- Graceful shutdown.
- Migration command.
- Rollback documentation.

---

## 25. File và thư mục phải tạo

```text
README.md
.env.example
.gitignore
docker-compose.yml

docs/
├── architecture.md
├── data-provider.md
├── database.md
├── scoring.md
├── ai-analysis.md
├── trend-clustering.md
├── rights-management.md
├── security.md
├── deployment.md
├── operations.md
├── troubleshooting.md
├── api.md
└── roadmap.md

apps/
├── api/
├── dashboard/
└── worker/

packages/
├── config/
├── database/
├── data-provider/
├── collector/
├── scoring/
├── ai-analysis/
├── trend-clustering/
├── rights-management/
├── observability/
└── shared-types/
```

---

# 26. Yêu cầu chi tiết cho README.md

`README.md` phải là tài liệu bắt đầu nhanh và tài liệu vận hành cơ bản.

## 26.1. Phần mở đầu

Bao gồm:

- Tên dự án.
- Mô tả ngắn.
- Mục tiêu.
- Luồng hệ thống.
- Trạng thái hiện tại.
- Cảnh báo rằng hệ thống không đi kèm API key hoặc quyền truy cập Douyin.

## 26.2. Điều kiện cần trước khi cài

Liệt kê:

- Node.js hoặc runtime được chọn.
- Docker.
- Docker Compose.
- PostgreSQL.
- Redis.
- Credential nguồn dữ liệu thật.
- OpenAI API key nếu bật AI.
- Browser profile nếu dùng browser provider.

## 26.3. Cách cài đặt

Phải có hướng dẫn:

```text
git clone
copy .env.example .env
configure credentials
docker compose up
run migrations
create admin
open dashboard
```

Không hướng dẫn người dùng nhập secret trực tiếp vào source code.

## 26.4. Cấu hình biến môi trường

README phải giải thích từng biến:

```env
APP_ENV=
API_PORT=
DASHBOARD_PORT=
DATABASE_URL=
REDIS_URL=

DATA_PROVIDER=
DOUYIN_API_BASE_URL=
DOUYIN_API_KEY=
DOUYIN_BROWSER_PROFILE_PATH=

OPENAI_API_KEY=
OPENAI_MODEL=

COLLECT_INTERVAL_MINUTES=
COLLECT_BATCH_SIZE=
REQUEST_TIMEOUT_SECONDS=
MAX_RETRY_ATTEMPTS=
```

Với mỗi biến, ghi:

- Bắt buộc hay không.
- Dùng cho module nào.
- Giá trị ví dụ không chứa secret thật.
- Hệ thống phản ứng thế nào khi thiếu.

## 26.5. Cách lấy và cấu hình nguồn dữ liệu

README phải giải thích rõ:

### API provider

- Người dùng phải tự đăng ký.
- Phải kiểm tra provider hỗ trợ Douyin, không chỉ TikTok quốc tế.
- Phải đọc điều khoản sử dụng.
- Phải lấy API key từ dashboard của provider.
- Phải nhập key qua biến môi trường.
- Phải test health check trước khi chạy collector.

### Browser provider

- Người dùng tự tạo tài khoản Douyin.
- Người dùng tự đăng nhập thủ công.
- Không lưu username/password trong code.
- Không chia sẻ cookie.
- Không bypass CAPTCHA.
- Khi session hết hạn phải đăng nhập lại.

### Official or partner API

- Chỉ cấu hình khi có tài liệu và quyền truy cập hợp lệ.
- Không tự đoán endpoint.

## 26.6. Cách thêm provider mới

README phải có hướng dẫn:

1. Implement `DataProvider`.
2. Viết schema mapper.
3. Viết health check.
4. Viết error mapping.
5. Đăng ký provider trong factory.
6. Thêm env config.
7. Thêm documentation.
8. Thêm integration test.
9. Không sửa scoring engine.
10. Không ghi secret vào log.

## 26.7. Cách thêm nguồn theo dõi

Hướng dẫn thêm:

- Creator.
- Keyword.
- Hashtag.
- Music.
- Video URL.

Giải thích cách collector ưu tiên target.

## 26.8. Cách chạy collector

README phải có:

- Chạy tự động.
- Chạy thủ công.
- Chạy một target.
- Kiểm tra trạng thái.
- Xem collector run.
- Xử lý retry.
- Dừng collector.

## 26.9. Cách hiểu điểm số

Giải thích:

- Velocity.
- Acceleration.
- Engagement.
- Vietnam Fit.
- Affiliate Potential.
- Trend Score.
- Confidence.
- Recommendation status.
- Insufficient data.

## 26.10. Cách cấu hình scoring

Hướng dẫn:

- Chỉnh trọng số.
- Chỉnh ngưỡng.
- Version scoring.
- Rollback.
- Xem audit log.
- Không chỉnh tổng trọng số vượt 100%.

## 26.11. Cấu hình AI

Hướng dẫn:

- Tạo tài khoản API AI.
- Tạo API key.
- Lưu key vào backend.
- Chọn model.
- Đặt budget.
- Theo dõi usage.
- Tắt AI.
- Xử lý rate limit.
- Xử lý invalid response.

Không đưa key vào frontend.

## 26.12. Quyền sử dụng video

README phải nêu rõ:

- Video công khai không đồng nghĩa được quyền đăng lại.
- Quyền truy cập dữ liệu khác với quyền sử dụng nội dung.
- Phải xin phép hoặc có license khi cần.
- Phải lưu bằng chứng.
- Hệ thống không thay thế tư vấn pháp lý.
- Không tự động đăng khi quyền chưa rõ.

## 26.13. Bảo mật

Hướng dẫn:

- Không commit `.env`.
- Rotate key.
- Mask secret.
- Sử dụng secret manager.
- Bảo vệ browser profile.
- Không gửi cookie qua chat hoặc issue.
- Kiểm tra audit log.
- Backup database.

## 26.14. Troubleshooting

README phải có bảng lỗi:

| Error code | Ý nghĩa | Cách xử lý |
|---|---|---|
| DATA_SOURCE_NOT_CONFIGURED | Chưa cấu hình nguồn dữ liệu | Cấu hình provider và credential |
| INVALID_CREDENTIALS | Credential sai hoặc hết hạn | Kiểm tra hoặc tạo key mới |
| LOGIN_REQUIRED | Browser profile chưa đăng nhập | Mở browser và đăng nhập thủ công |
| SESSION_EXPIRED | Session hết hạn | Đăng nhập lại |
| CAPTCHA_DETECTED | Douyin yêu cầu xác minh | Dừng collector và xác minh thủ công |
| RATE_LIMITED | Provider giới hạn request | Giảm tần suất hoặc chờ reset |
| QUOTA_EXCEEDED | Hết quota | Nâng gói hoặc chờ chu kỳ mới |
| INSUFFICIENT_DATA | Chưa đủ snapshot | Chờ lần thu thập tiếp theo |
| AI_NOT_CONFIGURED | Chưa có API AI | Cấu hình key hoặc tắt AI |

## 26.15. Backup và restore

README hoặc `docs/operations.md` phải có:

- Backup PostgreSQL.
- Restore PostgreSQL.
- Backup config.
- Không backup secret vào repository.
- Kiểm tra backup định kỳ.

## 26.16. Cách phát triển thêm chức năng

README phải liệt kê extension points:

- Thêm provider video mới.
- Thêm TikTok hoặc nền tảng khác.
- Thêm affiliate provider.
- Thêm product matching.
- Thêm OCR.
- Thêm speech-to-text.
- Thêm translation provider.
- Thêm notification.
- Thêm workflow biên tập.
- Thêm YouTube publisher sau khi có approval.
- Thêm analytics hiệu quả video đã đăng.

Mỗi extension phải giữ nguyên nguyên tắc:

- Không phá interface hiện tại.
- Không hard-code secret.
- Không tự động publish khi chưa phê duyệt.
- Không dùng dữ liệu giả làm nguồn runtime.
- Có migration và documentation.

## 26.17. Roadmap

README phải liên kết tới `docs/roadmap.md`.

Roadmap đề xuất:

### Phase 1

- Data provider thật.
- Collector.
- Database.
- Snapshot.
- Scoring cơ bản.
- Dashboard trạng thái.

### Phase 2

- AI analysis.
- Vietnam Fit.
- Affiliate Potential.
- Trend clustering.
- Rights management.

### Phase 3

- Product matching.
- Affiliate catalog.
- Workflow biên tập.
- Human approval nâng cao.
- Notification.

### Phase 4

- Kết nối YouTube.
- Theo dõi hiệu quả video đã đăng.
- Học lại trọng số scoring từ kết quả thực tế.
- Multi-platform support.

---

## 27. Acceptance Criteria

Hệ thống được xem là hoàn thành phiên bản đầu khi:

1. Có thể khởi động mà không tạo dữ liệu giả.
2. Khi chưa có provider, dashboard hiển thị `DATA_SOURCE_NOT_CONFIGURED`.
3. Có thể cấu hình một provider thật.
4. Health check provider hoạt động.
5. Có thể thêm creator, keyword, hashtag, music hoặc video URL.
6. Collector lấy được video thật từ provider.
7. Dữ liệu được lưu đúng schema.
8. Cùng một video có nhiều snapshot theo thời gian.
9. Hệ thống tính được velocity.
10. Hệ thống tính được acceleration khi đủ snapshot.
11. Không tạo trùng dữ liệu khi retry.
12. Trend Score chỉ xuất hiện khi đủ dữ liệu.
13. Dashboard hiển thị lý do đề xuất.
14. AI analysis chỉ chạy khi có API key.
15. Không có API key thì hiển thị `AI_NOT_CONFIGURED`, không tạo kết quả giả.
16. Người dùng có thể approve hoặc reject video.
17. Hệ thống lưu usage rights.
18. Không cho chuyển sang workflow xuất bản nếu quyền chưa phù hợp.
19. Secret không xuất hiện trong frontend hoặc log.
20. README hướng dẫn đầy đủ cài đặt, cấu hình, provider, AI, security, troubleshooting và mở rộng.

---

## 28. Chỉ dẫn trực tiếp cho Codex

Hãy thực hiện theo thứ tự:

1. Đọc toàn bộ tài liệu này.
2. Đề xuất stack kỹ thuật và giải thích ngắn gọn.
3. Tạo architecture.
4. Tạo database schema và migration.
5. Tạo interface `DataProvider`.
6. Không tạo `MockDataProvider`.
7. Tạo `ThirdPartyApiProvider`.
8. Tạo cấu trúc `AuthorizedBrowserProvider`, chỉ dùng đăng nhập thủ công.
9. Tạo collector và scheduler.
10. Tạo scoring engine.
11. Tạo AI analysis service.
12. Tạo trend clustering.
13. Tạo rights management.
14. Tạo backend API.
15. Tạo dashboard.
16. Tạo Docker configuration.
17. Tạo `.env.example`.
18. Tạo README và toàn bộ tài liệu trong `docs/`.
19. Tạo test.
20. Chạy lint, type check, unit test và build.
21. Báo rõ phần nào cần credential thật để kiểm thử.
22. Không tự bịa endpoint Douyin.
23. Không tự bịa API key.
24. Không tự tạo dữ liệu runtime giả.
25. Không tự động bypass CAPTCHA.
26. Không tự động publish video.
27. Không ghi secret vào repository.
28. Ghi lại các quyết định kiến trúc trong `docs/architecture.md`.

Khi chưa có API documentation cụ thể, hãy:

- Hoàn thiện interface.
- Hoàn thiện configuration.
- Hoàn thiện adapter skeleton.
- Hoàn thiện validation.
- Hoàn thiện error handling.
- Không giả định JSON response.
- Để mapping theo provider ở module riêng.
- Ghi rõ các thông tin người dùng cần bổ sung trong README.

---

## 29. Kết quả Codex phải bàn giao

Codex phải bàn giao:

- Source code đầy đủ.
- Migration database.
- Backend API.
- Dashboard.
- Worker.
- Data provider interface.
- Provider adapter.
- Scoring engine.
- AI analysis.
- Trend clustering.
- Rights management.
- Docker configuration.
- `.env.example`.
- `README.md`.
- Tài liệu trong `docs/`.
- Test.
- Báo cáo build.
- Danh sách credential còn thiếu.
- Danh sách phần chưa thể kiểm thử do thiếu quyền truy cập thật.
- Danh sách rủi ro kỹ thuật và pháp lý.
