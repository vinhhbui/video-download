import type {
  TrendCategory,
  TrendInsightReport,
  TrendInsightRequest,
  TrendRecommendationPolicy,
  TrendScoreCriterion,
  TrendPattern,
  TrendRecommendation,
  TrendVideoInsight
} from '../shared/types'
import { hasKey } from './gemini'
import { collectDouyinTrends } from './douyinTrendCollector'
import { inferCreateTimeFromAwemeId } from './douyinMetadataMerge'
import { readTrendDatabase, trendDatabasePath, updateTrendDatabaseScores } from './trendDatabase'
import { categorizeTrendVideo } from './trendCategorization'
import type { TrendInsightProgress, TrendInsightRunResult } from '../shared/types'

type JsonObject = Record<string, unknown>

interface MetricSnapshot {
  collectedAt: string
  views: number
  likes: number
  comments: number
  shares: number
}

type SnapshotStore = Record<string, MetricSnapshot[]>

interface NormalizedVideo extends TrendVideoInsight {
  text: string
  hashtags: string[]
  publishHour: number | null
}

interface SnapshotUpdateSummary {
  eligible: number
}

const SCORING_CRITERIA: TrendScoreCriterion[] = [
  {
    key: 'view_velocity',
    label: 'Tốc độ tăng lượt xem',
    weight: 45,
    description: 'So sánh lượt xem tăng mỗi giờ với video tăng nhanh nhất trong tập đủ điều kiện.'
  },
  {
    key: 'growth_acceleration',
    label: 'Gia tốc tăng trưởng',
    weight: 20,
    description: 'Ưu tiên video đang tăng tốc giữa các chu kỳ; cần ít nhất ba snapshot để có tín hiệu này.'
  },
  {
    key: 'share_rate',
    label: 'Tỷ lệ chia sẻ',
    weight: 20,
    description: 'Điểm tối đa khi số lượt chia sẻ đạt từ 1% lượt xem.'
  },
  {
    key: 'comment_rate',
    label: 'Tỷ lệ bình luận',
    weight: 15,
    description: 'Điểm tối đa khi số bình luận đạt từ 1% lượt xem.'
  }
]

const RECOMMENDATION_POLICY: TrendRecommendationPolicy = {
  minimumSnapshots: 2,
  processNowMinScore: 80,
  watchMinScore: 65,
  processNowRequiresAi: true,
  notes: [
    'Like và tổng lượt xem tuyệt đối hiện không cộng trực tiếp vào Trend Score.',
    'process_now cần Trend Score từ 80 và đã cấu hình AI; từ 65 là watch, thấp hơn là optional.',
    'Quyền sử dụng nội dung không cộng điểm; video vẫn phải được review quyền trước khi xử lý.',
    'Đề xuất format, hashtag và thời lượng được rút từ tối đa 5 video có Trend Score cao nhất.'
  ]
}

function objectAt(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function first(record: JsonObject, keys: string[]): unknown {
  const containers = [record, objectAt(record.statistics), objectAt(record.stats), objectAt(record.author)]
  for (const container of containers) {
    for (const key of keys) if (container[key] != null) return container[key]
  }
  return null
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function dateValue(value: unknown): Date | null {
  if (value == null) return null
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function hashtagsFrom(record: JsonObject, text: string): string[] {
  const raw = first(record, ['hashtags', 'tags', 'text_extra'])
  const values = Array.isArray(raw)
    ? raw.map((item) => typeof item === 'string' ? item : textValue(objectAt(item).hashtag_name || objectAt(item).name))
    : textValue(raw).split(/[\s,]+/)
  const inline = [...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1])
  return [...new Set([...values, ...inline].map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))]
}

function normalize(
  record: JsonObject,
  sourcePath: string,
  index: number,
  storedCategory?: Exclude<TrendCategory, 'all'>
): NormalizedVideo | null {
  const title = textValue(first(record, ['desc', 'title', 'caption', 'description', 'content']))
  const platformId = textValue(first(record, ['aweme_id', 'video_id', 'item_id']))
  const id = platformId || textValue(first(record, ['id'])) || `${sourcePath}:${index}`
  const views = numberValue(first(record, ['play_count', 'views', 'view_count', 'play']))
  const likes = numberValue(first(record, ['digg_count', 'likes', 'like_count', 'digg']))
  const comments = numberValue(first(record, ['comment_count', 'comments']))
  const shares = numberValue(first(record, ['share_count', 'shares']))
  if (!platformId && !views && !likes && !comments && !shares) return null
  const authorRecord = objectAt(record.author)
  const author = textValue(first(record, ['author_name', 'nickname', 'unique_id'])) ||
    textValue(authorRecord.nickname ?? authorRecord.unique_id) || 'Không rõ tác giả'
  const durationRaw = numberValue(first(record, ['duration', 'video_duration']))
  const duration = durationRaw > 1000 ? durationRaw / 1000 : durationRaw || null
  const published = dateValue(first(record, ['create_time', 'published_at', 'date', 'timestamp'])) ??
    dateValue(inferCreateTimeFromAwemeId(platformId))
  const text = `${title} ${hashtagsFrom(record, title).join(' ')}`.toLowerCase()
  const engagementRate = views > 0 ? ((likes + comments * 2 + shares * 3) / views) * 100 : 0
  const ageDays = published ? Math.max(1, (Date.now() - published.getTime()) / 86_400_000) : 30
  const velocity = views / ageDays
  const trendScore = Math.min(100, Math.round(
    Math.log10(views + 1) * 11 + Math.log10(velocity + 1) * 7 + Math.min(engagementRate, 20) * 2
  ))
  return {
    id,
    sourceUrl: platformId ? `https://www.douyin.com/video/${platformId}` : '',
    title: title || 'Video không có tiêu đề',
    author,
    category: storedCategory ?? categorizeTrendVideo(record),
    views,
    likes,
    comments,
    shares,
    engagementRate,
    trendScore,
    duration,
    publishedAt: published?.toISOString() ?? null,
    sourcePath,
    snapshotCount: 0,
    viewVelocity: null,
    velocityMetric: views > 0 ? 'views' : 'likes',
    scoreMode: 'provisional',
    snapshotTarget: 2,
    workflowStatus: 'discovered',
    statusUpdatedAt: new Date(0).toISOString(),
    growthAcceleration: null,
    dataStatus: 'WAITING_FOR_NEXT_SNAPSHOT',
    rightsStatus: 'unknown',
    recommendationStatus: 'insufficient_data',
    recommendationReason: 'Cần ít nhất hai snapshot metrics thật theo thời gian.',
    text,
    hashtags: hashtagsFrom(record, title),
    publishHour: published?.getHours() ?? null
  }
}

function topFrequency(values: string[]): [string, number] | null {
  const counts = new Map<string, number>()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
}

function buildPatterns(videos: NormalizedVideo[]): TrendPattern[] {
  if (!videos.length) return []
  const tags = topFrequency(videos.flatMap((video) => video.hashtags))
  const durations = videos.map((video) => video.duration).filter((value): value is number => value != null)
  const bestDuration = durations.length ? Math.round(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)]) : null
  const bestHour = topFrequency(videos.map((video) => video.publishHour).filter((hour): hour is number => hour != null).map(String))
  const patterns: TrendPattern[] = []
  if (tags) patterns.push({ label: 'Chủ đề lặp lại', value: `#${tags[0]}`, evidence: `Xuất hiện trong ${tags[1]} video của tập dữ liệu.` })
  if (bestDuration) patterns.push({ label: 'Độ dài trung vị', value: `${bestDuration} giây`, evidence: `Tính trên ${durations.length} video có dữ liệu thời lượng.` })
  if (bestHour) patterns.push({ label: 'Giờ đăng phổ biến', value: `${bestHour[0].padStart(2, '0')}:00`, evidence: `${bestHour[1]} video được đăng quanh khung giờ này.` })
  const best = videos[0]
  patterns.push({ label: 'Tín hiệu mạnh nhất', value: `${best.trendScore ?? 0}/100`, evidence: `${best.title.slice(0, 70)}${best.title.length > 70 ? '…' : ''}` })
  return patterns
}

function applyStoredSnapshots(
  videos: NormalizedVideo[],
  store: SnapshotStore,
  aiConfigured: boolean,
  minimumSnapshots: number,
  snapshotIntervalMinutes: number
): SnapshotUpdateSummary {
  const eligible: NormalizedVideo[] = []
  for (const video of videos) {
    const rawHistory = store[video.id] ?? []
    const history: MetricSnapshot[] = []
    let nextAllowedBefore = Number.POSITIVE_INFINITY
    for (let index = rawHistory.length - 1; index >= 0; index--) {
      const snapshotTime = new Date(rawHistory[index].collectedAt).getTime()
      if (!Number.isFinite(snapshotTime) || snapshotTime > nextAllowedBefore) continue
      history.unshift(rawHistory[index])
      nextAllowedBefore = snapshotTime - snapshotIntervalMinutes * 60_000
    }
    video.snapshotCount = history.length
    video.snapshotTarget = minimumSnapshots
    if (video.snapshotCount < Math.max(2, minimumSnapshots)) {
      continue
    }

    const current = history[video.snapshotCount - 1]
    const previous = history[video.snapshotCount - 2]
    const elapsedHours = Math.max(0.01, (new Date(current.collectedAt).getTime() - new Date(previous.collectedAt).getTime()) / 3_600_000)
    const currentMetric = video.velocityMetric === 'views' ? current.views : current.likes
    const previousMetric = video.velocityMetric === 'views' ? previous.views : previous.likes
    video.viewVelocity = (currentMetric - previousMetric) / elapsedHours
    if (video.snapshotCount >= 3) {
      const beforePrevious = history[video.snapshotCount - 3]
      const priorHours = Math.max(0.01, (new Date(previous.collectedAt).getTime() - new Date(beforePrevious.collectedAt).getTime()) / 3_600_000)
      const previousBasis = video.velocityMetric === 'views' ? previous.views : previous.likes
      const beforePreviousBasis = video.velocityMetric === 'views' ? beforePrevious.views : beforePrevious.likes
      const priorVelocity = (previousBasis - beforePreviousBasis) / priorHours
      video.growthAcceleration = video.viewVelocity - priorVelocity
    }
    video.dataStatus = 'READY_FOR_REVIEW'
    video.scoreMode = 'trend'
    eligible.push(video)
  }

  const maxLikes = Math.max(1, ...videos.map((video) => Math.log10(video.likes + 1)))
  const maxShares = Math.max(1, ...videos.map((video) => Math.log10(video.shares + 1)))
  const maxComments = Math.max(1, ...videos.map((video) => Math.log10(video.comments + 1)))
  for (const video of videos.filter((item) => item.scoreMode === 'provisional')) {
    const likeScore = Math.log10(video.likes + 1) / maxLikes
    const shareScore = Math.log10(video.shares + 1) / maxShares
    const commentScore = Math.log10(video.comments + 1) / maxComments
    video.trendScore = Math.round(Math.min(100, likeScore * 50 + shareScore * 30 + commentScore * 20))
    video.recommendationStatus = minimumSnapshots === 1
      ? video.trendScore >= 65 ? 'watch' : 'optional'
      : 'insufficient_data'
    video.recommendationReason = minimumSnapshots === 1
      ? `Điểm tạm tính từ lượt thích, chia sẻ và bình luận của snapshot đầu tiên.`
      : `Điểm tạm tính từ tương tác hiện tại; đã có ${video.snapshotCount}/${minimumSnapshots} snapshot.`
    if (minimumSnapshots === 1) {
      video.dataStatus = 'READY_FOR_REVIEW'
      eligible.push(video)
    }
  }

  const maxVelocity = Math.max(1, ...eligible.map((video) => Math.max(0, video.viewVelocity ?? 0)))
  const maxAcceleration = Math.max(1, ...eligible.map((video) => Math.max(0, video.growthAcceleration ?? 0)))
  for (const video of eligible) {
    const velocityScore = Math.max(0, video.viewVelocity ?? 0) / maxVelocity
    const accelerationScore = Math.max(0, video.growthAcceleration ?? 0) / maxAcceleration
    const engagementBase = video.views > 0 ? video.views : video.likes
    const shareRate = engagementBase ? video.shares / engagementBase : 0
    const commentRate = engagementBase ? video.comments / engagementBase : 0
    video.trendScore = Math.round(Math.min(100, velocityScore * 45 + accelerationScore * 20 + Math.min(1, shareRate * 100) * 20 + Math.min(1, commentRate * 100) * 15))
    video.recommendationStatus = aiConfigured && video.trendScore >= 80 ? 'process_now' : video.trendScore >= 65 ? 'watch' : 'optional'
    const velocityLabel = video.velocityMetric === 'views' ? 'lượt xem' : 'lượt thích'
    const evidence = `${Math.round(video.viewVelocity ?? 0).toLocaleString('vi-VN')} ${velocityLabel}/giờ, chia sẻ ${(shareRate * 100).toFixed(2)}%, bình luận ${(commentRate * 100).toFixed(2)}%, ${video.snapshotCount} snapshot.`
    video.recommendationReason = aiConfigured
      ? evidence
      : `${evidence} Chưa cấu hình AI nên không thể chuyển sang process_now.`
  }
  return { eligible: eligible.length }
}

function buildRecommendations(videos: NormalizedVideo[], request: TrendInsightRequest): TrendRecommendation[] {
  if (!videos.length) return []
  const top = videos.slice(0, Math.min(5, videos.length))
  const tags = topFrequency(top.flatMap((video) => video.hashtags))
  const medianDuration = top.map((video) => video.duration).filter((value): value is number => value != null).sort((a, b) => a - b)
  const duration = medianDuration.length ? Math.round(medianDuration[Math.floor(medianDuration.length / 2)]) : 30
  const direction = request.direction.trim() || 'hướng nội dung hiện tại'
  return [
    {
      title: `Thử format ${duration} giây với hook ngay 2 giây đầu`,
      rationale: `Các video đứng đầu trong category cho thấy format ngắn, vào thẳng vấn đề phù hợp với ${direction}.`,
      confidence: top.length >= 5 ? 'high' : 'medium'
    },
    {
      title: tags ? `Xây series xoay quanh #${tags[0]}` : 'Xây series từ chủ đề có điểm xu hướng cao nhất',
      rationale: tags ? `Hashtag này lặp lại nhiều nhất trong nhóm video dẫn đầu.` : 'Tập dữ liệu chưa có hashtag ổn định; nên kiểm thử theo series để tạo tín hiệu.',
      confidence: tags && tags[1] >= 3 ? 'high' : 'exploratory'
    },
    {
      title: 'Giữ một biến khác biệt cho mỗi lần thử',
      rationale: 'Thay riêng hook, độ dài hoặc caption giữa các video để xác định yếu tố thực sự làm tăng tương tác.',
      confidence: 'medium'
    }
  ]
}

function emitAnalysisProgress(
  onProgress: (progress: TrendInsightProgress) => void,
  operation: string,
  message: string,
  status: TrendInsightProgress['status'],
  details?: TrendInsightProgress['details']
): void {
  onProgress({
    phase: 'analyzing',
    operation,
    message,
    status,
    timestamp: new Date().toISOString(),
    details
  })
}

export async function analyzeTrends(
  request: TrendInsightRequest,
  onProgress: (progress: TrendInsightProgress) => void = () => undefined
): Promise<TrendInsightReport> {
  const snapshotIntervalMinutes = Math.min(720, Math.max(5, Number(request.snapshotIntervalMinutes) || 30))
  const minimumSnapshots = Math.min(10, Math.max(1, Number(request.minimumSnapshots) || 2))
  emitAnalysisProgress(onProgress, 'metadata_scan', 'Đang đọc database xu hướng local.', 'running')
  const database = await readTrendDatabase(request.dataDir)
  const allDatabaseEntries = Object.values(database.videos)
  const databaseEntries = allDatabaseEntries.filter((entry) => entry.isCurrentlyTrending)
  const databaseReady = databaseEntries.length > 0
  emitAnalysisProgress(onProgress, 'metadata_scan', `Database có ${allDatabaseEntries.length} video lịch sử và ${databaseEntries.length} video thuộc lần crawl hiện tại.`, 'completed', {
    databaseVideos: allDatabaseEntries.length,
    currentVideos: databaseEntries.length,
    databaseFile: trendDatabasePath(request.dataDir)
  })
  emitAnalysisProgress(onProgress, 'metadata_normalize', 'Đang chuẩn hóa video từ database.', 'running')
  const videos: NormalizedVideo[] = []
  databaseEntries.forEach((entry, index) => {
    const normalized = normalize(entry.metadata, trendDatabasePath(request.dataDir), index, entry.category)
    if (normalized) {
      normalized.workflowStatus = entry.status
      normalized.statusUpdatedAt = entry.statusUpdatedAt
      videos.push(normalized)
    }
  })
  const uniqueVideos = [...new Map(videos.map((video) => [video.id, video])).values()]
  const videosWithMetrics = uniqueVideos.filter((video) => video.views > 0 || video.likes > 0 || video.comments > 0 || video.shares > 0).length
  emitAnalysisProgress(onProgress, 'metadata_normalize', `Đã chuẩn hóa ${videos.length} record thành ${uniqueVideos.length} video không trùng.`, 'completed', {
    records: videos.length,
    uniqueVideos: uniqueVideos.length,
    videosWithMetrics
  })
  if (uniqueVideos.length > 0 && videosWithMetrics === 0) {
    emitAnalysisProgress(onProgress, 'metrics_validation', 'Tất cả metrics đang bằng 0; Trend Score tạo ra sẽ không có giá trị để ưu tiên.', 'warning', {
      affectedVideos: uniqueVideos.length
    })
  }
  emitAnalysisProgress(onProgress, 'snapshot_update', 'Đang đối chiếu snapshot metrics của toàn bộ video trong lần crawl hiện tại.', 'running')
  const snapshots: SnapshotStore = Object.fromEntries(databaseEntries.map((entry) => [entry.id, entry.snapshots]))
  const aiConfigured = await hasKey()
  let eligibleVideos = 0
  const categoryGroups = new Map<TrendCategory, NormalizedVideo[]>()
  for (const video of uniqueVideos) {
    const group = categoryGroups.get(video.category) ?? []
    group.push(video)
    categoryGroups.set(video.category, group)
  }
  for (const group of categoryGroups.values()) {
    eligibleVideos += applyStoredSnapshots(group, snapshots, aiConfigured, minimumSnapshots, snapshotIntervalMinutes).eligible
  }
  emitAnalysisProgress(onProgress, 'snapshot_update', 'Đã nạp lịch sử snapshot và tính tín hiệu theo từng category.', 'completed', {
    databaseSnapshots: Object.values(snapshots).reduce((total, history) => total + history.length, 0),
    eligibleVideos,
    minimumSnapshots
  })

  emitAnalysisProgress(onProgress, 'trend_scoring', `Đang lưu điểm mới của toàn bộ video; mục tiêu ${minimumSnapshots} snapshot.`, 'running')
  const calculatedAt = new Date().toISOString()
  const scoreUpdates = new Map(uniqueVideos.map((video) => [video.id, {
    category: video.category as Exclude<TrendCategory, 'all'>,
    trendScore: video.trendScore,
    engagementRate: video.engagementRate,
    viewVelocity: video.viewVelocity,
    velocityMetric: video.velocityMetric,
    growthAcceleration: video.growthAcceleration,
    scoreMode: video.scoreMode,
    snapshotCount: video.snapshotCount,
    snapshotTarget: video.snapshotTarget,
    dataStatus: video.dataStatus,
    recommendationStatus: video.recommendationStatus,
    recommendationReason: video.recommendationReason
  }]))
  const persistedScores = await updateTrendDatabaseScores(request.dataDir, scoreUpdates, calculatedAt)
  emitAnalysisProgress(onProgress, 'trend_scoring', `Đã tính lại và lưu điểm cho ${persistedScores} video của lần crawl hiện tại.`, 'completed', {
    scoredVideos: persistedScores,
    eligibleVideos
  })

  emitAnalysisProgress(onProgress, 'filtering', 'Đang áp dụng category và hướng nội dung sau khi hoàn tất chấm điểm.', 'running')
  const directionTerms = request.direction.toLowerCase().split(/[\s,]+/).filter((term) => term.length >= 3)
  const filtered = uniqueVideos.filter((video) =>
    (request.category === 'all' || video.category === request.category) &&
    (!directionTerms.length || directionTerms.some((term) => video.text.includes(term)))
  )
  emitAnalysisProgress(onProgress, 'filtering', `Có ${filtered.length} video khớp bộ lọc hiện tại.`, 'completed', {
    inputVideos: uniqueVideos.length,
    matchedVideos: filtered.length,
    category: request.category
  })
  const ranked = filtered.filter((video) => video.dataStatus === 'READY_FOR_REVIEW').sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0))
  const displayed = [...filtered].sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0))
  const average = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const warnings: string[] = []
  if (!databaseReady) warnings.push('Database xu hướng chưa có video. Hãy chạy một chu kỳ thu thập Douyin.')
  else if (!filtered.length) warnings.push('Có metadata nhưng chưa có video khớp category hoặc hướng nội dung đã chọn.')
  else if (!ranked.length) warnings.push(`Đang hiển thị điểm tạm thời. Cần ${minimumSnapshots} snapshot, cách nhau ít nhất ${snapshotIntervalMinutes} phút, để chấm tốc độ xu hướng.`)
  else if (ranked.length < 10) warnings.push('Mẫu dữ liệu còn nhỏ; insight hiện mang tính thăm dò.')
  if (!aiConfigured) warnings.push('AI_NOT_CONFIGURED: Vietnam Fit và Affiliate Potential chưa được tính.')
  const systemStatus = !databaseReady
    ? { code: 'DATA_SOURCE_NOT_CONFIGURED' as const, message: 'Database xu hướng chưa có dữ liệu.', recommendedAction: 'Chạy thu thập Douyin để thêm snapshot đầu tiên vào database.' }
    : !ranked.length
      ? { code: 'WAITING_FOR_NEXT_SNAPSHOT' as const, message: `Chưa đủ ${minimumSnapshots} snapshot để chấm tốc độ xu hướng; danh sách tạm thời vẫn được hiển thị.`, recommendedAction: `Thu thập lại metrics sau ít nhất ${snapshotIntervalMinutes} phút.` }
      : ranked.length < 3
        ? { code: 'INSUFFICIENT_DATA' as const, message: 'Dữ liệu có thể phân tích nhưng mẫu còn nhỏ.', recommendedAction: 'Theo dõi thêm creator, hashtag hoặc video cùng category.' }
        : { code: 'LOCAL_METADATA_READY' as const, message: 'Dữ liệu local đủ điều kiện để tạo danh sách review.', recommendedAction: 'Kiểm tra quyền sử dụng trước khi phê duyệt bất kỳ video nào.' }
  emitAnalysisProgress(onProgress, 'recommendation_build', 'Đang tổng hợp pattern và đề xuất từ nhóm video dẫn đầu.', 'running')
  const patterns = buildPatterns(displayed)
  const recommendations = buildRecommendations(displayed, request)
  emitAnalysisProgress(onProgress, 'recommendation_build', `Đã tạo ${patterns.length} pattern và ${recommendations.length} đề xuất.`, 'completed', {
    patterns: patterns.length,
    recommendations: recommendations.length,
    aiConfigured
  })
  return {
    category: request.category,
    direction: request.direction,
    generatedAt: new Date().toISOString(),
    scannedFiles: databaseReady ? 1 : 0,
    matchedVideos: filtered.length,
    eligibleVideos: ranked.length,
    averageViews: Math.round(average(displayed.map((video) => video.views))),
    averageEngagementRate: Number(average(displayed.map((video) => video.engagementRate)).toFixed(2)),
    topVideos: displayed.slice(0, 12).map(({ text: _text, hashtags: _hashtags, publishHour: _hour, ...video }) => video),
    patterns,
    recommendations,
    scoringCriteria: SCORING_CRITERIA,
    recommendationPolicy: { ...RECOMMENDATION_POLICY, minimumSnapshots },
    warnings,
    systemStatus,
    aiStatus: aiConfigured ? 'READY' : 'AI_NOT_CONFIGURED'
  }
}

let activeRun: Promise<TrendInsightRunResult> | null = null

/** Run collection and analysis as one idempotent workflow. */
export function runTrendInsights(
  request: TrendInsightRequest,
  onProgress: (progress: TrendInsightProgress) => void
): Promise<TrendInsightRunResult> {
  if (activeRun) return activeRun
  activeRun = (async () => {
    const collection = await collectDouyinTrends(request.dataDir, onProgress, request.updateCategories)
    if (collection.code !== 'COLLECTED') {
      const report = await analyzeTrends(request, onProgress)
      const fallbackWarning = `Không thể làm mới dữ liệu Douyin: ${collection.message} Insight đang dùng database local gần nhất.`
      const cachedReport: TrendInsightReport = {
        ...report,
        warnings: [fallbackWarning, ...report.warnings]
      }
      onProgress({
        phase: 'finished',
        operation: 'workflow_local_fallback',
        message: 'Không lấy được dữ liệu mới; đã dựng Insight từ database local gần nhất.',
        status: 'warning',
        timestamp: new Date().toISOString(),
        details: {
          collectionCode: collection.code,
          collectedVideos: collection.collectedVideos,
          cachedVideos: cachedReport.matchedVideos,
          eligibleVideos: cachedReport.eligibleVideos
        }
      })
      return { collection, report: cachedReport }
    }
    const report = await analyzeTrends(request, onProgress)
    onProgress({
      phase: 'finished',
      operation: 'workflow_complete',
      message: 'Đã hoàn tất toàn bộ luồng Insight.',
      status: collection.code === 'COLLECTED' ? 'completed' : 'warning',
      timestamp: new Date().toISOString(),
      details: { collectionCode: collection.code, eligibleVideos: report.eligibleVideos }
    })
    return { collection, report }
  })().finally(() => {
    activeRun = null
  })
  return activeRun
}
