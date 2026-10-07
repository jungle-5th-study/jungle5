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

## 2. 빌드 결과와 wrangler 설정

`pnpm build` 뒤에는 wrangler 명령이 생성된 설정(`.wrangler/deploy/config.json` → `dist/jungle5/wrangler.json`)을 쓴다. 이 설정은 정적 자산 바인딩을 `dist/client`로 가리킨다. 원본은 언제나 `wrangler.jsonc`다.

## 3. CI/CD

- `ci.yml`: PR마다 타입 검사, 린트, 테스트.
- `deploy.yml`: main에 push되면 테스트 → D1 Time Travel 북마크 기록 → 원격 마이그레이션 → 배포. 문서(`docs/**`, `*.md`)만 바뀐 push는 배포를 건너뛴다. 실패하면 운영 웹훅으로 알린다.
- `backup.yml`: 매주 월요일 04:00 KST에 `d1 export` → gzip → GitHub Actions 아티팩트 `jungle5-d1-YYYY-MM-DD` (90일 보관). 성공·실패 모두 웹훅에 한 줄 보낸다.

마이그레이션은 추가만 한다 (TSD 9.2). `migrations/0000_init.sql`에는 생성된 DDL 뒤에 손으로 넣은 시드 행("기타" 카테고리)이 있다.

## 4. 백업에서 복구 (TSD 9.3)

최근 7일 안의 문제는 `wrangler d1 time-travel restore`를 먼저 쓴다. 배포 직전 북마크는 deploy 실행 요약에 남아 있다.

그보다 오래된 문제는 주간 백업으로 복구한다. 내보낸 파일은 테이블 이름순으로 CREATE TABLE과 INSERT가 섞여 있어서 그대로 넣을 수 없다 (부모 테이블보다 자식 행이 먼저 나온다). 먼저 순서를 다시 맞춘다.

```sh
gunzip backup.sql.gz
python3 -I scripts/reorder-d1-dump.py backup.sql > restore.sql
pnpm exec wrangler d1 create jungle5-restore
pnpm exec wrangler d1 execute jungle5-restore --remote --file=restore.sql
```

확인할 것:

- 테이블별 행 수가 맞다.
- `PRAGMA foreign_key_check` 결과가 비어 있다.
- `d1_migrations`가 저장소의 `migrations/`와 같다.

확인이 끝나면 `wrangler.jsonc`의 `database_id`를 새 DB로 바꿔 배포한다.
