# 정글5 (jungle5)

Discord 커뮤니티 멤버만 쓰는 스터디·지식 공유 사이트다. 개인이 공부한 내용을 카테고리별 글로 나누고, 스터디는 주 1회 모임을 회차 단위로 기록한다. Discord 계정으로 로그인하고, 지정한 서버의 멤버만 들어올 수 있다. 커뮤니티 멤버들이 함께 만들고 관리하는 오픈소스다.

- 사이트: https://jungle5.xyz (커뮤니티 멤버 전용)
- 기술: TypeScript, Cloudflare Workers + D1, Hono JSON API, Drizzle ORM, React SPA (Vite, React Router, TanStack Query, Tailwind CSS)

## 빠르게 시작하기

Node.js 22 이상과 pnpm이 필요하다 (`corepack enable`이면 `package.json`의 pnpm 버전을 쓴다).

```sh
pnpm install
cp .dev.vars.example .dev.vars
openssl rand -base64 32          # 나온 값을 .dev.vars의 TOKEN_ENC_KEY에 넣는다 (HTML_SIGNING_KEY도 같은 방법으로 따로)
pnpm db:migrate:local            # 로컬 D1에 스키마 생성
pnpm dev                         # http://localhost:8787
pnpm dev:html                    # 두 번째 터미널: 첨부 HTML을 여는 격리 Worker, http://localhost:8788
```

`.dev.vars`는 `ENV=test`를 그대로 둔다. 커밋하지 않는다 (`.gitignore`에 있다).

`pnpm dev`는 Vite와 Worker(workerd)를 한 주소에서 띄운다. 그래서 포트는 `.dev.vars`의 `APP_ORIGIN`(8787)과 같아야 한다. 개발 중에만 CSP 헤더에 고정 nonce를 더해 Vite의 HMR 코드가 돌게 한다. 운영 CSP는 그대로다 (`vite.config.ts`).

글에 첨부한 HTML(D-30)은 `pnpm dev:html`로 띄운 별도 Worker(8788)에서 서명된 URL로 열린다 (TD-26). `.dev.vars`의 `HTML_ORIGIN=http://localhost:8788`과 `HTML_SIGNING_KEY`가 필요하고, 두 프로세스는 같은 로컬 D1을 쓴다. 이 Worker를 띄우지 않으면 글 화면의 HTML 칸만 비어 보인다.

### Discord 없이 로그인하기

`ENV=test`이면 `POST /auth/test-login`이 생긴다 (`ENV`가 `test`가 아니면 이 경로는 없다). `pnpm dev`의 로그인 화면에 "테스트 로그인" 폼(Discord 사용자 ID, 이름, 운영자 체크)이 보인다. 이 폼은 운영 빌드에서 빠진다. curl로도 된다.

```sh
curl -i -X POST http://localhost:8787/auth/test-login \
  -H 'Origin: http://localhost:8787' -H 'Content-Type: application/json' \
  -d '{"discordUserId":"1001","displayName":"tester","isAdmin":true}'
```

응답의 `j5_session` 쿠키로 `/api/*`를 부른다. 상태를 바꾸는 요청에는 `Origin: <APP_ORIGIN>`과 `Content-Type: application/json`이 필요하다 (CSRF 검사).

## 스크립트

| 명령 | 하는 일 |
|---|---|
| `pnpm dev` | Vite 개발 서버 + workerd의 Worker (로컬 D1은 `.wrangler/state`) |
| `pnpm dev:html` | 첨부 HTML용 격리 Worker `jungle5-html` (8788, 같은 로컬 D1) |
| `pnpm build` | SPA → `dist/client`, Worker → `dist/jungle5` |
| `pnpm preview` | 빌드 후 운영 빌드를 로컬 workerd로 띄움 |
| `pnpm typecheck` | Worker·테스트, SPA, 설정 파일 각각 `tsc` |
| `pnpm lint` | ESLint (typescript-eslint 타입 기반, `src/web`는 react-hooks 포함) |
| `pnpm test` | Vitest: `worker`(Workers 런타임 + 로컬 D1)와 `web`(jsdom) |
| `pnpm db:generate` | `src/worker/db/schema.ts`에서 마이그레이션 생성 |
| `pnpm db:migrate:local` | 로컬 D1에 마이그레이션 적용 |
| `pnpm db:migrate:remote` | 운영 D1에 적용 (CI가 한다. 직접 쓰지 않는다) |
| `pnpm deploy` | 빌드 후 `wrangler deploy` (CI가 한다. 직접 쓰지 않는다) |

## 저장소 구조

```text
src/worker/   Hono 앱 (index.ts 진입점, app.ts, auth/, routes/, policies.ts, db/schema.ts)
src/shared/   zod 스키마, API 타입, 상수 (SPA와 공유)
src/web/      React SPA (main.tsx, router.tsx, pages/, components/, lib/). 진입 HTML은 ./index.html
migrations/   SQL 마이그레이션 (wrangler가 적용)
tests/        unit/(권한 정책), api/(통합 테스트: 실제 workerd + 로컬 D1), 마이그레이션 테스트
              SPA 테스트는 코드 옆에 둔다: src/web/**/*.test.ts(x)
scripts/      운영 스크립트 (백업 덤프 정렬)
docs/         제품·기술·화면 설계 문서
```

## 문서

| 문서 | 답하는 질문 |
|---|---|
| [docs/prd.md](docs/prd.md) | 무엇을, 왜 만드는가. 제품 결정 D-xx, 권한 표, 기능별 수용 기준 |
| [docs/tsd.md](docs/tsd.md) | 어떻게 만드는가. 기술 결정 TD-xx, 데이터 모델, API, 인증·권한, 배포·테스트 |
| [docs/ui.md](docs/ui.md) | 어떻게 보이는가. UI 결정 UD-xx, 디자인 토큰, 화면·컴포넌트 |
| [docs/operations.md](docs/operations.md) | 운영 설정, CI/CD, 백업·복구 (메인테이너용) |

문서 지도와 결정 번호 규칙은 [docs/README.md](docs/README.md)에 있다.

## 기여하기

제안은 Discord 포럼에서 먼저 나누고, 코드는 PR로 보낸다. 절차와 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 본다. AI 코딩 도구를 쓴다면 [AGENTS.md](AGENTS.md)를 읽게 한다. 보안 문제는 공개 이슈가 아니라 [SECURITY.md](SECURITY.md)의 방법으로 알린다. 모든 참여자는 [행동 강령](CODE_OF_CONDUCT.md)을 따른다.

## 라이선스

[MIT](LICENSE)
