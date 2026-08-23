import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Downloader from './components/Downloader'
import Douyin from './components/Douyin'
import AudioText from './components/AudioText'
import ScreenText from './components/ScreenText'
import AutoPipeline from './components/AutoPipeline'
import TrendInsights from './components/TrendInsights'
import VideoManager from './components/VideoManager'
import License from './components/License'
import Logs from './components/Logs'
import type { UpdateStatus } from '../../shared/types'

const REPO_URL = 'https://github.com/NeeyuBL/neeyut-blao'

type Stage = 'checking' | 'setup' | 'ready'
type TabKey = 'download' | 'douyin' | 'audiotext' | 'screen' | 'automation' | 'insights' | 'videos' | 'logs' | 'license'

interface Tab {
  key: TabKey
  label: string
  title: string
  subtitle: string
}

// Tab tinh nang chinh (o tren). Them tinh nang moi = them 1 entry vao day.
const TABS: Tab[] = [
  {
    key: 'automation',
    label: 'Tự động',
    title: 'Trung tâm tự động',
    subtitle: 'Thiết kế, chạy và theo dõi workflow video'
  },
  {
    key: 'insights',
    label: 'Insights',
    title: 'Insights xu hướng',
    subtitle: 'Tín hiệu, category và đề xuất video tiếp theo'
  },
  {
    key: 'videos',
    label: 'Quản lý video',
    title: 'Quản lý video đề xuất',
    subtitle: 'Theo dõi snapshot, file đầu ra và trạng thái đăng video'
  },
  {
    key: 'download',
    label: 'Tải xuống',
    title: 'Tải xuống',
    subtitle: 'Video & âm thanh đa nền tảng'
  },
  {
    key: 'douyin',
    label: 'Douyin',
    title: 'Tải Douyin',
    subtitle: 'Video & kênh Douyin (không watermark)'
  },
  {
    key: 'audiotext',
    label: 'Phụ đề',
    title: 'Audio → Text',
    subtitle: 'Tạo phụ đề .srt từ giọng nói bằng AI'
  },
  {
    key: 'screen',
    label: 'Dịch màn hình',
    title: 'Dịch màn hình',
    // Anh em voi tab Phu de: mot ben tu TIENG, mot ben tu HINH.
    // Danh cho video chi co chu chay, khong co tieng -> tab Phu de bo tay.
    subtitle: 'Đọc chữ chạy trên video → tạo phụ đề .srt'
  }
]

// Muc phu o day sidebar
const BOTTOM_TABS: Tab[] = [
  {
    key: 'logs',
    label: 'Nhật ký',
    title: 'Nhật ký hoạt động',
    subtitle: 'Theo dõi hoạt động & lỗi phát sinh'
  },
  {
    key: 'license',
    label: 'Giấy phép',
    title: 'Giấy phép & Điều khoản',
    subtitle: 'Bản quyền và trách nhiệm sử dụng'
  }
]

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('checking')
  // Always open the automation dashboard while preserving each tab's saved settings.
  const [tab, setTab] = useState<TabKey>('automation')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // Thu muc luu dung CHUNG cho moi tab; nho qua cac lan mo app
  const [outputDir, setOutputDir] = useState('')
  // "Hop thu" gui file tu tab Tai xuong sang tab Audio->Text (nut "Lay sub")
  const [subInbox, setSubInbox] = useState<{ path: string; id: string } | null>(null)

  const sendToSub = (filePath: string): void => {
    setSubInbox({ path: filePath, id: crypto.randomUUID() })
    setTab('audiotext')
  }

  const updateOutputDir = (d: string): void => {
    setOutputDir(d)
    try {
      localStorage.setItem('tblao.outputDir', d)
    } catch {
      /* bo qua */
    }
  }

  const check = async (): Promise<void> => {
    setStage('checking')
    const status = await window.api.checkDeps()
    setStage(status.ytdlp && status.ffmpeg ? 'ready' : 'setup')
  }

  useEffect(() => {
    void check()
    void window.api.appVersion().then(setVersion)
    const saved = localStorage.getItem('tblao.outputDir')
    if (saved) setOutputDir(saved)
    else void window.api.downloadsDir().then(setOutputDir)
    const offUpd = window.api.onUpdateStatus(setUpdate)
    return offUpd
  }, [])

  if (stage === 'checking') {
    return (
      <div className="boot">
        <div className="center">
          <div className="spinner" />
          <p>Đang kiểm tra môi trường…</p>
        </div>
      </div>
    )
  }

  if (stage === 'setup') {
    return (
      <div className="boot">
        <SetupScreen onDone={() => setStage('ready')} />
      </div>
    )
  }

  const active = [...TABS, ...BOTTOM_TABS].find((t) => t.key === tab) ?? TABS[0]

  const renderTab = (t: Tab): JSX.Element => (
    <button
      key={t.key}
      className={`side-item ${t.key === tab ? 'active' : ''}`}
      onClick={() => setTab(t.key)}
    >
      <span>{t.label}</span>
    </button>
  )

  return (
    <div className="shell">
      <header className="sidebar">
        <div className="side-brand">
          <span className="side-logo">T-blao</span>
        </div>
        <nav className="side-nav">{TABS.map(renderTab)}</nav>
        <div className="side-bottom">
          {BOTTOM_TABS.map(renderTab)}
          <div className="side-links">
            <button className="side-link" onClick={() => window.api.openExternal(REPO_URL)}>
              GitHub
            </button>
          </div>
          <div className="side-version">Phiên bản {version || '…'}</div>
          {update?.state === 'downloaded' && (
            <button
              className="side-update ready"
              onClick={() => window.api.installAppUpdate()}
              title="Khởi động lại để cài bản mới"
            >
              Có bản mới {update.version} — Cập nhật ngay
            </button>
          )}
          {update?.state === 'downloading' && (
            <div className="side-update">Đang tải bản mới… {update.percent ?? 0}%</div>
          )}
          {update?.state === 'available' && (
            <div className="side-update">Đã có bản {update.version}, đang tải…</div>
          )}
        </div>
      </header>

      <main className="content">
        <header className="content-head">
          <div>
            <h1 className="content-title">{active.title}</h1>
            <p className="content-sub muted">{active.subtitle}</p>
          </div>
          <div className="content-head-meta">Local workflow manager</div>
        </header>
        <div className="content-body">
          {/* Giu 2 tab tai luon SONG (khong unmount) de chay song song, khong mat hang doi/tien do */}
          <div className={`tab-pane ${tab === 'download' ? '' : 'hidden'}`}>
            <Downloader
              outputDir={outputDir}
              setOutputDir={updateOutputDir}
              onGetSub={sendToSub}
            />
          </div>
          <div className={`tab-pane ${tab === 'douyin' ? '' : 'hidden'}`}>
            <Douyin outputDir={outputDir} setOutputDir={updateOutputDir} />
          </div>
          <div className={`tab-pane ${tab === 'audiotext' ? '' : 'hidden'}`}>
            <AudioText
              outputDir={outputDir}
              setOutputDir={updateOutputDir}
              subInbox={subInbox}
            />
          </div>
          {/* GIU SONG (khong unmount): user chon video + keo khung xong ma qua
              tab khac mot cai la mat sach, phai lam lai tu dau. Nho toi khi tat
              app — dung y user chot. */}
          <div className={`tab-pane ${tab === 'screen' ? '' : 'hidden'}`}>
            <ScreenText outputDir={outputDir} setOutputDir={updateOutputDir} />
          </div>
          <div className={`tab-pane ${tab === 'automation' ? '' : 'hidden'}`}>
            <AutoPipeline outputDir={outputDir} setOutputDir={updateOutputDir} onNavigate={setTab} />
          </div>
          <div className={`tab-pane ${tab === 'insights' ? '' : 'hidden'}`}>
            <TrendInsights outputDir={outputDir} setOutputDir={updateOutputDir} />
          </div>
          {tab === 'videos' && <VideoManager outputDir={outputDir} />}
          {tab === 'logs' && <Logs />}
          {tab === 'license' && <License />}
        </div>
      </main>

    </div>
  )
}
