const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

// Load the production TypeScript module without adding another test dependency.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  })
  module._compile(output.outputText, filename)
}

const { inferCreateTimeFromAwemeId, mergeDouyinMetadata } = require('../src/main/douyinMetadataMerge.ts')

const fullMetadata = {
  aweme_id: '7657142202166362085',
  desc: 'AI workflow tutorial #ai',
  author_name: 'Test creator',
  author_id: 'creator-1',
  duration: 12800,
  create_time: 1784678400,
  statistics: {
    play_count: 0,
    digg_count: 90288,
    comment_count: 4825,
    share_count: 43177,
    collect_count: 24054,
    whatsapp_share_count: 123
  },
  text_extra: [{ hashtag_name: 'ai' }],
  video: { duration: 12800, cover: { url_list: ['https://example.test/cover.jpg'] } },
  music: { title: 'Original sound' }
}

const nestedStatistics = {
  aweme_id: '7657142202166362085',
  desc: '',
  author_name: '',
  author_id: '',
  duration: null,
  create_time: null,
  statistics: {
    play_count: 0,
    digg_count: '9.1万',
    comment_count: 4900,
    share_count: 44000,
    collect_count: 25000
  },
  text_extra: []
}

function verifyMerged(result) {
  assert.equal(result.desc, fullMetadata.desc)
  assert.equal(result.author_name, fullMetadata.author_name)
  assert.equal(result.author_id, fullMetadata.author_id)
  assert.equal(result.duration, fullMetadata.duration)
  assert.equal(result.create_time, fullMetadata.create_time)
  assert.deepEqual(result.text_extra, fullMetadata.text_extra)
  assert.equal(result.statistics.digg_count, 91000)
  assert.equal(result.statistics.comment_count, 4900)
  assert.equal(result.statistics.share_count, 44000)
  assert.equal(result.statistics.collect_count, 25000)
  assert.equal(result.statistics.whatsapp_share_count, 123)
  assert.equal(result.video.cover.url_list[0], 'https://example.test/cover.jpg')
  assert.equal(result.music.title, 'Original sound')
}

verifyMerged(mergeDouyinMetadata(fullMetadata, nestedStatistics))
verifyMerged(mergeDouyinMetadata(nestedStatistics, fullMetadata))
assert.equal(inferCreateTimeFromAwemeId('7657142202166362085'), 1782817347)
assert.equal(inferCreateTimeFromAwemeId('not-a-video-id'), null)

console.log('Douyin metadata merge tests passed.')
