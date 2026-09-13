import { createServerClient } from '@/lib/supabase'
import { matchRevision } from '@/lib/syncStatus'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('games')
      .select('played_at, match_id, game_results(id)')
      .order('played_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error

    return Response.json(
      {
        last_played_at: data?.played_at ?? null,
        last_match_id: data?.match_id ?? null,
        revision:
          data && data.game_results.length >= 4
            ? matchRevision(
                data.match_id,
                data.game_results.map((result) => result.id),
              )
            : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return Response.json(
      { error: 'Could not read sync status' },
      { status: 503 },
    )
  }
}
