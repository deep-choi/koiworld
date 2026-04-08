# Supabase Setup

이 문서는 현재 코드베이스의 Supabase 전환 상태와 남은 설정 작업을 정리합니다.

## 현재 코드 반영 상태

이미 Supabase 기준으로 연결된 영역:

- 인증: `services/auth.ts`, `contexts/AuthContext.tsx`
- 저장/프로필/세션/AP: `services/sync.ts`, `services/profile.ts`, `services/session.ts`, `services/points.ts`
- 장터: `services/marketplace.ts`
- 랭킹/업적 호환 어댑터: `services/cloudData.ts`
- 공통 클라이언트/Realtime/RPC 래퍼: `services/supabase.ts`

## 핵심 설계

- 인증: Supabase Auth + Google OAuth
- 게임 저장: `game_states.state_json`에 `SavedGameState`를 `jsonb`로 저장
- 경제/장터: 별도 테이블 + RPC
- 코이 수령: `pending_koi_claims`
- 랭킹: `profiles + game_states`

## SQL에 포함된 항목

- 테이블
  - `profiles`
  - `game_states`
  - `marketplace_listings`
  - `marketplace_bids`
  - `pending_koi_claims`
  - `ap_ledger`
  - `ad_reward_claims`
- RPC / 함수
  - `upsert_profile_context`
  - `sync_game_state`
  - `set_client_ap_balance`
  - `create_listing`
  - `place_bid`
  - `buy_now`
  - `cancel_listing`
  - `claim_ad_reward`
  - `claim_pending_kois`
  - `reset_game_data`
  - `get_rankings`
  - `expire_auctions`
- 보안
  - RLS 기본 정책
  - 장터/경제 로직의 직접 쓰기 최소화
  - `authenticated` 대상 함수 실행 권한

## 남은 필수 설정

1. Supabase 대시보드에서 Google OAuth provider 설정
2. SQL Editor 또는 migration으로 `supabase/migrations/20260408_000001_initial_schema.sql` 적용
3. 앱에서 실제 로그인, 저장, 장터, 코이 수령 흐름 수동 검증

## 현재 리스크

- `set_client_ap_balance`는 전환용 브리지입니다. 장기적으로는 클라이언트가 AP 잔액을 직접 맞추지 않도록 제거하는 편이 맞습니다.
- Supabase SQL을 실제 프로젝트에 적용하지 않으면 런타임에서 RPC/테이블 조회가 실패합니다.

## 다음 추천 작업

1. Supabase SQL 적용
2. Google OAuth 설정
3. `docs/supabase-manual-test-checklist.md` 기준으로 수동 테스트
4. 운영 확인 후 임시 브리지 RPC 정리

## 참고

- OAuth: https://supabase.com/docs/guides/auth/social-login
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Database Functions: https://supabase.com/docs/guides/database/functions
- Realtime: https://supabase.com/docs/guides/realtime
