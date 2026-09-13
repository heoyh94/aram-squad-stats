import assert from 'node:assert/strict'
import test from 'node:test'
import { changedAwards, awardSoundPlan, AWARD_VISIBLE_MS } from '../src/lib/awardAudio.ts'

test('award updates isolate MVP and anchor, including first visit and a new day', () => {
  const key = '2026-09-13:mvp-a:anchor-a'
  assert.deepEqual(changedAwards(null,key),{mvp:true,anchor:true})
  assert.deepEqual(changedAwards(key,key),{mvp:false,anchor:false})
  assert.deepEqual(changedAwards(key,'2026-09-13:mvp-b:anchor-a'),{mvp:true,anchor:false})
  assert.deepEqual(changedAwards(key,'2026-09-13:mvp-a:anchor-b'),{mvp:false,anchor:true})
  assert.deepEqual(changedAwards(key,'2026-09-14:mvp-a:anchor-a'),{mvp:true,anchor:true})
  assert.deepEqual(changedAwards(key,'2026-09-13:mvp-a:'),{mvp:false,anchor:false})
})

test('solo effects are distinct and all sounds end inside the popup lifetime', () => {
  const mvp = awardSoundPlan({mvp:true,anchor:false})
  const anchor = awardSoundPlan({mvp:false,anchor:true})
  assert.ok(mvp[0].frequency < mvp[2].frequency)
  assert.ok(anchor[0].frequency > anchor[2].frequency)
  for (const flags of [{mvp:true,anchor:false},{mvp:false,anchor:true},{mvp:true,anchor:true}]) {
    for (const duration of [AWARD_VISIBLE_MS, 500]) {
      const plan = awardSoundPlan(flags,duration)
      assert.ok(plan.length > 0)
      assert.ok(plan.every(tone=>tone.start >= 0 && tone.duration > .024))
      assert.ok(Math.max(...plan.map(t=>t.start+t.duration)) < duration/1000)
    }
  }
})

test('combined award cues play in sequence and late or empty cues stay silent', () => {
  const plan=awardSoundPlan({mvp:true,anchor:true})
  const first=plan.filter(t=>t.type==='triangle')
  const second=plan.filter(t=>t.type==='sine')
  assert.ok(Math.max(...first.map(t=>t.start+t.duration)) < Math.min(...second.map(t=>t.start)))
  assert.deepEqual(awardSoundPlan({mvp:false,anchor:false}),[])
  assert.deepEqual(awardSoundPlan({mvp:true,anchor:true},200),[])
})
