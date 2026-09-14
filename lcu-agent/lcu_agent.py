"""
ARAM Squad Stats - LCU Agent (Windows)
롤 클라이언트에서 ARAM Mayhem(queueId 2400) 전적을 읽어 서버로 전송합니다.

사용법:
  python lcu_agent.py          # 마지막 서버 저장 경기 이후 미저장 경기 전송
  python lcu_agent.py --full   # 클라이언트가 제공하는 이전 기록도 재검사
  python lcu_agent.py --debug  # 진단 모드 (API 응답 raw 출력, 서버 전송 안 함)

필요:
  python -m pip install -r requirements.txt   (실행.bat / run.bat 이 자동으로 처리)
"""

import sys
import os
import re
import json
import base64
import argparse
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import psutil
    import requests
except ImportError as exc:
    print(f"[오류] 필요한 패키지가 없습니다: {exc.name}")
    print("  다음 명령으로 설치하세요:")
    print("    python -m pip install -r requirements.txt")
    print("  또는 실행.bat / run.bat 으로 실행하면 자동으로 설치됩니다.")
    sys.exit(1)

# ─── 설정 ────────────────────────────────────────────────────────────────────

SERVER_URL      = "https://aram4.vercel.app/api/lcu-sync"
STATUS_URL      = "https://aram4.vercel.app/api/lcu-sync/status"
LAST_SYNC_URL   = "https://aram4.vercel.app/api/last-sync"
LCU_SECRET  = os.environ.get("LCU_SYNC_SECRET", "")  # 환경변수 or 직접 입력
QUEUE_ID    = 2400   # ARAM Mayhem

# 최근 N경기로 자르지 않고 서버 저장 기준까지 페이지를 넘긴다.
# --full 은 저장 기준보다 오래된, 클라이언트가 제공하는 기록도 확인한다.
HISTORY_PAGE_SIZE = 20
HISTORY_MAX_PAGES = 25  # 안전 상한에 닿으면 완료로 보고하지 않는다.
RESULT_WAIT_SECONDS = 20

# gameName → (LCU puuid, Riot puuid)
TRACKED_PLAYERS = {
    "Hoodville":     ("ea1d50c7-d4dd-56fd-be40-c663777c8af2", "fMM-QQxR_KvThTZ-4xaqn_XzyPLrzBKx8qL-6lyw1OfyabCpv8NWGYMt_v836xmLJRhO1mO55RXilg"),
    "Interest Rate": ("322c77e2-d392-53d2-bef9-4179b94f99f6", "XqEwGu2HFUiWqO8AOrAPfCfKxSl1BzSLcFxV0HFfVan_YvQvfEdbfnXrVkfErFHtq27-la-U9e_ZgA"),
    "Nunu and Lulu": ("698e63c8-3061-5e08-833f-04c661202c8d", "Mx8gYVhZwzugCoBFQyoCfjESRpjTF6ZJN-8uTF1hqHwc9s9ke5rGTKnWFvfYGa6z8tAWnIxMdytYPg"),
    "just won lotto":("348d1a1c-9935-5b19-8d7f-60284f8c8511", "ScCA2JAvEUDKOL83IF0jnELmmCoPIWfi6qhZ6h-sTR7V18ZFgt8y4XhHHny3j5MXdowQlgPcsLjy2Q"),
}
TRACKED_NAMES    = set(TRACKED_PLAYERS.keys())
LCU_TO_RIOT_PUUID = {v[0]: v[1] for v in TRACKED_PLAYERS.values()}
LCU_PUUID_SET    = set(LCU_TO_RIOT_PUUID.keys())

# ─── lockfile 읽기 ────────────────────────────────────────────────────────────

def find_lockfile():  # -> Optional[Path]
    """실행 중인 LeagueClient 프로세스에서 lockfile 경로를 찾습니다."""
    for proc in psutil.process_iter(['name', 'cmdline', 'cwd']):
        try:
            if proc.info['name'] and 'LeagueClient' in proc.info['name']:
                cwd = proc.info.get('cwd') or ''
                # cmdline에서 --app-dir 파싱
                cmdline = proc.info.get('cmdline') or []
                for arg in cmdline:
                    m = re.search(r'--app-dir=(.+?)(?:\s|$|")', arg)
                    if m:
                        return Path(m.group(1).strip('"')) / 'lockfile'
                if cwd:
                    lf = Path(cwd) / 'lockfile'
                    if lf.exists():
                        return lf
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # fallback: 일반적인 경로 탐색 (LeagueClient 우선, RiotClient 제외)
    common_paths = [
        Path("C:/Riot Games/League of Legends/lockfile"),
        Path("C:/Program Files/Riot Games/League of Legends/lockfile"),
        Path("C:/Program Files (x86)/Riot Games/League of Legends/lockfile"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Riot Games/League of Legends/lockfile",
    ]
    for p in common_paths:
        if p.exists():
            return p
    return None


def parse_lockfile(path: Path) -> dict:
    """lockfile 파싱 → {name, pid, port, password, protocol}"""
    content = path.read_text(encoding='utf-8').strip()
    parts = content.split(':')
    return {
        'name':     parts[0],
        'pid':      parts[1],
        'port':     parts[2],
        'password': parts[3],
        'protocol': parts[4],
    }


def lcu_session(port: str, password: str) -> requests.Session:
    """LCU 전용 requests 세션 (SSL 무시, Basic 인증)"""
    s = requests.Session()
    s.trust_env = False  # localhost LCU must not go through a system proxy
    s.verify = False
    token = base64.b64encode(f"riot:{password}".encode()).decode()
    s.headers.update({
        'Authorization': f'Basic {token}',
        'Accept': 'application/json',
    })
    s.__dict__['base_url'] = f"https://127.0.0.1:{port}"
    return s


def lcu_get(session: requests.Session, path: str, timeout=30):
    url = session.__dict__['base_url'] + path
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()

# ─── 데이터 수집 ──────────────────────────────────────────────────────────────

def get_current_account(session: requests.Session):
    """현재 로그인 계정의 (lcu_puuid, gameName) 반환"""
    endpoints = [
        '/lol-summoner/v1/current-summoner',
        '/lol-login/v1/session',
        '/lol-chat/v1/me',
        '/lol-lobby/v2/lobby',
    ]
    for ep in endpoints:
        try:
            data = lcu_get(session, ep)
            if isinstance(data, dict):
                puuid = data.get('puuid', '')
                name = data.get('gameName', data.get('displayName', data.get('name', '')))
                if puuid and name:
                    print(f"  ✓ endpoint: {ep}")
                    return puuid, name
                elif puuid:
                    print(f"  - {ep} → puuid있음, gameName없음. keys: {list(data.keys())[:10]}")
                else:
                    print(f"  - {ep} → 응답있음, puuid없음. keys: {list(data.keys())[:10]}")
        except Exception as e:
            print(f"  - {ep} → {e}")
    raise RuntimeError("계정 정보를 가져올 수 없습니다")


def get_match_history(session: requests.Session, puuid: str, count: int = HISTORY_PAGE_SIZE, begin: int = 0, timeout=30) -> list:
    """매치 히스토리 - gameId 목록 반환"""
    endpoints = [
        f'/lol-match-history/v1/products/lol/current-summoner/matches?begIndex={begin}&endIndex={begin + count - 1}',
        f'/lol-match-history/v1/products/lol/{puuid}/matches?begIndex={begin}&endIndex={begin + count - 1}',
        f'/lol-match-history/v3/matchlist/account/{puuid}?begIndex={begin}&endIndex={begin + count - 1}',
    ]
    for ep in endpoints:
        try:
            data = lcu_get(session, ep, timeout=timeout)
            if isinstance(data, dict):
                games = data.get('games', [])
                if isinstance(games, dict):
                    games = games.get('games', [])
                if isinstance(games, list):
                    return games[:count]
            if isinstance(data, list):
                return data[:count]
        except Exception as e:
            print(f"  endpoint {ep} 실패: {e}")
    raise RuntimeError('클라이언트 전적 조회 실패. 미저장 경기 확인을 완료하지 못했습니다.')


def get_sync_checkpoint(session: requests.Session):
    response = session.get(LAST_SYNC_URL, timeout=(5, 10), headers={'Cache-Control': 'no-cache'})
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or 'last_played_at' not in data:
        raise ValueError('마지막 저장 경기 응답 형식 오류')
    if not data.get('last_played_at') or not data.get('revision'):
        return None  # 빈 DB 또는 최신 경기의 부분 저장: 시각으로 건너뛰지 않는다.
    created = datetime.fromisoformat(data['last_played_at'].replace('Z', '+00:00'))
    return {'gameId': data['last_match_id'], 'creation': int(created.timestamp() * 1000)}


def collect_since_checkpoint(session, puuid, checkpoint, full=False):
    """페이지를 넘겨 저장 기준까지 확인. 같은 페이지 반복을 완료로 오인하지 않는다."""
    found = {}
    reached = checkpoint is None
    for index in range(HISTORY_MAX_PAGES):
        page = get_match_history(session, puuid, HISTORY_PAGE_SIZE, index * HISTORY_PAGE_SIZE)
        fresh = [g for g in page if g.get('gameId') not in found]
        if not fresh:
            return list(found.values()), reached
        found.update({g['gameId']: g for g in fresh})
        if checkpoint and any(
            f'OC1_{g["gameId"]}' == checkpoint['gameId'] or
            0 < int(g.get('gameCreation', 0)) <= checkpoint['creation'] for g in fresh
        ):
            reached = True
            if not full:
                break
        if len(page) < HISTORY_PAGE_SIZE:
            break
    else:
        return list(found.values()), False
    return sorted(found.values(), key=lambda g: int(g.get('gameCreation', 0)), reverse=True), reached


def after_checkpoint(games, checkpoint, full=False):
    if not checkpoint or full:
        return games
    # 같은 시각의 경기와 시각이 없는 응답도 ID별 저장 상태를 확인한다.
    return [g for g in games if not g.get('gameCreation') or int(g['gameCreation']) >= checkpoint['creation']]


def wait_for_finished_game(session, puuid, game_id, games):
    """종료 화면의 경기만 짧게 재조회. 진행 중인 경기 데이터는 사용하지 않는다."""
    known = {g['gameId']: g for g in games}
    deadline = time.monotonic() + RESULT_WAIT_SECONDS
    while game_id not in known:
        detail = get_game_detail(session, game_id, timeout=2)
        if (len(detail.get('participants', [])) >= 10 and
                int(detail.get('gameDuration', 0)) > 0 and
                int(detail.get('gameCreation', 0)) > 0 and
                all('win' in p.get('stats', {}) for p in detail['participants'])):
            known[game_id] = detail
            break
        if time.monotonic() >= deadline:
            return list(known.values()), False
        print('  종료 경기 전적 등록 대기 중... (약 20초까지 재시도)', flush=True)
        time.sleep(2)
        known.update({g['gameId']: g for g in get_match_history(session, puuid, timeout=2)})
    return list(known.values()), True


def get_game_detail(session: requests.Session, game_id: int, timeout=30) -> dict:
    """gameId로 전체 참여자 데이터 조회"""
    endpoints = [
        f'/lol-match-history/v1/games/{game_id}',
        f'/lol-match-history/v2/games/{game_id}',
    ]
    for ep in endpoints:
        try:
            data = lcu_get(session, ep, timeout=timeout)
            if isinstance(data, dict) and data.get('participants'):
                return data
        except Exception as e:
            print(f"  game detail {ep} 실패: {e}")
    return {}


def get_completed_match_ids(session: requests.Session, games: list, secret: str) -> set:
    """Only server-confirmed four-player results can skip the expensive detail call."""
    ids = [f'OC1_{game["gameId"]}' for game in games]
    if not ids:
        return set()
    confirmed = set()
    for offset in range(0, len(ids), 20):
        batch = ids[offset:offset + 20]
        response = session.post(STATUS_URL, json={'secret': secret, 'match_ids': batch}, timeout=(5, 10))
        response.raise_for_status()
        completed = response.json().get('complete_match_ids')
        if not isinstance(completed, list) or not all(isinstance(value, str) for value in completed):
            raise ValueError('서버 저장 상태 응답 형식 오류')
        confirmed.update(set(completed) & set(batch))
    return confirmed


def pending_games(games: list, completed: set) -> list:
    return [game for game in games if f'OC1_{game["gameId"]}' not in completed]


def normalize_game_detail(raw: dict) -> dict:
    """game detail (10명 전체) → 서버 payload 형식"""
    queue = int(raw.get('queueId', -1))

    # participantId → gameName/LCU puuid 매핑
    pid_to_player = {}
    for ident in raw.get('participantIdentities', []):
        pid = ident['participantId']
        player = ident.get('player', {})
        pid_to_player[pid] = {
            'gameName': player.get('gameName', '').strip(),
            'lcu_puuid': player.get('puuid', ''),
        }

    participants = []
    for p in raw.get('participants', []):
        pid = p['participantId']
        player_info = pid_to_player.get(pid, {})
        game_name = player_info.get('gameName', '')
        lcu_puuid = player_info.get('lcu_puuid', '')

        # Riot PUUID로 변환 (tracked 플레이어만)
        riot_puuid = LCU_TO_RIOT_PUUID.get(lcu_puuid, lcu_puuid)

        stats = p.get('stats', {})
        augments = []
        for i in range(1, 5):
            v = stats.get(f'playerAugment{i}') or stats.get(f'augment{i}')
            if v and int(v) > 0:
                augments.append(int(v))

        # LCU(구 match-history 포맷)는 totalTimeCrowdControlDealt 를 쓴다.
        # Riot Match-V5 의 totalTimeCCDealt 만 읽던 탓에 CC가 계속 0으로 저장됐다.
        cc_dealt = 0
        for key in ('totalTimeCrowdControlDealt', 'totalTimeCCDealt', 'timeCCingOthers'):
            value = stats.get(key)
            if value:
                cc_dealt = int(value)
                break

        # 점수 축에 쓰는 값들. 포맷마다 키 이름이 갈려 후보를 순서대로 본다.
        #
        # 없으면 None 을 보낸다 — 0 으로 채우면 "아무것도 안 했다" 와 "이
        # 클라이언트는 안 알려준다" 가 같아져, 나중에 구분할 수 없게 된다.
        # 서버의 점수 계산은 None 인 축을 분모에서도 빼므로 눈금이 안 흔들린다.
        def pick(*keys):
            for key in keys:
                value = stats.get(key)
                if value is not None:
                    return int(value)
            return None

        # 팀원에게 준 힐/실드. 자힐이 섞인 totalHeal 과 달리 팀 기여만 담는다.
        heals_on_teammates = pick('totalHealsOnTeammates', 'totalHealOnTeammates')
        shields_on_teammates = pick(
            'totalDamageShieldedOnTeammates', 'totalDamageShieldedOnTeamMates',
        )
        # 방어로 막아낸 피해. 받은 피해와 섞어 "맞은 것" 과 "버틴 것" 을 가른다.
        self_mitigated = pick('damageSelfMitigated', 'totalDamageSelfMitigated')
        # 적을 묶은 횟수. Match-V5 의 challenges 필드라 LCU 에는 없을 수 있다.
        hard_cc_count = pick('enemyChampionImmobilizations')

        participants.append({
            'puuid':                       riot_puuid,
            'gameName':                    game_name,
            'championId':                  int(p.get('championId', 0)),
            'championName':                '',  # 서버에서 DDragon으로 채움
            'teamId':                      int(stats.get('teamId', p.get('teamId', 0))),
            'win':                         bool(stats.get('win', False)),
            'kills':                       int(stats.get('kills', 0)),
            'deaths':                      int(stats.get('deaths', 0)),
            'assists':                     int(stats.get('assists', 0)),
            'totalDamageDealtToChampions': int(stats.get('totalDamageDealtToChampions', 0)),
            'totalDamageTaken':            int(stats.get('totalDamageTaken', 0)),
            'totalHeal':                   int(stats.get('totalHeal', 0)),
            'totalHealsOnTeammates':       heals_on_teammates,
            'totalShieldsOnTeammates':     shields_on_teammates,
            'damageSelfMitigated':         self_mitigated,
            'hardCcCount':                 hard_cc_count,
            'goldEarned':                  int(stats.get('goldEarned', 0)),
            'totalTimeCCDealt':            cc_dealt,
            'augments':                    augments,
        })

    return {
        'gameId':       f'OC1_{raw["gameId"]}',
        'queueId':      queue,
        'gameCreation': int(raw.get('gameCreation', 0)),
        'gameDuration': int(raw.get('gameDuration', 0)),
        'participants': participants,
    }

# ─── 디버그 모드 ──────────────────────────────────────────────────────────────

def run_debug(session: requests.Session, puuid: str):
    print("\n=== DEBUG MODE ===\n")

    # 1. /lol/login 확인
    print("[1] 현재 로그인 정보")
    try:
        for ep in ['/lol-summoner/v1/current-summoner', '/lol-login/v1/session']:
            try:
                me = lcu_get(session, ep)
                if isinstance(me, dict) and me.get('puuid'):
                    print(f"  endpoint: {ep}")
                    print(f"  puuid: {str(me.get('puuid', '?'))[:25]}...")
                    print(f"  displayName: {me.get('displayName', me.get('summonerName', '?'))}")
                    break
            except Exception:
                continue
    except Exception as e:
        print(f"  실패: {e}")

    # 2. match history raw
    print("\n[2] Match History (raw 첫 3경기)")
    raw_games = get_match_history(session, puuid, count=20)
    print(f"  총 {len(raw_games)}경기 반환")

    mayhem_games = []
    for i, g in enumerate(raw_games[:3]):
        queue = g.get('queueId', g.get('queue', {}).get('id', '?'))
        gid = g.get('gameId', '?')
        gc = g.get('gameCreation', 0)
        dur = g.get('gameDuration', 0)
        n_parts = len(g.get('participants', []))
        print(f"\n  Game {i+1}:")
        print(f"    gameId:       {gid}")
        print(f"    queueId:      {queue}")
        print(f"    gameCreation: {gc}")
        print(f"    gameDuration: {dur}s")
        print(f"    participants: {n_parts}명")
        if n_parts > 0:
            p0 = g['participants'][0]
            print(f"    participant[0] keys: {list(p0.keys())[:15]}")
            stats0 = p0.get('stats', {})
            print(f"    participant[0].stats keys: {list(stats0.keys())[:15]}")
        if int(queue) == QUEUE_ID:
            mayhem_games.append(g)

    # 3. Mayhem 전용 확인
    print(f"\n[3] queueId {QUEUE_ID} (ARAM Mayhem) 경기")
    all_games = get_match_history(session, puuid)
    mayhem_all = [g for g in all_games if int(g.get('queueId', g.get('queue', {}).get('id', -1))) == QUEUE_ID]
    print(f"  총 {len(mayhem_all)}경기 발견")
    if mayhem_all:
        g = mayhem_all[0]
        game_id = g.get('gameId')
        print(f"\n  최신 Mayhem 게임 raw dump:")
        print(json.dumps(g, indent=2, ensure_ascii=False)[:3000])

        # 4. game detail 시도
        print(f"\n[4] game detail 조회 (gameId={game_id})")
        detail = get_game_detail(session, game_id)
        if detail:
            n_parts = len(detail.get('participants', []))
            n_ids = len(detail.get('participantIdentities', []))
            print(f"  participants: {n_parts}명")
            print(f"  participantIdentities: {n_ids}명")
            # 참여자 이름 출력
            for ident in detail.get('participantIdentities', []):
                player = ident.get('player', {})
                print(f"    participantId:{ident.get('participantId')} gameName:{player.get('gameName')} tag:{player.get('tagLine')}")
            print(f"\n  game detail raw dump:")
            print(json.dumps(detail, indent=2, ensure_ascii=False)[:2000])
        else:
            print(f"  ✗ game detail 조회 실패 (두 엔드포인트 모두 실패)")

    # 5. 점수 축에 쓰는 새 지표를 이 클라이언트가 알려주는지
    #
    # Riot API 키는 큐 2400(ARAM Mayhem) 경기를 아예 못 읽는다 (403). 그래서
    # 실드·막아낸 피해·하드CC 는 이 경로로만 들어올 수 있고, 과거 백필이
    # 가능한지도 여기 match history 가 얼마나 남아 있느냐로 갈린다.
    print(f"\n[5] 점수 축 지표 확인")
    probe_games = mayhem_all or all_games
    if not probe_games:
        print("  확인할 경기가 없다")
    else:
        wanted = {
            '팀원 힐':    ('totalHealsOnTeammates', 'totalHealOnTeammates'),
            '팀원 실드':  ('totalDamageShieldedOnTeammates', 'totalDamageShieldedOnTeamMates'),
            '막아낸 피해': ('damageSelfMitigated', 'totalDamageSelfMitigated'),
            '하드CC 횟수': ('enemyChampionImmobilizations',),
            'CC 지속시간': ('totalTimeCrowdControlDealt', 'totalTimeCCDealt', 'timeCCingOthers'),
        }
        detail = get_game_detail(session, probe_games[0].get('gameId'))
        parts = (detail or probe_games[0]).get('participants', [])
        stats0 = parts[0].get('stats', {}) if parts else {}
        for label, keys in wanted.items():
            found = next(((k, stats0.get(k)) for k in keys if stats0.get(k) is not None), None)
            print(f"  {label:12} {'O ' + found[0] + ' = ' + str(found[1]) if found else 'X (이 클라이언트는 안 알려줌)'}")

        oldest = min(
            (int(g.get('gameCreation', 0)) for g in probe_games if g.get('gameCreation')),
            default=0,
        )
        from datetime import datetime, timezone
        print(f"\n  이 클라이언트가 들고 있는 경기 {len(probe_games)}건")
        if oldest:
            when = datetime.fromtimestamp(oldest / 1000, tz=timezone.utc).date()
            print(f"  가장 오래된 경기: {when} — 백필은 여기까지만 가능하다")

# ─── 메인 ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--debug', action='store_true', help='진단 모드 (서버 전송 안 함)')
    parser.add_argument('--full', action='store_true', help='클라이언트가 제공하는 이전 기록도 재검사')
    args = parser.parse_args()

    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except ImportError:
        pass

    print("ARAM Squad Stats LCU Agent")
    print("-" * 40)

    # 1. lockfile
    print("[1] lockfile 탐색...")
    # 실행 중인 Riot/League 프로세스 먼저 출력
    print("  실행 중인 관련 프로세스:")
    found_league = False
    for proc in psutil.process_iter(['name', 'pid']):
        try:
            name = proc.info['name'] or ''
            if any(x in name.lower() for x in ['league', 'riot', 'lol']):
                print(f"    {name} (pid={proc.info['pid']})")
                if 'leagueclient' in name.lower() and 'ux' not in name.lower():
                    found_league = True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    if not found_league:
        print("  ⚠ LeagueClient.exe가 안 보여요. 롤 클라이언트(로비 화면)까지 실행해주세요.")
    lf = find_lockfile()
    if not lf:
        print("  ✗ League Client가 실행 중이지 않습니다.")
        sys.exit(1)
    print(f"  ✓ {lf}")
    lock = parse_lockfile(lf)
    print(f"  port={lock['port']}")

    # 2. 세션
    print("[2] LCU 연결...")
    session = lcu_session(lock['port'], lock['password'])

    # 3. 현재 계정 gameName 확인
    print("[3] 현재 계정 확인...")
    try:
        puuid, game_name = get_current_account(session)
        print(f"  gameName: {game_name}")
        print(f"  puuid(LCU): {puuid[:25]}...")
    except Exception as e:
        print(f"  ✗ {e}")
        sys.exit(1)

    if game_name not in TRACKED_NAMES:
        print(f"  ✗ '{game_name}'은 tracked 목록에 없습니다.")
        print(f"  tracked: {TRACKED_NAMES}")
        sys.exit(1)
    print(f"  ✓ tracked 계정 확인 ({game_name})")

    # debug 모드
    if args.debug:
        run_debug(session, puuid)
        return

    if not LCU_SECRET:
        print("\n✗ LCU_SYNC_SECRET 환경변수가 설정되지 않았습니다.")
        sys.exit(1)
    server_session = requests.Session()

    print('[4] 서버의 마지막 저장 경기 확인...')
    try:
        checkpoint = get_sync_checkpoint(server_session)
    except (requests.RequestException, ValueError, KeyError) as error:
        print(f'  ✗ 마지막 저장 기준을 확인하지 못했습니다: {error}')
        sys.exit(1)
    if checkpoint:
        when = datetime.fromtimestamp(checkpoint['creation'] / 1000, timezone(timedelta(hours=9)))
        print(f'  저장 기준: {when:%Y-%m-%d %H:%M:%S} KST · {checkpoint["gameId"]}')
    else:
        print('  완료된 저장 기준 없음 → 제공되는 전적 전체 재검사')
    print('  현재 계정 전적으로 저장 기준 이후 경기를 조회합니다...')
    stage_start = time.perf_counter()
    raw_games, reached = collect_since_checkpoint(session, puuid, checkpoint, args.full)
    collection_errors = []
    if checkpoint and raw_games and max(int(g.get('gameCreation', 0)) for g in raw_games) < checkpoint['creation']:
        collection_errors.append('클라이언트 전적이 서버의 마지막 저장 경기보다 오래됐습니다. 최신 목록을 확인하지 못했습니다.')
    if not reached:
        collection_errors.append('클라이언트가 같은 전적만 반환하거나 이전 기록을 제공하지 않아 저장 기준까지 확인하지 못했습니다.')
    phase = ''
    try:
        flow = lcu_get(session, '/lol-gameflow/v1/session')
        phase = flow.get('phase', '')
        end_id = int(flow.get('gameData', {}).get('gameId', 0))
        if phase in ('PreEndOfGame', 'WaitingForStats', 'EndOfGame') and end_id:
            raw_games, ready = wait_for_finished_game(session, puuid, end_id, raw_games)
            if not ready:
                collection_errors.append(f'OC1_{end_id}: 종료 경기 결과가 아직 준비되지 않았습니다. 저장 완료가 아닙니다.')
        elif phase in ('InProgress', 'GameStart', 'ChampSelect'):
            print('  클라이언트 기준 게임 진행 중: 현재 경기는 종료 결과가 준비된 뒤 수집됩니다.')
    except requests.RequestException:
        print('  경기 종료 상태 확인 불가. 전적 목록에 등록된 경기만 확인합니다.')
    raw_games = after_checkpoint(raw_games, checkpoint, args.full)
    print(f"  저장 기준 이후 확인 대상 {len(raw_games)}경기 · {time.perf_counter() - stage_start:.1f}초")

    # 6. Mayhem 필터 → 최근 경기 재검사 → game detail → 4인 확인
    # 서버가 game_results가 비어 있는 기존 games를 복구할 수 있으므로
    # 마지막 저장 시점 이후만 자르면 안 됩니다. 서버가 완전한 경기를 skip합니다.
    games_payload = []
    mayhem_games = [g for g in raw_games
                    if int(g.get('queueId', g.get('queue', {}).get('id', -1))) == QUEUE_ID]
    print(f"  Mayhem 경기: {len(mayhem_games)}개")
    print("[5] 서버 저장 완료 경기 확인...")
    stage_start = time.perf_counter()
    completed = set()
    try:
        completed = get_completed_match_ids(server_session, mayhem_games, LCU_SECRET)
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code in (401, 403):
            print("  ✗ 동기화 인증 실패. LCU_SYNC_SECRET을 확인해주세요.")
            sys.exit(1)
        print("  저장 확인 실패 → 누락 방지를 위해 기존 방식으로 재검사합니다.")
    except (requests.RequestException, ValueError):
        print("  저장 확인 실패 → 누락 방지를 위해 기존 방식으로 재검사합니다.")
    candidates = pending_games(mayhem_games, completed)
    print(f"  저장 완료 {len(completed)}경기 생략 · 확인 {time.perf_counter() - stage_start:.1f}초")
    print(f"[6] 미저장 경기 상세 조회 ({len(candidates)}경기)...")
    stage_start = time.perf_counter()

    for raw in candidates:
        game_id = raw.get('gameId')
        detail = get_game_detail(session, game_id)
        if not detail:
            print(f"  skip OC1_{game_id} (game detail 조회 실패)")
            collection_errors.append(f'OC1_{game_id}: 경기 상세 조회 실패, 다시 실행해주세요.')
            continue

        # 4명 다 있는지 LCU puuid 기준 확인
        lcu_puuids_in_game = {
            ident['player']['puuid']
            for ident in detail.get('participantIdentities', [])
        }
        if not LCU_PUUID_SET.issubset(lcu_puuids_in_game):
            found = len(LCU_PUUID_SET & lcu_puuids_in_game)
            print(f"  skip OC1_{game_id} (4명 미충족: {found}/4)")
            continue

        norm = normalize_game_detail(detail)
        games_payload.append(norm)
        print(f"  ✓ OC1_{game_id} 포함")

    print(f"  Mayhem 4인 게임: {len(games_payload)}경기 · 조회 {time.perf_counter() - stage_start:.1f}초")
    if collection_errors:
        print(f"errors: {collection_errors}")
        print('  미확인 경기를 남긴 채 저장 기준을 앞당기지 않습니다. 다시 실행해주세요.')
        sys.exit(1)
    games_payload.sort(key=lambda game: game['gameCreation'])

    # payload 샘플 출력 (디버그용)
    if games_payload:
        sample = games_payload[0]
        print(f"\n  [payload 샘플] gameId: {sample['gameId']}")
        for p in sample['participants']:
            if p['gameName'] in TRACKED_NAMES:
                print(f"    {p['gameName']} | puuid:{p['puuid'][:20]}... | {p['kills']}/{p['deaths']}/{p['assists']}")

    if not games_payload:
        if collection_errors:
            print(f"errors: {collection_errors}")
            sys.exit(1)
        print("  저장 기준 이후, 현재 전적에 등록된 미저장 4인 경기 없음.")
        print("  방금 끝난 경기가 안 보인다면 결과 등록 대기일 수 있습니다. 롤 전적 화면을 열고 다시 실행해주세요.")
        return

    # 7. 서버 전송 (배치로 나눠서)
    BATCH_SIZE = 3
    total_synced = 0
    total_skipped = 0
    total_errors = list(collection_errors)

    batches = [games_payload[i:i+BATCH_SIZE] for i in range(0, len(games_payload), BATCH_SIZE)]
    print(f"[7] 서버 전송 ({len(batches)}배치 × {BATCH_SIZE}경기씩)...")

    for i, batch in enumerate(batches):
        print(f"  배치 {i+1}/{len(batches)} ({len(batch)}경기)...", end=' ', flush=True)
        stage_start = time.perf_counter()
        try:
            resp = server_session.post(SERVER_URL, json={
                'secret': LCU_SECRET,
                'games': batch,
                'stop_on_error': True,
            }, timeout=60)
            resp.raise_for_status()
            result = resp.json()
            synced  = result.get('synced', 0)
            skipped = result.get('skipped', 0)
            errors  = result.get('errors', [])
            total_synced  += synced
            total_skipped += skipped
            total_errors  += errors
            print(f"{'⚠' if errors else '✓'} synced:{synced} skipped:{skipped} HTTP:{resp.status_code} · {time.perf_counter() - stage_start:.1f}초")
            if errors:
                print(f"    errors: {errors[:3]}")
                break
        except Exception as e:
            print(f"✗ {e}")
            total_errors.append(str(e))
            break

    print(f"\n완료! 총 synced:{total_synced} / skipped:{total_skipped}")
    if total_errors:
        print(f"errors: {total_errors[:5]}")
        sys.exit(1)
    print("서버 저장 확인 완료. 사이트 새로고침 또는 자동 갱신을 기다려주세요.")


if __name__ == '__main__':
    started = time.perf_counter()
    try:
        main()
    finally:
        print(f"\n총 실행 시간: {time.perf_counter() - started:.1f}초")
