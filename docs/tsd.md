---
title: 정글5 TSD
created: 2026-10-07
updated: 2026-10-07
type: technical-specification
status: review
version: "1.3"
prd: "prd.md"
tags: [jungle5]
---

# 정글5 (jungle5) 기술 설계 (TSD)

- **문서 상태:** Review v0.3 / 기술 인터뷰 3라운드 반영. 미결정 사항 없음
- **근거 문서:** [PRD](prd.md) v1.0 (제품 결정 D-01~D-21)
- **작성 방식:** 인터뷰로 기술 결정(TD-xx)을 하나씩 확정하고 각 절을 채운다. 요청자가 위임한 순수 엔지니어링 결정은 근거와 함께 테크 리드 판단으로 정하고, 비용·운영·보안 수준처럼 요청자가 판단할 사항만 묻는다.

## 0. 이 문서의 역할

PRD가 정한 "무엇을"을 **어떻게** 만들지 정한다. 데이터 모델, API, 인증·권한, 핵심 플로우, 배포·백업, 테스트 전략을 다룬다. 화면 구성은 별도 UI 문서에서 다룬다.

## 1. 범위 정의

- **포함:** PRD MVP 전체. 구현 순서는 PRD 13절 마일스톤(M1 지식 공간 → M2 스터디 공간 → M3 출시 준비)을 따른다.
- **제외(Backlog):** PRD 4.2 비목표와 13절 "운영 후 검토" 항목.

## 2. PRD에서 넘어온 기술 제약

이 표는 PRD 결정에서 바로 도출되며, 인터뷰 없이 고정한다.

| # | 제약 | 출처 |
|---|---|---|
| C-01 | 인증은 Discord OAuth2만 사용. 지정 서버 멤버 여부와 운영자 역할을 로그인 시 확인 | D-04, D-08 |
| C-02 | 모든 권한 검사는 서버에서 수행 (화면 숨김만으로 처리 금지) | PRD 5.2 |
| C-03 | 회차 정보·공동 기록 저장은 버전 기반 충돌 감지 (낙관적 동시성) | D-11 |
| C-04 | 임시저장은 브라우저 로컬에만, 로그아웃 시 제거 | D-12 |
| C-05 | 글·댓글 삭제는 영구 삭제, 탈퇴는 식별 정보 제거 후 콘텐츠 유지 | D-19, D-20 |
| C-06 | 운영 비용은 도메인 포함 월 1만원 이하 | D-14 |
| C-07 | 1인 + AI로 개발·운영 → 운영 부담이 적은 관리형 서비스 우선 | D-13 |
| C-08 | 규모: 멤버 20~50명, 스터디 3~5개 동시 진행 | D-01 |
| C-09 | Markdown 출력 안전 처리, 링크 프로토콜 제한 (http/https만 허용) | PRD 10절 |

## 3. 기술 결정 (Technical Decisions)

| # | 항목 | 결정 | 근거·트레이드오프 |
|---|---|---|---|
| TD-01 | 언어 | TypeScript 단일 언어 (프론트·서버·DB 스키마·테스트) | 초기 개발자가 특정 언어를 고집하지 않아 위임받음. Cloudflare Workers의 기본 언어이고 AI 코딩 도구의 생성 품질이 가장 안정적이다. 타입 검사가 사람이 하는 코드 리뷰의 일부를 대신한다 |
| TD-02 | 플랫폼 | Cloudflare Workers + D1 (SQLite) + Workers 정적 자산 | 프론트·API·DB를 한 플랫폼, 한 배포 단위로 둔다 (C-07). 무료 플랜으로 시작할 수 있다 (C-06) |
| TD-03 | 앱 구조 | React(Vite) SPA + Hono JSON API, 하나의 Worker로 배포 | 모든 페이지가 로그인 뒤에 있어 SSR·SEO가 필요 없다. API 경계가 분명해서 권한 검사를 API 단위로 테스트하기 쉽다 (C-02) |
| TD-04 | 검색 | D1에서 제목·본문 `LIKE '%검색어%'` 부분 일치 + 필터, 최신순 | 수천 건 규모에서 충분하다 (C-08). 한국어 형태소·2글자 검색 문제가 없다. 관련도 정렬은 포기한다. 글이 수만 건이 되면 FTS5 trigram 전환을 검토한다 |
| TD-05 | 요금제 | Cloudflare 무료 플랜으로 시작. 3.1 한도의 50%를 넘으면 유료($5/월)로 전환 검토 | 사용자 결정. 시점 복구 7일의 약점은 TD-06으로 보완한다 |
| TD-06 | 백업 | D1 시점 복구(7일) + GitHub Actions 주 1회 `wrangler d1 export` → GitHub Actions 아티팩트, 90일 보관 (2026-10-07 R2에서 변경) | 사용자 결정. 7일 넘게 지나서 발견된 실수·버그와 DB·계정 사고에 대비한다. 사용자 설정이 필요 없고 Cloudflare 밖에 보관된다 (9.3) |
| TD-07 | 세션 | 로그인 유지 30일. 24시간마다 요청 시점에 Discord 멤버·역할을 다시 확인한다 | 사용자 결정. 서버 이탈·역할 변경이 최대 24시간 안에 반영된다. 대신 Discord 토큰을 암호화해 저장한다 (6.3) |
| TD-08 | 도메인 | **`https://jungle5.xyz`** (2026-10-07, 가비아 등록 연 3,300원, DNS는 Cloudflare 무료 플랜). Worker 사용자 지정 도메인으로 연결하고, 예전 `jungle5.jungle5.workers.dev`는 경로·검색어를 유지한 채 301로 새 주소에 보낸다 (`src/worker/index.ts`) | 사용자 결정. 인증서는 Cloudflare 자동 발급(Google Trust Services). 주소를 바꿀 때는 `APP_ORIGIN`·`routes`와 Discord Redirect만 바꾸면 된다 |
| TD-09 | 서버 프레임워크 | Hono + zod 입력 검증 | Workers용 경량 라우터 중 가장 널리 쓰인다. zod 스키마는 프론트와 공유해 검증 규칙을 한 곳에 둔다 |
| TD-10 | DB 접근·마이그레이션 | Drizzle ORM (D1 드라이버) + drizzle-kit으로 SQL 마이그레이션 생성, `wrangler d1 migrations apply`로 적용 | 쿼리 결과가 타입으로 검사된다. 생성된 마이그레이션 SQL은 사람이 읽을 수 있는 파일로 남는다 |
| TD-11 | 프론트 | React + Vite + React Router + TanStack Query + Tailwind CSS | 서버 상태 캐시·재시도·중복 요청 방지를 TanStack Query가 맡는다. 스타일 세부는 UI 문서에서 정한다 |
| TD-12 | Markdown | 브라우저에서 react-markdown + remark-gfm + rehype-sanitize로 렌더링. 서버는 원문만 저장한다 | Workers CPU 10ms 한도를 피하고(3.1), 출력은 허용 목록 방식으로 정화한다 (C-09) |
| TD-13 | 중복 생성 방지 | 생성 요청의 ID를 클라이언트가 만든다 (UUIDv7). 같은 ID로 다시 오면 새로 만들지 않고 기존 결과를 돌려준다 | PRD F-10 "재시도·중복 클릭으로 중복 생성 금지"를 서버 로직 없이 PK 제약으로 보장한다 |
| TD-14 | 동시 편집 | 편집 단위마다 `version` 정수. `UPDATE … WHERE id=? AND version=?`가 0행이면 409 + 최신본 반환 | C-03, D-11. 회차는 "회차 정보"와 "모임 기록"의 버전을 따로 두어 서로 다른 칸을 고칠 때 충돌로 막지 않는다 |
| TD-15 | 테스트 | Vitest + `@cloudflare/vitest-pool-workers`(실제 Workers 런타임 + 로컬 D1)로 API 통합 테스트. M3에서 Playwright로 PRD 11절 시나리오 E2E | 요청자가 코드를 직접 검토하기 어렵다. 그래서 **권한 표(PRD 5.4)를 그대로 옮긴 테스트**가 리뷰를 대신하는 주된 안전장치다 |
| TD-16 | 저장소·배포 | GitHub **공개** 저장소 `jungle-5th-study/jungle5` (PRD D-25, 2026-10-07 이전은 비공개 `leorivk/jungle5`). PR마다 타입 검사·린트·테스트를 돌리고, 메인테이너 1명 승인 후 main에 병합되면 마이그레이션 적용 후 배포 (D-26) | "테스트를 통과하고 리뷰를 받아야만 배포된다"는 규칙을 기계가 지키게 한다 |
| TD-17 | 숨김 콘텐츠 노출 | 운영자와 작성자 본인만 "운영자가 숨김" 표시와 함께 본다. 다른 멤버에게는 404·목록 제외 | 사용자 결정. 작성자는 숨겨진 글을 고치거나 지울 수 있다 |
| TD-18 | 본문 이미지 | Markdown의 https 외부 이미지를 표시한다. `referrerpolicy="no-referrer"`, `loading="lazy"` 적용 | 사용자 결정. 외부 서버가 열람자 IP를 볼 수 있는 위험은 감수한다. CSP는 9.5 |
| TD-19 | 오류 알림 | Discord 비공개 운영 채널 웹훅으로 백업·배포 실패와 서버 오류를 보낸다. 서버 오류는 10분에 1건으로 묶는다 | 사용자 결정. 별도 모니터링 서비스 없이 이미 쓰는 Discord로 받는다 |
| TD-20 | 표시 이름 | Discord 서버 닉네임 → 전역 표시 이름 → 사용자명 순. 하루 1번 재확인 때 자동 갱신 | 사용자 결정. 프로필 편집 화면이 필요 없다 |
| TD-21 | 구현 중 보완 (M1 백엔드) | 아래 3.2 참고 | 구현하며 드러난 공백을 TSD·PRD와 가장 일관된 쪽으로 채움 |
| TD-22 | 글 종류 제거 (PRD D-22) | API·화면에서 `kind`, `recommend_reason`, `question_status`, `resolution_summary`를 없앤다. DB 컬럼은 이번 배포에서 남겨 두고, 새 글은 `kind='note'`로 저장한다. 다음 배포에서 컬럼을 삭제하는 마이그레이션을 따로 한다 | 9.2의 "추가만 하는 변경" 원칙. 코드가 먼저 컬럼을 쓰지 않게 된 뒤에 지워야 배포 중 오류가 없다. `/api/home`의 질문 묶음과 `kind` 필터도 삭제 |
| TD-23 | 스터디 멤버십 = Discord 역할 (PRD D-23, D-24) | `studies`에 `discord_role_id`(UNIQUE), `join_guide`를 추가한다. `study_members`는 직접 쓰지 않고, 로그인·24시간 재확인·`POST /api/me/refresh-roles` 때 그 회원의 역할 목록으로 다시 계산해 batch로 교체한다. `manager_id`와 참여·나가기·멤버 제외·관리자 넘기기 API, `MANAGER_MUST_TRANSFER`는 없앤다. 컬럼 삭제는 TD-22처럼 다음 배포에서 | 재확인 때 이미 멤버 객체(역할 포함)를 받아 오므로 Discord 호출이 늘지 않는다. 새로고침 API는 1분에 1번으로 제한해 Discord 호출 한도를 지킨다 |
| TD-24 | 오픈 전 1회 정리 마이그레이션 | TD-22·TD-23의 컬럼 삭제를 다음 배포로 미루지 않고 이번 배포에서 한 번에 한다: `posts`의 `kind`·`recommend_reason`·`question_status`·`resolution_summary`, `studies.manager_id` 삭제, `studies.discord_role_id`·`join_guide` 추가 | 2026-10-07 운영 DB에 글 0개, 멤버 1명. 배포 중 몇 초의 오류를 감수하는 것이 두 번 배포보다 싸다. 오픈 후에는 9.2 원칙(추가만, 삭제는 두 번에 나눠)으로 돌아간다 |
| TD-25 | HTML 저장 (D-30) | 새 테이블 `post_html`(post_id PK·FK CASCADE, html TEXT, ~~text TEXT(검색용 추출 글자)~~, filename, size, uploaded_at). HTML 안의 글자는 검색하지 않는다 (3.2). ~~상한 1.5MB~~ → **상한 10,000,000바이트 (2026-10-07, D-30)**: 파일을 UTF-8 문자 경계에서 1,900,000바이트 이하 조각으로 나눠 TEXT로 저장한다. 0번 조각은 `post_html.html`(기존 행은 그대로 한 조각짜리 파일), 1..n번은 새 테이블 `post_html_chunks(post_id FK→posts CASCADE, seq ≥ 1, data, PK(post_id, seq))`, `post_html.chunk_count = n` (마이그레이션 0004). 올리기·교체·삭제는 `post_html`과 모든 조각을 한 `db.batch()`로 바꾼다. D1에 저장해 백업에 자동 포함 | D1 값 상한 2MB (2026-10-07 확인). 기존 봇 파일 중 최대 310KB. 목록 쿼리가 큰 값을 읽지 않도록 posts와 분리. 10MB로 올리면서 R2 대신 조각 저장을 고른 이유: R2는 결제 수단 등록이 필요하고, D1이면 백업·삭제·권한이 지금 구조 그대로다. 대가는 D1 무료 DB 크기 500MB(3.1): 10MB 파일 50개면 찬다. 크기를 운영 문서(operations.md 5절)대로 지켜보고, 가까워지면 유료 전환(10GB) 또는 HTML만 R2로 옮긴다 |
| TD-26 | HTML 격리 | 업로드 HTML은 **별도 Worker `jungle5-html`(workers.dev, 다른 사이트)**에서 연다. 메인 API가 HMAC 서명한 1시간짜리 URL을 발급하고, 격리 Worker는 서명·만료를 확인한 뒤 같은 D1에서 읽어 응답한다. 응답에 `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads` 등 (3.2). 사이트에서는 `<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads">`(격리 Worker CSP sandbox와 같은 토큰, allow-same-origin·allow-top-navigation 없음)로 보여 주고, 메인 CSP에 `frame-src`로 그 주소만 허용 | 사용자 HTML은 스크립트를 실행하므로 로그인 쿠키·사이트와 완전히 분리한다 (githubusercontent.com과 같은 원리). workers.dev는 공용 접미사 목록에 있어 jungle5.xyz와 다른 사이트로 취급되고, 비용이 없다 |
| TD-27 | Discord 메시지 메뉴 (D-32) | Discord 앱의 Interactions Endpoint를 `https://jungle5.xyz/discord/interactions`로 두고 Ed25519 서명을 검증한다. 메시지 명령 "정글5에 올리기"는 운영자용 관리 API로 등록(client credentials). 처리: 3초 안에 지연 응답 → 첨부 다운로드·검증·글 생성 → 후속 메시지로 결과, 원래 메시지에 링크 답글 | 상시 실행 봇(게이트웨이 연결)이 필요 없다. `DISCORD_PUBLIC_KEY`는 공개값이라 vars에 둔다 |

### 3.1 확인한 플랫폼 한도 (2026-10-07, Cloudflare 공식 문서)

| 항목 | Free | Paid (월 $5부터) |
|---|---|---|
| Workers 요청 | 10만 건/일 | 월 1,000만 건 포함 |
| Workers CPU 시간 | 요청당 10ms | 월 3,000만 CPU-ms 포함, 요청당 기본 30초 |
| D1 DB 크기 | 500MB/DB, 계정 5GB | 10GB/DB |
| D1 읽기·쓰기 | 읽기 500만 행/일, 쓰기 10만 행/일 | 월 250억 행 읽기, 5,000만 행 쓰기 포함 |
| D1 호출당 쿼리 수 | 50 | 1,000 |
| D1 Time Travel (시점 복구) | 7일 | 30일 |

C-08 규모(50명, 주 수십 건 작성)에서는 Free 한도의 1%도 쓰지 않을 것으로 본다. 주의할 한도는 **요청당 CPU 10ms**다. Markdown 렌더링처럼 CPU를 쓰는 작업은 서버가 아니라 브라우저에서 처리한다.

출처: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Discord Get Current User Guild Member](https://docs.discord.com/developers/resources/user)

### 3.2 M1 구현 중 보완 사항 (2026-10-07)

| 항목 | 처리 |
|---|---|
| 테스트 라이브러리 이름 | `@cloudflare/vitest-pool-workers`가 `@cloudflare/vitest-plugin`으로 이름이 바뀜. API는 같다. Vitest는 이 플러그인이 지원하는 4.1에 고정 |
| 자료 글 | ~~추천 이유에 더해 참고 링크 1개 이상 필수 (PRD F-03)~~ (TD-22로 글 종류 삭제. 링크는 모든 글에서 선택) |
| 글 수정 충돌 | 글은 작성자만 수정하므로 `version`을 두지 않고 마지막 저장이 이긴다 |
| 미구현 응답 | ~~M2 범위(스터디·회차 API, 글↔회차 연결)는 501 `NOT_IMPLEMENTED`~~ (M2에서 모두 구현. 코드는 오류 목록에만 남김) |
| 다른 사람의 ID 재사용 | 같은 작성자의 재시도는 200 + 기존 결과, 다른 사람이 같은 ID를 쓰면 409 `DUPLICATE` |
| CSRF 실패 | 403 `FORBIDDEN`. 본문 없는 DELETE도 `Content-Type: application/json` 필요. 세션 검사가 먼저라 비로그인은 항상 401. 예외 하나: 원본 파일을 받는 `PUT /api/posts/:id/html`은 `Content-Type: text/html`만 받는다 (2026-10-07, TD-25). `text/html`도 CORS 안전 목록(`application/x-www-form-urlencoded`·`multipart/form-data`·`text/plain`)에 없어서, 다른 사이트는 사전 요청(preflight) 없이 보낼 수 없고 이 API는 CORS 헤더를 주지 않으므로 JSON과 같은 보호를 받는다. `Origin` 검사도 그대로다 |
| 외래 키 세부 | `posts.round_id`는 `ON DELETE SET NULL`. `rounds.study_id`·`study_members`는 CASCADE. `status`에 CHECK 제약 (`posts.kind`의 CHECK는 TD-24로 삭제) |
| 탈퇴 | ~~진행 중 스터디의 관리자일 때만 막는다~~ (TD-23으로 규칙 삭제). 탈퇴 시 `is_admin`도 해제 |
| 정적 자산 | `run_worker_first: true`. 보안 헤더(9.5)를 정적 파일에도 붙이기 위해, 자산 요청도 Worker를 거친다 (무료 한도 안) |
| Drizzle `db.batch()` | 조인 결과의 같은 이름 컬럼이 충돌한다. batch는 쓰기에만 쓰고, 조인 읽기는 `Promise.all`로 병렬 실행한다 |
| 마이그레이션 0001 (TD-24) | drizzle-kit이 만든 SQL(`PRAGMA foreign_keys=OFF` + `__new_x` 생성 → 원본 DROP → RENAME)은 D1에서 쓰지 않는다. 마이그레이션은 트랜잭션 안에서 돌아 `foreign_keys=OFF`가 무시되고, DROP TABLE의 암묵적 DELETE가 자식 테이블의 CASCADE·SET NULL을 실행한다(`defer_foreign_keys`도 막지 못함, 테스트로 확인: 댓글 전부 삭제). RENAME은 자식의 FK를 옛 테이블로 바꾼다. 그래서 손으로 쓴다: 영향받는 6개 테이블(studies, study_members, rounds, posts, post_tags, comments)을 FK 없는 백업 테이블로 복사 → 자식부터 DROP → 새 DDL로 부모부터 생성·복사 → 백업 삭제. drizzle 스냅샷(`meta/0001_snapshot.json`)은 생성된 그대로 둔다. 기존 스터디가 있으면 `discord_role_id`에 `unlinked:<id>`를 넣는다(어떤 역할과도 맞지 않음, 운영자가 실제 역할 연결) |
| 역할 → 스터디 멤버 계산 (TD-23) | 읽기 없이 쓰기 2개를 로그인·재확인 batch에 넣는다: 가진 역할에 해당하지 않는 행 삭제 + 해당 스터디 `INSERT … SELECT … ON CONFLICT DO NOTHING`. 남는 행의 `joined_at`은 유지된다. 역할 ID는 JSON 파라미터 하나(`json_each`)로 넘겨 D1 바인딩 개수 한도를 피한다. `/auth/test-login`은 `roles` 배열을 받는다 |
| `POST /api/me/refresh-roles` | 1분 1회 제한은 `ops_state`의 `refresh_roles:{memberId}` 행에 원자적 upsert(`ON CONFLICT DO UPDATE … WHERE updated_at <= now-60s`)로 기록한다. 제한에 걸리면 429 `RATE_LIMITED` + `retryAfterSeconds`(+ `Retry-After` 헤더). Discord 호출 전에 기록하므로 실패한 시도도 1회로 센다. Discord 장애는 72시간 유예 없이 503 `DISCORD_UNAVAILABLE`(세션 유지). 같은 요청에서 미들웨어가 이미 24시간 재확인을 했으면 Discord를 다시 부르지 않는다. 응답은 `GET /api/me`와 같은 형태. 탈퇴 batch가 이 행도 지운다 |
| 카테고리 글 수 (UI UD-14) | `GET /api/categories` → `{ items: [{ id, name, archived, createdAt, postCount }], totalPosts }`. 숨긴 글은 보는 사람(운영자·작성자 포함)과 관계없이 세지 않는다(탭 숫자가 사람마다 다르지 않게). 정렬은 SQL에서 `postCount DESC, name ASC`(SQLite 기본 BINARY 비교). `totalPosts`는 `postCount` 합계(글마다 카테고리가 정확히 하나). 쿼리 1개 |
| 권한 함수 정리 (TD-23) | 6.4 표의 `canReassignManager`는 관리자 개념이 없어져(D-24) 만들지 않는다. 질문 해결 권한(`canResolveQuestion`)도 TD-22로 삭제 |
| M2 스터디 (2026-10-07) | 운영자가 만든다: `name`·`goal`·`discordRoleId`(Discord snowflake, 17~20자리 숫자) 필수, `description`·`materials`·`cadence`·`joinGuide` 선택, 클라이언트 `id`(TD-13, 같은 id 재요청은 200). 역할이 이미 다른 스터디에 연결돼 있으면 409 `DUPLICATE` + `existing: {id, name}`. 정보(이름 포함) 편집은 스터디 멤버·운영자, `version` 필수(어긋나면 409 `VERSION_CONFLICT` + `latest` = 스터디 상세). 역할 변경 `PUT /api/studies/:id/role`, 종료·재개, 숨김·해제는 운영자. 숨긴 스터디(와 그 회차·회차 댓글)는 운영자 외에는 404·목록 제외(`/api/me`의 스터디, 홈, 연결 가능 회차 포함). 목록 순서: 내 진행 중 스터디 → 다른 진행 중 → 종료(내 것 먼저), 그룹 안은 이름순 |
| 역할 ID 저장·즉시 멤버십 (TD-23 보완) | 마이그레이션 0002: `members.discord_role_ids TEXT NULL`(JSON 배열). 로그인·24시간 재확인·역할 새로고침에서 study_members를 다시 계산하는 같은 batch에서 함께 저장한다. 스터디를 만들거나 역할을 바꾸면 같은 batch에서 그 스터디의 study_members를 "탈퇴하지 않았고 `is_guild_member=1`이며 저장된 역할에 그 역할이 있는 회원"으로 다시 계산한다(삭제 + `INSERT … SELECT … ON CONFLICT DO NOTHING`, 남는 행의 `joined_at` 유지). 0002 이전에 확인된 회원(NULL)은 다음 확인 때 들어온다. 탈퇴 batch가 `discord_role_ids`도 NULL로 지운다 |
| M2 회차 | 스터디 멤버·운영자가 스터디 진행 중에 만든다. 클라이언트 `id`(같은 사람·같은 스터디의 재요청은 200, 다른 사람은 409 `DUPLICATE`). `seq`는 INSERT 안의 서브쿼리(`MAX(seq)+1`)로 정해 동시 생성에도 겹치지 않고, 그래도 UNIQUE(study_id, seq) 충돌이 나면 1번 재시도 후 409. 필수 `title`·`scope`·`goal`, 선택 `periodStart`/`periodEnd`(YYYY-MM-DD, 끝 ≥ 시작), `meetingAt`(epoch ms), `location`, `materials`. `PATCH /info`(`infoVersion`)와 `PATCH /notes`(`notesVersion`)는 버전이 따로이고, 충돌 시 409 `VERSION_CONFLICT` + `latest` = 회차. 저장 시 `*_updated_by/at` 기록. 선택 항목은 생략 = 그대로, `null`·빈 문자열 = 지움 |
| 종료 상태 오류 코드 | 권한은 있는데 상태 때문에 막히면 403 대신 409로 이유를 알린다: `STUDY_ENDED`(종료된 스터디의 회차 생성·편집·종료/재개·삭제·글 연결), `ROUND_ENDED`(종료된 회차의 정보·기록 편집, 새 글 연결). 권한이 없으면 상태와 관계없이 403. 회차 댓글은 종료된 회차·스터디에서도 허용 |
| 회차 삭제 | `DELETE /api/rounds/:id`: 스터디 멤버·운영자, 스터디 진행 중(`canDeleteRound`). 연결된 글(숨김 포함)·댓글(숨김 포함)·모임 기록이 하나라도 있으면 409 `ROUND_NOT_EMPTY`. 비어 있는지는 DELETE 문의 조건(`NOT EXISTS …`)으로 검사해 그사이 생긴 연결을 잃지 않는다. 지운 번호는 다음 생성 때 `MAX+1`이면 재사용될 수 있다 |
| 회차 상세 | `GET /api/rounds/:id`: 회차 + 스터디 요약 + 연결 글(최신순, 숨김은 TD-17대로) + 댓글 + `previous`(같은 스터디에서 seq가 더 작은 회차 중 가장 큰 것. 보통 seq-1이고, 삭제로 빈 번호가 있으면 그 앞 회차) + 보는 사람 기준 `permissions`(canEditInfo, canWriteNotes, canSetStatus, canDelete(권한 && 비어 있음), canLink, canComment). SPA는 이 값을 쓰고 정책을 다시 계산하지 않는다. 스터디 상세도 `permissions`(canEdit, canCreateRound, canManage)를 준다 |
| 글↔회차 연결 (F-08, D-15) | `POST /api/posts`의 `roundId`, `PUT /api/posts/:id/round {roundId\|null}`. 연결은 글 작성자 본인이 그 스터디 멤버이고 스터디·회차가 모두 진행 중일 때만(운영자 예외 없음). 해제는 작성자면 언제나 가능. 없는 회차는 422(`roundId`). 연결·해제는 글 내용 수정이 아니므로 `updated_at`을 바꾸지 않는다. 글 목록·상세에 `round: {id, seq, title, studyId, studyName} \| null`(숨긴 스터디의 회차는 운영자 외 null). 편집기용 `GET /api/me/linkable-rounds` = 내 진행 중 스터디의 진행 중 회차, 최신순 |
| 회차 댓글 | `POST /api/rounds/:id/comments`: 커뮤니티 멤버 누구나, 클라이언트 id 재요청은 200(같은 작성자·같은 부모). 수정·삭제·숨김은 글 댓글과 같은 코드 |
| 홈 "이번 주" | `nextMeetings` = 내 진행 중(숨기지 않은) 스터디 회차 중 `meetingAt`이 이번 KST 주(월 00:00 이상 ~ 다음 월 00:00 미만)인 것, 오름차순. 항목: 회차 id·스터디 id·이름·seq·제목·scope 앞 200자·장소·일시·회차 상태·숨기지 않은 연결 글 수. 회차 상태는 거르지 않는다. 쓰이지 않던 `currentRounds`는 삭제 |
| 스터디 멤버 표시 | 멤버 목록·수는 `study_members` 중 `is_guild_member=1`인 회원. 탈퇴자는 행이 지워지므로 나오지 않는다(혹시 남아도 `withdrawn: true`로 익명 표시) |
| M2 권한 함수 추가 | `canViewStudy`(숨김이면 운영자만), `canChangeStudyRole`(운영자), `canDeleteRound`(스터디 멤버·운영자, 스터디 진행 중). `canLinkPostToRound`는 스터디·회차 상태도 받는다 |
| M2 쿼리 수 (7.2) | 가장 많은 요청: 회차 상세 1(세션) + 1(회차·스터디·멤버 여부·비어 있음) + 5(병렬: 사람, 글 2, 댓글, 직전 회차) = 7, 24시간 재확인이 겹치면 9. 회차 연결 글 작성 8(재확인 시 10) |
| HTML 첨부 (TD-25) | 마이그레이션 0003: `post_html(post_id PK FK→posts ON DELETE CASCADE, html, filename, size, uploaded_at, uploaded_via CHECK 'site'/'discord', discord_message_id UNIQUE NULL)`. 상한 ~~**1,500,000 바이트(UTF-8)**: D1 행 상한 2,000,000 바이트 안~~ **10,000,000 바이트(UTF-8)**, 조각 저장(아래 "HTML 조각 저장" 행, 2026-10-07). 확장자 `.html`/`.htm`(대소문자 무관), 파일 이름 1~200자(경로 구분자·제어 문자 불가). 올리기는 ~~**JSON** `PUT /api/posts/:id/html {filename, html}`~~ **원본 파일 그대로** `PUT /api/posts/:id/html` (2026-10-07): 본문 = 파일 바이트, `Content-Type: text/html; charset=utf-8`(charset이 있으면 utf-8만), `X-Filename: <UTF-8 파일 이름을 encodeURIComponent로 인코딩>`. 10MB를 JSON 문자열로 감싸고 파싱하는 CPU를 없애려는 것이다. 순서: 파일 이름 확인(422 `filename`) → `Content-Length`가 10,000,000 초과면 본문을 읽기 전에 413 → 글·작성자 확인(404/403) → 본문을 읽되 10,000,000바이트를 넘는 순간 멈추고 413 → 빈 파일·UTF-8 아님·U+0000은 422 `html`. 413은 `{code: "VALIDATION", message: "파일은 10MB 이하만 올릴 수 있습니다", fields: {html: [같은 문구]}}`. SPA는 파일을 `TextDecoder("utf-8", {fatal: true})`로 읽어 UTF-8이 아니면 막고(제목 추천용), 보낼 때는 읽은 원본 바이트를 그대로 보낸다. 서버도 조각마다 `TextDecoder("utf-8", {fatal: true, ignoreBOM: true})`로 엄격히 검사한다(BOM도 보존해 다시 인코딩하면 올린 바이트와 같다). 다시 올리면 덮어쓴다(`discord_message_id`는 유지). `DELETE /api/posts/:id/html`은 파일이 없어도 204. 둘 다 작성자만(`canEditPostHtml`)이고 글 `updated_at`을 바꾼다. ~~`POST /api/posts`도 선택 `html: {filename, html}`을 받아 글과 같은 batch로 저장한다(같은 id 재요청이면 무시하고 기존 글).~~ (2026-10-07) `POST /api/posts`는 파일을 받지 않는다: `html`이 있으면 422(배포 직후 열려 있던 옛 SPA가 파일을 조용히 잃지 않도록). SPA는 글을 만든 뒤 PUT으로 파일을 올리고, PUT이 실패하면 "글 내용은 저장했지만 HTML 파일을 올리지 못했습니다"를 보여 주며 입력과 파일을 그대로 둔다. 다시 저장하면 만든 글을 PATCH한 뒤 PUT한다(새로 만들지 않는다). 글 목록·상세에는 `html: {filename, size, uploadedAt} 또는 null`만 싣고 내용은 싣지 않는다(LEFT JOIN, 쿼리 수 그대로) |
| HTML 검색 제외 (2026-10-07, 제품 결정) | **HTML 안의 글자는 검색하지 않는다.** `q`는 지금처럼 제목·본문만 찾고, 추출 글자 컬럼(`text`)도 두지 않는다. 서버 추출(HTMLRewriter)은 무료 플랜의 요청당 CPU 10ms를 넘길 위험이 있고, 클라이언트가 보낸 글자는 검증할 수 없다. PRD D-30의 "검색(HTML 안의 글자 포함)"은 이 결정으로 대체된다 |
| HTML 격리 (TD-26) | 별도 Worker `jungle5-html`(`wrangler.html.jsonc`, 진입 `src/html-worker/index.ts`, 같은 D1 바인딩 `DB`, workers.dev만, 미리보기 URL 끔). `GET /v/:postId?exp=<unix 초>&sig=<hex>`만 받는다. HMAC-SHA256(`HTML_SIGNING_KEY`, `"{postId}.{exp}"`)를 WebCrypto `verify`로 상수 시간 비교해 틀리면 403, 그다음 만료면 410("링크가 만료됐습니다. 정글5에서 다시 열어 주세요"), 파일이 없으면 404, GET이 아니면 405, 다른 경로는 404. 응답 헤더: `Content-Type: text/html; charset=utf-8`, `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads`(allow-same-origin 없음: 전체 화면으로 열어도 불투명 출처), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: private, max-age=300`, `X-Robots-Tag: noindex, nofollow`. 쿠키는 절대 설정하지 않는다. 숨김·탈퇴 판단은 하지 않는다(메인 API가 볼 수 있는 사람에게만 서명한다). 메인 API `GET /api/posts/:id/html-url` → `{url, expiresAt}`(epoch ms, 1시간)는 글을 볼 수 있는 사람(`canViewPostHtml` = TD-17)에게만 주고, HTML이 없으면 404. 쿼리 1개(+세션). 파일을 바꿔도 같은 URL은 브라우저 캐시 때문에 최대 5분 예전 내용을 보일 수 있다. 업로드 HTML은 불투명 출처라 `localStorage`·쿠키를 쓰는 기능은 동작하지 않는다(의도된 제약) |
| Discord 메시지 명령 (TD-27) | `POST /discord/interactions`(`/api` 밖, 세션·CSRF 없음): 원문 본문과 `X-Signature-Timestamp`로 Ed25519 서명을 검증한다(`DISCORD_PUBLIC_KEY`, 비어 있으면 전부 401). PING → PONG. "정글5에 올리기"(type 3)만 처리하고 다른 명령은 임시(ephemeral) 안내, 다른 서버에서 오면 거절. 거절 순서(`discordUploadDenial`): 실행자 ≠ 메시지 작성자 → "본인이 올린 메시지만 올릴 수 있어요" → `.html/.htm` 첨부가 0개·2개 이상·~~1.5MB~~ 10MB(첨부의 `size`, 2026-10-07) 초과 → 안내 → 사이트 회원 아님(로그인 기록 없음·서버 이탈·탈퇴) → "먼저 https://jungle5.xyz 에 로그인해 주세요" → 같은 메시지를 이미 올렸으면 기존 글 링크. 통과하면 바로 지연 임시 응답(type 5, flags 64)을 주고 `waitUntil`에서: 첨부 다운로드(https `cdn.discordapp.com`·`media.discordapp.net`만, 리디렉트 거절, 실제 크기 재확인: `Content-Length`가 넘으면 바로, 아니면 10,000,000바이트를 넘는 순간 읽기를 멈춘다) → 사이트 올리기와 같은 조각 나누기·UTF-8 엄격 디코드 → 제목은 `<title>`(앞 64KB만 선형 탐색, 기본 엔티티 해석) 또는 확장자를 뺀 파일 이름(200자) → 카테고리 "기타"(`name_key`), 서버가 만든 UUIDv7, 본문 "Discord에서 올린 HTML입니다. [원래 메시지](…)" → posts + post_html(`uploaded_via='discord'`, `discord_message_id`) + 조각을 한 batch로 → **원래 임시 응답을 먼저 수정**("등록했습니다. 카테고리·태그는 사이트에서 바꿀 수 있어요: 링크") → 공개 후속 메시지 "📄 {제목} — 정글5에서 보기: 링크"(`allowed_mentions: {parse: []}`, 제목의 Markdown 문자는 이스케이프). 지연 응답이 "생각 중"일 때 보낸 첫 후속 메시지는 그 응답을 대신하고 임시 속성을 물려받기 때문에 이 순서로 둔다. 실패하면 임시 응답을 한국어 오류로 고친다. 같은 메시지가 동시에 두 번 오면 UNIQUE 충돌로 batch가 되돌려지고 기존 글 링크를 준다. 후속 메시지는 상호작용 토큰으로 보내므로 봇 토큰이 필요 없다. **D-32의 "원래 메시지에 답글"과 다른 점:** 상호작용 웹훅은 임의의 메시지에 답글(`message_reference`)을 달 수 없어서, 공개 후속 메시지(명령 사용 표시가 붙음)로 대신한다. 명령 등록은 `POST /api/admin/discord/commands`(운영자, `canManageDiscordCommands`): client credentials(`applications.commands.update`, Basic 인증) 토큰으로 `POST /applications/{id}/guilds/{DISCORD_GUILD_ID}/commands {name, type: 3, contexts: [0], integration_types: [0]}`(같은 이름이면 덮어쓰고 다른 명령은 그대로) → `{command: {id, name, type, guildId}}`. Discord 오류는 503 `DISCORD_UNAVAILABLE`. Discord 호출은 `AppDeps.discordApp`(주입 가능한 `fetch` 위)으로 묶어 테스트가 네트워크를 쓰지 않는다 |
| HTML 쿼리 수·CPU | `PUT /html`: 1(세션) + 1(글) + 1(batch) + 3(상세) = 6, 재확인이 겹치면 8. batch 안의 문장 수는 조각 수에 따라 늘지만(최대 1 + 1 + 1 + 5) D1 호출은 1번이다. ~~HTML을 붙인 `POST /api/posts`는 기존과 같다(batch에 문장 1개 추가).~~ 상호작용: 2(회원·중복, 병렬), 백그라운드 2(카테고리, batch). 격리 Worker: batch 1번(읽기 2문장). CPU: ~~1.5MB JSON 파싱과 UTF-8 바이트 계산이 가장 큰 일이고~~ 10MB에서 가장 큰 일은 UTF-8 → 문자열 디코드(올리기)와 문자열 → UTF-8 인코드(보기)다. 로컬 workerd 측정(2026-10-07): 10MB ASCII는 디코드·인코드 각 약 1ms, 한글·이모지가 빽빽한 10MB는 각 약 7~9ms. U+0000 검사는 디코드한 문자열에서 한다(`Uint8Array#includes`는 10MB에 약 2.5ms, 문자열 `includes`는 0.2~1.6ms). HTML은 파싱하지 않는다. D1로 10MB를 보내고 받는 직렬화 비용은 로컬에서 잴 수 없다. 요청당 10ms(Free)를 넘는 일이 잦으면 유료 전환(TD-05)을 검토한다. 서명(HMAC·Ed25519)은 WebCrypto 내장 |
| HTML 조각 저장 (TD-25, 마이그레이션 0004) | 조각 나누기(`src/worker/lib/postHtml.ts`): 1,900,000바이트에서 자르되 그 자리가 UTF-8 이어지는 바이트(`0b10xxxxxx`)면 문자 시작까지 최대 3바이트 뒤로 물린다. 잘못된 UTF-8은 아무 데서나 잘리고 엄격 디코드에서 422가 된다. `size`는 전체 바이트. 쓰기 batch: `post_html` upsert(0번 조각, `chunk_count`) + 그 글의 조각 전부 삭제 + 새 조각 INSERT(조각마다 문장 1개: 바인딩 값 하나가 D1 값 상한 안). 그래서 작은 파일로 바꾸면 남는 조각이 없다. `DELETE /html`도 조각과 `post_html`을 한 batch로 지운다. 글을 지우면 FK CASCADE로 조각도 지워진다. 격리 Worker는 `post_html`(html, size, chunk_count)과 조각(seq 순)을 한 batch(한 트랜잭션)로 읽어 교체 중이어도 한 버전만 보고, 조각 수가 `chunk_count`와 다르면 500(잘린 파일을 보내지 않는다). 응답은 조각을 하나씩 UTF-8로 인코딩해 흘려보내는 `ReadableStream`이고 `FixedLengthStream(size)`를 거쳐 `Content-Length: size`가 붙는다. 보안 헤더는 그대로(TD-26 행). 0004 이전 행은 `chunk_count = 0`이라 그대로 나간다 |

## 4. 시스템 구성

```text
브라우저 (React SPA)
  │  HTTPS, 세션 쿠키
  ▼
Cloudflare Worker (jungle5)
  ├─ 정적 자산: SPA 빌드 결과
  ├─ /api/*  : Hono 라우터 → 권한 검사 → D1
  └─ /auth/* : Discord OAuth2 콜백 → 서버 멤버·역할 확인 → 세션 발급
        │
        ├─ D1 (SQLite): 모든 데이터
        └─ Discord API: 로그인 시에만 호출
```

### 4.1 저장소 구조

```text
jungle5/
├─ src/
│  ├─ worker/          # Hono 앱 (Worker 진입점)
│  │  ├─ index.ts
│  │  ├─ auth/         # Discord OAuth, 세션, 재확인
│  │  ├─ routes/       # posts, comments, categories, studies, rounds, me, admin
│  │  ├─ policies.ts   # 권한 판단 함수 (PRD 5.4 표와 1:1)
│  │  └─ db/schema.ts  # Drizzle 스키마
│  ├─ web/             # React SPA
│  └─ shared/          # zod 스키마, API 타입, 상수
├─ migrations/         # drizzle-kit이 생성한 SQL
├─ tests/
│  ├─ api/             # 통합 테스트 (권한 매트릭스 포함)
├─ .github/workflows/  # ci.yml, deploy.yml, backup.yml
└─ wrangler.jsonc
```

### 4.2 설정값

| 이름 | 종류 | 설명 |
|---|---|---|
| `DISCORD_CLIENT_ID` | 변수 | Discord 애플리케이션 ID |
| `DISCORD_CLIENT_SECRET` | 비밀 | Discord OAuth 클라이언트 시크릿 |
| `DISCORD_GUILD_ID` | 변수 | 커뮤니티 Discord 서버 ID |
| `DISCORD_ADMIN_ROLE_ID` | 변수 | 운영자 역할 ID (D-08) |
| `ALERT_WEBHOOK_URL` | 비밀 | 운영 채널 Discord 웹훅 (TD-19). GitHub Actions 시크릿에도 같은 값 |
| `TOKEN_ENC_KEY` | 비밀 | Discord 토큰 암호화용 AES-256 키 (base64) |
| `APP_ORIGIN` | 변수 | 사이트 주소. OAuth 리다이렉트와 Origin 검사에 사용 |
| `HTML_ORIGIN` | 변수 | 격리 HTML Worker 주소 (TD-26). 서명 URL과 CSP `frame-src`에 사용 |
| `HTML_SIGNING_KEY` | 비밀 | 서명 URL용 HMAC 키. **메인과 `jungle5-html` 두 Worker에 같은 값** |
| `DISCORD_PUBLIC_KEY` | 변수 | Discord 앱 공개 키(hex). 상호작용 서명 검증 (TD-27) |

비밀값은 `wrangler secret`으로만 넣고 저장소에 커밋하지 않는다.

## 5. 데이터 모델

- 용어: PRD의 **회차(Session)는 코드에서 `round`**로 부른다. 로그인 세션(`auth_sessions`)과 이름이 겹치지 않게 하기 위해서다.
- ID는 모두 UUIDv7 문자열이다 (TD-13). 시각은 UTC epoch 밀리초 정수로 저장하고, 화면에서 KST로 표시한다. 회차 학습 기간처럼 날짜만 있는 값은 `YYYY-MM-DD` 문자열(KST 기준)로 둔다.
- D1은 외래 키를 기본으로 강제한다. 삭제 연쇄는 `ON DELETE CASCADE`로 DB가 처리하게 한다.

### 5.1 테이블

**members**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | |
| discord_user_id | TEXT UNIQUE NULL | 탈퇴 시 NULL |
| display_name | TEXT NULL | 탈퇴 시 NULL → 화면에 "탈퇴한 멤버" |
| avatar_url | TEXT NULL | 탈퇴 시 NULL |
| is_admin | INTEGER | 마지막 확인 시 운영자 역할 보유 여부 |
| is_guild_member | INTEGER | 마지막 확인 시 서버 멤버 여부 |
| verified_at | INTEGER | 마지막으로 Discord 확인에 성공한 시각 |
| withdrawn_at | INTEGER NULL | 탈퇴 시각 |
| created_at | INTEGER | |

**discord_tokens** (members와 분리해 접근 범위를 줄인다)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| member_id | TEXT PK FK→members ON DELETE CASCADE | |
| access_token_enc | TEXT | AES-GCM 암호문 |
| refresh_token_enc | TEXT | AES-GCM 암호문 |
| access_expires_at | INTEGER | |

**ops_state**: `key TEXT PK`, `value TEXT`, `updated_at`. 알림 묶기 등 운영용 상태 (TD-19).

**auth_sessions**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| token_hash | TEXT PK | 쿠키 토큰의 SHA-256. 원문은 저장하지 않는다 |
| member_id | TEXT FK→members ON DELETE CASCADE | |
| expires_at | INTEGER | 발급 후 30일 (TD-07) |
| created_at | INTEGER | |

**categories**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | 표시 이름 |
| name_key | TEXT UNIQUE | 소문자 변환 + 공백 제거. 중복 방지용 (D-17) |
| archived_at | INTEGER NULL | 보관 시 새 글에서 선택 불가 |
| created_by | TEXT FK→members | |
| created_at | INTEGER | |

**tags**: `id`, `name`, `name_key UNIQUE`. 작성자가 글에 입력하면 없을 때 자동 생성한다.
**post_tags**: `post_id FK ON DELETE CASCADE`, `tag_id FK`, PK(post_id, tag_id). 글당 최대 10개.

**posts**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | 클라이언트 생성 (TD-13) |
| kind | TEXT | `note`(정리) / `resource`(자료) / `question`(질문) |
| title | TEXT | 1~200자 |
| body | TEXT | Markdown, 최대 50,000자 |
| category_id | TEXT FK→categories | |
| author_id | TEXT FK→members | |
| round_id | TEXT NULL FK→rounds | 회차 연결 (F-08). 스터디는 회차를 통해 알 수 있으므로 따로 두지 않는다 |
| links | TEXT | JSON 배열 `[{url, label}]`, 최대 10개, http/https만 |
| recommend_reason | TEXT NULL | 자료 글 필수 |
| question_status | TEXT NULL | 질문 글: `open` / `resolved` |
| resolution_summary | TEXT NULL | 해결 시 필수 |
| hidden_at, hidden_by | NULL 허용 | 운영자 숨김 |
| created_at, updated_at | INTEGER | |

인덱스: `(created_at DESC)`, `(category_id, created_at)`, `(round_id)`, `(author_id)`.

**comments**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | 클라이언트 생성 |
| post_id | TEXT NULL FK→posts ON DELETE CASCADE | 글 댓글 |
| round_id | TEXT NULL FK→rounds ON DELETE CASCADE | 회차 댓글(개인 회고 등) |
| author_id | TEXT FK→members | |
| body | TEXT | 최대 5,000자 |
| hidden_at, hidden_by | NULL 허용 | |
| created_at, updated_at | INTEGER | |

`CHECK ((post_id IS NULL) <> (round_id IS NULL))`: 둘 중 정확히 하나만 채운다. 글을 지우면 댓글이 DB에서 함께 지워진다 (D-19).

**post_html** (TD-25, 3.2): `post_id PK FK→posts ON DELETE CASCADE`, `html`(파일의 0번 조각), `filename`, `size`(파일 전체 UTF-8 바이트), `uploaded_at`, `uploaded_via`(`site`/`discord`), `discord_message_id UNIQUE NULL`, `chunk_count`(0004, 기본 0: 뒤따르는 조각 수). 글당 최대 1개, 글을 지우면 함께 지워진다. 검색 대상이 아니다.

**post_html_chunks** (TD-25, 마이그레이션 0004): `post_id FK→posts ON DELETE CASCADE`, `seq`(1..n, CHECK ≥ 1), `data`(1,900,000바이트 이하 TEXT), `PRIMARY KEY (post_id, seq)`. `post_html`과 항상 같은 batch로 쓰고 지운다.

**studies**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | |
| name, goal | TEXT | 필수 |
| description, materials | TEXT NULL | Markdown |
| cadence | TEXT NULL | 기본 모임 주기 (자유 입력, 예: "매주 목 21시") |
| status | TEXT | `active` / `ended` |
| ~~manager_id~~ | TEXT FK→members | TD-23으로 사용 중단, 다음 배포에서 삭제 |
| discord_role_id | TEXT UNIQUE | 연결된 Discord 역할 (TD-23) |
| join_guide | TEXT NULL | 비멤버에게 보여 줄 참여 안내 (Markdown) |
| hidden_at | INTEGER NULL | |
| version | INTEGER | 설정 편집 충돌 감지 |
| created_at, updated_at | INTEGER | |

**study_members**: `study_id FK`, `member_id FK`, `joined_at`, PK(study_id, member_id). Discord 역할에서 계산한 결과를 담는 캐시다 (TD-23). 사이트에서 직접 바꾸지 않는다.

**rounds** (회차)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | TEXT PK | 클라이언트 생성 |
| study_id | TEXT FK→studies | |
| seq | INTEGER | 회차 번호. UNIQUE(study_id, seq) |
| title, scope, goal | TEXT | 필수. scope는 Markdown |
| period_start, period_end | TEXT NULL | `YYYY-MM-DD` |
| meeting_at | INTEGER NULL | 모임 일시 |
| location | TEXT NULL | 장소 또는 회의 링크 |
| materials | TEXT NULL | 공통 자료 Markdown |
| status | TEXT | `active` / `ended` |
| info_version | INTEGER | 회차 정보 편집 충돌 감지 |
| notes_discussion, notes_open_questions, notes_next_actions | TEXT NULL | 공동 기록 (F-09) |
| notes_version | INTEGER | 공동 기록 편집 충돌 감지 |
| notes_updated_by, notes_updated_at | NULL 허용 | 마지막 수정자 표시 |
| info_updated_by, info_updated_at | | |
| created_by, created_at | | |

### 5.2 삭제·탈퇴 처리

| 동작 | DB 처리 |
|---|---|
| 글 삭제 (D-19) | `DELETE FROM posts` → 댓글·태그 연결은 CASCADE로 함께 삭제. 회차 연결도 사라진다 |
| 댓글 삭제 | `DELETE FROM comments` |
| 탈퇴 (D-20) | 하나의 batch로 처리한다. ① members의 discord_user_id·display_name·avatar_url을 NULL로, withdrawn_at 기록 ② discord_tokens·auth_sessions 삭제 ③ study_members에서 제거. 글·댓글·회차 기록은 그대로 둔다 |
| 재가입 | discord_user_id가 비어 있으므로 같은 Discord 계정이 새 members 행으로 생성된다. 예전 글과 연결되지 않는다 |

삭제한 데이터도 백업(TD-06)에는 최대 90일 남는다. 이 내용을 개인정보 안내 문구에 적는다 (PRD 10절).

## 6. 인증·권한

### 6.1 로그인 플로우

1. `GET /auth/login`: `state` 난수를 만들어 짧은 수명(10분)의 HttpOnly 쿠키에 넣고, Discord 인가 화면으로 보낸다. 범위는 `identify guilds.members.read`.
2. `GET /auth/callback`: 쿠키의 `state`와 쿼리의 `state`가 다르면 거부한다. 인가 코드를 토큰으로 바꾼다.
3. `GET /users/@me`와 `GET /users/@me/guilds/{DISCORD_GUILD_ID}/member`를 호출한다. 멤버 조회가 404면 "커뮤니티 멤버만 이용할 수 있습니다" 화면으로 보내고, 세션을 만들지 않는다.
4. `discord_user_id`로 members를 찾거나 새로 만든다. 역할 목록에 `DISCORD_ADMIN_ROLE_ID`가 있으면 `is_admin=1`로 둔다. 닉네임은 서버 닉네임 → 전역 표시 이름 → 사용자명 순서로 고른다.
5. 토큰을 암호화해 저장하고, 32바이트 난수 세션 토큰을 발급한다. 쿠키는 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30일`이다.

### 6.2 요청마다 하는 검사 (미들웨어)

1. 쿠키 토큰의 해시로 `auth_sessions`를 찾는다. 없거나 만료면 401이다.
2. 회원이 탈퇴했거나 `is_guild_member=0`이면 401이다.
3. `verified_at`이 24시간보다 오래됐으면 6.3의 재확인을 한다.
4. 상태를 바꾸는 요청(POST/PATCH/PUT/DELETE)은 `Origin` 헤더가 `APP_ORIGIN`과 같고 `Content-Type: application/json`이어야 한다 (CSRF 방어). 원본 파일을 받는 `PUT /api/posts/:id/html`만 `Content-Type: text/html`이어야 한다 (3.2).

### 6.3 Discord 재확인 (TD-07)

- 저장된 access token으로 멤버 조회를 다시 한다. 만료됐으면 refresh token으로 갱신한 뒤 조회한다.
- **멤버 아님(404):** `is_guild_member=0`으로 바꾸고 해당 회원의 세션을 모두 지운 뒤 401을 돌려준다.
- **토큰 무효(401·갱신 실패):** 세션을 지우고 다시 로그인하게 한다.
- **Discord 장애(5xx·네트워크 오류):** 마지막 성공 후 72시간까지는 요청을 허용하고 다음 요청에서 다시 시도한다. 72시간이 넘으면 다시 로그인하게 한다. Discord 장애 때문에 사이트 전체가 막히지 않게 하기 위한 유예다.
- 성공하면 `is_admin`, 닉네임, 아바타, `verified_at`을 갱신한다.
- 토큰은 WebCrypto AES-GCM(키: `TOKEN_ENC_KEY`, 매번 새 IV)으로 암호화한다.

### 6.4 권한 판단

권한 판단은 모두 `policies.ts`의 순수 함수로 모은다. 라우트는 이 함수만 호출한다. 함수 목록은 PRD 5.4 표와 1:1로 대응한다.

| 함수 | 허용 조건 |
|---|---|
| `canCreateStudy`, `canEndStudy` (만들기·역할 연결·종료·재개) | 운영자 (D-24) |
| `canEditStudy` (목표·설명·공통 자료·참여 안내) | 스터디 멤버 또는 운영자 |
| `canEditRound`, `canWriteNotes`, `canCreateRound` | 스터디 멤버 또는 운영자, 그리고 스터디가 `active` |
| `canLinkPostToRound` | 글 작성자 본인이면서 해당 스터디 멤버, 스터디·회차 모두 진행 중 (D-15) |
| `canUnlinkPostFromRound` | 글 작성자 본인 |
| `canChangeStudyRole` | 운영자 |
| `canViewStudy` | 커뮤니티 멤버. 숨긴 스터디는 운영자만 |
| `canDeleteRound`, `canSetRoundStatus` | 스터디 멤버 또는 운영자, 스터디가 `active` (삭제는 회차가 비어 있어야 함) |
| `canEditPost`, `canDeletePost`, 댓글도 같음 | 작성자 본인 |
| `canHide`, `canManageCategory`(이름 변경·보관) | 운영자 |

종료된 회차(`ended`)의 정보·기록 편집은 막지만, 연결된 질문 글의 해결 처리와 댓글은 허용한다 (PRD F-06).

## 7. API 설계

모든 응답은 JSON이다. 오류 형식은 `{ "error": { "code": "VERSION_CONFLICT", "message": "…" } }`로 통일한다.

| 상태 | 의미 |
|---|---|
| 401 `UNAUTHENTICATED` / `NOT_GUILD_MEMBER` | 로그인 필요 |
| 403 `FORBIDDEN` | 권한 없음 |
| 404 `NOT_FOUND` | 없음, 또는 볼 수 없는 숨김 콘텐츠 (존재 여부를 노출하지 않는다) |
| 409 `VERSION_CONFLICT` | 동시 편집 충돌. 응답에 `latest`(최신본)를 포함한다 |
| 409 `DUPLICATE` | 같은 이름의 카테고리, 이미 다른 스터디에 연결된 Discord 역할, 다른 사람이 쓴 생성 ID. 응답에 기존 것(`existing`)을 포함한다 |
| 409 `STUDY_ENDED` / `ROUND_ENDED` | 권한은 있지만 스터디·회차가 종료돼서 막힘 (3.2) |
| 409 `ROUND_NOT_EMPTY` | 연결 글·댓글·모임 기록이 있는 회차 삭제 |
| 422 `VALIDATION` | 입력 검증 실패. 필드별 메시지를 포함한다 |

### 7.1 엔드포인트

| 메서드·경로 | 설명 | 권한 |
|---|---|---|
| `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` | 6.1 | – |
| `GET /api/me` | 내 정보·운영자 여부·참여 스터디 | 멤버 |
| `DELETE /api/me` | 탈퇴 (5.2) | 본인 |
| `GET /api/home` | 홈 화면 묶음: 이번 주(KST) 내 스터디 모임, 최근 글 | 멤버 |
| `GET /api/me/linkable-rounds` | 내 글을 연결할 수 있는 회차 (내 진행 중 스터디의 진행 중 회차) | 멤버 |
| `GET /api/categories` · `POST /api/categories` | 목록 · 추가 (D-17) | 멤버 |
| `PATCH /api/categories/:id` | 이름 변경·보관 | 운영자 |
| `GET /api/posts?q=&category=&tag=&kind=&round=&cursor=` | 검색·목록, 최신순 20개씩 (TD-04) | 멤버 |
| `POST /api/posts` | 작성 (클라이언트 ID, 선택적 roundId) | 멤버 |
| `GET /api/posts/:id` | 상세 + 댓글 | 멤버 |
| `PATCH /api/posts/:id` · `DELETE /api/posts/:id` | 수정 · 삭제 | 작성자 |
| `PUT /api/posts/:id/round` | 회차 연결·해제 `{ roundId \| null }` | 작성자 + 스터디 멤버 |
| `PUT /api/posts/:id/html` · `DELETE /api/posts/:id/html` | HTML 파일 첨부·교체 (본문 = 원본 파일, `Content-Type: text/html; charset=utf-8`, `X-Filename` 퍼센트 인코딩, 10MB 이하) · 삭제 (3.2) | 작성자 |
| `GET /api/posts/:id/html-url` | 격리 Worker의 1시간 서명 URL `{ url, expiresAt }` (TD-26) | 글을 볼 수 있는 멤버 |
| `POST /api/admin/discord/commands` | Discord 메시지 명령 등록 (TD-27) | 운영자 |
| `POST /discord/interactions` | Discord 상호작용 (Ed25519 서명, 세션 없음) | Discord |
| `GET /v/:postId?exp=&sig=` (`jungle5-html`) | 업로드 HTML 응답 (TD-26) | 서명 |
| `POST /api/posts/:id/comments` · `POST /api/rounds/:id/comments` | 댓글 작성 | 멤버 |
| `PATCH /api/comments/:id` · `DELETE /api/comments/:id` | 댓글 수정 · 삭제 | 작성자 |
| `POST /api/{posts\|comments\|studies}/:id/hide` · `/unhide` | 숨김 처리 | 운영자 |
| `GET /api/studies?status=` | 목록 (내 스터디 먼저) | 멤버 |
| `POST /api/studies` | 만들기 `{ name, goal, discordRoleId, … }`. 서버 역할 목록 조회에는 봇 토큰이 필요해서, MVP에서는 운영자가 역할 ID를 붙여 넣는다 (개발자 모드 "ID 복사") | 운영자 |
| `POST /api/me/refresh-roles` | Discord 역할 즉시 재확인 (1분 1회) | 멤버 |
| `GET /api/studies/:id` | 상세: 멤버, 회차 목록 | 멤버 |
| `PATCH /api/studies/:id` | 정보 수정 (`version` 필수) | 스터디 멤버·운영자 |
| `PUT /api/studies/:id/role` | Discord 역할 변경 `{ discordRoleId }`, 멤버 즉시 재계산 | 운영자 |
| `POST /api/studies/:id/end` · `/reopen` | 종료 · 재개 | 운영자 |
| `POST /api/studies/:id/rounds` | 회차 생성 (seq 자동 = 마지막 + 1) | 스터디 멤버 |
| `GET /api/rounds/:id` | 회차 상세: 정보, 연결 글(최신순), 공동 기록, 댓글, 직전 회차의 남은 질문·다음 행동, 보는 사람의 권한 | 멤버 |
| `PATCH /api/rounds/:id/info` | 회차 정보 수정 (`infoVersion` 필수) | 스터디 멤버 |
| `PATCH /api/rounds/:id/notes` | 공동 기록 수정 (`notesVersion` 필수) | 스터디 멤버 |
| `POST /api/rounds/:id/end` · `/reopen` | 회차 종료 · 재개 | 스터디 멤버 |
| `DELETE /api/rounds/:id` | 빈 회차 삭제 (3.2) | 스터디 멤버·운영자 |

### 7.2 구현 규칙

- 요청 하나에서 쓰는 D1 쿼리는 10개 이하로 한다 (Free 한도 50). 여러 쓰기는 `db.batch()`로 묶어 원자적으로 처리한다.
- 검색어의 `%`, `_`, `\`는 이스케이프하고 `LIKE ? ESCAPE '\'`로 쓴다. 검색어는 2~50자로 제한한다.
- 목록은 `(created_at, id)` 커서 방식으로 페이지를 나눈다.
- 숨김 콘텐츠는 운영자와 작성자 본인에게만 "운영자가 숨김" 표시와 함께 보인다. 그 외에는 상세 404, 목록·검색·회차에서 제외한다 (TD-17).

## 8. 주요 플로우

### 8.1 글 작성 (중복 방지, 임시저장)

1. 작성 화면을 열 때 UUIDv7을 만들고, 입력할 때마다 `localStorage['jungle5:draft:{memberId}:post:{id}']`에 저장한다 (C-04).
2. 저장 버튼을 누르면 `POST /api/posts { id, … }`를 보낸다. 요청 중에는 버튼을 막는다.
3. 서버는 `INSERT`를 시도한다. 같은 ID가 이미 있고 작성자가 같으면 기존 글을 200으로 돌려준다 (TD-13). 실패하면 입력을 지우지 않고 오류를 표시한다.
4. 성공하면 해당 임시저장 키를 지운다. 로그아웃 시 `jungle5:draft:{memberId}:` 접두사의 키를 모두 지운다.

### 8.2 공동 기록 편집 (충돌 감지)

1. 편집을 시작할 때의 `notesVersion`을 기억한다.
2. `PATCH /api/rounds/:id/notes { notesVersion, … }` → `UPDATE rounds SET …, notes_version = notes_version + 1 WHERE id = ? AND notes_version = ?`.
3. 0행이 바뀌었으면 409와 최신 기록을 돌려준다. 화면은 "다른 멤버가 먼저 저장했습니다"를 띄우고 **최신본과 내 입력을 나란히** 보여 준다. 사용자가 합쳐서 다시 저장한다. 내 입력은 지워지지 않는다 (D-11).

### 8.3 탈퇴

1. 화면에서 "글을 지우려면 먼저 직접 삭제하세요" 안내와 확인을 받는다.
2. 5.2의 batch를 실행하고, 쿠키를 지우고, 로컬 임시저장을 지운다.

## 9. 배포·운영·백업

### 9.1 환경

| 환경 | 구성 |
|---|---|
| 로컬 | `wrangler dev` + 로컬 D1. Discord OAuth는 개발용 Discord 앱 또는 테스트 로그인 사용 |
| 운영 | Worker `jungle5` + D1 `jungle5-prod`. 백업은 GitHub Actions 아티팩트 (9.3) |

테스트 로그인 경로(`/auth/test-login`)는 `ENV=test`일 때만 등록한다. 운영 빌드에 이 경로가 없는지 확인하는 테스트를 둔다.

### 9.2 CI/CD (GitHub Actions)

- **ci.yml (PR):** `tsc --noEmit`, ESLint, Vitest(API 통합 테스트).
- main 보호 규칙: PR 필수, 메인테이너 1명 승인, `ci` 통과, 강제 push·삭제 금지 (D-26). 저장소 ruleset "main 보호 (D-26)"로 설정하고, `release-owner` 팀(소유자)만 예외로 직접 push할 수 있다. 비공개 저장소였을 때는 무료 요금제라 쓸 수 없었고, 공개 전환(D-25)으로 가능해졌다. deploy.yml의 배포 작업도 테스트 성공을 조건(`needs: test`)으로 한다. 문서만 바뀐 push는 배포를 건너뛴다.
- **deploy.yml (main push):** ① 테스트 재실행 → ② 배포 직전 D1 Time Travel 복구 지점 기록 → ③ `wrangler d1 migrations apply jungle5-prod --remote` → ④ `wrangler deploy`.
- 마이그레이션은 **추가만 하는 변경**(컬럼·테이블 추가)을 원칙으로 한다. 컬럼 삭제·이름 변경은 두 번의 배포로 나눈다.

### 9.3 백업·복구 (TD-06)

- **backup.yml:** 매주 월요일 04:00 KST에 `wrangler d1 export jungle5-prod --remote`로 DB 전체를 내보내 gzip으로 압축한다. 결과는 **GitHub Actions 아티팩트**(`jungle5-d1-YYYY-MM-DD`)로 올리고 90일 뒤 GitHub가 자동 삭제한다. 성공·실패 모두 운영 웹훅에 실행 링크를 보낸다 (웹훅이 없으면 실패 시 GitHub 이메일).
- **R2가 아닌 GitHub에 두는 이유:** 사용자가 R2를 활성화(결제 수단 등록)할 필요가 없다. 백업이 Cloudflare 밖에 있어 계정 문제에도 남는다. GitHub Free 비공개 저장소의 아티팩트 저장 용량은 500MB, Actions는 월 2,000분이다(공개 저장소는 Actions 분량 제한 없음)(2026-10-07 확인). 덤프가 커져서 90일치가 500MB에 가까워지면 R2로 옮긴다.
- 내보내기는 실행 중에 다른 DB 요청을 막는다. 그래서 사용이 가장 적은 새벽에 돌린다. FTS 가상 테이블은 내보내기를 막기 때문에 쓰지 않는다 (TD-04와 맞물림).
- **덤프를 그대로 부을 수 없다 (2026-10-07 리허설에서 발견):** 두 가지 이유가 있다.
  1. 순서: 내보낸 파일은 테이블 이름순으로 "생성 → 데이터"를 반복해, 자식 행이 부모 테이블보다 먼저 온다 (`no such table`).
  2. 크기: **D1은 SQL 문장 하나를 100,000바이트까지만 받는다** (`SQLITE_TOOBIG`). 내보낸 파일은 행마다 INSERT 하나라 약 100KB를 넘는 HTML 행이 있으면 실패한다 (0003부터 해당).
- **해결: `scripts/build-d1-restore.py`** (2026-10-07). 덤프를 Python 내장 SQLite(문장 크기 제한 없음)에 먼저 읽은 뒤, "모든 CREATE TABLE → 모든 행 → 인덱스" 순서로 복원용 SQL을 다시 만든다. 긴 텍스트 값은 빈 값으로 INSERT한 뒤 `UPDATE … SET col = col || '<조각>'`으로 이어 붙이고, 모든 문장을 90,000바이트 이하로 유지한다. 행 단위로 다시 쓰므로 본문 안의 `;`·따옴표·줄바꿈에 안전하다. (이전 `reorder-d1-dump.py`는 순서만 고쳐서 큰 행을 처리하지 못해 대체했다.)
- **복구 방법:**
  - 최근 7일 이내 문제: `wrangler d1 time-travel restore jungle5-prod --bookmark=…` (배포 직전 북마크는 deploy 실행 요약에 남아 있다).
  - 그 이전 문제: ① 아티팩트를 받아 압축을 푼다 ② `python3 -I scripts/build-d1-restore.py backup.sql > restore.sql` ③ 새 D1을 만들고 `wrangler d1 execute <새 DB> --remote --file=restore.sql` ④ 아래 검사 쿼리로 확인 ⑤ `wrangler.jsonc`의 `database_id`를 새 DB로 바꿔 배포한다.
  - 검사 쿼리: 테이블별 행 수 비교, `PRAGMA foreign_key_check` 결과 비어 있음, `d1_migrations`가 저장소의 마이그레이션 목록과 같음.
- **리허설 기록:**
  - 2026-10-07: 운영 덤프(8KB) → 로컬 새 DB 복원 성공 (멤버·카테고리·세션·토큰 행 수 일치, FK 검사 통과). 같은 사본에 0001 마이그레이션 적용도 성공.
  - 2026-10-07: 3,000,050바이트 HTML(한글·이모지·따옴표 포함, 2조각)이 든 로컬 덤프(3.2MB) → 이전 스크립트는 `too long`으로 실패, `build-d1-restore.py`로 빈 로컬 D1에 복원 성공 (160문장, HTML 바이트 일치, FK 검사 통과, 테이블별 행 수 일치).
  - 이후 분기마다 1회 반복한다. 큰 HTML 행이 있는 덤프로 확인한다.

### 9.4 관찰·오류 대응

- Cloudflare Workers Logs(관측성)를 켜고, 처리되지 않은 예외는 요청 ID와 함께 로그로 남긴다.
- **알림 (TD-19):** Hono `onError`에서 5xx가 나면 `ops_state` 테이블의 `last_alert_at`을 확인한다. 10분이 지났을 때만 웹훅을 보낸다 (`ctx.waitUntil`, 응답을 늦추지 않음). 내용은 경로·오류 코드·요청 ID다. 본문·개인정보는 넣지 않는다.
- workers.dev 주소에서는 Cache API가 동작하지 않으므로, 알림 묶기용 상태는 D1에 둔다.
- GitHub Actions의 backup.yml과 deploy.yml은 실패 시 마지막 단계에서 같은 웹훅으로 알린다. 백업 성공도 매주 한 줄로 알려, 백업이 조용히 멈추는 일을 막는다.

### 9.5 보안 헤더

모든 응답에 아래 헤더를 붙인다. 격리 HTML Worker(`jungle5-html`)의 헤더는 3.2 "HTML 격리"를 따른다.

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-src <HTML_ORIGIN>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (`frame-src`는 격리 HTML Worker 주소만 허용, TD-26. `HTML_ORIGIN`이 비었거나 잘못되면 `'none'`)
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`

`img-src https:`는 TD-18(외부 이미지)과 Discord 아바타 때문이다. 스크립트는 자체 번들만 허용하므로, Markdown 정화가 뚫려도 외부 스크립트는 실행되지 않는 이중 방어가 된다.

## 10. 테스트 전략 (TD-15)

| 층 | 도구 | 범위 | 시점 |
|---|---|---|---|
| 정책 단위 | Vitest | `policies.ts`의 모든 함수 × 역할(비멤버·커뮤니티 멤버·스터디 멤버·운영자·탈퇴자) 표 기반 테스트 | M1부터 |
| API 통합 | Vitest + vitest-pool-workers + 로컬 D1 | 엔드포인트별 정상·권한 거부·검증 실패. 특히 **직접 API 요청으로 권한 우회가 안 되는지** (PRD F-01) | M1부터 |
| 시나리오 | 같은 도구 | 중복 생성(같은 ID 2회), 버전 충돌, 글 삭제 시 댓글·연결 정리, 탈퇴 익명화(F-11), 카테고리 중복 | 해당 기능 마일스톤 |
| E2E | Playwright (테스트 로그인) | PRD 11절 수용 시나리오, 모바일 화면 크기 포함 | M3 |
| 복구 | 스크립트 | 덤프 → 새 DB 복구 → 연결 무결성 검사 | M3, 이후 분기 1회 |

**AI에게 구현을 맡길 때의 완료 기준:** 위 테스트가 모두 통과하고, 새 엔드포인트에는 권한 거부 테스트가 최소 1개 있어야 한다.

## 11. 비용 추정 (C-06)

| 항목 | 예상 비용 | 근거 |
|---|---|---|
| Workers + 정적 자산 | 0원 | 무료 10만 요청/일 (3.1) |
| D1 | 0원 | 무료 한도 대비 사용량 1% 미만 예상 |
| 백업 (GitHub 아티팩트) | 0원 | 무료 500MB. 주간 덤프 13개는 수 MB 수준 |
| GitHub Actions | 0원 | 공개 저장소라 표준 러너 사용량 무료 |
| 도메인 | 연 3,300원 (월 약 275원) | jungle5.xyz, 가비아 (TD-08) |
| **합계** | **월 0원** | 유료 전환(TD-05) 시 월 $5 ≈ 7천원, 도메인 추가 시 월 2천원 이하 → 상한 1만원 이내 |

GitHub Actions 한도 출처: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). D1 내보내기 제약 출처: [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## 12. 미결정 사항

없음. 3라운드에서 모두 확정했다 (TD-17~TD-20). 구현 중 새로 생기는 결정은 TD 번호를 추가해 기록한다.

## 13. 문서 이력

- v1.3 (2026-10-07): 큰 HTML 행이 있는 백업 복원 해결 — `scripts/build-d1-restore.py` (9.3), 3MB HTML 리허설 기록.
- v1.4 (2026-10-07): HTML 상한 10MB (TD-25 조각 저장, 마이그레이션 0004, 원본 파일 PUT, 3.2·5.1·6.2·7.1·9.3).
- v1.3 (2026-10-07): HTML 공유 구현 (3.2 HTML 첨부·검색 제외·격리·Discord 메시지 명령, 4.2·7.1·9.5).
- v1.2 (2026-10-07): TD-25~TD-27 HTML 공유 설계.
- v1.1 (2026-10-07): 공개 저장소 전환 반영 (TD-16, 9.2 보호 규칙, 비용).
- v1.0 (2026-10-07): M2 스터디 공간 백엔드 (3.2 M2 행, 6.4·7·7.1 갱신), 마이그레이션 0002(`members.discord_role_ids`).
- v0.9 (2026-10-07): 도메인 jungle5.xyz 연결 (TD-08), workers.dev 301 이동.
- v0.8 (2026-10-07): 백업을 R2에서 GitHub 아티팩트로 변경(TD-06), 복원 리허설에서 덤프 순서 문제 발견·해결(9.3), TD-24 정리 마이그레이션, M1 brownfield 반영.
- v0.7 (2026-10-07): TD-23 (PRD D-23·D-24 스터디 멤버십 = Discord 역할, 관리자 폐지). 스터디 API·권한 함수·탈퇴 규칙 수정.
- v0.6 (2026-10-07): TD-22 (PRD D-22 글 종류 제거) 추가. UI 문서는 [UI](ui.md).
- v0.5 (2026-10-07): M1 운영 배포 완료 (https://jungle5.jungle5.workers.dev). GitHub Actions 자동 배포 검증, main 보호 규칙 불가에 따른 대체 기록.
- v0.4 (2026-10-07): M1 백엔드 구현 결과 반영 (TD-21, 3.2절).
- v0.3 (2026-10-07): 3라운드 TD-17~TD-20 반영. 숨김 노출 범위, 외부 이미지·CSP, Discord 웹훅 알림, 표시 이름 확정.
- v0.2 (2026-10-07): 기술 인터뷰 2라운드 반영 (TD-01~TD-08). 요청자 위임으로 엔지니어링 결정 TD-09~TD-16을 정함. 데이터 모델·인증·API·플로우·배포·백업·테스트·비용 초안 작성.
- v0.1 (2026-10-07): 골격 작성. PRD v1.0 제약 C-01~C-09 정리.
