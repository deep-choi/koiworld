import {
    User as FirebaseUser,
    createUserWithEmailAndPassword,
    getRedirectResult,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    signOut as signOutFromFirebase,
    updateProfile,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export interface AppUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    rawUser: FirebaseUser;
}

const toAppUser = (user: FirebaseUser | null): AppUser | null => {
    if (!user) {
        return null;
    }

    const displayName =
        user.displayName?.trim() ||
        (typeof user.email === 'string' ? user.email.split('@')[0] : null) ||
        null;

    return {
        uid: user.uid,
        email: user.email ?? null,
        displayName,
        photoURL: user.photoURL ?? null,
        rawUser: user,
    };
};

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
        await signInWithPopup(auth, googleProvider);
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

export const loginWithEmailPassword = async (email: string, password: string): Promise<AppUser | null> => {
    try {
        const result = await signInWithEmailAndPassword(auth, email.trim(), password);
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
    } catch (error) {
        console.error("Logout Error:", error);
        throw error;
    }
};

export const subscribeToAuthChanges = (callback: (user: AppUser | null) => void) => {
    return onAuthStateChanged(auth, (user) => callback(toAppUser(user)));
};
