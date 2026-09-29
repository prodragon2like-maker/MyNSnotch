import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/* ============================================================
 * DEFAULTS
 * ============================================================ */
export const DEFAULTS = {
    // Appearance — colors
    accent: '#7aa2ff',
    surfaceColor: '#0d0d10',
    textPrimary: '#f4f4f6',
    textSecondary: 'rgba(255, 255, 255, 0.55)',
    surfaceOpacity: 100,
    fontScale: 100,
    peekFontScale: 100,

    // Layout
    pillHeight: 40,
    pillWidthMin: 300,
    pillCornerRadius: 22,
    dashWidth: 600,
    dashMinHeight: 310,

    // Island mode
    islandMode: false,
    islandTopPadding: 8,
    islandCornerRadius: 22,

    // Behaviour
    expandDelay: 180,
    collapseDelay: 400,
    hoverToExpand: true,
    clickToExpand: false,
    showNotifPeek: true,
    peekDuration: 4200,
    peekWidth: 420,
    peekHeight: 78,

    // Pill content
    showBattery: true,
    showMusic: true,
    showClockSeconds: false,
    clockFormat24h: false,

    // Tabs
    tabOrder: 'music,notif,tray,calendar,wallpaper',
    hideTabs: '',

    // Music
    musicVinylSpin: true,
    musicVinylSize: 140,
    musicShowTimeline: true,

    // Tray
    trayRefreshSec: 3,
    trayShowBluetooth: true,
    trayShowBattery: true,

    // Notifications
    notifMaxVisible: 50,
    notifShowClearAll: true,

    // Calendar
    calWeekStart: 1,
    calStripRange: 3,

    // Wallpaper
    wallpaperFolder: '',
    wpSlideshowEnabled: false,
    wpSlideshowMin: 30,
    wpSlideshowShuffle: false,
};

export const BLUR_PRESETS = [
    {
        id: 'liquid', label: 'Liquid Glass',
        description: 'Vivid frosted glass — light tint, bright rim, colour lift.',
        tint: '250,250,252', alpha: 0.28, rimTop: 0.55, rim: 0.16,
        brightness: 1.06, collapsedRadius: 18, expandedRadius: 36,
    },
    {
        id: 'frosted', label: 'Frosted',
        description: 'Neutral frosted panel — balanced tint and rim.',
        tint: '18,18,22', alpha: 0.55, rimTop: 0.20, rim: 0.10,
        brightness: 0.94, collapsedRadius: 22, expandedRadius: 44,
    },
    {
        id: 'clear', label: 'Clear',
        description: 'Barely-there glass — mostly the blurred backdrop, faint rim.',
        tint: '13,13,16', alpha: 0.18, rimTop: 0.14, rim: 0.06,
        brightness: 1.0, collapsedRadius: 12, expandedRadius: 24,
    },
    {
        id: 'acrylic', label: 'Acrylic',
        description: 'Darker tint with a soft rim over the blur.',
        tint: '10,10,14', alpha: 0.66, rimTop: 0.16, rim: 0.08,
        brightness: 0.9, collapsedRadius: 28, expandedRadius: 52,
    },
];

export const BLUR_RADIUS_RANGE = { min: 0, max: 64 };

export const BLUR_DEFAULTS = {
    enabled: false,
    preset: 'liquid',
    collapsedRadius: 18,
    expandedRadius: 36,
};

export function blurPreset(id) {
    return BLUR_PRESETS.find(p => p.id === id) ?? BLUR_PRESETS[0];
}

/* ============================================================
 * CONFIG
 * ============================================================ */
export class Config {
    constructor() {
        this._dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'mynotch']);
        this._path = GLib.build_filenamev([this._dir, 'config.json']);
        this._data = this._load();
    }

    _load() {
        try {
            let dir = Gio.File.new_for_path(this._dir);
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
        } catch (e) {}

        try {
            let file = Gio.File.new_for_path(this._path);
            if (!file.query_exists(null)) return {};
            let [ok, contents] = file.load_contents(null);
            if (!ok) return {};
            return JSON.parse(new TextDecoder().decode(contents));
        } catch (e) {
            return {};
        }
    }

    save() {
        try {
            let file = Gio.File.new_for_path(this._path);
            let text = JSON.stringify(this._data, null, 2);
            file.replace_contents(
                new TextEncoder().encode(text),
                null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            console.error('MyNotch: save config failed', e);
        }
    }

    get(key, def = null) {
        if (this._data[key] !== undefined) return this._data[key];
        if (DEFAULTS[key] !== undefined) return DEFAULTS[key];
        return def;
    }

    set(key, value) {
        this._data[key] = value;
        this.save();
    }

    get blur() {
        let clampR = (v, def) => {
            let n = Math.round(Number(v));
            if (!Number.isFinite(n)) n = def;
            return Math.min(BLUR_RADIUS_RANGE.max, Math.max(BLUR_RADIUS_RANGE.min, n));
        };
        return {
            enabled: this.get('blurEnabled', BLUR_DEFAULTS.enabled) === true,
            preset: blurPreset(this.get('blurPreset', BLUR_DEFAULTS.preset)).id,
            collapsedRadius: clampR(
                this.get('blurCollapsedRadius', BLUR_DEFAULTS.collapsedRadius),
                BLUR_DEFAULTS.collapsedRadius),
            expandedRadius: clampR(
                this.get('blurExpandedRadius', BLUR_DEFAULTS.expandedRadius),
                BLUR_DEFAULTS.expandedRadius),
        };
    }

    setBlur(patch) {
        if ('enabled' in patch) this.set('blurEnabled', !!patch.enabled);
        if ('preset' in patch) this.set('blurPreset', blurPreset(patch.preset).id);
        if ('collapsedRadius' in patch) {
            let n = Math.round(Number(patch.collapsedRadius));
            if (Number.isFinite(n)) {
                n = Math.min(BLUR_RADIUS_RANGE.max, Math.max(BLUR_RADIUS_RANGE.min, n));
                this.set('blurCollapsedRadius', n);
            }
        }
        if ('expandedRadius' in patch) {
            let n = Math.round(Number(patch.expandedRadius));
            if (Number.isFinite(n)) {
                n = Math.min(BLUR_RADIUS_RANGE.max, Math.max(BLUR_RADIUS_RANGE.min, n));
                this.set('blurExpandedRadius', n);
            }
        }
    }
}
