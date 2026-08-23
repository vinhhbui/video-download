import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { LogEntry, LogLevel } from '../shared/types'

const MAX = 1000 // giu toi da 1000 dong gan nhat trong bo nho
const buffer: LogEntry[] = []
export const logEmitter = new EventEmitter()

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}
export function logFilePath(): string {
  return join(logDir(), 'tblao.log')
}

let dirReady = false
async function ensureDir(): Promise<void> {
  if (dirReady) return
  try {
    await mkdir(logDir(), { recursive: true })
  } catch {
    /* bo qua */
  }
  dirReady = true
}

// ---------------------------------------------------------------------------
// LOC LOI TRUOC KHI GHI NHAT KY
//
// Tab Nhat ky la thu USER MO RA DOC. Do stderr THO vao day thi:
//  - Traceback Python lo nguyen ngan xep cong nghe (ten module, duong dan file).
//  - stderr cua cong cu tai lo luon TEN CONG CU — dung cai ma tab Giay phep
//    co tinh giau di.
// Ma user thuong doc traceback cung khong hieu gi. Nen: chi tra TEN LOI.
//
// Loi cua Google/HTTP thi tra MA CONG KHAI (api_429...) — tra Google la ra,
// khong lo gi cua minh, ma user con biet duong xu ly.
// ---------------------------------------------------------------------------
// !! THU TU QUAN TRONG: luat tren khop truoc thi lay luon. Xep tu HEP den RONG.
//    (Da tung sai: luat 503 bat ca chu "unavailable" nen nuot mat loi chan khu
//     vuc — "Video unavailable ... not available in your country" -> bao nham
//     la "dich vu qua tai", user di sua nham cho.)
const NHAN_LOI: [RegExp, string][] = [
  [/\b429\b|rate.?limit|quota|resource.?exhausted/i, 'api_429 — vượt hạn mức, thử lại sau'],
  [/\b503\b|overloaded|service unavailable/i, 'api_503 — dịch vụ đang quá tải'],
  [/\b40[13]\b|api.?key|permission|unauthorized/i, 'api_403 — khoá không hợp lệ'],
  [/geo|region|\bcountry\b|blocked/i, 'nội dung bị chặn theo khu vực'],
  [/sign in|log in|cookie|private video|members.?only/i, 'cần đăng nhập mới tải được'],
  [/unavailable|removed|deleted|not exist|404/i, 'nội dung không còn khả dụng'],
  [/ENOENT|not found|no such file/i, 'thiếu tệp hoặc công cụ'],
  [/ENOSPC|disk.?full|no space/i, 'ổ đĩa đã đầy'],
  [/EACCES|EPERM|denied/i, 'không đủ quyền ghi'],
  // `fetch failed` la thu Node nem ra khi MAT MANG — khong chua chu "network"
  // nao ca, nen phai bat rieng, khong thi user chi thay "lỗi không xác định"
  // trong khi ho chi can cam lai wifi.
  [/abort|timed? ?out|ETIMEDOUT/i, 'quá thời gian chờ — máy chủ không phản hồi'],
  [/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i, 'lỗi kết nối mạng'],
  [/proxy/i, 'lỗi proxy'],
  [/out of memory|ENOMEM/i, 'máy không đủ bộ nhớ']
]

/**
 * Rut loi tho thanh MOT NHAN ngan, an toan de hien cho user.
 * KHONG BAO GIO tra ve nguyen van stderr.
 */
export function errLabel(raw: unknown): string {
  const s = raw instanceof Error ? raw.message : String(raw ?? '')
  for (const [re, nhan] of NHAN_LOI) if (re.test(s)) return nhan
  return 'lỗi không xác định'
}

/**
 * Chi tiet tho CHI cho console luc phat trien — KHONG vao nhat ky, khong vao
 * file (file cung mo duoc bang nut "Mở file nhật ký").
 * Danh doi da biet: user bao loi thi minh it manh moi hon. Chap nhan.
 */
export function debugRaw(ctx: string, raw: unknown): void {
  if (!process.env['ELECTRON_RENDERER_URL']) return // chi che do phat trien
  try {
    console.error(`[tblao:debug] ${consoleMessage(ctx)}: ${consoleMessage(String(raw ?? ''))}`)
  } catch {
    /* ong dut — ke */
  }
}

/** Convert user-facing Vietnamese logs into ASCII English for Windows CMD. */
function consoleMessage(message: string): string {
  type ConsoleReplacement = string | ((match: string, ...groups: string[]) => string)
  const replacements: Array<[RegExp, ConsoleReplacement]> = [
    [/Insights: đã thu thập (\d+) video xu hướng Douyin\./i, 'Insights: collected $1 Douyin trending videos.'],
    [/Insights: không thể kết nối nguồn xu hướng Douyin\./i, 'Insights: cannot connect to the Douyin trend source.'],
    [/T-blao (.+) khởi động · (.+)/i, 'T-blao $1 started on $2'],
    [/Kiểm tra môi trường: bộ tải xuống=(có|thiếu), ffmpeg=(có|thiếu)/i, (_match, downloader, ffmpeg) =>
      `Environment check: downloader=${downloader === 'có' ? 'available' : 'missing'}, ffmpeg=${ffmpeg === 'có' ? 'available' : 'missing'}`],
    [/Douyin: đang tải bộ tải Douyin/i, 'Douyin: downloading the downloader'],
    [/Douyin: đã tải xong bộ tải Douyin/i, 'Douyin: downloader installed'],
    [/Douyin: bắt đầu tải \(kiểu: (.+)\)/i, 'Douyin: download started (mode: $1)'],
    [/Douyin: hoàn tất — thành công (\d+)\/(\d+)/i, 'Douyin: completed successfully ($1/$2)'],
    [/Douyin: xóa cookie đăng nhập\./i, 'Douyin: login cookies cleared.'],
    [/Douyin: mở cửa sổ đăng nhập lấy cookie\./i, 'Douyin: opening the login window to capture cookies.'],
    [/Douyin: đã lưu (\d+) cookie\./i, 'Douyin: saved $1 cookies.'],
    [/Đang tải công cụ tải/i, 'Downloading the download tool'],
    [/Tự kiểm tra cập nhật công cụ tải/i, 'Checking for downloader updates'],
    [/Tự cập nhật công cụ tải/i, 'Updating the downloader automatically'],
    [/Cập nhật công cụ tải/i, 'Downloader update'],
    [/Xóa cookie đăng nhập\./i, 'Login cookies cleared.'],
    [/Mở cửa sổ đăng nhập lấy cookie/i, 'Opening the login window to capture cookies'],
    [/Đã lưu (\d+) cookie\./i, 'Saved $1 cookies.'],
    [/Lấy thông tin video từ/i, 'Fetching video information from'],
    [/Lấy thông tin thất bại/i, 'Video information request failed'],
    [/Phân tích danh sách từ/i, 'Analyzing playlist from'],
    [/Phân tích danh sách thất bại/i, 'Playlist analysis failed'],
    [/Bắt đầu tải từ/i, 'Starting download from'],
    [/Tải xuống thất bại/i, 'Download failed'],
    [/Tải xuống/i, 'Download'],
    [/Hoàn tất:/i, 'Completed:'],
    [/Tải lỗi 403 khi dùng cookie — thử lại KHÔNG cookie/i, 'Cookie download returned 403; retrying without cookies'],
    [/Thử lại không cookie: thành công\./i, 'Retry without cookies: successful.'],
    [/Audio→Text: đang tải gói tăng tốc GPU/i, 'Audio to text: downloading the GPU acceleration package'],
    [/Audio→Text: đang giải nén gói GPU/i, 'Audio to text: extracting the GPU package'],
    [/Audio→Text: đã cài gói tăng tốc GPU/i, 'Audio to text: GPU acceleration package installed'],
    [/Audio→Text: đang tải bộ chuyển giọng nói/i, 'Audio to text: downloading the speech engine'],
    [/Audio→Text: đang giải nén/i, 'Audio to text: extracting files'],
    [/Audio→Text: đã cài xong engine/i, 'Audio to text: engine installed'],
    [/Dịch màn hình/i, 'Screen translation'],
    [/Dịch phụ đề/i, 'Subtitle translation'],
    [/Tự cập nhật app/i, 'App auto-update'],
    [/Có bản cập nhật app:/i, 'App update available:'],
    [/Đã tải bản cập nhật/i, 'App update downloaded'],
    [/Lỗi tự cập nhật app/i, 'App auto-update error'],
    [/Kiểm tra cập nhật lỗi/i, 'Update check error'],
    [/Đã xóa nhật ký\./i, 'Logs cleared.'],
    [/quá thời gian chờ — máy chủ không phản hồi/i, 'request timed out; server did not respond'],
    [/lỗi kết nối mạng/i, 'network connection error'],
    [/lỗi proxy/i, 'proxy error'],
    [/máy không đủ bộ nhớ/i, 'not enough memory'],
    [/vượt hạn mức, thử lại sau/i, 'quota exceeded; try again later'],
    [/dịch vụ đang quá tải/i, 'service overloaded'],
    [/khoá không hợp lệ/i, 'invalid API key'],
    [/nội dung bị chặn theo khu vực/i, 'content is blocked in this region'],
    [/cần đăng nhập mới tải được/i, 'login is required'],
    [/nội dung không còn khả dụng/i, 'content is unavailable'],
    [/thiếu tệp hoặc công cụ/i, 'a required file or tool is missing'],
    [/không đủ quyền ghi/i, 'write permission denied'],
    [/lỗi không xác định/i, 'unknown error']
  ]
  const translated = replacements.reduce((result, [pattern, replacement]) =>
    typeof replacement === 'string'
      ? result.replace(pattern, replacement)
      : result.replace(pattern, (match, ...args: unknown[]) => replacement(match, ...args.map(String))),
  message)
  return translated
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '?')
}

/** Ghi 1 dong nhat ky: vao bo nho, phat len UI, va ghi file. */
export function log(level: LogLevel, msg: string): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, msg }
  buffer.push(entry)
  if (buffer.length > MAX) buffer.shift()
  logEmitter.emit('entry', entry)

  // Ghi file (fire-and-forget, khong chan luong)
  void ensureDir().then(() =>
    appendFile(logFilePath(), `[${entry.time}] ${level.toUpperCase()} ${msg}\n`).catch(() => {})
  )

  // In ra console CHI de tien theo doi luc phat trien. Neu dau kia dong ong
  // (dong cua so console, chay qua `| head`...) thi console.log NEM EPIPE ->
  // khong ai bat -> SAP CA APP. Ghi nhat ky khong bao gio duoc lam sap app.
  try {
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    out(`[tblao] ${consoleMessage(msg)}`)
  } catch {
    /* mat dong log tren console — app van chay, van co file + UI Nhat ky */
  }
}

export const logInfo = (m: string): void => log('info', m)
export const logWarn = (m: string): void => log('warn', m)
export const logError = (m: string): void => log('error', m)

export function getLogs(): LogEntry[] {
  return [...buffer]
}
export function clearLogs(): void {
  buffer.length = 0
  logEmitter.emit('cleared')
  logInfo('Đã xóa nhật ký.')
}

/** Xoa sach file log (dong bo) — goi luc app thoat de moi lan mo la nhat ky moi. */
export function wipeLogFileSync(): void {
  buffer.length = 0
  try {
    rmSync(logFilePath(), { force: true })
  } catch {
    /* bo qua */
  }
}
