interface StoredMatch {
  match_id: string
  game_results: { players: { puuid: string } | { puuid: string }[] | null }[]
}

/** A timestamp or a partial result is never proof that a match is complete. */
export function completeMatchIds(
  matches: StoredMatch[],
  tracked: string[],
): string[] {
  return matches
    .filter((match) => {
      const players = new Set(
        match.game_results.flatMap((result) =>
          (Array.isArray(result.players)
            ? result.players
            : [result.players]
          ).map((player) => player?.puuid),
        ),
      )
      return tracked.length > 0 && tracked.every((puuid) => players.has(puuid))
    })
    .map((match) => match.match_id)
}

export function matchRevision(matchId: string, resultIds: string[]): string {
  return `${matchId}:${[...resultIds].sort().join(',')}`
}
