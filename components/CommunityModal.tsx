import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, ExternalLink, Megaphone, MessageCircle, NotebookText, Sparkles, X } from 'lucide-react';
import { MENU_ICON, MENU_ICON_SIZE, MENU_LABEL, MENU_LIST, MENU_ROW, MENU_TRAILING, MODAL_BACK, MODAL_CLOSE, MODAL_TITLE } from './menuStyles';
import { COMMUNITY_LINKS, communityUrl } from '../config/community';
import { KIND_LABEL, NewsDetail, NewsEditor, NewsList, uploadBundledPosts, useNews } from './NewsBoard';
import type { NewsDraft } from '../services/news';
import type { NewsKind, NewsPost } from '../utils/newsPosts';

export type CommunitySection = 'news' | 'community';

const TITLES = { news: '소식', community: '커뮤니티', notice: '공지사항', update: '업데이트' } as const;

// Inside 공지사항 / 업데이트: the post list, one post, or the editor (admins only).
type BoardScreen =
    | { type: 'list' }
    | { type: 'post'; post: NewsPost }
    | { type: 'edit'; draft: NewsDraft & { onServer: boolean }; from?: NewsPost };

const newDraft = (kind: NewsKind): NewsDraft & { onServer: boolean } =>
    ({ kind, title: '', body: '', publishedAt: Date.now(), visible: true, pinned: false, onServer: false });

const draftOf = (post: NewsPost): NewsDraft & { onServer: boolean } => ({
    id: post.id, kind: post.kind, title: post.title, body: post.body,
    publishedAt: post.publishedAt, visible: post.visible, pinned: post.pinned, onServer: !post.fromApp,
});

export function CommunityModal({ isOpen, onClose, onBack, section = 'news' }: { isOpen: boolean; onClose: () => void; onBack?: () => void; section?: CommunitySection }) {
    const [view, setView] = useState<CommunitySection | NewsKind>(section);
    const [screen, setScreen] = useState<BoardScreen>({ type: 'list' });
    const [uploading, setUploading] = useState(false);
    const news = useNews(isOpen);
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const editingRef = useRef(false);
    editingRef.current = screen.type === 'edit';
    useEffect(() => { if (isOpen) panelRef.current?.focus(); }, [view, screen.type, isOpen]);
    useEffect(() => {
        if (!isOpen) return;
        setView(section);
        setScreen({ type: 'list' });
        const previousFocus = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();
        const handleKey = (event: KeyboardEvent) => {
            // Escape never throws away a post being written.
            if (event.key === 'Escape' && !editingRef.current) closeRef.current();
            if (event.key !== 'Tab') return;
            const targets = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea');
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
    }, [isOpen, section]);
    if (!isOpen) return null;

    const onBoard = view === 'notice' || view === 'update';
    const openBoard = (kind: NewsKind) => { setView(kind); setScreen({ type: 'list' }); };
    const goBack = () => {
        if (screen.type === 'edit') setScreen(screen.from ? { type: 'post', post: screen.from } : { type: 'list' });
        else if (screen.type === 'post') setScreen({ type: 'list' });
        else setView('news');
    };
    const title = onBoard && screen.type === 'edit' ? (screen.draft.id ? '글 수정' : '글쓰기') : TITLES[view];
    const backToList = async () => {
        setScreen({ type: 'list' });
        await news.reload();
    };
    const uploadBundled = async () => {
        setUploading(true);
        try { await uploadBundledPosts(news.unpublished); } catch { /* the button stays, so it can be tried again */ }
        setUploading(false);
        await news.reload();
    };

    return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => { if (!editingRef.current) onClose(); }}>
        <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="community-title" className="light-modal max-h-[88svh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-slate-800 shadow-2xl outline-none" onClick={event => event.stopPropagation()}>
            <div className="flex items-center gap-2">
                {onBoard
                    ? <button type="button" onClick={goBack} aria-label="뒤로 가기" className={MODAL_BACK}><ArrowLeft size={20} /></button>
                    : onBack && <button type="button" onClick={onBack} aria-label="설정으로 돌아가기" className={MODAL_BACK}><ArrowLeft size={20} /></button>}
                <h2 id="community-title" className={MODAL_TITLE}>{title}</h2>
                <button type="button" onClick={onClose} aria-label={`${title} 닫기`} className={MODAL_CLOSE}><X size={18} /></button>
            </div>
            {view === 'news' ? <>
                <p className="mb-4 mt-2 text-sm text-slate-500">연못의 새 소식</p>
                <div className={MENU_LIST}>
                    <button type="button" className={MENU_ROW} onClick={() => openBoard('notice')}><Megaphone className={MENU_ICON} size={MENU_ICON_SIZE} /><span className={MENU_LABEL}>공지사항</span><ChevronRight size={18} className={MENU_TRAILING} /></button>
                    <button type="button" className={MENU_ROW} onClick={() => openBoard('update')}><Sparkles className={MENU_ICON} size={MENU_ICON_SIZE} /><span className={MENU_LABEL}>업데이트</span><ChevronRight size={18} className={MENU_TRAILING} /></button>
                </div>
                <p className="mt-6 text-center text-xs text-slate-400">Koiworld 1.0.7{news.isAdmin && ' · 관리자'}</p>
            </> : view === 'community' ? <>
                <p className="mb-4 mt-2 text-sm text-slate-500">함께하는 이야기</p>
                <div className={MENU_LIST}>
                {([
                    { label: '디스코드', url: COMMUNITY_LINKS.discord, Icon: MessageCircle },
                    { label: '네이버 카페', url: COMMUNITY_LINKS.cafe, Icon: NotebookText },
                ]).map(({ label, url, Icon }) => {
                    const href = communityUrl(url);
                    const content = <><Icon className={MENU_ICON} size={MENU_ICON_SIZE} /><span className={MENU_LABEL}>{label}</span>{href ? <ExternalLink size={16} className={MENU_TRAILING} /> : <span className={`text-xs ${MENU_TRAILING}`}>준비 중</span>}</>;
                    return href ? <a key={label} className={MENU_ROW} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} 새 창에서 열기`}>{content}</a>
                        : <button key={label} type="button" className={MENU_ROW} disabled>{content}</button>;
                })}
                </div>
                <p className="mt-6 text-center text-xs text-slate-400">Koiworld 1.0.7</p>
            </> : screen.type === 'post'
                ? <NewsDetail post={screen.post} isAdmin={news.isAdmin}
                    onEdit={() => setScreen({ type: 'edit', draft: draftOf(screen.post), from: screen.post })} />
                : screen.type === 'edit'
                    ? <NewsEditor key={screen.draft.id ?? 'new'} initial={screen.draft}
                        onCancel={goBack} onSaved={backToList} onDeleted={backToList} />
                    : <NewsList kind={view} posts={news.posts} isAdmin={news.isAdmin} loading={news.loading || uploading}
                        unpublished={uploading ? [] : news.unpublished}
                        onOpen={post => setScreen({ type: 'post', post })}
                        onWrite={() => setScreen({ type: 'edit', draft: newDraft(view) })}
                        onUpload={uploadBundled} />}
            {onBoard && screen.type === 'list' && <p className="mt-6 text-center text-xs text-slate-400">{KIND_LABEL[view]} · Koiworld 1.0.7</p>}
        </div>
    </div>;
}
