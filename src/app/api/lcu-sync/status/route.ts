import { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { TRACKED_PLAYERS } from '@/lib/config'
import { completeMatchIds } from '@/lib/syncStatus'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const secret = process.env.LCU_SYNC_SECRET
    if (!secret || body.secret !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (
      !Array.isArray(body.match_ids) ||
      body.match_ids.length > 20 ||
      !body.match_ids.every(
        (id: unknown) => typeof id === 'string' && /^OC1_\d+$/.test(id),
      )
    ) {
      return Response.json(
        { error: 'Expected up to 20 match IDs' },
        { status: 400 },
      )
    }
    if (!body.match_ids.length) return Response.json({ complete_match_ids: [] })
    const { data, error } = await createServerClient()
      .from('games')
      .select('match_id, game_results(players(puuid))')
      .in('match_id', body.match_ids)
    if (error) throw error
    return Response.json({
      complete_match_ids: completeMatchIds(
        data ?? [],
        TRACKED_PLAYERS.map((p) => p.puuid),
      ),
    })
  } catch {
    return Response.json(
      { error: 'Could not check saved matches' },
      { status: 500 },
    )
  }
}
