'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Only fetch the small revision marker; reload game data when it changes. */
export default function GamesAutoRefresh({
  revision,
}: {
  revision: string | null
}) {
  const router = useRouter()
  useEffect(() => {
    let request: AbortController | null = null
    let disposed = false
    let lastCheck = 0
    async function check() {
      if (
        disposed ||
        document.hidden ||
        document.querySelector('dialog[open]') ||
        request ||
        Date.now() - lastCheck < 2000
      )
        return
      lastCheck = Date.now()
      request = new AbortController()
      const timeout = window.setTimeout(() => request?.abort(), 8000)
      try {
        const response = await fetch('/api/last-sync', {
          cache: 'no-store',
          signal: request.signal,
        })
        if (!response.ok) return
        const data = await response.json()
        if (
          !disposed &&
          typeof data.revision === 'string' &&
          data.revision !== revision
        )
          router.refresh()
      } catch {
        /* Retry on the next tick; never interrupt browsing. */
      } finally {
        window.clearTimeout(timeout)
        request = null
      }
    }
    void check()
    const timer = window.setInterval(check, 15000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      disposed = true
      request?.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [revision, router])
  return null
}
