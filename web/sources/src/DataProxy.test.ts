import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError } from './Http';

// The API, replaced: each test sets what getSession answers
const api = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./MoleAPIService', () => ({ ApiService: api }));

import { SessionInfo, SessionStatus } from './DataProxy';

const session = (state: string, error = '') => ({
    id: 'abc', state, error, pdb_id: '1tqn', assembly_id: null, created: '2026-10-20T08:00:00Z', loaded: null, mole_version: '2.5.26.10.17', jobs: [],
});

describe('SessionStatus.waitUntilLoaded', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        api.getSession.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it('polls until the session is ready, reporting each state', async () => {
        api.getSession
            .mockResolvedValueOnce(session('queued'))
            .mockResolvedValueOnce(session('loading'))
            .mockResolvedValueOnce(session('ready'));
        const seen: string[] = [];
        const done = SessionStatus.waitUntilLoaded('abc', s => seen.push(s.state));
        await vi.runAllTimersAsync();
        expect((await done).state).toBe('ready');
        expect(seen).toEqual(['queued', 'loading', 'ready']);
        expect(api.getSession).toHaveBeenCalledWith('abc');
    });

    it('resolves with a failed session, which says why', async () => {
        api.getSession.mockResolvedValueOnce(session('loading')).mockResolvedValueOnce(session('failed', 'Entry not found.'));
        const done = SessionStatus.waitUntilLoaded('abc');
        await vi.runAllTimersAsync();
        expect(await done).toMatchObject({ state: 'failed', error: 'Entry not found.' });
    });

    it('retries a network or server error, then goes on', async () => {
        api.getSession.mockRejectedValueOnce(new RequestError('Bad Gateway', 502, false)).mockResolvedValueOnce(session('ready'));
        const done = SessionStatus.waitUntilLoaded('abc');
        await vi.runAllTimersAsync();
        expect((await done).state).toBe('ready');
        expect(api.getSession).toHaveBeenCalledTimes(2);
    });

    it('rejects at once when the API refuses (deleted, unknown)', async () => {
        api.getSession.mockRejectedValue(new RequestError('The computation has been deleted.', 410, true));
        const done = SessionStatus.waitUntilLoaded('abc');
        await expect(done).rejects.toThrow('The computation has been deleted.');
        expect(api.getSession).toHaveBeenCalledTimes(1);
    });

    it('rejects after the retries fail', async () => {
        api.getSession.mockRejectedValue(new RequestError('Bad Gateway', 502, false));
        const done = SessionStatus.waitUntilLoaded('abc');
        const failed = expect(done).rejects.toThrow('Bad Gateway');
        await vi.runAllTimersAsync();
        await failed;
        expect(api.getSession).toHaveBeenCalledTimes(6); // the first request and 5 retries
    });
});

describe('SessionInfo.setWhenUnknown', () => {
    afterEach(() => { SessionInfo.setWhenUnknown(undefined); });

    const notFound = () => new RequestError('Session not found.', 404, true);

    it('is asked about a session the API does not know before its handlers fail', async () => {
        api.getSession.mockReset().mockRejectedValueOnce(notFound());
        const asked: string[] = [];
        SessionInfo.setWhenUnknown(async id => { asked.push(id); return false; });
        const failed = vi.fn();
        SessionInfo.DataProvider.get('unknown-kept', vi.fn(), false, failed);
        await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('unknown-kept', 'Session not found.'));
        expect(asked).toEqual(['unknown-kept']);
    });

    it('keeps the handlers waiting when it took the page elsewhere', async () => {
        api.getSession.mockReset().mockRejectedValueOnce(notFound());
        let asked = false;
        SessionInfo.setWhenUnknown(async () => { asked = true; return true; });
        const loaded = vi.fn(), failed = vi.fn();
        SessionInfo.DataProvider.get('unknown-left', loaded, false, failed);
        await vi.waitFor(() => expect(asked).toBe(true));
        await new Promise(res => setTimeout(res, 10));
        expect(loaded).not.toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
    });

    it('is not asked about a session the API knows, nor when the API fails otherwise', async () => {
        const whenUnknown = vi.fn(async () => true);
        SessionInfo.setWhenUnknown(whenUnknown);
        api.getSession.mockReset().mockResolvedValueOnce(session('ready'));
        const loaded = vi.fn();
        SessionInfo.DataProvider.get('known', loaded);
        await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
        api.getSession.mockRejectedValueOnce(new RequestError('Gone.', 410, true));
        const failed = vi.fn();
        SessionInfo.DataProvider.get('deleted', vi.fn(), false, failed);
        await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('deleted', 'Gone.'));
        expect(whenUnknown).not.toHaveBeenCalled();
    });
});

describe('SessionInfo.DataProvider.subscribe', () => {
    it('stops calling an unsubscribed handler', async () => {
        let answer!: (s: unknown) => void;
        api.getSession.mockReset().mockReturnValueOnce(new Promise(res => { answer = res; }));
        const kept = vi.fn(), removed = vi.fn();
        SessionInfo.DataProvider.subscribe('unsubscribed', kept);
        const unsubscribe = SessionInfo.DataProvider.subscribe('unsubscribed', removed);
        unsubscribe();
        answer(session('ready'));
        await vi.waitFor(() => expect(kept).toHaveBeenCalledTimes(1));
        expect(removed).not.toHaveBeenCalled();
    });
});
