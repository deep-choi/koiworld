import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AppUser, subscribeToAuthChanges, loginWithGoogle, logout, checkRedirectResult } from '../services/auth';

interface AuthContextType {
    user: AppUser | null;
    loading: boolean;
    login: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        // 리다이렉트 결과 확인 (모바일 웹 로그인 에러 처리용)
        checkRedirectResult().then((restoredUser) => {
            if (!isMounted || !restoredUser) return;
            setUser(restoredUser);
        }).catch(error => {
            console.error("Auth Redirect Error:", error);
            // 필요하다면 여기서 에러 상태를 state에 저장해 알림 표시 가능
        });

        const unsubscribe = subscribeToAuthChanges((currentUser) => {
            if (!isMounted) return;
            setUser(currentUser);
            setLoading(false);
        });

        // 1.5s fallback: avoid blocking the UI forever if session restore is slow
        const timeoutId = setTimeout(() => {
            setLoading(prev => {
                if (prev) return false;
                return prev;
            });
        }, 1500);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
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

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error("Logout failed context:", error);
            throw error;
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login: handleLogin, logout: handleLogout }}>
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
