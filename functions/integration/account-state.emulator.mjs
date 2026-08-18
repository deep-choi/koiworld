import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
    connectFirestoreEmulator,
    doc,
    getFirestore,
    setDoc,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const projectId = process.env.GCLOUD_PROJECT || 'koi-garden-abcf5';
const parseHost = (value, fallbackPort) => {
    const [host = '127.0.0.1', port = String(fallbackPort)] = String(value || '').split(':');
    return { host, port: Number(port) };
};
const authHost = parseHost(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099);
const firestoreHost = parseHost(process.env.FIRESTORE_EMULATOR_HOST, 8080);
const functionsHost = parseHost(process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST, 5001);
delete process.env.FIREBASE_EMULATOR_HUB;
delete process.env.FIREBASE_CONFIG;
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${authHost.host}:${authHost.port}`;
process.env.FIRESTORE_EMULATOR_HOST = `${firestoreHost.host}:${firestoreHost.port}`;
process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST = `${functionsHost.host}:${functionsHost.port}`;

const app = initializeApp({ projectId, apiKey: 'demo-key' }, `account-state-${randomUUID()}`);
const auth = getAuth(app);
const clientDb = getFirestore(app);
const functions = getFunctions(app, 'asia-northeast1');
connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, { disableWarnings: true });
connectFirestoreEmulator(clientDb, firestoreHost.host, firestoreHost.port);
connectFunctionsEmulator(functions, functionsHost.host, functionsHost.port);

const adminApp = initializeAdminApp({ projectId }, `account-state-admin-${randomUUID()}`);
const adminDb = getAdminFirestore(adminApp);

const koi = {
    id: 'koi-1',
    name: '테스트 코이',
    genetics: {
        baseColorGenes: ['크림', '크림'],
        lightness: 50,
        saturation: 50,
        spots: Array.from({ length: 4 }, (_, index) => ({
            x: 10 + index,
            y: 20 + index,
            size: 5,
            color: '주황',
            shape: 'circle',
        })),
    },
};

const coreState = {
    ponds: {
        'pond-1': {
            id: 'pond-1',
            name: '연못 1',
            kois: [koi],
            decorations: [],
            theme: '기본 (맑은 물)',
            waterQuality: 90,
        },
    },
    activePondId: 'pond-1',
    zenPoints: 250_000,
    foodCount: 20,
    cornCount: 0,
    koiNameCounter: 2,
};

let stage = 'sign-in';
try {
    const credential = await signInAnonymously(auth);
    const uid = credential.user.uid;
    stage = 'seed-user';
    await adminDb.collection('users').doc(uid).set({
        profile: { nickname: '통합테스트', photoURL: null },
        gameState: coreState,
        gameStateRevision: 4,
        honorPoints: 5,
        achievementPoints: 100,
    });
    await adminDb.collection('rankingState').doc(uid).set({
        uid,
        honorPoints: 7,
        achievementPoints: 300,
        claimedAchievementIds: ['spot_count_4', 'spot_count_8'],
    });
    await adminDb.collection('rankings').doc(uid).set({
        uid,
        nickname: '통합테스트',
        photoURL: null,
        honorPoints: 6,
        achievementPoints: 200,
    });
    await adminDb.collection('users').doc(uid).collection('gameStateBackups').doc('latest').set({
        gameState: {
            ...coreState,
            honorPoints: 6,
            achievementPoints: 300,
            achievements: {
                unlockedIds: ['spot_count_4', 'spot_count_8', 'spot_count_12'],
                claimedIds: ['spot_count_4', 'spot_count_8'],
            },
        },
        gameStateRevision: 3,
    });

    stage = 'legacy-ranking-compatibility';
    await setDoc(doc(clientDb, 'rankings', uid), {
        uid,
        nickname: '통합테스트',
        photoURL: null,
        honorPoints: 6,
        achievementPoints: 200,
    });

    stage = 'load-account-state';
    const loadAccountState = httpsCallable(functions, 'loadAccountState');
    const loaded = (await loadAccountState({})).data;
    assert.equal(loaded.exists, true);
    assert.equal(loaded.gameStateSource, 'primary');
    assert.equal(loaded.gameState.honorPoints, 7);
    assert.equal(loaded.gameState.achievementPoints, 300);
    assert.deepEqual(loaded.gameState.achievements.claimedIds, ['spot_count_4', 'spot_count_8']);
    assert.ok(loaded.gameState.achievements.unlockedIds.includes('spot_count_12'));

    stage = 'first-achievement-claim';
    const claimAchievement = httpsCallable(functions, 'claimAchievement');
    const firstClaim = (await claimAchievement({
        achievementId: 'color_크림_basic',
        eventId: randomUUID(),
    })).data;
    assert.equal(firstClaim.achievementReward, 200);
    assert.equal(firstClaim.achievementPoints, 500);

    stage = 'duplicate-achievement-claim';
    const duplicateClaim = (await claimAchievement({
        achievementId: 'color_크림_basic',
        eventId: randomUUID(),
    })).data;
    assert.equal(duplicateClaim.achievementReward, 0);
    assert.equal(duplicateClaim.achievementPoints, 500);

    stage = 'canonical-save';
    const saveGameState = httpsCallable(functions, 'saveGameState');
    const lowerClientState = {
        ...loaded.gameState,
        honorPoints: 0,
        achievementPoints: 0,
        achievements: { unlockedIds: [], claimedIds: [] },
    };
    const saved = (await saveGameState({
        gameState: lowerClientState,
        expectedRevision: loaded.gameStateRevision,
        deviceId: 'integration-test',
        reason: 'auto',
    })).data;
    assert.equal(saved.gameState.honorPoints, 7);
    assert.equal(saved.gameState.achievementPoints, 500);
    assert.ok(saved.gameState.achievements.claimedIds.includes('color_크림_basic'));

    stage = 'trophy-purchase';
    const purchaseHonorTrophies = httpsCallable(functions, 'purchaseHonorTrophies');
    const purchase = (await purchaseHonorTrophies({ quantity: 1, eventId: randomUUID() })).data;
    assert.equal(purchase.honorPoints, 8);
    assert.equal(purchase.zenPoints, 150_000);
    assert.equal(purchase.revision, saved.revision + 1);

    stage = 'stale-revision';
    await assert.rejects(
        saveGameState({
            gameState: saved.gameState,
            expectedRevision: saved.revision,
            deviceId: 'stale-device',
            reason: 'auto',
        }),
        error => String(error?.code).includes('aborted'),
    );

    stage = 'ranking-rules';
    await assert.rejects(
        setDoc(doc(clientDb, 'rankings', uid), {
            uid,
            honorPoints: 999,
            achievementPoints: 999,
        }),
        error => String(error?.code).includes('permission-denied'),
    );

    stage = 'account-delete';
    const deleteAccountData = httpsCallable(functions, 'deleteAccountData');
    await deleteAccountData({});
    const [userAfterDelete, backupAfterDelete, eventsAfterDelete] = await Promise.all([
        adminDb.collection('users').doc(uid).get(),
        adminDb.collection('users').doc(uid).collection('gameStateBackups').get(),
        adminDb.collection('rankingEvents').where('uid', '==', uid).get(),
    ]);
    assert.equal(userAfterDelete.exists, false);
    assert.equal(backupAfterDelete.empty, true);
    assert.equal(eventsAfterDelete.empty, true);
    console.log('account-state emulator integration passed');
} catch (error) {
    console.error(`account-state emulator integration failed at: ${stage}`, error);
    throw error;
} finally {
    await Promise.allSettled([deleteApp(app), deleteAdminApp(adminApp)]);
}
