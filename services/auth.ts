import {
    User as FirebaseUser,
    createUserWithEmailAndPassword,
    getRedirectResult,
    linkWithCredential,
    onAuthStateChanged,
    OAuthProvider,
    GoogleAuthProvider as FirebaseGoogleAuthProvider,
    signInAnonymously,
    signInWithEmailAndPassword,
    signInWithCredential,
    signInWithPopup,
    signInWithRedirect,
    signOut as signOutFromFirebase,
    updateProfile,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, googleProvider } from './firebase';

export type AuthSource = 'anonymous' | 'playgames' | 'google' | 'email' | 'phone' | 'unknown';

export interface AppUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    isAnonymous: boolean;
    providerIds: string[];
    providerLabel: string;
    authSource: AuthSource;
    authSourceLabel: string;
    rawUser: FirebaseUser;
}

const AUTH_PROVIDER_LABELS: Record<string, string> = {
    'playgames.google.com': 'Play Games',
    'google.com': 'Google',
    password: '이메일',
    phone: '전화번호',
};
const AUTH_SOURCE_STORAGE_KEY = 'koiworld.authSource';

const readAuthSource = (): AuthSource | null => {
    if (typeof window === 'undefined') return null;
    const value = window.localStorage.getItem(AUTH_SOURCE_STORAGE_KEY);
    return value === 'anonymous' || value === 'playgames' || value === 'google' || value === 'email' || value === 'phone'
        ? value
        : null;
};

const rememberAuthSource = (source: AuthSource) => {
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(AUTH_SOURCE_STORAGE_KEY, source);
    }
};

const clearAuthSource = () => {
    if (typeof window !== 'undefined') {
        window.localStorage.removeItem(AUTH_SOURCE_STORAGE_KEY);
    }
};

const getProviderInfo = (user: FirebaseUser) => {
    const providerIds = Array.from(new Set(user.providerData.map(provider => provider.providerId)));

    if (user.isAnonymous || providerIds.length === 0) {
        return { providerIds, providerLabel: '게스트 (익명)' };
    }

    return {
        providerIds,
        providerLabel: providerIds
            .map(providerId => AUTH_PROVIDER_LABELS[providerId] ?? providerId)
            .join(' · '),
    };
};

const getAuthSource = (user: FirebaseUser, providerIds: string[]): AuthSource => {
    if (user.isAnonymous || providerIds.length === 0) return 'anonymous';

    const rememberedSource = readAuthSource();
    if (rememberedSource === 'playgames' && providerIds.includes('google.com')) return 'playgames';
    if (rememberedSource === 'google' && providerIds.includes('google.com')) return 'google';
    if (providerIds.includes('password')) return 'email';
    if (providerIds.includes('phone')) return 'phone';
    if (providerIds.includes('google.com')) return 'google';
    return 'unknown';
};

const getAuthSourceLabel = (source: AuthSource, providerLabel: string) => {
    if (source === 'playgames') return '플레이 게임즈';
    if (source === 'anonymous') return '게스트';
    if (source === 'google') return '구글';
    if (source === 'email') return '이메일';
    if (source === 'phone') return '전화번호';
    return providerLabel || '알 수 없음';
};

const logFirebaseAuthState = (stage: string, user: FirebaseUser | null) => {
    const providerInfo = user ? getProviderInfo(user) : null;
    console.info(`[Auth] ${stage} ${JSON.stringify({
        uid: user?.uid ?? null,
        isAnonymous: user?.isAnonymous ?? null,
        providerIds: providerInfo?.providerIds ?? [],
        providerLabel: providerInfo?.providerLabel ?? '로그아웃 상태',
    })}`);
};

const toAppUser = (user: FirebaseUser | null): AppUser | null => {
    if (!user) {
        return null;
    }

    const displayName =
        user.displayName?.trim() ||
        (typeof user.email === 'string' ? user.email.split('@')[0] : null) ||
        null;
    const providerInfo = getProviderInfo(user);
    const authSource = getAuthSource(user, providerInfo.providerIds);

    return {
        uid: user.uid,
        email: user.email ?? null,
        displayName,
        photoURL: user.photoURL ?? null,
        isAnonymous: user.isAnonymous,
        ...providerInfo,
        authSource,
        authSourceLabel: getAuthSourceLabel(authSource, providerInfo.providerLabel),
        rawUser: user,
    };
};

const PLAY_GAMES_PROVIDER_ID = 'playgames.google.com';

const sanitizeErrorMessage = (message: string) => message
    .replace(/([?&](?:id_token|access_token|server_auth_code)=)[^&\s)]+/gi, '$1[redacted]')
    .replace(/(\b(?:idToken|accessToken|serverAuthCode)\s*[:=]\s*["']?)[^,\s}"']+/gi, '$1[redacted]');

export const checkRedirectResult = async (): Promise<AppUser | null> => {
    try {
        const result = await getRedirectResult(auth);
        return toAppUser(result?.user ?? auth.currentUser);
    } catch (error) {
        console.error("Auth Redirect Error:", error);
        throw error;
    }
};

export const loginWithGoogle = async (): Promise<void> => {
    try {
        if (Capacitor.isNativePlatform()) {
            const result = await FirebaseAuthentication.signInWithGoogle({
                skipNativeAuth: true,
            });
            const idToken = result.credential?.idToken;
            const accessToken = result.credential?.accessToken;

            if (!idToken && !accessToken) {
                throw new Error('Google 로그인 자격 증명을 받지 못했습니다.');
            }

            const credential = FirebaseGoogleAuthProvider.credential(
                idToken ?? undefined,
                accessToken ?? undefined,
            );
            await signInWithCredential(auth, credential);
            rememberAuthSource('google');
            return;
        }

        await signInWithPopup(auth, googleProvider);
        rememberAuthSource('google');
    } catch (error) {
        console.error("Google Login Error:", error);
        const code = typeof error === 'object' && error && 'code' in error
            ? String((error as { code?: string }).code)
            : '';

        if (
            code === 'auth/popup-blocked' ||
            code === 'auth/cancelled-popup-request' ||
            code === 'auth/operation-not-supported-in-this-environment' ||
            code === 'auth/web-storage-unsupported'
        ) {
            await signInWithRedirect(auth, googleProvider);
            return;
        }

        throw error;
    }
};

/**
 * Signs into Firebase with the Play Games credential returned by the native
 * Capacitor plugin. If the current Firebase user is anonymous, link first so
 * the player's existing game data remains attached to the same UID.
 */
export const initializeAndroidSession = async (): Promise<AppUser | null> => {
    if (Capacitor.getPlatform() !== 'android') {
        return toAppUser(auth.currentUser);
    }

    try {
        // Wait until Firebase restores the locally persisted anonymous user
        // before linking the Play Games credential. Without this, the native
        // flow can finish first and create a new UID instead of preserving the
        // player's existing guest data.
        await auth.authStateReady();

        const playGamesResult = await FirebaseAuthentication.signInWithPlayGames({
            skipNativeAuth: true,
        });

        console.info(`[Auth] Play Games native credential result ${JSON.stringify({
            nativeUserReturned: Boolean(playGamesResult.user),
            providerId: playGamesResult.credential?.providerId ?? null,
            hasServerAuthCode: Boolean(playGamesResult.credential?.serverAuthCode),
            hasIdToken: Boolean(playGamesResult.credential?.idToken),
            hasAccessToken: Boolean(playGamesResult.credential?.accessToken),
        })}`);

        const idToken = playGamesResult.credential?.idToken;
        const accessToken = playGamesResult.credential?.accessToken;

        if (!idToken && !accessToken) {
            throw new Error(
                playGamesResult.credential?.serverAuthCode
                    ? 'Play Games가 serverAuthCode만 반환했습니다. JS Firebase 인증 연결 방식 확인이 필요합니다.'
                    : 'Play Games Firebase 자격 증명을 받지 못했습니다.',
            );
        }

        // The native Play Games flow returns a Google ID token for the web
        // client. Firebase JS can validate that token through GoogleAuthProvider,
        // while OAuthProvider('playgames.google.com') builds an unsupported
        // localhost redirect credential in the web SDK.
        const firebaseCredential = idToken
            ? FirebaseGoogleAuthProvider.credential(idToken, accessToken ?? undefined)
            : new OAuthProvider(PLAY_GAMES_PROVIDER_ID).credential({ accessToken });
        const currentUser = auth.currentUser;

        if (currentUser?.isAnonymous) {
            try {
                const linkedResult = await linkWithCredential(currentUser, firebaseCredential);
                rememberAuthSource('playgames');
                logFirebaseAuthState('Play Games 계정 연결 완료', linkedResult.user);
                return toAppUser(linkedResult.user);
            } catch (error) {
                const code = typeof error === 'object' && error && 'code' in error
                    ? String((error as { code?: string }).code)
                    : '';

                if (code !== 'auth/credential-already-in-use') {
                    throw error;
                }
            }
        }

        const signedInResult = await signInWithCredential(auth, firebaseCredential);
        rememberAuthSource('playgames');
        logFirebaseAuthState('Play Games Firebase 로그인 완료', signedInResult.user);
        return toAppUser(signedInResult.user);
    } catch (error) {
        // Play Games may be unavailable on a device or not yet configured for
        // the tester. Firebase anonymous auth still lets the user play.
        const errorDetails = {
            code: typeof error === 'object' && error && 'code' in error
                ? String((error as { code?: string }).code ?? '')
                : '',
            message: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
        };
        console.warn(
            `[Auth] Play Games automatic sign-in failed; anonymous fallback may be used. ${JSON.stringify(errorDetails)}`,
        );
    }

    if (!auth.currentUser) {
        const result = await signInAnonymously(auth);
        rememberAuthSource('anonymous');
        logFirebaseAuthState('익명 로그인 fallback 완료', result.user);
        return toAppUser(result.user);
    }

    logFirebaseAuthState('기존 Firebase 사용자 유지', auth.currentUser);
    return toAppUser(auth.currentUser);
};

export const loginWithEmailPassword = async (email: string, password: string): Promise<AppUser | null> => {
    try {
        const result = await signInWithEmailAndPassword(auth, email.trim(), password);
        rememberAuthSource('email');
        return toAppUser(result.user);
    } catch (error) {
        console.error("Email Login Error:", error);
        throw error;
    }
};

export const signUpWithEmailPassword = async (
    email: string,
    password: string,
    nickname: string,
): Promise<AppUser | null> => {
    try {
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
        rememberAuthSource('email');
        const displayName = nickname.trim();

        if (displayName) {
            await updateProfile(result.user, { displayName });
        }

        return toAppUser(auth.currentUser ?? result.user);
    } catch (error) {
        console.error("Email Sign Up Error:", error);
        throw error;
    }
};

export const logout = async (): Promise<void> => {
    try {
        await signOutFromFirebase(auth);
        clearAuthSource();
    } catch (error) {
        console.error("Logout Error:", error);
        throw error;
    }
};

export const subscribeToAuthChanges = (callback: (user: AppUser | null) => void) => {
    return onAuthStateChanged(auth, (user) => {
        logFirebaseAuthState('Firebase auth 상태 변경', user);
        callback(toAppUser(user));
    });
};
