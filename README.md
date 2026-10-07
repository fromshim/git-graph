# git-graph

[한국어](README.md) | [English](README.en.md)

<p align="center">
  <img src="assets/preview.svg" alt="git-graph 패널 미리보기: 가지마다 색이 다른 커밋 그래프, 칩, 펼친 커밋 카드" width="720">
</p>

Claude Code 터미널 옆 패널에 저장소의 git 그래프를 실시간으로 그리는 mod 입니다.

`/plugin install git-graph@fromshim`

## 기능

- 커밋마다 한 줄. 가지(lane)는 부모 해시로 계산하고, 가지마다 색을 끝까지 유지합니다.
- 가지가 여러 개 갈라지는 지점은 연결 줄을 따로 그려서 선이 겹쳐 읽히지 않게 합니다.
- HEAD 는 `●`, 나머지 커밋은 `┿` `┯` `┷` 로 그립니다.
- 가지가 3개를 넘으면 접어 두고, 버튼으로 모두 펼칩니다.
- 스크롤해도 맨 위 줄(접기 버튼, 커밋 안 한 변경 개수, HEAD)이 `┊` 간격 위에 고정됩니다.
- 커밋 해시를 누르면 메시지와 바뀐 파일 목록(최대 30개)이 열립니다.
- 작성자 칩, 짧은 해시, 상대 시간(`2h`, `3d` 등)을 줄 끝에 보여 줍니다.
- 5초마다, 그리고 Bash 도구를 부를 때마다 새로 읽습니다.
- `/git-graph` 로 패널을 열고 닫습니다.

### 칩 범례

<p>
  <img src="assets/legend.ko.svg" alt="칩 범례: 로컬 브랜치, 원격 브랜치, 태그, 워크트리, HEAD" width="480">
</p>

| 칩 | 뜻 |
| --- | --- |
| `⎇ 이름` | 로컬 브랜치 |
| `⎇ 이름 =` | origin 과 같은 커밋 |
| `⎇ 이름 ↑n ↓n` | origin 보다 앞서거나 뒤처진 커밋 수 |
| `⌂ 이름` | 원격 브랜치 |
| `# 이름` | 태그 |
| `⑂ 이름` | 워크트리 (워크트리가 둘 이상일 때만) |

## 설치

카탈로그로 설치합니다.

```
/plugin marketplace add fromshim/marketplace
/plugin install git-graph@fromshim
```

이 저장소만 따로 설치할 수도 있습니다.

```
/plugin marketplace add fromshim/git-graph
/plugin install git-graph@git-graph
```

## 요구 사항과 참고

- hooks 모듈 mod 를 지원하는 Claude Code 가 필요합니다 (v2.1.292 에서 개발했습니다).
- mod 기능은 원격 롤아웃 스위치 뒤에 있어서 환경에 따라 꺼져 있을 수 있습니다.
- 색은 어두운 테마(Atom One Dark)를 기준으로 맞췄습니다.
- 일반 유니코드 문자만 쓰므로 Nerd Font 는 필요 없습니다.

## 개발

```
claude plugin validate .
claude plugin test .
```

미리보기 다시 그리기: `npx -y tsx scripts/preview.ts` 를 저장소 루트에서 실행하면 `assets/` 의 SVG 를 `core/` 레이아웃으로 다시 만듭니다.

### 구조

- `core/` 순수 TypeScript 입니다. 의존성, Node·DOM API, JSX 가 없고 `claude-code` 도 가져오지 않습니다. git 출력 문자열을 받아 데이터를 돌려줍니다.
  - `commands.ts` git 명령 인자와 구분자
  - `layout.ts` 가지 배치와 접기
  - `refs.ts` 칩, 추적 상태, 워크트리, 상대 시간
  - `show.ts` `git show` 파싱
  - `theme.ts` 색 팔레트
- `hooks/register.tsx` Claude Code UI 만 맡습니다. 훅, 패널 그리기, 새로 고침과 접기 연결, 그리고 git 실행(`$.process.run`)이 여기에 있습니다.
- 이렇게 나눈 이유는 `core/` 를 `cli/`(Node)와 `app/`(GUI)에서 다시 쓰기 위해서입니다. 둘 다 아직 만들지 않았고 계획만 있습니다.

## 라이선스

MIT
