// Kieu du lieu dung chung giua main <-> preload <-> renderer

export type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry {
  time: string // ISO
  level: LogLevel
  msg: string
}

export interface DepStatus {
  ytdlp: boolean
  ffmpeg: boolean
  platform: NodeJS.Platform
}

export type SetupPhase = 'checking' | 'downloading-ytdlp' | 'downloading-ffmpeg' | 'extracting' | 'done' | 'error'

export interface SetupProgress {
  phase: SetupPhase
  message: string
  percent: number // 0..100, -1 neu khong xac dinh
}

export interface VideoFormat {
  format_id: string
  ext: string
  resolution: string | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  filesize: number | null
  filesizeApprox: number | null
  tbr: number | null // total bitrate
  note: string | null
}

export interface VideoInfo {
  id: string
  title: string
  uploader: string | null
  duration: number | null // giay
  durationString: string | null
  thumbnail: string | null
  webpageUrl: string
  isPlaylist: boolean
  playlistCount: number | null
  formats: VideoFormat[]
  heights: number[] // cac do phan giai san co (video), giam dan
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  uploader: string | null
  duration: number | null
  durationString: string | null
  isPlaylist?: boolean // entry nay ban than la playlist con (vd tab kenh: Videos/Shorts)
  count?: number | null // so video trong playlist con (neu biet)
}

export interface PlaylistProbe {
  isPlaylist: boolean
  title: string | null
  count: number
  entries: PlaylistEntry[]
}

export type DownloadKind = 'video' | 'audio'

export interface DownloadRequest {
  url: string
  kind: DownloadKind
  height: number | null // do phan giai mong muon cho video (null = tot nhat)
  audioFormat: string // vd 'mp3'
  outputDir: string
  embedThumbnail: boolean
  embedMetadata: boolean
  cookiesFile: string | null // duong dan cookies.txt neu dung cookie dang nhap
  formatId: string | null // bo chon dinh dang tuy chon (vd '137+bestaudio'); null = dung kind/height
  // --- P1 nang cao ---
  container: string // dinh dang file video khi ghep: mp4/mkv/webm
  outputTemplate: string // mau ten file yt-dlp (vd '%(title)s [%(id)s].%(ext)s')
  writeSubs: boolean // tai phu de
  autoSubs: boolean // ke ca phu de tu dong (ASR)
  subLangs: string // ngon ngu phu de, vd 'vi,en'
  embedSubs: boolean // nhung phu de vao video
  useArchive: boolean // bo qua file da tai (download archive)
  forceOverwrite: boolean // ghi de file trung
  proxy: string | null // proxy vuot khoa vung, vd 'socks5://127.0.0.1:1080' (null = khong dung)
}

export interface ProxyTestResult {
  ok: boolean
  message: string
}

// Tu cap nhat app
export interface UpdateStatus {
  state: 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

// ---- Douyin ----
export type DyMode = 'all' | 'batch' | 'new' // kieu tai (chi cho link kenh)

export interface DouyinRequest {
  url: string
  outputDir: string
  isChannel: boolean // link kenh/user (co Kieu tai) hay video don
  mode: DyMode
  batchSize: number // so video moi dot cho mode 'batch'
  music: boolean
  cover: boolean
  avatar: boolean
  metaJson: boolean
  proxy: string | null
}

export interface DouyinResult {
  id: string
  ok: boolean
  total: number
  success: number
  failed: number
  skipped: number
  files?: string[]
  error: string | null
}

export interface DouyinProgress {
  id: string
  status: 'preparing' | 'downloading' | 'finished' | 'error'
  line: string | null
  lastFile: string | null // ten video vua tai xong
  success: number
}

export interface DyEngineStatus {
  has: boolean
}

export interface DyCookieStatus {
  has: boolean
  count: number
}

export interface DyChannel {
  url: string
  name: string
  lastRun: string // ISO
  count: number // tong so video da tai tu kenh
}

// ---- Audio -> Text (whisper) ----
export type WhisperTask = 'transcribe' | 'translate'

export type WhisperDevice = 'cpu' | 'cuda'

export interface WhisperRequest {
  input: string // duong dan file audio/video
  outputDir: string
  model: string // 'base' | 'small' | 'medium'
  language: string // 'auto' | 'vi' | 'en' ...
  task: WhisperTask
  formats: string[] // ['srt','txt','vtt']
  device: WhisperDevice // 'cuda' neu user bat GPU va da co goi tang toc
  diarize: boolean // nhan dien ai noi luc nao (gan nhan [SPEAKER_xx])
  speakers: number // so nguoi noi (0 = tu doan)
}

export interface WhisperCudaStatus {
  has: boolean // da tai + giai nen goi tang toc CUDA chua
}

export interface WhisperProgress {
  id: string
  status: 'preparing' | 'transcribing' | 'finished' | 'error'
  percent: number // 0..100, -1 neu chua biet
  language: string | null
  line: string | null // doan text vua nhan / thong bao
}

export interface WhisperResult {
  id: string
  ok: boolean
  outputs: string[] // duong dan cac file .srt/.txt/.vtt
  segments: number
  speakers: number // so nguoi noi nhan dien duoc (0 neu khong bat diarize)
  error: string | null
}

export interface WhisperEngineStatus {
  has: boolean
}

// ---- Tab Dich man hinh (doc chu chay tren video) ----
export interface OcrEngineStatus {
  has: boolean
}
export interface OcrProgress {
  percent: number // -1 = chua tinh duoc (dang tach khung)
  text: string
}
export interface OcrResult {
  ok: boolean
  output?: string
  count?: number
  error?: string
  // Dai chu goc (pixel video) — buoc ghep video dung de che phu de cung san co.
  bandTop?: number | null
  bandBot?: number | null
}

// ---- Ghep phu de vao video (buoc phu cua tab Dich man hinh) ----
export interface BurnReq {
  video: string
  srt: string
  outputDir: string
  mode: 'burn' | 'soft' // dot chet (dang lai) | ghep mem (ranh sub, xem may)
  // VUNG DAT CHU (pixel video, chi khi dot chet): chu se can giua quanh tam
  // vung nay. null -> khong co vung, chu ve vi tri phu de tieu chuan (sat day).
  // LUU Y: gui vung NAY KE CA khi khong lam mo — keo khung = chon cho dat chu.
  bandTop?: number | null
  bandBot?: number | null
  // Co lam mo vung do khong (che phu de goc). Doc lap voi vi tri dat chu.
  lamMo?: boolean
  // Co chu: 'auto' = tu dong theo khung. KHONG gui ti le cung nua — thang co chu
  // cua video NGANG va DOC khac nhau (doc lay moc theo be rong), burn.ts tu chon
  // bo tham so theo huong video do ffprobe.
  coChu?: CoChu
  // Cat phu de cho vua thoi luong video (chi che do 'soft'). UI bat co nay khi
  // da canh bao .srt dai hon video ma user van bam ghep. Che do 'burn' khong
  // can: het khung hinh la chu tu dung, khong co gi de cat.
  catSrt?: boolean
}
/** Muc co chu user chon o tab Dich man hinh. */
export type CoChu = 'auto' | 'nho' | 'vua' | 'lon' | 'ratlon'
export interface BurnProgress {
  percent: number // -1 = chua tinh duoc
}
export interface BurnResult {
  ok: boolean
  output?: string
  error?: string
}

// ---- Automated Douyin to Vietnamese video pipeline ----
export type AutoPipelinePhase = 'downloading' | 'transcribing' | 'translating' | 'rendering' | 'finished' | 'error'

export interface AutoPipelineRequest {
  url: string
  outputDir: string
  model: 'base' | 'small' | 'medium'
  useGpu: boolean
}

export interface AutoPipelineProgress {
  id: string
  phase: AutoPipelinePhase
  message: string
  percent: number
  current: number
  total: number
}

export interface AutoPipelineResult {
  id: string
  ok: boolean
  outputs: string[]
  error: string | null
}

// ---- Local category trend insights ----
export type TrendCategory = 'all' | 'education' | 'technology' | 'beauty' | 'food' | 'travel' | 'entertainment' | 'business' | 'lifestyle'

export interface TrendInsightRequest {
  dataDir: string
  category: TrendCategory
  updateCategories?: Array<Exclude<TrendCategory, 'all'>>
  direction: string
  snapshotIntervalMinutes: number
  minimumSnapshots: number
}

export interface TrendVideoInsight {
  id: string
  sourceUrl: string
  title: string
  author: string
  category: TrendCategory
  views: number
  likes: number
  comments: number
  shares: number
  engagementRate: number
  trendScore: number | null
  duration: number | null
  publishedAt: string | null
  sourcePath: string
  snapshotCount: number
  viewVelocity: number | null
  velocityMetric: 'views' | 'likes'
  scoreMode: 'provisional' | 'trend'
  snapshotTarget: number
  workflowStatus: TrendVideoWorkflowStatus
  statusUpdatedAt: string
  growthAcceleration: number | null
  dataStatus: 'READY_FOR_REVIEW' | 'WAITING_FOR_NEXT_SNAPSHOT'
  rightsStatus: 'unknown' | 'requested' | 'granted' | 'denied' | 'expired'
  recommendationStatus: 'process_now' | 'watch' | 'optional' | 'insufficient_data'
  recommendationReason: string
}

export type TrendVideoWorkflowStatus =
  | 'discovered'
  | 'shortlisted'
  | 'downloading'
  | 'downloaded'
  | 'processing'
  | 'exported'
  | 'published'
  | 'rejected'

export interface TrendManagedVideo {
  id: string
  title: string
  author: string
  sourceUrl: string
  category: Exclude<TrendCategory, 'all'>
  hashtags: string[]
  coverUrl: string
  duration: number | null
  publishedAt: string | null
  status: TrendVideoWorkflowStatus
  statusUpdatedAt: string
  firstSeenAt: string
  lastSeenAt: string
  collectionCount: number
  snapshotCount: number
  snapshotTarget: number
  isCurrentlyTrending: boolean
  views: number
  likes: number
  comments: number
  shares: number
  favorites: number
  trendScore: number | null
  scoreMode: 'provisional' | 'trend'
  dataStatus: TrendVideoInsight['dataStatus']
  recommendationStatus: TrendVideoInsight['recommendationStatus']
  recommendationReason: string
  engagementRate: number
  viewVelocity: number | null
  growthAcceleration: number | null
  outputFiles: string[]
  publishedUrl: string
  notes: string
}

export interface TrendVideoStatusUpdate {
  dataDir: string
  id: string
  status: TrendVideoWorkflowStatus
  outputFiles?: string[]
  publishedUrl?: string
  notes?: string
}

export interface TrendSystemStatus {
  code: 'LOCAL_METADATA_READY' | 'DATA_SOURCE_NOT_CONFIGURED' | 'WAITING_FOR_NEXT_SNAPSHOT' | 'INSUFFICIENT_DATA'
  message: string
  recommendedAction: string
}

export interface TrendPattern {
  label: string
  value: string
  evidence: string
}

export interface TrendRecommendation {
  title: string
  rationale: string
  confidence: 'high' | 'medium' | 'exploratory'
}

export interface TrendScoreCriterion {
  key: 'view_velocity' | 'growth_acceleration' | 'share_rate' | 'comment_rate'
  label: string
  weight: number
  description: string
}

export interface TrendRecommendationPolicy {
  minimumSnapshots: number
  processNowMinScore: number
  watchMinScore: number
  processNowRequiresAi: boolean
  notes: string[]
}

export interface TrendInsightReport {
  category: TrendCategory
  direction: string
  generatedAt: string
  scannedFiles: number
  matchedVideos: number
  eligibleVideos: number
  averageViews: number
  averageEngagementRate: number
  topVideos: TrendVideoInsight[]
  patterns: TrendPattern[]
  recommendations: TrendRecommendation[]
  scoringCriteria: TrendScoreCriterion[]
  recommendationPolicy: TrendRecommendationPolicy
  warnings: string[]
  systemStatus: TrendSystemStatus
  aiStatus: 'READY' | 'AI_NOT_CONFIGURED'
}

export type TrendCollectionCode =
  | 'COLLECTED'
  | 'COOKIE_NOT_CONFIGURED'
  | 'LOGIN_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'CAPTCHA_DETECTED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'NO_CATEGORY_MATCH'

export interface TrendCollectionStatus {
  code: TrendCollectionCode
  message: string
  collectedVideos: number
  retryable: boolean
  recommendedAction: string
}

export type TrendInsightRunPhase = 'checking_session' | 'collecting' | 'saving' | 'analyzing' | 'finished'

export interface TrendDiscoveryPreview {
  id: string
  title: string
  author: string
  views: number
  likes: number
  comments: number
  shares: number
  hashtags: string[]
}

export interface TrendDiscoveryTopic {
  label: string
  count: number
}

export interface TrendInsightProgress {
  phase: TrendInsightRunPhase
  operation: string
  message: string
  status: 'running' | 'completed' | 'info' | 'warning' | 'error'
  timestamp: string
  current?: number
  total?: number
  details?: Record<string, string | number | boolean | null>
  preview?: TrendDiscoveryPreview[]
  currentVideo?: TrendDiscoveryPreview
  topics?: TrendDiscoveryTopic[]
}

export interface TrendInsightRunResult {
  collection: TrendCollectionStatus
  report: TrendInsightReport | null
}

/** Ket qua kiem tra API key. `message` di THANG len UI — khong duoc mang chi
 *  tiet ky thuat nao. */
export interface GeminiStatus {
  ok: boolean
  message: string
}

/** 1 khoi phu de: moc thoi gian + chu. Moc thoi gian KHONG bao gio gui cho AI. */
export interface SrtBlock {
  time: string
  text: string
}

/** Dich phu de sang tieng nao. AI dich duoc moi thu — day chi la danh sach goi y. */
export const DICH_LANGS = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'Tiếng Anh' },
  { code: 'zh', label: 'Tiếng Trung' },
  { code: 'ja', label: 'Tiếng Nhật' },
  { code: 'ko', label: 'Tiếng Hàn' }
] as const

// Ket qua quet GPU (buoc an toan truoc khi cho tai goi tang toc CUDA)
export interface GpuInfo {
  hasNvidia: boolean // may co GPU NVIDIA + driver (nvidia-smi chay duoc) khong
  name: string | null // vd 'NVIDIA GeForce GTX 1050 Ti'
  driverVersion: string | null // vd '582.28'
  cudaVersion: string | null // CUDA toi da driver ganh duoc, vd '13.0'
  cudaMajor: number | null // phan nguyen, vd 13
  canAccelerate: boolean // du dieu kien tang toc (NVIDIA + CUDA >= 12)
  reason: string | null // ly do KHONG tang toc duoc (de bao user)
}

export type DownloadStatus = 'preparing' | 'downloading' | 'postprocessing' | 'finished' | 'error'

export interface DownloadProgress {
  id: string
  status: DownloadStatus
  percent: number // 0..100
  downloadedBytes: number | null
  totalBytes: number | null
  speed: number | null // bytes/s
  eta: number | null // giay
  line: string | null // dong log tho (neu can)
}

export interface DownloadResult {
  id: string
  ok: boolean
  file: string | null
  error: string | null
}

// ---- Cookie dang nhap (Playwright) ----

export interface CookieDepStatus {
  python: boolean
  playwright: boolean
  chromium: boolean
}

export interface CookieStatus {
  has: boolean
  path: string
  count: number
}

export type CookieInstallPhase =
  | 'checking'
  | 'installing-playwright'
  | 'installing-chromium'
  | 'done'
  | 'error'

export interface CookieInstallProgress {
  phase: CookieInstallPhase
  message: string
}

export type CookieCapturePhase = 'launching' | 'ready' | 'saved' | 'error'

export interface CookieCaptureEvent {
  phase: CookieCapturePhase
  message: string
  count?: number
}

export interface CookieCaptureResult {
  ok: boolean
  count: number
  path: string | null
  error: string | null
}
