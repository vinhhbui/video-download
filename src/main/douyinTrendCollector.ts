import { BrowserWindow, session as electronSession } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TrendCategory, TrendCollectionStatus, TrendDiscoveryPreview, TrendDiscoveryTopic, TrendInsightProgress } from '../shared/types'
import { DY_PARTITION, dyCookieStatus, readDyCookies } from './douyinCookies'
import { inferCreateTimeFromAwemeId, mergeDouyinMetadata } from './douyinMetadataMerge'
import { debugRaw, logInfo, logWarn } from './logger'
import { updateTrendDatabase } from './trendDatabase'
import { categorizeTrendVideo, STORED_TREND_CATEGORIES } from './trendCategorization'

type JsonRecord = Record<string, unknown>

interface CollectionRunSummary {
  runId: string
  startedAt: string
  completedAt: string
  status: 'completed' | 'incomplete' | 'blocked' | 'error'
  code: TrendCollectionStatus['code']
  message: string
  videoCount: number
  videosWithMetrics: number
  metadataResponses: number
  parsedResponses: number
  file: string
}

const SAFETY_MAX_SCROLLS = 120
const STABLE_SCROLL_LIMIT = 4
const MAX_CAPTURE_BODY_BYTES = 25_000_000
const RESPONSE_DRAIN_TIMEOUT_MS = 5_000
const PAGE_LOAD_TIMEOUT_MS = 15_000
const DISCOVERY_URL = 'https://www.douyin.com/discover'

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function managementDir(dataDir: string): string {
  return join(dataDir, 'Trend Insights Data', 'Douyin')
}

async function saveCollectionRun(
  dataDir: string,
  startedAt: string,
  status: CollectionRunSummary['status'],
  code: TrendCollectionStatus['code'],
  message: string,
  records: Map<string, JsonRecord>,
  diagnostics: { metadataResponses: number; parsedResponses: number }
): Promise<CollectionRunSummary> {
  const completedAt = new Date().toISOString()
  const runId = completedAt.replace(/[:.]/g, '-')
  const root = managementDir(dataDir)
  const runsDir = join(root, 'Runs')
  const fileName = `douyin-trends-${runId}.json`
  const items = [...records.values()]
  const videosWithMetrics = items.filter((record) => {
    const statistics = isRecord(record.statistics) ? record.statistics : {}
    return ['play_count', 'digg_count', 'comment_count', 'share_count']
      .some((key) => Number(statistics[key] ?? 0) > 0)
  }).length
  const payload = {
    schemaVersion: 1,
    runId,
    provider: 'authorized_browser',
    source: DISCOVERY_URL,
    mode: 'full_video_metadata',
    startedAt,
    completedAt,
    status,
    code,
    message,
    diagnostics: {
      ...diagnostics,
      videoCount: items.length,
      videosWithMetrics
    },
    topics: trendingTopics(records),
    categories: Object.fromEntries(STORED_TREND_CATEGORIES.map((category) => [
      category,
      items.filter((record) => categorizeTrendVideo(record) === category).map((record) => String(record.aweme_id ?? ''))
    ])),
    items
  }
  await mkdir(runsDir, { recursive: true })
  await writeFile(join(runsDir, fileName), JSON.stringify(payload, null, 2), 'utf-8')
  await writeFile(join(root, 'latest-run.json'), JSON.stringify(payload, null, 2), 'utf-8')

  const summary: CollectionRunSummary = {
    runId,
    startedAt,
    completedAt,
    status,
    code,
    message,
    videoCount: items.length,
    videosWithMetrics,
    metadataResponses: diagnostics.metadataResponses,
    parsedResponses: diagnostics.parsedResponses,
    file: join('Runs', fileName).replace(/\\/g, '/')
  }
  let history: CollectionRunSummary[] = []
  try {
    const parsed = JSON.parse(await readFile(join(root, 'run-index.json'), 'utf-8')) as unknown
    if (Array.isArray(parsed)) history = parsed as CollectionRunSummary[]
  } catch {
    /* Start a new index when this is the first collection run. */
  }
  history.push(summary)
  await writeFile(join(root, 'run-index.json'), JSON.stringify(history.slice(-500), null, 2), 'utf-8')
  return summary
}

function emitProgress(
  onProgress: (progress: TrendInsightProgress) => void,
  phase: TrendInsightProgress['phase'],
  operation: string,
  message: string,
  status: TrendInsightProgress['status'],
  options: Pick<TrendInsightProgress, 'current' | 'total' | 'details' | 'preview' | 'currentVideo' | 'topics'> = {}
): void {
  onProgress({ phase, operation, message, status, timestamp: new Date().toISOString(), ...options })
}

function recordHashtags(record: JsonRecord): string[] {
  const extras = Array.isArray(record.text_extra) ? record.text_extra : []
  const structured = extras.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!isRecord(item)) return []
    const value = item.hashtag_name ?? item.hashtagName ?? item.name
    return value == null ? [] : [String(value)]
  })
  const inline = [...String(record.desc ?? '').matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1])
  return [...new Set([...structured, ...inline].map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 8)
}

function previewRecord(record: JsonRecord): TrendDiscoveryPreview {
  const statistics = isRecord(record.statistics) ? record.statistics : {}
  return {
    id: String(record.aweme_id ?? ''),
    title: String(record.desc ?? '').trim() || 'Video chưa có mô tả',
    author: String(record.author_name ?? '').trim() || 'Không rõ tác giả',
    views: Number(statistics.play_count ?? 0) || 0,
    likes: Number(statistics.digg_count ?? 0) || 0,
    comments: Number(statistics.comment_count ?? 0) || 0,
    shares: Number(statistics.share_count ?? 0) || 0,
    hashtags: recordHashtags(record)
  }
}

function previewRecords(records: Map<string, JsonRecord>): TrendDiscoveryPreview[] {
  return [...records.values()]
    .map(previewRecord)
    .sort((left, right) => right.views - left.views)
    .slice(0, 8)
}

function trendingTopics(records: Map<string, JsonRecord>): TrendDiscoveryTopic[] {
  const counts = new Map<string, number>()
  for (const record of records.values()) {
    for (const hashtag of recordHashtags(record)) {
      const key = hashtag.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }))
}

async function waitForResponseDrain(pendingBodies: Set<Promise<void>>): Promise<boolean> {
  const deadline = Date.now() + RESPONSE_DRAIN_TIMEOUT_MS
  let quietSince = pendingBodies.size === 0 ? Date.now() : 0
  while (Date.now() < deadline) {
    if (pendingBodies.size === 0) {
      if (quietSince === 0) quietSince = Date.now()
      if (Date.now() - quietSince >= 1_000) return true
    } else {
      quietSince = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return pendingBodies.size === 0
}

function parseCapturedBody(
  body: string,
  records: Map<string, JsonRecord>,
  onDiscovered: (video: TrendDiscoveryPreview) => void
): boolean {
  if (!body || body.length > MAX_CAPTURE_BODY_BYTES) return false
  const candidates = [body]
  if (body.includes('%22aweme')) {
    try { candidates.push(decodeURIComponent(body)) } catch { /* Keep the original body. */ }
  }
  for (const candidate of candidates) {
    try {
      collectVideoRecords(JSON.parse(candidate), records, new Set<object>(), onDiscovered)
      return true
    } catch {
      /* Try the next representation. */
    }
  }
  return false
}

async function installPageMetadataCapture(win: BrowserWindow): Promise<boolean> {
  const script = `(() => {
    if (window.__tblaoMetadataCaptureInstalled) return true;
    window.__tblaoMetadataCaptureInstalled = true;
    window.__tblaoMetadataQueue = [];
    const keep = (body) => {
      if (typeof body !== 'string' || body.length === 0 || body.length > ${MAX_CAPTURE_BODY_BYTES}) return;
      if (!body.includes('aweme') && !body.includes('video_id') && !body.includes('videoId')) return;
      window.__tblaoMetadataQueue.push(body);
      if (window.__tblaoMetadataQueue.length > 500) window.__tblaoMetadataQueue.shift();
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const type = response.headers.get('content-type') || '';
        if (type.includes('json') || type.includes('text')) response.clone().text().then(keep).catch(() => {});
      } catch {}
      return response;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(...args) {
      this.addEventListener('load', function() {
        try { if (!this.responseType || this.responseType === 'text') keep(this.responseText); } catch {}
      });
      return originalOpen.apply(this, args);
    };
    return true;
  })()`
  return withTimeout(win.webContents.executeJavaScript(script, true), 3_000, 'page_capture_install')
    .then(Boolean)
    .catch(() => false)
}

async function drainPageMetadataCapture(
  win: BrowserWindow,
  records: Map<string, JsonRecord>,
  includeHydration: boolean,
  onDiscovered: (video: TrendDiscoveryPreview) => void
): Promise<{ bodies: number; parsed: number; domCards: number }> {
  const script = `(() => {
    const bodies = Array.isArray(window.__tblaoMetadataQueue) ? window.__tblaoMetadataQueue.splice(0) : [];
    const hydration = ${includeHydration ? `Array.from(document.scripts)
      .map((item) => item.textContent || '')
      .filter((text) => text.includes('aweme_id') || text.includes('%22aweme_id%22'))
      .slice(0, 100)` : '[]'};
    const cards = Array.from(document.querySelectorAll('a[href*="/video/"]')).map((link) => {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\\/video\\/(\\d+)/);
      const container = link.closest('li, article, [data-e2e], [class*="card"]') || link;
      const text = (container.innerText || link.innerText || '').trim().slice(0, 1000);
      return match ? { aweme_id: match[1], desc: text, statistics: {} } : null;
    }).filter(Boolean);
    return { bodies: bodies.concat(hydration), cards };
  })()`
  const captured = await withTimeout(
    win.webContents.executeJavaScript(script, true),
    3_000,
    'page_capture_drain'
  ).catch(() => ({ bodies: [], cards: [] })) as { bodies: string[]; cards: JsonRecord[] }
  let parsed = 0
  for (const body of captured.bodies) if (parseCapturedBody(body, records, onDiscovered)) parsed++
  for (const card of captured.cards) collectVideoRecords(card, records, new Set<object>(), onDiscovered)
  return { bodies: captured.bodies.length, parsed, domCards: captured.cards.length }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function providerNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0
  const text = String(value ?? '').trim()
  const parsed = Number(text.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  if (text.includes('亿')) return parsed * 100_000_000
  if (text.includes('万')) return parsed * 10_000
  return Math.max(0, parsed)
}

function firstValue(records: JsonRecord[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) if (record[key] != null) return record[key]
  }
  return null
}

function videoId(record: JsonRecord): string | null {
  const value = record.aweme_id ?? record.awemeId ?? record.video_id ?? record.videoId ?? record.item_id ?? record.itemId
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function compactVideoRecord(record: JsonRecord): JsonRecord {
  const id = videoId(record)
  const author = isRecord(record.author)
    ? record.author
    : isRecord(record.authorInfo)
      ? record.authorInfo
      : isRecord(record.author_info) ? record.author_info : {}
  const statistics = isRecord(record.statistics)
    ? record.statistics
    : isRecord(record.stats)
      ? record.stats
      : isRecord(record.statistics_info)
        ? record.statistics_info
        : isRecord(record.statisticsInfo) ? record.statisticsInfo : {}
  const metricSources = [statistics, record]
  const shareInfo = isRecord(record.share_info) ? record.share_info : isRecord(record.shareInfo) ? record.shareInfo : {}
  const video = isRecord(record.video) ? record.video : isRecord(record.videoInfo) ? record.videoInfo : {}
  return {
    ...record,
    aweme_id: id,
    desc: record.desc ?? record.description ?? record.title ?? record.item_title ?? record.itemTitle ?? record.caption ?? shareInfo.share_desc ?? shareInfo.shareDesc ?? '',
    author_name: author.nickname ?? author.nickName ?? author.unique_id ?? author.uniqueId ?? record.author_name ?? '',
    author_id: author.uid ?? author.sec_uid ?? author.secUid ?? record.author_id ?? '',
    duration: record.duration ?? record.videoDuration ?? video.duration ?? null,
    create_time: record.create_time ?? record.createTime ?? record.create_time_ms ?? record.createTimeMs ?? record.publish_time ?? record.publishTime ?? inferCreateTimeFromAwemeId(id),
    statistics: {
      ...statistics,
      play_count: providerNumber(firstValue(metricSources, ['play_count', 'playCount', 'view_count', 'viewCount', 'views'])),
      digg_count: providerNumber(firstValue(metricSources, ['digg_count', 'diggCount', 'like_count', 'likeCount', 'likes'])),
      comment_count: providerNumber(firstValue(metricSources, ['comment_count', 'commentCount', 'comments'])),
      share_count: providerNumber(firstValue(metricSources, ['share_count', 'shareCount', 'shares'])),
      collect_count: providerNumber(firstValue(metricSources, ['collect_count', 'collectCount', 'favorite_count', 'favoriteCount']))
    },
    text_extra: Array.isArray(record.text_extra) ? record.text_extra : Array.isArray(record.textExtra) ? record.textExtra : []
  }
}

function collectVideoRecords(
  value: unknown,
  output: Map<string, JsonRecord>,
  visited: Set<object>,
  onDiscovered: (video: TrendDiscoveryPreview) => void
): void {
  if (!value || typeof value !== 'object') return
  if (visited.has(value)) return
  visited.add(value)

  if (Array.isArray(value)) {
    for (const item of value) collectVideoRecords(item, output, visited, onDiscovered)
    return
  }

  const record = value as JsonRecord
  const id = videoId(record)
  const hasMetrics = isRecord(record.statistics) || isRecord(record.stats) || isRecord(record.statistics_info) ||
    ['play_count', 'playCount', 'view_count', 'viewCount', 'digg_count', 'diggCount'].some((key) => record[key] != null)
  const hasMetadata = ['desc', 'description', 'title', 'item_title', 'itemTitle', 'author', 'authorInfo', 'author_info', 'create_time', 'createTime', 'video'].some((key) => record[key] != null)
  if (id && (hasMetrics || hasMetadata)) {
    const isNew = !output.has(id)
    const compact = mergeDouyinMetadata(output.get(id), compactVideoRecord(record))
    output.set(id, compact)
    if (isNew) onDiscovered(previewRecord(compact))
  }
  for (const nested of Object.values(record)) collectVideoRecords(nested, output, visited, onDiscovered)
}

function collectionStatus(
  code: TrendCollectionStatus['code'],
  message: string,
  collectedVideos = 0,
  retryable = false,
  recommendedAction = ''
): TrendCollectionStatus {
  return { code, message, collectedVideos, retryable, recommendedAction }
}

async function restoreSessionCookies(): Promise<void> {
  const cookies = await readDyCookies()
  const session = electronSession.fromPartition(DY_PARTITION)
  await Promise.all(Object.entries(cookies).map(([name, value]) =>
    session.cookies.set({ url: 'https://www.douyin.com', domain: '.douyin.com', path: '/', name, value })
      .catch(() => undefined)
  ))
}

function classifyBlockedPage(url: string, text: string): TrendCollectionStatus | null {
  const content = `${url}\n${text}`.toLowerCase()
  if (/captcha|验证码|安全验证|verify/.test(content)) {
    return collectionStatus('CAPTCHA_DETECTED', 'Douyin yêu cầu xác minh thủ công.', 0, false, 'Mở lại cửa sổ đăng nhập Douyin và hoàn tất xác minh.')
  }
  if (/访问频繁|操作频繁|rate.?limit|too many requests/.test(content)) {
    return collectionStatus('RATE_LIMITED', 'Douyin đang giới hạn tần suất truy cập.', 0, true, 'Chờ một lúc rồi chạy lại; không tự động vượt giới hạn.')
  }
  if (/扫码登录|密码登录|登录后|login|sign in/.test(content)) {
    return collectionStatus('SESSION_EXPIRED', 'Phiên đăng nhập Douyin đã hết hạn.', 0, false, 'Đăng nhập Douyin lại để làm mới cookie.')
  }
  return null
}

/** Collect public trend metadata from the user's authenticated local Douyin session. */
export async function collectDouyinTrends(
  dataDir: string,
  onProgress: (progress: TrendInsightProgress) => void,
  updateCategories: Array<Exclude<TrendCategory, 'all'>> = []
): Promise<TrendCollectionStatus> {
  const startedAt = new Date().toISOString()
  const records = new Map<string, JsonRecord>()
  const selectedCategories = [...new Set(updateCategories.filter((category) => STORED_TREND_CATEGORIES.includes(category)))]
  const pendingBodies = new Set<Promise<void>>()
  let metadataResponses = 0
  let parsedResponses = 0
  let currentVideo: TrendDiscoveryPreview | null = null
  const persistRun = async (
    status: CollectionRunSummary['status'],
    code: TrendCollectionStatus['code'],
    message: string
  ): Promise<void> => {
    emitProgress(onProgress, 'saving', 'run_archive_write', 'Đang lưu JSON quản lý cho lần thu thập này.', 'running', {
      details: { videos: records.size, status }
    })
    try {
      const summary = await saveCollectionRun(dataDir, startedAt, status, code, message, records, {
        metadataResponses,
        parsedResponses
      })
      emitProgress(onProgress, 'saving', 'run_archive_write', `Đã lưu JSON quản lý: ${summary.file}.`, 'completed', {
        details: { videos: summary.videoCount, videosWithMetrics: summary.videosWithMetrics, runId: summary.runId }
      })
    } catch (error) {
      debugRaw('trend run archive', error)
      emitProgress(onProgress, 'saving', 'run_archive_write', 'Không thể lưu JSON quản lý của lần chạy này.', 'error')
    }
  }

  emitProgress(onProgress, 'checking_session', 'session_check', 'Đang kiểm tra phiên Douyin.', 'running')
  const cookieStatus = await dyCookieStatus()
  if (!cookieStatus.has) {
    emitProgress(onProgress, 'checking_session', 'session_check', 'Không tìm thấy cookie Douyin.', 'error')
    await persistRun('blocked', 'COOKIE_NOT_CONFIGURED', 'Chưa có cookie Douyin.')
    return collectionStatus('COOKIE_NOT_CONFIGURED', 'Chưa có cookie Douyin.', 0, false, 'Đăng nhập Douyin ở tab Douyin trước.')
  }
  emitProgress(onProgress, 'checking_session', 'session_check', `Đã tìm thấy ${cookieStatus.count} cookie Douyin.`, 'completed', {
    details: { cookieCount: cookieStatus.count }
  })

  emitProgress(onProgress, 'checking_session', 'session_restore', 'Đang nạp cookie vào phiên trình duyệt cục bộ.', 'running')
  try {
    await withTimeout(restoreSessionCookies(), 5_000, 'session_restore')
  } catch (error) {
    debugRaw('restore Douyin session', error)
    emitProgress(onProgress, 'checking_session', 'session_restore', 'Không thể nạp cookie vào phiên Douyin.', 'error')
    await persistRun('error', 'SESSION_EXPIRED', 'Không thể nạp cookie vào phiên Douyin.')
    return collectionStatus('SESSION_EXPIRED', 'Không thể nạp cookie vào phiên Douyin.', 0, true, 'Đăng nhập Douyin lại rồi thử lại.')
  }
  emitProgress(onProgress, 'checking_session', 'session_restore', 'Đã nạp phiên Douyin cục bộ.', 'completed')
  emitProgress(onProgress, 'collecting', 'browser_start', 'Đang khởi tạo trình duyệt thu thập chạy nền.', 'running')

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: DY_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  emitProgress(onProgress, 'collecting', 'browser_start', 'Trình duyệt thu thập chạy nền đã sẵn sàng.', 'completed')

  const debuggerApi = win.webContents.debugger
  try {
    let cdpNetworkEnabled = false
    emitProgress(onProgress, 'collecting', 'debugger_attach', 'Đang kết nối bộ theo dõi mạng với browser nền.', 'running')
    debuggerApi.attach('1.3')
    emitProgress(onProgress, 'collecting', 'debugger_attach', 'Đã kết nối bộ theo dõi mạng.', 'completed')

    emitProgress(onProgress, 'collecting', 'network_enable', 'Đang bật thu thập metadata response.', 'running')
    try {
      await withTimeout(debuggerApi.sendCommand('Network.enable'), 5_000, 'network_enable')
      cdpNetworkEnabled = true
    } catch (firstError) {
      debugRaw('network enable first attempt', firstError)
      emitProgress(onProgress, 'collecting', 'network_enable_retry', 'Lần bật network đầu tiên quá thời gian; đang kết nối lại một lần.', 'warning')
      if (debuggerApi.isAttached()) debuggerApi.detach()
      await new Promise((resolve) => setTimeout(resolve, 300))
      debuggerApi.attach('1.3')
      try {
        await withTimeout(debuggerApi.sendCommand('Network.enable'), 5_000, 'network_enable_retry')
        cdpNetworkEnabled = true
      } catch (retryError) {
        debugRaw('network enable retry', retryError)
        emitProgress(onProgress, 'collecting', 'network_fallback', 'CDP không khả dụng; chuyển sang bắt fetch/XHR trực tiếp trong trang Douyin.', 'warning')
        if (debuggerApi.isAttached()) debuggerApi.detach()
      }
    }
    if (cdpNetworkEnabled) {
      emitProgress(onProgress, 'collecting', 'network_enable', 'Đã bật thu thập metadata response qua CDP.', 'completed')
    }

    if (cdpNetworkEnabled) {
      emitProgress(onProgress, 'collecting', 'media_blocking', 'Đang thử chặn request media không cần thiết.', 'running')
      try {
        await withTimeout(debuggerApi.sendCommand('Network.setBlockedURLs', {
          urls: ['*.mp4*', '*.webm*', '*.flv*', '*.m3u8*', '*.mp3*', '*.aac*']
        }), 2_000, 'media_blocking')
        emitProgress(onProgress, 'collecting', 'media_blocking', 'Đã chặn request video và audio; chỉ giữ luồng metadata.', 'completed')
      } catch (error) {
        debugRaw('optional media blocking', error)
        emitProgress(onProgress, 'collecting', 'media_blocking', 'Không thể bật chặn media; collector tiếp tục lấy metadata.', 'warning')
      }
    }
    win.webContents.setAudioMuted(true)
    if (cdpNetworkEnabled) {
      debuggerApi.on('message', (_event, method, params) => {
        if (method !== 'Network.responseReceived') return
        const response = params.response as { url?: string } | undefined
        const resourceType = String(params.type ?? '')
        if (!response?.url?.includes('douyin.com') || !['XHR', 'Fetch'].includes(resourceType)) return
        metadataResponses++
        const task = debuggerApi.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((payload: { body?: string; base64Encoded?: boolean }) => {
            if (!payload.body) return
            const body = payload.base64Encoded
              ? Buffer.from(payload.body, 'base64').toString('utf-8')
              : payload.body
            if (parseCapturedBody(body, records, (video) => { currentVideo = video })) parsedResponses++
          })
          .catch(() => undefined)
          .finally(() => pendingBodies.delete(task))
        pendingBodies.add(task)
      })
    }

    emitProgress(onProgress, 'collecting', 'page_load', 'Đang mở trang khám phá Douyin trong nền.', 'running')
    await withTimeout(win.loadURL(DISCOVERY_URL), PAGE_LOAD_TIMEOUT_MS, 'page_load')
    emitProgress(onProgress, 'collecting', 'page_load', 'Trang khám phá Douyin đã tải xong.', 'completed')
    const pageCaptureInstalled = await installPageMetadataCapture(win)
    emitProgress(
      onProgress,
      'collecting',
      'page_capture',
      pageCaptureInstalled
        ? 'Đã bật bắt fetch/XHR và dữ liệu hydration trực tiếp trong trang.'
        : 'Không thể cài bộ bắt metadata trong trang.',
      pageCaptureInstalled ? 'completed' : cdpNetworkEnabled ? 'warning' : 'error',
      { details: { provider: cdpNetworkEnabled ? 'cdp_with_page_fallback' : 'page_fetch_xhr' } }
    )
    const initialPageData = await drainPageMetadataCapture(win, records, true, (video) => { currentVideo = video })
    metadataResponses += initialPageData.bodies
    parsedResponses += initialPageData.parsed
    emitProgress(onProgress, 'collecting', 'initial_page_metadata', `Đã đọc ${initialPageData.bodies} payload hydration và ${initialPageData.domCards} card video ban đầu.`, 'info', {
      details: { hydrationPayloads: initialPageData.bodies, domCards: initialPageData.domCards, capturedVideos: records.size },
      preview: previewRecords(records),
      currentVideo: currentVideo ?? undefined,
      topics: trendingTopics(records)
    })
    let stableScrolls = 0
    let completedScrolls = 0
    for (let index = 0; index < SAFETY_MAX_SCROLLS && stableScrolls < STABLE_SCROLL_LIMIT; index++) {
      const recordsBeforeScroll = records.size
      try {
        await withTimeout(
          win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)', true),
          3_000,
          'discovery_scroll'
        )
      } catch (error) {
        debugRaw('discovery scroll', error)
        emitProgress(onProgress, 'collecting', 'discovery_scroll', 'Browser không phản hồi thao tác cuộn; kết thúc quét với dữ liệu hiện có.', 'warning')
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const pageData = await drainPageMetadataCapture(win, records, false, (video) => { currentVideo = video })
      metadataResponses += pageData.bodies
      parsedResponses += pageData.parsed
      completedScrolls = index + 1
      stableScrolls = records.size > recordsBeforeScroll ? 0 : stableScrolls + 1
      emitProgress(onProgress, 'collecting', 'discovery_scroll', `Đã quét lượt ${index + 1}; bắt được ${records.size} video, ${stableScrolls} lượt liên tiếp không có video mới.`, 'info', {
        current: index + 1,
        total: SAFETY_MAX_SCROLLS,
        details: {
          capturedVideos: records.size,
          pendingResponses: pendingBodies.size,
          metadataResponses,
          parsedResponses,
          domCards: pageData.domCards,
          stableScrolls
        },
        preview: previewRecords(records),
        currentVideo: currentVideo ?? undefined,
        topics: trendingTopics(records)
      })
    }
    const feedExhausted = stableScrolls >= STABLE_SCROLL_LIMIT
    const stopReason = feedExhausted
      ? 'Feed không trả thêm video mới.'
      : 'Đã đạt giới hạn an toàn trước khi xác nhận hết feed.'
    emitProgress(onProgress, 'collecting', 'discovery_complete', `${stopReason} Tổng cộng ${records.size} video sau ${completedScrolls} lượt quét.`, 'completed', {
      details: { capturedVideos: records.size, completedScrolls, stableScrolls, feedExhausted, metadataResponses, parsedResponses },
      preview: previewRecords(records),
      currentVideo: currentVideo ?? undefined,
      topics: trendingTopics(records)
    })
    emitProgress(onProgress, 'collecting', 'response_processing', `Đang chờ ${pendingBodies.size} response còn lại xử lý xong.`, 'running', {
      details: { pendingResponses: pendingBodies.size }
    })
    const responsesDrained = await waitForResponseDrain(pendingBodies)
    if (!responsesDrained) {
      emitProgress(onProgress, 'collecting', 'response_processing', `Còn ${pendingBodies.size} response chưa xử lý sau thời gian chờ; dừng trước bước phân tích.`, 'error', {
        details: { pendingResponses: pendingBodies.size, timeoutMs: RESPONSE_DRAIN_TIMEOUT_MS }
      })
      await persistRun('incomplete', 'PROVIDER_RESPONSE_INVALID', 'Response Douyin chưa xử lý hoàn chỉnh.')
      return collectionStatus('PROVIDER_RESPONSE_INVALID', 'Thu thập chưa hoàn chỉnh vì response Douyin xử lý quá lâu.', records.size, true, 'Chạy lại collector; hệ thống chưa phân tích dữ liệu của lần này.')
    }
    emitProgress(onProgress, 'collecting', 'response_processing', `Đã chuẩn hóa ${records.size} video từ response Douyin.`, 'completed', {
      details: { capturedVideos: records.size },
      preview: previewRecords(records),
      currentVideo: currentVideo ?? undefined,
      topics: trendingTopics(records)
    })

    if (!feedExhausted) {
      emitProgress(onProgress, 'collecting', 'feed_completeness', 'Chưa xác nhận đã crawl hết feed hiện tại; không cập nhật database và không chấm điểm bằng dữ liệu thiếu.', 'error', {
        details: { capturedVideos: records.size, completedScrolls, safetyMaxScrolls: SAFETY_MAX_SCROLLS }
      })
      await persistRun('incomplete', 'PROVIDER_RESPONSE_INVALID', 'Chưa xác nhận đã crawl hết feed xu hướng hiện tại.')
      return collectionStatus('PROVIDER_RESPONSE_INVALID', 'Lần crawl chưa đi hết feed xu hướng nên không được dùng để chấm điểm.', records.size, true, 'Chạy lại sau; database hợp lệ gần nhất vẫn được giữ nguyên.')
    }

    const pageState = await withTimeout(
      win.webContents.executeJavaScript(
        '({ url: location.href, text: document.body ? document.body.innerText.slice(0, 12000) : "" })',
        true
      ),
      3_000,
      'page_state'
    ).catch(() => ({ url: win.webContents.getURL(), text: '' })) as { url: string; text: string }
    const blocked = classifyBlockedPage(pageState.url, pageState.text)
    if (blocked && records.size === 0) {
      emitProgress(onProgress, 'collecting', 'provider_validation', blocked.message, 'error', {
        details: { providerCode: blocked.code }
      })
      await persistRun('blocked', blocked.code, blocked.message)
      return blocked
    }
    if (records.size === 0) {
      emitProgress(onProgress, 'collecting', 'provider_validation', 'Không nhận được metadata video hợp lệ.', 'error')
      await persistRun('incomplete', 'PROVIDER_RESPONSE_INVALID', 'Không nhận được metadata video hợp lệ.')
      return collectionStatus('PROVIDER_RESPONSE_INVALID', 'Douyin không trả về metadata video có thể phân tích.', 0, true, 'Kiểm tra kết nối, phiên đăng nhập rồi chạy lại.')
    }
    const recordsWithMetrics = [...records.values()].filter((record) => {
      const statistics = isRecord(record.statistics) ? record.statistics : {}
      return ['play_count', 'digg_count', 'comment_count', 'share_count']
        .some((key) => Number(statistics[key] ?? 0) > 0)
    }).length
    if (recordsWithMetrics === 0) {
      emitProgress(onProgress, 'collecting', 'provider_validation', `Đã bắt được ${records.size} video nhưng toàn bộ metrics bằng 0; dừng trước bước phân tích.`, 'error', {
        details: { capturedVideos: records.size, videosWithMetrics: 0 },
        preview: previewRecords(records),
        currentVideo: currentVideo ?? undefined,
        topics: trendingTopics(records)
      })
      await persistRun('incomplete', 'PROVIDER_RESPONSE_INVALID', 'Metadata video không có metrics hợp lệ.')
      return collectionStatus('PROVIDER_RESPONSE_INVALID', 'Metadata video không có metrics hợp lệ để phân tích.', records.size, true, 'Kiểm tra mapping response Douyin rồi chạy lại.')
    }
    emitProgress(onProgress, 'collecting', 'provider_validation', `Dữ liệu hợp lệ: ${records.size} video, ${recordsWithMetrics} video có metrics khác 0.`, 'completed', {
      details: { capturedVideos: records.size, videosWithMetrics: recordsWithMetrics },
      preview: previewRecords(records),
      currentVideo: currentVideo ?? undefined,
      topics: trendingTopics(records)
    })

    const databaseRecords = selectedCategories.length === 0
      ? records
      : new Map([...records].filter(([, record]) => selectedCategories.includes(categorizeTrendVideo(record))))
    const databaseRecordsWithMetrics = [...databaseRecords.values()].filter((record) => {
      const statistics = isRecord(record.statistics) ? record.statistics : {}
      return ['play_count', 'digg_count', 'comment_count', 'share_count']
        .some((key) => Number(statistics[key] ?? 0) > 0)
    }).length
    if (databaseRecords.size === 0 || databaseRecordsWithMetrics === 0) {
      const categoryList = selectedCategories.join(', ')
      emitProgress(onProgress, 'collecting', 'category_filter', `Không có video hợp lệ thuộc phân mục cập nhật đã chọn: ${categoryList}.`, 'warning', {
        details: { capturedVideos: records.size, matchedVideos: databaseRecords.size, selectedCategories: categoryList }
      })
      await persistRun('incomplete', 'NO_CATEGORY_MATCH', 'Không có video phù hợp với phân mục cập nhật đã chọn.')
      return collectionStatus('NO_CATEGORY_MATCH', 'Không có video phù hợp với phân mục cập nhật đã chọn.', 0, false, 'Chọn thêm phân mục hoặc chọn tất cả rồi cập nhật lại.')
    }

    emitProgress(onProgress, 'saving', 'metadata_write', `Đang lưu ${databaseRecords.size} video thuộc phạm vi cập nhật.`, 'running', {
      details: { videos: databaseRecords.size, capturedVideos: records.size }
    })
    const insightDir = join(dataDir, '.tblao-insights')
    await mkdir(insightDir, { recursive: true })
    await writeFile(join(insightDir, 'douyin-trends-latest.json'), JSON.stringify({
      provider: 'authorized_browser',
      collected_at: new Date().toISOString(),
      source: DISCOVERY_URL,
      items: [...records.values()]
    }), 'utf-8')
    emitProgress(onProgress, 'saving', 'database_upsert', 'Đang cập nhật database xu hướng từ lần thu thập mới.', 'running', {
      details: { videos: databaseRecords.size, capturedVideos: records.size }
    })
    const collectedAt = new Date().toISOString()
    const databaseUpdate = await updateTrendDatabase(dataDir, databaseRecords, collectedAt, selectedCategories)
    emitProgress(onProgress, 'saving', 'database_upsert', `Database đã cập nhật ${databaseUpdate.updated} video và thêm ${databaseUpdate.inserted} video mới.`, 'completed', {
      details: { inserted: databaseUpdate.inserted, updated: databaseUpdate.updated, totalVideos: databaseUpdate.total, currentVideos: databaseUpdate.current }
    })
    await persistRun('completed', 'COLLECTED', `Đã cập nhật ${databaseRecords.size} video xu hướng Douyin.`)
    emitProgress(onProgress, 'saving', 'metadata_write', `Đã lưu metadata của ${databaseRecords.size} video vào database.`, 'completed', {
      details: { videos: databaseRecords.size, capturedVideos: records.size, file: 'douyin-trends-latest.json' }
    })
    logInfo(`Insights: đã cập nhật ${databaseRecords.size} video xu hướng Douyin.`)
    return collectionStatus('COLLECTED', `Đã cập nhật ${databaseRecords.size} video xu hướng Douyin.`, databaseRecords.size, false, 'Dữ liệu đã được chuyển sang bước phân tích.')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    emitProgress(onProgress, 'collecting', 'collector_error', 'Collector Douyin gặp lỗi và đã dừng an toàn.', 'error', {
      details: { reason }
    })
    debugRaw('douyin trend collector', error)
    logWarn('Insights: không thể kết nối nguồn xu hướng Douyin.')
    await persistRun('error', 'PROVIDER_UNREACHABLE', 'Không thể kết nối nguồn xu hướng Douyin.')
    return collectionStatus('PROVIDER_UNREACHABLE', 'Không thể kết nối nguồn xu hướng Douyin.', 0, true, 'Kiểm tra mạng rồi chạy lại.')
  } finally {
    if (debuggerApi.isAttached()) debuggerApi.detach()
    if (!win.isDestroyed()) win.destroy()
    emitProgress(onProgress, 'collecting', 'browser_close', 'Đã đóng trình duyệt thu thập chạy nền.', 'info')
  }
}
