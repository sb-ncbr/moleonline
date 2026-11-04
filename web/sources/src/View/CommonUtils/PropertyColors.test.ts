import { describe, expect, it } from 'vitest';
import { Color } from 'molstar/lib/mol-util/color';
import { channelGradient, colorAt, ColoringProperty, cssColor, gradientStops, layerValue, paletteColor, paletteSettings, PALETTES } from './PropertyColors';
import { DefaultColor, gradientColors } from '../VizualizerMol/color-tunnels/property-color';
import { LayersInfo } from '../../DataInterface';
import { Tunnel } from '../LayerVizualizer/Backend';

const layer = (start: number, end: number, value: number) => ({ start, end, value });

describe('paletteSettings', () => {
    it("spans the property's absolute scale, centred on its centre", () => {
        const s = paletteSettings('Polarity', { min: 3, max: 9 }, false);
        expect([s.minVal, s.maxVal, s.centerPosition, s.centerAbsolute, s.skipMiddle]).toEqual([0, 52, 5, true, false]);
        expect(s.minColor).toEqual(PALETTES.Polarity.min);
    });

    it("spans the channel's own values for Min/max, centred between them", () => {
        const s = paletteSettings('Polarity', { min: 3, max: 9 }, true);
        expect([s.minVal, s.maxVal, s.centerAbsolute]).toEqual([3, 9, false]);
    });

    it('grades counts of residues from white up, without a centre', () => {
        for (const minMax of [false, true]) {
            const s = paletteSettings('NumPositives', { min: 0, max: 3 }, minMax);
            expect([s.skipMiddle, s.centerAbsolute]).toEqual([true, false]);
        }
    });
});

describe('paletteColor', () => {
    it('gives a channel whose values are all the same one colour', () => {
        const s = paletteSettings('Hydropathy', { min: 1, max: 1 }, true);
        expect(paletteColor(1, s)).toEqual(paletteColor(7, s));
    });
});

describe('gradientStops', () => {
    it("puts the first layer's colour at the start and every other layer's where it ends", () => {
        const s = paletteSettings('Hydropathy', { min: 0, max: 0 }, false);
        const stops = gradientStops([layer(0, 2, -4.5), layer(2, 5, 0), layer(5, 10, 4.5)], s);
        expect(stops.map(t => t.offset)).toEqual([0, 0.5, 1]);
        expect(stops[0].color).toEqual(PALETTES.Hydropathy.min);
        expect(stops[2].color).toEqual(PALETTES.Hydropathy.max);
    });

    it('rounds the colours down, as the 2D profile draws them', () => {
        const s = paletteSettings('Hydropathy', { min: 0, max: 0 }, false);
        for (const { color } of gradientStops([layer(0, 1, -1.3), layer(1, 2, 2.2)], s)) {
            expect([color.r, color.g, color.b].every(Number.isInteger)).toBe(true);
        }
    });
});

describe('colorAt', () => {
    const black = { r: 0, g: 0, b: 0 }, white = { r: 200, g: 100, b: 50 };
    const stops = [{ offset: 0, color: black }, { offset: 0.5, color: white }, { offset: 1, color: black }];

    it('interpolates between the neighbouring stops', () => {
        expect(colorAt(stops, 0.25)).toEqual({ r: 100, g: 50, b: 25 });
        expect(colorAt(stops, 0.5)).toEqual(white);
    });

    it('keeps the end colours beyond the ends', () => {
        expect(colorAt(stops, -1)).toEqual(black);
        expect(colorAt(stops, 2)).toEqual(black);
    });

    it('keeps the colour before two stops that share an offset up to it', () => {
        expect(colorAt([{ offset: 0, color: black }, { offset: 0, color: white }, { offset: 1, color: black }], 0)).toEqual(black);
        expect(colorAt([{ offset: 0, color: black }, { offset: 0.5, color: black }, { offset: 0.5, color: white }], 0.5)).toEqual(black);
    });
});

describe('gradientColors (3D)', () => {
    const info = (start: number, end: number, hydropathy: number, bRadius: number) => ({
        LayerGeometry: { StartDistance: start, EndDistance: end, MinBRadius: bRadius },
        Properties: { Hydropathy: hydropathy },
    }) as unknown as LayersInfo;
    const layers = [info(0, 2, -4.5, 1), info(2, 5, 1, 2), info(5, 10, 4.5, 5)];

    it("colours a channel's centreline as the 2D profile's gradient", () => {
        for (const coloring of [{ property: 'Hydropathy', minMax: false }, { property: 'Hydropathy', minMax: true }] as const) {
            const stops = channelGradient(layers.map(l => layer(l.LayerGeometry.StartDistance, l.LayerGeometry.EndDistance, l.Properties.Hydropathy)), coloring);
            const distances = [0, 1, 2.5, 5, 7.5, 10];
            const colors = gradientColors(distances, layers, coloring);
            distances.forEach((d, i) => {
                const { r, g, b } = colorAt(stops, d / 10);
                expect(colors[i]).toBe(Color.fromRgb(r, g, b));
            });
        }
    });

    it('takes BRadius from the layer geometry', () => {
        const coloring = { property: 'BRadius', minMax: true } as const;
        const colors = gradientColors([0, 10], layers, coloring);
        expect(colors[0]).toBe(Color.fromRgb(PALETTES.BRadius.min.r, PALETTES.BRadius.min.g, PALETTES.BRadius.min.b));
        expect(colors[1]).toBe(Color.fromRgb(PALETTES.BRadius.max.r, PALETTES.BRadius.max.g, PALETTES.BRadius.max.b));
        expect(layerValue({ MinBRadius: 3, Properties: {} }, 'BRadius')).toBe(3);
    });

    it('is grey without layers', () => {
        expect(gradientColors([0, 1], [], { property: 'Hydropathy', minMax: false })).toEqual([DefaultColor, DefaultColor]);
    });
});

// The stops the 2D profile's renderer adds to its canvas gradient, drawn on a context that only records them
function drawnStops(layers: { start: number, end: number, value: number }[], property: ColoringProperty, minMax: boolean) {
    const stops: [number, string][] = [];
    const context = new Proxy({}, {
        get: (_, name) => name === 'createLinearGradient'
            ? () => ({ addColorStop: (offset: number, color: string) => stops.push([offset, color]) })
            : () => { },
        set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const values = layers.map(l => l.value);
    const settings = paletteSettings(property, { min: Math.min(...values), max: Math.max(...values) }, minMax);
    const end = layers[layers.length - 1].end;
    const tunnel = new Tunnel({ x: 0, y: 0 }, { x: end, y: 5 }, layers.map((l, id) => ({ ...l, id, radius: 1 })), context,
        (value, s) => cssColor(paletteColor(value, s)), settings);
    tunnel.drawFromBounds({ x: 0, y: 0, width: 400, height: 100 });
    return { stops, settings };
}

describe('the 2D profile and the shared gradient', () => {
    const layers = [layer(0, 1.5, -3.2), layer(1.5, 4, 0.4), layer(4, 4, 1.1), layer(4, 9.5, 2.7), layer(9.5, 12, -0.8)];

    for (const property of ['Hydropathy', 'Charge', 'NumPositives', 'Polarity'] as ColoringProperty[]) {
        for (const minMax of [false, true]) {
            it(`have the same stops for ${property} ${minMax ? 'Min/max' : 'Absolute'}`, () => {
                const { stops, settings } = drawnStops(layers, property, minMax);
                const shared = gradientStops(layers, settings).map(s => [s.offset, cssColor(s.color)]);
                expect(shared).toEqual(stops);
            });
        }
    }
});
