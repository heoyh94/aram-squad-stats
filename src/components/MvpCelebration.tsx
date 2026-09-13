'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AWARD_VISIBLE_MS, playAwardAudio } from '@/lib/awardAudio'

/** 모달이 저절로 닫히기까지의 시간. */
const VISIBLE_MS = AWARD_VISIBLE_MS

/**
 * 이미지를 기다려 주는 상한.
 *
 * 연출이 2초뿐이라 모달을 띄운 뒤에 사진을 받으면 빈 칸만 보다가 닫힌다.
 * 그래서 띄우기 전에 미리 받아 두되, 늦으면 연출 자체를 삼키지 않도록
 * 여기서 끊고 그냥 띄운다.
 */
const PRELOAD_TIMEOUT_MS = 1500

/**
 * 이미지를 미리 받아 둔다. 성공·실패·시간초과 모두 resolve 한다 —
 * 호출한 쪽은 "이제 띄워도 된다"만 알면 된다.
 */
export function preloadImage(
  url: string,
  timeoutMs = PRELOAD_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image()
    const done = () => {
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(done, timeoutMs)
    image.onload = done
    image.onerror = done
    image.src = url
  })
}

/** 여러 장을 한꺼번에. 없는 URL 은 건너뛴다. */
export function preloadImages(
  urls: (string | null)[],
  timeoutMs = PRELOAD_TIMEOUT_MS,
): Promise<void> {
  const real = urls.filter((url): url is string => Boolean(url))
  if (!real.length) return Promise.resolve()
  return Promise.all(real.map((url) => preloadImage(url, timeoutMs))).then(
    () => undefined,
  )
}

const CONFETTI_COLORS = [
  '#fbbf24',
  '#f472b6',
  '#60a5fa',
  '#34d399',
  '#c084fc',
  '#fb7185',
]
const CONFETTI_COUNT = 40
const FLY_COUNT = 9

export interface AwardSubject {
  playerName: string
  /** `public/players/` 안의 경로. 없으면 이름 첫 글자를 대신 보여준다. */
  photoUrl: string | null
  /** 큰 글씨로 세울 값 (MVP 는 점수, 걸배이는 하락 폭) */
  headline: string
  /** headline 아래 붙는 설명 */
  caption: string
  /** 이름 아래 한 줄 (챔피언·KDA 등). 없으면 생략 */
  detail?: string
}

export interface CelebrationProps {
  onClose: () => void
  autoClose?: boolean
  dateLabel?: string
  soundEnabled?: boolean
  onToggleSound?: () => void
  /** 갱신된 MVP. 변동 없으면 null */
  mvp: AwardSubject | null
  /** 갱신된 걸배이. 변동 없으면 null */
  anchor: AwardSubject | null
}

interface ConfettiPiece {
  left: number
  /** 움직임을 줄인 화면에서 조각이 멈춰 설 높이. 애니메이션이 돌 땐 쓰이지 않는다. */
  top: number
  delay: number
  duration: number
  color: string
  rotate: number
}

interface Fly {
  left: number
  top: number
  dx: number
  dy: number
  duration: number
  delay: number
}

function makeConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }, () => ({
    left: Math.random() * 100,
    top: 4 + Math.random() * 88,
    delay: Math.random() * 0.4,
    duration: 1.1 + Math.random() * 0.9,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rotate: Math.random() * 360,
  }))
}

function makeFlies(): Fly[] {
  return Array.from({ length: FLY_COUNT }, () => ({
    left: 10 + Math.random() * 80,
    top: 12 + Math.random() * 70,
    dx: 18 + Math.random() * 42,
    dy: 12 + Math.random() * 32,
    duration: 1.4 + Math.random() * 1.6,
    delay: Math.random() * 0.6,
  }))
}

/** 사진이 없을 때 대신 세우는 이름 첫 글자. */
function PhotoFallback({
  name,
  tone,
}: {
  name: string
  tone: 'gold' | 'grime'
}) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center text-6xl font-black ${
        tone === 'gold'
          ? 'bg-amber-900/60 text-amber-200'
          : 'bg-stone-800/70 text-stone-400'
      }`}
    >
      {name.slice(0, 1)}
    </div>
  )
}

function AwardPhoto({
  subject,
  tone,
  sizeClass,
}: {
  subject: AwardSubject
  tone: 'gold' | 'grime'
  sizeClass: string
}) {
  const [failed, setFailed] = useState(false)
  const ring =
    tone === 'gold'
      ? 'border-amber-300 shadow-[0_0_40px_rgba(251,191,36,0.55)]'
      : 'border-stone-600 shadow-[0_0_28px_rgba(0,0,0,0.6)]'

  return (
    <div
      className={`${sizeClass} overflow-hidden rounded-full border-4 ${ring} ${
        tone === 'grime' ? 'celebration-loser-photo' : ''
      }`}
    >
      {subject.photoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={subject.photoUrl}
          alt={subject.playerName}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover ${tone === 'grime' ? 'grayscale-[0.65] brightness-75' : ''}`}
        />
      ) : (
        <PhotoFallback name={subject.playerName} tone={tone} />
      )}
    </div>
  )
}

/** 위쪽(또는 단독) 칸: 축하. */
function MvpPanel({ subject, solo }: { subject: AwardSubject; solo: boolean }) {
  const [confetti] = useState<ConfettiPiece[]>(makeConfetti)

  return (
    <div className="celebration-panel celebration-gold flex flex-1 flex-col items-center justify-center gap-2 px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {confetti.map((piece, index) => (
          <span
            key={index}
            className="mvp-confetti"
            style={{
              left: `${piece.left}%`,
              ['--confetti-top' as string]: `${piece.top}%`,
              backgroundColor: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              transform: `rotate(${piece.rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div className="mvp-celebration-card relative flex flex-col items-center gap-2">
        <div className={solo ? 'text-5xl' : 'text-3xl'} aria-hidden="true">
          👑
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-400">
          이날 최고의 한 판
        </div>

        <AwardPhoto
          subject={subject}
          tone="gold"
          sizeClass={
            solo ? 'h-48 w-48 sm:h-64 sm:w-64' : 'h-24 w-24 sm:h-40 sm:w-40'
          }
        />

        <div
          className={`celebration-name font-black leading-tight text-white ${
            solo ? 'text-4xl' : 'text-2xl'
          }`}
        >
          {subject.playerName}
        </div>
        {subject.detail && (
          <div className="text-sm text-amber-300">{subject.detail}</div>
        )}
        <div
          className={`font-black text-amber-300 ${solo ? 'text-5xl' : 'text-3xl'}`}
        >
          {subject.headline}
        </div>
        <div className="text-xs text-amber-500">{subject.caption}</div>
      </div>
    </div>
  )
}

/** 아래쪽(또는 단독) 칸: 파리 날리는 반대 연출. */
function AnchorPanel({
  subject,
  solo,
}: {
  subject: AwardSubject
  solo: boolean
}) {
  const [flies] = useState<Fly[]>(makeFlies)

  return (
    <div className="celebration-panel celebration-grime flex flex-1 flex-col items-center justify-center gap-2 px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {flies.map((fly, index) => (
          <span
            key={index}
            className="celebration-fly"
            style={{
              left: `${fly.left}%`,
              top: `${fly.top}%`,
              ['--fly-x' as string]: `${fly.dx}px`,
              ['--fly-y' as string]: `${fly.dy}px`,
              animationDuration: `${fly.duration}s`,
              animationDelay: `${fly.delay}s`,
            }}
          >
            🪰
          </span>
        ))}
      </div>

      <div className="celebration-loser-card relative flex flex-col items-center gap-2">
        <div className={solo ? 'text-5xl' : 'text-3xl'} aria-hidden="true">
          🧊
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-300">
          이날의 걸배이
        </div>

        <AwardPhoto
          subject={subject}
          tone="grime"
          sizeClass={
            solo ? 'h-48 w-48 sm:h-64 sm:w-64' : 'h-24 w-24 sm:h-40 sm:w-40'
          }
        />

        <div
          className={`celebration-name font-black leading-tight text-white ${
            solo ? 'text-4xl' : 'text-2xl'
          }`}
        >
          {subject.playerName}
        </div>
        {subject.detail && (
          <div className="text-sm text-stone-400">{subject.detail}</div>
        )}
        <div
          className={`font-black text-stone-300 ${solo ? 'text-5xl' : 'text-3xl'}`}
        >
          {subject.headline}
        </div>
        <div className="text-xs text-stone-500">{subject.caption}</div>
      </div>
    </div>
  )
}

/**
 * 하루의 상 갱신 연출.
 *
 * 갱신된 것만 마운트된다. 둘 다 바뀌면 화면을 위아래로 정확히 반씩 나눠
 * 스크롤 없이 한 화면에 담고, 하나만 바뀌면 그쪽이 화면 전체를 쓴다.
 *
 * 열림 여부를 prop 으로 들고 있으면 조각 배치와 이미지 실패 상태를 매번
 * 되돌려야 해서, 마운트 자체를 신호로 쓴다.
 */
export default function MvpCelebration({
  onClose,
  mvp,
  anchor,
  autoClose = true,
  dateLabel,
  soundEnabled = false,
  onToggleSound,
}: CelebrationProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openedAt = useRef(0)
  const hasMvp = Boolean(mvp)
  const hasAnchor = Boolean(anchor)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    openedAt.current = performance.now()
    const timer = autoClose ? window.setTimeout(onClose, VISIBLE_MS) : undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    // 연출이 뜬 동안에는 뒤 페이지가 움직이지 않아야 한다. 모바일에서 모달
    // 위를 쓸면 뒤가 밀려 "한 화면" 이 깨진다.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      dialog?.close()
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose, autoClose])
  useEffect(() => {
    if (!soundEnabled) return
    const remaining = autoClose
      ? VISIBLE_MS - (performance.now() - openedAt.current)
      : VISIBLE_MS
    const stop = playAwardAudio({ mvp: hasMvp, anchor: hasAnchor }, remaining)
    const onVisibility = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [hasMvp, hasAnchor, soundEnabled, autoClose])

  if (!mvp && !anchor) return null
  const solo = !mvp || !anchor

  const label =
    mvp && anchor
      ? `오늘의 MVP ${mvp.playerName}, 오늘의 걸배이 ${anchor.playerName}`
      : mvp
        ? `오늘의 MVP ${mvp.playerName}`
        : `오늘의 걸배이 ${anchor!.playerName}`

  // 포털로 body 에 직접 붙인다. 대시보드 안에 두면 조상의 stacking context 에
  // 갇혀, z-50 인데도 z-40 짜리 하단탭이 위로 올라왔다.
  // 이 컴포넌트는 requestAnimationFrame 안에서만 마운트되므로 항상 클라이언트다.
  return createPortal(
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      // 화면을 꽉 채우고 절대 스크롤되지 않는다. 두 칸은 flex-1 로 정확히 반씩.
      // 하단탭(z-40)보다 확실히 위에 올린다.
      className="mvp-celebration fixed inset-0 z-[100] flex flex-col overflow-hidden"
    >
      <div className="celebration-toolbar">
        <span>{dateLabel}</span>
        {onToggleSound && (
          <button
            className="celebration-sound"
            aria-label="시상식 효과음"
            aria-pressed={soundEnabled}
            onClick={(event) => {
              event.stopPropagation()
              onToggleSound()
            }}
          >
            {soundEnabled ? '소리 켜짐' : '소리 꺼짐'}
          </button>
        )}
        <button aria-label="시상식 닫기" onClick={onClose}>
          닫기 ×
        </button>
      </div>
      {mvp && <MvpPanel subject={mvp} solo={solo} />}
      {mvp && anchor && <div className="h-px shrink-0 bg-white/15" />}
      {anchor && <AnchorPanel subject={anchor} solo={solo} />}
    </dialog>,
    document.body,
  )
}
