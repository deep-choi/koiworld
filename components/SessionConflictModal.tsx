import React from 'react';
import './SessionConflictModal.css';

interface SessionConflictModalProps {
    isOpen: boolean;
    onResolve: () => void; // 여기서 계속하기
    onLogout: () => void;  // 종료/로그아웃
}

export const SessionConflictModal: React.FC<SessionConflictModalProps> = ({ isOpen, onResolve, onLogout }) => {
    if (!isOpen) return null;

    return (
        <div className="session-modal-overlay">
            <div className="session-modal-content">
                <div className="warning-icon">⚠️</div>
                <h2>다른 기기 접속 감지</h2>
                <p>
                    다른 기기에서 이 계정으로 접속했습니다.<br />
                    여기서 게임을 계속하시겠습니까?
                </p>
                <div className="warning-text">
                    계속하면 다른 기기의 접속이 끊어집니다.
                </div>

                <div className="button-group">
                    <button className="btn-logout" onClick={onLogout} aria-label="이 기기에서 게임 종료하기">
                        종료 하기
                    </button>
                    <button className="btn-resolve" onClick={onResolve} aria-label="이 기기에서 게임 계속하기">
                        여기서 계속하기
                    </button>
                </div>
            </div>
        </div>
    );
};
