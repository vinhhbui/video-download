const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

// Load production TypeScript modules without adding another test dependency.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  })
  module._compile(output.outputText, filename)
}

const { listManagedTrendVideos, readTrendDatabase, trendDatabasePath, updateTrendDatabase, updateTrendDatabaseScores, updateTrendVideoStatus } = require('../src/main/trendDatabase.ts')

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tblao-trend-db-'))
  try {
    const id = '7657142202166362085'
    const first = new Map([[id, {
      aweme_id: id,
      desc: 'Persistent metadata',
      author_name: 'Creator',
      video: { cover: { url_list: ['https://example.test/cover.jpg'] } },
      statistics: { play_count: 0, digg_count: 100, comment_count: 10, share_count: 5 }
    }], ['7657142202166362086', {
      aweme_id: '7657142202166362086',
      desc: 'AI technology tutorial #tech',
      author_name: 'Previous creator',
      statistics: { play_count: 1000, digg_count: 100, comment_count: 10, share_count: 5 }
    }]])
    const second = new Map([[id, {
      aweme_id: id,
      desc: '',
      author_name: '',
      statistics: { play_count: 0, digg_count: 140, comment_count: 12, share_count: 8 }
    }]])

    await updateTrendDatabase(root, first, '2026-07-22T07:00:00.000Z')
    await updateTrendDatabase(root, second, '2026-07-22T07:30:00.000Z')
    const database = await readTrendDatabase(root)
    const video = database.videos[id]

    assert.equal(fs.existsSync(trendDatabasePath(root)), true)
    assert.equal(Object.keys(database.videos).length, 2)
    assert.equal(video.collectionCount, 2)
    assert.equal(video.snapshots.length, 2)
    assert.equal(video.snapshots[1].likes, 140)
    assert.equal(video.metadata.desc, 'Persistent metadata')
    assert.equal(video.metadata.video.cover.url_list[0], 'https://example.test/cover.jpg')
    assert.equal(video.isCurrentlyTrending, true)
    assert.equal(database.categories.lifestyle.includes(id), true)
    assert.equal(database.videos['7657142202166362086'].isCurrentlyTrending, false)
    assert.equal(database.categories.technology.includes('7657142202166362086'), false)
    assert.equal(database.currentCollection.videoCount, 1)
    assert.equal(video.status, 'discovered')

    const scopedUpdate = new Map([['7657142202166362086', {
      aweme_id: '7657142202166362086',
      desc: 'AI technology tutorial #tech',
      author_name: 'Previous creator',
      statistics: { play_count: 1300, digg_count: 150, comment_count: 12, share_count: 7 }
    }]])
    await updateTrendDatabase(root, scopedUpdate, '2026-07-22T08:00:00.000Z', ['technology'])
    const scopedDatabase = await readTrendDatabase(root)
    assert.equal(scopedDatabase.videos[id].isCurrentlyTrending, true)
    assert.equal(scopedDatabase.videos['7657142202166362086'].isCurrentlyTrending, true)
    assert.equal(scopedDatabase.currentCollection.videoCount, 2)
    assert.equal(scopedDatabase.categories.lifestyle.includes(id), true)
    assert.equal(scopedDatabase.categories.technology.includes('7657142202166362086'), true)

    await updateTrendDatabaseScores(root, new Map([[id, {
      category: 'lifestyle',
      trendScore: 72,
      engagementRate: 4.2,
      viewVelocity: 80,
      velocityMetric: 'likes',
      growthAcceleration: null,
      scoreMode: 'trend',
      snapshotCount: 2,
      snapshotTarget: 2,
      dataStatus: 'READY_FOR_REVIEW',
      recommendationStatus: 'watch',
      recommendationReason: 'Test score'
    }]]), '2026-07-22T07:30:01.000Z')
    const scoredDatabase = await readTrendDatabase(root)
    assert.equal(scoredDatabase.videos[id].latestScore.trendScore, 72)
    assert.equal(scoredDatabase.videos[id].scoreHistory.length, 1)

    await updateTrendVideoStatus({
      dataDir: root,
      id,
      status: 'exported',
      outputFiles: ['D:/Video/final.mp4'],
      notes: 'Ready for review'
    })
    const managed = await listManagedTrendVideos(root)
    assert.equal(managed[0].status, 'exported')
    assert.deepEqual(managed[0].outputFiles, ['D:/Video/final.mp4'])
    assert.equal(managed[0].snapshotCount, 2)
    assert.equal(managed[0].category, 'lifestyle')
    assert.equal(managed[0].coverUrl, 'https://example.test/cover.jpg')
    assert.equal(managed[0].trendScore, 72)
    assert.equal(managed[0].dataStatus, 'READY_FOR_REVIEW')
    assert.equal(managed[0].recommendationStatus, 'watch')
    assert.equal(managed[0].favorites, 0)
    console.log('Trend database tests passed.')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
