import React, { useState } from 'react';
import { X, Check, Lock, Star, Medal, Trophy } from 'lucide-react';
import { Achievement } from '../types';

interface AchievementModalProps {
    isOpen: boolean;
    onClose: () => void;
    achievements: Achievement[];
    unlockedIds: string[];
    claimedIds: string[];
    onClaim: (id: string, reward: Achievement['reward']) => void;
}

const TABS = [
    { id: 'novice', label: '초심자' },
    { id: 'intermediate', label: '중급자' },
    { id: 'advanced', label: '고수' },
    { id: 'master', label: '마스터' },
    { id: 'legend', label: '전설' },
];

export const AchievementModal: React.FC<AchievementModalProps> = ({
    isOpen,
    onClose,
    achievements,
    unlockedIds,
    claimedIds,
    onClaim
}) => {
    const [activeTab, setActiveTab] = useState('novice');

    if (!isOpen) return null;

    const filteredAchievements = achievements.filter(ach =>
        activeTab === 'all' || ach.tier === activeTab
    );

    const sortedAchievements = [...filteredAchievements].sort((a, b) => {
        const aUnlocked = unlockedIds.includes(a.id);
        const bUnlocked = unlockedIds.includes(b.id);
        const aClaimed = claimedIds.includes(a.id);
        const bClaimed = claimedIds.includes(b.id);

        // Priority 1: Unlocked & Unclaimed (Active Rewards)
        if (aUnlocked && !aClaimed && (!bUnlocked || bClaimed)) return -1;
        if (bUnlocked && !bClaimed && (!aUnlocked || aClaimed)) return 1;

        // Priority 2: Unlocked & Claimed (Completed) vs Locked
        if (aUnlocked && !bUnlocked) return -1;
        if (!aUnlocked && bUnlocked) return 1;

        // Priority 3: Tier Order
        const tierOrder = ['novice', 'intermediate', 'advanced', 'master', 'legend'];
        return tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
    });

    const totalPoints = claimedIds.reduce((sum, id) => {
        const ach = achievements.find(a => a.id === id);
        return sum + (ach?.reward.achievementPoints || 0);
    }, 0);

    const clearedCount = filteredAchievements.filter(ach => unlockedIds.includes(ach.id)).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-lg w-full max-w-4xl max-h-[85svh] flex flex-col shadow-2xl glass-panel">
                {/* Header - Title, tabs, and score */}
                <div className="p-3 border-b border-gray-700 bg-gray-900 rounded-t-lg glass-header">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="flex items-center gap-2 text-xl font-bold text-yellow-300">
                            <Medal className="w-6 h-6" />
                            업적
                        </h2>
                        <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-full transition-all" aria-label="업적 닫기">
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
                            {TABS.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    aria-label={`${tab.label} 업적 보기`}
                                    aria-pressed={activeTab === tab.id}
                                    className={`px-4 py-2 rounded-md font-bold transition-all whitespace-nowrap text-sm border ${activeTab === tab.id
                                        ? 'bg-yellow-600 text-white border-yellow-500'
                                        : 'bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:text-white hover:border-white/30'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <span className="text-sm font-bold text-white/80">
                            {clearedCount} / {filteredAchievements.length}
                        </span>
                        <div className="flex items-center gap-2 text-sm text-yellow-300 font-bold">
                            <Star className="w-4 h-4 fill-current" />
                            <span>{totalPoints.toLocaleString()} Pts</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {sortedAchievements.map((ach) => {
                            const isUnlocked = unlockedIds.includes(ach.id);
                            const isClaimed = claimedIds.includes(ach.id);
                            const isHidden = ach.isHidden && !isUnlocked;

                            return (
                                <div
                                    key={ach.id}
                                    className={`relative p-3 rounded-lg border flex flex-col gap-2 transition-colors ${isUnlocked
                                        ? 'bg-white/10 border-white/25 shadow-lg hover:bg-white/20 hover:border-white/40'
                                        : 'bg-white/5 border-white/10 opacity-60'
                                        }`}
                                >
                                    {/* Card Header: Icon & Title */}
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center border bg-white/10 border-white/20"
                                            style={{ borderColor: isUnlocked ? ach.displayColor : undefined }}
                                        >
                                            {isHidden ? (
                                                <Lock className="w-5 h-5 text-gray-500" />
                                            ) : (
                                                <Medal
                                                    className="w-5 h-5"
                                                    style={{
                                                        color: ach.displayColor || '#ffd700',
                                                        filter: isUnlocked ? 'drop-shadow(0 0 3px currentColor)' : 'grayscale(100%)'
                                                    }}
                                                />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start">
                                                <h3 className={`font-bold leading-tight ${isUnlocked ? 'text-white' : 'text-gray-500'}`}>
                                                    {ach.title}
                                                </h3>
                                                {/* Optional: Check icon next to title (kept for quick scan) */}
                                                {isClaimed && (
                                                    <div className="w-5 h-5 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                                                        <Check className="w-3 h-3 text-green-400" strokeWidth={3} />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-400 mt-1 leading-snug line-clamp-2">
                                                {isHidden ? "???" : ach.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Compact reward and action row */}
                                    <div className="mt-1 pt-2 border-t border-white/20 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs">
                                            <div className="flex items-center gap-1 text-yellow-300 font-extrabold">
                                                <Trophy className="w-3.5 h-3.5 fill-current" />
                                                <span>+{ach.reward.achievementPoints} Pts</span>
                                            </div>
                                            {ach.reward.items && ach.reward.items.length > 0 && (
                                                <div className="flex items-center gap-1 text-green-400 font-bold whitespace-nowrap">
                                                    <span>
                                                        {ach.reward.items.map(i => i.type === 'corn' ? `🌽 ${i.count}` : `${i.type} x${i.count}`).join(', ')}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {isUnlocked ? (
                                                isClaimed ? (
                                                    <button
                                                        disabled
                                                        className="h-8 px-3 bg-gray-800 text-gray-500 text-xs font-bold rounded border border-gray-700 cursor-default flex items-center justify-center gap-1 whitespace-nowrap"
                                                        aria-label={`${ach.title} 보상 획득 완료`}
                                                    >
                                                        <Check className="w-3 h-3" /> 완료
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => onClaim(ach.id, ach.reward)}
                                                        className="h-8 px-3 bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-bold rounded transition-colors shadow-md flex items-center justify-center gap-1 whitespace-nowrap"
                                                        aria-label={`${ach.title} 보상 받기`}
                                                    >
                                                        보상 받기
                                                    </button>
                                                )
                                            ) : (
                                                <div className="h-8 px-3 flex items-center justify-center bg-gray-800/50 rounded border-0 text-gray-600 text-[10px] whitespace-nowrap">
                                                    <Lock className="w-3 h-3 mr-1" />
                                                    잠김
                                                </div>
                                            )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {sortedAchievements.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                            <Lock className="w-12 h-12 mb-2 opacity-20" />
                            <p>이 등급에는 해당하는 업적이 없습니다.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
