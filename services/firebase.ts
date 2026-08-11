import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

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
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'asia-northeast1');

auth.languageCode = 'ko';

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account',
});
