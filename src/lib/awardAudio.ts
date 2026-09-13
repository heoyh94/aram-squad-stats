export const AWARD_VISIBLE_MS = 2000

export interface AwardChanges {
  mvp: boolean
  anchor: boolean
}

/** Keep the existing shown-awards key so previously seen awards stay seen. */
export function changedAwards(
  previous: string | null,
  current: string,
): AwardChanges {
  const [day, mvp, anchor] = current.split(':')
  const [oldDay, oldMvp, oldAnchor] = (previous ?? '').split(':')
  return {
    mvp: Boolean(mvp) && (day !== oldDay || mvp !== oldMvp),
    anchor: Boolean(anchor) && (day !== oldDay || anchor !== oldAnchor),
  }
}

interface Tone {
  start: number
  duration: number
  frequency: number
  endFrequency: number
  volume: number
  type: OscillatorType
}

/** Original synthesized cues. Combined awards share the same two-second window. */
export function awardSoundPlan(
  awards: AwardChanges,
  durationMs = AWARD_VISIBLE_MS,
): Tone[] {
  const cues = [awards.mvp && 'mvp', awards.anchor && 'anchor'].filter(Boolean)
  if (!cues.length || durationMs <= 300) return []
  const slot = (durationMs - 100) / 1000 / cues.length
  return cues.flatMap((cue, index) => {
    const notes =
      cue === 'mvp'
        ? [
            [0, 0.15, 392, 392, 0.4],
            [0.16, 0.15, 494, 494, 0.4],
            [0.32, 0.17, 587, 587, 0.4],
            [0.52, 0.42, 784, 784, 0.32],
            [0.52, 0.42, 494, 494, 0.17],
            [0.52, 0.42, 587, 587, 0.17],
          ]
        : [
            [0, 0.21, 392, 349, 0.36],
            [0.25, 0.21, 330, 294, 0.36],
            [0.5, 0.44, 262, 175, 0.4],
            [0.52, 0.4, 131, 87, 0.15],
          ]
    return notes.map(([start, duration, frequency, endFrequency, volume]) => ({
      start: index * slot + start * slot,
      duration: duration * slot,
      frequency,
      endFrequency,
      volume,
      type: cue === 'mvp' ? ('triangle' as const) : ('sine' as const),
    }))
  })
}

let context: AudioContext | undefined
let activeStop: (() => void) | undefined

/** Call from a real click/key event; never bypass the browser's autoplay policy. */
export function primeAwardAudio() {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume().catch(() => {})
  } catch {
    // Audio is optional, including on devices without Web Audio support.
  }
}

export function playAwardAudio(
  awards: AwardChanges,
  durationMs = AWARD_VISIBLE_MS,
): () => void {
  activeStop?.()
  const ctx = context
  if (!ctx || ctx.state !== 'running' || document.hidden) return () => {}
  const plan = awardSoundPlan(awards, durationMs)
  if (!plan.length) return () => {}
  const master = ctx.createGain()
  master.gain.value = 0.22
  master.connect(ctx.destination)
  const nodes: OscillatorNode[] = []
  let pending = plan.length
  let stopped = false
  const start = ctx.currentTime + 0.015
  for (const tone of plan) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const at = start + tone.start
    const end = at + tone.duration
    oscillator.type = tone.type
    oscillator.frequency.setValueAtTime(tone.frequency, at)
    oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(tone.volume, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.001, end - 0.01)
    gain.gain.linearRampToValueAtTime(0, end)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      if (--pending === 0) master.disconnect()
    }
    oscillator.start(at)
    oscillator.stop(end)
    nodes.push(oscillator)
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.008)
    nodes.forEach((node) => {
      try {
        node.stop(ctx.currentTime + 0.012)
      } catch {}
    })
    if (activeStop === stop) activeStop = undefined
  }
  activeStop = stop
  return stop
}
