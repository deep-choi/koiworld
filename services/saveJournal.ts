import type { SavedGameState } from '../types';
import { normalizeSavedGameState } from '../utils/savedGameState';
import { getScopedSaveGameKey } from './localSave';

export interface LocalSaveRecord {
    localSaveVersion: 1;
    gameState: SavedGameState;
    baseRevision: number | null;
    dirty: boolean;
    savedAt: number;
    cloudSavedAt?: number;
}

export function readLocalSave(uid?: string | null): LocalSaveRecord | null {
    const raw = localStorage.getItem(getScopedSaveGameKey(uid));
    if (!raw) return null;
    try {
        const value = JSON.parse(raw);
        const wrapped = value?.localSaveVersion === 1;
        const gameState = normalizeSavedGameState(wrapped ? value.gameState : value);
        if (!gameState) return null;
        // 구버전 앱도 읽을 수 있도록 본문은 기존 키에, 전송 정보는 별도 키에 둡니다.
        // 두 항목 사이에 앱이 종료되거나 구버전이 본문을 바꾸면 기준을 신뢰하지 않습니다.
        let metadata = wrapped ? value : null;
        if (!wrapped) {
            try {
                const journal = JSON.parse(localStorage.getItem(`${getScopedSaveGameKey(uid)}_journal_v1`) || 'null');
                if (journal?.localSaveVersion === 1 && JSON.stringify(journal.gameState) === JSON.stringify(value)) metadata = journal;
            } catch { /* 본문이 정상이라면 손상된 전송 정보 때문에 진행도를 버리지 않습니다. */ }
        }
        return {
            localSaveVersion: 1, gameState,
            baseRevision: Number.isSafeInteger(metadata?.baseRevision) && metadata.baseRevision >= 0 ? metadata.baseRevision : null,
            // 구버전 저장본은 전송 여부를 증명할 수 없으므로 자동으로 버리지 않습니다.
            dirty: metadata ? metadata.dirty !== false : true,
            savedAt: Number.isFinite(metadata?.savedAt) ? metadata.savedAt : 0,
            cloudSavedAt: Number.isFinite(metadata?.cloudSavedAt) ? metadata.cloudSavedAt : undefined,
        };
    } catch { return null; }
}

function storeRecord(uid: string | null | undefined, record: LocalSaveRecord): void {
    const key = getScopedSaveGameKey(uid);
    // 본문 저장이 먼저입니다. 후속 메타데이터 저장 실패 시에도 최신 진행도는 남고,
    // 다음 실행에서는 기준 리비전 미확인 상태로 안전하게 복구 선택을 요청합니다.
    localStorage.setItem(key, JSON.stringify(record.gameState));
    localStorage.setItem(`${key}_journal_v1`, JSON.stringify(record));
}

export function writeLocalSave(uid: string | null | undefined, gameState: SavedGameState, baseRevision: number | null): void {
    const previous = readLocalSave(uid);
    const unchanged = previous && JSON.stringify(previous.gameState) === JSON.stringify(gameState);
    const record: LocalSaveRecord = {
        localSaveVersion: 1, gameState, baseRevision,
        dirty: unchanged ? previous.dirty : true, savedAt: Date.now(),
        cloudSavedAt: previous?.cloudSavedAt,
    };
    storeRecord(uid, record);
}

export function acceptCloudSave(uid: string, gameState: SavedGameState, revision: number): void {
    storeRecord(uid, {
        localSaveVersion: 1, gameState, baseRevision: revision, dirty: false, savedAt: Date.now(),
        cloudSavedAt: Date.now(),
    });
}

export function acknowledgeLocalSave(uid: string, sentState: SavedGameState, revision: number): void {
    const current = readLocalSave(uid);
    if (!current) return;
    storeRecord(uid, {
        ...current, baseRevision: revision, cloudSavedAt: Date.now(),
        // 요청을 보낸 뒤 더 플레이했다면 최신 로컬 상태의 미전송 표시는 유지합니다.
        dirty: JSON.stringify(current.gameState) !== JSON.stringify(sentState),
    });
}

export function archiveLocalSave(uid: string): void {
    const record = readLocalSave(uid);
    if (record) localStorage.setItem(`${getScopedSaveGameKey(uid)}_recovery`, JSON.stringify(record));
}

export function chooseSaveSource(local: LocalSaveRecord | null, cloud: SavedGameState, revision: number): 'cloud' | 'local' | 'choose' {
    if (!local || !local.dirty || JSON.stringify(local.gameState) === JSON.stringify(cloud)) return 'cloud';
    return local.baseRevision === revision ? 'local' : 'choose';
}
