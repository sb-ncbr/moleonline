import { DataSources } from "../../../config/common";
import { getJson } from "../../Http";

// Computations of the previous MOLEonline, made before it moved to new servers: its API still has them, and its
// read-only archive shows them at the same paths (/online/<id>[/<submitId>|/ChannelsDB]). Their IDs look like ours,
// so only asking the old API tells them apart.

const OLD_API_TIMEOUT_SECONDS = 5;

// The archive's address of the page at path (with its query) when the old API knows the computation, which this API
// does not; null otherwise, also when the old API cannot tell or the archive is not configured
export async function legacyLocation(computationId: string, path: string, site = DataSources.LEGACY_URL,
                                     oldApi = DataSources.LEGACY_API_URL): Promise<string | null> {
    if (!site || !oldApi) {
        return null;
    }
    return await knownToOldApi(oldApi, computationId) ? `${site}${path}` : null;
}

// The old API answers an ID it does not know with 200 and the status Error of submission 0; the status of a
// computation it knows, failed or deleted ones included
async function knownToOldApi(oldApi: string, computationId: string): Promise<boolean> {
    try {
        const status = await getJson(`${oldApi}/Status/${encodeURIComponent(computationId)}`, OLD_API_TIMEOUT_SECONDS);
        return typeof status?.Status === "string" && !(status.Status === "Error" && status.SubmitId === 0);
    } catch {
        return false;
    }
}
