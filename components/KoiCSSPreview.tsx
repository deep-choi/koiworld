import React from 'react';
import { Koi } from '../types';
import { getPhenotype, getDisplayColor, GENE_COLOR_MAP, calculateSpotPhenotype } from '../utils/genetics';

interface KoiCSSPreviewProps {
    koi: Koi;
    className?: string;
}

export const KoiCSSPreview: React.FC<KoiCSSPreviewProps> = ({ koi, className = "" }) => {
    const phenotype = getPhenotype(koi.genetics.baseColorGenes);
    const bodyColor = getDisplayColor(phenotype as any, koi.genetics.lightness, koi.genetics.saturation);
    const spotPhenotype = calculateSpotPhenotype(koi.genetics.spotPhenotypeGenes, koi);

    return (
        <div className={`relative flex items-center justify-center overflow-hidden bg-gray-900 rounded-full ${className}`}>
            {/* Body */}
            <div
                className="w-full h-full rounded-full relative"
                style={{ backgroundColor: bodyColor }}
            >
                {/* Spots */}
                {koi.genetics.spots.map((spot, i) => {
                    const size = spot.size;

                    return (
                        <div
                            key={i}
                            className="absolute rounded-full"
                            style={{
                                left: `${spot.x}%`,
                                top: `${spot.y}%`,
                                width: `${size}%`,
                                height: `${size}%`,
                                transform: 'translate(-50%, -50%)',
                                backgroundColor: GENE_COLOR_MAP[spot.color],
                                opacity: 1.0,
                                filter: `saturate(${(0.2 + spotPhenotype.colorSaturation * 1.8) * 100}%)`
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
};
