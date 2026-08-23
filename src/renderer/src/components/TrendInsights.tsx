import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TrendCategory,
  TrendCollectionStatus,
  TrendDiscoveryPreview,
  TrendDiscoveryTopic,
  TrendInsightProgress,
  TrendInsightReport,
  TrendInsightRunPhase,
  TrendVideoWorkflowStatus
} from '../../../shared/types'
import { usePersistedState } from '../lib/persist'

type PipelineModel = 'base' | 'small' | 'medium'
type SelectableTrendCategory = Exclude<TrendCategory, 'all'>

interface RecommendationJob {
  id: string
  videoId: string
  mode: 'download' | 'final_video'
  state: 'running' | 'completed' | 'error'
  message: string
  progress: number
  outputs: string[]
}

const CATEGORIES: { value: TrendCategory; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'education', label: 'Giáo dục' },
  { value: 'technology', label: 'Công nghệ' },
  { value: 'beauty', label: 'Làm đẹp' },
  { value: 'food', label: 'Ẩm thực' },
  { value: 'travel', label: 'Du lịch' },
  { value: 'entertainment', label: 'Giải trí' },
  { value: 'business', label: 'Kinh doanh' },
  { value: 'lifestyle', label: 'Đời sống' }
]

const WORKFLOW_STEPS: Array<{ phase: TrendInsightRunPhase; label: string; detail: string }> = [
  { phase: 'checking_session', label: 'Kiểm tra phiên', detail: 'Xác nhận cookie Douyin' },
  { phase: 'collecting', label: 'Thu thập', detail: 'Crawl đến khi feed hết video mới' },
  { phase: 'saving', label: 'Cập nhật database', detail: 'Lưu full metadata, category và snapshot' },
  { phase: 'analyzing', label: 'Phân tích', detail: 'Chấm lại điểm rồi mới lọc đề xuất' },
  { phase: 'finished', label: 'Hoàn tất', detail: 'Xuất đề xuất ưu tiên' }
]

const formatNumber = (value: number): string => new Intl.NumberFormat('vi-VN', {
  notation: value >= 10_000 ? 'compact' : 'standard',
  maximumFractionDigits: 1
}).format(value)

const recommendationLabel = (status: TrendInsightReport['topVideos'][number]['recommendationStatus']): string => {
  if (status === 'process_now') return 'Process now'
  if (status === 'watch') return 'Theo dõi'
  if (status === 'optional') return 'Tùy chọn'
  return 'Chưa đủ dữ liệu'
}

const workflowStatusLabel = (status: TrendVideoWorkflowStatus): string => ({
  discovered: 'Mới phát hiện',
  shortlisted: 'Đã chọn',
  downloading: 'Đang tải',
  downloaded: 'Đã tải',
  processing: 'Đang xử lý',
  exported: 'Đã xuất video',
  published: 'Đã đăng',
  rejected: 'Đã bỏ qua'
})[status]

const formatCountdown = (seconds: number | null): string => {
  if (seconds == null) return 'Chưa lên lịch'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

const schedulerLabel = (state: 'starting' | 'running' | 'waiting' | 'scheduled'): string => {
  if (state === 'running') return 'Đang chạy nền'
  if (state === 'waiting') return 'Đang chờ cookie'
  if (state === 'scheduled') return 'Đã lên lịch'
  return 'Đang khởi động'
}

export default function TrendInsights({
  outputDir,
  setOutputDir
}: {
  outputDir: string
  setOutputDir: (path: string) => void
}): JSX.Element {
  const [category, setCategory] = usePersistedState<TrendCategory>('tblao.insights.category', 'all')
  const [updateCategories, setUpdateCategories] = usePersistedState<SelectableTrendCategory[]>(
    'tblao.insights.updateCategories',
    []
  )
  const [direction, setDirection] = usePersistedState('tblao.insights.direction', '')
  const [refreshMinutes, setRefreshMinutes] = usePersistedState<number>('tblao.insights.refreshMinutes', 30)
  const [minimumSnapshots, setMinimumSnapshots] = usePersistedState<number>('tblao.insights.minimumSnapshots', 2)
  const [pipelineModel] = usePersistedState<PipelineModel>('tblao.auto.model', 'small')
  const [pipelineUseGpu] = usePersistedState('tblao.auto.useGpu', true)
  const [report, setReport] = useState<TrendInsightReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<TrendInsightProgress | null>(null)
  const [runEvents, setRunEvents] = useState<TrendInsightProgress[]>([])
  const [activities, setActivities] = useState<TrendInsightProgress[]>([])
  const [livePreview, setLivePreview] = useState<TrendDiscoveryPreview[]>([])
  const [currentVideo, setCurrentVideo] = useState<TrendDiscoveryPreview | null>(null)
  const [liveTopics, setLiveTopics] = useState<TrendDiscoveryTopic[]>([])
  const [collection, setCollection] = useState<TrendCollectionStatus | null>(null)
  const [schedulerState, setSchedulerState] = useState<'starting' | 'running' | 'waiting' | 'scheduled'>('starting')
  const [nextRunAt, setNextRunAt] = useState<number | null>(null)
  const [clock, setClock] = useState(Date.now())
  const [recommendationJob, setRecommendationJob] = useState<RecommendationJob | null>(null)
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const activeAnalysisRef = useRef<Promise<void> | null>(null)
  const analyzeRef = useRef<() => Promise<void>>(async () => undefined)
  const schedulerSourceRef = useRef('')
  const categoryMenuRef = useRef<HTMLDivElement | null>(null)
  const effectiveRefreshMinutes = Math.min(720, Math.max(5, Number(refreshMinutes) || 30))
  const effectiveMinimumSnapshots = Math.min(10, Math.max(1, Number(minimumSnapshots) || 2))

  const chooseFolder = async (): Promise<void> => {
    const selected = await window.api.chooseFolder()
    if (selected) setOutputDir(selected)
  }

  const analyze = useCallback((): Promise<void> => {
    if (!outputDir) return Promise.resolve()
    if (activeAnalysisRef.current) return activeAnalysisRef.current
    const task = (async (): Promise<void> => {
      setLoading(true)
      setError(null)
      setProgress(null)
      setRunEvents([])
      setLivePreview([])
      setCurrentVideo(null)
      setLiveTopics([])
      try {
        const result = await window.api.runTrendInsights({
          dataDir: outputDir,
          category,
          updateCategories,
          direction,
          snapshotIntervalMinutes: effectiveRefreshMinutes,
          minimumSnapshots: effectiveMinimumSnapshots
        })
        setCollection(result.collection)
        // Keep the last local report visible if an older backend returns no report.
        if (result.report) setReport(result.report)
      } catch (analysisError) {
        setError(analysisError instanceof Error ? analysisError.message : String(analysisError))
      } finally {
        setLoading(false)
      }
    })().finally(() => {
      activeAnalysisRef.current = null
    })
    activeAnalysisRef.current = task
    return task
  }, [category, direction, effectiveMinimumSnapshots, effectiveRefreshMinutes, outputDir, updateCategories])

  useEffect(() => {
    if (!outputDir) return
    let cancelled = false
    void window.api.analyzeTrends({
      dataDir: outputDir,
      category,
      direction,
      snapshotIntervalMinutes: effectiveRefreshMinutes,
      minimumSnapshots: effectiveMinimumSnapshots
    }).then((storedReport) => {
      if (!cancelled) setReport(storedReport)
    }).catch((storedError) => {
      if (!cancelled) setError(storedError instanceof Error ? storedError.message : String(storedError))
    })
    return () => {
      cancelled = true
    }
  }, [category, direction, effectiveMinimumSnapshots, effectiveRefreshMinutes, outputDir])

  useEffect(() => window.api.onTrendInsightProgress((event) => {
    setProgress(event)
    setRunEvents((current) => [...current, event].slice(-80))
    setActivities((current) => [...current, event].slice(-160))
    if (event.preview && event.preview.length > 0) setLivePreview(event.preview)
    if (event.currentVideo) setCurrentVideo(event.currentVideo)
    if (event.topics) setLiveTopics(event.topics)
  }), [])

  useEffect(() => {
    if (!categoryMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!categoryMenuRef.current?.contains(event.target as Node)) setCategoryMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [categoryMenuOpen])

  useEffect(() => {
    const offDownload = window.api.onDyProgress((event) => {
      setRecommendationJob((current) => current?.id === event.id && current.mode === 'download'
        ? { ...current, message: event.line || (event.status === 'finished' ? 'Đã tải video.' : 'Đang tải video.'), progress: event.status === 'finished' ? 100 : event.status === 'preparing' ? 10 : 55 }
        : current)
    })
    const offAutomation = window.api.onAutomationProgress((event) => {
      setRecommendationJob((current) => current?.id === event.id && current.mode === 'final_video'
        ? { ...current, message: event.message, progress: event.percent }
        : current)
    })
    return () => {
      offDownload()
      offAutomation()
    }
  }, [])

  const persistWorkflowStatus = async (
    videoId: string,
    status: TrendVideoWorkflowStatus,
    outputFiles?: string[],
    notes?: string
  ): Promise<void> => {
    const updated = await window.api.updateTrendVideoStatus({ dataDir: outputDir, id: videoId, status, outputFiles, notes })
    if (!updated) return
    setReport((current) => current ? {
      ...current,
      topVideos: current.topVideos.map((video) => video.id === videoId
        ? { ...video, workflowStatus: updated.status, statusUpdatedAt: updated.statusUpdatedAt }
        : video)
    } : current)
  }

  const downloadRecommendation = async (video: TrendInsightReport['topVideos'][number]): Promise<void> => {
    if (!video.sourceUrl || !outputDir || recommendationJob?.state === 'running') return
    const id = crypto.randomUUID()
    setRecommendationJob({ id, videoId: video.id, mode: 'download', state: 'running', message: 'Đang chuẩn bị tải video.', progress: 0, outputs: [] })
    try {
      await persistWorkflowStatus(video.id, 'downloading')
      const result = await window.api.dyDownload(id, {
        url: video.sourceUrl,
        outputDir,
        isChannel: false,
        mode: 'all',
        batchSize: 1,
        music: true,
        cover: false,
        avatar: false,
        metaJson: true,
        proxy: null
      })
      setRecommendationJob({
        id,
        videoId: video.id,
        mode: 'download',
        state: result.ok ? 'completed' : 'error',
        message: result.ok ? 'Đã tải video và metadata vào thư mục đầu ra.' : result.error || 'Không thể tải video.',
        progress: result.ok ? 100 : 0,
        outputs: result.files ?? []
      })
      await persistWorkflowStatus(video.id, result.ok ? 'downloaded' : 'shortlisted', result.files, result.error ?? undefined)
    } catch (jobError) {
      setRecommendationJob({ id, videoId: video.id, mode: 'download', state: 'error', message: jobError instanceof Error ? jobError.message : String(jobError), progress: 0, outputs: [] })
      void persistWorkflowStatus(video.id, 'shortlisted', undefined, jobError instanceof Error ? jobError.message : String(jobError))
    }
  }

  const createFinalVideo = async (video: TrendInsightReport['topVideos'][number]): Promise<void> => {
    if (!video.sourceUrl || !outputDir || recommendationJob?.state === 'running') return
    const id = crypto.randomUUID()
    setRecommendationJob({ id, videoId: video.id, mode: 'final_video', state: 'running', message: 'Đang chuẩn bị workflow tạo video cuối.', progress: 0, outputs: [] })
    try {
      await persistWorkflowStatus(video.id, 'processing')
      const result = await window.api.automationRun(id, {
        url: video.sourceUrl,
        outputDir,
        model: pipelineModel,
        useGpu: pipelineUseGpu
      })
      setRecommendationJob({
        id,
        videoId: video.id,
        mode: 'final_video',
        state: result.ok ? 'completed' : 'error',
        message: result.ok ? 'Video cuối đã hoàn tất và đang chờ bạn duyệt.' : result.error || 'Workflow tạo video thất bại.',
        progress: result.ok ? 100 : 0,
        outputs: result.outputs
      })
      await persistWorkflowStatus(video.id, result.ok ? 'exported' : 'shortlisted', result.outputs, result.error ?? undefined)
    } catch (jobError) {
      setRecommendationJob({ id, videoId: video.id, mode: 'final_video', state: 'error', message: jobError instanceof Error ? jobError.message : String(jobError), progress: 0, outputs: [] })
      void persistWorkflowStatus(video.id, 'shortlisted', undefined, jobError instanceof Error ? jobError.message : String(jobError))
    }
  }

  useEffect(() => {
    analyzeRef.current = analyze
  }, [analyze])

  const addSchedulerActivity = useCallback((
    operation: string,
    message: string,
    status: TrendInsightProgress['status'],
    details?: TrendInsightProgress['details']
  ): void => {
    const event: TrendInsightProgress = {
      phase: 'checking_session',
      operation,
      message,
      status,
      timestamp: new Date().toISOString(),
      details
    }
    setActivities((current) => [...current, event].slice(-160))
  }, [])

  useEffect(() => {
    if (!outputDir) return
    let stopped = false
    let refreshTimer: number | null = null

    const schedule = (delay: number): void => {
      if (stopped) return
      const next = Date.now() + delay
      setNextRunAt(next)
      refreshTimer = window.setTimeout(() => void runCycle(), delay)
    }

    const runCycle = async (): Promise<void> => {
      setNextRunAt(null)
      setSchedulerState('starting')
      addSchedulerActivity('scheduler_session_check', 'Scheduler đang kiểm tra cookie trước chu kỳ nền.', 'running')
      const cookie = await window.api.dyCookieStatus()
      if (stopped) return
      if (!cookie.has) {
        setSchedulerState('waiting')
        addSchedulerActivity('scheduler_waiting_cookie', 'Scheduler tạm chờ vì chưa có cookie Douyin; sẽ kiểm tra lại sau 60 giây.', 'warning')
        schedule(60_000)
        return
      }

      setSchedulerState('running')
      addSchedulerActivity('scheduler_trigger', 'Scheduler bắt đầu một chu kỳ thu thập và phân tích nền.', 'running', {
        cookieCount: cookie.count
      })
      await analyzeRef.current()
      if (stopped) return
      setSchedulerState('scheduled')
      addSchedulerActivity('scheduler_scheduled', `Chu kỳ nền hoàn tất; lần chạy tiếp theo sau ${effectiveRefreshMinutes} phút.`, 'completed', {
        intervalMinutes: effectiveRefreshMinutes
      })
      schedule(effectiveRefreshMinutes * 60 * 1000)
    }

    const sourceChanged = schedulerSourceRef.current !== outputDir
    schedulerSourceRef.current = outputDir
    setSchedulerState('scheduled')
    if (sourceChanged) {
      addSchedulerActivity('scheduler_local_ready', `Đã nạp dữ liệu local; lần làm mới Douyin kế tiếp sau ${effectiveRefreshMinutes} phút.`, 'info', {
        intervalMinutes: effectiveRefreshMinutes
      })
      schedule(effectiveRefreshMinutes * 60 * 1000)
    } else {
      addSchedulerActivity('scheduler_interval_changed', `Đã đổi chu kỳ nền thành ${effectiveRefreshMinutes} phút.`, 'info', {
        intervalMinutes: effectiveRefreshMinutes
      })
      schedule(effectiveRefreshMinutes * 60 * 1000)
    }
    return () => {
      stopped = true
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
    }
  }, [addSchedulerActivity, effectiveRefreshMinutes, outputDir])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const maxScore = Math.max(1, ...(report?.topVideos.map((video) => video.trendScore ?? 0) ?? []))
  const currentStepIndex = progress ? WORKFLOW_STEPS.findIndex((step) => step.phase === progress.phase) : -1
  const secondsUntilNextRun = nextRunAt == null ? null : Math.max(0, Math.ceil((nextRunAt - clock) / 1000))
  const latestRuntimeEvent = activities[activities.length - 1] ?? null
  const latestCaptureEvent = [...activities].reverse().find((event) => event.details?.capturedVideos != null) ?? null
  const capturedVideos = Number(latestCaptureEvent?.details?.capturedVideos ?? 0)
  const pendingResponses = Number(latestCaptureEvent?.details?.pendingResponses ?? 0)
  const metadataResponses = Number(latestCaptureEvent?.details?.metadataResponses ?? 0)
  const parsedResponses = Number(latestCaptureEvent?.details?.parsedResponses ?? 0)
  const selectedCategory = CATEGORIES.find((item) => item.value === category)?.label ?? category
  const updateCategoryNames = CATEGORIES
    .filter((item) => item.value !== 'all' && updateCategories.includes(item.value as SelectableTrendCategory))
    .map((item) => item.label)
  const categoryButtonLabel = updateCategories.length === 0
    ? 'Tất cả phân mục'
    : updateCategories.length <= 2 ? updateCategoryNames.join(', ') : `${updateCategories.length} phân mục`
  const analysisStarted = runEvents.some((event) => event.phase === 'analyzing')

  const toggleUpdateCategory = (value: TrendCategory): void => {
    if (value === 'all') {
      setUpdateCategories([])
      return
    }
    const selected = value as SelectableTrendCategory
    setUpdateCategories((current) => current.includes(selected)
      ? current.filter((item) => item !== selected)
      : [...current, selected])
  }

  return (
    <div className="insights-page">
      <section className="insights-hero">
        <div>
          <span className="insights-kicker">Trend intelligence</span>
          <h2>Biến dữ liệu đã thu thập thành hướng video tiếp theo.</h2>
          <p>Insight được tính từ metadata trong thư viện của bạn, có bằng chứng và mức tin cậy rõ ràng.</p>
        </div>
        <div className="insights-source">
          <span>Nguồn phân tích</span>
          <strong title={outputDir}>{outputDir || 'Chưa chọn thư mục'}</strong>
          <button className="text-button" onClick={chooseFolder}>Thay đổi nguồn dữ liệu</button>
        </div>
      </section>

      <section className="insights-toolbar">
        <div className="category-filter">
          {CATEGORIES.map((item) => (
            <button
              className={item.value === category ? 'selected' : ''}
              key={item.value}
              type="button"
              aria-pressed={item.value === category}
              onClick={() => setCategory(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="direction-input">
          <input
            value={direction}
            onChange={(event) => setDirection(event.target.value)}
            placeholder="Hướng đang theo, ví dụ: AI cho người mới"
          />
          <label className="insights-refresh-control">
            <span>Chu kỳ</span>
            <input
              type="number"
              min={5}
              max={720}
              step={5}
              value={refreshMinutes}
              onChange={(event) => setRefreshMinutes(Math.min(720, Math.max(5, Number(event.target.value) || 5)))}
            />
            <small>phút</small>
          </label>
          <label className="insights-refresh-control">
            <span>Số snapshot</span>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={minimumSnapshots}
              onChange={(event) => setMinimumSnapshots(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
            />
            <small>lần</small>
          </label>
          <div className="insights-category-menu" ref={categoryMenuRef}>
            <button
              className="btn insights-category-trigger"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={categoryMenuOpen}
              onClick={() => setCategoryMenuOpen((current) => !current)}
            >
              <span>Phân mục</span>
              <strong>{categoryButtonLabel}</strong>
            </button>
            {categoryMenuOpen && (
              <div className="insights-category-popover" role="dialog" aria-label="Chọn phân mục cập nhật insight">
                <div className="insights-category-popover-head">
                  <div>
                    <strong>Phân mục cập nhật</strong>
                    <small>Có thể chọn nhiều phân mục</small>
                  </div>
                  <button type="button" onClick={() => toggleUpdateCategory('all')}>Chọn tất cả</button>
                </div>
                <div className="insights-category-options">
                  {CATEGORIES.filter((item) => item.value !== 'all').map((item) => {
                    const value = item.value as SelectableTrendCategory
                    return (
                      <label key={value}>
                        <input
                          type="checkbox"
                          checked={updateCategories.includes(value)}
                          onChange={() => toggleUpdateCategory(value)}
                        />
                        <span>{item.label}</span>
                      </label>
                    )
                  })}
                </div>
                <button className="btn primary insights-category-apply" type="button" onClick={() => setCategoryMenuOpen(false)}>
                  Áp dụng
                </button>
              </div>
            )}
          </div>
          <button className="btn primary" onClick={analyze} disabled={loading || !outputDir}>
            {loading ? 'Đang tự động hóa' : 'Cập nhật insight'}
          </button>
        </div>
      </section>

      {activities.length > 0 && (
        <section className="insights-process" aria-live="polite">
          <div className="insights-process-head">
            <div>
              <span>Runtime monitor</span>
              <strong>{activities[activities.length - 1].message}</strong>
            </div>
            <div className={`insights-scheduler-state ${schedulerState}`}>
              <span>{schedulerLabel(schedulerState)}</span>
              <strong>{schedulerState === 'running' ? 'Đang xử lý' : formatCountdown(secondsUntilNextRun)}</strong>
              <small>{nextRunAt ? `Lần kế tiếp: ${new Date(nextRunAt).toLocaleTimeString('vi-VN')}` : 'Chu kỳ chạy nền của Insight'}</small>
            </div>
          </div>
          <div className="insights-process-steps">
            {WORKFLOW_STEPS.map((step, index) => {
              const phaseEvents = runEvents.filter((event) => event.phase === step.phase)
              const hasError = phaseEvents.some((event) => event.status === 'error')
              const hasCompleted = phaseEvents.some((event) => event.status === 'completed')
              const isCurrent = progress?.phase === step.phase && loading
              const state = hasError ? 'error' : isCurrent ? 'active' : hasCompleted ? 'done' : index < currentStepIndex ? 'skipped' : 'pending'
              return (
                <div className={`insights-process-step ${state}`} key={step.phase} aria-current={isCurrent ? 'step' : undefined}>
                  <span>{index + 1}</span>
                  <div><strong>{step.label}</strong><small>{state === 'error' ? 'Có lỗi' : state === 'skipped' ? 'Đã bỏ qua' : step.detail}</small></div>
                </div>
              )
            })}
          </div>
          <div className="insights-live-data">
            <div className="insights-live-scope">
              <div className="insights-live-title">
                <span>Đang lấy dữ liệu gì</span>
                <strong>Douyin Discover</strong>
                <small>Dữ liệu công khai từ phiên Douyin đã đăng nhập</small>
                <button
                  type="button"
                  onClick={() => void window.api.openPath(`${outputDir}\\Trend Insights Data\\Douyin`)}
                >
                  Mở thư mục JSON
                </button>
              </div>
              <dl>
                <div><dt>Thao tác hiện tại</dt><dd>{latestRuntimeEvent?.operation ?? 'scheduler_start'}</dd></div>
                <div><dt>Phân mục hiển thị</dt><dd>{selectedCategory}</dd></div>
                <div><dt>Hướng nội dung</dt><dd>{direction.trim() || 'Không giới hạn'}</dd></div>
                <div><dt>Video đã bắt được</dt><dd>{capturedVideos}</dd></div>
                <div><dt>Metadata response</dt><dd>{metadataResponses}</dd></div>
                <div><dt>JSON đã đọc</dt><dd>{parsedResponses}</dd></div>
                <div><dt>Response đang chờ</dt><dd>{pendingResponses}</dd></div>
                <div><dt>Cổng phân tích</dt><dd>{analysisStarted ? 'Đã mở' : 'Đang khóa khi còn thu thập'}</dd></div>
                <div><dt>Chế độ thu thập</dt><dd>Full metadata, không tải file video</dd></div>
                <div><dt>Database chính</dt><dd>Trend Insights Data/Douyin/trend-database.json</dd></div>
                <div><dt>Điểm dừng crawl</dt><dd>4 lượt liên tiếp không còn video mới</dd></div>
                <div><dt>Chu kỳ</dt><dd>Tự động mỗi {effectiveRefreshMinutes} phút</dd></div>
              </dl>
            </div>
            <div className="insights-live-preview">
              <div className="insights-live-preview-head">
                <div><span>Live discovery</span><strong>Xu hướng vừa phát hiện</strong></div>
                <small>{livePreview.length > 0 ? `${livePreview.length} video mẫu từ response thật` : 'Đang chờ response video'}</small>
              </div>
              {currentVideo && (
                <article className="insights-current-video">
                  <span>Video vừa thu thập</span>
                  <strong title={currentVideo.title}>{currentVideo.title}</strong>
                  <small>{currentVideo.author} · {formatNumber(currentVideo.views)} view · {formatNumber(currentVideo.likes)} like</small>
                  {currentVideo.hashtags.length > 0 && (
                    <div>{currentVideo.hashtags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                  )}
                </article>
              )}
              {liveTopics.length > 0 && (
                <div className="insights-live-topics">
                  <strong>Xu hướng đang thu thập</strong>
                  <div>{liveTopics.map((topic) => <span key={topic.label}>#{topic.label} <small>{topic.count}</small></span>)}</div>
                </div>
              )}
              {livePreview.length === 0 ? (
                <div className="insights-live-empty">
                  <strong>Chưa nhận được video</strong>
                  <span>Theo dõi activity bên dưới để biết hệ thống đang chờ ở thao tác nào.</span>
                </div>
              ) : (
                <div className="insights-live-cards">
                  {livePreview.map((video, index) => (
                    <article key={video.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong title={video.title}>{video.title}</strong>
                        <small>{video.author}</small>
                      </div>
                      <dl>
                        <div><dt>View</dt><dd>{formatNumber(video.views)}</dd></div>
                        <div><dt>Like</dt><dd>{formatNumber(video.likes)}</dd></div>
                        <div><dt>Share</dt><dd>{formatNumber(video.shares)}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="insights-activity-head">
            <strong>Hoạt động hệ thống</strong>
            <small>{activities.length} event gần nhất được giữ để debug</small>
          </div>
          <div className="insights-activity-list">
            {[...activities].reverse().slice(0, 24).map((event, index) => (
              <article className={`insights-activity ${event.status}`} key={`${event.timestamp}-${event.operation}-${index}`}>
                <time>{new Date(event.timestamp).toLocaleTimeString('vi-VN')}</time>
                <span className="insights-activity-status">{event.status}</span>
                <div>
                  <code>{event.operation}</code>
                  <p>{event.message}</p>
                  {event.current != null && event.total != null && (
                    <div className="insights-activity-progress"><span style={{ width: `${Math.min(100, event.current / Math.max(1, event.total) * 100)}%` }} /></div>
                  )}
                  {event.details && (
                    <small>{Object.entries(event.details).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {collection && !loading && (
        <div className={`insights-alert ${collection.code === 'COLLECTED' ? 'success' : ''}`}>
          {collection.message} {collection.recommendedAction}
        </div>
      )}

      {!report && !error && !collection && (
        <section className="insights-empty">
          <span>Local evidence first</span>
          <h3>Chọn category và mô tả hướng nội dung của bạn.</h3>
          <p>Công cụ sẽ đọc database xu hướng do collector Douyin cập nhật, sau đó xếp hạng video và rút ra các mẫu có thể hành động.</p>
        </section>
      )}

      {error && <div className="insights-alert">{error}</div>}

      {report && (
        <div className="insights-report">
          <section className={`insights-system-status ${report.systemStatus.code.toLowerCase()}`}>
            <div><span>System status</span><strong>{report.systemStatus.code}</strong></div>
            <p>{report.systemStatus.message}</p>
            <small>{report.systemStatus.recommendedAction}</small>
          </section>
          <section className="insight-metrics">
            <div><span>Video đủ snapshot</span><strong>{report.eligibleVideos}</strong><small>{report.matchedVideos} video đang được xếp hạng</small></div>
            <div><span>Lượt xem trung bình</span><strong>{formatNumber(report.averageViews)}</strong><small>Trong category đã chọn</small></div>
            <div><span>Tương tác trung bình</span><strong>{report.averageEngagementRate}%</strong><small>Like + comment + share có trọng số</small></div>
            <div><span>Độ tin cậy</span><strong>{report.matchedVideos >= 20 ? 'Cao' : report.matchedVideos >= 8 ? 'Vừa' : 'Thăm dò'}</strong><small>Dựa trên kích thước mẫu</small></div>
          </section>

          {report.warnings.map((warning) => <div className="insights-alert" key={warning}>{warning}</div>)}

          <section className="insights-scoring">
            <div className="insights-scoring-head">
              <div><span>Priority model</span><h3>Tiêu chí đang dùng để đẩy đề xuất</h3></div>
              <small>Cần tối thiểu {report.recommendationPolicy.minimumSnapshots} snapshot thật</small>
            </div>
            <div className="insights-scoring-grid">
              {report.scoringCriteria.map((criterion, index) => (
                <article key={criterion.key}>
                  <div><span>{index + 1}. {criterion.label}</span><strong>{criterion.weight}%</strong></div>
                  <div className="insights-weight"><span style={{ width: `${criterion.weight}%` }} /></div>
                  <p>{criterion.description}</p>
                </article>
              ))}
            </div>
            <div className="insights-policy">
              <strong>Ngưỡng đề xuất</strong>
              <span>Process now: từ {report.recommendationPolicy.processNowMinScore}{report.recommendationPolicy.processNowRequiresAi ? ' và cần AI' : ''}</span>
              <span>Watch: từ {report.recommendationPolicy.watchMinScore}</span>
              <span>Optional: dưới {report.recommendationPolicy.watchMinScore}</span>
            </div>
            <div className="insights-policy-notes">
              {report.recommendationPolicy.notes.map((note) => <p key={note}>{note}</p>)}
            </div>
          </section>

          <section className="insights-layout">
            <div className="insights-main">
              <div className="insights-section-head"><div><span>Top K ưu tiên</span><h3>Video có score cao nhất để review</h3></div><small>Tối đa 12 video; chưa tải file video ở bước này</small></div>
              <div className="trend-table">
                {report.topVideos.length === 0 && <div className="trend-empty">Chưa có video phù hợp với bộ lọc hiện tại.</div>}
                {report.topVideos.map((video, index) => (
                  <div className="trend-row" key={video.id}>
                    <span className="trend-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="trend-video-copy">
                      <strong title={video.title}>{video.title}</strong>
                      <span>{video.author} · {formatNumber(video.views)} lượt xem · {formatNumber(video.likes)} lượt thích · {video.scoreMode === 'trend' ? `${formatNumber(video.viewVelocity ?? 0)} ${video.velocityMetric === 'views' ? 'view' : 'like'}/giờ` : `snapshot ${video.snapshotCount}/${video.snapshotTarget}`} · trạng thái: {workflowStatusLabel(video.workflowStatus)}</span>
                      <small className={`trend-decision ${video.recommendationStatus}`}>
                        {video.scoreMode === 'provisional' ? 'Đề xuất tạm thời' : recommendationLabel(video.recommendationStatus)}: {video.recommendationReason}
                      </small>
                      <div className="trend-actions">
                        <button type="button" onClick={() => void window.api.openExternal(video.sourceUrl)} disabled={!video.sourceUrl}>
                          Mở video gốc
                        </button>
                        <button type="button" onClick={() => void downloadRecommendation(video)} disabled={!video.sourceUrl || recommendationJob?.state === 'running'}>
                          Chỉ tải video
                        </button>
                        <button className="primary" type="button" onClick={() => void createFinalVideo(video)} disabled={!video.sourceUrl || recommendationJob?.state === 'running'}>
                          Tạo video cuối
                        </button>
                      </div>
                      {recommendationJob?.videoId === video.id && (
                        <div className={`trend-job ${recommendationJob.state}`}>
                          <span>{recommendationJob.mode === 'download' ? 'Download' : 'Auto pipeline'}</span>
                          <strong>{recommendationJob.message}</strong>
                          <small>{Math.round(recommendationJob.progress)}%</small>
                          {recommendationJob.outputs.length > 0 && (
                            <button type="button" onClick={() => void window.api.openPath(outputDir)}>Mở thư mục kết quả</button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="trend-score"><div><span style={{ width: `${((video.trendScore ?? 0) / maxScore) * 100}%` }} /></div><strong>{video.trendScore ?? '—'}</strong></div>
                  </div>
                ))}
              </div>

              <div className="insights-section-head patterns-head"><div><span>Patterns</span><h3>Mẫu đang nổi bật</h3></div></div>
              <div className="pattern-grid">
                {report.patterns.map((pattern) => (
                  <article className="pattern-card" key={pattern.label}>
                    <span>{pattern.label}</span><strong>{pattern.value}</strong><p>{pattern.evidence}</p>
                  </article>
                ))}
              </div>
            </div>

            <aside className="recommendation-panel">
              <div className="insights-section-head"><div><span>Next moves</span><h3>Đề xuất nội dung</h3></div></div>
              <div className="recommendation-list">
                {report.recommendations.map((recommendation, index) => (
                  <article key={recommendation.title}>
                    <div><span>{String(index + 1).padStart(2, '0')}</span><small>{recommendation.confidence === 'high' ? 'Tin cậy cao' : recommendation.confidence === 'medium' ? 'Tin cậy vừa' : 'Nên thử nghiệm'}</small></div>
                    <h4>{recommendation.title}</h4>
                    <p>{recommendation.rationale}</p>
                  </article>
                ))}
              </div>
              <div className="insights-method">
                <strong>Cách đọc insight</strong>
                <p>Điểm cao là tín hiệu để thử nghiệm, không phải bảo đảm video sẽ viral. Nên kiểm thử từng biến và cập nhật dữ liệu thường xuyên.</p>
              </div>
            </aside>
          </section>
        </div>
      )}
    </div>
  )
}
