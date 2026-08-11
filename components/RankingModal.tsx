import React, { useEffect, useState } from 'react';
import { X, Trophy, RotateCw, AlertCircle, Award, User } from 'lucide-react';
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

const RankingAvatar: React.FC<{ photoURL: string | null; nickname: string }> = ({ photoURL, nickname }) => {
    const [hasImageError, setHasImageError] = useState(false);
    const initial = getInitial(nickname);

    useEffect(() => {
        setHasImageError(false);
    }, [photoURL]);

    return (
        <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-slate-200 bg-slate-50 flex items-center justify-center">
            {photoURL && !hasImageError ? (
                <img
                    src={photoURL}
                    alt={`${nickname} 프로필`}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setHasImageError(true)}
                />
            ) : initial ? (
                <span className="text-sm font-medium text-slate-600">{initial}</span>
            ) : (
                <User size={18} className="text-slate-400" />
            )}
        </div>
    );
};

export const RankingModal: React.FC<RankingModalProps> = ({ isOpen, onClose, userNickname, myHonorPoints, isLoggedIn, currUserId, myAchievementPoints = 0 }) => {
    const [activeTab, setActiveTab] = useState<RankingTab>('achievement');
    const [rankings, setRankings] = useState<CloudUserDocument[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const currentUserRank = currUserId
        ? rankings.findIndex(user => user.uid === currUserId) + 1
        : 0;

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
                className="light-modal bg-white rounded-2xl max-w-md w-full max-h-[85svh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden animate-fade-in-up"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-5 bg-white flex flex-col gap-5 shrink-0">
                    <div className="flex justify-between items-center">
                        <div className="flex flex-col">
                            <h2 className="text-xl font-medium text-slate-900 flex items-center gap-2 leading-none">
                                <Trophy size={22} className="text-orange-500" />
                                명예의 전당
                            </h2>
                        </div>
                        <div className="flex items-center gap-2">
                            {lastUpdated && (
                                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                    {lastUpdated.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 기준
                                </span>
                            )}
                            <button
                                onClick={fetchRankings}
                                disabled={isLoading}
                                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors flex items-center justify-center disabled:opacity-50"
                                title="새로고침"
                                aria-label="랭킹 새로고침"
                            >
                                <RotateCw size={20} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                            <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors flex items-center justify-center" aria-label="랭킹 닫기">
                                <X size={24} />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1">
                        <button
                            onClick={() => setActiveTab('achievement')}
                            aria-label="업적 랭킹 보기"
                            aria-pressed={activeTab === 'achievement'}
                            className={`flex-1 py-2.5 px-2 text-base font-medium rounded-lg flex items-center justify-center gap-2 transition-colors ${activeTab === 'achievement'
                                ? 'bg-orange-500 text-white'
                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                }`}
                        >
                            <Award size={16} />
                            업적 랭킹
                        </button>
                        <button
                            onClick={() => setActiveTab('trophy')}
                            aria-label="트로피 랭킹 보기"
                            aria-pressed={activeTab === 'trophy'}
                            className={`flex-1 py-2.5 px-2 text-base font-medium rounded-lg flex items-center justify-center gap-2 transition-colors ${activeTab === 'trophy'
                                ? 'bg-orange-500 text-white'
                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                }`}
                        >
                            <Trophy size={16} />
                            트로피 랭킹
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto light-scrollbar px-5">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <div className="w-10 h-10 border-4 border-orange-100 border-t-orange-500 rounded-full animate-spin"></div>
                            <p className="text-slate-500 text-sm">순위를 불러오는 중...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center p-4">
                            <AlertCircle size={40} className="text-red-400" />
                            <div>
                                <p className="text-red-500 font-medium">오류 발생</p>
                                <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                                    {error.includes('index') ?
                                        '랭킹 쿼리 구성이 잘못되었습니다. Firestore 인덱스를 확인해주세요.' :
                                        '서버와의 통신이 원활하지 않습니다. 잠시 후 다시 시도해주세요.'}
                                </p>
                            </div>
                            <button
                                onClick={fetchRankings}
                                className="mt-2 px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
                                aria-label="랭킹 다시 불러오기"
                            >
                                다시 시도
                            </button>
                        </div>
                    ) : rankings.length === 0 ? (
                        <div className="text-center py-20 text-slate-500 text-sm">
                            아직 기록이 없습니다.
                        </div>
                    ) : (
                        <div className="-mx-5">
                            {rankings.map((user, index) => {
                                const rank = index + 1;
                                const isCurrentUser = currUserId && user.uid === currUserId;
                                const displayValue = activeTab === 'trophy'
                                    ? (user.gameData?.honorPoints || 0)
                                    : (user.gameData?.achievementPoints || 0);
                                const nickname = user.profile?.nickname || `게스트_${user.uid?.slice(0, 5) || '???'}`;
                                const photoURL = getProfileImageUrl(user.profile?.photoURL);

                                return (
                                    <div
                                        key={user.uid || index}
                                        className="flex items-center gap-4 px-5 py-[16px] border-b border-slate-100 transition-colors hover:bg-slate-50"
                                    >
                                        <div className="w-10 flex justify-center shrink-0">
                                            <span className={`text-sm font-medium ${rank <= 3 ? 'text-orange-500' : 'text-slate-400'}`}>
                                                {rank}위
                                            </span>
                                        </div>

                                        <RankingAvatar photoURL={photoURL} nickname={nickname} />

                                        <div className="flex-1 min-w-0">
                                            <div className="text-base font-medium truncate text-slate-800">
                                                {nickname}
                                            {isCurrentUser && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase bg-orange-100 text-orange-700">Me</span>}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {activeTab === 'trophy' ? (
                                            <Trophy size={14} className="text-orange-500" />
                                            ) : (
                                            <Award size={14} className="text-orange-500" />
                                            )}
                                            <span className="text-base font-medium text-orange-600">
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
                <div className="p-5 bg-slate-50 border-t border-slate-100">
                    {!isLoggedIn ? (
                        <div className="flex items-center gap-2 text-slate-500 justify-center leading-tight">
                            <AlertCircle size={16} className="text-orange-500" />
                            <span className="text-xs">로그인을 해야 랭킹에 등록됩니다.</span>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="text-base font-medium text-slate-900 truncate max-w-[160px]">{userNickname}</span>
                                <span className="text-sm font-medium text-orange-600 whitespace-nowrap">
                                    {currentUserRank > 0 ? `${currentUserRank}위` : '순위 밖'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-orange-600">
                                {activeTab === 'trophy' ? (
                                    <>
                                        <Trophy size={16} className="text-orange-500" />
                                        <span className="text-lg font-medium text-orange-600">{myHonorPoints.toLocaleString()}</span>
                                    </>
                                ) : (
                                    <>
                                        <Award size={16} className="text-orange-500" />
                                        <span className="text-lg font-medium text-orange-600">{(myAchievementPoints || 0).toLocaleString()}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};
