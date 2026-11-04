// The colours of a channel by a property of its layers, the same in the 2D profile and in the 3D view: each property
// has its palette, which spans its absolute scale or the channel's own minimum and maximum.

export type ColoringProperty = "Polarity" | "Mutability" | "Hydropathy" | "Hydrophobicity" | "Charge" | "NumNegatives" |
    "NumPositives" | "LogP" | "LogD" | "LogS" | "Ionizable" | "BRadius";

// What channels are coloured by: the property and whether the colours span the channel's own values (Min/max) or the
// property's absolute scale
export interface PropertyColoring {
    property: ColoringProperty,
    minMax: boolean,
}

export interface RGBColor {
    r: number,
    g: number,
    b: number,
}

export interface PaletteSettings {
    minVal: number,
    maxVal: number,
    minColor: RGBColor,
    maxColor: RGBColor,
    minColorMiddle: RGBColor,
    maxColorMiddle: RGBColor,
    skipMiddle: boolean,
    centerPosition: number,
    centerAbsolute: boolean
}

// A layer as the colours need it: where it is along the channel and its value of the property
export interface ColoredLayer {
    start: number,
    end: number,
    value: number,
}

export interface GradientStop {
    offset: number, // 0 at the channel's start, 1 at its end
    color: RGBColor,
}

const maxYellow = { r: 251, g: 255, b: 7 };
const middleYellow = { r: 240, g: 248, b: 190 };
const maxBlue = { r: 0, g: 0, b: 255 };
const middleBlue = { r: 253, g: 253, b: 255 };
const maxRed = { r: 255, g: 0, b: 0 };
const middleRed = { r: 253, g: 253, b: 225 };
const maxWhite = { r: 255, g: 255, b: 255 };
const middleWhite = { r: 240, g: 240, b: 240 };
const maxPurple = { r: 107, g: 9, b: 107 };
const middlePurple = { r: 220, g: 188, b: 220 };
const middleBlack = { r: 183, g: 183, b: 183 };
const maxBlack = { r: 0, g: 0, b: 0 };

// Colours of each property: at the minimum, the two halves' middle colours at the centre, and at the maximum
export const PALETTES: Record<ColoringProperty, { min: RGBColor, minMiddle: RGBColor, maxMiddle: RGBColor, max: RGBColor }> = {
    Hydropathy: { min: maxBlue, minMiddle: middleBlue, maxMiddle: middleYellow, max: maxYellow },
    Hydrophobicity: { min: maxBlue, minMiddle: middleBlue, maxMiddle: middleYellow, max: maxYellow },
    Mutability: { min: maxBlue, minMiddle: middleBlue, maxMiddle: middleRed, max: maxRed },
    Polarity: { min: maxYellow, minMiddle: middleYellow, maxMiddle: middleBlue, max: maxBlue },
    Charge: { min: maxRed, minMiddle: middleRed, maxMiddle: middleBlue, max: maxBlue },
    NumPositives: { min: maxWhite, minMiddle: middleWhite, maxMiddle: middleBlue, max: maxBlue },
    NumNegatives: { min: maxWhite, minMiddle: middleWhite, maxMiddle: middleRed, max: maxRed },
    LogP: { min: maxBlue, minMiddle: middleBlue, maxMiddle: middleYellow, max: maxYellow },
    LogD: { min: maxBlue, minMiddle: middleBlue, maxMiddle: middleYellow, max: maxYellow },
    LogS: { min: maxYellow, minMiddle: middleYellow, maxMiddle: middleBlue, max: maxBlue },
    Ionizable: { min: maxWhite, minMiddle: middleWhite, maxMiddle: middlePurple, max: maxPurple },
    BRadius: { min: maxWhite, minMiddle: middleWhite, maxMiddle: middleBlack, max: maxBlack },
};

// Absolute scale of each property: minimum, centre and maximum
export const SCALES: Record<ColoringProperty, [number, number, number]> = {
    Polarity: [0, 5, 52],
    Mutability: [25, 75, 117],
    Hydropathy: [-4.5, 0, 4.5],
    Hydrophobicity: [-1.14, 0, 1.81],
    Charge: [-5, 0, 5],
    NumPositives: [0, 0, 5],
    NumNegatives: [0, 0, 5],
    LogP: [-1.03, 0.78, 2.59],
    LogD: [-3, -0.205, 2.59],
    LogS: [-2.48, 0.075, 2.63],
    Ionizable: [0, 0, 5],
    BRadius: [0, 3, 6],
};

// Counts of residues: a palette from white up, without a centre
const COUNTS: ColoringProperty[] = ["NumPositives", "NumNegatives", "Ionizable"];

// The value of a layer's property; BRadius is the layer's minimal B-factor radius
export function layerValue(layer: { MinBRadius: number, Properties: Record<string, number> }, property: ColoringProperty): number {
    return Number(property === "BRadius" ? layer.MinBRadius : layer.Properties[property]);
}

export function paletteSettings(property: ColoringProperty, range: { min: number, max: number }, minMax: boolean,
                                skipMiddle = false): PaletteSettings {
    const [absMin, center, absMax] = SCALES[property];
    const palette = PALETTES[property];
    const counts = COUNTS.includes(property);
    return {
        minVal: minMax ? range.min : absMin,
        maxVal: minMax ? range.max : absMax,
        minColor: palette.min,
        maxColor: palette.max,
        minColorMiddle: palette.minMiddle,
        maxColorMiddle: palette.maxMiddle,
        skipMiddle: counts ? true : skipMiddle,
        centerPosition: center,
        centerAbsolute: counts ? false : !minMax,
    };
}

// The colour at value, linearly between minColor at min and maxColor at max
function interpolate(min: number, minColor: RGBColor, max: number, maxColor: RGBColor, value: number): RGBColor {
    const t = (value - min) / (max - min);
    return {
        r: minColor.r + (maxColor.r - minColor.r) * t,
        g: minColor.g + (maxColor.g - minColor.g) * t,
        b: minColor.b + (maxColor.b - minColor.b) * t,
    };
}

// The colour of a value: each half of the range runs from its end colour to its own middle colour at the centre, which
// is not the midpoint for absolute bounds; values outside the range get the colours of its ends
export function paletteColor(value: number, settings: PaletteSettings): RGBColor {
    const { minVal, maxVal, minColor, maxColor, minColorMiddle, maxColorMiddle, skipMiddle } = settings;
    if (skipMiddle && settings.centerAbsolute) {
        throw new Error("Cannot config absolute center and skip center at once! Forbidden configuration -> skipMiddle=true && centerAbsolute=true");
    }
    if (minVal === maxVal) {
        return interpolate(0, minColor, 1, maxColorMiddle, 0.5);
    }
    value = Math.min(Math.max(value, minVal), maxVal);
    if (skipMiddle) {
        return interpolate(minVal, minColor, maxVal, maxColor, value);
    }
    const middle = settings.centerAbsolute ? settings.centerPosition : (minVal + maxVal) / 2;
    return value < middle
        ? interpolate(minVal, minColor, middle, minColorMiddle, value)
        : interpolate(middle, maxColorMiddle, maxVal, maxColor, value);
}

// As the 2D profile draws it: whole numbers, rounded down
export function cssColor(rgb: RGBColor): string {
    return `rgb(${Math.floor(rgb.r)},${Math.floor(rgb.g)},${Math.floor(rgb.b)})`;
}

// The stops of the channel's gradient, as the 2D profile draws it: the first layer's colour at the start, every other
// layer's colour where it ends
export function gradientStops(layers: ColoredLayer[], settings: PaletteSettings): GradientStop[] {
    if (layers.length === 0) {
        return [];
    }
    const start = layers[0].start;
    const length = layers[layers.length - 1].end - start;
    return layers.map((layer, i) => ({
        offset: i === 0 || length <= 0 ? 0 : (layer.end - start) / length,
        color: floor(paletteColor(layer.value, settings)),
    }));
}

// The gradient of a channel's layers by a property
export function channelGradient(layers: ColoredLayer[], coloring: PropertyColoring): GradientStop[] {
    const values = layers.map(l => l.value);
    const range = { min: Math.min(...values), max: Math.max(...values) };
    return gradientStops(layers, paletteSettings(coloring.property, range, coloring.minMax));
}

// The gradient's colour at offset t (0–1), linearly between its stops
export function colorAt(stops: GradientStop[], t: number): RGBColor {
    if (stops.length === 0) {
        throw new Error("A gradient needs a stop.");
    }
    if (t <= stops[0].offset) {
        return stops[0].color;
    }
    for (let i = 1; i < stops.length; i++) {
        const next = stops[i];
        if (t <= next.offset) {
            const prev = stops[i - 1];
            return next.offset === prev.offset ? next.color : interpolate(prev.offset, prev.color, next.offset, next.color, t);
        }
    }
    return stops[stops.length - 1].color;
}

function floor(rgb: RGBColor): RGBColor {
    return { r: Math.floor(rgb.r), g: Math.floor(rgb.g), b: Math.floor(rgb.b) };
}
