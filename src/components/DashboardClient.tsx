'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Game, Player } from '@/lib/types'
import type { NicknameAward } from '@/lib/nicknames'
import type { ChampionNameMap, ChampionRoleLabelMap } from '@/lib/championNames'
import { getPlayerDisplayName, getPlayerPhoto } from '@/lib/config'
import { selectMvp } from '@/lib/mvp'
import { computeDailyTrend } from '@/lib/dailyTrend'
import { calculateMedals } from '@/lib/medals'
import { getAugmentHighlight, getAugmentName } from '@/lib/augmentHighlight'
import { getGameCommentary } from '@/lib/gameCommentary'
import { analyzeTeamComposition } from '@/lib/teamInsights'
import {
  changedAwards,
  primeAwardAudio,
  type AwardChanges,
} from '@/lib/awardAudio'
import {
  displayDate,
  duration,
  gameHref,
  homeHref,
  kstDate,
  validDate,
  recordMoments,
  sessionSummary,
} from '@/lib/experience'
import MvpCelebration, {
  preloadImages,
  type AwardSubject,
} from './MvpCelebration'
import DailyReceipt from './DailyReceipt'
import RecordRoom from './RecordRoom'
import { ChampionAvatar, PlayerAvatar, ScoreHelp } from './GameUI'

const nameOf = (p: { puuid: string; game_name: string }) =>
  getPlayerDisplayName(p.puuid, p.game_name)
const scores = (games: Game[]) =>
  games.flatMap((g) =>
    g.game_results
      .filter((r) => r.players)
      .map((r) => ({ puuid: r.players!.puuid, perfScore: r.perf_score })),
  )
function subscribePrefs(callback: () => void) {
  window.addEventListener('aram-prefs', callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener('aram-prefs', callback)
    window.removeEventListener('storage', callback)
  }
}
function getAuto() {
  try {
    return localStorage.getItem('aram:auto-celebration') !== 'off'
  } catch {
    return false
  }
}
const serverAuto = () => false
function getSound() {
  try {
    return localStorage.getItem('aram:award-sound') !== 'off'
  } catch {
    return false
  }
}

function MatchCard({
  game,
  date,
  open,
  toggle,
  names,
  roles,
}: {
  game: Game
  date: string
  open: boolean
  toggle: () => void
  names: ChampionNameMap
  roles: ChampionRoleLabelMap
}) {
  const results = [...game.game_results]
    .filter((r) => r.players)
    .sort((a, b) => b.perf_score - a.perf_score)
  const mvp = results[0]
  const medals = calculateMedals(results)
  const commentary = getGameCommentary({
    game_id: game.id,
    our_team_win: game.our_team_win,
    game_results: results.map((r) => ({
      name: nameOf(r.players!),
      perf_score: r.perf_score,
      damage_dealt: r.damage_dealt,
      damage_taken: r.damage_taken,
      healing: r.healing,
      assists: r.assists,
      cc_score: r.cc_score,
    })),
  })
  const insights = analyzeTeamComposition({
    win: game.our_team_win,
    members: results.map((r) => ({
      championName: r.champion_name,
      damageType: roles[r.champion_name]?.damageType ?? 'Utility',
    })),
  })
  return (
    <article
      id={`match-${game.id}`}
      className={`surface match-card ${game.our_team_win ? 'match-win' : 'match-loss'}`}
    >
      <div className="match-topline">
        <span
          className={`result-badge ${game.our_team_win ? 'is-win' : 'is-loss'}`}
        >
          {game.our_team_win ? '승리' : '패배'}
        </span>
        <span className="match-time muted text-xs">
          {displayDate(game.played_at, true)} ·{' '}
          {duration(game.duration_seconds)}
        </span>
        <Link className="text-link ml-auto" href={gameHref(game, date)}>
          경기 자세히 →
        </Link>
      </div>
      <button
        className="match-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`results-${game.id}`}
        aria-label={`${displayDate(game.played_at, true)} 선수별 기록 ${open ? '접기' : '펼치기'}`}
      >
        <div className="match-portraits">
          {results.map((r) => (
            <ChampionAvatar
              key={r.id}
              name={r.champion_name}
              label={names[r.champion_name]}
              size={32}
            />
          ))}
        </div>
        <span className="match-star">
          {mvp ? (
            <>
              👑 {nameOf(mvp.players!)}{' '}
              <strong>{Math.round(mvp.perf_score)}점</strong>
            </>
          ) : (
            '선수 기록 없음'
          )}
        </span>
        <span className="chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      <p className="match-comment">{commentary}</p>
      {open && (
        <div id={`results-${game.id}`} className="match-expanded">
          <div className="match-result-grid">
            {results.map((r) => (
              <div className="mini-result" key={r.id}>
                <ChampionAvatar
                  name={r.champion_name}
                  label={names[r.champion_name]}
                  size={36}
                />
                <div className="min-w-0">
                  <Link
                    href={`/players/${encodeURIComponent(r.players!.puuid)}?date=${date}`}
                    className="font-bold text-sm"
                  >
                    {nameOf(r.players!)}
                  </Link>
                  <p className="muted text-xs">
                    {names[r.champion_name] ?? r.champion_name}
                  </p>
                  <p className="text-xs mt-1">
                    {r.kills} / {r.deaths} / {r.assists}
                  </p>
                </div>
                <strong className="mini-score">
                  {Math.round(r.perf_score)}
                </strong>
              </div>
            ))}
          </div>
          <p className="muted text-xs mt-3">🧩 {insights.join(' ')}</p>
          {medals.length > 0 && (
            <p className="muted text-xs mt-2">
              {medals
                .slice(0, 4)
                .map((m) => `${m.medal.emoji} ${m.medal.name}`)
                .join(' · ')}{' '}
              · 수상 근거는 경기 상세에서
            </p>
          )}
        </div>
      )}
    </article>
  )
}

export default function DashboardClient({
  allGames,
  players,
  initialNicknames,
  champRoles,
  championNames,
}: {
  allGames: Game[]
  players: Player[]
  initialNicknames: NicknameAward[]
  champRoles: ChampionRoleLabelMap
  championNames: ChampionNameMap
}) {
  const query = useSearchParams()
  const dates = useMemo(
    () => [...new Set(allGames.map((g) => kstDate(g.played_at)))].sort(),
    [allGames],
  )
  const latestDate = dates.at(-1) ?? kstDate(new Date().toISOString())
  const dateParam = query.get('date')
  const date = validDate(dateParam) ? dateParam : latestDate
  const openId = query.get('game')
  const filtered = useMemo(
    () => allGames.filter((g) => kstDate(g.played_at) === date),
    [allGames, date],
  )
  const summary = sessionSummary(filtered)
  const best = selectMvp(
    filtered.flatMap((g) => g.game_results).filter((r) => r.players),
  )
  const bestGame = filtered.find((g) =>
    g.game_results.some((r) => r.id === best?.id),
  )
  const trend = useMemo(
    () => computeDailyTrend(scores(allGames), scores(filtered)),
    [allGames, filtered],
  )
  const moments = useMemo(() => recordMoments(allGames, date), [allGames, date])
  const augment = getAugmentHighlight(
    filtered.flatMap((g) =>
      g.game_results
        .filter((r) => r.augment_ids?.length)
        .map((r) => ({
          our_team_win: g.our_team_win,
          augment_ids: r.augment_ids,
        })),
    ),
  )
  const playerName = useCallback(
    (puuid: string) => {
      const player = players.find((p) => p.puuid === puuid)
      return player ? nameOf(player) : '—'
    },
    [players],
  )
  const subjects = useMemo(
    () => ({
      mvp: best?.players
        ? ({
            playerName: nameOf(best.players),
            photoUrl: getPlayerPhoto(best.players.puuid),
            headline: `${Math.round(best.perf_score)}점`,
            caption: '이날 단일 경기 최고 기여도',
            detail: `${championNames[best.champion_name] ?? best.champion_name} · ${best.kills}/${best.deaths}/${best.assists}`,
          } satisfies AwardSubject)
        : null,
      anchor: trend
        ? ({
            playerName: playerName(trend.anchor.puuid),
            photoUrl: getPlayerPhoto(trend.anchor.puuid, 'anchor'),
            headline: `${Math.round(trend.anchor.todayAvg)}점`,
            caption: `전체 평균 대비 ${trend.anchor.diff >= 0 ? '+' : ''}${trend.anchor.diff.toFixed(1)}점`,
            detail:
              trend.anchor.diff < 0
                ? '마 정신 안채리나'
                : '다 같이 잘한 날, 상승 폭은 조금 작았네',
          } satisfies AwardSubject)
        : null,
    }),
    [best, championNames, trend, playerName],
  )
  const [celebration, setCelebration] = useState<
    (AwardChanges & { mode: 'auto' | 'manual' }) | null
  >(null)
  const [receipt, setReceipt] = useState(false)
  const auto = useSyncExternalStore(subscribePrefs, getAuto, serverAuto)
  const sound = useSyncExternalStore(subscribePrefs, getSound, serverAuto)
  const closeCelebration = useCallback(() => setCelebration(null), [])
  useEffect(() => {
    if (!sound) return
    const prime = () => primeAwardAudio()
    document.addEventListener('click', prime)
    document.addEventListener('keydown', prime)
    return () => {
      document.removeEventListener('click', prime)
      document.removeEventListener('keydown', prime)
    }
  }, [sound])
  useEffect(() => {
    if (
      !auto ||
      !best ||
      date !== latestDate ||
      openId ||
      receipt ||
      celebration
    )
      return
    const key = `${date}:${best.id}:${trend?.anchor.puuid ?? ''}`
    let changes: AwardChanges
    try {
      changes = changedAwards(localStorage.getItem('aram:shown-awards-v2'), key)
      if (!changes.mvp && !changes.anchor) return
    } catch {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      preloadImages([
        changes.mvp ? (subjects.mvp?.photoUrl ?? null) : null,
        changes.anchor ? (subjects.anchor?.photoUrl ?? null) : null,
      ]).then(() => {
        if (cancelled) return
        setCelebration({ mode: 'auto', ...changes })
        try {
          localStorage.setItem('aram:shown-awards-v2', key)
        } catch {
          /* Optional preference. */
        }
      })
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    auto,
    best,
    date,
    latestDate,
    openId,
    trend,
    receipt,
    celebration,
    subjects,
  ])
  function setDate(value: string) {
    if (validDate(value)) window.history.pushState(null, '', homeHref(value))
  }
  function toggleGame(id: string) {
    window.history.replaceState(
      null,
      '',
      `/?date=${date}${openId === id ? '' : `&game=${id}`}`,
    )
  }
  function toggleAuto() {
    try {
      localStorage.setItem('aram:auto-celebration', auto ? 'off' : 'on')
      window.dispatchEvent(new Event('aram-prefs'))
    } catch {
      /* Optional preference. */
    }
  }
  function toggleSound() {
    if (!sound) primeAwardAudio()
    try {
      localStorage.setItem('aram:award-sound', sound ? 'off' : 'on')
      window.dispatchEvent(new Event('aram-prefs'))
    } catch {
      /* Optional preference. */
    }
  }
  const previous = dates.filter((day) => day < date).at(-1)
  const next = dates.find((day) => day > date)
  return (
    <div className="dashboard space-y-7">
      {celebration && (
        <MvpCelebration
          mvp={celebration.mvp ? subjects.mvp : null}
          anchor={celebration.anchor ? subjects.anchor : null}
          onClose={closeCelebration}
          autoClose={celebration.mode === 'auto'}
          soundEnabled={sound}
          onToggleSound={toggleSound}
          dateLabel={displayDate(date)}
        />
      )}
      {receipt && (
        <DailyReceipt
          games={filtered}
          date={date}
          best={
            best?.players
              ? `${nameOf(best.players)} · ${Math.round(best.perf_score)}점`
              : '—'
          }
          rise={trend ? playerName(trend.carry.puuid) : '—'}
          anchor={trend ? playerName(trend.anchor.puuid) : '—'}
          onClose={() => setReceipt(false)}
        />
      )}
      <section className="day-overview" aria-label="선택한 날짜의 전적">
        <div className="date-nav">
          <button
            className="icon-button"
            aria-label="이전 경기 날짜"
            disabled={!previous}
            onClick={() => previous && setDate(previous)}
          >
            ‹
          </button>
          <label className="date-field">
            <span className="sr-only">경기 날짜 선택</span>
            <span className="date-display" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="3" y="5" width="18" height="16" rx="4" />
                <path d="M7 3v4m10-4v4M3 11h18" />
              </svg>
              <span>{date.replaceAll('-', '.')}</span>
            </span>
            <input
              type="date"
              value={date}
              max={latestDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="icon-button"
            aria-label="다음 경기 날짜"
            disabled={!next}
            onClick={() => next && setDate(next)}
          >
            ›
          </button>
          <button
            className="button-secondary"
            disabled={date === latestDate}
            onClick={() => setDate(latestDate)}
          >
            최신
          </button>
          <span className="muted text-xs hidden sm:inline">한국 시간 기준</span>
        </div>
        <div className="day-headline">
          <div>
            <p className="eyebrow">{displayDate(date)} · OUR MATCH DAY</p>
            <h2>{summary.line}</h2>
            <p className="muted text-sm mt-2">
              {filtered.length
                ? `${filtered.length}전 ${summary.wins}승 ${summary.losses}패 · 같이 뛴 시간 ${Math.floor(summary.seconds / 60)}분`
                : '경기가 있는 다른 날짜를 골라보세요.'}
            </p>
          </div>
          {filtered.length > 0 && (
            <div
              className="day-scoreboard"
              aria-label={`${summary.wins}승 ${summary.losses}패`}
            >
              <div>
                <strong>{String(summary.wins).padStart(2, '0')}</strong>
                <span>승리 / WIN</span>
              </div>
              <span className="scoreboard-divider" aria-hidden="true">
                :
              </span>
              <div>
                <strong>{String(summary.losses).padStart(2, '0')}</strong>
                <span>패배 / LOSS</span>
              </div>
            </div>
          )}
        </div>
        <div
          className="day-results"
          aria-label="선택 날짜 승패, 왼쪽이 먼저 한 경기"
        >
          {[...filtered].reverse().map((g, i) => (
            <Link
              key={g.id}
              href={gameHref(g, date)}
              className={g.our_team_win ? 'is-win' : 'is-loss'}
              aria-label={`${i + 1}번째 경기 ${g.our_team_win ? '승리' : '패배'}`}
            >
              {g.our_team_win ? '승' : '패'}
            </Link>
          ))}
          <button
            className="button-primary"
            disabled={!filtered.length}
            onClick={() => setReceipt(true)}
          >
            전적 영수증 ↗
          </button>
          <span className="muted text-xs">← 첫 판 · 마지막 판 →</span>
        </div>
      </section>
      {best && (
        <section className="award-section" aria-label="이날의 시상식">
          <div className="award-grid">
            <article className="award-card award-gold">
              <div className="flex items-center gap-3">
                <PlayerAvatar
                  puuid={best.players!.puuid}
                  name={nameOf(best.players!)}
                  size={48}
                />
                <div>
                  <p className="eyebrow">👑 이날 최고의 한 판</p>
                  <h3>{nameOf(best.players!)}</h3>
                </div>
                <strong className="award-score">
                  {Math.round(best.perf_score)}
                  <small>점</small>
                </strong>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3">
                <p className="text-sm">
                  {championNames[best.champion_name] ?? best.champion_name} ·{' '}
                  {best.kills}/{best.deaths}/{best.assists}
                </p>
                {bestGame && (
                  <Link href={gameHref(bestGame, date)} className="text-link">
                    경기 상세 →
                  </Link>
                )}
              </div>
            </article>
            {trend && (
              <article className="award-card award-trend">
                <div>
                  <p className="eyebrow">🔥 평소보다 잘한 사람</p>
                  <h3>
                    {playerName(trend.carry.puuid)}{' '}
                    <span className="positive text-sm">
                      {trend.carry.diff >= 0 ? '+' : ''}
                      {trend.carry.diff.toFixed(1)}점
                    </span>
                  </h3>
                </div>
                <div className="mt-3">
                  <p className="eyebrow">🧊 이날의 걸배이</p>
                  <p className="font-bold">
                    {playerName(trend.anchor.puuid)}{' '}
                    <span className="muted text-sm">
                      {trend.anchor.diff >= 0 ? '+' : ''}
                      {trend.anchor.diff.toFixed(1)}점
                    </span>
                  </p>
                </div>
              </article>
            )}
          </div>
          <div className="award-controls">
            <button
              className="award-replay"
              onClick={() => {
                if (sound) primeAwardAudio()
                setCelebration({ mode: 'manual', mvp: true, anchor: true })
              }}
            >
              <span className="replay-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.7c0-1 1.1-1.6 2-1.1l10 6.3a1.3 1.3 0 0 1 0 2.2l-10 6.3c-.9.5-2-.1-2-1.1Z" />
                </svg>
              </span>
              <span>시상식 다시 보기</span>
              <svg
                className="replay-arrow"
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="award-settings">
            <label className="auto-celebration-setting">
              <span>새 수상자 자동 연출</span>
              <input
                className="app-switch"
                type="checkbox"
                checked={auto}
                onChange={toggleAuto}
              />
            </label>
            <label className="auto-celebration-setting">
              <span>시상식 효과음</span>
              <input
                className="app-switch"
                type="checkbox"
                checked={sound}
                onChange={toggleSound}
              />
            </label>
            <ScoreHelp />
          </div>
        </section>
      )}
      <section id="matches" className="space-y-3">
        <div className="section-heading">
          <h2>
            <span className="section-index" aria-hidden="true">
              01
            </span>
            경기 기록
          </h2>
          <span className="pill">{filtered.length}경기 · 최신순</span>
        </div>
        {!filtered.length ? (
          <div className="surface empty-state">
            <p>이날은 나락 휴무.</p>
            <button
              className="text-link mt-3"
              onClick={() => setDate(latestDate)}
            >
              최근 경기 보러 가기 →
            </button>
          </div>
        ) : (
          <div className="match-list">
            {filtered.map((game) => (
              <MatchCard
                key={game.id}
                game={game}
                date={date}
                open={openId === game.id}
                toggle={() => toggleGame(game.id)}
                names={championNames}
                roles={champRoles}
              />
            ))}
          </div>
        )}
      </section>
      {(moments.length > 0 || augment) && (
        <section id="highlights" className="space-y-3">
          <div className="section-heading">
            <h2>
              <span className="section-index" aria-hidden="true">
                02
              </span>
              매치 하이라이트
            </h2>
            <span className="muted text-xs">최고 기록 · 기여도 상승</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {moments.slice(0, 4).map((moment) => {
              const isBounce = moment.label === '반등 성공'
              const isAssist = moment.label.includes('어시')
              const unit = isAssist ? '개' : '점'
              const previous = Math.round(moment.previous)
              const current = Math.round(moment.value)
              return (
                <article className="surface moment-card" key={moment.id}>
                  <p className="eyebrow">
                    {isBounce ? '🔥 기여도 상승' : `✨ ${moment.label}`}
                  </p>
                  <h3>{getPlayerDisplayName(moment.puuid, moment.name)}</h3>
                  <dl className="moment-comparison">
                    <div>
                      <dt>{isBounce ? '직전 경기' : '이전 최고 기록'}</dt>
                      <dd>
                        {previous}
                        <span>{unit}</span>
                      </dd>
                    </div>
                    <div className="moment-current">
                      <dt>{isBounce ? '이번 경기' : '새 최고 기록'}</dt>
                      <dd>
                        {current}
                        <span>{unit}</span>
                      </dd>
                    </div>
                  </dl>
                  <p className="moment-change">
                    <span>
                      {isBounce ? '직전 경기 대비' : '이전 최고 대비'}
                    </span>
                    <strong>
                      +{current - previous}
                      {unit}
                    </strong>
                  </p>
                  <div className="moment-actions">
                    <Link
                      className="button-secondary"
                      href={gameHref(moment.game, date)}
                    >
                      경기 상세 ↗
                    </Link>
                    <Link
                      className="button-secondary"
                      href={gameHref(moment.previousGame, date)}
                    >
                      {isBounce ? '직전 경기 보기' : '이전 기록 보기'}
                    </Link>
                  </div>
                  <p className="moment-note muted">
                    이전 3경기 이상 기록이 있는 선수 기준
                  </p>
                </article>
              )
            })}
            {augment && (
              <article className="surface moment-card augment-highlight">
                <p className="eyebrow">✦ 증강 하이라이트</p>
                <h3>{getAugmentName(augment.id)}</h3>
                <p className="muted text-sm mt-2">
                  선수별 선택 {augment.games}회 · {augment.wins}승{' '}
                  {augment.games - augment.wins}패
                </p>
                <p className="muted text-xs mt-2">
                  사용 선수별 집계 · 승리 기록이 많이 쌓인 증강
                </p>
              </article>
            )}
          </div>
        </section>
      )}
      <section id="players" className="space-y-3">
        <div className="section-heading">
          <h2>
            <span className="section-index" aria-hidden="true">
              03
            </span>
            개인 기록
          </h2>
          <span className="muted text-xs">플레이어별 전적 · 챔피언 분석</span>
        </div>
        <div className="player-grid">
          {players.map((player) => {
            const rows = allGames.flatMap((g) =>
              g.game_results.filter((r) => r.players?.puuid === player.puuid),
            )
            const average =
              rows.reduce((sum, r) => sum + r.perf_score, 0) /
              (rows.length || 1)
            const recent = rows.slice(0, 10)
            const diff =
              recent.reduce((sum, r) => sum + r.perf_score, 0) /
                (recent.length || 1) -
              average
            const champions = new Map<string, number>()
            rows.forEach((r) =>
              champions.set(
                r.champion_name,
                (champions.get(r.champion_name) ?? 0) + 1,
              ),
            )
            const most = [...champions].sort((a, b) => b[1] - a[1])[0]
            return (
              <Link
                className="surface profile-card"
                key={player.puuid}
                href={`/players/${encodeURIComponent(player.puuid)}?date=${date}`}
              >
                <div className="flex items-center gap-2">
                  <PlayerAvatar
                    puuid={player.puuid}
                    name={nameOf(player)}
                    size={36}
                  />
                  <h3>{nameOf(player)}</h3>
                  <span className="ml-auto muted" aria-hidden="true">
                    ↗
                  </span>
                </div>
                <p className="profile-score">
                  {Math.round(average)}
                  <small>평균 기여도</small>
                </p>
                <p className={`text-xs ${diff >= 0 ? 'positive' : 'muted'}`}>
                  최근 {recent.length}판 · 평소보다 {diff >= 0 ? '+' : ''}
                  {diff.toFixed(1)}점
                </p>
                {most && (
                  <div className="profile-champion">
                    <ChampionAvatar
                      name={most[0]}
                      label={championNames[most[0]]}
                      size={24}
                    />
                    <span>
                      {championNames[most[0]] ?? most[0]}{' '}
                      <small>{most[1]}판</small>
                    </span>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      </section>
      <RecordRoom
        games={allGames}
        date={date}
        players={players}
        nicknames={initialNicknames}
        names={championNames}
        roles={champRoles}
      />
    </div>
  )
}
