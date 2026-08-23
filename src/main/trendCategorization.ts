import type { TrendCategory } from '../shared/types'
import type { DouyinMetadataRecord } from './douyinMetadataMerge'

export const STORED_TREND_CATEGORIES: Exclude<TrendCategory, 'all'>[] = [
  'education',
  'technology',
  'beauty',
  'food',
  'travel',
  'entertainment',
  'business',
  'lifestyle'
]

const CATEGORY_KEYWORDS: Record<Exclude<TrendCategory, 'all'>, string[]> = {
  education: ['học', 'giáo dục', 'kiến thức', 'mẹo', 'tips', '教程', '学习', '知识'],
  technology: ['công nghệ', 'ai', 'điện thoại', 'máy tính', 'app', 'tech', '科技', '数码'],
  beauty: ['làm đẹp', 'mỹ phẩm', 'skincare', 'makeup', 'beauty', '护肤', '美妆'],
  food: ['ẩm thực', 'món ăn', 'nấu ăn', 'food', 'recipe', '美食', '做饭'],
  travel: ['du lịch', 'địa điểm', 'travel', 'khám phá', '旅行', '景点'],
  entertainment: ['giải trí', 'hài', 'phim', 'âm nhạc', 'funny', '娱乐', '搞笑'],
  business: ['kinh doanh', 'marketing', 'bán hàng', 'tài chính', 'business', '商业', '创业'],
  lifestyle: ['đời sống', 'thói quen', 'gia đình', 'lifestyle', '生活', '日常']
}

function objectRecord(value: unknown): DouyinMetadataRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as DouyinMetadataRecord
    : {}
}

function textValue(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

export function trendHashtags(record: DouyinMetadataRecord): string[] {
  const extras = Array.isArray(record.text_extra)
    ? record.text_extra
    : Array.isArray(record.textExtra) ? record.textExtra : []
  const structured = extras.flatMap((item) => {
    if (typeof item === 'string') return [item]
    const value = objectRecord(item)
    const tag = value.hashtag_name ?? value.hashtagName ?? value.name
    return tag == null ? [] : [String(tag)]
  })
  const description = textValue(record.desc ?? record.description ?? record.title)
  const inline = [...description.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1])
  return [...new Set([...structured, ...inline]
    .map((tag) => tag.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean))]
}

export function categorizeTrendVideo(record: DouyinMetadataRecord): Exclude<TrendCategory, 'all'> {
  const searchableText = [
    record.desc,
    record.description,
    record.title,
    trendHashtags(record).join(' ')
  ].map(textValue).join(' ').toLowerCase()
  let best: Exclude<TrendCategory, 'all'> = 'lifestyle'
  let bestScore = 0
  for (const category of STORED_TREND_CATEGORIES) {
    const score = CATEGORY_KEYWORDS[category]
      .filter((keyword) => searchableText.includes(keyword)).length
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }
  return best
}
