import SyncButton from '@/components/SyncButton'
import GamesAutoRefresh from '@/components/GamesAutoRefresh'
import { matchRevision } from '@/lib/syncStatus'
import { Suspense } from 'react'
import DashboardClient from '@/components/DashboardClient'
import {
  fetchChampionCatalog,
  toChampionNameMap,
  toChampionRoleLabels,
} from '@/lib/championNames'
import { fetchGames, fetchPlayers, getCachedNicknames } from '@/lib/games'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // 이름과 역할 라벨은 같은 카탈로그에서 나온다. 한 번만 받는다.
  const [allGames, players, championCatalog, initialNicknames] =
    await Promise.all([
      fetchGames(),
      fetchPlayers(),
      fetchChampionCatalog(),
      getCachedNicknames(),
    ])
  const championNames = toChampionNameMap(championCatalog)
  const champRoles = toChampionRoleLabels(championCatalog)

  return (
    <div>
      <GamesAutoRefresh
        revision={
          allGames[0]
            ? matchRevision(
                allGames[0].match_id,
                allGames[0].game_results.map((result) => result.id),
              )
            : null
        }
      />
      <div className="site-intro">
        <div className="intro-copy">
          <h1>칼바람 매치 리포트</h1>
          <p>경기 결과와 개인 기록을 한눈에.</p>
        </div>
        <SyncButton />
      </div>
      <Suspense
        fallback={<p className="empty-state">경기 기록을 불러오는 중…</p>}
      >
        <DashboardClient
          allGames={allGames}
          players={players}
          initialNicknames={initialNicknames}
          champRoles={champRoles}
          championNames={championNames}
        />
      </Suspense>
    </div>
  )
}
