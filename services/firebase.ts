import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, inMemoryPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { isMonetizationMock } from '../config/monetizationMock';

const firebaseConfig = {
    apiKey: 'AIzaSyARlVas7c57X0f3apFfJjztslnYjFD8OkQ',
    authDomain: 'koi-garden-abcf5.firebaseapp.com',
    projectId: 'koi-garden-abcf5',
    storageBucket: 'koi-garden-abcf5.firebasestorage.app',
    messagingSenderId: '1076557834310',
    appId: '1:1076557834310:web:599594d51ac0bc94b18247',
    measurementId: 'G-4H8VHR7FHS',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
// 로컬 미리보기(npm run dev:mock)에서는 이 브라우저에 남아 있는 실제 로그인을 불러오지 않습니다(메모리 전용 인증).
// 로그인된 사용자가 없으므로 Firestore 쓰기와 Cloud Functions 호출은 규칙과 서버에서도 모두 거절됩니다.
export const auth = isMonetizationMock
    ? initializeAuth(firebaseApp, { persistence: inMemoryPersistence })
    : getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'asia-northeast1');

auth.languageCode = 'ko';

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account',
});
