import { NEWS } from '../config/community';

export type NewsKind = 'notice' | 'update';

/** One notice or update post, from the server or bundled with the app. */
export interface NewsPost {
    id: string;
    kind: NewsKind;
    title: string;
    body: string;          // plain text; a blank line starts a new paragraph
    publishedAt: number;   // ms since epoch
    visible: boolean;      // hidden posts are only listed for admins
    pinned: boolean;       // pinned posts stay on top of the list
    fromApp?: boolean;     // bundled with the app (not yet on the server)
}

export const NEWS_TITLE_MAX = 100;
export const NEWS_BODY_MAX = 10000;

export const toParagraphs = (body: string): string[] =>
    body.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);

/** Pinned first, then newest first. */
export const sortPosts = (posts: NewsPost[]): NewsPost[] =>
    [...posts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt - a.publishedAt);

export const formatPostDate = (ms: number): string => {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};

/** yyyy-mm-dd in local time, for date inputs. */
export const toDateInput = (ms: number): string => formatPostDate(ms).split('.').join('-');

export const bundledPosts = (): NewsPost[] => sortPosts(NEWS.map(item => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.paragraphs.join('\n\n'),
    publishedAt: Date.parse(item.publishedAt),
    visible: true,
    pinned: false,
    fromApp: true,
})));

/**
 * The server is the source of truth once it has posts. Before that (or when it cannot be reached and
 * nothing is cached) the posts bundled with the app are shown.
 */
export const choosePosts = (server: NewsPost[] | null, cached: NewsPost[] | null): NewsPost[] => {
    if (server && server.length > 0) return sortPosts(server);
    if (!server && cached && cached.length > 0) return sortPosts(cached);
    return bundledPosts();
};

/** Bundled posts an admin has not put on the server yet (matched by id). */
export const missingBundledPosts = (server: NewsPost[]): NewsPost[] => {
    const ids = new Set(server.map(post => post.id));
    return bundledPosts().filter(post => !ids.has(post.id));
};
