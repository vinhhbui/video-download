export type DouyinMetadataRecord = Record<string, unknown>

function isObjectRecord(value: unknown): value is DouyinMetadataRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function numericMetric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0
  const text = String(value ?? '').trim()
  const parsed = Number(text.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  if (text.includes('亿')) return parsed * 100_000_000
  if (text.includes('万')) return parsed * 10_000
  return Math.max(0, parsed)
}

function hasContent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function mergeFullMetadata(existing: unknown, incoming: unknown): unknown {
  if (!isObjectRecord(existing) || !isObjectRecord(incoming)) {
    return hasContent(incoming) ? incoming : existing
  }
  const merged: DouyinMetadataRecord = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    const previous = existing[key]
    merged[key] = isObjectRecord(previous) && isObjectRecord(value)
      ? mergeFullMetadata(previous, value)
      : hasContent(value) ? value : previous
  }
  return merged
}

/** Recover the Unix timestamp embedded in a standard 64-bit Douyin video ID. */
export function inferCreateTimeFromAwemeId(value: unknown, now = Date.now()): number | null {
  const text = String(value ?? '').trim()
  if (!/^\d{18,20}$/.test(text)) return null
  try {
    const seconds = Number(BigInt(text) >> 32n)
    const earliestDouyinDate = Date.UTC(2016, 0, 1) / 1000
    const latestReasonableDate = Math.floor(now / 1000) + 366 * 24 * 60 * 60
    return seconds >= earliestDouyinDate && seconds <= latestReasonableDate ? seconds : null
  } catch {
    return null
  }
}

/** Preserve full video metadata when a nested statistics object has the same video ID. */
export function mergeDouyinMetadata(
  existing: DouyinMetadataRecord | undefined,
  incoming: DouyinMetadataRecord
): DouyinMetadataRecord {
  if (!existing) return incoming
  const full = mergeFullMetadata(existing, incoming) as DouyinMetadataRecord
  const oldStats = isObjectRecord(existing.statistics) ? existing.statistics : {}
  const newStats = isObjectRecord(incoming.statistics) ? incoming.statistics : {}
  const chooseText = (key: string): unknown => {
    const current = incoming[key]
    return current != null && String(current).trim() !== '' ? current : existing[key]
  }
  const chooseValue = (key: string): unknown => incoming[key] ?? existing[key]
  const oldExtras = Array.isArray(existing.text_extra) ? existing.text_extra : []
  const newExtras = Array.isArray(incoming.text_extra) ? incoming.text_extra : []
  return {
    ...full,
    aweme_id: chooseText('aweme_id'),
    desc: chooseText('desc'),
    author_name: chooseText('author_name'),
    author_id: chooseText('author_id'),
    duration: chooseValue('duration'),
    create_time: chooseValue('create_time'),
    statistics: {
      ...(isObjectRecord(full.statistics) ? full.statistics : {}),
      play_count: Math.max(numericMetric(oldStats.play_count), numericMetric(newStats.play_count)),
      digg_count: Math.max(numericMetric(oldStats.digg_count), numericMetric(newStats.digg_count)),
      comment_count: Math.max(numericMetric(oldStats.comment_count), numericMetric(newStats.comment_count)),
      share_count: Math.max(numericMetric(oldStats.share_count), numericMetric(newStats.share_count)),
      collect_count: Math.max(numericMetric(oldStats.collect_count), numericMetric(newStats.collect_count))
    },
    text_extra: newExtras.length >= oldExtras.length ? newExtras : oldExtras
  }
}
