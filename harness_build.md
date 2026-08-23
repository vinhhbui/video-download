# AGENT SYSTEM WITH HARNESS & MCP — CODEX BUILD SPECIFICATION

## 1. Mục tiêu

Xây dựng một Agent System phục vụ hệ thống **Douyin Trend Insight & Content Operations** đã được mô tả trong file:

```text
DOUYIN_TREND_INSIGHT_CODEX_SPEC.md
```

Agent System phải sử dụng kiến trúc:

```text
Foundation Model
        +
Agent Harness
        +
MCP Gateway / Tool Registry
        +
Memory
        +
Policy & Guardrails
        +
Human Approval
        +
Observability & Audit
```

Hệ thống không chỉ là chatbot. Agent phải có khả năng:

- Nhận mục tiêu nghiệp vụ.
- Lập kế hoạch nhiều bước.
- Chọn đúng tool.
- Gọi tool qua MCP.
- Quan sát kết quả.
- Kiểm tra dữ liệu và rủi ro.
- Tự điều chỉnh kế hoạch khi tool lỗi.
- Dừng và yêu cầu người dùng phê duyệt trước hành động rủi ro.
- Ghi trace đầy đủ.
- Không tự đăng video hoặc thực hiện hành động thương mại khi chưa được duyệt.

Vòng lặp cốt lõi:

```text
Perceive
   ↓
Plan
   ↓
Select Tool
   ↓
Policy Check
   ↓
Act
   ↓
Observe
   ↓
Validate
   ↓
Update State
   ↓
Continue / Re-plan / Ask Approval / Stop
```

---

# 2. Công cụ và nền tảng hiện có

Thiết kế ưu tiên các công cụ người dùng đã có hoặc đang sử dụng/cân nhắc.

## 2.1. Runtime và AI

- OpenAI API credits.
- QwenCloud credits làm model phụ hoặc fallback.
- Codex dùng để phát triển code, không phải runtime agent.
- Kiro có thể dùng hỗ trợ phát triển, không phải runtime bắt buộc.

## 2.2. Cloud và hosting

- AWS credits:
  - ECS hoặc EC2 cho API, worker và MCP servers.
  - RDS PostgreSQL.
  - ElastiCache Redis.
  - S3 cho artifact, video metadata, evidence và report.
  - CloudWatch cho hạ tầng nếu cần.
- Netlify:
  - Triển khai frontend/dashboard.
  - Không chạy worker dài hạn hoặc MCP server trên Netlify.
- ClickHouse Cloud:
  - Lưu event, tool-call telemetry, agent traces dạng analytics và dữ liệu hiệu năng lớn.
- Bright Data:
  - Nguồn thu thập dữ liệu web hợp lệ khi có API/dataset phù hợp.
  - Chỉ dùng theo điều khoản và credential hợp lệ.

## 2.3. Workflow, observability và productivity

- n8n self-hosted:
  - Dùng cho workflow định kỳ, webhook và automation xác định trước.
  - Không thay thế Agent Harness.
- Langfuse:
  - Trace LLM, prompt, tool calls, token usage, evaluation.
  - Không dùng làm nơi host toàn bộ agent.
- GitHub:
  - Source code, issue, pull request và CI/CD.
- Todoist:
  - Tạo task cho con người sau khi agent đề xuất hoặc phát hiện vấn đề.
- Gmail:
  - Gửi draft/email sau approval.
- Google Calendar:
  - Tạo lịch hoặc deadline sau approval.
- Google Drive:
  - Lưu tài liệu, report hoặc evidence khi được cấu hình.
- Google Contacts:
  - Tìm contact cho hành động Gmail/Calendar.
- Canva:
  - Có thể bổ sung ở giai đoạn content production, không bắt buộc cho MVP.

## 2.4. Nguyên tắc sử dụng tool

- Không giả định tool đã có credential.
- Không hard-code key.
- Không tự cài tool ngoài danh sách nếu chưa được người dùng phê duyệt.
- Mỗi tool phải có manifest, quyền, timeout, retry và side-effect level.
- Tool ghi dữ liệu phải có approval gate.
- Tool có tác động ngoài hệ thống phải có audit log.

---

# 3. Phạm vi Agent System

## 3.1. Trong phạm vi

- Điều phối việc thu thập insight.
- Yêu cầu collector chạy lại.
- Truy vấn video, metrics và trend cluster.
- Phân tích lý do video tăng trưởng.
- Đề xuất video nên xử lý.
- Đề xuất hook, tiêu đề, caption và affiliate keyword.
- Kiểm tra trạng thái quyền sử dụng.
- Tạo content brief.
- Tạo task Todoist.
- Tạo email draft xin phép creator.
- Tạo lịch review hoặc deadline.
- Tạo report.
- Ghi trace, memory và audit.
- Gọi workflow n8n đã đăng ký.
- Chuyển công việc sang con người phê duyệt.

## 3.2. Ngoài phạm vi MVP

- Tự động đăng video lên YouTube.
- Tự động tải video khi chưa có quyền.
- Xóa watermark.
- Tự động gửi email thật mà không có approval.
- Tự động tạo lịch mà không có approval.
- Tự động mua sản phẩm.
- Tự động đổi credential.
- Tự động phá CAPTCHA.
- Tự động né rate limit.
- Tự động truy cập dữ liệu riêng tư.
- Tự xác nhận quyền sử dụng nội dung.
- Cho agent shell access toàn quyền.

---

# 4. Kiến trúc tổng thể

```text
┌─────────────────────────────────────────────────────────────┐
│                        Netlify Dashboard                    │
│ Chat / Review / Approval / Trace / Settings / Reports      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent API & Harness                      │
│                                                             │
│  Session Manager                                            │
│  Context Builder                                            │
│  Planner                                                    │
│  Tool Selector                                              │
│  Policy Engine                                              │
│  Approval Manager                                           │
│  State Machine                                              │
│  Retry / Recovery                                           │
│  Memory Manager                                             │
│  Response Composer                                          │
└──────────────┬───────────────────────┬──────────────────────┘
               │                       │
               │ MCP                   │ Trace / Events
               ▼                       ▼
┌───────────────────────────┐   ┌──────────────────────────────┐
│ MCP Gateway & Registry    │   │ Langfuse + ClickHouse       │
│                           │   │ Trace / Cost / Evaluation    │
│ Auth / Scope / Timeout    │   │ Tool analytics / SLA        │
│ Retry / Circuit Breaker   │   └──────────────────────────────┘
└──────────────┬────────────┘
               │
     ┌─────────┼─────────────────────────────────────────────┐
     │         │          │          │        │       │       │
     ▼         ▼          ▼          ▼        ▼       ▼       ▼
 Douyin     Bright     Database     S3/     Todoist Gmail   GitHub
 Insight    Data       MCP          Drive    MCP     MCP     MCP
 MCP        MCP                     MCP

               ┌─────────────────────────────────────────────┐
               │ n8n Workflow MCP / Webhook Adapter          │
               │ Deterministic jobs, schedules, notifications│
               └─────────────────────────────────────────────┘
```

---

# 5. Agent Harness

Harness là lớp bắt buộc bao quanh model.

## 5.1. Thành phần

### 5.1.1. Session Manager

Quản lý:

- User session.
- Conversation ID.
- Current objective.
- Active workflow.
- User role.
- Pending approvals.
- Expiration.
- Correlation ID.

### 5.1.2. Context Builder

Chỉ đưa vào model dữ liệu cần thiết.

Nguồn context:

- User request.
- Workflow state.
- Relevant video and trend records.
- Tool results.
- Approved memories.
- Policy.
- Current permissions.
- Evidence references.

Không đưa toàn bộ database hoặc raw telemetry vào context.

### 5.1.3. Planner

Planner phải tạo kế hoạch có cấu trúc:

```json
{
  "objective": "",
  "assumptions": [],
  "steps": [
    {
      "id": "",
      "description": "",
      "required_tool": "",
      "dependencies": [],
      "risk_level": "low | medium | high",
      "approval_required": false
    }
  ],
  "success_criteria": [],
  "stop_conditions": []
}
```

Planner phải áp dụng:

- Phân tích dependency.
- Suy luận nguyên nhân có khả năng nhất.
- Không loại bỏ sớm giả thuyết ít khả năng.
- Kiểm tra rủi ro trước hành động.
- Phân biệt dữ liệu thiếu với dữ liệu mâu thuẫn.
- Không tiếp tục khi điều kiện an toàn chưa đủ.

### 5.1.4. State Machine

Trạng thái đề xuất:

```text
RECEIVED
CONTEXT_BUILDING
PLANNING
WAITING_FOR_TOOL
TOOL_RUNNING
OBSERVING
VALIDATING
REPLANNING
WAITING_FOR_APPROVAL
COMPLETED
FAILED
CANCELLED
```

Không để agent chạy loop vô hạn.

Giới hạn:

```env
AGENT_MAX_STEPS=12
AGENT_MAX_TOOL_CALLS=20
AGENT_MAX_REPLANS=3
AGENT_MAX_RUNTIME_SECONDS=300
```

### 5.1.5. Tool Selector

Tool Selector chỉ được chọn tool:

- Có trong Tool Registry.
- Được bật.
- Có permission phù hợp.
- Có input schema hợp lệ.
- Không vượt side-effect policy.
- Không bị circuit breaker chặn.
- Có credential hợp lệ.

### 5.1.6. Policy Engine

Policy Engine kiểm tra trước và sau tool call.

Pre-action checks:

- Tool được phép không.
- Role có quyền không.
- Dữ liệu đầu vào hợp lệ không.
- Có chứa secret không.
- Có prompt injection từ nguồn ngoài không.
- Có yêu cầu approval không.
- Có vi phạm rights policy không.

Post-action checks:

- Output có đúng schema không.
- Có dữ liệu nhạy cảm không.
- Có dấu hiệu tool error không.
- Có evidence không.
- Có cần rollback không.
- Có được ghi memory không.

### 5.1.7. Approval Manager

Approval levels:

```text
NONE
REVIEW
CONFIRM
DUAL_APPROVAL
BLOCKED
```

Ví dụ:

- Query database read-only: `NONE`.
- Tạo Todoist task: `CONFIRM`.
- Tạo Gmail draft: `CONFIRM`.
- Gửi email: `DUAL_APPROVAL` hoặc action riêng.
- Tạo Google Calendar event: `CONFIRM`.
- Chuyển video sang editing: `CONFIRM`.
- Publish content: `BLOCKED` trong MVP.
- Ghi usage rights: `CONFIRM`.
- Xóa dữ liệu: `DUAL_APPROVAL`.

Approval object:

```json
{
  "approval_id": "",
  "workflow_id": "",
  "action": "",
  "tool": "",
  "input_summary": "",
  "risk_level": "",
  "expires_at": "",
  "status": "pending | approved | rejected | expired",
  "approved_by": ""
}
```

### 5.1.8. Retry & Recovery

Mỗi tool có:

- Timeout.
- Max retry.
- Retryable error list.
- Backoff.
- Circuit breaker.
- Fallback tool.
- Rollback policy.

Không retry:

- Invalid credential.
- Permission denied.
- CAPTCHA.
- Explicit rejection.
- Rights blocked.
- Invalid user input không thể sửa tự động.

### 5.1.9. Response Composer

Kết quả cuối phải phân biệt:

- Fact lấy từ tool.
- AI inference.
- Assumption.
- Recommendation.
- Pending action.
- Error.
- Evidence.

---

# 6. MCP Architecture

## 6.1. MCP Gateway

Tạo một MCP Gateway trung tâm.

Chức năng:

- Đăng ký MCP server.
- Tool discovery.
- Authentication.
- Role-based scope.
- Request validation.
- Timeout.
- Rate limit.
- Retry.
- Circuit breaker.
- Tool-call logging.
- Redaction.
- Approval enforcement.
- Health check.

Không cho model kết nối trực tiếp tới từng service.

## 6.2. Tool Manifest

Mỗi tool bắt buộc có manifest:

```yaml
name: douyin.search_trending_videos
server: douyin-insight-mcp
description: Search real Douyin insight records
version: 1.0.0
input_schema: {}
output_schema: {}
auth_scope:
  - trend.read
side_effect_level: none
approval_level: none
timeout_seconds: 30
max_retries: 2
retry_policy: exponential_backoff
rollback_policy: none
data_classification:
  - public_metadata
allowed_roles:
  - admin
  - analyst
logging:
  redact_fields:
    - api_key
    - cookie
```

## 6.3. Side-effect level

```text
none
internal_write
external_draft
external_write
destructive
```

## 6.4. MCP Server bắt buộc

### 6.4.1. Douyin Insight MCP

Bọc backend của hệ thống Douyin Trend Insight.

Tools:

```text
douyin.get_system_status
douyin.list_tracked_targets
douyin.create_tracked_target
douyin.run_collection
douyin.search_videos
douyin.get_video
douyin.get_video_metrics
douyin.get_video_score
douyin.get_video_analysis
douyin.list_trend_clusters
douyin.get_trend_cluster
douyin.recalculate_score
douyin.request_ai_analysis
douyin.get_usage_rights
douyin.update_usage_rights
douyin.approve_for_editing
douyin.reject_video
```

Quyền:

- Read tools: analyst.
- Collector run: operator.
- Update rights: reviewer/admin.
- Approve editing: reviewer/admin.

### 6.4.2. Bright Data MCP

Dùng Bright Data API hoặc dataset hợp lệ.

Tools phụ thuộc tài liệu API thật:

```text
brightdata.check_connection
brightdata.run_allowed_collection
brightdata.get_job_status
brightdata.get_result
```

Quy tắc:

- Không tự đoán endpoint.
- Không tạo tool nếu chưa có API docs.
- Không bypass anti-bot.
- Không dùng cho dữ liệu riêng tư.
- Ghi quota và cost.
- Không log credential.

### 6.4.3. Database MCP

Chỉ cung cấp truy vấn an toàn.

Tools:

```text
db.query_readonly
db.get_video_timeseries
db.get_cluster_metrics
db.get_agent_memory
db.write_agent_checkpoint
```

Không cung cấp SQL tùy ý cho model trong production.

Yêu cầu:

- Query templates.
- Parameterized input.
- Row limit.
- Timeout.
- Read replica nếu cần.
- Block DDL và destructive SQL.

### 6.4.4. ClickHouse Analytics MCP

Tools:

```text
analytics.get_tool_usage
analytics.get_agent_latency
analytics.get_failure_rate
analytics.get_cost_summary
analytics.get_trend_performance
analytics.get_content_outcome
```

ClickHouse dùng cho analytics, không thay thế PostgreSQL transaction database.

### 6.4.5. Storage MCP

AWS S3 hoặc Google Drive.

Tools:

```text
storage.create_evidence_reference
storage.upload_report
storage.get_signed_download_url
storage.list_project_artifacts
storage.get_artifact_metadata
```

Quy tắc:

- Không đưa raw file lớn vào context.
- Trả về `evidence_ref`.
- Signed URL có expiry.
- Quét file type.
- Không public bucket mặc định.

### 6.4.6. Todoist MCP

Tools:

```text
todoist.create_task
todoist.update_task
todoist.complete_task
todoist.list_project_tasks
```

Use cases:

- Tạo task xin phép creator.
- Tạo task review video.
- Tạo task kiểm tra affiliate product.
- Tạo task xử lý provider error.

Mọi internal write cần approval.

### 6.4.7. Gmail MCP

Tools:

```text
gmail.search_messages
gmail.read_thread
gmail.create_draft
gmail.send_draft
```

Quy tắc:

- Read thread trước khi reply.
- Tạo draft trước.
- Gửi email là external write.
- Không gửi khi chưa có approval.
- Không tự bịa email creator.

### 6.4.8. Google Calendar MCP

Tools:

```text
calendar.search_events
calendar.create_event
calendar.update_event
calendar.delete_event
```

Use cases:

- Lịch review content.
- Deadline xin quyền.
- Lịch kiểm tra trend.
- Lịch campaign affiliate.

Tạo/sửa/xóa cần approval.

### 6.4.9. Google Contacts MCP

Tools:

```text
contacts.search
contacts.get
```

Read-only.

### 6.4.10. GitHub MCP

Tools:

```text
github.get_repository
github.list_issues
github.create_issue
github.get_pull_request
github.comment_on_issue
```

Use cases:

- Tạo issue khi collector lỗi.
- Ghi technical debt.
- Theo dõi implementation.
- Không tự merge code trong MVP.

### 6.4.11. n8n Workflow MCP

Tools:

```text
n8n.list_registered_workflows
n8n.run_workflow
n8n.get_execution
n8n.cancel_execution
```

Chỉ gọi workflow đã allowlist.

Ví dụ:

- Daily report.
- Provider health notification.
- Content review notification.
- Export approved content brief.
- Sync task.

Không cho agent tự tạo workflow n8n mới trong production.

---

# 7. Agent Roles

## 7.1. Supervisor Agent

Trách nhiệm:

- Nhận mục tiêu.
- Chọn workflow.
- Chia nhiệm vụ.
- Kiểm tra dependency.
- Tổng hợp kết quả.
- Không tự thực hiện external write.

## 7.2. Trend Scout Agent

Tools:

- Douyin Insight MCP.
- Bright Data MCP.
- Database MCP.

Nhiệm vụ:

- Tìm video đang tăng.
- Tìm cluster mới.
- So sánh velocity.
- Phát hiện dữ liệu thiếu.
- Yêu cầu refresh khi cần.

## 7.3. Insight Analyst Agent

Tools:

- Douyin Insight MCP.
- Database MCP.
- ClickHouse MCP.
- OpenAI/Qwen model.

Nhiệm vụ:

- Giải thích xu hướng.
- Đánh giá confidence.
- So sánh với baseline.
- Không coi correlation là causation.
- Tách dữ liệu và suy luận.

## 7.4. Localization Agent

Tools:

- AI model.
- Storage MCP.
- Douyin Insight MCP.

Nhiệm vụ:

- Dịch caption.
- Tạo hook.
- Tạo title.
- Tạo caption.
- Đánh giá mức phụ thuộc văn hóa.
- Không tự tải hoặc sửa video.

## 7.5. Affiliate Agent

Tools:

- Douyin Insight MCP.
- Affiliate adapter tương lai.
- Database MCP.

Nhiệm vụ:

- Nhận diện sản phẩm.
- Tạo keyword Việt/Trung.
- Đánh giá khả năng chuyển đổi.
- Không bịa giá, hoa hồng hoặc sản phẩm có sẵn.

## 7.6. Rights & Compliance Agent

Tools:

- Douyin Insight MCP.
- Gmail MCP.
- Storage MCP.
- Todoist MCP.

Nhiệm vụ:

- Kiểm tra trạng thái quyền.
- Tạo email draft xin phép.
- Tạo task follow-up.
- Lưu evidence sau approval.
- Không kết luận pháp lý cuối cùng.

## 7.7. Content Operations Agent

Tools:

- Todoist MCP.
- Calendar MCP.
- n8n MCP.
- Storage MCP.

Nhiệm vụ:

- Tạo content brief.
- Tạo task.
- Lập lịch review.
- Chuyển approved brief sang workflow.
- Không publish trong MVP.

## 7.8. Reliability Agent

Tools:

- ClickHouse MCP.
- Langfuse API/internal trace.
- GitHub MCP.
- Todoist MCP.

Nhiệm vụ:

- Phát hiện tool lỗi.
- Tìm recurring failure.
- Tạo issue hoặc task sau approval.
- Đề xuất thay đổi timeout/retry.
- Không tự thay production config.

---

# 8. Multi-agent Orchestration

Khuyến nghị dùng:

- LangGraph hoặc state machine tương đương.
- Không dùng multi-agent tự do không giới hạn.
- Supervisor điều phối.
- Mỗi specialist có tool scope riêng.
- Shared state có schema.

Shared state:

```json
{
  "workflow_id": "",
  "objective": "",
  "video_ids": [],
  "cluster_ids": [],
  "facts": [],
  "hypotheses": [],
  "evidence_refs": [],
  "tool_results": [],
  "risks": [],
  "pending_approvals": [],
  "decisions": [],
  "next_actions": [],
  "status": ""
}
```

Handoff object:

```json
{
  "from_agent": "",
  "to_agent": "",
  "task": "",
  "input_refs": [],
  "expected_output_schema": {},
  "deadline": "",
  "risk_level": ""
}
```

---

# 9. Memory System

## 9.1. Working Memory

Lưu:

- Current plan.
- Tool results.
- Current hypotheses.
- Pending approvals.
- Temporary state.

Storage:

- Redis.
- TTL bắt buộc.

## 9.2. Episodic Memory

Lưu:

- Workflow outcome.
- User decision.
- Approved/rejected recommendation.
- Tool failure.
- Recovery path.
- Evidence refs.

Storage:

- PostgreSQL.
- Có retention.

## 9.3. Semantic Memory

Lưu:

- Stable project rules.
- Scoring definitions.
- Content policy.
- Tool documentation.
- Creator agreements.
- Lessons learned đã được duyệt.

Có thể dùng:

- PostgreSQL + vector extension.
- Qdrant/Milvus ở giai đoạn sau nếu cần.

## 9.4. Procedural Memory / Skill Library

Skill:

- Investigate fast-growing video.
- Compare trend clusters.
- Generate content brief.
- Request creator permission.
- Create review task.
- Diagnose provider failure.
- Prepare daily report.

Mỗi skill phải có:

```yaml
name:
version:
purpose:
inputs:
outputs:
allowed_tools:
preconditions:
approval_points:
failure_modes:
rollback:
evaluation:
```

## 9.5. Memory Governance

- Không lưu raw secret.
- Không lưu cookie.
- Không tự ghi mọi tool result thành memory.
- Chỉ lưu thông tin có giá trị lâu dài.
- Có source và timestamp.
- Có confidence.
- Có delete/expire.
- Memory có thể bị review.
- Không dùng dữ liệu từ video độc hại để sửa policy.

---

# 10. Context Engineering

Context package:

```json
{
  "system_policy": {},
  "user_objective": {},
  "workflow_state": {},
  "relevant_memory": [],
  "tool_catalog": [],
  "evidence": [],
  "constraints": [],
  "output_schema": {}
}
```

Quy tắc:

- Ưu tiên evidence gần nhất.
- Không đưa toàn bộ transcript.
- Không đưa toàn bộ tool list nếu không liên quan.
- Tách untrusted content.
- Gắn provenance.
- Giới hạn token.
- Tóm tắt dữ liệu lớn bằng tool trước.
- Raw video/telemetry lưu ở storage, context chỉ chứa `evidence_ref`.

---

# 11. Guardrails và Security

## 11.1. Prompt Injection

Mọi dữ liệu từ:

- Caption.
- Comment.
- Website.
- Email.
- File.
- Creator message.

được xem là untrusted.

Không cho nội dung ngoài thay đổi:

- System policy.
- Tool permissions.
- Approval policy.
- Secret handling.
- Agent identity.

## 11.2. Least Privilege

Mỗi agent có:

- Tool allowlist.
- Data scope.
- Action scope.
- Credential riêng nếu cần.
- Expiry.
- Rate limit.

Không dùng một credential toàn quyền cho mọi tool.

## 11.3. Sandbox

Code execution nếu bổ sung phải:

- Chạy container cô lập.
- Không network mặc định.
- Read-only filesystem khi có thể.
- CPU/memory/time limit.
- Không mount secrets.
- Không có Docker socket.
- Không shell production host.

## 11.4. Data Classification

```text
PUBLIC
INTERNAL
CONFIDENTIAL
SECRET
```

Ví dụ:

- Public video metrics: `PUBLIC`.
- Agent workflow state: `INTERNAL`.
- Creator permission evidence: `CONFIDENTIAL`.
- API key/cookie: `SECRET`.

## 11.5. Audit

Ghi:

- User.
- Agent.
- Tool.
- Input hash.
- Output hash.
- Approval.
- Timestamp.
- Side effect.
- Error.
- Evidence ref.
- Model.
- Prompt version.

---

# 12. Observability

## 12.1. Langfuse

Trace:

- User request.
- Planner output.
- Agent handoff.
- LLM call.
- Tool call.
- Tool latency.
- Token usage.
- Cost.
- Error.
- Approval wait.
- Final answer.
- Evaluation score.

Không ghi secret hoặc cookie.

## 12.2. ClickHouse

Event schema:

```text
event_id
trace_id
workflow_id
agent_name
tool_name
event_type
status
latency_ms
input_tokens
output_tokens
estimated_cost
error_code
created_at
metadata_json
```

Dashboard:

- Success rate.
- Tool failure rate.
- Average workflow latency.
- Cost per workflow.
- Approval waiting time.
- Replan rate.
- Hallucination/evidence failure.
- Trend recommendation outcome.

## 12.3. Evaluation

Offline:

- Tool selection accuracy.
- Plan completeness.
- Evidence coverage.
- Schema validity.
- Safety policy adherence.

Online:

- User approval rate.
- Recommendation acceptance.
- False positive trend rate.
- Time saved.
- Cost per approved content brief.
- Tool error recovery rate.

---

# 13. Model Routing

## 13.1. OpenAI

Ưu tiên cho:

- Planning.
- Complex synthesis.
- Vietnamese localization.
- Structured output.
- Tool selection.

## 13.2. QwenCloud

Dùng cho:

- Chinese understanding.
- Translation comparison.
- Lower-cost batch classification.
- Fallback khi được cấu hình.

## 13.3. Routing Rules

Model router dựa trên:

- Task type.
- Language.
- Cost limit.
- Latency.
- Required schema reliability.
- Provider availability.
- Data sensitivity.

Không tự gửi confidential data sang provider chưa được cho phép.

Config:

```env
PRIMARY_MODEL_PROVIDER=openai
PRIMARY_MODEL=
SECONDARY_MODEL_PROVIDER=qwen
SECONDARY_MODEL=
MODEL_MAX_COST_PER_WORKFLOW=
MODEL_TIMEOUT_SECONDS=
```

---

# 14. Workflow mẫu

## 14.1. Discover Trending Videos

```text
User requests trend report
        ↓
Supervisor creates plan
        ↓
Trend Scout queries Douyin Insight MCP
        ↓
If stale data, request collector refresh
        ↓
Wait for real collector result
        ↓
Insight Analyst compares velocity and acceleration
        ↓
Affiliate Agent evaluates product potential
        ↓
Rights Agent checks rights status
        ↓
Supervisor composes ranked report
```

## 14.2. Prepare Content Brief

```text
User selects video
        ↓
Check Trend Score
        ↓
Check AI analysis
        ↓
Check rights status
        ↓
Localization Agent creates brief
        ↓
Affiliate Agent adds keywords
        ↓
Human approval
        ↓
Storage MCP saves brief
        ↓
Todoist MCP creates editing task
```

## 14.3. Request Creator Permission

```text
Rights Agent checks creator contact
        ↓
Contacts/Gmail search if authorized
        ↓
Create draft email
        ↓
Human reviews draft
        ↓
Approval
        ↓
Send draft
        ↓
Create follow-up task
        ↓
Update rights status to requested
```

## 14.4. Provider Failure Recovery

```text
Collector fails
        ↓
Reliability Agent reads trace
        ↓
Classify error
        ↓
No retry for CAPTCHA/invalid credentials
        ↓
Create admin task
        ↓
Create GitHub issue if code defect
        ↓
Notify dashboard
```

---

# 15. n8n Boundary

n8n dùng cho deterministic automation:

- Schedule daily report.
- Send notification.
- Export report.
- Trigger registered workflow.
- Sync approved tasks.
- Handle webhook.

Harness dùng cho:

- Reasoning.
- Planning.
- Tool selection.
- Risk assessment.
- Replanning.
- Human approval.
- Evidence-based recommendation.

Không nhét toàn bộ agent logic vào n8n.

Không cho agent:

- Tạo arbitrary n8n workflow.
- Thay credential n8n.
- Chạy workflow không allowlist.

---

# 16. Backend API

## 16.1. Agent

```text
POST   /api/agent/runs
GET    /api/agent/runs/:id
POST   /api/agent/runs/:id/cancel
GET    /api/agent/runs/:id/events
GET    /api/agent/runs/:id/trace
```

## 16.2. Approval

```text
GET    /api/approvals
GET    /api/approvals/:id
POST   /api/approvals/:id/approve
POST   /api/approvals/:id/reject
```

## 16.3. MCP

```text
GET    /api/mcp/servers
GET    /api/mcp/tools
POST   /api/mcp/servers/:id/health-check
PATCH  /api/mcp/tools/:id/policy
```

## 16.4. Skills

```text
GET    /api/skills
GET    /api/skills/:id
POST   /api/skills/:id/run
POST   /api/skills/:id/validate
```

## 16.5. Memory

```text
GET    /api/memory/episodes
GET    /api/memory/semantic
DELETE /api/memory/:id
POST   /api/memory/:id/review
```

## 16.6. Evaluation

```text
GET    /api/evaluations
POST   /api/evaluations/run
GET    /api/evaluations/:id
```

---

# 17. Dashboard

## 17.1. Agent Workspace

- Chat.
- Objective.
- Current plan.
- Running step.
- Tool calls.
- Evidence.
- Pending approval.
- Final result.

## 17.2. Approval Center

- Action.
- Tool.
- Input summary.
- Risk.
- Side effect.
- Evidence.
- Expiration.
- Approve/reject.

## 17.3. MCP Registry

- Server status.
- Tool list.
- Permission.
- Side-effect level.
- Last call.
- Error rate.
- Latency.
- Cost.
- Enable/disable.

## 17.4. Trace Explorer

- Workflow timeline.
- Agent handoff.
- LLM spans.
- Tool spans.
- Errors.
- Retry.
- Approval wait.
- Cost.
- Evidence refs.

## 17.5. Memory Console

- Working memory.
- Episodic memory.
- Semantic memory.
- Procedural skills.
- Source.
- Confidence.
- Expiration.
- Delete/review.

## 17.6. Policy Settings

- Role.
- Tool scope.
- Approval level.
- Max steps.
- Max cost.
- Timeout.
- Data classification.
- Allowed models.
- Feature flags.

---

# 18. Database Schema bổ sung

## 18.1. `agent_runs`

```text
id
user_id
objective
status
current_step
max_steps
model_provider
model_name
started_at
finished_at
error_code
error_message
created_at
updated_at
```

## 18.2. `agent_steps`

```text
id
run_id
step_number
agent_name
step_type
description
status
input_json
output_json
evidence_refs_json
started_at
finished_at
created_at
```

## 18.3. `tool_calls`

```text
id
run_id
step_id
mcp_server
tool_name
input_hash
output_hash
status
side_effect_level
approval_id
latency_ms
retry_count
error_code
created_at
```

## 18.4. `approvals`

```text
id
run_id
tool_call_id
action
risk_level
input_summary
status
requested_by_agent
approved_by_user
expires_at
decided_at
created_at
```

## 18.5. `memories`

```text
id
memory_type
scope
content_json
source_ref
confidence
status
expires_at
created_at
updated_at
```

## 18.6. `skills`

```text
id
name
version
description
definition_yaml
status
created_at
updated_at
```

## 18.7. `mcp_servers`

```text
id
name
version
endpoint
status
auth_type
last_health_check
last_error
created_at
updated_at
```

## 18.8. `mcp_tools`

```text
id
server_id
name
description
input_schema_json
output_schema_json
side_effect_level
approval_level
timeout_seconds
max_retries
allowed_roles_json
enabled
created_at
updated_at
```

## 18.9. `policy_decisions`

```text
id
run_id
tool_call_id
policy_name
decision
reason
created_at
```

---

# 19. Deployment

## 19.1. AWS

Đề xuất:

```text
ECS Fargate hoặc EC2
├── agent-api
├── agent-worker
├── mcp-gateway
├── douyin-insight-mcp
├── database-mcp
├── storage-mcp
├── productivity-mcp
└── n8n
```

Data:

```text
RDS PostgreSQL
ElastiCache Redis
S3
ClickHouse Cloud
```

Observability:

```text
Langfuse Cloud hoặc self-hosted
CloudWatch
ClickHouse dashboards
```

## 19.2. Netlify

Chỉ triển khai:

- Dashboard.
- Static assets.
- Frontend environment variables không chứa secret.

## 19.3. Local Development

Docker Compose:

```text
postgres
redis
agent-api
agent-worker
mcp-gateway
selected-mcp-servers
dashboard
n8n
```

Không cần model local trên RTX 3050 4 GB cho MVP.

Có thể dùng local model nhỏ cho test sau, nhưng không bắt buộc.

---

# 20. Environment Variables

```env
APP_ENV=
DATABASE_URL=
REDIS_URL=
S3_BUCKET=
AWS_REGION=

OPENAI_API_KEY=
OPENAI_MODEL=
QWEN_API_KEY=
QWEN_MODEL=

LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=

CLICKHOUSE_URL=
CLICKHOUSE_USER=
CLICKHOUSE_PASSWORD=

MCP_GATEWAY_URL=
MCP_GATEWAY_TOKEN=

DOUYIN_INSIGHT_API_URL=
DOUYIN_INSIGHT_API_TOKEN=

BRIGHT_DATA_API_KEY=
BRIGHT_DATA_DATASET_ID=

TODOIST_API_TOKEN=

GMAIL_MCP_URL=
GOOGLE_CALENDAR_MCP_URL=
GOOGLE_CONTACTS_MCP_URL=
GOOGLE_DRIVE_MCP_URL=

GITHUB_TOKEN=
GITHUB_REPOSITORY=

N8N_BASE_URL=
N8N_API_KEY=

AGENT_MAX_STEPS=12
AGENT_MAX_TOOL_CALLS=20
AGENT_MAX_REPLANS=3
AGENT_MAX_RUNTIME_SECONDS=300
MODEL_MAX_COST_PER_WORKFLOW=
```

Không bắt buộc tất cả biến phải có ngay.

Tool nào thiếu credential:

- Đánh dấu `NOT_CONFIGURED`.
- Không đăng ký tool đó cho model.
- Không tạo dữ liệu giả.
- Không làm toàn hệ thống crash.

---

# 21. README.md Requirements

README phải bao gồm đầy đủ các phần sau.

## 21.1. Overview

- Agent System là gì.
- Harness là gì.
- MCP là gì.
- Hệ thống liên kết với Douyin Trend Insight như thế nào.
- Công cụ nào dùng ở runtime.
- Công cụ nào chỉ dùng development.

## 21.2. Architecture

- Diagram.
- Agent Harness.
- MCP Gateway.
- MCP Servers.
- Memory.
- Approval.
- Langfuse.
- ClickHouse.
- n8n boundary.
- AWS/Netlify deployment.

## 21.3. Prerequisites

- Docker.
- Node/Python runtime.
- PostgreSQL.
- Redis.
- AWS account.
- OpenAI key.
- Provider-specific credential.
- Langfuse.
- ClickHouse.
- Optional productivity connectors.

## 21.4. Quick Start

```text
clone repository
copy .env.example
configure database
configure at least one LLM
configure Douyin Insight API
start Docker Compose
run migration
create admin user
register MCP servers
open dashboard
run health checks
```

## 21.5. No Credential Behavior

README phải ghi rõ:

- Không có OpenAI/Qwen key: agent không chạy reasoning.
- Không có Douyin source: workflow insight bị disable.
- Không có Todoist/Gmail/Calendar: các action tương ứng bị disable.
- Không tự chuyển sang mock data.
- Dashboard vẫn hiển thị trạng thái cấu hình.

## 21.6. Tool Setup

Từng tool phải có hướng dẫn riêng:

- AWS.
- OpenAI.
- QwenCloud.
- Bright Data.
- ClickHouse.
- Langfuse.
- Netlify.
- GitHub.
- Todoist.
- Gmail.
- Google Calendar.
- Google Drive.
- n8n.

Với mỗi tool:

- Mục đích.
- Credential cần có.
- Env variable.
- Health check.
- Permission tối thiểu.
- Cost/quota monitoring.
- Cách tắt.
- Error thường gặp.

## 21.7. MCP Server Development

README phải hướng dẫn:

1. Tạo server.
2. Khai báo manifest.
3. Khai báo input/output schema.
4. Khai báo side effect.
5. Khai báo approval.
6. Khai báo role.
7. Khai báo timeout/retry.
8. Đăng ký Gateway.
9. Viết health check.
10. Viết contract test.
11. Redact secret.
12. Update docs.

## 21.8. Adding a New Tool

Checklist:

```text
Does tool have a clear business purpose?
Is an existing tool already sufficient?
What data does it access?
What side effects can it cause?
What approval is required?
What credential scope is needed?
What timeout and retry policy applies?
How is output validated?
How is it audited?
How is it disabled?
```

## 21.9. Agent Development

README phải hướng dẫn:

- Tạo specialist agent.
- Định nghĩa role.
- Tool allowlist.
- Input/output schema.
- Memory scope.
- Approval boundary.
- Evaluation.
- Failure handling.
- Handoff.

## 21.10. Skill Development

- Skill YAML.
- Preconditions.
- Tool list.
- Steps.
- Approval.
- Output.
- Evaluation.
- Versioning.
- Rollback.

## 21.11. Security

- Secret management.
- Least privilege.
- Prompt injection.
- Sandbox.
- Data classification.
- Audit.
- Credential rotation.
- Approval.
- No raw cookie in logs.

## 21.12. Observability

- Langfuse setup.
- ClickHouse schema.
- Trace IDs.
- Tool-call analytics.
- Cost monitoring.
- Error dashboards.
- Evaluation.

## 21.13. Troubleshooting

Bảng lỗi:

| Error | Meaning | Action |
|---|---|---|
| LLM_NOT_CONFIGURED | Chưa có model credential | Cấu hình OpenAI hoặc Qwen |
| MCP_SERVER_UNAVAILABLE | MCP server không hoạt động | Health check và xem logs |
| TOOL_NOT_CONFIGURED | Tool thiếu credential | Cấu hình hoặc disable |
| APPROVAL_REQUIRED | Action cần duyệt | Mở Approval Center |
| APPROVAL_EXPIRED | Approval hết hạn | Tạo request mới |
| POLICY_BLOCKED | Policy chặn action | Xem policy decision |
| TOOL_TIMEOUT | Tool quá thời gian | Kiểm tra service/timeout |
| TOOL_RATE_LIMITED | Tool bị giới hạn | Chờ hoặc giảm tần suất |
| CAPTCHA_DETECTED | Provider yêu cầu xác minh | Dừng và xác minh thủ công |
| MEMORY_REJECTED | Memory không hợp lệ | Review source/confidence |
| MAX_STEPS_REACHED | Agent đạt giới hạn | Review plan và skill |
| COST_LIMIT_REACHED | Workflow vượt ngân sách | Tăng limit hoặc tối ưu |

## 21.14. Operations

- Deploy.
- Migrations.
- Backup.
- Restore.
- Rotate secret.
- Enable/disable MCP server.
- Drain worker.
- Cancel workflow.
- Review stuck approvals.
- Roll back skill.
- Incident response.

## 21.15. Roadmap

### Phase 1 — Core Harness

- Agent API.
- Planner.
- State machine.
- MCP Gateway.
- Douyin Insight MCP.
- Database MCP.
- Approval.
- Langfuse.
- Dashboard basic.

### Phase 2 — Specialist Agents

- Trend Scout.
- Insight Analyst.
- Localization.
- Affiliate.
- Rights.
- Operations.

### Phase 3 — Productivity Tools

- Todoist.
- Gmail draft.
- Calendar.
- Drive.
- GitHub.
- n8n.

### Phase 4 — Learning and Optimization

- Evaluation.
- Outcome feedback.
- Scoring improvement.
- Skill library.
- Semantic memory.
- Cost routing.
- Multi-platform expansion.

---

# 22. Files Codex phải tạo

```text
README.md
.env.example
docker-compose.yml
.gitignore

docs/
├── architecture.md
├── harness.md
├── mcp-gateway.md
├── mcp-tool-manifest.md
├── agents.md
├── skills.md
├── memory.md
├── context-engineering.md
├── approvals.md
├── security.md
├── observability.md
├── evaluation.md
├── deployment.md
├── operations.md
├── troubleshooting.md
└── roadmap.md

apps/
├── dashboard/
├── agent-api/
├── agent-worker/
└── mcp-gateway/

mcp-servers/
├── douyin-insight-mcp/
├── bright-data-mcp/
├── database-mcp/
├── clickhouse-mcp/
├── storage-mcp/
├── todoist-mcp/
├── gmail-mcp/
├── google-calendar-mcp/
├── google-contacts-mcp/
├── github-mcp/
└── n8n-mcp/

packages/
├── harness-core/
├── planner/
├── policy-engine/
├── approval-manager/
├── memory-manager/
├── model-router/
├── tool-registry/
├── shared-schemas/
├── observability/
└── security/

skills/
├── discover-trending-videos/
├── analyze-video-opportunity/
├── generate-content-brief/
├── request-creator-permission/
├── schedule-content-review/
├── diagnose-provider-failure/
└── create-daily-report/
```

Không cần implement MCP server chưa có credential/API docs đầy đủ. Với tool đó:

- Tạo adapter interface.
- Tạo config.
- Tạo manifest.
- Tạo health status `NOT_CONFIGURED`.
- Viết README.
- Không bịa endpoint.
- Không bịa response.

---

# 23. Acceptance Criteria

1. Agent chạy qua Harness, không gọi model trực tiếp từ frontend.
2. Mọi tool call đi qua MCP Gateway.
3. Tool không cấu hình không xuất hiện trong tool list của model.
4. Không dùng runtime mock data.
5. Planner tạo plan có schema.
6. State machine giới hạn loop.
7. Tool Selector tôn trọng allowlist.
8. Policy Engine chặn action không hợp lệ.
9. External write tạo approval.
10. Publish bị block trong MVP.
11. Tool call có timeout.
12. Retry chỉ áp dụng lỗi retryable.
13. Trace được gửi sang Langfuse.
14. Event analytics được gửi sang ClickHouse.
15. Working memory có TTL.
16. Episodic memory có source.
17. Secret không xuất hiện trong frontend/log/trace.
18. Prompt injection từ caption/email không đổi policy.
19. Douyin agent truy vấn dữ liệu thật từ hệ thống insight.
20. Có thể tạo content brief sau approval.
21. Có thể tạo Todoist task sau approval.
22. Có thể tạo Gmail draft sau approval.
23. Không gửi email thật tự động.
24. Có dashboard Approval Center.
25. Có MCP Registry.
26. Có Trace Explorer.
27. Có health check cho MCP server.
28. Có audit log.
29. README đủ hướng dẫn tool setup và extension.
30. Codex báo rõ phần chưa test do thiếu credential.

---

# 24. Chỉ dẫn trực tiếp cho Codex

Hãy làm theo thứ tự:

1. Đọc file này và `DOUYIN_TREND_INSIGHT_CODEX_SPEC.md`.
2. Xác định stack kỹ thuật.
3. Tạo architecture.
4. Tạo shared schema.
5. Tạo Harness core.
6. Tạo state machine.
7. Tạo planner.
8. Tạo policy engine.
9. Tạo approval manager.
10. Tạo MCP Gateway.
11. Tạo Douyin Insight MCP trước.
12. Tạo Database MCP.
13. Tạo Langfuse integration.
14. Tạo ClickHouse event pipeline.
15. Tạo Supervisor và Trend Scout.
16. Tạo dashboard Agent Workspace.
17. Tạo Approval Center.
18. Tạo MCP Registry.
19. Tạo Trace Explorer.
20. Sau đó mới thêm specialist agents.
21. Sau đó mới thêm Todoist/Gmail/Calendar/GitHub/n8n adapters.
22. Không tạo endpoint giả.
23. Không tạo API key giả.
24. Không tạo dữ liệu runtime giả.
25. Không bypass CAPTCHA.
26. Không cho model arbitrary SQL.
27. Không cho model shell production.
28. Không tự động publish.
29. Chạy lint, type check, unit test và build.
30. Bàn giao báo cáo phần đã chạy và phần cần credential.

---

# 25. Kết quả bàn giao

Codex phải bàn giao:

- Source code Agent Harness.
- MCP Gateway.
- MCP tool registry.
- Douyin Insight MCP.
- Database MCP.
- Các MCP adapter đã cấu hình được.
- Supervisor Agent.
- Specialist Agents.
- Skill Library.
- Approval Center.
- Memory Manager.
- Policy Engine.
- Langfuse integration.
- ClickHouse analytics.
- Docker Compose.
- AWS deployment guide.
- Netlify dashboard guide.
- README.
- Tài liệu trong `docs/`.
- Test suite.
- Build report.
- Credential checklist.
- Risk register.
- Danh sách phần chưa test.
