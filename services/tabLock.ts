const TAB_LOCK_PREFIX = 'koiworld_active_tab_lock_v1';
const CHANNEL_NAME = 'koiworld_tab_lock_v1';
const HEARTBEAT_MS = 3000;
const LOCK_TTL_MS = 15000;

type TabLockStatus = 'active' | 'blocked';

interface TabLockRecord {
    tabId: string;
    updatedAt: number;
}

interface TabLockMessage {
    type: 'claim' | 'release';
    scopeId: string;
    tabId: string;
    updatedAt: number;
}

interface TabLockHandlers {
    onActive: () => void;
    onBlocked: () => void;
}

export interface TabLockController {
    takeOver: () => void;
    stop: () => void;
}

const createTabId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const getLockKey = (scopeId: string) => `${TAB_LOCK_PREFIX}:${scopeId || 'guest'}`;

const isFresh = (record: TabLockRecord, now = Date.now()) => now - record.updatedAt < LOCK_TTL_MS;

const readLock = (key: string): TabLockRecord | null => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (typeof parsed?.tabId !== 'string' || typeof parsed?.updatedAt !== 'number') {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
};

const writeLock = (key: string, tabId: string): TabLockRecord | null => {
    try {
        const record = { tabId, updatedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(record));
        return record;
    } catch {
        return null;
    }
};

const removeLock = (key: string, tabId: string) => {
    try {
        const current = readLock(key);
        if (current?.tabId === tabId) {
            localStorage.removeItem(key);
        }
    } catch {
        // Ignore storage cleanup failures.
    }
};

export const startTabLock = (scopeId: string, handlers: TabLockHandlers): TabLockController => {
    const tabId = createTabId();
    const lockKey = getLockKey(scopeId);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

    let stopped = false;
    let status: TabLockStatus | null = null;
    let heartbeatId: number | null = null;
    let blockedRetryId: number | null = null;

    const postMessage = (type: TabLockMessage['type'], updatedAt = Date.now()) => {
        channel?.postMessage({ type, scopeId, tabId, updatedAt });
    };

    const setStatus = (nextStatus: TabLockStatus) => {
        if (stopped || status === nextStatus) return;
        status = nextStatus;

        if (nextStatus === 'active') {
            handlers.onActive();
        } else {
            handlers.onBlocked();
        }
    };

    const stopHeartbeat = () => {
        if (heartbeatId) {
            window.clearInterval(heartbeatId);
            heartbeatId = null;
        }
    };

    const stopBlockedRetry = () => {
        if (blockedRetryId) {
            window.clearTimeout(blockedRetryId);
            blockedRetryId = null;
        }
    };

    const scheduleBlockedRetry = () => {
        stopBlockedRetry();
        // Android WebView may not dispatch beforeunload when the app is
        // closed. Re-check after the lock TTL so a stale lock cannot block
        // the next launch forever.
        blockedRetryId = window.setTimeout(() => {
            blockedRetryId = null;
            evaluate();
        }, LOCK_TTL_MS + 250);
    };

    const becomeBlocked = () => {
        stopHeartbeat();
        setStatus('blocked');
        scheduleBlockedRetry();
    };

    const claim = () => {
        if (stopped) return;

        stopBlockedRetry();

        const record = writeLock(lockKey, tabId);
        if (!record) {
            becomeBlocked();
            return;
        }

        postMessage('claim', record.updatedAt);
        setStatus('active');

        if (!heartbeatId) {
            heartbeatId = window.setInterval(() => {
                if (stopped || status !== 'active') return;

                const current = readLock(lockKey);
                if (current && current.tabId !== tabId && isFresh(current)) {
                    becomeBlocked();
                    return;
                }

                const heartbeatRecord = writeLock(lockKey, tabId);
                if (heartbeatRecord) {
                    postMessage('claim', heartbeatRecord.updatedAt);
                }
            }, HEARTBEAT_MS);
        }
    };

    const evaluate = () => {
        if (stopped) return;

        const current = readLock(lockKey);
        if (!current || current.tabId === tabId || !isFresh(current)) {
            claim();
            return;
        }

        becomeBlocked();
    };

    const handleStorage = (event: StorageEvent) => {
        if (event.key !== lockKey) return;

        const current = readLock(lockKey);
        if (!current) {
            if (status === 'blocked') evaluate();
            return;
        }

        if (current.tabId !== tabId && isFresh(current)) {
            becomeBlocked();
            return;
        }

        if (current.tabId === tabId) {
            claim();
        }
    };

    const handleMessage = (event: MessageEvent<TabLockMessage>) => {
        const message = event.data;
        if (!message || message.scopeId !== scopeId || message.tabId === tabId) return;

        if (message.type === 'claim') {
            becomeBlocked();
        } else if (message.type === 'release' && status === 'blocked') {
            evaluate();
        }
    };

    const handleBeforeUnload = () => {
        if (status === 'active') {
            removeLock(lockKey, tabId);
            postMessage('release');
        }
    };

    const handlePageHide = () => {
        handleBeforeUnload();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    channel?.addEventListener('message', handleMessage);

    evaluate();

    return {
        takeOver: claim,
        stop: () => {
            if (stopped) return;
            stopped = true;
            stopHeartbeat();
            stopBlockedRetry();
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('pagehide', handlePageHide);
            channel?.removeEventListener('message', handleMessage);
            if (status === 'active') {
                removeLock(lockKey, tabId);
                postMessage('release');
            }
            channel?.close();
        },
    };
};
