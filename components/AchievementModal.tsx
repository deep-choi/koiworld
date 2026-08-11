import React, { useState } from 'react';
import { X, Check, Lock, Star } from 'lucide-react';
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
        const tierOrder = ['novice', 'intermediate', 'advanced', 'legend'];
        return tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
    });

    const totalPoints = claimedIds.reduce((sum, id) => {
        const ach = achievements.find(a => a.id === id);
        return sum + (ach?.reward.achievementPoints || 0);
    }, 0);

    const clearedCount = filteredAchievements.filter(ach => unlockedIds.includes(ach.id)).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="light-modal bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[85svh] flex flex-col shadow-2xl overflow-hidden">
                {/* Header - Title, tabs, and score */}
                <div className="px-5 pt-5 pb-3 bg-white shrink-0">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="flex items-center gap-2 text-xl font-medium text-slate-900">
                            <Star className="w-6 h-6 text-[#f97316] fill-current" />
                            업적
                        </h2>
                        <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors flex items-center justify-center" aria-label="업적 닫기">
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="text-sm font-medium text-slate-500">
                            {clearedCount} / {filteredAchievements.length}
                        </span>
                        <div className="flex items-center gap-2 text-sm text-[#f97316] font-medium">
                            <Star className="w-4 h-4 fill-current" />
                            <span>{totalPoints.toLocaleString()} Pts</span>
                        </div>
                    </div>

                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 pt-4 bg-slate-50 light-scrollbar">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 mb-4">
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                aria-label={`${tab.label} 업적 보기`}
                                aria-pressed={activeTab === tab.id}
                                className={`px-3 py-2.5 rounded-lg font-medium transition-all whitespace-nowrap text-base ${tab.id === activeTab
                                    ? 'bg-[#f97316] text-white'
                                    : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {sortedAchievements.map((ach) => {
                            const isUnlocked = unlockedIds.includes(ach.id);
                            const isClaimed = claimedIds.includes(ach.id);
                            const isHidden = ach.isHidden && !isUnlocked;

                            return (
                                <div
                                    key={ach.id}
                                    className={`relative p-4 rounded-xl flex flex-col gap-2 transition-colors ${isUnlocked
                                        ? 'bg-white shadow-sm hover:bg-slate-50'
                                        : 'bg-white/60'
                                        }`}
                                >
                                    {/* Card Header: Icon & Title */}
                                    <div className="flex items-start gap-3">
                                        <div
                                            className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center border bg-slate-50 border-slate-200"
                                        >
                                            {isHidden ? (
                                                <Lock className="w-5 h-5 text-slate-400" />
                                            ) : (
                                                <Star className={`w-5 h-5 ${isUnlocked ? 'text-[#f97316] fill-current' : 'text-slate-300'}`} />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start">
                                                <h3 className={`font-medium leading-tight ${isUnlocked ? 'text-slate-900' : 'text-slate-500'}`}>
                                                    {ach.title}
                                                </h3>
                                                {/* Optional: Check icon next to title (kept for quick scan) */}
                                                {isClaimed && (
                                                    <div className="w-5 h-5 bg-emerald-50 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                                                        <Check className="w-3 h-3 text-emerald-500" strokeWidth={2} />
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-500 mt-1 leading-snug line-clamp-2">
                                                {isHidden ? "???" : ach.description}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Compact reward and action row */}
                                    <div className="mt-1 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-xs">
                                            <div className="flex items-center gap-1 text-[#f97316] font-medium">
                                                <Star className="w-3.5 h-3.5 fill-current" />
                                                <span>+{ach.reward.achievementPoints} Pts</span>
                                            </div>
                                        </div>

                                        {isUnlocked ? (
                                                isClaimed ? (
                                                    <button
                                                        disabled
                                                        className="h-8 px-3 bg-slate-100 text-slate-400 text-xs font-medium rounded border border-slate-200 cursor-default flex items-center justify-center gap-1 whitespace-nowrap"
                                                        aria-label={`${ach.title} 보상 획득 완료`}
                                                    >
                                                        <Check className="w-3 h-3" /> 완료
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => onClaim(ach.id, ach.reward)}
                                                        className="h-8 px-3 bg-[#f97316] hover:brightness-95 text-white text-xs font-medium rounded transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
                                                        aria-label={`${ach.title} 보상 받기`}
                                                    >
                                                        보상 받기
                                                    </button>
                                                )
                                            ) : (
                                                <div className="h-8 px-3 flex items-center justify-center bg-slate-100 rounded text-slate-400 text-xs whitespace-nowrap">
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
                        <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                            <Lock className="w-12 h-12 mb-2 opacity-20" />
                            <p>이 등급에는 해당하는 업적이 없습니다.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
