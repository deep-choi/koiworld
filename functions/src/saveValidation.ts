// 웹과 서버가 같은 기준으로 저장본을 검사합니다. 구버전의 선택 필드는
// 허용하되 코이·유전·좌표처럼 게임 실행에 필요한 구조의 손상은 거부합니다.
type Data = Record<string, any>;
const record = (value: unknown): value is Data =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value: unknown) => value === undefined || value === null || number(value);
const colors = new Set(['검정', '빨강', '노랑', '하양', '주황', '크림']);

export function isValidGameStateCore(value: unknown): boolean {
    if (!record(value) || !record(value.ponds) || typeof value.activePondId !== 'string'
        || !Object.hasOwn(value.ponds, value.activePondId)) return false;
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
