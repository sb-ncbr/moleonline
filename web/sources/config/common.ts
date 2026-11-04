export class DataSources {
    // Set at build time from VITE_API_URL: a path served by this site's nginx, "/api" by default. The API sends no
    // CORS headers, so the browser must call it from the same origin, never another site's URL.
    public static API_URL: string = import.meta.env.VITE_API_URL;

    // The previous MOLEonline's read-only archive and its API, set at build time from VITE_LEGACY_URL and
    // VITE_LEGACY_API_URL: a computation this API does not know is looked up there (Common/Util/Legacy.ts). Empty: not
    // looked up. The old API answers any origin, so the browser asks it directly.
    public static LEGACY_URL: string = import.meta.env.VITE_LEGACY_URL ?? "";
    public static LEGACY_API_URL: string = import.meta.env.VITE_LEGACY_API_URL ?? "";

    public static PATTERN_QUERY_API_URL: any = {
        "webchem": "https://webchem.ncbr.muni.cz/Platform/PatternQuery/ValidateQuery",
    }

    public static ANNOTATION_API_URL: any = {
        "channelsdb2": "https://channelsdb2.biodata.ceitec.cz/api",
    }

    public static PATTERN_QUERY_MODE = "webchem";
    public static ANNOTATION_API_MODE = "channelsdb2";
}

export class CommonOptions {
    public static DEBUG_MODE = false;
    public static CHANNELSDB_LINK_DETAIL_URL = "https://channelsdb2.biodata.ceitec.cz/detail/pdb";
}
