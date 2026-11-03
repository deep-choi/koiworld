/// <reference types="vite/client" />
// 로컬 전용 "결제·광고 미리보기" 모드 스위치입니다. 켜고 끄는 곳은 이 파일 한 곳뿐입니다.
//
// ● `npm run dev:mock`(= vite --mode monetization-mock)으로 띄운 개발 서버에서만 켜집니다.
// ● `vite build`는 DEV를 false로 바꾸므로 배포 빌드에서는 항상 false이고, 미리보기 코드는 빌드에서 빠집니다.
//   (npm run build 끝에 scripts/check-production-build.cjs가 빌드 결과에 미리보기 문구가 없는지 확인합니다.)
// ● .env 파일로 켜지 않습니다. 모드 이름은 명령줄에서만 정해집니다.
//
// 미리보기 모드에서는 Firebase에 쓰지 않고, Cloud Functions와 통계를 부르지 않으며, 로그인을 막고
// 이 기기의 별도 저장 칸(monetization-mock)만 씁니다. 실제 게스트 저장과 계정은 건드리지 않습니다.
export const isMonetizationMock: boolean = import.meta.env.DEV && import.meta.env.MODE === 'monetization-mock';

/** 미리보기 모드의 기기 저장 범위 이름. 실제 게스트·계정 저장 키와 겹치지 않습니다. */
export const MONETIZATION_MOCK_SCOPE = 'monetization-mock';
