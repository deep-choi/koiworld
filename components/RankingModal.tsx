import React, { useEffect, useState } from 'react';
import { X, Trophy, Medal, RotateCw, AlertCircle, Award, User } from 'lucide-react';
import { getRankings } from '../services/cloudData';
import { CloudUserDocument } from '../types/online';

interface RankingModalProps {
    isOpen: boolean;
    onClose: () => void;
    userNickname?: string;
    myHonorPoints: number;
    isLoggedIn: boolean;
    currUserId?: string;
    myAchievementPoints?: number; // New Prop for current user
}

type RankingTab = 'trophy' | 'achievement';

const getProfileImageUrl = (photoURL?: string | null) => {
    const trimmed = photoURL?.trim();
    if (!trimmed) return null;
    return trimmed.replace(/^http:\/\//i, 'https://');
};

const getInitial = (nickname?: string | null) => {
    const trimmed = nickname?.trim();
    return trimmed ? trimmed.slice(0, 1).toUpperCase() : null;
};

export const RankingModal: React.FC<RankingModalProps> = ({ isOpen, onClose, userNickname, myHonorPoints, isLoggedIn, currUserId, myAchievementPoints = 0 }) => {
    const [activeTab, setActiveTab] = useState<RankingTab>('trophy');
    const [rankings, setRankings] = useState<CloudUserDocument[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const fetchRankings = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const sortBy = activeTab === 'trophy' ? 'honorPoints' : 'achievementPoints';
            const data = await getRankings(sortBy, 20);
            setRankings(data);
            setLastUpdated(new Date());
        } catch (err: any) {
            console.error('Failed to fetch rankings:', err);
            setError(err.message || '랭킹을 가져오는데 실패했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchRankings();
        }
    }, [isOpen, activeTab]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-2xl max-w-sm w-full max-h-[85svh] flex flex-col border border-gray-700 shadow-2xl overflow-hidden animate-fade-in-up"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 bg-gray-900 border-b border-gray-700 flex flex-col gap-3 shrink-0">
                    <div className="flex justify-between items-center">
                        <div className="flex flex-col">
                            <h2 className="text-xl font-bold text-yellow-400 flex items-center gap-2 leading-none">
                                <Trophy size={22} className="text-yellow-400" />
                                명예의 전당
                            </h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchRankings}
                                disabled={isLoading}
                                className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-yellow-400 transition-colors disabled:opacity-50"
                                title="새로고침"
                            >
                                <RotateCw size={20} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                            <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
                        <button
                            onClick={() => setActiveTab('trophy')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-all ${activeTab === 'trophy'
                                ? 'bg-yellow-500 text-black shadow'
                                : 'text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            <Trophy size={14} />
                            트로피 랭킹
                        </button>
                        <button
                            onClick={() => setActiveTab('achievement')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-all ${activeTab === 'achievement'
                                ? 'bg-purple-500 text-white shadow'
                                : 'text-gray-400 hover:text-gray-200'
                                }`}
                        >
                            <Award size={14} />
                            업적 랭킹
                        </button>
                    </div>

                    {lastUpdated && (
                        <span className="text-[10px] text-gray-500 text-right">
                            {lastUpdated.toLocaleTimeString()} 기준
                        </span>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <div className={`w-10 h-10 border-4 rounded-full animate-spin ${activeTab === 'trophy' ? 'border-yellow-400/20 border-t-yellow-400' : 'border-purple-400/20 border-t-purple-400'}`}></div>
                            <p className="text-gray-400 font-medium text-sm">순위를 불러오는 중...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center p-4">
                            <AlertCircle size={40} className="text-red-400" />
                            <div>
                                <p className="text-red-400 font-bold">오류 발생</p>
                                <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                                    {error.includes('index') ?
                                        '랭킹 쿼리 구성이 잘못되었습니다. Firestore 인덱스를 확인해주세요.' :
                                        '서버와의 통신이 원활하지 않습니다. 잠시 후 다시 시도해주세요.'}
                                </p>
                            </div>
                            <button
                                onClick={fetchRankings}
                                className="mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-bold transition-colors"
                            >
                                다시 시도
                            </button>
                        </div>
                    ) : rankings.length === 0 ? (
                        <div className="text-center py-20 text-gray-500 text-sm">
                            아직 기록이 없습니다.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {rankings.map((user, index) => {
                                const rank = index + 1;
                                const isCurrentUser = currUserId && user.uid === currUserId;
                                const displayValue = activeTab === 'trophy'
                                    ? (user.gameData?.honorPoints || 0)
                                    : (user.gameData?.achievementPoints || 0);
                                const nickname = user.profile?.nickname || `게스트_${user.uid?.slice(0, 5) || '???'}`;
                                const photoURL = getProfileImageUrl(user.profile?.photoURL);
                                const initial = getInitial(nickname);

                                return (
                                    <div
                                        key={user.uid || index}
                                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isCurrentUser
                                            ? activeTab === 'trophy' ? 'ring-2 ring-yellow-400 bg-yellow-400/20' : 'ring-2 ring-purple-400 bg-purple-400/20'
                                            : rank === 1 ? 'bg-yellow-400/10 border-yellow-400/30' :
                                                rank === 2 ? 'bg-gray-300/10 border-gray-300/30' :
                                                    rank === 3 ? 'bg-orange-400/10 border-orange-400/30' :
                                                        'bg-gray-700/30 border-gray-700/50'
                                            }`}
                                    >
                                        <div className="w-8 flex justify-center shrink-0">
                                            {rank === 1 ? <Medal className="text-yellow-400" size={24} /> :
                                                rank === 2 ? <Medal className="text-gray-300" size={24} /> :
                                                    rank === 3 ? <Medal className="text-orange-400" size={24} /> :
                                                        <span className="text-gray-500 font-bold">{rank}</span>}
                                        </div>

                                        <div className={`w-9 h-9 rounded-full overflow-hidden shrink-0 border bg-gray-900 flex items-center justify-center ${isCurrentUser
                                            ? activeTab === 'trophy' ? 'border-yellow-300/70' : 'border-purple-300/70'
                                            : 'border-white/10'
                                            }`}>
                                            {photoURL ? (
                                                <img
                                                    src={photoURL}
                                                    alt={`${nickname} 프로필`}
                                                    className="w-full h-full object-cover"
                                                    referrerPolicy="no-referrer"
                                                />
                                            ) : initial ? (
                                                <span className="text-xs font-black text-gray-200">{initial}</span>
                                            ) : (
                                                <User size={17} className="text-gray-500" />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className={`text-sm font-bold truncate ${isCurrentUser ? 'text-white' : 'text-gray-200'}`}>
                                                {nickname}
                                                {isCurrentUser && <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase ${activeTab === 'trophy' ? 'bg-yellow-600' : 'bg-purple-600'}`}>Me</span>}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {activeTab === 'trophy' ? (
                                                <Trophy size={14} className="text-yellow-400" />
                                            ) : (
                                                <Award size={14} className="text-purple-400" />
                                            )}
                                            <span className={`text-base font-black ${activeTab === 'trophy' ? 'text-yellow-500' : 'text-purple-400'}`}>
                                                {displayValue.toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* User Status Bar */}
                <div className="p-4 bg-gray-900 border-t border-gray-700">
                    {!isLoggedIn ? (
                        <div className="flex items-center gap-2 text-orange-400 justify-center leading-tight">
                            <AlertCircle size={16} />
                            <span className="text-xs font-medium">로그인을 해야 랭킹에 등록됩니다.</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">나의 기록</span>
                                <span className="text-sm font-bold text-white truncate max-w-[120px]">{userNickname}</span>
                            </div>
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${activeTab === 'trophy' ? 'bg-yellow-400/10 border-yellow-400/20' : 'bg-purple-400/10 border-purple-400/20'}`}>
                                {activeTab === 'trophy' ? (
                                    <>
                                        <Trophy size={16} className="text-yellow-400" />
                                        <span className="text-lg font-black text-yellow-500">{myHonorPoints.toLocaleString()}</span>
                                    </>
                                ) : (
                                    <>
                                        <Award size={16} className="text-purple-400" />
                                        <span className="text-lg font-black text-purple-400">{(myAchievementPoints || 0).toLocaleString()}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 bg-gray-900/50 border-t border-gray-800 text-center text-[9px] text-gray-600 leading-tight">
                    랭킹은 20위까지만 표시됩니다.
                </div>
            </div>
        </div>
    );
};
