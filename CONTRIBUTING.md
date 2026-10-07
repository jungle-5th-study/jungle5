# 기여 안내

정글5는 커뮤니티 멤버가 함께 만드는 사이트다. 기능 제안, 버그 신고, 코드, 문서 모두 환영한다. 모든 참여자는 [행동 강령](CODE_OF_CONDUCT.md)을 따른다.

## 1. 흐름

1. **제안·논의:** Discord 포럼에 기능 제안이나 버그를 올리고 함께 이야기한다.
2. **이슈화:** 운영진이 포럼 글에 "이슈화" 태그를 붙이면 GitHub 이슈가 자동으로 만들어진다 (PRD D-28). 포럼 글에는 이슈 링크가 답글로 달리고, 이슈가 닫히면 포럼에도 알린다. 이 자동화는 지금 준비 중이다. 그때까지는 운영진이 이슈를 직접 만든다.
3. **이슈 직접 열기:** 논의가 이미 끝났거나 작은 버그라면 GitHub에서 템플릿(기능 제안, 버그)으로 바로 열어도 된다. 큰 기능은 포럼에서 먼저 이야기하는 편이 빠르다.
4. **브랜치:** main에서 가지를 친다. 이름은 `종류/짧은-설명` 꼴로 짓는다.
   - `feat/round-template`, `fix/draft-not-cleared`, `docs/contributing`, `chore/bump-wrangler`
   - 메인테이너가 아니라면 저장소를 fork해서 작업한다.
5. **PR:** 템플릿을 채워 main으로 PR을 연다. 관련 이슈를 `Closes #12`처럼 연결한다.
6. **검사·리뷰:** CI(타입 검사, 린트, 테스트)가 통과하고 메인테이너 1명이 승인해야 합칠 수 있다 (D-26). 자기 PR은 자기가 승인할 수 없다. 프로젝트 소유자(`release-owner` 팀)만 예외로 main에 직접 push할 수 있다.
7. **합치기 = 운영 배포:** main에 합쳐지면 마이그레이션이 운영 DB에 적용되고 바로 배포된다. 그래서 합치는 모든 PR은 그 자체로 운영에 나가도 안전해야 한다. 미완성 기능은 PR을 나누거나 화면에 드러나지 않게 한다.

## 2. 로컬 개발

설치와 실행은 [README](README.md#빠르게-시작하기)를 본다. PR을 올리기 전에 세 가지를 돌린다. CI도 같은 것을 돌린다.

```sh
pnpm typecheck
pnpm lint
pnpm test
```

## 3. 지켜야 할 규칙

- **결정은 문서에 남긴다.** 제품 동작이나 기술 방식을 바꾸는 PR은 같은 PR에서 결정 표에 행을 추가한다. 제품 결정은 [PRD](docs/prd.md) 2.2절(D-xx), 기술 결정은 [TSD](docs/tsd.md) 3절(TD-xx), 화면 결정은 [UI](docs/ui.md) 2절(UD-xx)이다. 기존 결정을 뒤집을 때는 옛 행을 지우지 않고 취소선과 "→ D-xx로 대체"를 남긴다. 번호 규칙은 [docs/README.md](docs/README.md)를 본다.
- **마이그레이션은 추가만 한다** (TSD 9.2). 컬럼·테이블 추가만 하고, 삭제·이름 변경은 두 번의 배포로 나눈다. 먼저 코드가 그 컬럼을 쓰지 않게 배포하고, 다음 PR에서 지운다. 이미 합쳐진 마이그레이션 파일은 고치지 않는다.
- **새 엔드포인트에는 권한 거부 테스트가 있어야 한다** (TSD 10). 권한 판단은 `src/worker/policies.ts`에만 두고, 바꾸면 `tests/unit/policies.test.ts`의 표도 고친다.
- **비밀값을 커밋하지 않는다.** `.dev.vars`, 토큰, 웹훅 주소, 실제 회원 데이터는 저장소에 넣지 않는다. 이 저장소는 공개다.
- **CSP를 지킨다.** 운영 CSP는 `script-src 'self'; style-src 'self'`다. 인라인 `<script>`, 인라인 스타일, React의 `style={}` 속성을 쓰지 않는다. 스타일은 Tailwind 클래스와 `src/web/styles.css`의 토큰으로 한다. 외부 CDN 스크립트·폰트도 쓰지 않는다.
- **화면 문구는 한국어로 쓴다.** 짧고 평범한 문장으로 쓴다. 기존 화면의 말투를 따른다.

## 4. 커밋 메시지

`git log --oneline`의 형식을 따른다. 영어 소문자로 시작하고 끝에 마침표를 찍지 않는다.

```text
종류(범위): 무엇을 했는지
```

- 종류: `feat`, `fix`, `docs`, `ci`, `chore`, `test`, `refactor`
- 범위는 선택이다: `web`, `auth`, `tsd` 등
- 예: `feat(web): M2 study space UI`, `fix(auth): log Discord failure status on OAuth callback`, `docs(tsd): TD-08 custom domain jungle5.xyz`

## 5. AI 코딩 도구

Claude Code, Codex, Cursor 같은 AI 도구를 써도 된다. 저장소의 [AGENTS.md](AGENTS.md)에 도구가 읽을 규칙이 있다 (Claude Code는 `CLAUDE.md`를 통해 같은 파일을 읽는다).

AI가 만든 코드도 PR을 올린 사람의 코드다. 올리기 전에 직접 읽고, 테스트를 돌리고, 무엇을 왜 바꿨는지 PR에 설명할 수 있어야 한다. 리뷰어의 질문에 "AI가 그렇게 했다"는 답이 되지 않는다.

## 6. 보안 문제

취약점은 공개 이슈로 올리지 않는다. [SECURITY.md](SECURITY.md)의 방법으로 알린다.

## 7. 라이선스

기여한 코드와 문서는 저장소의 [MIT 라이선스](LICENSE)로 배포된다.
