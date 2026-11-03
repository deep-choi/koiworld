import React, { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import type { User as FirebaseUser } from 'firebase/auth';
import { AppUser, subscribeToAuthChanges, loginWithGoogle, loginWithPlayGames, loginAsGuest, logout, checkRedirectResult, initializeAndroidSession, loginWithEmailPassword, signUpWithEmailPassword, deleteCurrentUser, reauthenticateCurrentUser } from '../services/auth';
import { deleteUserData } from '../services/cloudData';
import { trackEvent } from '../services/analytics';
import { MONETIZATION_MOCK_SCOPE, isMonetizationMock } from '../config/monetizationMock';

interface AuthContextType {
    user: AppUser | null;
    loading: boolean;
    authIssue: string | null;
    clearAuthIssue: () => void;
    login: () => Promise<void>;
    loginWithPlayGames: () => Promise<void>;
    continueAsGuest: () => Promise<void>;
    loginWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string, nickname: string) => Promise<void>;
    logout: () => Promise<void>;
    deleteAccount: (password?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** 로컬 미리보기에서 로그인 버튼을 눌렀을 때 보여 줄 이유 */
export const MONETIZATION_MOCK_LOGIN_MESSAGE = '미리보기 모드에서는 로그인을 막아 두었어요. 실제 계정과 클라우드 저장을 건드리지 않고, 이 브라우저의 미리보기 저장만 써요.';

/**
 * 로컬 미리보기(npm run dev:mock) 전용. Firebase 인증을 전혀 부르지 않고 항상 미리보기 게스트로 시작합니다.
 * 익명 계정도 만들지 않으며(실제 Firebase 프로젝트에 기록이 남지 않음), 로그인 함수는 모두 이유와 함께 거절합니다.
 */
const MonetizationMockAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const value = useMemo<AuthContextType>(() => {
        const blocked = async () => { throw new Error(MONETIZATION_MOCK_LOGIN_MESSAGE); };
        return {
            user: {
                uid: MONETIZATION_MOCK_SCOPE,
                email: null,
                displayName: '미리보기 게스트',
                photoURL: null,
                isAnonymous: true,
                providerIds: [],
                providerLabel: '미리보기',
                authSource: 'anonymous',
                authSourceLabel: '미리보기',
                rawUser: null as unknown as FirebaseUser,
            },
            loading: false,
            authIssue: null,
            clearAuthIssue: () => undefined,
            login: blocked,
            loginWithPlayGames: blocked,
            continueAsGuest: blocked,
            loginWithEmail: blocked,
            signUpWithEmail: blocked,
            logout: blocked,
            deleteAccount: blocked,
        };
    }, []);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const FirebaseAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [authIssue, setAuthIssue] = useState<string | null>(null);
    const isBootstrappingNativeSession = useRef(Capacitor.getPlatform() === 'android');

    useEffect(() => {
        let isMounted = true;

        const hideNativeSplash = async () => {
            if (Capacitor.getPlatform() !== 'android') return;

            try {
                await SplashScreen.hide({ fadeOutDuration: 150 });
            } catch (error) {
                // The web build and older native installs may not have a
                // controllable splash plugin yet. Auth startup must still
                // complete in that case.
                console.warn('[Auth] Native splash hide failed.', error);
            }
        };

        const bootstrapAuth = async () => {
            let restoredUser: AppUser | null = null;

            try {
                // Firebase's redirect result is a Web SDK flow. Do not let an
                // unsupported redirect check on Android prevent the native Play
                // Games session from being initialized below.
                if (!Capacitor.isNativePlatform()) {
                    try {
                        restoredUser = await checkRedirectResult();
                        if (isMounted && restoredUser) {
                            setUser(restoredUser);
                        }
                    } catch (error) {
                        console.error("Web auth redirect restore failed:", error);
                    }
                }

                const shouldAttemptAndroidPlayGames =
                    Capacitor.getPlatform() === 'android' &&
                    (!restoredUser || restoredUser.isAnonymous);

                if (shouldAttemptAndroidPlayGames) {
                    try {
                        const nativeUser = await initializeAndroidSession();
                        if (isMounted && nativeUser) {
                            setAuthIssue(null);
                            setUser(nativeUser);
                        }
                    } catch (error) {
                        console.error("Android Play Games bootstrap failed:", error);
                        if (isMounted) {
                            setUser(null);
                            setAuthIssue(error instanceof Error
                                ? error.message
                                : 'Play Games 저장 계정을 확인하지 못했습니다. 다시 로그인해주세요.');
                        }
                    }
                }
            } finally {
                if (isMounted) {
                    isBootstrappingNativeSession.current = false;
                    setLoading(false);
                    await hideNativeSplash();
                }
            }
        };

        // 리다이렉트 결과 확인 (모바일 웹 로그인 에러 처리용)
        void bootstrapAuth();

        const unsubscribe = subscribeToAuthChanges((currentUser) => {
            if (!isMounted) return;
            setUser(currentUser);
            if (currentUser && !currentUser.isAnonymous) {
                setAuthIssue(null);
            }
            if (!isBootstrappingNativeSession.current) {
                setLoading(false);
            }
        });

        return () => {
            isMounted = false;
            unsubscribe();
        };
    }, []);

    const handleLogin = async () => {
        try {
            setAuthIssue(null);
            await loginWithGoogle();
            trackEvent('login', { method: 'google' });
        } catch (error) {
            // 에러 처리는 UI에서 하거나 여기서 토스트 메시지 등을 띄울 수 있음
            console.error("Login failed context:", error);
            throw error;
        }
    };

    const handlePlayGamesLogin = async () => {
        try {
            setAuthIssue(null);
            const signedInUser = await loginWithPlayGames();
            if (signedInUser) setUser(signedInUser);
            trackEvent('login', { method: 'play_games' });
        } catch (error) {
            console.error('Play Games login failed context:', error);
            setAuthIssue(error instanceof Error ? error.message : 'Play Games 로그인에 실패했습니다.');
            throw error;
        }
    };

    const handleEmailLogin = async (email: string, password: string) => {
        try {
            const signedInUser = await loginWithEmailPassword(email, password);
            if (signedInUser) setUser(signedInUser);
            trackEvent('login', { method: 'email' });
        } catch (error) {
            console.error("Email login failed context:", error);
            throw error;
        }
    };

    const handleGuestLogin = async () => {
        try {
            await loginAsGuest();
            trackEvent('login', { method: 'guest' });
        } catch (error) {
            console.error('Guest login failed context:', error);
            throw error;
        }
    };

    const handleEmailSignUp = async (email: string, password: string, nickname: string) => {
        try {
            const createdUser = await signUpWithEmailPassword(email, password, nickname);
            if (createdUser) setUser(createdUser);
            trackEvent('sign_up', { method: 'email' });
        } catch (error) {
            console.error("Email sign up failed context:", error);
            throw error;
        }
    };

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error("Logout failed context:", error);
            throw error;
        }
    };

    const handleDeleteAccount = async (password?: string) => {
        if (!user) {
            throw new Error('삭제할 로그인 계정을 찾을 수 없습니다.');
        }

        try {
            await reauthenticateCurrentUser(password);
            await deleteUserData(user.uid);
            await deleteCurrentUser();
        } catch (error) {
            console.error('Account deletion failed context:', error);
            throw error;
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, authIssue, clearAuthIssue: () => setAuthIssue(null), login: handleLogin, loginWithPlayGames: handlePlayGamesLogin, continueAsGuest: handleGuestLogin, loginWithEmail: handleEmailLogin, signUpWithEmail: handleEmailSignUp, logout: handleLogout, deleteAccount: handleDeleteAccount }}>
            {children}
        </AuthContext.Provider>
    );
};

/** 배포 빌드에서는 isMonetizationMock이 항상 false라 미리보기용 공급자는 빌드에서 빠집니다. */
export const AuthProvider: React.FC<{ children: ReactNode }> = isMonetizationMock ? MonetizationMockAuthProvider : FirebaseAuthProvider;

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
