# 운영 안내 (메인테이너용)

운영 환경 설정, 배포, 백업·복구 절차다. 기여만 한다면 읽지 않아도 된다. 운영 계정(Cloudflare, Discord 애플리케이션, GitHub Organization 설정)은 메인테이너만 다룬다. 설계 근거는 [TSD](tsd.md) 9절에 있다.

## 1. 운영 환경 처음 설정 (한 번)

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create jungle5-prod        # 나온 id를 wrangler.jsonc에 넣는다
```

비밀이 아닌 값은 `wrangler.jsonc`의 `vars`에 둔다 (`APP_ORIGIN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_ADMIN_ROLE_ID`). 비밀값은 아래처럼 넣는다.

```sh
pnpm exec wrangler secret put DISCORD_CLIENT_SECRET
openssl rand -base64 32 | pnpm exec wrangler secret put TOKEN_ENC_KEY
pnpm exec wrangler secret put ALERT_WEBHOOK_URL
```

Discord 애플리케이션에는 Redirect URL `<APP_ORIGIN>/auth/callback`을 추가한다 (범위 `identify guilds.members.read`).

GitHub 저장소 시크릿:

- `CLOUDFLARE_API_TOKEN` (Workers Scripts·D1 편집 권한)
- `CLOUDFLARE_ACCOUNT_ID`
- `ALERT_WEBHOOK_URL` (선택)

`deploy.yml`의 배포 작업은 `production` 환경을 쓴다.

main 보호 규칙 (D-26): PR 필수, 승인 1명 이상, `ci` 체크 통과 필수. 공개 저장소라 무료 요금제에서도 쓸 수 있다 (D-25). 이 규칙과 별개로 `deploy.yml`은 테스트 작업이 통과해야만 배포한다.

### 1.1 HTML 공유 설정 (D-30~D-32, TD-26·TD-27, 한 번)

업로드한 HTML은 별도 Worker `jungle5-html`(설정 `wrangler.html.jsonc`, 주소 `https://jungle5-html.jungle5.workers.dev`)에서만 열린다. 메인 Worker의 `HTML_ORIGIN` 변수와 CSP `frame-src`가 이 주소를 가리킨다. 이 Worker에는 jungle5.xyz 경로를 붙이지 않는다.

1. 서명 키를 만들어 **두 Worker에 같은 값으로** 넣는다. 한쪽만 바뀌면 HTML이 열리지 않는다(403).

   ```sh
   key=$(openssl rand -base64 32)
   printf %s "$key" | pnpm exec wrangler secret put HTML_SIGNING_KEY
   printf %s "$key" | pnpm exec wrangler secret put HTML_SIGNING_KEY -c wrangler.html.jsonc
   unset key
   ```

   `jungle5-html` Worker가 아직 없으면 먼저 한 번 배포된 뒤(`deploy.yml`) 넣는다. 키를 바꾸면 이미 발급된 링크(최대 1시간)는 무효가 되고, 사이트에서 다시 열면 된다.
2. Discord Developer Portal → General Information의 **Public Key**를 `wrangler.jsonc`의 `vars.DISCORD_PUBLIC_KEY`에 넣고 PR로 배포한다(공개값). 비어 있으면 `/discord/interactions`는 모든 요청을 401로 거절한다.
3. 배포가 끝나면 같은 화면의 **Interactions Endpoint URL**에 `https://jungle5.xyz/discord/interactions`를 넣고 저장한다. Discord가 서명한 PING을 보내 확인한다(공개 키가 틀리면 저장되지 않는다).
4. Installation(또는 OAuth2 URL Generator)에서 `applications.commands` 범위로 앱을 커뮤니티 서버에 설치한다. 봇 사용자(`bot` 범위)는 필요 없다.
5. 운영자로 로그인한 브라우저 콘솔(사이트 탭)에서 한 번 실행해 메시지 명령 "정글5에 올리기"를 서버 명령으로 등록한다. 명령 정의를 바꿨을 때만 다시 실행한다.

   ```js
   await fetch("/api/admin/discord/commands", { method: "POST", headers: { "Content-Type": "application/json" } }).then((r) => r.json())
   ```

   성공하면 `{ command: { id, name, type: 3, guildId } }`. 실패하면 503과 Discord 응답 코드(예: 401이면 `DISCORD_CLIENT_SECRET` 확인).

로컬 개발: `.dev.vars`에 `HTML_ORIGIN=http://localhost:8788`과 `HTML_SIGNING_KEY`를 넣고(`.dev.vars.example` 참고) 터미널 두 개에서 `pnpm dev`(8787)와 `pnpm dev:html`(8788)을 함께 띄운다. 두 프로세스는 기본 저장소 `.wrangler/state`의 같은 로컬 D1을 쓰고, HTML Worker도 같은 `.dev.vars`를 읽는다. Vite 플러그인의 보조 Worker(`auxiliaryWorkers`)는 자기 주소로 열리지 않아(서비스 바인딩 전용) iframe 출처로 쓸 수 없다.

## 2. 빌드 결과와 wrangler 설정

`pnpm build` 뒤에는 wrangler 명령이 생성된 설정(`.wrangler/deploy/config.json` → `dist/jungle5/wrangler.json`)을 쓴다. 이 설정은 정적 자산 바인딩을 `dist/client`로 가리킨다. 원본은 언제나 `wrangler.jsonc`다. `-c wrangler.html.jsonc`처럼 설정을 직접 주면 이 우회를 쓰지 않고 HTML Worker만 wrangler가 직접 묶는다(`pnpm exec wrangler deploy -c wrangler.html.jsonc --dry-run`으로 확인).

## 3. CI/CD

- `ci.yml`: PR마다 타입 검사, 린트, 테스트.
- `deploy.yml`: main에 push되면 테스트 → D1 Time Travel 북마크 기록 → 원격 마이그레이션 → HTML Worker 배포(`wrangler deploy -c wrangler.html.jsonc`) → 메인 Worker 배포. 문서(`docs/**`, `*.md`)만 바뀐 push는 배포를 건너뛴다. 실패하면 운영 웹훅으로 알린다.
- `backup.yml`: 매주 월요일 04:00 KST에 `d1 export` → gzip → GitHub Actions 아티팩트 `jungle5-d1-YYYY-MM-DD` (90일 보관). 성공·실패 모두 웹훅에 한 줄 보낸다.

마이그레이션은 추가만 한다 (TSD 9.2). `migrations/0000_init.sql`에는 생성된 DDL 뒤에 손으로 넣은 시드 행("기타" 카테고리)이 있다.

## 4. 백업에서 복구 (TSD 9.3)

최근 7일 안의 문제는 `wrangler d1 time-travel restore`를 먼저 쓴다. 배포 직전 북마크는 deploy 실행 요약에 남아 있다.

그보다 오래된 문제는 주간 백업으로 복구한다. 내보낸 파일은 테이블 이름순으로 CREATE TABLE과 INSERT가 섞여 있어서 그대로 넣을 수 없다 (부모 테이블보다 자식 행이 먼저 나온다). 먼저 순서를 다시 맞춘다.

```sh
gunzip backup.sql.gz
python3 -I scripts/build-d1-restore.py backup.sql > restore.sql
pnpm exec wrangler d1 create jungle5-restore
pnpm exec wrangler d1 execute jungle5-restore --remote --file=restore.sql
```

확인할 것:

- 테이블별 행 수가 맞다.
- `PRAGMA foreign_key_check` 결과가 비어 있다.
- `d1_migrations`가 저장소의 `migrations/`와 같다.

확인이 끝나면 `wrangler.jsonc`의 `database_id`를 새 DB로 바꿔 배포한다.

**큰 HTML 행 (2026-10-07):** D1은 SQL 문장 하나를 100,000바이트까지만 받는다(`SQLITE_TOOBIG`). `build-d1-restore.py`가 긴 값을 `UPDATE … ||` 조각으로 나눠 모든 문장을 90,000바이트 이하로 만들므로 위 절차를 그대로 쓰면 된다. 순서 문제(자식 행이 부모 테이블보다 먼저 오는 것)도 같은 스크립트가 해결한다(TSD 9.3).

**gzip BLOB (2026-10-07):** `post_html_blobs.data`(압축한 HTML 조각)는 덤프에 `X'<16진>'`으로 들어 있다. 스크립트가 `X''`로 넣은 뒤 `UPDATE … SET data = unhex(hex(data) || '<16진 조각>')`으로 이어 붙인다. 스크립트를 바꿨을 때와 분기 리허설 때는 먼저 로컬 왕복 확인을 돌린다. 임시 폴더만 쓰고 운영 DB와 `.wrangler/state`는 건드리지 않는다.

```sh
pnpm test:restore   # = python3 -I scripts/test-d1-restore.py, 성공하면 마지막에 OK 한 줄
```

## 5. D1 크기 지켜보기 (TD-25)

HTML 파일은 저장 크기 10MB까지 D1에 저장한다(사이트에서 올린 파일은 gzip으로 압축해 원본 50MB까지, Discord는 압축 없이 10MB까지). 무료 플랜의 D1 DB 크기 상한은 500MB이고, 저장 크기 10MB 파일 50개면 찬다. 한 달에 한 번, 그리고 큰 파일이 많이 올라온 뒤에 크기를 본다.

```sh
pnpm exec wrangler d1 info jungle5-prod
```

`database_size`를 본다(읽기 전용 명령). 어떤 글이 큰지는 `SELECT post_id, filename, size, encoding, stored_size FROM post_html ORDER BY coalesce(stored_size, size) DESC LIMIT 20`으로 본다 (`size`는 원본, `stored_size`는 실제로 차지하는 바이트).

- **400MB를 넘으면:** 운영자에게 알리고 다음 중 하나를 정한다.
  - Workers 유료 플랜(월 $5, TSD TD-05)으로 바꾼다. D1 DB 상한이 10GB가 된다. 코드 변경은 없다.
  - HTML만 R2로 옮긴다(R2 활성화에 결제 수단 등록 필요). `post_html_chunks`·`post_html_blobs`를 R2 객체로 바꾸는 설계·마이그레이션이 필요하다(새 TD).
- **500MB에 닿으면** 쓰기가 실패한다(글·댓글 포함 사이트 전체). 그 전에 위 조치를 끝낸다.
