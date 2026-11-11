import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tunnel, TunnelMetaInfo } from "../DataInterface";

// the plugin is stubbed: each render resolves when the test says so
const plugin = vi.hoisted(() => ({
    pending: [] as { resolve: () => void, reject: (e: unknown) => void }[],
    rendered: new Set<string>(),
    recolored: [] as string[],
    coloredWith: [] as string[], // the property of each property colour render and recolour, in order
    holdRecolors: false, // a recolour then resolves when the test says so, as a render
    nextRef: 0,
}));

vi.mock("./Context", () => {
    const render = () => new Promise<[unknown, string]>((resolve, reject) => {
        const ref = `ref${plugin.nextRef++}`;
        plugin.pending.push({
            resolve: () => { plugin.rendered.add(ref); resolve([{}, ref]); },
            reject,
        });
    });
    const renderColored = (_: unknown, coloring: { property: string }) => {
        plugin.coloredWith.push(coloring.property);
        return render();
    };
    // a rendered visual is coloured again in place
    const recolor = async (ref: string, coloring: { property: string }) => {
        if (!plugin.rendered.has(ref)) return false;
        plugin.coloredWith.push(coloring.property);
        if (plugin.holdRecolors) {
            await new Promise<void>((resolve, reject) => plugin.pending.push({ resolve, reject }));
        }
        plugin.recolored.push(ref);
        return true;
    };
    return { Context: { getInstance: () => ({ plugin: { state: { data: {} } }, renderTunnel: render, renderPropertyColorTunnel: renderColored, recolorPropertyColorTunnel: recolor }) } };
});

vi.mock("molstar/lib/mol-plugin/commands", () => ({
    PluginCommands: { State: { RemoveObject: async (_: unknown, { ref }: { ref: string }) => { plugin.rendered.delete(ref); } } },
}));

// no 2D view to highlight
vi.stubGlobal("document", { getElementById: () => null });
// the page events go to a bare event target, and a frame is a timer
vi.stubGlobal("window", new EventTarget());
vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback));

const { showChannelVisuals, showDefaultVisualsNewSubmission, showChannelPropertyColorVisuals, colorShownChannels, uncolorShownChannels, shownChannelProperties, isRenderingChannels } = await import("./State");
const { listen } = await import("./CommonUtils/Events");
const { LastVisibleChannels } = await import("../Cache");

type Channel = Tunnel & TunnelMetaInfo;
let channelIds = 0;
const channel = () => ({ Id: `c${++channelIds}`, __color: 0, Layers: { LayersInfo: [] } } as unknown as Channel);
// a channel whose layers have the properties the tests colour by
const colorable = () => {
    const c = channel();
    c.Layers = { LayersInfo: [{ LayerGeometry: { StartDistance: 0, EndDistance: 1, MinBRadius: 1 }, Properties: { Hydropathy: 1, Charge: 0 } }] } as any;
    return c;
};

// resolves each render once it is requested, until the operations finish
async function settle(...operations: Promise<unknown>[]) {
    let done = false;
    const all = Promise.allSettled(operations).finally(() => { done = true; });
    while (!done) {
        await new Promise(r => setTimeout(r, 0));
        plugin.pending.shift()?.resolve();
    }
    for (const result of await all) {
        if (result.status === "rejected") throw result.reason;
    }
}

describe("channel visual operations", () => {
    beforeEach(() => {
        plugin.pending = [];
        plugin.rendered.clear();
        plugin.recolored = [];
        plugin.coloredWith = [];
        plugin.holdRecolors = false;
        plugin.nextRef = 0;
        LastVisibleChannels.clear();
    });

    it("renders a channel shown twice at once only once", async () => {
        const c = channel();
        await settle(showChannelVisuals([c], true), showChannelVisuals([c], true));
        expect([...plugin.rendered]).toEqual([c.__ref]);

        await showChannelVisuals([c], false);
        expect(plugin.rendered.size).toBe(0);
        expect(c.__isVisible).toBe(false);
    });

    it("leaves a default channel the user showed while the defaults rendered as it is", async () => {
        const [first, second] = [channel(), channel()];
        const defaults = showDefaultVisualsNewSubmission({ Tunnels: [first, second] } as any, "1");
        // listed before they are rendered: their checkboxes wait
        expect([first.__isBusy, second.__isBusy]).toEqual([true, true]);

        await settle(defaults, showChannelVisuals([second], true));
        expect(plugin.rendered).toEqual(new Set([first.__ref, second.__ref]));
        expect([first.__isBusy, second.__isBusy]).toEqual([false, false]);

        await showChannelVisuals([second], false);
        expect(plugin.rendered).toEqual(new Set([first.__ref]));
    });

    it("keeps only the last visual of overlapping repaints", async () => {
        const c = channel();
        await settle(showChannelVisuals([c], true));
        await settle(showChannelVisuals([c], true, true), showChannelPropertyColorVisuals(c, {} as any, true), showChannelVisuals([c], true, true));
        expect([...plugin.rendered]).toEqual([c.__ref]);
    });

    it("colours a coloured channel again without rendering it again", async () => {
        const c = colorable();
        await settle(showChannelVisuals([c], true));
        await settle(showChannelPropertyColorVisuals(c, { property: "Hydropathy", minMax: false }, true));
        const coloured = c.__ref;

        await showChannelPropertyColorVisuals(c, { property: "Charge", minMax: false }, true);
        expect(c.__ref).toBe(coloured);
        expect(plugin.recolored).toEqual([coloured]);
        expect([...plugin.rendered]).toEqual([coloured]);
    });

    it("remembers what a channel is coloured by, hydropathy for a property it lacks", async () => {
        const c = channel();
        c.Layers = { LayersInfo: [{ LayerGeometry: { StartDistance: 0, EndDistance: 1, MinBRadius: undefined }, Properties: { Hydropathy: 1 } }] } as any;
        await settle(showChannelVisuals([c], true));
        await settle(showChannelPropertyColorVisuals(c, { property: "Charge", minMax: true }, true));
        expect(c.__coloring).toEqual({ property: "Hydropathy", minMax: true });

        c.Layers.LayersInfo[0].Properties.Charge = 2;
        await showChannelPropertyColorVisuals(c, { property: "Charge", minMax: false }, true);
        expect(c.__coloring).toEqual({ property: "Charge", minMax: false });
        expect(plugin.recolored).toEqual([c.__ref]);
        expect(plugin.coloredWith).toEqual(["Hydropathy", "Charge"]);
    });

    it("leaves a channel coloured so already as it is", async () => {
        const c = colorable();
        await settle(showChannelVisuals([c], true));
        await settle(showChannelPropertyColorVisuals(c, { property: "Hydropathy", minMax: false }, true));
        await showChannelPropertyColorVisuals(c, { property: "Hydropathy", minMax: false }, true);
        expect(plugin.coloredWith).toEqual(["Hydropathy"]);
    });

    it("ends with the coloring asked for last when it goes back before an earlier one ends", async () => {
        const c = colorable();
        await settle(showChannelVisuals([c], true));
        await settle(showChannelPropertyColorVisuals(c, { property: "Hydropathy", minMax: false }, true));
        plugin.holdRecolors = true;

        // Charge is still being applied when Hydropathy is asked for again
        await settle(showChannelPropertyColorVisuals(c, { property: "Charge", minMax: false }, true),
            showChannelPropertyColorVisuals(c, { property: "Hydropathy", minMax: false }, true));
        expect(plugin.coloredWith).toEqual(["Hydropathy", "Charge", "Hydropathy"]);
        expect(c.__coloring).toEqual({ property: "Hydropathy", minMax: false });
    });

    it("colours the channels shown one after another, leaving hidden ones", async () => {
        const [a, b, hidden] = [colorable(), colorable(), colorable()];
        await settle(showChannelVisuals([a, b, hidden], true));
        await showChannelVisuals([hidden], false);

        const colouring = colorShownChannels({ property: "Charge", minMax: true });
        let mostAtOnce = 0, done = false;
        colouring.finally(() => { done = true; });
        while (!done) {
            await new Promise(r => setTimeout(r, 0));
            mostAtOnce = Math.max(mostAtOnce, plugin.pending.length);
            plugin.pending.shift()?.resolve();
        }
        expect(await colouring).toEqual([]);
        expect(mostAtOnce).toBe(1);
        expect([a, b].map(c => c.__coloring)).toEqual([{ property: "Charge", minMax: true }, { property: "Charge", minMax: true }]);
        expect(hidden.__layerColored).toBe(false);
    });

    it("colours the other channels shown when one fails, and says which", async () => {
        const [a, b] = [colorable(), colorable()];
        await settle(showChannelVisuals([a, b], true));
        const colouring = colorShownChannels({ property: "Charge", minMax: false });
        let first = true, done = false;
        colouring.finally(() => { done = true; });
        while (!done) {
            await new Promise(r => setTimeout(r, 0));
            const next = plugin.pending.shift();
            if (next && first) { first = false; next.reject(new Error("no mesh")); } else next?.resolve();
        }
        expect(await colouring).toEqual([a]);
        expect([a.__layerColored, b.__layerColored]).toEqual([false, true]);
    });

    it("leaves hidden a channel hidden while the channels are coloured all", async () => {
        const [a, b] = [colorable(), colorable()];
        await settle(showChannelVisuals([a, b], true));
        const colouring = colorShownChannels({ property: "Charge", minMax: false });
        while (plugin.pending.length === 0) await new Promise(r => setTimeout(r, 0));

        // a's coloured surface is being computed when b is hidden
        await showChannelVisuals([b], false);
        await settle(colouring);
        expect(await colouring).toEqual([]);
        expect(a.__layerColored).toBe(true);
        expect([b.__isVisible, b.__layerColored, plugin.rendered.has(b.__ref)]).toEqual([false, false, false]);
    });

    it("shows the other coloured channels plain when one fails, and says which", async () => {
        const [a, b] = [colorable(), colorable()];
        await settle(showChannelVisuals([a, b], true));
        await settle(...[a, b].map(c => showChannelPropertyColorVisuals(c, { property: "Charge", minMax: false }, true)));

        const uncolouring = uncolorShownChannels();
        let first = true, done = false;
        uncolouring.finally(() => { done = true; });
        while (!done) {
            await new Promise(r => setTimeout(r, 0));
            const next = plugin.pending.shift();
            if (next && first) { first = false; next.reject(new Error("no mesh")); } else next?.resolve();
        }
        expect(await uncolouring).toEqual([a]);
        expect([a.__layerColored, b.__layerColored]).toEqual([true, false]);
    });

    it("shows the coloured channels plain again, and only those", async () => {
        const [colored, plain] = [colorable(), colorable()];
        await settle(showChannelVisuals([colored, plain], true));
        await settle(showChannelPropertyColorVisuals(colored, { property: "Charge", minMax: false }, true));
        const plainRef = plain.__ref;

        await settle(uncolorShownChannels());
        expect(colored.__layerColored).toBe(false);
        expect(plain.__ref).toBe(plainRef);
    });

    it("offers to colour the channels shown by the properties all of them have", async () => {
        const layers = (properties: Record<string, number>, bRadius?: number) =>
            ({ LayersInfo: [{ LayerGeometry: { StartDistance: 0, EndDistance: 1, MinBRadius: bRadius }, Properties: properties }] }) as any;
        const [mole, channelsDB, hidden] = [channel(), channel(), channel()];
        mole.Layers = layers({ Charge: 1, Hydropathy: 0.5, LogP: 0.2 }, 2.1);
        channelsDB.Layers = layers({ Hydropathy: 1, Charge: -1 });
        hidden.Layers = layers({ Polarity: 3 }, 1);

        expect(shownChannelProperties()).toEqual([]);
        await settle(showChannelVisuals([mole], true));
        expect(shownChannelProperties()).toEqual(["Charge", "Hydropathy", "LogP", "BRadius"]);
        await settle(showChannelVisuals([channelsDB, hidden], true));
        await showChannelVisuals([hidden], false);
        expect(shownChannelProperties()).toEqual(["Charge", "Hydropathy"]);
    });

    it("leaves a channel whose render failed hidden and showable", async () => {
        const c = channel();
        const failed = showChannelVisuals([c], true);
        while (plugin.pending.length === 0) await new Promise(r => setTimeout(r, 0));
        plugin.pending.shift()!.reject(new Error("render failed"));
        await expect(failed).rejects.toThrow("render failed");
        expect(c.__isVisible).toBeFalsy();
        expect(c.__isBusy).toBe(false);

        await settle(showChannelVisuals([c], true));
        expect([...plugin.rendered]).toEqual([c.__ref]);
        expect(c.__isVisible).toBe(true);
    });

    it("announces the rendering once for overlapping operations, until all of them finish", async () => {
        const announced: boolean[] = [];
        const unsubscribe = listen("channelsRendering", isRendering => announced.push(isRendering));
        const a = channel(), b = { ...channel(), Id: "c2" } as Channel;
        const operations = [showChannelVisuals([a], true), showChannelVisuals([b], true)];
        expect(isRenderingChannels()).toBe(true);
        await settle(...operations);
        expect(announced).toEqual([true, false]);
        expect(isRenderingChannels()).toBe(false);

        // hiding renders nothing
        await showChannelVisuals([a, b], false);
        expect(announced).toEqual([true, false]);
        unsubscribe();
    });

    it("ends the announcement when a render fails", async () => {
        const announced: boolean[] = [];
        const unsubscribe = listen("channelsRendering", isRendering => announced.push(isRendering));
        const failed = showChannelVisuals([channel()], true);
        while (plugin.pending.length === 0) await new Promise(r => setTimeout(r, 0));
        plugin.pending.shift()!.reject(new Error("render failed"));
        await expect(failed).rejects.toThrow("render failed");
        expect(announced).toEqual([true, false]);
        unsubscribe();
    });

    it("renders without animation frames", async () => {
        // a page without frames: the timer ends the wait for the paint
        vi.stubGlobal("requestAnimationFrame", () => 0);
        try {
            const c = channel();
            await settle(showChannelVisuals([c], true));
            expect([...plugin.rendered]).toEqual([c.__ref]);
        } finally {
            vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback));
        }
    });

    it("does not wait for a paint on a hidden page", async () => {
        const frames = vi.fn();
        vi.stubGlobal("requestAnimationFrame", frames);
        vi.stubGlobal("document", { getElementById: () => null, hidden: true });
        try {
            const c = channel();
            const shown = showChannelVisuals([c], true);
            await new Promise(r => setTimeout(r, 0));
            expect(plugin.pending).toHaveLength(1);
            await settle(shown);
            expect(frames).not.toHaveBeenCalled();
        } finally {
            vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback));
            vi.stubGlobal("document", { getElementById: () => null });
        }
    });
});
