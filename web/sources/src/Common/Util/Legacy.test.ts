import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyLocation } from './Legacy';

const SITE = 'https://legacy.example.org';
const OLD_API = 'https://old-api.example.org';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

// fetch answering the old API's status request
function oldApi(answer: () => Response) {
    const fetch = vi.fn(async (_url: string) => answer());
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

describe('legacyLocation', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('gives the archive at the same path for a computation the old API knows', async () => {
        const fetch = oldApi(() => json(200, { ComputationId: 'old', SubmitId: 1, Status: 'Finished', ErrorMsg: '' }));
        expect(await legacyLocation('old', '/online/old/2?x=1', SITE, OLD_API)).toBe(`${SITE}/online/old/2?x=1`);
        expect(fetch.mock.calls.map(c => c[0])).toEqual([`${OLD_API}/Status/old`]);
    });

    it('also for failed and deleted old computations', async () => {
        for (const Status of ['Error', 'FailedInitialization', 'Deleted']) {
            oldApi(() => json(200, { ComputationId: 'old', SubmitId: 1, Status, ErrorMsg: 'x' }));
            expect(await legacyLocation('old', '/online/old', SITE, OLD_API)).toBe(`${SITE}/online/old`);
        }
    });

    it('gives nothing for a computation the old API does not know', async () => {
        oldApi(() => json(200, { ComputationId: 'x', SubmitId: 0, Status: 'Error', ErrorMsg: 'ComputationId [x] does not exists.\n' }));
        expect(await legacyLocation('x', '/online/x', SITE, OLD_API)).toBeNull();
    });

    it('gives nothing when the old API fails or answers something else', async () => {
        oldApi(() => { throw new TypeError('Failed to fetch'); });
        expect(await legacyLocation('id', '/online/id', SITE, OLD_API)).toBeNull();
        oldApi(() => json(502, '<html>Bad Gateway</html>'));
        expect(await legacyLocation('id', '/online/id', SITE, OLD_API)).toBeNull();
        oldApi(() => json(200, { unexpected: true }));
        expect(await legacyLocation('id', '/online/id', SITE, OLD_API)).toBeNull();
    });

    it('asks nothing when the archive is not configured', async () => {
        const fetch = oldApi(() => json(200, {}));
        expect(await legacyLocation('id', '/online/id', '', OLD_API)).toBeNull();
        expect(await legacyLocation('id', '/online/id', SITE, '')).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
