import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inferCreateTimeFromAwemeId, mergeDouyinMetadata, type DouyinMetadataRecord } from './douyinMetadataMerge'
import { categorizeTrendVideo, STORED_TREND_CATEGORIES, trendHashtags } from './trendCategorization'
import type {
  TrendCategory,
  TrendManagedVideo,
  TrendVideoInsight,
  TrendVideoStatusUpdate,
  TrendVideoWorkflowStatus
} from '../shared/types'

type StoredCategory = Exclude<TrendCategory, 'all'>

export interface TrendDatabaseSnapshot {
  collectedAt: string
  views: number
  likes: number
  comments: number
  shares: number
  favorites: number
}

export interface TrendDatabaseScore {
  calculatedAt: string
  category: StoredCategory
  trendScore: number | null
  engagementRate: number
  viewVelocity: number | null
  velocityMetric: 'views' | 'likes'
  growthAcceleration: number | null
  scoreMode: 'provisional' | 'trend'
  snapshotCount: number
  snapshotTarget: number
  dataStatus: TrendVideoInsight['dataStatus']
  recommendationStatus: TrendVideoInsight['recommendationStatus']
  recommendationReason: string
}

export interface TrendDatabaseVideo {
  id: string
  firstSeenAt: string
  lastSeenAt: string
  collectionCount: number
  isCurrentlyTrending: boolean
  category: StoredCategory
  hashtags: string[]
  metadata: DouyinMetadataRecord
  snapshots: TrendDatabaseSnapshot[]
  latestScore: TrendDatabaseScore | null
  scoreHistory: TrendDatabaseScore[]
  status: TrendVideoWorkflowStatus
  statusUpdatedAt: string
  outputFiles: string[]
  publishedUrl: string
  notes: string
}

export interface TrendDatabaseCollection {
  collectedAt: string
  videoCount: number
  categoryCounts: Record<StoredCategory, number>
}

export interface TrendDatabase {
  schemaVersion: 2
  updatedAt: string
  currentCollection: TrendDatabaseCollection | null
  categories: Record<StoredCategory, string[]>
  videos: Record<string, TrendDatabaseVideo>
}

export type TrendScoreUpdate = Omit<TrendDatabaseScore, 'calculatedAt'>

let databaseWriteQueue: Promise<void> = Promise.resolve()

function databaseDirectory(dataDir: string): string {
  return join(dataDir, 'Trend Insights Data', 'Douyin')
}

export function trendDatabasePath(dataDir: string): string {
  return join(databaseDirectory(dataDir), 'trend-database.json')
}

function objectRecord(value: unknown): value is DouyinMetadataRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function metric(record: DouyinMetadataRecord, key: string): number {
  const statistics = objectRecord(record.statistics) ? record.statistics : {}
  const value = Number(statistics[key] ?? 0)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function emptyCategoryIndex(): Record<StoredCategory, string[]> {
  return Object.fromEntries(STORED_TREND_CATEGORIES.map((category) => [category, [] as string[]])) as Record<StoredCategory, string[]>
}

function emptyCategoryCounts(): Record<StoredCategory, number> {
  return Object.fromEntries(STORED_TREND_CATEGORIES.map((category) => [category, 0])) as Record<StoredCategory, number>
}

function emptyDatabase(): TrendDatabase {
  return {
    schemaVersion: 2,
    updatedAt: new Date(0).toISOString(),
    currentCollection: null,
    categories: emptyCategoryIndex(),
    videos: {}
  }
}

function rebuildCategoryIndex(database: TrendDatabase): void {
  database.categories = emptyCategoryIndex()
  for (const video of Object.values(database.videos)) {
    if (video.isCurrentlyTrending) database.categories[video.category].push(video.id)
  }
}

function normalizeDatabase(parsed: Partial<TrendDatabase> & { schemaVersion?: number }): TrendDatabase | null {
  if (![1, 2].includes(Number(parsed.schemaVersion)) || !objectRecord(parsed.videos)) return null
  const database = {
    ...emptyDatabase(),
    ...parsed,
    schemaVersion: 2,
    videos: parsed.videos as unknown as Record<string, TrendDatabaseVideo>
  } satisfies TrendDatabase
  for (const video of Object.values(database.videos)) {
    video.status = video.status ?? 'discovered'
    video.statusUpdatedAt = video.statusUpdatedAt ?? video.lastSeenAt ?? database.updatedAt
    video.outputFiles = Array.isArray(video.outputFiles) ? video.outputFiles : []
    video.publishedUrl = video.publishedUrl ?? ''
    video.notes = video.notes ?? ''
    video.snapshots = Array.isArray(video.snapshots) ? video.snapshots.map((snapshot) => ({
      ...snapshot,
      favorites: Number(snapshot.favorites ?? 0) || 0
    })) : []
    video.category = STORED_TREND_CATEGORIES.includes(video.category)
      ? video.category
      : categorizeTrendVideo(video.metadata)
    video.hashtags = Array.isArray(video.hashtags) ? video.hashtags : trendHashtags(video.metadata)
    video.isCurrentlyTrending = typeof video.isCurrentlyTrending === 'boolean'
      ? video.isCurrentlyTrending
      : video.lastSeenAt === database.updatedAt
    video.latestScore = video.latestScore ?? null
    video.scoreHistory = Array.isArray(video.scoreHistory) ? video.scoreHistory : []
  }
  rebuildCategoryIndex(database)
  if (!database.currentCollection) {
    const currentVideos = Object.values(database.videos).filter((video) => video.isCurrentlyTrending)
    const categoryCounts = emptyCategoryCounts()
    currentVideos.forEach((video) => categoryCounts[video.category]++)
    database.currentCollection = currentVideos.length > 0
      ? { collectedAt: database.updatedAt, videoCount: currentVideos.length, categoryCounts }
      : null
  }
  return database
}

export async function readTrendDatabase(dataDir: string): Promise<TrendDatabase> {
  try {
    const parsed = JSON.parse(await readFile(trendDatabasePath(dataDir), 'utf-8')) as Partial<TrendDatabase> & { schemaVersion?: number }
    return normalizeDatabase(parsed) ?? emptyDatabase()
  } catch {
    // Return an empty database when no successful collection has been stored yet.
    return emptyDatabase()
  }
}

async function writeTrendDatabase(dataDir: string, database: TrendDatabase): Promise<void> {
  rebuildCategoryIndex(database)
  const directory = databaseDirectory(dataDir)
  const file = trendDatabasePath(dataDir)
  const temporaryFile = `${file}.tmp`
  await mkdir(directory, { recursive: true })
  await writeFile(temporaryFile, JSON.stringify(database, null, 2), 'utf-8')
  await rename(temporaryFile, file)
}

function withDatabaseWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = databaseWriteQueue.then(operation, operation)
  databaseWriteQueue = result.then(() => undefined, () => undefined)
  return result
}

export function updateTrendDatabase(
  dataDir: string,
  records: Map<string, DouyinMetadataRecord>,
  collectedAt: string,
  scopeCategories: readonly StoredCategory[] = []
): Promise<{ inserted: number; updated: number; total: number; current: number; categoryCounts: Record<StoredCategory, number>; file: string }> {
  return withDatabaseWrite(async () => {
    const database = await readTrendDatabase(dataDir)
    let inserted = 0
    let updated = 0
    const scope = new Set(scopeCategories)
    for (const video of Object.values(database.videos)) {
      if (scope.size === 0 || scope.has(video.category)) video.isCurrentlyTrending = false
    }
    for (const [id, incoming] of records) {
      const existing = database.videos[id]
      const mergedMetadata = mergeDouyinMetadata(existing?.metadata, incoming)
      const category = categorizeTrendVideo(mergedMetadata)
      if (scope.size > 0 && !scope.has(category)) continue
      const snapshot: TrendDatabaseSnapshot = {
        collectedAt,
        views: metric(incoming, 'play_count'),
        likes: metric(incoming, 'digg_count'),
        comments: metric(incoming, 'comment_count'),
        shares: metric(incoming, 'share_count'),
        favorites: metric(incoming, 'collect_count')
      }
      if (existing) {
        existing.metadata = mergedMetadata
        existing.lastSeenAt = collectedAt
        existing.collectionCount += 1
        existing.isCurrentlyTrending = true
        existing.category = category
        existing.hashtags = trendHashtags(mergedMetadata)
        existing.snapshots = [...existing.snapshots, snapshot].slice(-100)
        updated++
      } else {
        database.videos[id] = {
          id,
          firstSeenAt: collectedAt,
          lastSeenAt: collectedAt,
          collectionCount: 1,
          isCurrentlyTrending: true,
          category,
          hashtags: trendHashtags(mergedMetadata),
          metadata: mergedMetadata,
          snapshots: [snapshot],
          latestScore: null,
          scoreHistory: [],
          status: 'discovered',
          statusUpdatedAt: collectedAt,
          outputFiles: [],
          publishedUrl: '',
          notes: ''
        }
        inserted++
      }
    }
    const currentVideos = Object.values(database.videos).filter((video) => video.isCurrentlyTrending)
    const categoryCounts = emptyCategoryCounts()
    currentVideos.forEach((video) => categoryCounts[video.category]++)
    database.updatedAt = collectedAt
    database.currentCollection = { collectedAt, videoCount: currentVideos.length, categoryCounts }
    await writeTrendDatabase(dataDir, database)
    return {
      inserted,
      updated,
      total: Object.keys(database.videos).length,
      current: currentVideos.length,
      categoryCounts,
      file: trendDatabasePath(dataDir)
    }
  })
}

export function updateTrendDatabaseScores(
  dataDir: string,
  scores: Map<string, TrendScoreUpdate>,
  calculatedAt: string
): Promise<number> {
  return withDatabaseWrite(async () => {
    const database = await readTrendDatabase(dataDir)
    let updated = 0
    for (const [id, score] of scores) {
      const video = database.videos[id]
      if (!video || !video.isCurrentlyTrending) continue
      const stored: TrendDatabaseScore = { ...score, calculatedAt }
      video.category = score.category
      video.latestScore = stored
      const previousScore = video.scoreHistory[video.scoreHistory.length - 1]
      video.scoreHistory = previousScore?.snapshotCount === stored.snapshotCount
        ? [...video.scoreHistory.slice(0, -1), stored]
        : [...video.scoreHistory, stored].slice(-100)
      updated++
    }
    database.updatedAt = calculatedAt
    await writeTrendDatabase(dataDir, database)
    return updated
  })
}

function text(record: DouyinMetadataRecord, key: string): string {
  return String(record[key] ?? '').trim()
}

function firstUrl(value: unknown): string {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item)
      if (url) return url
    }
    return ''
  }
  if (!objectRecord(value)) return ''
  for (const key of ['url_list', 'urlList', 'uri_list', 'uriList', 'url']) {
    const url = firstUrl(value[key])
    if (url) return url
  }
  return ''
}

function coverUrl(record: DouyinMetadataRecord): string {
  const video = objectRecord(record.video) ? record.video : {}
  for (const value of [
    video.cover,
    video.origin_cover,
    video.originCover,
    video.dynamic_cover,
    video.dynamicCover,
    record.cover,
    record.origin_cover,
    record.dynamic_cover
  ]) {
    const url = firstUrl(value)
    if (url) return url
  }
  return ''
}

function videoDuration(record: DouyinMetadataRecord): number | null {
  const video = objectRecord(record.video) ? record.video : {}
  const raw = Number(record.duration ?? video.duration ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return null
  return raw > 1000 ? raw / 1000 : raw
}

function publishedAt(record: DouyinMetadataRecord, id: string): string | null {
  const raw = Number(record.create_time ?? record.createTime ?? inferCreateTimeFromAwemeId(id))
  if (!Number.isFinite(raw) || raw <= 0) return null
  const date = new Date(raw < 10_000_000_000 ? raw * 1000 : raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function managedVideo(video: TrendDatabaseVideo): TrendManagedVideo {
  const latest = video.snapshots[video.snapshots.length - 1]
  const score = video.latestScore
  return {
    id: video.id,
    title: text(video.metadata, 'desc') || 'Video không có tiêu đề',
    author: text(video.metadata, 'author_name') || 'Không rõ tác giả',
    sourceUrl: `https://www.douyin.com/video/${video.id}`,
    category: video.category,
    hashtags: video.hashtags,
    coverUrl: coverUrl(video.metadata),
    duration: videoDuration(video.metadata),
    publishedAt: publishedAt(video.metadata, video.id),
    status: video.status,
    statusUpdatedAt: video.statusUpdatedAt,
    firstSeenAt: video.firstSeenAt,
    lastSeenAt: video.lastSeenAt,
    collectionCount: video.collectionCount,
    snapshotCount: video.snapshots.length,
    snapshotTarget: score?.snapshotTarget ?? 2,
    isCurrentlyTrending: video.isCurrentlyTrending,
    views: latest?.views ?? 0,
    likes: latest?.likes ?? 0,
    comments: latest?.comments ?? 0,
    shares: latest?.shares ?? 0,
    favorites: latest?.favorites ?? 0,
    trendScore: score?.trendScore ?? null,
    scoreMode: score?.scoreMode ?? 'provisional',
    dataStatus: score?.dataStatus ?? 'WAITING_FOR_NEXT_SNAPSHOT',
    recommendationStatus: score?.recommendationStatus ?? 'insufficient_data',
    recommendationReason: score?.recommendationReason ?? 'Cần thêm snapshot để đánh giá.',
    engagementRate: score?.engagementRate ?? 0,
    viewVelocity: score?.viewVelocity ?? null,
    growthAcceleration: score?.growthAcceleration ?? null,
    outputFiles: video.outputFiles,
    publishedUrl: video.publishedUrl,
    notes: video.notes
  }
}

export async function listManagedTrendVideos(dataDir: string): Promise<TrendManagedVideo[]> {
  const database = await readTrendDatabase(dataDir)
  return Object.values(database.videos)
    .map(managedVideo)
    .sort((left, right) => right.statusUpdatedAt.localeCompare(left.statusUpdatedAt))
}

export function updateTrendVideoStatus(update: TrendVideoStatusUpdate): Promise<TrendManagedVideo | null> {
  return withDatabaseWrite(async () => {
    const database = await readTrendDatabase(update.dataDir)
    const video = database.videos[update.id]
    if (!video) return null
    video.status = update.status
    video.statusUpdatedAt = new Date().toISOString()
    if (update.outputFiles) video.outputFiles = [...new Set(update.outputFiles)]
    if (update.publishedUrl != null) video.publishedUrl = update.publishedUrl.trim()
    if (update.notes != null) video.notes = update.notes.trim()
    database.updatedAt = video.statusUpdatedAt
    await writeTrendDatabase(update.dataDir, database)
    return managedVideo(video)
  })
}
