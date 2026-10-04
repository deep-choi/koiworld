import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, ExternalLink, Megaphone, MessageCircle, NotebookText, Sparkles, X } from 'lucide-react';
import { COMMUNITY_LINKS, NEWS, communityUrl } from '../config/community';

export function CommunityModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const [view, setView] = useState<'menu' | 'notice' | 'update'>('menu');
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => { if (isOpen) panelRef.current?.focus(); }, [view, isOpen]);
    useEffect(() => {
        if (!isOpen) return;
        setView('menu');
        const previousFocus = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeRef.current();
            if (event.key !== 'Tab') return;
            const targets = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
            if (!targets?.length) return;
            const first = targets[0], last = targets[targets.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => { document.removeEventListener('keydown', handleKey); previousFocus?.focus(); };
    }, [isOpen]);
    if (!isOpen) return null;
    const row = 'flex w-full items-center gap-3 rounded-xl p-4 text-left transition-colors hover:bg-slate-50';
    return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
        <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="community-title" className="light-modal max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-slate-800 shadow-2xl outline-none" onClick={event => event.stopPropagation()}>
            <div className="flex items-center gap-3">
                {view !== 'menu' && <button type="button" onClick={() => setView('menu')} aria-label="소식 메뉴로 돌아가기" className="rounded-full p-2 hover:bg-slate-100"><ArrowLeft size={20} /></button>}
                <h2 id="community-title" className="flex-1 text-xl font-semibold">{view === 'menu' ? '소식·커뮤니티' : view === 'notice' ? '공지사항' : '업데이트'}</h2>
                <button type="button" onClick={onClose} aria-label="소식 닫기" className="rounded-full bg-slate-100 p-2 text-slate-500"><X size={18} /></button>
            </div>
            {view === 'menu' ? <>
                <p className="mb-4 mt-2 text-sm text-slate-500">연못의 새 소식과 함께하는 이야기</p>
                <div className="divide-y divide-slate-100">
                    <button type="button" className={row} onClick={() => setView('notice')}><Megaphone className="text-orange-500" size={22} /><span className="flex-1 font-medium">공지사항</span><ChevronRight size={18} className="text-slate-400" /></button>
                    <button type="button" className={row} onClick={() => setView('update')}><Sparkles className="text-amber-500" size={22} /><span className="flex-1 font-medium">업데이트</span><ChevronRight size={18} className="text-slate-400" /></button>
                </div>
                <p className="mb-1 mt-5 px-4 text-xs font-semibold text-slate-400">커뮤니티</p>
                {([
                    { label: '디스코드', url: COMMUNITY_LINKS.discord, Icon: MessageCircle, color: 'text-indigo-500' },
                    { label: '네이버 카페', url: COMMUNITY_LINKS.cafe, Icon: NotebookText, color: 'text-green-600' },
                ]).map(({ label, url, Icon, color }) => {
                    const href = communityUrl(url);
                    const content = <><Icon className={color} size={22} /><span className="flex-1 font-medium">{label}</span>{href ? <ExternalLink size={16} className="text-slate-400" /> : <span className="text-xs text-slate-400">준비 중</span>}</>;
                    return href ? <a key={label} className={row} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} 새 창에서 열기`}>{content}</a>
                        : <button key={label} type="button" className={`${row} cursor-default opacity-60`} disabled>{content}</button>;
                })}
                <p className="mt-6 text-center text-xs text-slate-400">Koiworld 1.0.5</p>
            </> : <div className="mt-5 space-y-5">
                {NEWS.filter(item => item.kind === view).length === 0 && <p className="py-10 text-center text-sm text-slate-500">아직 등록된 공지사항이 없어요.</p>}
                {NEWS.filter(item => item.kind === view).map(item => <article key={item.id} className="rounded-xl bg-slate-50 p-4">
                    <h3 className="font-semibold leading-6">{item.title}</h3>
                    <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">{item.paragraphs.map(text => <p key={text}>{text}</p>)}</div>
                </article>)}
            </div>}
        </div>
    </div>;
}
