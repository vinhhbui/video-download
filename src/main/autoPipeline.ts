import { basename, join } from 'node:path'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { downloadDouyin } from './douyin'
import { transcribeAudio } from './whisper'
import { translateSrt } from './gemini'
import { burnSubtitle } from './burn'
import type {
  AutoPipelineProgress,
  AutoPipelineRequest,
  AutoPipelineResult,
  DouyinRequest
} from '../shared/types'

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Run one local, reviewable pipeline. It never uploads content to a social platform. */
async function runPipeline(
  id: string,
  request: AutoPipelineRequest,
  onProgress: (progress: AutoPipelineProgress) => void
): Promise<AutoPipelineResult> {
  const send = (
    phase: AutoPipelineProgress['phase'],
    message: string,
    percent: number,
    current = 0,
    total = 1
  ): void => onProgress({ id, phase, message, percent, current, total })

  if (!/^https?:\/\/(?:www\.)?(?:douyin\.com|iesdouyin\.com)\//i.test(request.url.trim())) {
    return { id, ok: false, outputs: [], error: 'Link Douyin không hợp lệ.' }
  }

  const downloadRequest: DouyinRequest = {
    url: request.url.trim(),
    outputDir: request.outputDir,
    isChannel: false,
    mode: 'all',
    batchSize: 1,
    music: true,
    cover: false,
    avatar: false,
    metaJson: true,
    proxy: null
  }

  send('downloading', 'Đang tải video Douyin…', 0)
  const downloaded = await downloadDouyin(id, downloadRequest, (p) =>
    send('downloading', p.line ?? 'Đang tải video Douyin…', p.status === 'finished' ? 100 : 50)
  )
  if (!downloaded.ok) return { id, ok: false, outputs: [], error: downloaded.error }
  if (!downloaded.files?.length) {
    return { id, ok: false, outputs: [], error: 'Không tìm thấy video vừa tải. Vui lòng kiểm tra thư mục lưu.' }
  }

  const outputs: string[] = []
  const total = downloaded.files.length
  for (let index = 0; index < total; index++) {
    const video = downloaded.files[index]
    const name = basename(video)
    send('transcribing', `Đang tạo phụ đề: ${name}`, 0, index, total)
    const transcript = await transcribeAudio(`${id}-${index}`, {
      input: video,
      outputDir: request.outputDir,
      model: request.model,
      language: 'auto',
      task: 'transcribe',
      formats: ['srt'],
      device: request.useGpu ? 'cuda' : 'cpu',
      diarize: false,
      speakers: 0
    }, (p) => send('transcribing', p.line ?? `Đang tạo phụ đề: ${name}`, Math.max(0, p.percent), index, total))
    if (!transcript.ok) return { id, ok: false, outputs, error: transcript.error }

    const sourceSrt = transcript.outputs.find((path) => path.toLowerCase().endsWith('.srt'))
    if (!sourceSrt || !(await fileExists(sourceSrt))) {
      return { id, ok: false, outputs, error: 'Không tìm thấy file phụ đề được tạo.' }
    }

    const viSrt = sourceSrt.replace(/\.srt$/i, '.vi.srt')
    send('translating', `Đang dịch phụ đề Việt: ${name}`, 0, index, total)
    const translated = await translateSrt(sourceSrt, viSrt, 'vi', (done, chunks) =>
      send('translating', `Đang dịch phụ đề Việt: ${name}`, Math.round((done / chunks) * 100), index, total)
    )
    if (!translated.ok) return { id, ok: false, outputs, error: translated.error ?? 'Dịch phụ đề thất bại.' }

    send('rendering', `Đang ghép phụ đề Việt: ${name}`, 0, index, total)
    const rendered = await burnSubtitle({ video, srt: viSrt, outputDir: request.outputDir, mode: 'burn' }, (p) =>
      send('rendering', `Đang ghép phụ đề Việt: ${name}`, Math.max(0, p.percent), index, total)
    )
    if (!rendered.ok || !rendered.output) {
      return { id, ok: false, outputs, error: rendered.error ?? 'Ghép phụ đề thất bại.' }
    }
    outputs.push(rendered.output)
  }

  send('finished', 'Hoàn tất. Hãy xem lại video trước khi đăng lên YouTube.', 100, total, total)
  return { id, ok: true, outputs, error: null }
}

/** Convert unexpected tool or filesystem failures into a safe pipeline result. */
export async function runAutoPipeline(
  id: string,
  request: AutoPipelineRequest,
  onProgress: (progress: AutoPipelineProgress) => void
): Promise<AutoPipelineResult> {
  try {
    return await runPipeline(id, request, onProgress)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onProgress({ id, phase: 'error', message: 'Pipeline thất bại.', percent: 0, current: 0, total: 1 })
    return { id, ok: false, outputs: [], error: message }
  }
}
