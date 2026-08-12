# Koiworld

Koiworld는 평화로운 연못에서 코이를 키우고, 교배하고, 희귀한 유전 조합을 수집하는 캐주얼 육성 게임입니다.

## 현재 게임 기능

- 코이 성장: 치어(`fry`) → juvenile → 성체(`adult`)
- 먹이 주기: 기본 사료와 프리미엄 옥수수 사용
- 교배: 성체 코이 2마리로 2~5마리의 자손 생성
- 유전: 기본 색상, 숨은 색상 유전자, 점, 점 색상, 점 표현형, 명도, 채도
- 경제: 코이 판매, 사료 구매, 연못 확장, 명예 트로피 구매
- 연못 관리: 수질 감소, ZP를 사용한 청소, 무료 테마 변경
- 업적: 점·색상·명도·채도·유전 조합 기반 업적과 옥수수 보상
- 랭킹: 업적 점수 랭킹과 명예 트로피 랭킹
- 계정: 웹 Google/이메일 인증, Android Play Games 자동 로그인 시도, 익명 fallback
- 저장: 브라우저 로컬 저장과 로그인 사용자 Firestore 클라우드 저장

## 먹이 규칙

인벤토리의 먹이 1개를 사용하면 연못에 펠릿 3개가 생성됩니다.

- 기본 사료: 펠릿마다 성장 수치 `+1`
- 옥수수: 펠릿마다 성장 수치 `+3`
- 코이 한 마리의 성장에는 총 30 성장 수치가 필요합니다.

옥수수는 기본 사료보다 2배의 성장 효과를 제공합니다. 기준 코드는 `App.tsx`의 `CORN_FEED_AMOUNT`입니다.

## 플랫폼과 기술 스택

- 웹: React 19, TypeScript, Vite, PWA
- Android: Capacitor Android 래퍼. 게임 로직은 웹 TypeScript 번들을 사용합니다.
- 인증/데이터: Firebase Authentication, Firestore
- 호스팅: Firebase Hosting
- 렌더링: Canvas 기반 `GameEngine`과 `KoiRenderer`
- 스타일: `index.html`의 Tailwind CDN과 프로젝트 CSS

## 실행

```bash
npm install
npm run dev
```

개발 서버는 Vite 설정에 따라 기본적으로 `4000` 포트를 사용합니다.

## 빌드와 Android 실행

```bash
npm run build
npm run preview

# 웹 빌드 후 Capacitor 동기화
npm run cap:sync

# Android Studio 열기 또는 연결된 기기 실행
npm run cap:open
npm run cap:run
```

Android release 서명은 저장소 외부의 업로드 키와 환경 변수 설정을 사용합니다. 키 파일과 비밀번호를 저장소에 커밋하지 마세요.

## 웹 배포

```bash
npm run build
firebase deploy --only hosting --project koi-garden-abcf5
```

`firebase.json`의 Hosting `public` 디렉터리는 `dist`입니다. 운영 배포 전에는 실제 도메인과 Firebase Hosting 사이트가 일치하는지 확인해야 합니다.

## 문서

- [에이전트용 게임·구조 가이드](./docs/에이전트-게임-구조-가이드.md)
- [프로젝트 개요](./docs/프로젝트-개요.md)
- [아키텍처](./docs/아키텍처.md)
- [프론트엔드 모듈 분석](./docs/프론트엔드-모듈-분석.md)
- [백엔드·데이터·클라우드 분석](./docs/백엔드-데이터-클라우드-분석.md)
- [빌드·배포·환경 설정](./docs/빌드-배포-환경-설정.md)
- [소스 인벤토리](./docs/소스-인벤토리.md)

문서와 코드가 다르면 현재 코드를 우선합니다. 과거 원본 문서는 현재 작업 기준에서 제외했으며, 필요하면 Git 기록에서 확인합니다.
