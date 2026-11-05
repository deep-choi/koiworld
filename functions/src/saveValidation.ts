// 웹과 서버가 같은 기준으로 저장본을 검사합니다. 구버전의 선택 필드는
// 허용하되 코이·유전·좌표처럼 게임 실행에 필요한 구조의 손상은 거부합니다.
type Data = Record<string, any>;
const record = (value: unknown): value is Data =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value: unknown) => value === undefined || value === null || number(value);
// Two-allele trait genes: missing, or how many of the two alleles carry the trait.
const alleleCount = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2);
const colors = new Set(['검정', '빨강', '노랑', '하양', '주황', '크림']);
// ── 연못 수 규칙 ─────────────────────────────────────────────────────────
// 연못은 두 종류입니다.
//  1) 일반 연못(pond-1, pond-2 …): 무료 연못과, 예전 상점의 젠 포인트(20,000 ZP) 확장권으로 늘린 연못(최대 4개).
//  2) 유료 연못(pond-paid-1, pond-paid-2 …): Google Play에서 산 "연못 확장권"(상품 pond_slot) 1개당 1개.
//     화면 이름은 일반 연못 번호에 이어서 붙습니다(예: 연못 3).
// 두 종류를 id로 구분해 두면 예전에 젠 포인트로 산 연못과 현금으로 산 연못이 섞이지 않고,
// 재설치·새 게임 후에도 유료 연못 id만 보고 빠진 연못을 다시 채워 줄 수 있습니다.
//
// ── 무료 연못 수: 신규 유저 1개, 기존 유저 2개 ─────────────────────────────
// ● 저장본의 freePondCount(1 또는 2)가 그 게임의 무료 연못 수입니다. 새 버전은 모든 저장에 이 값을 적습니다(새 형식).
//   이 값이 없는 저장은 1.0.8 이하 앱의 저장(구버전 형식)이며 기존 유저로 보고 무료 2개입니다.
// ● 새 버전에서 처음 시작한 게임(게스트·계정)은 1개, 그 전부터 있던 저장본과 기준일 전에 가입한 계정은 2개입니다.
// ● 서버(saveGameState)는 계정이 새 형식으로 저장한 적이 있는지로 나눠 검사합니다.
//   - 아직 없는 계정(구버전 앱만 쓴 계정, 첫 저장): 강제 업데이트를 하지 않으므로 구버전 앱이 만드는
//     무료 연못 2와 예전 젠 포인트 확장권 연못까지 일반 연못 4개를 받습니다. 저장이 실패해 멈추지 않게 합니다.
//   - 새 형식으로 저장한 적이 있는 계정: 일반 연못을 늘릴 수 없습니다(연못은 현금 연못 확장권으로만).
//     이미 저장된 연못과, 가입 시각 기준 무료 연못 수(기준일 전 2개, 뒤 1개)까지만 받습니다.
//   - 구버전 앱의 저장(freePondCount 없음)이 새 형식 표시를 지우지 않도록 서버가 이전 값을 이어 붙입니다(keepFreePondCount).

export type FreePondCount = 1 | 2;
/** 새 버전에서 처음 시작한 게임과 기준일 뒤 가입한 계정의 무료 연못 수 */
export const NEW_FREE_POND_COUNT: FreePondCount = 1;
/** 이번 업데이트 전부터 있던 저장본과 기준일 전에 가입한 계정의 무료 연못 수(1.0.7~1.0.8과 같음) */
export const LEGACY_FREE_POND_COUNT: FreePondCount = 2;
/**
 * 신규 유저 기준일: 이 시각 이후 Firebase Auth에 가입한 계정은 무료 연못 1개입니다.
 * 2026-11-04 00:00 한국 시간(2026-11-03T15:00:00Z). 출시 일정이 바뀌면 이 값만 고치면 됩니다
 * (앱과 서버가 같은 값을 씁니다. docs/유료화-콘솔-체크리스트.md 4번).
 */
export const FREE_POND_POLICY_START = '2026-11-04T00:00:00+09:00';
export const FREE_POND_POLICY_START_MS = Date.parse(FREE_POND_POLICY_START);
/** 일반 연못의 최대 개수. 젠 포인트 확장권이 있던 때 산 연못까지 합쳐 4개입니다. */
export const MAX_REGULAR_POND_COUNT = 4;
/** 예전 코드와의 호환용 이름. 일반 연못 한도와 같습니다. */
export const MAX_POND_COUNT = MAX_REGULAR_POND_COUNT;
/** 한 계정이 Google Play에서 살 수 있는 연못 슬롯의 최대 개수 */
export const MAX_PAID_POND_SLOTS = 9;
/** 어떤 계정도 넘을 수 없는 전체 연못 수(구조 검사용) */
export const ABSOLUTE_MAX_POND_COUNT = 10;
export const PAID_POND_ID_PREFIX = 'pond-paid-';

const PAID_POND_ID_PATTERN = /^pond-paid-([1-9]\d*)$/;

/** 유료 연못 id면 슬롯 번호(1부터), 아니면 null을 돌려줍니다. */
export const paidPondNumber = (pondId: string): number | null => {
    const match = PAID_POND_ID_PATTERN.exec(pondId);
    return match ? Number(match[1]) : null;
};
export const isPaidPondId = (pondId: string): boolean => paidPondNumber(pondId) !== null;
export const paidPondId = (slotNumber: number): string => `${PAID_POND_ID_PREFIX}${slotNumber}`;

/**
 * 계정별 혜택. 서버(Firebase Functions)가 Google Play 구매를 확인한 뒤
 * Firestore `entitlements/{uid}`에 저장하고, 앱과 웹이 같은 값을 읽습니다.
 */
export type AccountEntitlements = {
    /** Google Play에서 산 연못 슬롯 수 */
    paidPondSlots: number;
    /** 광고 제거 상품 보유 여부 */
    adFree: boolean;
};

export const DEFAULT_ENTITLEMENTS: AccountEntitlements = Object.freeze({ paidPondSlots: 0, adFree: false });

/** Firestore에서 읽은 값을 안전한 범위의 혜택으로 바꿉니다. 모르는 값은 혜택 없음으로 봅니다. */
export const normalizeEntitlements = (value: unknown): AccountEntitlements => {
    if (!record(value)) return { ...DEFAULT_ENTITLEMENTS };
    const slots = number(value.paidPondSlots) ? Math.floor(value.paidPondSlots) : 0;
    return {
        paidPondSlots: Math.max(0, Math.min(MAX_PAID_POND_SLOTS, slots)),
        adFree: value.adFree === true,
    };
};

/** 이 계정이 가질 수 있는 전체 연못 수의 상한(예전에 젠 포인트로 산 일반 연못까지 포함한 최대치) */
export const maxPondCountFor = (entitlements: AccountEntitlements | null | undefined): number =>
    Math.min(ABSOLUTE_MAX_POND_COUNT, MAX_REGULAR_POND_COUNT + normalizeEntitlements(entitlements).paidPondSlots);

/** 연못 id 목록을 일반/유료로 나눠 셉니다. */
export const countPonds = (pondIds: string[]) => {
    const paidNumbers = pondIds.map(paidPondNumber).filter((n): n is number => n !== null);
    return { regular: pondIds.length - paidNumbers.length, paid: paidNumbers.length, paidNumbers };
};

/** 실제 연못과 아직 생성되지 않은 구매 슬롯을 모두 포함한 사용량입니다. */
export const pondCapacityUsed = (pondIds: string[], entitlements: unknown): number => {
    const { regular, paid } = countPonds(pondIds);
    return Math.max(1, regular) + Math.max(paid, normalizeEntitlements(entitlements).paidPondSlots);
};

const pondIdsOf = (state: unknown): string[] =>
    record(state) && record(state.ponds) ? Object.keys(state.ponds) : [];

/** 저장본에 적힌 무료 연못 수. 적혀 있지 않으면(구버전 형식) null */
export const savedFreePondCount = (state: unknown): FreePondCount | null =>
    record(state) && (state.freePondCount === 1 || state.freePondCount === 2) ? state.freePondCount : null;

/** 이 계정(저장본)이 새 형식으로 저장된 적이 있는지 */
export const hasSavedWithFreePondCount = (state: unknown): boolean => savedFreePondCount(state) !== null;

/**
 * 계정 가입 시각(ms) 기준의 무료 연못 수. 기준일 전에 가입했으면 2개, 그 뒤면 1개입니다.
 * 가입 시각을 모르면(읽기 실패) 저장을 막지 않도록 기존 계정처럼 2개로 봅니다.
 */
export const freePondCountForAccount = (
    accountCreatedAt: number | null | undefined,
    policyStart: number = FREE_POND_POLICY_START_MS,
): FreePondCount => (typeof accountCreatedAt === 'number' && Number.isFinite(accountCreatedAt) && accountCreatedAt >= policyStart
    ? NEW_FREE_POND_COUNT
    : LEGACY_FREE_POND_COUNT);

export type PondAllowanceOptions = {
    /** Firebase Auth 계정 생성 시각(ms). 새 형식으로 저장한 적이 있는 계정이 일반 연못을 늘리려 할 때만 필요합니다. */
    accountCreatedAt?: number | null;
};

/**
 * 이 저장에서 허용하는 일반 연못 수.
 * - 새 형식으로 저장한 적이 없는 계정(previousState에 freePondCount 없음, 또는 저장본 없음): 4개.
 *   구버전 앱의 무료 연못 2와 젠 포인트 확장권 연못, 게스트 시절 진행도를 그대로 받아 저장이 멈추지 않게 합니다.
 * - 새 형식으로 저장한 적이 있는 계정: 서버에 이미 저장되어 있던 수와 가입 시각 기준 무료 연못 수 중 큰 값.
 */
export const allowedRegularPondCount = (previousState: unknown, options: PondAllowanceOptions = {}): number => {
    if (!hasSavedWithFreePondCount(previousState)) return MAX_REGULAR_POND_COUNT;
    const stored = countPonds(pondIdsOf(previousState)).regular;
    return Math.min(MAX_REGULAR_POND_COUNT, Math.max(freePondCountForAccount(options.accountCreatedAt), stored));
};

/**
 * 이 저장을 검사하려면 계정 가입 시각이 필요한지. 새 형식으로 저장한 적이 있는 계정이 일반 연못을 늘리는데,
 * 가입 시각에 따라 받을지 말지가 달라지는 경우(연못 1개 → 2개)에만 true입니다. 서버는 이때만 Firebase Auth를 읽습니다.
 */
export const needsAccountCreatedAt = (incomingState: unknown, previousState: unknown): boolean => {
    if (!hasSavedWithFreePondCount(previousState)) return false;
    const stored = countPonds(pondIdsOf(previousState)).regular;
    const incoming = countPonds(pondIdsOf(incomingState)).regular;
    return incoming > Math.max(NEW_FREE_POND_COUNT, stored) && incoming <= Math.max(LEGACY_FREE_POND_COUNT, stored);
};

/**
 * 구버전 앱의 저장(freePondCount 없음)이 새 형식 표시를 지우지 않도록, 서버에 저장되어 있던 값을 이어 붙입니다.
 * 그래야 새 버전으로 한 번 저장한 계정은 그 뒤 구버전 앱으로 저장해도 계속 "새 형식으로 저장한 계정"으로 남고,
 * 새 버전이 그 저장본을 다시 불러와도 무료 연못 수가 바뀌지 않습니다.
 */
export const keepFreePondCount = <T extends object>(incomingState: T, previousState: unknown): T => {
    const previous = savedFreePondCount(previousState);
    return previous !== null && !hasSavedWithFreePondCount(incomingState)
        ? { ...incomingState, freePondCount: previous }
        : incomingState;
};

/**
 * 계정 혜택 기준의 연못 수 검사. 문제가 없으면 null, 있으면 거절 이유를 돌려줍니다.
 *
 * - 일반 연못: allowedRegularPondCount. 새 형식으로 저장한 적이 있는 계정은 일반 연못을 늘릴 수 없고,
 *   이미 저장된 연못(예전에 받은 연못 2, 젠 포인트로 산 pond-3·pond-4)은 계속 받습니다.
 * - 유료 연못 pond-paid-N은 N이 산 연못 확장권 수 이하일 때만 새로 만들 수 있습니다.
 * - 서버에 이미 저장된 연못은 그대로 둡니다. 환불 등으로 혜택이 줄어도 저장이
 *   막혀 코이를 잃는 일이 없도록, "새로 생긴 연못"만 혜택으로 검사합니다.
 */
export const pondAllowanceError = (
    incomingState: unknown,
    entitlements: AccountEntitlements | null | undefined,
    previousState?: unknown,
    options: PondAllowanceOptions = {},
): string | null => {
    const incomingIds = pondIdsOf(incomingState);
    const regularLimit = allowedRegularPondCount(previousState, options);
    const incomingRegular = countPonds(incomingIds).regular;
    if (incomingRegular > regularLimit) {
        return `일반 연못은 더 늘릴 수 없습니다. 연못은 연못 확장권으로 추가해 주세요. (${incomingRegular}/${regularLimit})`;
    }
    const allowedPaidSlots = normalizeEntitlements(entitlements).paidPondSlots;
    const previousIds = new Set(pondIdsOf(previousState));
    const newIds = incomingIds.filter(id => !previousIds.has(id));
    for (const id of newIds) {
        const slot = paidPondNumber(id);
        if (slot !== null && slot > allowedPaidSlots) {
            return `구매하지 않은 연못 확장권입니다. (${id})`;
        }
    }
    return null;
};

export function isValidGameStateCore(value: unknown): boolean {
    if (!record(value) || !record(value.ponds) || typeof value.activePondId !== 'string'
        || !Object.hasOwn(value.ponds, value.activePondId)) return false;
    // 무료 연못 수는 없거나(구버전 형식) 1 또는 2입니다.
    if (value.freePondCount !== undefined && savedFreePondCount(value) === null) return false;
    // 구조 검사: 일반 연못은 4개, 전체 연못은 10개까지 허용합니다.
    // 계정이 실제로 슬롯을 샀는지는 pondAllowanceError가 계정 혜택으로 따로 확인합니다.
    const pondCounts = countPonds(Object.keys(value.ponds));
    if (Object.keys(value.ponds).length > ABSOLUTE_MAX_POND_COUNT || pondCounts.regular > MAX_REGULAR_POND_COUNT
        || pondCounts.paidNumbers.some(slot => slot > MAX_PAID_POND_SLOTS)) return false;
    if (!['zenPoints', 'foodCount', 'koiNameCounter'].every(key => number(value[key]) && value[key] >= 0)) return false;
    if (!['cornCount', 'honorPoints', 'achievementPoints'].every(key => optionalNumber(value[key]) && (value[key] == null || value[key] >= 0))) return false;
    const ids = new Set<string>();
    return Object.entries(value.ponds).every(([id, pond]) => {
        if (!record(pond) || pond.id !== id || !Array.isArray(pond.kois)
            || !optionalNumber(pond.waterQuality)
            || (pond.decorations !== undefined && !Array.isArray(pond.decorations))) return false;
        if (!(pond.decorations ?? []).every((d: unknown) => record(d) && typeof d.id === 'string'
            && typeof d.type === 'string' && record(d.position) && number(d.position.x) && number(d.position.y)
            && number(d.scale) && number(d.rotation))) return false;
        return pond.kois.every((k: unknown) => {
            if (!record(k) || typeof k.id !== 'string' || !k.id || ids.has(k.id) || !record(k.genetics)) return false;
            if ((k.name !== undefined && typeof k.name !== 'string')
                || (k.description !== undefined && typeof k.description !== 'string')
                || (k.growthStage !== undefined && !['fry', 'juvenile', 'adult'].includes(k.growthStage))) return false;
            ids.add(k.id);
            const g = k.genetics;
            if (!Array.isArray(g.baseColorGenes) || !g.baseColorGenes.length || !g.baseColorGenes.every((c: unknown) => colors.has(String(c)))
                || !Array.isArray(g.spots) || !optionalNumber(g.lightness) || !optionalNumber(g.saturation)) return false;
            if (!g.spots.every((s: unknown) => record(s) && number(s.x) && number(s.y) && number(s.size)
                && colors.has(s.color) && ['circle', 'hexagon', 'polygon', 'oval_h'].includes(s.shape))) return false;
            if (!['motoguroGenes', 'hirenagaGenes', 'ginrinGenes', 'koromoGenes', 'tanchoGenes', 'doitsuGenes'].every(key => alleleCount(g[key]))
                || !(g.ginrin === undefined || (number(g.ginrin) && g.ginrin >= 0 && g.ginrin <= 100))) return false;
            if (g.spotPhenotypeGenes !== undefined) {
                const cs = g.spotPhenotypeGenes?.CS;
                if (!record(cs) || !record(cs.allele1) || !record(cs.allele2)
                    || !number(cs.allele1.value) || !number(cs.allele2.value)
                    || !['complete', 'incomplete', 'recessive', 'codominance'].includes(cs.dominanceType)) return false;
            }
            return (k.position === undefined || (record(k.position) && number(k.position.x) && number(k.position.y)))
                && (k.velocity === undefined || (record(k.velocity) && number(k.velocity.vx) && number(k.velocity.vy)))
                && ['age', 'timesFed', 'stamina', 'foodTargetId', 'feedCooldownUntil'].every(key => optionalNumber(k[key]));
        });
    });
}
