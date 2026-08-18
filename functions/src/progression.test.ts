import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileProgression } from './progression.js';

test('reconciles scattered claims once and preserves the highest trophy total', () => {
    const result = reconcileProgression({
        userData: { honorPoints: 3, achievementPoints: 100 },
        rankingStateData: {
            honorPoints: 7,
            achievementPoints: 300,
            claimedAchievementIds: ['spot_count_4', 'spot_count_8'],
        },
        currentGameState: {
            honorPoints: 0,
            achievementPoints: 100,
            achievements: { claimedIds: ['spot_count_4'], unlockedIds: [] },
        },
        backupGameStates: [{
            honorPoints: 5,
            achievementPoints: 300,
            achievements: { claimedIds: ['spot_count_4', 'spot_count_8'], unlockedIds: ['spot_count_12'] },
        }],
        historicalAchievementIds: ['spot_count_4', 'spot_count_8'],
    });

    assert.equal(result.honorPoints, 7);
    assert.equal(result.achievementPoints, 300);
    assert.deepEqual(result.claimedAchievementIds, ['spot_count_4', 'spot_count_8']);
    assert.deepEqual(result.unlockedAchievementIds, ['spot_count_12', 'spot_count_4', 'spot_count_8']);
});

test('ignores lower or forged client progression after canonical migration', () => {
    const result = reconcileProgression({
        userData: { progressionProtocolVersion: 1, honorPoints: 8, achievementPoints: 300 },
        rankingStateData: {
            progressionProtocolVersion: 1,
            honorPoints: 8,
            achievementPoints: 300,
            claimedAchievementIds: ['spot_count_4', 'spot_count_8'],
        },
        currentGameState: {
            honorPoints: 8,
            achievementPoints: 300,
            achievements: { claimedIds: ['spot_count_4', 'spot_count_8'] },
        },
        incomingGameState: {
            honorPoints: 999,
            achievementPoints: 99999,
            achievements: { claimedIds: ['spot_count_20'] },
        },
    });

    assert.equal(result.honorPoints, 8);
    assert.equal(result.achievementPoints, 300);
    assert.deepEqual(result.claimedAchievementIds, ['spot_count_4', 'spot_count_8']);
});

test('migrates legacy achievement IDs and preserves points without a stored claim list', () => {
    const migrated = reconcileProgression({
        userData: { achievementPoints: 700 },
        currentGameState: {
            achievementPoints: 700,
            achievements: {
                claimedIds: ['color_빨강_sat_high', 'spot_count_16'],
            },
        },
    });
    assert.deepEqual(migrated.claimedAchievementIds, ['saturation_100', 'spot_count_16']);
    assert.equal(migrated.achievementPoints, 700);

    const withoutIds = reconcileProgression({
        userData: { achievementPoints: 950 },
        currentGameState: { achievementPoints: 950 },
    });
    assert.equal(withoutIds.legacyAchievementPointsBase, 950);
    assert.equal(withoutIds.achievementPoints, 950);
});
