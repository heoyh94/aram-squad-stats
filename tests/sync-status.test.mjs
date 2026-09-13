import assert from 'node:assert/strict'
import test from 'node:test'
import {completeMatchIds,matchRevision} from '../src/lib/syncStatus.ts'

test('only matches containing every tracked player can skip collection',()=>{
  const match=(id,players)=>({match_id:id,game_results:players.map(puuid=>({players:puuid ? {puuid}:null}))})
  const rows=[match('full',['a','b','c','d']),match('empty',[]),match('partial',['a','b','c']),match('duplicate',['a','a','b','c']),match('unknown',['a','b','c','x']),match('null',[null])]
  assert.deepEqual(completeMatchIds(rows,['a','b','c','d']),['full'])
  assert.deepEqual(completeMatchIds(rows,[]),[])
})
test('revision ignores join order but detects a new match or repaired results',()=>{
  assert.equal(matchRevision('g',['b','a']),matchRevision('g',['a','b']))
  assert.notEqual(matchRevision('g',['a']),matchRevision('g',['a','b']))
  assert.notEqual(matchRevision('g',['a']),matchRevision('h',['a']))
})
