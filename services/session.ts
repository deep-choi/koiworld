import { getCurrentUser, subscribeToMyProfile, upsertProfileContext } from './supabase';

const DEVICE_ID_KEY = 'zenkoigarden_device_id';

// 기기 고유 ID 가져오기 (없으면 생성)
export const getDeviceId = (): string => {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
};

// 세션 시작 (접속)
export const startSession = async (userId: string) => {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
        throw new Error('Authenticated Supabase user does not match the requested profile.');
    }

    const deviceId = getDeviceId();
    await upsertProfileContext({
        activeDeviceId: deviceId,
        touchLastLogin: true,
    });
};

// 세션 유지 (Heartbeat - 필요시 호출)
export const heartbeatSession = async (userId: string) => {
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
        throw new Error('Authenticated Supabase user does not match the requested profile.');
    }

    await upsertProfileContext({
        activeDeviceId: getDeviceId(),
        touchLastLogin: false,
    });
};

// 내 세션이 유효한지 감시 (중복 로그인 감지)
export const listenToSession = (userId: string, onConflict: () => void) => {
    return listenToActiveDevice(userId, onConflict);
};

// 세션 문서(/sessions)는 읽기 차단(rules) 상태를 유지하고,
// 사용자 문서(/users)에 기록된 activeDeviceId를 감시하여 중복 로그인(다른 기기 접속)을 감지합니다.
export const listenToActiveDevice = (userId: string, onConflict: () => void) => {
    const deviceId = getDeviceId();
    let unsubscribe = () => {};
    void subscribeToMyProfile(userId, (profile) => {
        const activeDeviceId = profile?.activeDeviceId;
        if (activeDeviceId && activeDeviceId !== deviceId) {
            onConflict();
        }
    }).then((cleanup) => {
        unsubscribe = cleanup;
    }).catch((error) => {
        console.error('Failed to subscribe to Supabase active device:', error);
    });

    return () => unsubscribe();
};
