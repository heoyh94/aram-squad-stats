# ARAM Squad Stats — LCU 에이전트 (Windows)

롤 클라이언트(LCU)에서 ARAM Mayhem(`queueId 2400`) 전적을 읽어
`https://aram4.vercel.app/api/lcu-sync` 로 전송하는 로컬 스크립트입니다.

추적 대상 4명이 **모두 포함된 경기만** 전송하며, 4명 중 아무나 실행하면 됩니다.

## 실행 방법

1. 롤 클라이언트를 **로비 화면까지** 켜둡니다.
2. `실행.bat` (또는 영문 환경이면 `run.bat`)을 더블클릭합니다.

`.bat` 파일이 Python 확인 → 필요한 패키지 자동 설치 → 스크립트 실행까지 처리합니다.

## 사전 준비

| 항목 | 내용 |
| --- | --- |
| Python | 3.8 이상. [python.org](https://python.org) 설치 시 **"Add python.exe to PATH"** 체크 필수 |
| 패키지 | `requests`, `psutil` — `.bat` 실행 시 자동 설치 (`requirements.txt`) |
| 환경변수 | `LCU_SYNC_SECRET` — 서버와 공유하는 인증 키 |

환경변수 설정 (한 번만):

```bat
setx LCU_SYNC_SECRET <REPLACE_WITH_SECRET_MANAGER>
```

설정 후 명령 프롬프트를 새로 열어야 값이 반영됩니다.

## 파일 구성

| 파일 | 설명 |
| --- | --- |
| `lcu_agent.py` | 수집·전송 본체 |
| `requirements.txt` | Python 의존성 |
| `실행.bat` | 한글 실행 스크립트 (UTF-8, `chcp 65001`) |
| `run.bat` | 영문 실행 스크립트 (한글 깨짐 환경용) |

## 되짚어 복구하기

기본 실행은 최근 8경기를 확인하고, **4명 결과가 모두 저장된 경기는 상세 조회와 전송을 생략**합니다.
2~3판 뒤에 실행해도 이 범위 안의 미저장 경기는 한 번에 전송합니다.
더 예전 경기가 누락됐다면 조회 구간을 넓혀서 실행하세요.

```bat
python lcu_agent.py --full
```

`run.bat --full`도 가능합니다. 저장 상태 확인이 실패하면 기존 방식으로 재검사하므로
네트워크 오류 때문에 경기를 잘못 건너뛰지 않습니다. 부분 저장된 경기도 복구 대상으로 남깁니다.

## 반영 시간과 실행 시간

- 롤 클라이언트의 전적 목록에 올라온 경기부터 가져올 수 있습니다. 종료 직후 목록에 없다면 결과 화면이 열린 뒤 다시 실행하세요.
- `synced`와 오류 여부로 서버 저장 결과를 확인하세요. HTTP 200이어도 `errors`가 있으면 성공 완료로 처리하지 않습니다.
- 사이트를 열어 두면 15초마다 새 기록을 확인합니다. 다른 창에서 돌아올 때도 확인하며, 바로 보고 싶으면 사이트의 새로고침 버튼을 누르세요.
- 목록 조회·저장 상태 확인·상세 조회·전송 및 총 실행 시간이 표시됩니다. 완료 후 창 닫기 대기는 2초이며, 실패하면 오류 확인을 위해 창을 유지합니다.

## 진단 모드

LCU 응답 원본을 확인하고 서버로는 전송하지 않습니다.

```bat
python lcu_agent.py --debug
```

## 알려진 데이터 이슈

CC 기여(`cc_score`)는 오랫동안 0으로 저장됐습니다. 에이전트가 Riot Match-V5 의
`totalTimeCCDealt` 만 읽었는데, LCU 응답은 `totalTimeCrowdControlDealt` 를 씁니다.
현재는 두 이름을 모두 읽습니다.

**이미 저장된 경기의 CC는 복구할 수 없습니다** — 원본 값이 남아 있지 않습니다.
수정 이후 수집된 경기부터 CC가 채워지고, 그때부터 꽁꽁이 메달과 CC 마일스톤이
정상 동작합니다.

## 자주 나는 오류

| 증상 | 원인 / 해결 |
| --- | --- |
| `ModuleNotFoundError: No module named 'psutil'` | 의존성 미설치. `.bat`으로 실행하면 자동 설치됩니다. 수동 설치는 `python -m pip install -r requirements.txt` |
| 패키지를 설치했는데도 `ModuleNotFoundError` | PC에 Python이 여러 개 있고 `.bat`이 다른 인터프리터를 잡은 경우. `.bat` 실행 시 첫 줄에 찍히는 "사용 중인 Python" 경로를 확인하고, 그 경로의 python으로 설치하세요: `"<그 경로>" -m pip install -r requirements.txt`. 현재 `.bat`은 이 경우를 자동으로 처리합니다 |
| `Python not found` | Python 미설치이거나 PATH 미등록. 재설치하며 "Add python.exe to PATH" 체크 |
| `League Client가 실행 중이지 않습니다` | 롤 클라이언트를 로비 화면까지 켠 뒤 재실행 |
| `'...'은 tracked 목록에 없습니다` | `lcu_agent.py`의 `TRACKED_PLAYERS`에 없는 계정으로 로그인된 상태 |
| `LCU_SYNC_SECRET 환경변수가 설정되지 않았습니다` | 위 `setx` 명령으로 설정 후 창을 새로 열기 |
| `skip OC1_... (4명 미충족: n/4)` | 정상 동작. 추적 대상 4명이 다 없는 경기는 전송하지 않습니다 |

## 동작 흐름

1. 실행 중인 `LeagueClient` 프로세스에서 `lockfile` 탐색 → 포트/비밀번호 획득
2. 현재 로그인 계정이 `TRACKED_PLAYERS`에 있는지 확인
3. 최근 `FETCH_COUNT`(8, `--full` 시 20)경기 중 `queueId 2400`만 필터
4. 인증된 `/api/lcu-sync/status` 요청 한 번으로 4명 결과의 저장 완료 여부 확인
5. 미저장·불완전 경기만 game detail 조회 → 10명 전체 수집, LCU PUUID → Riot PUUID 변환
6. 4명 모두 포함된 경기만 3경기씩 배치로 POST (같은 HTTP 세션 재사용)
