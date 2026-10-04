import { GeneType, Koi, SpotPhenotype } from '../types';
import { GENE_COLOR_MAP, getPhenotype, getDisplayColor, calculateSpotPhenotype, getSpotColorWithSaturation } from './genetics';
import type { KoiColors, RenderSpot } from './koiRenderer';

export interface KoiRenderStyle {
    colors: KoiColors;
    spots: RenderSpot[];
    phenotype: SpotPhenotype;
}

const hsla = (h: number, s: number, l: number, a: number) =>
    `hsla(${h}, ${Math.max(0, Math.min(100, s)).toFixed(1)}%, ${Math.max(0, Math.min(100, l)).toFixed(1)}%, ${a})`;

const parseHsla = (color: string): { h: number, s: number, l: number } => {
    const match = color.match(/hsla?\(\s*([-.\d]+)\s*,\s*([.\d]+)%\s*,\s*([.\d]+)%/);
    if (!match) return { h: 0, s: 0, l: 50 };
    return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
};

/** Fin and shading colours derived from the expressed body colour. */
const buildColors = (phenotype: GeneType, body: string): KoiColors => {
    if (phenotype === GeneType.CREAM) {
        return {
            body,
            shade: 'rgba(70, 110, 125, 0.16)',
            light: 'rgba(255, 255, 255, 0.35)',
            fin: 'rgba(250, 252, 251, 0.68)',
            ray: 'rgba(140, 170, 182, 0.55)',
            membrane: 'rgba(236, 243, 245, 0.6)',
            ridge: 'rgba(160, 182, 190, 0.55)',
            whisker: 'rgba(196, 176, 152, 0.95)',
        };
    }
    if (phenotype === GeneType.BLACK) {
        return {
            body,
            shade: 'rgba(0, 0, 0, 0.32)',
            light: 'rgba(255, 220, 200, 0.07)',
            fin: 'rgba(62, 46, 41, 0.72)',
            ray: 'rgba(130, 100, 88, 0.6)',
            membrane: 'rgba(66, 50, 45, 0.72)',
            ridge: 'rgba(12, 8, 7, 0.55)',
            whisker: 'rgba(78, 60, 54, 0.95)',
        };
    }
    const { h, s, l } = parseHsla(body);
    return {
        body,
        shade: hsla(h, s, l - 22, 0.32),
        light: 'rgba(255, 255, 255, 0.16)',
        fin: hsla(h, s * 0.95, Math.min(l + 8, 88), 0.68),
        ray: hsla(h, s, l - 16, 0.6),
        membrane: hsla(h, s * 0.9, Math.min(l + 6, 86), 0.6),
        ridge: hsla(h, s, l - 14, 0.55),
        whisker: hsla(h, s * 0.85, l - 8, 0.95),
    };
};

/** Everything KoiRenderer needs to draw one koi, computed once from its genetics. */
export const buildKoiRenderStyle = (koi: Koi): KoiRenderStyle => {
    const { genetics } = koi;
    const basePhenotype = getPhenotype(genetics.baseColorGenes);
    const body = getDisplayColor(basePhenotype, genetics.lightness ?? 50, genetics.saturation ?? 50);
    const phenotype = calculateSpotPhenotype(genetics.spotPhenotypeGenes, koi);
    const colorSaturation = phenotype?.colorSaturation ?? 0.5;

    const spots: RenderSpot[] = genetics.spots.map((spot, idx) => ({
        x: spot.x,
        y: spot.y,
        size: spot.size,
        shape: spot.shape,
        color: getSpotColorWithSaturation(GENE_COLOR_MAP[spot.color], colorSaturation, idx),
    }));

    return { colors: buildColors(basePhenotype, body), spots, phenotype };
};
