import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createServerClient } from '@/lib/supabase'
import { TRACKED_PLAYERS, DATA_START_DATE, SUPPORTED_QUEUES } from '@/lib/config'
import { calcTeamPerfScores } from '@/lib/riot'
import type { RiotParticipant } from '@/lib/riot'
import { resolveTrackedParticipants } from '@/lib/lcuSyncMapping'
import { GAMES_CACHE_TAG } from '@/lib/games'
import { fetchChampionRoles, fetchChampionIdToName } from '@/lib/championRoles'

// ─── Types (LCU normalized payload) ──────────────────────────────────────────

interface LcuParticipant {
  puuid: string
  gameName?: string
  championId: number
  championName: string   // agent가 DDragon으로 변환해서 보냄, 없으면 ""
  teamId: number
  win: boolean
  kills: number
  deaths: number
  assists: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  totalHeal: number
  /**
   * 팀원에게 준 힐만 (자힐 제외). 에이전트가 보내 주면 점수는 이 값을 쓴다.
   * 옛 에이전트는 안 보내므로 optional 이고, 없으면 totalHeal 로 폴백한다.
   */
  totalHealsOnTeammates?: number
  /** 팀원에게 준 실드. 힐과 더해 보호 축이 된다. */
  totalShieldsOnTeammates?: number
  /** 방어로 막아낸 피해. 받은 피해와 섞어 탱킹 축이 된다. */
  damageSelfMitigated?: number
  /** 적을 묶은 횟수. CC 지속시간과 섞는다. */
  hardCcCount?: number
  goldEarned: number
  totalTimeCCDealt: number
  augments: number[]     // augment IDs (없으면 [])
}

interface LcuGame {
  gameId: string         // "OC1_709110934" 형식
  queueId: number        // 2400
  gameCreation: number   // unix ms
  gameDuration: number   // seconds
  participants: LcuParticipant[]
}

interface LcuSyncPayload {
  secret: string
  games: LcuGame[]
  stop_on_error?: boolean
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as LcuSyncPayload

    // 인증
    const secret = process.env.LCU_SYNC_SECRET ?? ''
    if (!secret || body.secret !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServerClient()
    // 이름 카탈로그는 최신 DDragon 을 본다. 고정 버전으로 조회하면 신규
    // 챔피언이 `Champion800` 으로 저장되고 나중에 복구 작업이 필요해진다.
    const [champNames, championRoles] = await Promise.all([
      fetchChampionIdToName(),
      fetchChampionRoles(),
    ])

    // players upsert (없을 경우 대비) 후 실제 DB ID 를 읽어 결과 저장에 쓴다.
    await supabase.from('players').upsert(
      TRACKED_PLAYERS.map((p) => ({ puuid: p.puuid, game_name: p.gameName, tag_line: p.tagLine })),
      { onConflict: 'puuid' },
    )

    const { data: playerRows } = await supabase
      .from('players')
      .select('id, puuid')
      .in('puuid', TRACKED_PLAYERS.map((p) => p.puuid))

    const playerIdMap = new Map<string, string>()
    for (const row of playerRows ?? []) playerIdMap.set(row.puuid, row.id)
    if (playerIdMap.size !== TRACKED_PLAYERS.length) {
      return Response.json({ synced: 0, skipped: body.games.length, errors: ['4명 플레이어 ID를 모두 확인하지 못했습니다.'] })
    }

    // 이미 저장된 match_id 목록
    const incomingIds = body.games.map((g) => g.gameId)
    const { data: existing } = await supabase
      .from('games')
      .select('id, match_id')
      .in('match_id', incomingIds)
    const existingByMatchId = new Map((existing ?? []).map((g) => [g.match_id, g.id]))

    const TRACKED_PUUID_SET = new Set(TRACKED_PLAYERS.map((p) => p.puuid))
    // gameName → Riot PUUID 매핑 (LCU puuid는 다른 포맷이라 gameName으로 조회)
    const gameNameToPuuid = new Map(TRACKED_PLAYERS.map((p) => [p.gameName, p.puuid]))

    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for (const game of body.games) {
      // 시간 기준으로 수집하는 에이전트는 실패한 경기보다 이후로 저장 기준이
      // 전진하면 안 된다. 오래된 경기부터 보내고 첫 실패에서 멈춘다.
      if (body.stop_on_error && errors.length > 0) break
      // Riot 경로와 같은 기준으로 거른다. 시크릿을 아는 클라이언트가 아무 큐,
      // 아무 시점의 경기나 밀어 넣지 못하도록 서버에서도 확인한다.
      if (!SUPPORTED_QUEUES.includes(game.queueId)) { skipped++; continue }
      if (new Date(game.gameCreation) < DATA_START_DATE) { skipped++; continue }

      // 4명 모두 서로 다른 고정 Riot PUUID로 확인
      const tracked = resolveTrackedParticipants(game.participants, TRACKED_PLAYERS)
      if (!tracked) { skipped++; continue }

      // LCU puuid → Riot puuid 변환 (gameName 경유)
      const participants = game.participants.map((p) => ({
        ...p,
        puuid: gameNameToPuuid.get(p.gameName ?? '') ?? p.puuid,
        championName: p.championName || champNames[p.championId] || `Champion${p.championId}`,
      }))

      // 변환된 tracked participants (Riot PUUID 기준)
      const trackedParticipants = participants.filter((p) => TRACKED_PUUID_SET.has(p.puuid))

      // 우리 팀 판별 (Riot PUUID로 변환된 participants 기준)
      const teamCounts = new Map<number, number>()
      for (const p of trackedParticipants) teamCounts.set(p.teamId, (teamCounts.get(p.teamId) ?? 0) + 1)
      const ourTeamId = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const ourTeamWin = trackedParticipants.find((p) => p.teamId === ourTeamId)?.win ?? false

      // 4명 결과가 모두 있으면 건너뛰고, 일부만 저장됐으면 누락 선수만 복구한다.
      const existingGameId = existingByMatchId.get(game.gameId)
      let savedPlayerIds = new Set<string>()
      let gameId: string
      if (existingGameId) {
        const { data: savedResults, error: countError } = await supabase
          .from('game_results')
          .select('player_id')
          .eq('game_id', existingGameId)
        if (countError) { errors.push(`${game.gameId}: ${countError.message}`); continue }
        savedPlayerIds = new Set((savedResults ?? []).map(row => row.player_id))
        if ([...playerIdMap.values()].every(id => savedPlayerIds.has(id))) { skipped++; continue }
        gameId = existingGameId
      } else {
        const { data: insertedGame, error: gameErr } = await supabase
          .from('games')
          .insert({
            match_id: game.gameId,
            played_at: new Date(game.gameCreation).toISOString(),
            duration_seconds: game.gameDuration,
            our_team_win: ourTeamWin,
            our_team_id: ourTeamId,
          })
          .select('id')
          .single()
        if (gameErr || !insertedGame) {
          errors.push(`${game.gameId}: ${gameErr?.message ?? '게임 저장 실패'}`)
          continue
        }
        gameId = insertedGame.id
      }

      // 점수 계산 (경기 전체를 한 번만 계산해서 4명분을 뽑는다)
      const riotParts: RiotParticipant[] = trackedParticipants.map((p) => ({
        puuid: p.puuid,
        championId: p.championId,
        championName: p.championName,
        teamId: p.teamId,
        win: p.win,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        totalDamageDealtToChampions: p.totalDamageDealtToChampions,
        totalDamageTaken: p.totalDamageTaken,
        totalHeal: p.totalHeal,
        totalHealsOnTeammates: p.totalHealsOnTeammates,
        totalShieldsOnTeammates: p.totalShieldsOnTeammates,
        damageSelfMitigated: p.damageSelfMitigated,
        hardCcCount: p.hardCcCount,
        totalTimeCCDealt: p.totalTimeCCDealt,
        goldEarned: p.goldEarned,
      }))
      const gameScores = calcTeamPerfScores(riotParts, {
        durationSeconds: game.gameDuration,
        roles: championRoles,
      })

      // 4인 결과를 한 번의 insert 로 보낸다.
      const resultRows = trackedParticipants
        .map((p) => {
          const playerId = playerIdMap.get(p.puuid)
          if (!playerId) {
            errors.push(`${game.gameId}: ${p.puuid} 플레이어 ID 누락`)
            return null
          }
          return {
            game_id: gameId,
            player_id: playerId,
            champion_id: p.championId,
            champion_name: p.championName,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            damage_dealt: p.totalDamageDealtToChampions,
            damage_taken: p.totalDamageTaken,
            healing: p.totalHeal,
            heals_on_teammates: p.totalHealsOnTeammates ?? null,
            shields_on_teammates: p.totalShieldsOnTeammates ?? null,
            damage_self_mitigated: p.damageSelfMitigated ?? null,
            hard_cc_count: p.hardCcCount ?? null,
            gold_earned: p.goldEarned,
            cc_score: p.totalTimeCCDealt,
            augment_ids: p.augments ?? [],
            perf_score: Math.round((gameScores.get(p.puuid) ?? 0) * 10) / 10,
          }
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)

      if (resultRows.length !== tracked.length) {
        if (!existingGameId) await supabase.from('games').delete().eq('id', gameId)
        errors.push(`${game.gameId}: 4명 결과 구성 불완전 (${resultRows.length}/${tracked.length})`)
        continue
      }

      const { error: resultsError } = await supabase.from('game_results').insert(
        resultRows.filter(row => !savedPlayerIds.has(row.player_id)),
      )
      if (resultsError) {
        // 결과 없는 게임 행을 남기면 다음 동기화가 "이미 저장됨"으로 건너뛴다.
        if (!existingGameId) await supabase.from('games').delete().eq('id', gameId)
        errors.push(`${game.gameId}: ${resultsError.message}`)
        continue
      }

      synced++
    }

    if (synced > 0) revalidateTag(GAMES_CACHE_TAG, { expire: 0 })

    return Response.json({ synced, skipped, errors })
  } catch (err) {
    console.error('LCU sync error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
