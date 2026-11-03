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
//  1) 일반 연못(pond-1, pond-2 …): 모든 계정에 무료로 2개.
//     예전에는 상점의 젠 포인트(20,000 ZP) 확장권으로 4개까지 늘릴 수 있었고, 그때 산 연못
//     (pond-3, pond-4)은 계속 인정합니다. 지금은 일반 연못을 새로 늘릴 수 없습니다.
//  2) 유료 연못(pond-paid-1, pond-paid-2 …): Google Play에서 산 "연못 확장권"(상품 pond_slot) 1개당 1개.
//     화면 이름은 일반 연못 번호에 이어서 붙습니다(예: 연못 3).
// 두 종류를 id로 구분해 두면 예전에 젠 포인트로 산 연못과 현금으로 산 연못이 섞이지 않고,
// 재설치·새 게임 후에도 유료 연못 id만 보고 빠진 연못을 다시 채워 줄 수 있습니다.

/** 모든 계정이 무료로 받는 일반 연못 수 */
export const DEFAULT_FREE_POND_COUNT = 2;
/** 일반 연못의 최대 개수. 젠 포인트 확장권이 있던 때 산 연못까지 합쳐 4개입니다. */
export const MAX_REGULAR_POND_COUNT = 4;
/** 예전 코드와의 호환용 이름. 일반 연못 한도와 같습니다. */
export const MAX_POND_COUNT = MAX_REGULAR_POND_COUNT;
/** 한 계정이 Google Play에서 살 수 있는 연못 슬롯의 최대 개수 */
export const MAX_PAID_POND_SLOTS = 4;
/** 어떤 계정도 넘을 수 없는 전체 연못 수(구조 검사용) */
export const ABSOLUTE_MAX_POND_COUNT = MAX_REGULAR_POND_COUNT + MAX_PAID_POND_SLOTS;
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
    MAX_REGULAR_POND_COUNT + normalizeEntitlements(entitlements).paidPondSlots;

/** 연못 id 목록을 일반/유료로 나눠 셉니다. */
export const countPonds = (pondIds: string[]) => {
    const paidNumbers = pondIds.map(paidPondNumber).filter((n): n is number => n !== null);
    return { regular: pondIds.length - paidNumbers.length, paid: paidNumbers.length, paidNumbers };
};

const pondIdsOf = (state: unknown): string[] =>
    record(state) && record(state.ponds) ? Object.keys(state.ponds) : [];

export type PondAllowanceOptions = {
    /**
     * 서버에 아직 저장본이 없는 계정의 첫 저장(reason 'new-account')일 때 true.
     * 게스트로 놀던 기기 진행도를 계정으로 옮길 때, 젠 포인트 확장권이 있던 시절 게스트로 산
     * 일반 연못(최대 4개)까지 그대로 옮길 수 있게 합니다. 계정마다 한 번뿐입니다.
     */
    carriesGuestProgress?: boolean;
};

/**
 * 이 저장에서 허용하는 일반 연못 수.
 * 기본 2개, 또는 서버에 이미 저장되어 있던 일반 연못 수(예전에 젠 포인트로 산 연못 포함, 최대 4개) 중 큰 값입니다.
 */
export const allowedRegularPondCount = (previousState: unknown, options: PondAllowanceOptions = {}): number => {
    if (options.carriesGuestProgress && !record(previousState)) return MAX_REGULAR_POND_COUNT;
    const stored = countPonds(pondIdsOf(previousState)).regular;
    return Math.min(MAX_REGULAR_POND_COUNT, Math.max(DEFAULT_FREE_POND_COUNT, stored));
};

/**
 * 계정 혜택 기준의 연못 수 검사. 문제가 없으면 null, 있으면 거절 이유를 돌려줍니다.
 *
 * - 일반 연못은 더 늘릴 수 없습니다. 서버에 저장되어 있던 수(최소 기본 2개)까지만 받습니다.
 *   예전에 젠 포인트로 산 연못(pond-3, pond-4)은 이미 저장되어 있으므로 계속 받습니다.
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
    // 구조 검사: 일반 연못은 4개까지, 유료 연못은 pond-paid-1 ~ pond-paid-4만 허용합니다.
    // 계정이 실제로 슬롯을 샀는지는 pondAllowanceError가 계정 혜택으로 따로 확인합니다.
    const pondCounts = countPonds(Object.keys(value.ponds));
    if (pondCounts.regular > MAX_REGULAR_POND_COUNT
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
