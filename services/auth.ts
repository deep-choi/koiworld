import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
    getCurrentSession,
    signInWithGoogle as signInWithSupabaseGoogle,
    signOut as signOutFromSupabase,
    subscribeToAuthChanges as subscribeToSupabaseAuthChanges,
} from './supabase';

export interface AppUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    rawUser: SupabaseUser;
}

const toAppUser = (user: SupabaseUser | null): AppUser | null => {
    if (!user) {
        return null;
    }

    const metadata = user.user_metadata ?? {};
    const displayName =
        (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
        (typeof metadata.name === 'string' && metadata.name.trim()) ||
        (typeof user.email === 'string' ? user.email.split('@')[0] : null) ||
        null;

    const photoURL =
        (typeof metadata.avatar_url === 'string' && metadata.avatar_url) ||
        (typeof metadata.picture === 'string' && metadata.picture) ||
        null;

    return {
        uid: user.id,
        email: user.email ?? null,
        displayName,
        photoURL,
        rawUser: user,
    };
};

// Supabase OAuth는 리다이렉트 후 세션에 복구되므로 현재 세션을 그대로 읽습니다.
export const checkRedirectResult = async (): Promise<AppUser | null> => {
    try {
        const session = await getCurrentSession();
        return toAppUser(session?.user ?? null);
    } catch (error) {
        console.error("Auth Redirect Error:", error);
        throw error;
    }
};

export const loginWithGoogle = async (): Promise<void> => {
    try {
        await signInWithSupabaseGoogle();
    } catch (error) {
        console.error("Google Login Error:", error);
        throw error;
    }
};

export const logout = async (): Promise<void> => {
    try {
        await signOutFromSupabase();
    } catch (error) {
        console.error("Logout Error:", error);
        throw error;
    }
};

export const subscribeToAuthChanges = (callback: (user: AppUser | null) => void) => {
    return subscribeToSupabaseAuthChanges((_event, session) => {
        callback(toAppUser(session?.user ?? null));
    });
};
