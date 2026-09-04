# LAKE 영어회화연습

기본 상황극·200일 코스·단어 카드는 AI 연결 없이 사용할 수 있습니다. Gemini AI 상황극은 운영자가 서버에 설정한 Gemini 키로 동작하며, 초대받은 사용자는 자기 계정으로 가입·로그인해 진행 상황과 보상 신청을 이어갑니다.

## 실행

Node.js 22 이상이 설치된 PC에서 **Start-English.cmd**를 실행한 뒤 `http://127.0.0.1:4173`을 엽니다. 또는 프로젝트 폴더에서 다음을 실행합니다.

```sh
npm start
```

설치할 npm 패키지는 없습니다. 로컬 서버는 이 PC의 127.0.0.1에서만 접근할 수 있습니다. 브라우저 마이크는 지원되는 Chrome/Edge에서 이용하고, 지원되지 않으면 텍스트로 답변합니다.

## Gemini와 계정 설정

운영자는 Gemini 키를 서버 환경변수나 Cloudflare Worker secret으로 한 번만 설정합니다.

```sh
GEMINI_API_KEY=...
npm start
```

Worker 배포에서는 Supabase 연결값과 함께 `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`를 Worker secret 또는 환경 설정으로 등록합니다. 학습자는 앱 화면에서 Gemini 키를 만들거나 입력하지 않습니다.

고정 모델은 `gemini-3.5-flash-lite`입니다. 무료 운영을 유지하려면 운영자가 결제가 연결되지 않은 무료 Gemini 사용량 안에서 키를 관리해야 합니다. 모델 이용 가능 여부와 무료 사용량은 계정·지역·Google 정책에 따라 달라질 수 있습니다. 모델이 제공되지 않거나 한도 오류가 발생하면 자동 대체나 유료 전환 없이 기본 상황극으로 계속 연습합니다.

초대받은 학습자는 홈의 계정 패널에서 이름, 이메일, 비밀번호, 초대코드로 가입하거나 기존 계정으로 로그인합니다. 로컬 QA 서버는 Supabase 없이 동작하는 메모리 기반 mock 계정을 제공하며, 실제 배포에서는 Worker가 Supabase Auth와 연결됩니다.

## 대화와 복습

- 초급/중급 선택, 최대 6번의 학습자 답변. 대화 도중에는 정답 판정으로 끊지 않습니다.
- 음성 입력 또는 텍스트 전송 → Gemini의 문맥 기반 답변 → 브라우저 읽어주기.
- **답변 후 자동으로 듣기**는 사용자가 켰을 때만 동작합니다. 자동 듣기가 멈추면 다시 눌러 말하거나 입력합니다.
- 한국어 해석·예문 힌트는 필요할 때 펼칩니다. 다시 듣기·천천히 듣기를 제공합니다.
- 대화 종료 후 실제로 말한 문장에 근거한 최대 3개 교정과 다음 연습 표현을 제공합니다. 음성인식 결과로 발음 점수를 만들지 않습니다.
- 복습 후 **이 표현으로 다시 대화하기**를 선택해 같은 상황에서 다시 사용합니다.
- 복습 노트는 이 브라우저에 최근 20회만 저장됩니다. 전체 대화와 Gemini 키는 브라우저 저장소에 저장하지 않습니다. 복습 노트에는 내 문장 일부가 남습니다. **기록 지우기**로 삭제할 수 있습니다.
- 3회 이상 답변하고 복습까지 마친 대화에 8 XP를 한 번 지급합니다. 기존 기본 상황극의 보상과 구분됩니다.

## 개인정보와 연결

Gemini 키는 운영자가 서버 또는 Worker secret으로만 보관합니다. 상태 응답·브라우저 저장소·학습자 화면에 Gemini 키를 반환하지 않습니다. 대화 요청은 서버 또는 Worker가 Google Gemini API로 보내며, 학습자는 앱 계정으로만 인증합니다. 실제 예약번호·여권번호 등 개인정보를 대화에 넣지 마세요.

이 구현은 **브라우저 음성인식 + 텍스트 기반 Gemini API + 브라우저 음성합성**입니다. 통화형 원음 스트리밍이나 Gemini Live API 구현은 아닙니다. 음성 품질과 인식 지원은 브라우저/운영체제에 따라 달라집니다. 영어 음성은 홈의 음성 설정에서 고를 수 있습니다.

## 무료 클라우드 배포 가이드 (운영자용)

약 10명 규모의 초대제 서비스를 유료 결제 없이 운영하는 절차입니다. `.env.example`을 참고해 실제 값은 커밋하지 말고 각 플랫폼의 secret 저장소에만 넣습니다.

1. **Supabase 무료 프로젝트 생성**: [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다. 결제 수단은 연결하지 않습니다.
2. **마이그레이션 적용**: Supabase SQL Editor 또는 CLI로 `supabase/migrations/0001_multi_user_rewards.sql`을 실행해 테이블·RLS·RPC(`record_activity`, `claim_reward`, `reserve_invite`, `release_invite`, `reserve_ai_usage`, `import_local_progress`)와 기본 보상 3종을 만듭니다.
3. **첫 관리자 계정 생성**: Supabase Auth에서 운영자 이메일로 계정을 만든 뒤, `profiles` 테이블에서 해당 `user_id`의 `role`을 `admin`으로 직접 수정합니다(최초 1회는 SQL Editor로 처리).
4. **초대코드 발급**: 관리자 계정으로 로그인해 앱의 관리자 화면(`/api/admin/invites`)에서 초대코드를 만듭니다. 평문 코드는 생성 시 한 번만 표시되므로 안전하게 전달합니다.
5. **Cloudflare Pages/Worker 프로젝트 생성**: 정적 프런트엔드는 Cloudflare Pages에, `worker/src/index.js`는 Cloudflare Worker로 배포합니다. `worker/wrangler.toml.example`을 `wrangler.toml`로 복사해 프로젝트 이름을 정합니다.
6. **Worker secret 등록**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`를 `wrangler secret put <이름>`으로 등록합니다. 코드나 저장소에 실제 값을 남기지 않습니다.
7. **일일 AI 사용량 한도 설정**: `wrangler.toml`의 `[vars]`에서 `AI_DAILY_USER_LIMIT`(사용자별 하루 요청 수), `AI_DAILY_GLOBAL_LIMIT`(전체 하루 요청 수)을 무료 한도 안에서 설정합니다.
8. **결제 수단 미연결 유지**: Supabase, Cloudflare, Google AI Studio 어느 쪽에도 결제 수단을 등록하지 않는 한 무료 운영이 유지됩니다. 등록하면 이 가이드의 무료 전제가 깨집니다.
9. **보상은 수동 처리**: 리워드 신청은 자동 발송되지 않습니다. 운영자가 관리자 화면에서 신청 목록을 확인해 실제 쿠폰/상품을 전달한 뒤 상태를 `approved`/`delivered`로 갱신합니다.
10. **기존 로컬 기록 이전**: 이전 버전을 로컬로 쓰던 사용자가 로그인하면 홈 화면 계정 패널에 기존 학습 기록 가져오기 카드가 한 번 표시됩니다. 가져오기는 계정당 한 번만 가능합니다.

## 검증

```sh
npm test
```

Node 내장 테스트로 요청 경계, 서버 보관 키 사용, 한도 차단, 계정·초대·보상 흐름, 대화 맥락, 취소/중복 전송과 저장을 검증합니다. 테스트 응답을 주입하므로 외부 API를 호출하지 않습니다. 실제 Gemini 품질과 마이크 인식은 운영자 키와 해당 기기에서 확인해야 합니다.
