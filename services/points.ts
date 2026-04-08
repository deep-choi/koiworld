import { fetchMyProfile, getCurrentUser, setClientApBalance, subscribeToMyProfile } from './supabase';

const assertCurrentUser = async (userId: string) => {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
        throw new Error('Authenticated Supabase user does not match the requested profile.');
    }
};

export const getAPBalance = async (userId: string): Promise<number> => {
    await assertCurrentUser(userId);
    const profile = await fetchMyProfile();
    return profile?.ap ?? 0;
};

export const listenToAPBalance = (userId: string, onUpdate: (ap: number) => void) => {
    let unsubscribe = () => {};
    void subscribeToMyProfile(userId, (profile) => {
        onUpdate(profile?.ap ?? 0);
    }).then((cleanup) => {
        unsubscribe = cleanup;
    }).catch((error) => {
        console.error('Failed to subscribe to Supabase AP balance:', error);
    });

    return () => unsubscribe();
};

export const addAP = async (userId: string, amount: number): Promise<void> => {
    const current = await getAPBalance(userId);
    await setAPBalance(userId, current + amount);
};

export const deductAP = async (userId: string, amount: number): Promise<boolean> => {
    const current = await getAPBalance(userId);
    if (current >= amount) {
        await setAPBalance(userId, current - amount);
        return true;
    }
    return false;
};

export const setAPBalance = async (userId: string, amount: number): Promise<void> => {
    await assertCurrentUser(userId);
    await setClientApBalance(amount);
};
