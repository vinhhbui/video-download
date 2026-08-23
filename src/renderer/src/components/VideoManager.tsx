import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { TrendCategory, TrendManagedVideo, TrendVideoWorkflowStatus } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'

type ManagedCategory = Exclude<TrendCategory, 'all'>
type QualityLevel = 'qualified' | 'promising' | 'collecting' | 'not_qualified'
type QualityFilter = 'all' | QualityLevel
type PipelineModel = 'base' | 'small' | 'medium'

interface VideoAutomationJob {
  id: string
  videoId: string
  mode: 'download' | 'final_video'
  state: 'running' | 'completed' | 'error'
  message: string
  progress: number
  outputs: string[]
}

const STATUSES: Array<{ value: TrendVideoWorkflowStatus; label: string }> = [
  { value: 'discovered', label: 'Mới phát hiện' },
  { value: 'shortlisted', label: 'Đã chọn' },
  { value: 'downloading', label: 'Đang tải' },
  { value: 'downloaded', label: 'Đã tải' },
  { value: 'processing', label: 'Đang xử lý' },
  { value: 'exported', label: 'Đã xuất video' },
  { value: 'published', label: 'Đã đăng' },
  { value: 'rejected', label: 'Đã bỏ qua' }
]

const CATEGORIES: Array<{ value: ManagedCategory; label: string }> = [
  { value: 'education', label: 'Giáo dục' },
  { value: 'technology', label: 'Công nghệ' },
  { value: 'beauty', label: 'Làm đẹp' },
  { value: 'food', label: 'Ẩm thực' },
  { value: 'travel', label: 'Du lịch' },
  { value: 'entertainment', label: 'Giải trí' },
  { value: 'business', label: 'Kinh doanh' },
  { value: 'lifestyle', label: 'Đời sống' }
]

const QUALITY_OPTIONS: Array<{ value: QualityFilter; label: string }> = [
  { value: 'all', label: 'Tất cả chất lượng' },
  { value: 'qualified', label: 'Đạt tiêu chí review' },
  { value: 'promising', label: 'Có tiềm năng' },
  { value: 'collecting', label: 'Đang thu thập' },
  { value: 'not_qualified', label: 'Chưa đạt' }
]

const formatNumber = (value: number): string => new Intl.NumberFormat('vi-VN', {
  notation: value >= 10_000 ? 'compact' : 'standard',
  maximumFractionDigits: 1
}).format(value)

const formatDuration = (seconds: number | null): string => {
  if (seconds == null) return 'Chưa rõ'
  const rounded = Math.max(0, Math.round(seconds))
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

const formatDate = (value: string | null): string => value
  ? new Date(value).toLocaleString('vi-VN')
  : 'Chưa rõ'

const categoryLabel = (category: ManagedCategory): string =>
  CATEGORIES.find((item) => item.value === category)?.label ?? category

const qualityLevel = (video: TrendManagedVideo): QualityLevel => {
  if (video.dataStatus === 'READY_FOR_REVIEW' && (video.trendScore ?? 0) >= 65) return 'qualified'
  if ((video.trendScore ?? 0) >= 65) return 'promising'
  if (video.dataStatus === 'WAITING_FOR_NEXT_SNAPSHOT') return 'collecting'
  return 'not_qualified'
}

const qualityLabel = (level: QualityLevel): string => ({
  qualified: 'Đạt tiêu chí review',
  promising: 'Có tiềm năng',
  collecting: 'Đang thu thập dữ liệu',
  not_qualified: 'Chưa đạt tiêu chí'
})[level]

const qualityRank = (level: QualityLevel): number => ({
  qualified: 4,
  promising: 3,
  collecting: 2,
  not_qualified: 1
})[level]

function VideoCover({ video }: { video: TrendManagedVideo }): JSX.Element {
  const [failed, setFailed] = useState(false)
  return (
    <button className="video-manager-cover" type="button" onClick={() => void window.api.openExternal(video.sourceUrl)}>
      {video.coverUrl && !failed
        ? <img src={video.coverUrl} alt={`Ảnh bìa ${video.title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <span>Không có ảnh bìa</span>}
      <small>{formatDuration(video.duration)}</small>
    </button>
  )
}

export default function VideoManager({ outputDir }: { outputDir: string }): JSX.Element {
  const [videos, setVideos] = useState<TrendManagedVideo[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | TrendVideoWorkflowStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | ManagedCategory>('all')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [automationJob, setAutomationJob] = useState<VideoAutomationJob | null>(null)
  const [pipelineModel] = usePersistedState<PipelineModel>('tblao.auto.model', 'small')
  const [pipelineUseGpu] = usePersistedState('tblao.auto.useGpu', true)

  const load = async (): Promise<void> => {
    if (!outputDir) return
    setLoading(true)
    setError(null)
    try {
      setVideos(await window.api.managedTrendVideos(outputDir))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [outputDir])

  useEffect(() => {
    const offDownload = window.api.onDyProgress((event) => {
      setAutomationJob((current) => current?.id === event.id && current.mode === 'download'
        ? {
            ...current,
            message: event.line || (event.status === 'finished' ? 'Đã tải video.' : 'Đang tải video.'),
            progress: event.status === 'finished' ? 100 : event.status === 'preparing' ? 10 : 55
          }
        : current)
    })
    const offAutomation = window.api.onAutomationProgress((event) => {
      setAutomationJob((current) => current?.id === event.id && current.mode === 'final_video'
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
    const updated = await window.api.updateTrendVideoStatus({
      dataDir: outputDir,
      id: videoId,
      status,
      outputFiles,
      notes
    })
    if (updated) {
      setVideos((current) => current.map((item) => item.id === updated.id ? updated : item))
    }
  }

  const updateStatus = async (video: TrendManagedVideo, status: TrendVideoWorkflowStatus): Promise<void> => {
    setSavingId(video.id)
    setError(null)
    try {
      await persistWorkflowStatus(video.id, status)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    } finally {
      setSavingId(null)
    }
  }

  const downloadVideo = async (video: TrendManagedVideo): Promise<void> => {
    if (!video.sourceUrl || !outputDir || automationJob?.state === 'running') return
    const id = crypto.randomUUID()
    setError(null)
    setAutomationJob({
      id,
      videoId: video.id,
      mode: 'download',
      state: 'running',
      message: 'Đang chuẩn bị tải video.',
      progress: 0,
      outputs: []
    })
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
      setAutomationJob({
        id,
        videoId: video.id,
        mode: 'download',
        state: result.ok ? 'completed' : 'error',
        message: result.ok
          ? 'Đã tải video và metadata vào thư mục đầu ra.'
          : result.error || 'Không thể tải video.',
        progress: result.ok ? 100 : 0,
        outputs: result.files ?? []
      })
      await persistWorkflowStatus(
        video.id,
        result.ok ? 'downloaded' : 'shortlisted',
        result.files,
        result.error ?? undefined
      )
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError)
      setAutomationJob({
        id,
        videoId: video.id,
        mode: 'download',
        state: 'error',
        message,
        progress: 0,
        outputs: []
      })
      setError(message)
      try {
        await persistWorkflowStatus(video.id, 'shortlisted', undefined, message)
      } catch {
        // Keep the original workflow error visible when status persistence also fails.
      }
    }
  }

  const createFinalVideo = async (video: TrendManagedVideo): Promise<void> => {
    if (!video.sourceUrl || !outputDir || automationJob?.state === 'running') return
    const id = crypto.randomUUID()
    setError(null)
    setAutomationJob({
      id,
      videoId: video.id,
      mode: 'final_video',
      state: 'running',
      message: 'Đang chuẩn bị workflow tạo video cuối.',
      progress: 0,
      outputs: []
    })
    try {
      await persistWorkflowStatus(video.id, 'processing')
      const result = await window.api.automationRun(id, {
        url: video.sourceUrl,
        outputDir,
        model: pipelineModel,
        useGpu: pipelineUseGpu
      })
      setAutomationJob({
        id,
        videoId: video.id,
        mode: 'final_video',
        state: result.ok ? 'completed' : 'error',
        message: result.ok
          ? 'Video cuối đã hoàn tất và đang chờ bạn duyệt.'
          : result.error || 'Workflow tạo video thất bại.',
        progress: result.ok ? 100 : 0,
        outputs: result.outputs
      })
      await persistWorkflowStatus(
        video.id,
        result.ok ? 'exported' : 'shortlisted',
        result.outputs,
        result.error ?? undefined
      )
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError)
      setAutomationJob({
        id,
        videoId: video.id,
        mode: 'final_video',
        state: 'error',
        message,
        progress: 0,
        outputs: []
      })
      setError(message)
      try {
        await persistWorkflowStatus(video.id, 'shortlisted', undefined, message)
      } catch {
        // Keep the original workflow error visible when status persistence also fails.
      }
    }
  }

  const visibleVideos = useMemo(() => {
    const term = search.trim().toLowerCase()
    return videos
      .filter((video) =>
        (statusFilter === 'all' || video.status === statusFilter) &&
        (categoryFilter === 'all' || video.category === categoryFilter) &&
        (qualityFilter === 'all' || qualityLevel(video) === qualityFilter) &&
        (!term || `${video.title} ${video.author} ${video.id} ${video.category} ${video.hashtags.join(' ')} ${video.notes}`.toLowerCase().includes(term))
      )
      .sort((left, right) => {
        const qualityDifference = qualityRank(qualityLevel(right)) - qualityRank(qualityLevel(left))
        if (qualityDifference !== 0) return qualityDifference
        return (right.trendScore ?? -1) - (left.trendScore ?? -1)
      })
  }, [categoryFilter, qualityFilter, search, statusFilter, videos])

  const qualifiedCount = videos.filter((video) => qualityLevel(video) === 'qualified').length
  const trendingCount = videos.filter((video) => video.isCurrentlyTrending).length
  const coverCount = videos.filter((video) => Boolean(video.coverUrl)).length

  return (
    <div className="video-manager-page">
      <section className="video-manager-summary">
        <div><span>Tổng video</span><strong>{videos.length}</strong><small>Metadata được lưu trong database</small></div>
        <div className="quality-summary"><span>Đạt tiêu chí review</span><strong>{qualifiedCount}</strong><small>Đủ snapshot và Trend Score từ 65</small></div>
        <div><span>Đang trong xu hướng</span><strong>{trendingCount}</strong><small>Thuộc phạm vi cập nhật gần nhất</small></div>
        <div><span>Có ảnh bìa</span><strong>{coverCount}</strong><small>{videos.length ? Math.round(coverCount / videos.length * 100) : 0}% thư viện có thumbnail</small></div>
      </section>

      <section className="video-manager-toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tiêu đề, tác giả, hashtag hoặc ID" />
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as 'all' | ManagedCategory)}>
          <option value="all">Tất cả phân mục</option>
          {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
        <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as QualityFilter)}>
          {QUALITY_OPTIONS.map((quality) => <option key={quality.value} value={quality.value}>{quality.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | TrendVideoWorkflowStatus)}>
          <option value="all">Tất cả trạng thái</option>
          {STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
        <button className="btn" onClick={() => void load()} disabled={loading}>{loading ? 'Đang tải' : 'Làm mới'}</button>
        <button className="btn" onClick={() => void window.api.openPath(`${outputDir}\\Trend Insights Data\\Douyin`)} disabled={!outputDir}>Mở database</button>
      </section>

      {error && <div className="insights-alert">{error}</div>}

      <section className="video-manager-list">
        {!loading && visibleVideos.length === 0 && <div className="trend-empty">Chưa có video phù hợp với bộ lọc.</div>}
        {visibleVideos.map((video) => {
          const quality = qualityLevel(video)
          return (
            <article className={`video-manager-card ${quality}`} key={video.id}>
              <VideoCover video={video} />
              <div className="video-manager-content">
                <div className="video-manager-card-head">
                  <div className="video-manager-badges">
                    <span className="video-category-badge">{categoryLabel(video.category)}</span>
                    <span className={`video-quality-badge ${quality}`}>{qualityLabel(quality)}</span>
                    {video.isCurrentlyTrending && <span className="video-current-badge">Đang xu hướng</span>}
                  </div>
                  <div className="video-score-block">
                    <small>Trend Score</small>
                    <strong>{video.trendScore ?? '—'}</strong>
                  </div>
                </div>

                <div className="video-manager-copy">
                  <strong title={video.title}>{video.title}</strong>
                  <span>{video.author} · ID {video.id}</span>
                  <small>Đăng: {formatDate(video.publishedAt)} · Cập nhật: {formatDate(video.lastSeenAt)}</small>
                </div>

                <div className="video-hashtags">
                  {video.hashtags.length > 0
                    ? video.hashtags.slice(0, 8).map((hashtag) => <span key={hashtag}>#{hashtag}</span>)
                    : <small>Chưa có hashtag</small>}
                </div>

                <div className="video-quality-evidence">
                  <strong>{qualityLabel(quality)}</strong>
                  <p>{video.recommendationReason}</p>
                </div>

                <dl className="video-manager-metrics">
                  <div><dt>Lượt xem</dt><dd>{formatNumber(video.views)}</dd></div>
                  <div><dt>Like</dt><dd>{formatNumber(video.likes)}</dd></div>
                  <div><dt>Comment</dt><dd>{formatNumber(video.comments)}</dd></div>
                  <div><dt>Share</dt><dd>{formatNumber(video.shares)}</dd></div>
                  <div><dt>Lưu</dt><dd>{formatNumber(video.favorites)}</dd></div>
                </dl>

                <div className="video-manager-signals">
                  <span>Tương tác <strong>{video.engagementRate.toFixed(2)}%</strong></span>
                  <span>Tốc độ <strong>{video.viewVelocity == null ? 'Chưa đủ dữ liệu' : `${formatNumber(video.viewVelocity)}/giờ`}</strong></span>
                  <span>Snapshot <strong>{video.snapshotCount}/{video.snapshotTarget}</strong></span>
                  <span>Phát hiện <strong>{video.collectionCount} lần</strong></span>
                </div>
                {video.notes && <p className="video-manager-notes">Ghi chú: {video.notes}</p>}
              </div>

              <aside className="video-manager-side">
                <div className="video-manager-status">
                  <label>Trạng thái xử lý</label>
                  <select value={video.status} onChange={(event) => void updateStatus(video, event.target.value as TrendVideoWorkflowStatus)} disabled={savingId === video.id}>
                    {STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                  <small>{savingId === video.id ? 'Đang lưu' : `Đổi lúc ${formatDate(video.statusUpdatedAt)}`}</small>
                </div>
                <div className="video-manager-actions">
                  <button type="button" onClick={() => void window.api.openExternal(video.sourceUrl)}>Mở video nguồn</button>
                  <button
                    className="automation-action"
                    type="button"
                    onClick={() => void downloadVideo(video)}
                    disabled={!video.sourceUrl || !outputDir || automationJob?.state === 'running'}
                  >
                    {automationJob?.videoId === video.id && automationJob.mode === 'download' && automationJob.state === 'running'
                      ? 'Đang tải video'
                      : 'Chỉ tải video'}
                  </button>
                  <button
                    className="automation-action primary"
                    type="button"
                    onClick={() => void createFinalVideo(video)}
                    disabled={!video.sourceUrl || !outputDir || automationJob?.state === 'running'}
                  >
                    {automationJob?.videoId === video.id && automationJob.mode === 'final_video' && automationJob.state === 'running'
                      ? 'Đang tạo video'
                      : 'Tạo video cuối'}
                  </button>
                  {video.outputFiles.length > 0 && <button type="button" onClick={() => void window.api.showItem(video.outputFiles[0])}>Mở file xuất</button>}
                  {video.publishedUrl && <button type="button" onClick={() => void window.api.openExternal(video.publishedUrl)}>Mở video đã đăng</button>}
                </div>
                {automationJob?.videoId === video.id && (
                  <div className={`video-manager-job ${automationJob.state}`} aria-live="polite">
                    <div className="video-manager-job-head">
                      <strong>{automationJob.mode === 'download' ? 'Tải nguồn' : 'Tạo video cuối'}</strong>
                      <span>{automationJob.progress}%</span>
                    </div>
                    <div className="video-manager-job-progress">
                      <span style={{ width: `${Math.max(0, Math.min(100, automationJob.progress))}%` }} />
                    </div>
                    <small>{automationJob.message}</small>
                  </div>
                )}
              </aside>
            </article>
          )
        })}
      </section>
    </div>
  )
}
