import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { AppUser, subscribeToAuthChanges, loginWithGoogle, loginWithPlayGames, loginAsGuest, logout, checkRedirectResult, initializeAndroidSession, loginWithEmailPassword, signUpWithEmailPassword, deleteCurrentUser, reauthenticateCurrentUser } from '../services/auth';
import { deleteUserData } from '../services/cloudData';

interface AuthContextType {
    user: AppUser | null;
    loading: boolean;
    login: () => Promise<void>;
    loginWithPlayGames: () => Promise<void>;
    continueAsGuest: () => Promise<void>;
    loginWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string, nickname: string) => Promise<void>;
    logout: () => Promise<void>;
    deleteAccount: (password?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);
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
                            setUser(nativeUser);
                        }
                    } catch (error) {
                        // initializeAndroidSession already falls back to an
                        // anonymous Firebase session. Keep this guard so a native
                        // plugin error cannot leave the AuthProvider loading
                        // forever or skip the rest of app startup.
                        console.error("Android Play Games bootstrap failed:", error);
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
            await loginWithGoogle();
        } catch (error) {
            // 에러 처리는 UI에서 하거나 여기서 토스트 메시지 등을 띄울 수 있음
            console.error("Login failed context:", error);
            throw error;
        }
    };

    const handlePlayGamesLogin = async () => {
        try {
            const signedInUser = await loginWithPlayGames();
            if (signedInUser) setUser(signedInUser);
        } catch (error) {
            console.error('Play Games login failed context:', error);
            throw error;
        }
    };

    const handleEmailLogin = async (email: string, password: string) => {
        try {
            const signedInUser = await loginWithEmailPassword(email, password);
            if (signedInUser) setUser(signedInUser);
        } catch (error) {
            console.error("Email login failed context:", error);
            throw error;
        }
    };

    const handleGuestLogin = async () => {
        try {
            await loginAsGuest();
        } catch (error) {
            console.error('Guest login failed context:', error);
            throw error;
        }
    };

    const handleEmailSignUp = async (email: string, password: string, nickname: string) => {
        try {
            const createdUser = await signUpWithEmailPassword(email, password, nickname);
            if (createdUser) setUser(createdUser);
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
        <AuthContext.Provider value={{ user, loading, login: handleLogin, loginWithPlayGames: handlePlayGamesLogin, continueAsGuest: handleGuestLogin, loginWithEmail: handleEmailLogin, signUpWithEmail: handleEmailSignUp, logout: handleLogout, deleteAccount: handleDeleteAccount }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
