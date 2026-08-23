import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AutoPipelinePhase, AutoPipelineProgress } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import LinkInput from './LinkInput'

type Model = 'base' | 'small' | 'medium'

interface Readiness {
  douyin: boolean
  whisper: boolean
  gemini: boolean
  cuda: boolean
}

const STAGES: { phase: AutoPipelinePhase; number: string; label: string; detail: string }[] = [
  { phase: 'downloading', number: '01', label: 'Nguồn', detail: 'Tải video Douyin' },
  { phase: 'transcribing', number: '02', label: 'Phiên âm', detail: 'Whisper tạo SRT' },
  { phase: 'translating', number: '03', label: 'Dịch', detail: 'Gemini dịch tiếng Việt' },
  { phase: 'rendering', number: '04', label: 'Kết xuất', detail: 'FFmpeg ghép phụ đề' },
  { phase: 'finished', number: '05', label: 'Duyệt', detail: 'Kiểm tra trước khi đăng' }
]

export default function AutoPipeline({
  outputDir,
  setOutputDir,
  onNavigate
}: {
  outputDir: string
  setOutputDir: (path: string) => void
  onNavigate: (destination: 'insights' | 'download' | 'douyin' | 'audiotext') => void
}): JSX.Element {
  const [url, setUrl] = useState('')
  const [model, setModel] = usePersistedState<Model>('tblao.auto.model', 'small')
  const [useGpu, setUseGpu] = usePersistedState('tblao.auto.useGpu', true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<AutoPipelineProgress | null>(null)
  const [outputs, setOutputs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)

  const refreshReadiness = async (): Promise<void> => {
    const [douyin, whisper, gemini, cuda] = await Promise.all([
      window.api.dyEngineStatus(),
      window.api.whisperEngineStatus(),
      window.api.geminiHasKey(),
      window.api.whisperCudaStatus()
    ])
    setReadiness({ douyin: douyin.has, whisper: whisper.has, gemini, cuda: cuda.has })
  }

  useEffect(() => {
    void refreshReadiness()
    const off = window.api.onAutomationProgress((event) => setProgress(event))
    return off
  }, [])

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  const run = async (): Promise<void> => {
    if (running || !url.trim() || !outputDir) return
    const id = crypto.randomUUID()
    setRunning(true)
    setProgress({ id, phase: 'downloading', message: 'Đang chuẩn bị workflow…', percent: 0, current: 0, total: 1 })
    setOutputs([])
    setError(null)
    try {
      const result = await window.api.automationRun(id, { url: url.trim(), outputDir, model, useGpu })
      if (result.ok) setOutputs(result.outputs)
      else setError(result.error ?? 'Workflow thất bại.')
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunning(false)
    }
  }

  const stageIndex = Math.max(0, STAGES.findIndex((stage) => stage.phase === progress?.phase))
  const readyCount = readiness ? [readiness.douyin, readiness.whisper, readiness.gemini].filter(Boolean).length : 0
  const workflowState = running ? 'Đang chạy' : outputs.length ? 'Chờ duyệt' : error ? 'Cần xử lý' : 'Sẵn sàng'
  const readinessItems = useMemo(() => [
    { label: 'Douyin engine', ready: readiness?.douyin ?? false, required: true },
    { label: 'Whisper engine', ready: readiness?.whisper ?? false, required: true },
    { label: 'Gemini API', ready: readiness?.gemini ?? false, required: true },
    { label: 'GPU runtime', ready: readiness?.cuda ?? false, required: false }
  ], [readiness])
  const apiReadyCount = readiness ? [readiness.douyin, readiness.whisper, readiness.gemini].filter(Boolean).length : 0

  return (
    <div className="automation-page">
      <section className="automation-hero">
        <div className="automation-hero-copy">
          <div className="automation-eyebrow">Workflow studio</div>
          <h2>Một liên kết.<br />Một video sẵn sàng để duyệt.</h2>
          <p>Tự động tải nguồn, tạo phụ đề, dịch tiếng Việt và kết xuất thành một luồng liền mạch.</p>
        </div>
        <div className="automation-hero-status">
          <span>Trạng thái hiện tại</span>
          <strong>{workflowState}</strong>
          <small>{running ? progress?.message : `${readyCount}/3 dịch vụ bắt buộc đã sẵn sàng`}</small>
        </div>
      </section>

      <section className="dashboard-overview" aria-label="Truy cập nhanh workflow">
        <article className="dashboard-quick-card insights">
          <div className="dashboard-quick-top"><span>01 · Phân tích</span><small>Metadata thật</small></div>
          <h3>Tìm video đáng làm tiếp</h3>
          <p>So sánh snapshot, tốc độ tăng view và tín hiệu tương tác trước khi chọn video vào workflow.</p>
          <button className="text-button" onClick={() => onNavigate('insights')}>Mở Trend Insights</button>
        </article>
        <article className="dashboard-quick-card download">
          <div className="dashboard-quick-top"><span>02 · Nguồn</span><small>Chọn thủ công</small></div>
          <h3>Tải video đã được duyệt</h3>
          <p>Dùng tab tải đa nền tảng hoặc Douyin sau khi bạn đã kiểm tra quyền sử dụng nội dung.</p>
          <div className="dashboard-card-actions">
            <button className="text-button" onClick={() => onNavigate('douyin')}>Tải Douyin</button>
            <button className="text-button" onClick={() => onNavigate('download')}>Tải từ link</button>
          </div>
        </article>
        <article className="dashboard-quick-card final">
          <div className="dashboard-quick-top"><span>03 · Kết xuất</span><small>{outputs.length ? 'Có file chờ duyệt' : 'Chạy local'}</small></div>
          <h3>Tạo video cuối tự động</h3>
          <p>Workflow tải nguồn, phiên âm, dịch tiếng Việt và ghép phụ đề thành file cuối để bạn duyệt.</p>
          <button className="text-button" onClick={() => document.querySelector<HTMLInputElement>('.source-card .url-input')?.focus()}>Bắt đầu với một liên kết</button>
        </article>
        <article className="dashboard-quick-card api">
          <div className="dashboard-quick-top"><span>API & công cụ</span><small>{apiReadyCount}/3 sẵn sàng</small></div>
          <h3>Kiểm tra phần cần cấu hình</h3>
          <div className="dashboard-api-list">
            <span className={readiness?.gemini ? 'ready' : 'missing'}>Gemini API {readiness?.gemini ? 'đã kết nối' : 'cần API key'}</span>
            <span className={readiness?.douyin ? 'ready' : 'missing'}>Douyin engine {readiness?.douyin ? 'sẵn sàng' : 'cần cài'}</span>
            <span className={readiness?.whisper ? 'ready' : 'missing'}>Whisper engine {readiness?.whisper ? 'sẵn sàng' : 'cần cài'}</span>
          </div>
          <button className="text-button" onClick={() => onNavigate('audiotext')}>Cấu hình Gemini API</button>
        </article>
      </section>

      <section className="workflow-strip" aria-label="Các bước workflow">
        {STAGES.map((stage, index) => {
          const state = progress ? (index < stageIndex ? 'done' : index === stageIndex ? 'active' : 'waiting') : 'waiting'
          return (
            <div className={`workflow-stage ${state}`} key={stage.phase}>
              <span className="workflow-number">{stage.number}</span>
              <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
            </div>
          )
        })}
      </section>

      <section className="automation-grid">
        <div className="automation-config">
          <div className="section-heading">
            <div><span>Thiết lập</span><h3>Tạo workflow mới</h3></div>
            <span className="status-pill neutral">Chạy local</span>
          </div>

          <div className="automation-card source-card">
            <label className="automation-label">Nguồn video</label>
            <LinkInput placeholder="Dán liên kết video Douyin" value={url} onChange={setUrl} onSubmit={run} />
            <p className="automation-help">Hiện hỗ trợ một video cho mỗi workflow. Link kênh được xử lý trong tab Douyin.</p>
          </div>

          <div className="automation-card settings-card">
            <div className="setting-row">
              <div><strong>Chất lượng phiên âm</strong><span>Chọn cân bằng giữa tốc độ và độ chính xác.</span></div>
              <select value={model} onChange={(event) => setModel(event.target.value as Model)} disabled={running}>
                <option value="base">Nhanh · base</option>
                <option value="small">Cân bằng · small</option>
                <option value="medium">Chính xác · medium</option>
              </select>
            </div>
            <div className="setting-row">
              <div><strong>Tăng tốc phần cứng</strong><span>Dùng GPU khi runtime CUDA đã sẵn sàng.</span></div>
              <label className="switch-control">
                <input type="checkbox" checked={useGpu} onChange={(event) => setUseGpu(event.target.checked)} disabled={running} />
                <span>{useGpu ? 'Bật' : 'Tắt'}</span>
              </label>
            </div>
            <div className="setting-row output-setting">
              <div><strong>Thư mục đầu ra</strong><span title={outputDir}>{outputDir || 'Chưa chọn thư mục'}</span></div>
              <button className="btn" onClick={chooseFolder} disabled={running}>Thay đổi</button>
            </div>
          </div>

          <div className="automation-launch">
            <div><strong>Sẵn sàng xử lý</strong><span>Kết quả luôn được giữ local để bạn duyệt trước.</span></div>
            <button className="btn primary launch-button" onClick={run} disabled={running || !url.trim() || !outputDir}>
              {running ? 'Đang chạy workflow' : 'Bắt đầu workflow'}
            </button>
          </div>
        </div>

        <aside className="automation-monitor">
          <div className="section-heading compact"><div><span>Hệ thống</span><h3>Kiểm tra sẵn sàng</h3></div></div>
          <div className="automation-card readiness-card">
            {readinessItems.map((item) => (
              <div className="readiness-row" key={item.label}>
                <span className={`readiness-dot ${item.ready ? 'ready' : ''}`} />
                <div><strong>{item.label}</strong><small>{item.ready ? 'Sẵn sàng' : item.required ? 'Cần thiết lập' : 'Không bắt buộc'}</small></div>
              </div>
            ))}
            <button className="text-button" onClick={refreshReadiness}>Kiểm tra lại hệ thống</button>
          </div>

          <div className="section-heading compact"><div><span>Hoạt động</span><h3>Job hiện tại</h3></div></div>
          <div className={`automation-card job-card ${error ? 'has-error' : ''}`}>
            {!progress && <div className="job-empty"><strong>Chưa có job</strong><span>Workflow mới sẽ xuất hiện tại đây.</span></div>}
            {progress && <>
              <div className="job-head"><span className={`status-pill ${running ? 'active' : outputs.length ? 'success' : 'neutral'}`}>{workflowState}</span><span>{progress.percent}%</span></div>
              <strong className="job-message">{progress.message}</strong>
              <div className="bar automation-progress"><div className="bar-fill" style={{ width: `${Math.max(0, progress.percent)}%` }} /></div>
              <small>Video {Math.min(progress.current + 1, progress.total)} trên {progress.total}</small>
            </>}
            {error && <div className="job-error">{error}</div>}
          </div>

          {outputs.length > 0 && <div className="automation-card output-card">
            <span className="automation-label">Kết quả chờ duyệt</span>
            {outputs.map((path) => <div className="output-file" key={path} title={path}>{path.split(/[\\/]/).pop()}</div>)}
            <button className="btn primary" onClick={() => window.api.openPath(outputDir)}>Mở thư mục kết quả</button>
          </div>}
        </aside>
      </section>
    </div>
  )
}
