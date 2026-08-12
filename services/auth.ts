import {
    User as FirebaseUser,
    createUserWithEmailAndPassword,
    EmailAuthProvider,
    deleteUser,
    getRedirectResult,
    onAuthStateChanged,
    GoogleAuthProvider as FirebaseGoogleAuthProvider,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    signInAnonymously,
    signInWithEmailAndPassword,
    signInWithCredential,
    signInWithCustomToken,
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
const GUEST_MODE_STORAGE_KEY = 'koiworld.guestMode';
const PLAY_GAMES_PROVIDER_ID = 'playgames.google.com';
const NATIVE_AUTH_EXCHANGE_URL = 'https://asia-northeast1-koi-garden-abcf5.cloudfunctions.net/exchangeNativeFirebaseToken';

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

const isGuestModeRequested = () => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(GUEST_MODE_STORAGE_KEY) === '1';
};

const rememberGuestMode = () => {
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(GUEST_MODE_STORAGE_KEY, '1');
    }
};

const clearGuestMode = () => {
    if (typeof window !== 'undefined') {
        window.localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
    }
};

const getProviderInfo = (user: FirebaseUser) => {
    const providerIds = Array.from(new Set(user.providerData.map(provider => provider.providerId)));

    if (user.isAnonymous) {
        return { providerIds, providerLabel: '게스트 (익명)' };
    }

    if (providerIds.length === 0) {
        return { providerIds, providerLabel: 'Firebase 인증 계정' };
    }

    return {
        providerIds,
        providerLabel: providerIds
            .map(providerId => AUTH_PROVIDER_LABELS[providerId] ?? providerId)
            .join(' · '),
    };
};

const getAuthSource = (user: FirebaseUser, providerIds: string[]): AuthSource => {
    if (user.isAnonymous) return 'anonymous';

    // Prefer the provider attached to the Firebase user. The local marker is
    // only needed for a web session created from a verified native Play Games
    // user via a custom token, because custom-token sessions do not expose the
    // original native provider in Firebase JS providerData.
    if (providerIds.includes(PLAY_GAMES_PROVIDER_ID)) return 'playgames';
    if (providerIds.includes('password')) return 'email';
    if (providerIds.includes('phone')) return 'phone';
    if (providerIds.includes('google.com')) return 'google';
    if ((providerIds.length === 0 || providerIds.includes('custom')) && readAuthSource() === 'playgames') return 'playgames';
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
            clearGuestMode();
            return;
        }

        await signInWithPopup(auth, googleProvider);
        rememberAuthSource('google');
        clearGuestMode();
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
            clearGuestMode();
            await signInWithRedirect(auth, googleProvider);
            return;
        }

        throw error;
    }
};

export const loginAsGuest = async (): Promise<AppUser | null> => {
    const result = await signInAnonymously(auth);
    rememberAuthSource('anonymous');
    rememberGuestMode();
    return toAppUser(result.user);
};

const signInWebWithNativePlayGames = async (): Promise<FirebaseUser> => {
    const nativeTokenResult = await FirebaseAuthentication.getIdToken({ forceRefresh: true });
    const nativeIdToken = nativeTokenResult.token;
    if (!nativeIdToken) {
        throw new Error('네이티브 Play Games Firebase ID Token을 받지 못했습니다.');
    }

    const response = await fetch(NATIVE_AUTH_EXCHANGE_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${nativeIdToken}`,
            'Content-Type': 'application/json',
        },
        body: '{}',
    });
    const payload = await response.json().catch(() => null) as { token?: string; uid?: string; error?: string } | null;
    if (!response.ok || !payload?.token) {
        throw new Error(payload?.error || `네이티브 Play Games 계정 연결에 실패했습니다. (${response.status})`);
    }

    const signedInResult = await signInWithCustomToken(auth, payload.token);
    if (!signedInResult.user || (payload.uid && signedInResult.user.uid !== payload.uid)) {
        throw new Error('Play Games Firebase UID 확인에 실패했습니다.');
    }
    clearGuestMode();
    return signedInResult.user;
};

/**
 * Restores the native Play Games identity and mirrors that verified Firebase
 * session into the JS SDK. Guest data intentionally remains on its own UID;
 * switching to Play Games must not merge the guest namespace into the account.
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

        if (isGuestModeRequested()) {
            const guestUser = auth.currentUser?.isAnonymous
                ? auth.currentUser
                : (await signInAnonymously(auth)).user;
            rememberAuthSource('anonymous');
            logFirebaseAuthState('게스트 모드 유지', guestUser);
            return toAppUser(guestUser);
        }

        // A deliberately selected Google/email session must remain that
        // account on restart. Play Games is automatic only when there is no
        // existing authenticated account to restore.
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            logFirebaseAuthState('기존 인증 계정 복원', auth.currentUser);
            return toAppUser(auth.currentUser);
        }

        const playGamesResult = await FirebaseAuthentication.signInWithPlayGames({
            // Play Games must be authenticated by the native Firebase SDK so
            // Firebase can keep the `playgames.google.com` provider identity.
            skipNativeAuth: false,
        });

        console.info(`[Auth] Play Games native credential result ${JSON.stringify({
            nativeUserReturned: Boolean(playGamesResult.user),
            providerId: playGamesResult.credential?.providerId ?? null,
            hasServerAuthCode: Boolean(playGamesResult.credential?.serverAuthCode),
            hasIdToken: Boolean(playGamesResult.credential?.idToken),
            hasAccessToken: Boolean(playGamesResult.credential?.accessToken),
        })}`);

        const nativeProviderIds = Array.from(new Set([
            ...(playGamesResult.user?.providerData?.map(provider => provider.providerId) ?? []),
            ...(playGamesResult.credential?.providerId ? [playGamesResult.credential.providerId] : []),
        ]));
        if (!nativeProviderIds.includes(PLAY_GAMES_PROVIDER_ID)) {
            throw new Error(`네이티브 인증 Provider가 Play Games가 아닙니다: ${nativeProviderIds.join(', ') || '없음'}`);
        }

        rememberAuthSource('playgames');
        const signedInUser = await signInWebWithNativePlayGames();
        logFirebaseAuthState('Play Games Firebase 로그인 완료', signedInUser);
        return toAppUser(signedInUser);
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
        clearGuestMode();
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
        clearGuestMode();
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
        if (Capacitor.isNativePlatform()) {
            await FirebaseAuthentication.signOut();
        }
        await signOutFromFirebase(auth);

        // Logging out means leaving the account, not leaving the game. Start a
        // fresh anonymous session so the app immediately returns to the local
        // namespace and does not reopen the auth modal with no active user.
        const guestResult = await signInAnonymously(auth);
        rememberAuthSource('anonymous');
        rememberGuestMode();
        logFirebaseAuthState('로그아웃 후 로컬 모드 전환', guestResult.user);
    } catch (error) {
        console.error("Logout Error:", error);
        throw error;
    }
};

export const deleteCurrentUser = async (): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('삭제할 로그인 계정을 찾을 수 없습니다.');
    }

    try {
        await deleteUser(currentUser);
        clearAuthSource();
    } catch (error) {
        console.error('Account deletion failed:', error);
        throw error;
    }
};

const createAuthError = (code: string, message: string) => {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
};

export const reauthenticateCurrentUser = async (password?: string): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('재인증할 로그인 계정을 찾을 수 없습니다.');
    }
    if (currentUser.isAnonymous) return;

    const providerIds = currentUser.providerData.map(provider => provider.providerId);
    if (providerIds.includes('password')) {
        if (!password || !currentUser.email) {
            throw createAuthError('auth/password-required', '계정 삭제를 위해 이메일 비밀번호가 필요합니다.');
        }
        await reauthenticateWithCredential(
            currentUser,
            EmailAuthProvider.credential(currentUser.email, password),
        );
        return;
    }

    if (Capacitor.getPlatform() === 'android') {
        const authSource = readAuthSource();
        if (authSource === 'playgames') {
            const nativeResult = await FirebaseAuthentication.signInWithPlayGames({ skipNativeAuth: false });
            const nativeProviderIds = Array.from(new Set([
                ...(nativeResult.user?.providerData?.map(provider => provider.providerId) ?? []),
                ...(nativeResult.credential?.providerId ? [nativeResult.credential.providerId] : []),
            ]));
            if (!nativeProviderIds.includes(PLAY_GAMES_PROVIDER_ID)) {
                throw createAuthError('auth/reauthentication-failed', 'Play Games Provider 재인증에 실패했습니다.');
            }
            const refreshedUser = await signInWebWithNativePlayGames();
            if (refreshedUser.uid !== currentUser.uid) {
                throw createAuthError('auth/user-mismatch', '재인증 계정이 현재 계정과 다릅니다.');
            }
            return;
        }

        const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
        const idToken = result.credential?.idToken;
        const accessToken = result.credential?.accessToken;
        if (!idToken && !accessToken) {
            throw createAuthError('auth/reauthentication-failed', '재인증 자격 증명을 받지 못했습니다.');
        }
        const credential = FirebaseGoogleAuthProvider.credential(idToken, accessToken ?? undefined);
        await reauthenticateWithCredential(currentUser, credential);
        return;
    }

    await reauthenticateWithPopup(currentUser, googleProvider);
};

export const subscribeToAuthChanges = (callback: (user: AppUser | null) => void) => {
    return onAuthStateChanged(auth, (user) => {
        logFirebaseAuthState('Firebase auth 상태 변경', user);
        callback(toAppUser(user));
    });
};
