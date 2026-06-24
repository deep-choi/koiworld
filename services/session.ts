import { subscribeToUserProfile, updateUserSession } from './cloudData';

const DEVICE_ID_KEY = 'koiworld_device_id';

export const getDeviceId = (): string => {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
};

export const startSession = async (userId: string) => {
    await updateUserSession(userId, getDeviceId(), true);
};

export const heartbeatSession = async (userId: string) => {
    await updateUserSession(userId, getDeviceId(), false);
};

export const listenToSession = (userId: string, onConflict: () => void) => {
    return listenToActiveDevice(userId, onConflict);
};

export const listenToActiveDevice = (userId: string, onConflict: () => void) => {
    const deviceId = getDeviceId();
    return subscribeToUserProfile(userId, (profile) => {
        const activeDeviceId = profile?.activeDeviceId;
        if (activeDeviceId && activeDeviceId !== deviceId) {
            onConflict();
        }
    });
};
