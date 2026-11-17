// The party's message board. Because all four bots are ours, they coordinate here
// instead of through in-game DMs: it is instant, works at any distance, is immune to
// outside players, and the dashboard can show it. Posts are addressed to 'all' or to
// one member, but anyone can read everything.
import { emit } from './events';
import { load, save } from './store';

export interface Post {
    id: number;
    t: number;
    from: string;
    to: string;
    text: string;
    replyTo?: number;
    /** Posted during a council round. */
    council?: number;
    /** The sender needs the recipient to change what they are doing now: it interrupts them. */
    urgent?: boolean;
}

const MAX_TEXT = 280;
const MAX_POSTS_PER_HOUR = 30;

const state = load('board', { posts: [] as Post[], cursor: {} as Record<string, number>, nextId: 1 });
const sentLog = new Map<string, number[]>();
const listeners = new Set<(p: Post) => void>();

export function post(from: string, to: string, text: string, opts: { replyTo?: number; council?: number; urgent?: boolean } = {}): Post | null {
    const now = Date.now();
    const recent = (sentLog.get(from) ?? []).filter(t => now - t < 3_600_000);
    if (recent.length >= MAX_POSTS_PER_HOUR) return null;
    recent.push(now);
    sentLog.set(from, recent);

    const p: Post = { id: state.nextId++, t: now, from, to, text: text.trim().slice(0, MAX_TEXT) };
    if (opts.replyTo && state.posts.some(x => x.id === opts.replyTo)) p.replyTo = opts.replyTo;
    if (opts.council) p.council = opts.council;
    if (opts.urgent && to !== 'all') p.urgent = true;
    state.posts.push(p);
    if (state.posts.length > 400) state.posts.shift();
    save('board', state);
    emit(from, 'chat', { to, text: p.text, id: p.id, replyTo: p.replyTo, council: p.council, urgent: p.urgent });
    for (const l of listeners) l(p);
    return p;
}

/** Ids of posts this member has not seen yet (not their own). Marks them read. */
export function takeUnread(name: string): Set<number> {
    const seen = state.cursor[name] ?? 0;
    const fresh = new Set(state.posts.filter(p => p.id > seen && p.from !== name).map(p => p.id));
    state.cursor[name] = state.nextId - 1;
    save('board', state);
    return fresh;
}

/** How many posts to this member (or to all) they have not seen yet, without marking them read. */
export const unreadCount = (name: string, opts: { urgent?: boolean } = {}) =>
    state.posts.filter(p => p.id > (state.cursor[name] ?? 0) && p.from !== name && (p.to === name || p.to === 'all') && (!opts.urgent || p.urgent)).length;

export const onPost = (fn: (p: Post) => void) => listeners.add(fn);
export const recentPosts = (n = 12) => state.posts.slice(-n);
export const councilPosts = (council: number) => state.posts.filter(p => p.council === council);
