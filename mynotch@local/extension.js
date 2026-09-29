import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import Pango from 'gi://Pango';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { RingMeter, Knob, Vinyl, AlbumArtDisc, EqBars, accentHex, setAccent,
         buildAccentCSS, buildSurfaceCSS, buildTextCSS, ACCENT } from './widgets.js';
import { MprisHelper } from './mpris.js';
import { Config, blurPreset } from './config.js';
import { WallpaperHelper } from './wallpaper.js';
import { BluetoothHelper } from './bluetooth.js';

/* ============================================================
 * Tab definitions
 * ============================================================ */
const TAB_DEFS = [
    { id: 'music',     label: 'Music',  icon: 'audio-x-generic-symbolic' },
    { id: 'notif',     label: 'Notif',  icon: 'preferences-system-notifications-symbolic' },
    { id: 'tray',      label: 'Tray',   icon: 'emblem-system-symbolic' },
    { id: 'calendar',  label: 'Cal',    icon: 'x-office-calendar-symbolic' },
    { id: 'wallpaper', label: 'Wall',   icon: 'preferences-desktop-wallpaper-symbolic' },
];

/* ============================================================
 * System info
 * ============================================================ */
class SysInfo {
    constructor() { this._pc = null; this._pn = null; }
    cpu() {
        try {
            let [ok, c] = GLib.file_get_contents('/proc/stat');
            if (!ok) return 0;
            let p = new TextDecoder().decode(c).split('\n')[0]
                .trim().split(/\s+/).slice(1).map(Number);
            let idle = p[3] + (p[4] || 0);
            let total = p.reduce((a, b) => a + b, 0);
            if (!this._pc) { this._pc = { idle, total }; return 0; }
            let di = idle - this._pc.idle, dt = total - this._pc.total;
            this._pc = { idle, total };
            return dt === 0 ? 0 : Math.round((1 - di / dt) * 100);
        } catch (e) { return 0; }
    }
    ram() {
        try {
            let [ok, c] = GLib.file_get_contents('/proc/meminfo');
            if (!ok) return 0;
            let t = 0, a = 0;
            for (let l of new TextDecoder().decode(c).split('\n')) {
                if (l.startsWith('MemTotal:')) t = parseInt(l.match(/\d+/)[0]);
                else if (l.startsWith('MemAvailable:')) a = parseInt(l.match(/\d+/)[0]);
            }
            return t ? Math.round(((t - a) / t) * 100) : 0;
        } catch (e) { return 0; }
    }
    swap() {
        try {
            let [ok, c] = GLib.file_get_contents('/proc/meminfo');
            if (!ok) return 0;
            let t = 0, f = 0;
            for (let l of new TextDecoder().decode(c).split('\n')) {
                if (l.startsWith('SwapTotal:')) t = parseInt(l.match(/\d+/)[0]);
                else if (l.startsWith('SwapFree:')) f = parseInt(l.match(/\d+/)[0]);
            }
            return t ? Math.round(((t - f) / t) * 100) : 0;
        } catch (e) { return 0; }
    }
    disk() {
        try {
            let info = Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::used', null);
            let s = info.get_attribute_uint64('filesystem::size');
            let u = info.get_attribute_uint64('filesystem::used');
            return s ? Math.round((u / s) * 100) : 0;
        } catch (e) { return 0; }
    }
    net() {
        try {
            let [ok, c] = GLib.file_get_contents('/proc/net/dev');
            if (!ok) return { d: 0, u: 0 };
            let rx = 0, tx = 0;
            for (let line of new TextDecoder().decode(c).split('\n')) {
                let m = line.match(/^\s*(\w+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
                if (m && m[1] !== 'lo') { rx += parseInt(m[2]); tx += parseInt(m[3]); }
            }
            let now = GLib.get_monotonic_time();
            if (!this._pn) { this._pn = { rx, tx, time: now }; return { d: 0, u: 0 }; }
            let dt = (now - this._pn.time) / 1e6;
            let d = Math.max(0, (rx - this._pn.rx) / dt);
            let u = Math.max(0, (tx - this._pn.tx) / dt);
            this._pn = { rx, tx, time: now };
            return { d, u };
        } catch (e) { return { d: 0, u: 0 }; }
    }
    static fmt(bps) {
        if (bps < 1024) return `${Math.round(bps)} B/s`;
        if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
        return `${(bps / 1048576).toFixed(1)} MB/s`;
    }
}

/* ============================================================
 * Quick settings
 * ============================================================ */
class Quick {
    constructor() {
        this._dnd = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
        this._iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    }
    _run(cmd) {
        try {
            let [, out] = GLib.spawn_command_line_sync(cmd);
            return new TextDecoder().decode(out).trim();
        } catch (e) { return ''; }
    }
    _async(cmd) { try { GLib.spawn_command_line_async(cmd); } catch (e) {} }

    vol() {
        let o = this._run('wpctl get-volume @DEFAULT_AUDIO_SINK@');
        let m = o.match(/(\d+\.\d+)/);
        if (m) return Math.round(parseFloat(m[1]) * 100);
        o = this._run('pactl get-sink-volume @DEFAULT_SINK@');
        m = o.match(/(\d+)%/);
        return m ? parseInt(m[1]) : 0;
    }
    setVol(v) {
        v = Math.max(0, Math.min(100, Math.round(v)));
        this._async(`wpctl set-volume @DEFAULT_AUDIO_SINK@ ${(v / 100).toFixed(2)}`);
    }
    bright() {
        let o = this._run('brightnessctl g');
        let m = this._run('brightnessctl m');
        if (o && m) { try { return Math.round(parseInt(o) / parseInt(m) * 100); } catch (e) {} }
        return null;
    }
    setBright(v) {
        v = Math.max(0, Math.min(100, Math.round(v)));
        this._async(`brightnessctl s ${v}%`);
    }
    wifi() {
        let o = this._run('nmcli -t -f WIFI general');
        return o.startsWith('enabled');
    }
    setWifi(on) { this._async(`nmcli radio wifi ${on ? 'on' : 'off'}`); }
    dnd() { return !this._dnd.get_boolean('show-banners'); }
    setDnd(on) { this._dnd.set_boolean('show-banners', !on); }
    dark() { return this._iface.get_string('color-scheme') === 'prefer-dark'; }
    setDark(on) { this._iface.set_string('color-scheme', on ? 'prefer-dark' : 'default'); }

    lock() {
        try {
            Gio.DBus.session.call(
                'org.gnome.ScreenSaver', '/org/gnome/ScreenSaver',
                'org.gnome.ScreenSaver', 'Lock',
                null, null, Gio.DBusCallFlags.NONE, -1, null, null);
        } catch (e) { this._async('loginctl lock-session'); }
    }
    logout()  { this._async('gnome-session-quit --logout --no-prompt'); }
    suspend() { this._async('systemctl suspend'); }
    restart() { this._async('gnome-session-quit --reboot --no-prompt'); }
    shutdown(){ this._async('gnome-session-quit --power-off --no-prompt'); }

    battery() {
        try {
            let [ok1, c1] = GLib.file_get_contents('/sys/class/power_supply/BAT0/capacity');
            let [ok2, c2] = GLib.file_get_contents('/sys/class/power_supply/BAT0/status');
            if (ok1) {
                let pct = parseInt(new TextDecoder().decode(c1).trim());
                let st = ok2 ? new TextDecoder().decode(c2).trim() : '';
                return { pct, charging: st === 'Charging' };
            }
        } catch (e) {}
        return { pct: 100, charging: false };
    }
}

/* ============================================================
 * Notifications helper
 * ============================================================ */
class NotifHelper {
    constructor() {
        this._onChange = null;
        this._sigIds = [];
        this._sourceIds = new Map();
        this._origShowNotification = null;
        this._connect();
    }
    set onChange(cb) { this._onChange = cb; }

    _fire() { if (this._onChange) this._onChange(); }

    _connect() {
        let tray = Main.messageTray;
        if (!tray) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._connect();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        let fire = () => this._fire();
        for (let sig of ['source-added', 'source-removed']) {
            try { this._sigIds.push([tray, tray.connect(sig, fire)]); }
            catch (e) {}
        }

        let watchSource = (source) => {
            if (!source || this._sourceIds.has(source)) return;
            try {
                let addId = source.connect('notification-added', fire);
                let destroyId = source.connect('destroy', () => {
                    this._sourceIds.delete(source);
                    this._fire();
                });
                this._sourceIds.set(source, [addId, destroyId]);
            } catch (e) {}
        };

        let sources = tray.getSources ? tray.getSources() : (tray._sources ?? []);
        for (let s of sources) watchSource(s);

        try {
            this._sourceAddedId = tray.connect('source-added', (t, source) => {
                watchSource(source);
                fire();
            });
        } catch (e) {}

        this._installBannerSuppression();
    }

    _installBannerSuppression() {
        let tray = Main.messageTray;
        if (!tray || this._origShowNotification) return;
        let self = this;
        try {
            this._origShowNotification = tray._showNotification;
            tray._showNotification = function (...args) {
                let cfg = globalThis.__mynotchConfig;
                let suppress = !cfg || cfg.get('showNotifPeek', true);
                if (!suppress) {
                    return self._origShowNotification.apply(this, args);
                }
                try {
                    let n = this._notificationQueue?.shift() || null;
                    this._notification = n;
                    this._notificationState = 2;
                    this._notificationTimeoutId = 0;
                    if (typeof this._showNotificationCompleted === 'function')
                        this._showNotificationCompleted();
                } catch (e) {
                    return self._origShowNotification.apply(this, args);
                }
            };
        } catch (e) {
            console.error('MyNotch: banner suppression install failed', e);
            this._origShowNotification = null;
        }
    }

    _removeBannerSuppression() {
        let tray = Main.messageTray;
        if (tray && this._origShowNotification) {
            try { tray._showNotification = this._origShowNotification; } catch (e) {}
        }
        this._origShowNotification = null;
    }

    getNotifications() {
        let out = [];
        try {
            let tray = Main.messageTray;
            if (!tray) return out;
            let sources = tray.getSources ? tray.getSources() : (tray._sources ?? []);
            for (let source of sources) {
                let notifs = source.notifications ?? source._notifications ?? [];
                for (let n of notifs) {
                    if (n.acknowledged) continue;
                    let iconName = 'dialog-information-symbolic';
                    try {
                        if (n.icon instanceof Gio.ThemedIcon) {
                            let names = n.icon.get_names();
                            if (names && names.length) iconName = names[0];
                        } else if (typeof n.icon === 'string') {
                            iconName = n.icon;
                        }
                    } catch (e) {}
                    out.push({
                        id: n.id ?? `${n.title}|${n.body}|${source.title}`,
                        title: n.title || 'Notification',
                        body: n.body || '',
                        iconName,
                        source: source.title || '',
                        notification: n,
                    });
                }
            }
        } catch (e) {
            console.error('MyNotch: getNotifications failed', e);
        }
        return out;
    }

    dismiss(n) {
        try { n.acknowledge(); } catch (e) {
            try { n.destroy(); } catch (e2) {}
        }
    }

    dismissAll() {
        for (let n of this.getNotifications()) this.dismiss(n.notification);
    }

    destroy() {
        for (let [obj, id] of this._sigIds) {
            try { obj.disconnect(id); } catch (e) {}
        }
        this._sigIds = [];
        if (this._sourceAddedId && Main.messageTray) {
            try { Main.messageTray.disconnect(this._sourceAddedId); } catch (e) {}
            this._sourceAddedId = 0;
        }
        if (this._sourceIds) {
            for (let [source, ids] of this._sourceIds) {
                for (let id of ids) {
                    try { source.disconnect(id); } catch (e) {}
                }
            }
            this._sourceIds.clear();
        }
        this._removeBannerSuppression();
        this._onChange = null;
    }
}

/* ============================================================
 * Dynamic CSS dir
 * ============================================================ */
const FONT_SCALE_CSS_DIR = 'mynotch';

/* ============================================================
 * Font scale CSS
 * ============================================================ */
function buildFontScaleCSS(scale, mode) {
    const max = mode === 'peek' ? 1.5 : 1.3;
    const s = Math.max(0.8, Math.min(max, Number(scale) || 1));
    const r = (px) => `${Math.round(px * s * 10) / 10}px`;

    if (mode === 'peek') {
        const K = '.mynotch-peek';
        return `
${K} .mynotch-peek-title { font-size: ${r(13)}; }
${K} .mynotch-peek-body { font-size: ${r(11.5)}; }
`.trim();
    }

    const P = '.mynotch-surface';
    return `
${P} .mynotch-pill-clock { font-size: ${r(13)}; }
${P} .mynotch-pill-title { font-size: ${r(12)}; }
${P} .mynotch-pill-battery-pct { font-size: ${r(12)}; }
${P} .mynotch-tab-btn { font-size: ${r(12.5)}; }
${P} .mynotch-eyebrow { font-size: ${r(10)}; }
${P} .mynotch-track-title { font-size: ${r(19)}; }
${P} .mynotch-track-artist { font-size: ${r(12.5)}; }
${P} .mynotch-knob-num { font-size: ${r(16)}; }
${P} .mynotch-scroll-hint { font-size: ${r(9)}; }
${P} .mynotch-timeline-elapsed,
${P} .mynotch-timeline-total { font-size: ${r(10)}; }
${P} .mynotch-meter-num { font-size: ${r(12)}; }
${P} .mynotch-meter-num-sm { font-size: ${r(9)}; }
${P} .mynotch-meter-label-row { font-size: ${r(9.5)}; }
${P} .mynotch-tray-knob-val { font-size: ${r(13)}; }
${P} .mynotch-tray-knob-label { font-size: ${r(9)}; }
${P} .mynotch-tray-toggle-label { font-size: ${r(9)}; }
${P} .mynotch-tray-battery-text { font-size: ${r(14)}; }
${P} .mynotch-tray-battery-sub { font-size: ${r(10.5)}; }
${P} .mynotch-bt-eyebrow { font-size: ${r(9.5)}; }
${P} .mynotch-bt-name { font-size: ${r(12)}; }
${P} .mynotch-bt-pct { font-size: ${r(10)}; }
${P} .mynotch-bt-status { font-size: ${r(10)}; }
${P} .mynotch-bt-empty { font-size: ${r(11)}; }
${P} .mynotch-cal-summary-day { font-size: ${r(16)}; }
${P} .mynotch-cal-summary-date { font-size: ${r(11.5)}; }
${P} .mynotch-cal-today-btn { font-size: ${r(11)}; }
${P} .mynotch-cal-weekday { font-size: ${r(9)}; }
${P} .mynotch-cal-number { font-size: ${r(16)}; }
${P} .mynotch-cal-pill-active .mynotch-cal-number { font-size: ${r(22)}; }
${P} .mynotch-cal-pill-near .mynotch-cal-number { font-size: ${r(14)}; }
${P} .mynotch-cal-pill-far .mynotch-cal-number { font-size: ${r(12)}; }
${P} .mynotch-cal-today-tag { font-size: ${r(7)}; }
${P} .mynotch-cal-agenda-title { font-size: ${r(12)}; }
${P} .mynotch-cal-agenda-date { font-size: ${r(11)}; }
${P} .mynotch-cal-start { font-size: ${r(11)}; }
${P} .mynotch-cal-end { font-size: ${r(10)}; }
${P} .mynotch-cal-event-title { font-size: ${r(12.5)}; }
${P} .mynotch-cal-event-location { font-size: ${r(11)}; }
${P} .mynotch-cal-empty-title { font-size: ${r(12.5)}; }
${P} .mynotch-cal-empty-sub { font-size: ${r(11)}; }
${P} .mynotch-wp-title { font-size: ${r(13)}; }
${P} .mynotch-wp-subtitle { font-size: ${r(11)}; }
${P} .mynotch-wp-btn { font-size: ${r(11.5)}; }
${P} .mynotch-wp-name { font-size: ${r(10)}; }
${P} .mynotch-wp-empty-title { font-size: ${r(12.5)}; }
${P} .mynotch-wp-empty-sub { font-size: ${r(11)}; }
${P} .mynotch-notif-title { font-size: ${r(15)}; }
${P} .mynotch-notif-subtitle { font-size: ${r(11)}; }
${P} .mynotch-notif-clear { font-size: ${r(11)}; }
${P} .mynotch-notif-item-title { font-size: ${r(13)}; }
${P} .mynotch-notif-item-body { font-size: ${r(11.5)}; }
${P} .mynotch-notif-empty-title { font-size: ${r(13)}; }
${P} .mynotch-notif-empty-sub { font-size: ${r(11)}; }
`.trim();
}

/* ============================================================
 * Main widget
 * ============================================================ */
const MyNotch = GObject.registerClass(
class MyNotch extends St.Widget {
    _init(extension) {
        super._init({
            name: 'MyNotch',
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this.extension = extension;
        this._expanded = false;
        this._isExpanding = false;
        this._tabSwitching = false;
        this._pointerInside = false;
        this._expandTimeoutId = null;
        this._collapseTimeoutId = null;
        this._activeTab = 'music';
        this._refreshId = null;
        this._musicTickId = 0;
        this._tlLen = 0;
        this._tlPos = 0;
        this._tlTrackId = null;
        this._resizeId = 0;
        this._musicDebounceId = 0;
        this._notifDebounceId = 0;
        this._peekHideId = 0;

        this._uiFontScaleStyleFile   = null;
        this._peekFontScaleStyleFile = null;
        this._accentStyleFile        = null;
        this._surfaceStyleFile       = null;
        this._textStyleFile          = null;

        this._wpSlideId = 0;

        this._calEvents        = new Map();
        this._calSignalIds     = [];
        this._calSelectedDate  = new Date();
        this._calSelectedDate.setHours(0, 0, 0, 0);
        this._calLastRangeKey  = '';
        this._calScrollFlushId = 0;
        this._calLastScrollAt  = 0;

        this._sys = new SysInfo();
        this._quick = new Quick();
        this._config = new Config();
        globalThis.__mynotchConfig = this._config;
        setAccent(this._config.get('accent', '#7aa2ff'));
        globalThis.__mynotchFontScale =
            Math.max(0.8, Math.min(1.3,
                (Number(this._config.get('fontScale')) || 100) / 100));
        globalThis.__mynotchPeekFontScale =
            Math.max(0.8, Math.min(1.5,
                (Number(this._config.get('peekFontScale')) || 100) / 100));
        this._metrics = this._readMetrics();

        this._wallpaper = new WallpaperHelper(this._config);
        this._mpris = new MprisHelper();
        this._mpris.onChange = () => this._onMusicChange();

        this._notif = new NotifHelper();
        this._notif.onChange = () => this._onNotifChange();
        this._knownNotifIds = new Set();
        for (let n of this._notif.getNotifications()) this._knownNotifIds.add(n.id);

        this._bt = new BluetoothHelper();
        this._bt.onDevicesChanged = () => {
            if (this._expanded && this._activeTab === 'tray')
                this._renderActiveTab(true);
        };
        this._bt.onPoweredChanged = () => {
            if (this._expanded && this._activeTab === 'tray')
                this._renderActiveTab(true);
        };

        this._artSession = new Soup.Session({ timeout: 15 });
        this._artCache = new Map();
        this._artDir = Gio.File.new_for_path(GLib.build_filenamev(
            [GLib.get_user_cache_dir(), 'mynotch', 'art']));
        try { this._artDir.make_directory_with_parents(null); } catch (e) {}

        /* BLUR */
        this._buildBlur();

        this._surface = new St.BoxLayout({
            style_class: 'mynotch-surface',
            x_expand: true, y_expand: true,
            vertical: true,
        });
        this.add_child(this._surface);

        this._buildPill();
        this._surface.add_child(this._pill);

        this._buildDashboard();
        this._surface.add_child(this._dashboard);
        this._dashboard.visible = false;

        this._applyBlur(false);
        this._applySurfaceStyle();

        this._notifPeek = this._buildNotifPeek();

        this._applyFontScaleCSS('ui',   this._config.get('fontScale'));
        this._applyFontScaleCSS('peek', this._config.get('peekFontScale'));
        this._applyAccentCSS();
        this._applySurfaceCSS();
        this._applyTextCSS();

        this.set_size(this._metrics.pillWidthMin, this._metrics.pillHeight);

        this._updateClock();
        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateClock();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('enter-event', (a, e) => this._onCrossing(e, true));
        this.connect('leave-event', (a, e) => this._onCrossing(e, false));

        this._watchConfig();
        this._reposition();
        this._renderActiveTab(false);
        this._updatePillMusic();
        this._updateNotifBadge();

        this._initCalendarServer();
        this._syncWallpaperSlideshow();
    }

    /* ============================================================
     * Metrics
     * ============================================================ */
    _readMetrics() {
        const c = this._config;
        const clamp = (v, min, max, def) => {
            let n = Number(v);
            if (!Number.isFinite(n)) n = def;
            return Math.max(min, Math.min(max, Math.round(n)));
        };
        return {
            pillHeight:     clamp(c.get('pillHeight'), 28, 64, 40),
            pillWidthMin:   clamp(c.get('pillWidthMin'), 180, 520, 300),
            pillCorner:     clamp(c.get('pillCornerRadius'), 0, 40, 22),
            dashWidth:      clamp(c.get('dashWidth'), 420, 900, 600),
            dashMinHeight:  clamp(c.get('dashMinHeight'), 240, 600, 310),
            expandDelay:    clamp(c.get('expandDelay'), 0, 1500, 180),
            collapseDelay:  clamp(c.get('collapseDelay'), 0, 2000, 400),
            peekWidth:      clamp(c.get('peekWidth'), 260, 720, 420),
            peekHeight:     clamp(c.get('peekHeight'), 56, 140, 78),
            peekDuration:   clamp(c.get('peekDuration'), 1000, 15000, 4200),
            surfaceOpacity: clamp(c.get('surfaceOpacity'), 30, 100, 100),
            hoverToExpand:  c.get('hoverToExpand') === true,
            clickToExpand:  c.get('clickToExpand') === true,
            islandMode:       c.get('islandMode') === true,
            islandTopPadding: clamp(c.get('islandTopPadding'), 0, 64, 8),
            islandCorner:     clamp(c.get('islandCornerRadius'), 0, 40, 22),
        };
    }

    /* ============================================================
     * Font scale
     * ============================================================ */
    _applyFontScaleCSS(mode, scale) {
        const max = mode === 'peek' ? 1.5 : 1.3;
        const s = Math.max(0.8, Math.min(max, (Number(scale) || 100) / 100));

        if (mode === 'peek') {
            globalThis.__mynotchPeekFontScale = s;
            if (this._peekFontScaleStyleFile) {
                try {
                    St.ThemeContext.get_for_stage(global.stage).get_theme()
                        .unload_stylesheet(this._peekFontScaleStyleFile);
                } catch (e) {}
                this._peekFontScaleStyleFile = null;
            }
        } else {
            globalThis.__mynotchFontScale = s;
            if (this._uiFontScaleStyleFile) {
                try {
                    St.ThemeContext.get_for_stage(global.stage).get_theme()
                        .unload_stylesheet(this._uiFontScaleStyleFile);
                } catch (e) {}
                this._uiFontScaleStyleFile = null;
            }
        }

        try {
            let dir = GLib.build_filenamev([GLib.get_user_cache_dir(), FONT_SCALE_CSS_DIR]);
            GLib.mkdir_with_parents(dir, 0o755);
            let path = GLib.build_filenamev([dir, `${mode}-fontscale.css`]);
            GLib.file_set_contents(path, buildFontScaleCSS(s, mode));

            let file = Gio.File.new_for_path(path);
            let theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            theme.load_stylesheet(file);

            if (mode === 'peek') this._peekFontScaleStyleFile = file;
            else                 this._uiFontScaleStyleFile = file;
        } catch (e) {
            console.error(`MyNotch: apply ${mode} font-scale CSS failed`, e);
        }
    }

    /* ============================================================
     * Accent CSS
     * ============================================================ */
    _applyAccentCSS() {
        if (this._accentStyleFile) {
            try {
                St.ThemeContext.get_for_stage(global.stage).get_theme()
                    .unload_stylesheet(this._accentStyleFile);
            } catch (e) {}
            this._accentStyleFile = null;
        }
        try {
            let dir = GLib.build_filenamev([GLib.get_user_cache_dir(), FONT_SCALE_CSS_DIR]);
            GLib.mkdir_with_parents(dir, 0o755);
            let path = GLib.build_filenamev([dir, 'accent.css']);
            GLib.file_set_contents(path,
                buildAccentCSS(this._config.get('accent', '#7aa2ff')));
            let file = Gio.File.new_for_path(path);
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
            this._accentStyleFile = file;
        } catch (e) {
            console.error('MyNotch: apply accent CSS failed', e);
        }
    }

    /* ============================================================
     * Surface CSS
     * ============================================================ */
    _applySurfaceCSS() {
        if (this._surfaceStyleFile) {
            try {
                St.ThemeContext.get_for_stage(global.stage).get_theme()
                    .unload_stylesheet(this._surfaceStyleFile);
            } catch (e) {}
            this._surfaceStyleFile = null;
        }
        try {
            let dir = GLib.build_filenamev([GLib.get_user_cache_dir(), FONT_SCALE_CSS_DIR]);
            GLib.mkdir_with_parents(dir, 0o755);
            let path = GLib.build_filenamev([dir, 'surface.css']);
            GLib.file_set_contents(path, buildSurfaceCSS(
                this._config.get('surfaceColor', '#0d0d10'),
                this._config.get('surfaceOpacity', 100)));
            let file = Gio.File.new_for_path(path);
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
            this._surfaceStyleFile = file;
        } catch (e) {
            console.error('MyNotch: apply surface CSS failed', e);
        }
    }

    /* ============================================================
     * Text CSS
     * ============================================================ */
    _applyTextCSS() {
        if (this._textStyleFile) {
            try {
                St.ThemeContext.get_for_stage(global.stage).get_theme()
                    .unload_stylesheet(this._textStyleFile);
            } catch (e) {}
            this._textStyleFile = null;
        }
        try {
            let dir = GLib.build_filenamev([GLib.get_user_cache_dir(), FONT_SCALE_CSS_DIR]);
            GLib.mkdir_with_parents(dir, 0o755);
            let path = GLib.build_filenamev([dir, 'text.css']);
            GLib.file_set_contents(path, buildTextCSS(
                this._config.get('textPrimary', '#f4f4f6'),
                this._config.get('textSecondary', 'rgba(255, 255, 255, 0.55)')));
            let file = Gio.File.new_for_path(path);
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
            this._textStyleFile = file;
        } catch (e) {
            console.error('MyNotch: apply text CSS failed', e);
        }
    }

    /* ============================================================
     * Surface inline style (khi blur tắt)
     * ============================================================ */
    _applySurfaceStyle() {
        if (this._blurActive) return;
        const opacity = this._metrics.surfaceOpacity / 100;

        const hex = this._config.get('surfaceColor', '#0d0d10');
        const m = String(hex).trim().match(/^#?([0-9a-fA-F]{6})$/);
        const n = parseInt(m ? m[1] : '0d0d10', 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;

        let radiusCss;
        if (this._metrics.islandMode) {
            const rr = this._metrics.islandCorner;
            radiusCss = `border-radius: ${rr}px;`;
        } else {
            const rr = this._metrics.pillCorner;
            radiusCss = `border-radius: 0px 0px ${rr}px ${rr}px;`;
        }

        this._surface.set_style(
            `background-color: rgba(${r}, ${g}, ${b}, ${opacity});` + radiusCss
        );
        if (this._blurActor) this._blurActor.set_style('');
    }

    /* ============================================================
     * Blur
     * ============================================================ */
    _buildBlur() {
        this._blurActor = new St.Widget({
            x_expand: true,
            y_expand: true,
            reactive: false,
        });

        this._blurEffect = new Shell.BlurEffect({
            name: 'mynotch-blur',
            mode: Shell.BlurMode.BACKGROUND,
            radius: 0,
            brightness: 1.0,
        });
        this._blurActor.add_effect(this._blurEffect);
        this.insert_child_at_index(this._blurActor, 0);

        this._blurActive = false;
        this._blurCfg = null;
        this._blurTimeline = null;
    }

    _applyBlur(animate = false) {
        if (!this._blurEffect || !this._blurActor) return;
        let cfg = this._config.blur;
        this._blurCfg = cfg;

        if (!cfg.enabled) {
            this._blurActive = false;
            this._blurEffect.set_enabled(false);
            this._blurEffect.radius = 0;
            this._blurActor.set_style('');
            this._applySurfaceStyle();
            return;
        }

        let p = blurPreset(cfg.preset);
        this._blurActive = true;
        this._blurEffect.set_enabled(true);
        this._blurEffect.brightness = p.brightness;

        let targetR = this._expanded ? cfg.expandedRadius : cfg.collapsedRadius;
        if (animate) this._animateBlurRadius(targetR, 320);
        else this._blurEffect.radius = targetR;

        let radiusCss;
        if (this._metrics.islandMode) {
            const r = this._metrics.islandCorner;
            radiusCss = `border-radius: ${r}px;`;
        } else {
            const r = this._metrics.pillCorner;
            radiusCss = `border-radius: 0px 0px ${r}px ${r}px;`;
        }

        // Tint lấy từ surfaceColor + opacity
        const hex = this._config.get('surfaceColor', '#0d0d10');
        const mm = String(hex).trim().match(/^#?([0-9a-fA-F]{6})$/);
        const nn = parseInt(mm ? mm[1] : '0d0d10', 16);
        const sr = (nn >> 16) & 255;
        const sg = (nn >> 8) & 255;
        const sb = nn & 255;
        const alpha = this._metrics.surfaceOpacity / 100;

        this._blurActor.set_style(
            `background-color: rgba(${sr}, ${sg}, ${sb}, ${alpha});` +
            `border: 1px solid rgba(255, 255, 255, ${p.rim});` +
            `border-top: 1px solid rgba(255, 255, 255, ${p.rimTop});` +
            radiusCss +
            `box-shadow: 0px 8px 26px rgba(0, 0, 0, 0.30);`
        );

        this._surface.set_style(
            `background-color: transparent;` + radiusCss
        );
    }

    _animateBlurRadius(target, duration) {
        if (!this._blurEffect || !this._blurActive) {
            if (this._blurEffect) this._blurEffect.radius = 0;
            return;
        }
        if (this._blurTimeline) { this._blurTimeline.stop(); this._blurTimeline = null; }
        let from = this._blurEffect.radius;
        if (from === target || duration <= 0) { this._blurEffect.radius = target; return; }
        let tl = Clutter.Timeline.new_for_actor(this._blurActor, duration);
        tl.set_progress_mode(Clutter.AnimationMode.EASE_OUT_QUINT);
        tl.connect('new-frame', () => {
            let t = tl.get_progress();
            this._blurEffect.radius = Math.round(from + (target - from) * t);
        });
        tl.connect('stopped', () => {
            this._blurEffect.radius = target;
            this._blurTimeline = null;
        });
        this._blurTimeline = tl;
        tl.start();
    }

    /* ============================================================
     * Config watcher
     * ============================================================ */
    _watchConfig() {
        try {
            let file = Gio.File.new_for_path(this._config._path);
            this._configMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._configId = this._configMonitor.connect('changed', () => {
                if (this._configReloadId) GLib.Source.remove(this._configReloadId);
                this._configReloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._configReloadId = 0;

                    // Capture previous
                    let prevBlurKey       = this._blurCfg ? JSON.stringify(this._blurCfg) : '';
                    let prevUiFontScale   = Number(this._config.get('fontScale')) || 100;
                    let prevPeekFontScale = Number(this._config.get('peekFontScale')) || 100;
                    let prevSlideEnabled  = this._config.get('wpSlideshowEnabled', false) === true;
                    let prevSlideMin      = Number(this._config.get('wpSlideshowMin')) || 30;
                    let prevSlideShuffle  = this._config.get('wpSlideshowShuffle', false) === true;
                    let prevWpFolder      = this._config.get('wallpaperFolder', '') || '';
                    let prevAccent        = this._config.get('accent', '#7aa2ff');
                    let prevSurfaceColor  = this._config.get('surfaceColor', '#0d0d10');
                    let prevSurfaceOpacity= Number(this._config.get('surfaceOpacity')) || 100;
                    let prevTextPrimary   = this._config.get('textPrimary', '#f4f4f6');
                    let prevTextSecondary = this._config.get('textSecondary', 'rgba(255, 255, 255, 0.55)');

                    this._config = new Config();
                    globalThis.__mynotchConfig = this._config;
                    setAccent(this._config.get('accent', '#7aa2ff'));
                    this._wallpaper = new WallpaperHelper(this._config);
                    this._metrics = this._readMetrics();

                    this._applySurfaceStyle();
                    if (this._blurActive) this._applyBlur(false);
                    this._reposition();

                    this._rebuildTabStrip();

                    // Accent
                    let nextAccent = this._config.get('accent', '#7aa2ff');
                    if (nextAccent !== prevAccent) this._applyAccentCSS();

                    // Surface
                    let nextSurfaceColor   = this._config.get('surfaceColor', '#0d0d10');
                    let nextSurfaceOpacity = Number(this._config.get('surfaceOpacity')) || 100;
                    if (nextSurfaceColor !== prevSurfaceColor ||
                        nextSurfaceOpacity !== prevSurfaceOpacity) {
                        this._applySurfaceCSS();
                    }

                    // Text
                    let nextTextPrimary   = this._config.get('textPrimary', '#f4f4f6');
                    let nextTextSecondary = this._config.get('textSecondary', 'rgba(255, 255, 255, 0.55)');
                    if (nextTextPrimary !== prevTextPrimary ||
                        nextTextSecondary !== prevTextSecondary) {
                        this._applyTextCSS();
                    }

                    // Font scale UI
                    let nextUiFontScale = Number(this._config.get('fontScale')) || 100;
                    if (nextUiFontScale !== prevUiFontScale) {
                        this._applyFontScaleCSS('ui', nextUiFontScale);
                    } else {
                        globalThis.__mynotchFontScale =
                            Math.max(0.8, Math.min(1.3, nextUiFontScale / 100));
                    }

                    // Font scale peek
                    let nextPeekFontScale = Number(this._config.get('peekFontScale')) || 100;
                    if (nextPeekFontScale !== prevPeekFontScale) {
                        this._applyFontScaleCSS('peek', nextPeekFontScale);
                    } else {
                        globalThis.__mynotchPeekFontScale =
                            Math.max(0.8, Math.min(1.5, nextPeekFontScale / 100));
                    }

                    // Blur
                    let nextBlurKey = JSON.stringify(this._config.blur);
                    if (nextBlurKey !== prevBlurKey) this._applyBlur(true);
                    else if (!this._blurActive) this._applySurfaceStyle();

                    // Slideshow
                    let nextSlideEnabled = this._config.get('wpSlideshowEnabled', false) === true;
                    let nextSlideMin     = Number(this._config.get('wpSlideshowMin')) || 30;
                    let nextSlideShuffle = this._config.get('wpSlideshowShuffle', false) === true;
                    let nextWpFolder     = this._config.get('wallpaperFolder', '') || '';

                    if (nextSlideEnabled  !== prevSlideEnabled  ||
                        nextSlideMin      !== prevSlideMin      ||
                        nextSlideShuffle  !== prevSlideShuffle  ||
                        nextWpFolder      !== prevWpFolder) {
                        this._syncWallpaperSlideshow();
                    }

                    this._updateClock();
                    this._updatePillMusic();
                    this._renderActiveTab(true);
                    if (!this._expanded) {
                        this.set_size(this._metrics.pillWidthMin, this._metrics.pillHeight);
                        this._reposition();
                    }
                    if (this._peekAdded) this._positionPeek();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            console.error('MyNotch: config watch failed', e);
        }
    }

    /* ============================================================
     * Tab button factory
     * ============================================================ */
    _makeTabButton(tab) {
        let btn = new St.Button({
            style_class: 'mynotch-tab-btn',
            reactive: true, can_focus: true,
        });
        btn.set_pivot_point(0.5, 0.5);
        let row = new St.BoxLayout({ vertical: false });
        let icon = new St.Icon({
            icon_name: tab.icon, icon_size: 12,
            style_class: 'mynotch-tab-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        let label = new St.Label({ text: tab.label, y_align: Clutter.ActorAlign.CENTER });
        row.add_child(icon);
        row.add_child(label);
        btn._label = label;
        btn._icon = icon;
        btn.set_child(row);
        btn.connect('clicked', () => this._switchTab(tab.id));
        btn.connect('notify::hover', () => {
            btn.ease({
                scale_x: btn.hover ? 1.05 : 1.0,
                scale_y: btn.hover ? 1.05 : 1.0,
                duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        btn.connect('scroll-event', (a, e) => this._onTabScroll(e));
        return btn;
    }

    _rebuildTabStrip() {
        if (!this._tabStrip) return;
        this._tabStrip.destroy_all_children();
        this._tabButtons = {};
        for (let tab of this._visibleTabs()) {
            let btn = this._makeTabButton(tab);
            this._tabStrip.add_child(btn);
            this._tabButtons[tab.id] = btn;
        }
        this._updateActiveTabButton(false);
    }

    _visibleTabs() {
        const hidden = String(this._config.get('hideTabs') || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        let tabs = TAB_DEFS.filter(t => !hidden.includes(t.id));
        if (tabs.length === 0) tabs = TAB_DEFS.slice();
        if (!tabs.find(t => t.id === this._activeTab)) {
            this._activeTab = tabs[0].id;
        }
        return tabs;
    }

    /* ============================================================
     * PILL
     * ============================================================ */
    _buildPill() {
        this._pill = new St.BoxLayout({
            style_class: 'mynotch-pill-content',
            x_expand: true, y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            vertical: false,
            reactive: true,
        });

        this._pill.connect('button-press-event', () => {
            if (this._metrics.clickToExpand && !this._expanded) {
                this._expand();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._pillMusicBox = new St.BoxLayout({
            style_class: 'mynotch-pill-music',
            y_align: Clutter.ActorAlign.CENTER,
            vertical: false, visible: false,
        });
        this._pillEq = new EqBars();
        this._pillMusicBox.add_child(this._pillEq);
        this._pillTitle = new St.Label({
            text: '', style_class: 'mynotch-pill-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._pillTitle.clutter_text.single_line_mode = true;
        this._pillMusicBox.add_child(this._pillTitle);
        this._pill.add_child(this._pillMusicBox);

        this._pill.add_child(new St.Widget({ x_expand: true }));

        this._pillClock = new St.Label({
            text: '00:00', style_class: 'mynotch-pill-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillClock.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._pillClock.clutter_text.single_line_mode = true;
        this._pill.add_child(this._pillClock);

        this._pill.add_child(new St.Widget({ x_expand: true }));

        this._pillBatteryBox = new St.BoxLayout({
            style_class: 'mynotch-pill-battery',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillBatteryIcon = new St.Icon({
            icon_name: 'battery-good-symbolic',
            style_class: 'mynotch-pill-icon',
            icon_size: 13, y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillBatteryLabel = new St.Label({
            text: '', style_class: 'mynotch-pill-battery-pct',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pillBatteryBox.add_child(this._pillBatteryIcon);
        this._pillBatteryBox.add_child(this._pillBatteryLabel);
        this._pill.add_child(this._pillBatteryBox);
    }

    /* ============================================================
     * DASHBOARD
     * ============================================================ */
    _buildDashboard() {
        this._dashboard = new St.BoxLayout({
            style_class: 'mynotch-dashboard',
            vertical: true, x_expand: true, y_expand: true,
        });

        let header = new St.BoxLayout({
            style_class: 'mynotch-header',
            vertical: false, x_expand: true,
        });

        this._tabStrip = new St.BoxLayout({
            style_class: 'mynotch-tab-strip',
            vertical: false,
        });
        this._tabButtons = {};
        for (let tab of this._visibleTabs()) {
            let btn = this._makeTabButton(tab);
            this._tabStrip.add_child(btn);
            this._tabButtons[tab.id] = btn;
        }
        this._tabStrip.connect('scroll-event', (a, e) => this._onTabScroll(e));
        header.add_child(this._tabStrip);
        header.add_child(new St.Widget({ x_expand: true }));

        let power = new St.Button({
            style_class: 'mynotch-settings-btn mynotch-power-btn',
            reactive: true, can_focus: true,
            x_align: Clutter.ActorAlign.END,
        });
        power.set_pivot_point(0.5, 0.5);
        power.set_child(new St.Icon({
            icon_name: 'system-shutdown-symbolic', icon_size: 15,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        }));
        power.connect('clicked', () => this._openPowerMenu(power));
        power.connect('notify::hover', () => {
            power.ease({
                scale_x: power.hover ? 1.10 : 1.0,
                scale_y: power.hover ? 1.10 : 1.0,
                duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        header.add_child(power);

        let gear = new St.Button({
            style_class: 'mynotch-settings-btn',
            reactive: true, can_focus: true,
            x_align: Clutter.ActorAlign.END,
        });
        gear.set_pivot_point(0.5, 0.5);
        gear.set_child(new St.Icon({
            icon_name: 'preferences-system-symbolic', icon_size: 15,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        }));
        gear.connect('clicked', () => {
            try {
                if (this.extension && this.extension.openPreferences)
                    this.extension.openPreferences();
            } catch (e) { console.error('MyNotch: openPreferences failed', e); }
        });
        gear.connect('notify::hover', () => {
            gear.ease({
                scale_x: gear.hover ? 1.10 : 1.0,
                scale_y: gear.hover ? 1.10 : 1.0,
                duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        header.add_child(gear);

        this._dashboard.add_child(header);

        this._content = new St.BoxLayout({
            style_class: 'mynotch-content',
            vertical: true, x_expand: true, y_expand: true,
        });
        this._dashboard.add_child(this._content);

        this._updateActiveTabButton(false);
    }

    _onTabScroll(e) {
        let dir = e.get_scroll_direction();
        let step = 0;
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT) step = -1;
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT) step = 1;
        else return Clutter.EVENT_PROPAGATE;
        this._stepTab(step);
        return Clutter.EVENT_STOP;
    }

    _stepTab(dir) {
        const tabs = this._visibleTabs();
        let idx = tabs.findIndex(t => t.id === this._activeTab);
        if (idx < 0) idx = 0;
        idx = (idx + dir + tabs.length) % tabs.length;
        this._switchTab(tabs[idx].id);
    }

    _updateActiveTabButton(bounce = true) {
        for (let [id, btn] of Object.entries(this._tabButtons)) {
            if (id === this._activeTab) {
                btn.add_style_class_name('mynotch-tab-btn-active');
                if (bounce) {
                    btn.ease({
                        scale_x: 1.08, scale_y: 1.08, duration: 110,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            btn.ease({ scale_x: 1.0, scale_y: 1.0, duration: 200,
                                mode: Clutter.AnimationMode.EASE_OUT_QUINT });
                        },
                    });
                }
            } else {
                btn.remove_style_class_name('mynotch-tab-btn-active');
            }
        }
    }

    _switchTab(id) {
        if (id === this._activeTab) return;
        if (!this._tabButtons[id]) return;

        this._content.remove_all_transitions();

        let tabs = this._visibleTabs();
        let fromIdx = tabs.findIndex(t => t.id === this._activeTab);
        let toIdx = tabs.findIndex(t => t.id === id);
        let goingRight = toIdx > fromIdx;
        let outX = goingRight ? -22 : 22;
        let inX = goingRight ? 22 : -22;

        this._content.ease({
            opacity: 0, translation_x: outX, duration: 130,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._stopLive();
                this._activeTab = id;
                this._updateActiveTabButton(true);
                this._content.destroy_all_children();
                this._renderTabContent(id);
                this._resizeToContent(true);
                this._content.translation_x = inX;
                this._content.opacity = 0;
                this._content.ease({
                    opacity: 255, translation_x: 0, duration: 240,
                    mode: Clutter.AnimationMode.EASE_OUT_QUINT,
                    onComplete: () => {
                        this._content.translation_x = 0;
                    },
                });
            },
        });
    }

    _measureContentHeight() {
        const inner = this._metrics.dashWidth - 32 - 16 - 4;
        let [, dashH] = this._dashboard.get_preferred_height(inner);
        return Math.max(this._metrics.dashMinHeight,
            Math.ceil(dashH) + this._metrics.pillHeight + 8);
    }

    _resizeToContent(animate = true) {
        if (!this._expanded || this._isExpanding) return;
        if (this._resizeId) GLib.Source.remove(this._resizeId);
        this._resizeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            this._resizeId = 0;
            if (!this._expanded || this._isExpanding) return GLib.SOURCE_REMOVE;
            let targetH = this._measureContentHeight();
            let curH = this.get_height();
            if (Math.abs(targetH - curH) < 2) return GLib.SOURCE_REMOVE;
            this.set_height(targetH);
            return GLib.SOURCE_REMOVE;
        });
    }

    _renderTabContent(id) {
        switch (id) {
            case 'music':     this._renderMusic(); break;
            case 'notif':     this._renderNotifications(); break;
            case 'tray':      this._renderTray(); break;
            case 'calendar':  this._renderCalendar(); break;
            case 'wallpaper': this._renderWallpaper(); break;
        }
    }

    _renderActiveTab(animate = false) {
        this._stopLive();
        this._content.destroy_all_children();
        this._content.translation_x = 0;
        this._content.opacity = 255;
        this._renderTabContent(this._activeTab);
        this._resizeToContent(animate);
    }

    _stopLive() {
        this._stopMusicTick();
        if (this._musicDebounceId) {
            GLib.Source.remove(this._musicDebounceId);
            this._musicDebounceId = 0;
        }
        if (this._eq) { this._eq.stop(); this._eq = null; }
        if (this._vinyl) { this._vinyl.stopSpin(); this._vinyl = null; }
        if (this._refreshId) { GLib.Source.remove(this._refreshId); this._refreshId = 0; }
    }

    _stopMusicTick() {
        if (this._musicTickId) { GLib.Source.remove(this._musicTickId); this._musicTickId = 0; }
    }

    /* ============================================================
     * WALLPAPER SLIDESHOW
     * ============================================================ */
    _syncWallpaperSlideshow() {
        if (this._wpSlideId) {
            GLib.Source.remove(this._wpSlideId);
            this._wpSlideId = 0;
        }

        const enabled = this._config.get('wpSlideshowEnabled', false) === true;
        if (!enabled) return;

        let min = Number(this._config.get('wpSlideshowMin'));
        if (!Number.isFinite(min) || min < 1) min = 30;
        if (min > 1440) min = 1440;

        const secs = Math.round(min * 60);

        this._wpSlideId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            secs,
            () => {
                this._tickWallpaperSlideshow();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _tickWallpaperSlideshow() {
        const shuffle = this._config.get('wpSlideshowShuffle', false) === true;
        let path;
        try {
            path = this._wallpaper.nextWallpaper(shuffle);
        } catch (e) {
            console.error('MyNotch: nextWallpaper failed', e);
            return;
        }
        if (!path) return;

        let current = null;
        try { current = this._wallpaper.getCurrent(); } catch (e) {}
        if (current === path) return;

        if (this._wallpaper.setWallpaper(path)) {
            if (this._expanded && this._activeTab === 'wallpaper') {
                this._renderActiveTab(false);
            }
        }
    }

    /* ============================================================
     * MUSIC
     * ============================================================ */
    _renderMusic() {
        let info = this._mpris.getTrackInfo();
        let playing = info.status === 'Playing';
        const vinylSize = this._config.get('musicVinylSize');
        const spin = this._config.get('musicVinylSpin') !== false;
        const showTimeline = this._config.get('musicShowTimeline') !== false;

        let panel = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
        let body = new St.BoxLayout({
            style_class: 'mynotch-media-body',
            vertical: false, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: vinylSize, height: vinylSize,
        });
        let vinyl = new Vinyl(vinylSize);
        this._vinyl = vinyl;
        if (playing && spin) vinyl.startSpin();
        stack.add_child(vinyl);
        let artDisc = new AlbumArtDisc(52);
        let artFrame = new St.Bin({
            style_class: 'mynotch-vinyl-art-frame',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        artFrame.set_child(artDisc);
        stack.add_child(artFrame);
        if (info.albumArt) this._loadArt(info.albumArt, artDisc);
        body.add_child(stack);

        let mid = new St.BoxLayout({
            style_class: 'mynotch-media-mid',
            vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let eyebrow = new St.BoxLayout({
            style_class: 'mynotch-eyebrow-row', vertical: false,
        });
        eyebrow.add_child(new St.Label({
            text: playing ? 'NOW PLAYING' : (info.hasMedia ? 'PAUSED' : 'NO MEDIA'),
            style_class: 'mynotch-eyebrow',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        let eq = new EqBars();
        eq.setAccentColor();
        this._eq = eq;
        if (playing) eq.start();
        eyebrow.add_child(eq);
        mid.add_child(eyebrow);

        let title = info.hasMedia ? String(info.title) : 'Nothing playing';
        let artist = info.hasMedia ? String(info.artist || '') : 'Open a player to begin';
        if (title.length > 44) title = title.substring(0, 42) + '…';
        if (artist.length > 48) artist = artist.substring(0, 46) + '…';
        mid.add_child(new St.Label({ text: title, style_class: 'mynotch-track-title' }));
        mid.add_child(new St.Label({ text: artist, style_class: 'mynotch-track-artist' }));

        let controls = new St.BoxLayout({ style_class: 'mynotch-transport', vertical: false });
        let mkBtn = (icon, cb, enabled, primary, active) => {
            let b = new St.Button({
                style_class: primary
                    ? 'mynotch-transport-btn mynotch-transport-primary'
                    : 'mynotch-transport-btn',
                reactive: enabled !== false, can_focus: enabled !== false,
            });
            b.set_pivot_point(0.5, 0.5);
            let ic = new St.Icon({
                icon_name: icon, icon_size: primary ? 18 : 16,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (active && !primary) ic.set_style(`color: ${accentHex()};`);
            b.set_child(ic);
            if (enabled !== false) b.connect('clicked', cb);
            else b.set_opacity(90);
            b.connect('notify::hover', () => {
                if (enabled === false) return;
                b.ease({
                    scale_x: b.hover ? 1.12 : 1.0,
                    scale_y: b.hover ? 1.12 : 1.0,
                    duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
            return b;
        };
        let playIcon = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        controls.add_child(mkBtn('media-skip-backward-symbolic',
            () => this._mpris.previous(), info.canPrev));
        controls.add_child(mkBtn(playIcon,
            () => this._mpris.playPause(), info.canPlay || info.hasMedia, true));
        controls.add_child(mkBtn('media-skip-forward-symbolic',
            () => this._mpris.next(), info.canNext));
        controls.add_child(mkBtn('media-playlist-shuffle-symbolic',
            () => { this._mpris.toggleShuffle(); this._renderActiveTab(true); },
            info.hasShuffle, false, info.shuffle));
        let loopIcon = info.loopStatus === 'Track'
            ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
        controls.add_child(mkBtn(loopIcon,
            () => { this._mpris.cycleLoop(); this._renderActiveTab(true); },
            info.hasLoop, false, info.loopStatus !== 'None'));
        mid.add_child(controls);
        body.add_child(mid);

        let knobCol = new St.BoxLayout({
            style_class: 'mynotch-knob-col',
            vertical: true, y_align: Clutter.ActorAlign.CENTER,
        });
        let knob = new Knob(74);
        let vol = this._quick.vol();
        knob.setValue(vol / 100);
        let knobBtn = new St.Button({ reactive: true, can_focus: false });
        knobBtn.set_child(knob);
        let knobVal = new St.Label({ text: String(vol), style_class: 'mynotch-knob-num' });
        let knobValBin = new St.Bin({ x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        knobValBin.set_child(knobVal);
        let knobStack = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        knobStack.add_child(knobBtn);
        knobStack.add_child(knobValBin);
        knobBtn.connect('scroll-event', (a, e) => {
            let dir = e.get_scroll_direction();
            let d = (dir === Clutter.ScrollDirection.UP) ? 4
                  : (dir === Clutter.ScrollDirection.DOWN) ? -4 : 0;
            if (d) {
                let v = Math.max(0, Math.min(100, this._quick.vol() + d));
                this._quick.setVol(v);
                knob.setValue(v / 100);
                knobVal.set_text(String(v));
            }
            return Clutter.EVENT_STOP;
        });
        knobCol.add_child(knobStack);
        let hint = new St.BoxLayout({
            style_class: 'mynotch-scroll-hint', x_align: Clutter.ActorAlign.CENTER,
        });
        hint.add_child(new St.Icon({ icon_name: 'input-mouse-symbolic', icon_size: 11, y_align: Clutter.ActorAlign.CENTER }));
        hint.add_child(new St.Label({ text: 'SCROLL', y_align: Clutter.ActorAlign.CENTER }));
        knobCol.add_child(hint);
        body.add_child(knobCol);
        panel.add_child(body);

        if (info.hasMedia && info.length > 0 && showTimeline) {
            let tlRow = new St.BoxLayout({ vertical: false, x_expand: true });
            tlRow.add_child(new St.Widget({ width: 162 }));
            let tl = this._buildTimeline(info);
            tl.x_expand = true;
            tlRow.add_child(tl);
            panel.add_child(tlRow);
        }

        this._content.add_child(panel);
    }

    _buildTimeline(info) {
        let len = Number(info.length) || 0;
        this._tlLen = len;
        this._tlPos = 0;
        this._tlTrackId = info.trackId ?? null;
        this._mpris.getPositionAsync(p => { this._tlPos = p; this._updateTimeline(); });

        let wrap = new St.BoxLayout({ style_class: 'mynotch-timeline', vertical: true, x_expand: true });
        let track = new St.Button({ reactive: info.hasMedia, can_focus: false, x_expand: true });
        let base = new St.Widget({
            style_class: 'mynotch-timeline-base', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.FixedLayout(),
        });
        let fill = new St.Widget({ style_class: 'mynotch-timeline-fill' });
        fill.set_position(0, 0);
        base.add_child(fill);
        base.connect('notify::width', () => this._updateTimeline());
        base.connect('notify::height', () => this._updateTimeline());
        track.set_child(base);
        this._tlBase = base;
        this._tlFill = fill;

        let labels = new St.BoxLayout({ style_class: 'mynotch-timeline-labels', vertical: false, x_expand: true });
        let elapsed = new St.Label({ text: '0:00', style_class: 'mynotch-timeline-elapsed' });
        let total = new St.Label({
            text: len > 0 ? this._fmtTime(len) : '--:--',
            style_class: 'mynotch-timeline-total',
            x_align: Clutter.ActorAlign.END, x_expand: true,
        });
        labels.add_child(elapsed);
        labels.add_child(total);
        this._tlElapsed = elapsed;
        wrap.add_child(track);
        wrap.add_child(labels);

        track.connect('scroll-event', (a, e) => {
            if (!info.hasMedia || this._tlLen <= 0) return Clutter.EVENT_PROPAGATE;
            let dir = e.get_scroll_direction();
            let step = (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT) ? -5
                     : (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT) ? 5 : 0;
            if (!step) return Clutter.EVENT_PROPAGATE;
            let pos = Math.max(0, Math.min(this._tlLen, this._tlPos + step * 1e6));
            this._tlPos = pos;
            this._updateTimeline();
            if (this._tlTrackId) this._mpris.setPosition(this._tlTrackId, pos);
            return Clutter.EVENT_STOP;
        });

        this._updateTimeline();
        if (info.status === 'Playing' && len > 0) {
            this._musicTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (!this._expanded || this._activeTab !== 'music') {
                    this._musicTickId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (this._mpris.getTrackInfo().status === 'Playing') {
                    this._tlPos += 1e6;
                    this._updateTimeline();
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
        return wrap;
    }

    _updateTimeline() {
        if (!this._tlBase || !this._tlFill) return;
        let w = this._tlBase.get_width(), h = this._tlBase.get_height();
        if (w > 0) {
            let frac = this._tlLen > 0 ? Math.max(0, Math.min(1, this._tlPos / this._tlLen)) : 0;
            this._tlFill.set_width(Math.round(w * frac));
            if (h > 0) this._tlFill.set_height(h);
            this._tlFill.set_position(0, 0);
        }
        if (this._tlElapsed) this._tlElapsed.set_text(this._fmtTime(this._tlPos));
    }

    _fmtTime(us) {
        let s = Math.max(0, Math.floor((Number(us) || 0) / 1e6));
        let m = Math.floor(s / 60);
        let ss = s % 60;
        return `${m}:${String(ss).padStart(2, '0')}`;
    }

    /* ============================================================
     * NOTIFICATIONS TAB
     * ============================================================ */
    _renderNotifications() {
        let panel = new St.BoxLayout({
            style_class: 'mynotch-notif-panel',
            vertical: true, x_expand: true, y_expand: true,
        });
        this._content.add_child(panel);

        let allNotifs = this._notif.getNotifications();
        const maxVisible = Number(this._config.get('notifMaxVisible')) || 50;
        let notifs = allNotifs.slice(0, maxVisible);
        const showClearAll = this._config.get('notifShowClearAll') !== false;

        let header = new St.BoxLayout({
            style_class: 'mynotch-notif-header',
            vertical: false, x_expand: true,
        });
        let titleBox = new St.BoxLayout({ vertical: true, x_expand: true });
        titleBox.add_child(new St.Label({
            text: 'Notifications',
            style_class: 'mynotch-notif-title',
        }));
        titleBox.add_child(new St.Label({
            text: notifs.length ? `${notifs.length} active` : 'All caught up',
            style_class: 'mynotch-notif-subtitle',
        }));
        header.add_child(titleBox);

        if (notifs.length > 0 && showClearAll) {
            let clearBtn = new St.Button({
                style_class: 'mynotch-notif-clear',
                reactive: true, can_focus: true,
                label: 'Clear all',
                y_align: Clutter.ActorAlign.CENTER,
            });
            clearBtn.connect('clicked', () => this._notif.dismissAll());
            header.add_child(clearBtn);
        }
        panel.add_child(header);

        if (notifs.length === 0) {
            panel.add_child(this._mkNotifEmpty());
            return;
        }

        let scroll = new St.ScrollView({
            style_class: 'mynotch-notif-scroll',
            x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        let list = new St.BoxLayout({
            style_class: 'mynotch-notif-list',
            vertical: true, x_expand: true,
        });
        for (let n of notifs) list.add_child(this._mkNotifItem(n));
        scroll.set_child(list);
        panel.add_child(scroll);
    }

    _mkNotifItem(n) {
        let item = new St.Button({
            style_class: 'mynotch-notif-item',
            reactive: true, can_focus: true,
            x_expand: true,
        });
        let inner = new St.BoxLayout({
            vertical: false, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.set_child(inner);

        inner.add_child(new St.Icon({
            icon_name: n.iconName || 'dialog-information-symbolic',
            icon_size: 22,
            style_class: 'mynotch-notif-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        let text = new St.BoxLayout({
            vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        let title = new St.Label({
            text: n.title || 'Notification',
            style_class: 'mynotch-notif-item-title',
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        title.clutter_text.single_line_mode = true;
        let body = new St.Label({
            text: n.body || n.source || '',
            style_class: 'mynotch-notif-item-body',
        });
        body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        body.clutter_text.single_line_mode = true;
        text.add_child(title);
        text.add_child(body);
        inner.add_child(text);

        let dismiss = new St.Button({
            style_class: 'mynotch-notif-dismiss',
            reactive: true, can_focus: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        dismiss.set_child(new St.Icon({
            icon_name: 'window-close-symbolic', icon_size: 12,
        }));
        dismiss.connect('clicked', () => {
            this._notif.dismiss(n.notification);
        });
        dismiss.connect('button-press-event', () => Clutter.EVENT_STOP);
        inner.add_child(dismiss);

        item.connect('clicked', () => {
            try {
                if (n.notification && typeof n.notification.activate === 'function') {
                    n.notification.activate();
                }
            } catch (e) {
                console.error('MyNotch: activate notification failed', e);
            }
            try { this._notif.dismiss(n.notification); } catch (e) {}
            this._renderActiveTab(true);
        });

        return item;
    }

    _mkNotifEmpty() {
        let box = new St.BoxLayout({
            style_class: 'mynotch-notif-empty',
            vertical: true, x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Icon({
            icon_name: 'notifications-disabled-symbolic', icon_size: 34,
            style_class: 'mynotch-notif-empty-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: 'No notifications',
            style_class: 'mynotch-notif-empty-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: 'You are all caught up',
            style_class: 'mynotch-notif-empty-sub',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        return box;
    }

    _updateNotifBadge() {
        let btn = this._tabButtons['notif'];
        if (!btn || !btn._label) return;
        let base = (TAB_DEFS.find(t => t.id === 'notif') || {}).label || 'Notif';
        let count = this._notif.getNotifications().length;
        btn._label.set_text(count > 0 ? `${base} · ${count}` : base);
    }

    _onNotifChange() {
        if (this._notifDebounceId) return;
        this._notifDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._notifDebounceId = 0;
            this._applyNotifChange();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyNotifChange() {
        this._updateNotifBadge();

        let notifs = this._notif.getNotifications();
        let newOnes = notifs.filter(n => !this._knownNotifIds.has(n.id));
        for (let n of notifs) this._knownNotifIds.add(n.id);
        if (this._knownNotifIds.size > 300)
            this._knownNotifIds = new Set(notifs.map(n => n.id));

        if (newOnes.length > 0 && !this._expanded && this._config.get('showNotifPeek', true)) {
            this._showNotifPeek(newOnes[newOnes.length - 1]);
        }

        if (this._expanded && this._activeTab === 'notif') {
            this._renderActiveTab(true);
        }
    }

    /* ============================================================
     * NOTIFICATION PEEK
     * ============================================================ */
    _buildNotifPeek() {
        let peek = new St.BoxLayout({
            style_class: 'mynotch-peek',
            vertical: false,
            reactive: true,
            visible: false,
            opacity: 0,
        });
        let iconBox = new St.Bin({
            style_class: 'mynotch-peek-icon-box',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        let icon = new St.Icon({
            icon_name: 'dialog-information-symbolic',
            icon_size: 26,
            style_class: 'mynotch-peek-icon',
        });
        iconBox.set_child(icon);
        peek.add_child(iconBox);

        let text = new St.BoxLayout({
            vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        let title = new St.Label({ style_class: 'mynotch-peek-title', text: '' });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        title.clutter_text.single_line_mode = true;
        let body = new St.Label({ style_class: 'mynotch-peek-body', text: '' });
        body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        body.clutter_text.single_line_mode = true;
        text.add_child(title);
        text.add_child(body);
        peek.add_child(text);

        peek._icon = icon;
        peek._title = title;
        peek._body = body;
        peek._n = null;

        peek.connect('button-press-event', () => {
            if (peek._n) {
                try { this._notif.dismiss(peek._n.notification); } catch (e) {}
            }
            this._hideNotifPeek();
            return Clutter.EVENT_STOP;
        });

        return peek;
    }

    addPeek() {
        if (this._peekAdded) return;
        try {
            Main.layoutManager.addTopChrome(this._notifPeek, { trackFullscreen: false });
            this._peekAdded = true;
        } catch (e) {
            console.error('MyNotch: addTopChrome(peek) failed', e);
            this._peekAdded = false;
        }
        this._positionPeek();
    }

    removePeek() {
        if (!this._peekAdded) return;
        this._peekAdded = false;
        try { Main.layoutManager.removeChrome(this._notifPeek); } catch (e) {}
    }

    _positionPeek() {
        if (!this._notifPeek) return;
        let m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        const pw = this._metrics.peekWidth;
        const ph = this._metrics.peekHeight;
        this._notifPeek.set_size(pw, ph);
        const topOffset = this._metrics.islandMode
            ? this._metrics.islandTopPadding : 0;
        this._notifPeek.set_position(
            m.x + Math.floor((m.width - pw) / 2),
            m.y + topOffset + this._metrics.pillHeight + 10
        );
    }

    _showNotifPeek(n) {
        if (!this._notifPeek || !this._peekAdded) return;
        this._positionPeek();

        const peekScale = Math.max(0.8, Math.min(1.5,
            (Number(this._config.get('peekFontScale')) || 100) / 100));
        const r = (px) => `${Math.round(px * peekScale * 10) / 10}px`;

        this._notifPeek._icon.icon_name = n.iconName || 'dialog-information-symbolic';
        this._notifPeek._title.set_text(n.title || 'Notification');
        this._notifPeek._title.set_style(`font-size: ${r(13)};`);
        this._notifPeek._body.set_text(n.body || n.source || '');
        this._notifPeek._body.set_style(`font-size: ${r(11.5)};`);
        this._notifPeek._n = n;

        if (this._peekHideId) { GLib.Source.remove(this._peekHideId); this._peekHideId = 0; }

        this._notifPeek.remove_all_transitions();
        this._notifPeek.visible = true;
        this._notifPeek.opacity = 0;
        this._notifPeek.translation_y = -12;
        this._notifPeek.ease({
            opacity: 255, translation_y: 0, duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
        });

        this._peekHideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._metrics.peekDuration, () => {
            this._peekHideId = 0;
            this._hideNotifPeek();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideNotifPeek() {
        if (!this._notifPeek || !this._notifPeek.visible) return;
        if (this._peekHideId) { GLib.Source.remove(this._peekHideId); this._peekHideId = 0; }
        this._notifPeek.remove_all_transitions();
        this._notifPeek.ease({
            opacity: 0, translation_y: -8, duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => { this._notifPeek.visible = false; },
        });
    }

    /* ============================================================
     * POWER MENU
     * ============================================================ */
    _openPowerMenu(anchor) {
        if (this._powerMenu) {
            try { this._powerMenu.destroy(); } catch (e) {}
            this._powerMenu = null;
        }
        let menu = new PopupMenu.PopupMenu(anchor, 0.5, St.Side.BOTTOM);
        menu.actor.add_style_class_name('mynotch-power-menu');

        let addItem = (label, icon, cb) => {
            let item = new PopupMenu.PopupImageMenuItem(label, icon);
            item.connect('activate', () => {
                try { menu.close(); } catch (e) {}
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                    try { cb(); } catch (e) { console.error('MyNotch power action failed', e); }
                    return GLib.SOURCE_REMOVE;
                });
            });
            menu.addMenuItem(item);
        };

        addItem('Lock screen', 'changes-prevent-symbolic', () => this._quick.lock());
        addItem('Log out',     'system-log-out-symbolic',  () => this._quick.logout());
        addItem('Suspend',     'media-playback-pause-symbolic', () => this._quick.suspend());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        addItem('Restart',     'system-reboot-symbolic',   () => this._quick.restart());
        addItem('Shut down',   'system-shutdown-symbolic', () => this._quick.shutdown());

        menu.connect('open-state-changed', (m, open) => {
            if (open) return;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                if (!this._pointerIsOver() && this._expanded) {
                    this._collapseImmediately();
                }
                return GLib.SOURCE_REMOVE;
            });
        });

        try { Main.uiGroup.add_child(menu.actor); } catch (e) {}
        menu.open();
        this._powerMenu = menu;
    }

    /* ============================================================
     * TRAY
     * ============================================================ */
    _renderTray() {
        let panel = new St.BoxLayout({
            style_class: 'mynotch-tray-panel',
            vertical: true, x_expand: true, y_expand: true,
        });

        let meters = new St.BoxLayout({
            style_class: 'mynotch-meters-row',
            vertical: false, x_expand: true,
        });

        let mkRing = (label, icon, color) => {
            let tile = new St.BoxLayout({
                style_class: 'mynotch-meter-tile',
                vertical: true, x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            let ring = new RingMeter(56, color);
            let stack = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.CENTER,
            });
            stack.add_child(ring);
            let num = new St.Label({
                text: '0%',
                style_class: 'mynotch-meter-num',
                x_align: Clutter.ActorAlign.CENTER,
            });
            let bin = new St.Bin({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            bin.set_child(num);
            stack.add_child(bin);
            tile.add_child(stack);

            let lblRow = new St.BoxLayout({
                style_class: 'mynotch-meter-label-row',
                x_align: Clutter.ActorAlign.CENTER,
            });
            lblRow.add_child(new St.Icon({
                icon_name: icon, icon_size: 11,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            let lbl = new St.Label({ text: label, y_align: Clutter.ActorAlign.CENTER });
            lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            lbl.clutter_text.single_line_mode = true;
            lblRow.add_child(lbl);
            tile.add_child(lblRow);
            return { tile, ring, num };
        };

        // FIX: dùng ACCENT reference — tự cập nhật khi accent đổi
        let cpu  = mkRing('CPU',  'system-run-symbolic',     ACCENT);
        let ram  = mkRing('RAM',  'media-flash-symbolic',    ACCENT);
        let disk = mkRing('DISK', 'drive-harddisk-symbolic', [1.0, 0.78, 0.35]);
        let down = mkRing('DOWN', 'go-down-symbolic',        ACCENT);
        let up   = mkRing('UP',   'go-up-symbolic',          ACCENT);
        down.num.add_style_class_name('mynotch-meter-num-sm');
        up.num.add_style_class_name('mynotch-meter-num-sm');
        meters.add_child(cpu.tile);
        meters.add_child(ram.tile);
        meters.add_child(disk.tile);
        meters.add_child(down.tile);
        meters.add_child(up.tile);
        panel.add_child(meters);

        let lower = new St.BoxLayout({
            style_class: 'mynotch-tray-lower',
            vertical: false, x_expand: true,
        });

        let knobs = new St.BoxLayout({
            style_class: 'mynotch-tray-knobs',
            vertical: false, y_align: Clutter.ActorAlign.CENTER,
        });
        knobs.add_child(this._mkKnobTile('Volume', this._quick.vol(),
            (d) => {
                let v = Math.max(0, Math.min(100, this._quick.vol() + d));
                this._quick.setVol(v);
                return v;
            }));
        lower.add_child(knobs);
        lower.add_child(new St.Widget({ x_expand: true }));

        let toggles = new St.BoxLayout({
            style_class: 'mynotch-tray-toggles',
            vertical: false, y_align: Clutter.ActorAlign.CENTER,
        });
        toggles.add_child(this._mkToggle('WiFi', 'network-wireless-symbolic',
            this._quick.wifi(), () => {
                this._quick.setWifi(!this._quick.wifi());
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                    if (this._expanded && this._activeTab === 'tray') this._renderActiveTab(true);
                    return GLib.SOURCE_REMOVE;
                });
            }));
        toggles.add_child(this._mkToggle('Focus',
            this._quick.dnd() ? 'notifications-disabled-symbolic' : 'preferences-system-notifications-symbolic',
            this._quick.dnd(), () => {
                this._quick.setDnd(!this._quick.dnd());
                this._renderActiveTab(true);
            }));
        toggles.add_child(this._mkToggle('Dark', 'weather-clear-night-symbolic',
            this._quick.dark(), () => {
                this._quick.setDark(!this._quick.dark());
                this._renderActiveTab(true);
            }));
        lower.add_child(toggles);
        panel.add_child(lower);

        if (this._config.get('trayShowBattery') !== false) {
            let bat = this._quick.battery();
            let batBox = new St.BoxLayout({
                style_class: 'mynotch-tray-battery',
                vertical: false, x_expand: true,
            });
            let icon = bat.charging ? 'battery-good-charging-symbolic'
                     : bat.pct <= 20 ? 'battery-caution-symbolic'
                     : bat.pct <= 50 ? 'battery-low-symbolic'
                     : 'battery-good-symbolic';
            batBox.add_child(new St.Icon({
                icon_name: icon, icon_size: 18,
                style_class: 'mynotch-tray-battery-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            batBox.add_child(new St.Label({
                text: `${bat.pct}%`,
                style_class: 'mynotch-tray-battery-text',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            batBox.add_child(new St.Label({
                text: bat.charging ? 'Charging' : 'Battery',
                style_class: 'mynotch-tray-battery-sub',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            batBox.add_child(new St.Widget({ x_expand: true }));

            const BAT_W = 120;
            let track = new St.Widget({
                style_class: 'mynotch-bat-track',
                y_align: Clutter.ActorAlign.CENTER,
                layout_manager: new Clutter.FixedLayout(),
                width: BAT_W, height: 6,
            });
            let fill = new St.Widget({ style_class: 'mynotch-bat-fill' });
            fill.set_position(0, 0);
            fill.set_width(Math.max(4, Math.round(BAT_W * bat.pct / 100)));
            fill.set_height(6);
            if (bat.pct <= 20) fill.add_style_class_name('mynotch-bat-low');
            track.add_child(fill);
            batBox.add_child(track);
            panel.add_child(batBox);
        }

        if (this._config.get('trayShowBluetooth') !== false) {
            panel.add_child(this._buildBluetoothCard());
        }

        this._content.add_child(panel);

        let refresh = () => {
            if (!this._expanded || this._activeTab !== 'tray') return;
            let c = this._sys.cpu(), r = this._sys.ram(), d = this._sys.disk();
            let net = this._sys.net();
            let netPct = (b) => b <= 0 ? 0 : Math.min(1, Math.log10(b / 1024 + 1) / 4);
            cpu.ring.setValue(c / 100); cpu.num.set_text(`${c}%`);
            ram.ring.setValue(r / 100); ram.num.set_text(`${r}%`);
            disk.ring.setValue(d / 100); disk.num.set_text(`${d}%`);
            down.ring.setValue(netPct(net.d)); down.num.set_text(SysInfo.fmt(net.d));
            up.ring.setValue(netPct(net.u)); up.num.set_text(SysInfo.fmt(net.u));
        };
        refresh();
        const sec = Math.max(1, Number(this._config.get('trayRefreshSec')) || 3);
        this._refreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, sec, () => {
            refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _mkKnobTile(label, value, onScroll) {
        let col = new St.BoxLayout({
            style_class: 'mynotch-tray-knob',
            vertical: true, x_align: Clutter.ActorAlign.CENTER,
        });
        let knob = new Knob(68);
        knob.setValue(value / 100);
        let btn = new St.Button({ reactive: true, can_focus: false });
        btn.set_child(knob);
        let val = new St.Label({
            text: String(value),
            style_class: 'mynotch-tray-knob-val',
        });
        let bin = new St.Bin({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        bin.set_child(val);
        let stack = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        stack.add_child(btn);
        stack.add_child(bin);
        col.add_child(stack);
        btn.connect('scroll-event', (a, e) => {
            let dir = e.get_scroll_direction();
            let d = (dir === Clutter.ScrollDirection.UP) ? 4
                  : (dir === Clutter.ScrollDirection.DOWN) ? -4 : 0;
            if (d) {
                let v = onScroll(d);
                knob.setValue(v / 100);
                val.set_text(String(v));
            }
            return Clutter.EVENT_STOP;
        });
        col.add_child(new St.Label({
            text: label.toUpperCase(),
            style_class: 'mynotch-tray-knob-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        return col;
    }

    _mkToggle(label, icon, active, onClick) {
        let btn = new St.Button({
            style_class: 'mynotch-tray-toggle' + (active ? ' mynotch-tray-toggle-on' : ''),
            reactive: true, can_focus: true,
        });
        btn.set_pivot_point(0.5, 0.5);
        let col = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        col.add_child(new St.Icon({
            icon_name: icon, icon_size: 18,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        col.add_child(new St.Label({
            text: label.toUpperCase(),
            style_class: 'mynotch-tray-toggle-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        btn.set_child(col);
        btn.connect('clicked', onClick);
        btn.connect('notify::hover', () => {
            btn.ease({
                scale_x: btn.hover ? 1.06 : 1.0,
                scale_y: btn.hover ? 1.06 : 1.0,
                duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        return btn;
    }

    /* ============================================================
     * BLUETOOTH CARD
     * ============================================================ */
    _buildBluetoothCard() {
        let card = new St.BoxLayout({
            style_class: 'mynotch-bt-card',
            vertical: true, x_expand: true,
        });

        let head = new St.BoxLayout({
            style_class: 'mynotch-bt-head',
            vertical: false, x_expand: true,
        });
        head.add_child(new St.Label({
            text: 'BLUETOOTH',
            style_class: 'mynotch-bt-eyebrow',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        let powered = this._bt.isPowered();
        let toggle = new St.Button({
            style_class: 'mynotch-bt-toggle' + (powered ? ' mynotch-bt-toggle-on' : ''),
            reactive: true, can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        toggle.set_child(new St.Icon({
            icon_name: powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
            icon_size: 14,
        }));
        toggle.connect('clicked', () => {
            toggle.reactive = false;
            this._bt.setPowered(!powered, (ok) => {
                if (!ok && this._expanded && this._activeTab === 'tray')
                    this._renderActiveTab(true);
            });
        });
        head.add_child(toggle);
        card.add_child(head);

        let devices = powered ? this._bt.getDevices() : [];
        let list = new St.BoxLayout({
            style_class: 'mynotch-bt-list',
            vertical: true, x_expand: true,
        });

        if (!powered) {
            list.add_child(new St.Label({
                text: 'Bluetooth is off',
                style_class: 'mynotch-bt-empty',
            }));
        } else if (devices.length === 0) {
            list.add_child(new St.Label({
                text: 'No paired devices',
                style_class: 'mynotch-bt-empty',
            }));
        } else {
            for (let d of devices)
                list.add_child(this._mkBtRow(d));
        }
        card.add_child(list);

        return card;
    }

    _mkBtRow(d) {
        let row = new St.Button({
            style_class: 'mynotch-bt-row',
            reactive: true, can_focus: true,
            x_expand: true,
        });
        let inner = new St.BoxLayout({
            vertical: false, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.set_child(inner);

        inner.add_child(new St.Icon({
            icon_name: d.icon || 'bluetooth-active-symbolic',
            icon_size: 14,
            style_class: 'mynotch-bt-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        inner.add_child(new St.Label({
            text: d.name || 'Bluetooth Device',
            style_class: 'mynotch-bt-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        if (Number.isFinite(d.percentage)) {
            const W = 40;
            let track = new St.Widget({
                style_class: 'mynotch-bt-batt-track',
                y_align: Clutter.ActorAlign.CENTER,
                layout_manager: new Clutter.FixedLayout(),
                width: W, height: 5,
            });
            let fill = new St.Widget({ style_class: 'mynotch-bt-batt-fill' });
            fill.set_position(0, 0);
            fill.set_width(Math.max(3, Math.round(W * d.percentage / 100)));
            fill.set_height(5);
            if (d.percentage <= 20) fill.add_style_class_name('mynotch-bt-batt-low');
            track.add_child(fill);
            inner.add_child(track);
            inner.add_child(new St.Label({
                text: `${d.percentage}%`,
                style_class: 'mynotch-bt-pct',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else {
            inner.add_child(new St.Label({
                text: d.connected ? 'Connected' : 'Paired',
                style_class: 'mynotch-bt-status'
                    + (d.connected ? ' mynotch-bt-status-on' : ''),
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        if (d.dbusPath) {
            let want = !d.connected;
            row.connect('clicked', () => {
                row.reactive = false;
                this._bt.setConnected(d.dbusPath, want, () => {
                    if (this._expanded && this._activeTab === 'tray')
                        this._renderActiveTab(true);
                });
            });
        } else {
            row.reactive = false;
        }

        return row;
    }

    /* ============================================================
     * CALENDAR
     * ============================================================ */
    _initCalendarServer() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                let conn = Gio.DBus.session;
                let onEvents = (c, sender, path, iface, signal, params) => {
                    let events;
                    try { events = params.deep_unpack()?.[0] ?? []; }
                    catch (e) { return; }
                    for (let raw of events) {
                        let ev = this._calParseEvent(raw);
                        if (ev?.id) this._calEvents.set(ev.id, ev);
                    }
                    this._calScheduleRefresh();
                };
                let onRemoved = (c, sender, path, iface, signal, params) => {
                    let ids;
                    try { ids = params.deep_unpack()?.[0] ?? []; }
                    catch (e) { return; }
                    for (let id of ids) this._calEvents.delete(id);
                    this._calScheduleRefresh();
                };
                this._calSignalIds.push(conn.signal_subscribe(
                    'org.gnome.Shell.CalendarServer',
                    'org.gnome.Shell.CalendarServer',
                    'EventsAddedOrUpdated',
                    '/org/gnome/Shell/CalendarServer',
                    null, Gio.DBusSignalFlags.NONE, onEvents));
                this._calSignalIds.push(conn.signal_subscribe(
                    'org.gnome.Shell.CalendarServer',
                    'org.gnome.Shell.CalendarServer',
                    'EventsRemoved',
                    '/org/gnome/Shell/CalendarServer',
                    null, Gio.DBusSignalFlags.NONE, onRemoved));
                this._calRequestRange(false);
            } catch (e) {
                console.error('MyNotch: calendar server init failed', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _destroyCalendarServer() {
        try {
            for (let id of this._calSignalIds)
                Gio.DBus.session.signal_unsubscribe(id);
        } catch (e) {}
        this._calSignalIds = [];
        this._calEvents.clear();
        if (this._calRefreshId) {
            GLib.Source.remove(this._calRefreshId);
            this._calRefreshId = 0;
        }
    }

    _calScheduleRefresh() {
        if (this._calRefreshId) return;
        this._calRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._calRefreshId = 0;
            if (this._expanded && this._activeTab === 'calendar')
                this._refreshCalendarAgendaOnly();
            return GLib.SOURCE_REMOVE;
        });
    }

    _calRequestRange(force = false) {
        try {
            let anchor = this._startOfDay(new Date());
            let selected = this._startOfDay(this._calSelectedDate ?? anchor);
            let start = new Date(anchor); start.setDate(start.getDate() - 45);
            let end   = new Date(anchor); end.setDate(end.getDate() + 90);
            if (selected < start) { start = new Date(selected); start.setDate(start.getDate() - 30); }
            if (selected > end)   { end   = new Date(selected); end.setDate(end.getDate() + 30); }

            let key = `${start.getTime()}:${end.getTime()}`;
            if (!force && this._calLastRangeKey === key) return;
            this._calLastRangeKey = key;

            Gio.DBus.session.call(
                'org.gnome.Shell.CalendarServer',
                '/org/gnome/Shell/CalendarServer',
                'org.gnome.Shell.CalendarServer',
                'SetTimeRange',
                new GLib.Variant('(xxb)', [
                    Math.floor(start.getTime() / 1000),
                    Math.floor(end.getTime() / 1000),
                    force
                ]),
                null, Gio.DBusCallFlags.NONE, 3000, null,
                (conn, res) => {
                    try { conn.call_finish(res); }
                    catch (e) {}
                });
        } catch (e) {}
    }

    _calParseEvent(raw) {
        try {
            let [id, title, startSecs, endSecs, attrs] = raw;
            let meta = {};
            for (let [k, v] of Object.entries(attrs ?? {})) {
                try { meta[k] = v?.deep_unpack ? v.deep_unpack() : v; }
                catch (e) { meta[k] = v; }
            }
            return {
                id: String(id),
                title: String(title || 'Untitled event'),
                location: String(meta.location ?? ''),
                start: new Date(Number(startSecs) * 1000),
                end:   new Date(Number(endSecs) * 1000),
                allDay: Boolean(meta['all-day'] ?? meta.allDay),
            };
        } catch (e) { return null; }
    }

    _renderCalendar() {
        let panel = new St.BoxLayout({
            style_class: 'mynotch-cal-panel',
            vertical: true, x_expand: true, y_expand: true,
        });

        let selected = this._startOfDay(this._calSelectedDate ?? new Date());
        this._calRequestRange();

        let summary = new St.BoxLayout({
            style_class: 'mynotch-cal-summary',
            vertical: false, x_expand: true,
        });
        let iconBox = new St.Bin({
            style_class: 'mynotch-cal-summary-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        iconBox.set_child(new St.Icon({
            icon_name: 'x-office-calendar-symbolic',
            icon_size: 22,
        }));
        summary.add_child(iconBox);

        let text = new St.BoxLayout({
            vertical: true, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._calSummaryDay = new St.Label({
            text: selected.toLocaleDateString([], { weekday: 'long' }),
            style_class: 'mynotch-cal-summary-day',
        });
        text.add_child(this._calSummaryDay);
        this._calSummaryDate = new St.Label({
            text: selected.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }),
            style_class: 'mynotch-cal-summary-date',
        });
        text.add_child(this._calSummaryDate);
        summary.add_child(text);

        let todayBtn = new St.Button({
            style_class: 'mynotch-cal-today-btn',
            reactive: true, can_focus: true,
            label: 'Today',
            y_align: Clutter.ActorAlign.CENTER,
        });
        todayBtn.connect('clicked', () => {
            let t = this._startOfDay(new Date());
            if (this._dayKey(t) === this._dayKey(this._calSelectedDate)) return;
            this._calSelectedDate = t;
            this._calRequestRange();
            this._calRefreshStripInPlace();
            this._refreshCalendarAgendaOnly();
        });
        summary.add_child(todayBtn);

        panel.add_child(summary);

        this._calStripRow = this._buildDateStripRow();
        this._calUpdateStrip(this._calStripRow, selected);

        let strip = new St.Button({
            style_class: 'mynotch-cal-strip',
            reactive: true, can_focus: true,
            x_expand: true,
        });
        strip.set_child(this._calStripRow);
        strip.connect('scroll-event', (a, e) => this._onCalDateScroll(e));
        panel.add_child(strip);

        this._calPanel = panel;
        this._calAgenda = this._buildCalendarAgenda(selected);
        panel.add_child(this._calAgenda);

        this._content.add_child(panel);
    }

    _buildDateStripRow() {
        let row = new St.BoxLayout({
            style_class: 'mynotch-cal-strip-row',
            vertical: false, x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        row._pills = [];
        for (let i = 0; i < 7; i++) {
            let btn = new St.Button({
                style_class: 'mynotch-cal-pill',
                reactive: true, can_focus: true,
            });
            let col = new St.BoxLayout({
                vertical: true, x_align: Clutter.ActorAlign.CENTER,
            });
            let weekday = new St.Label({
                style_class: 'mynotch-cal-weekday',
                x_align: Clutter.ActorAlign.CENTER,
            });
            let num = new St.Label({
                style_class: 'mynotch-cal-number',
                x_align: Clutter.ActorAlign.CENTER,
            });
            let todayTag = new St.Label({
                text: 'TODAY',
                style_class: 'mynotch-cal-today-tag',
                x_align: Clutter.ActorAlign.CENTER,
            });
            col.add_child(weekday);
            col.add_child(num);
            col.add_child(todayTag);
            btn.set_child(col);

            let pill = { btn, weekday, num, todayTag, date: null };
            btn.connect('clicked', () => {
                if (!pill.date) return;
                if (this._dayKey(pill.date) === this._dayKey(this._calSelectedDate)) return;
                this._calSelectedDate = this._startOfDay(pill.date);
                this._calRequestRange();
                this._calRefreshStripInPlace();
                this._refreshCalendarAgendaOnly();
            });
            row.add_child(btn);
            row._pills.push(pill);
        }
        return row;
    }

    _calUpdateStrip(row, selected) {
        if (!row || !row._pills) return;
        let today = this._startOfDay(new Date());
        let range = Math.max(1, Math.min(6, Number(this._config.get('calStripRange')) || 3));
        let start = new Date(selected);
        start.setDate(start.getDate() - range);

        for (let i = 0; i < 7; i++) {
            let d = new Date(start);
            d.setDate(start.getDate() + i);
            let pill = row._pills[i];
            pill.date = d;

            let isSelected = this._dayKey(d) === this._dayKey(selected);
            let isToday    = this._dayKey(d) === this._dayKey(today);
            let dist = Math.abs(i - range);

            let cls = 'mynotch-cal-pill';
            if (isSelected) cls += ' mynotch-cal-pill-active';
            if (isToday)    cls += ' mynotch-cal-pill-today';
            if (dist === 1) cls += ' mynotch-cal-pill-near';
            else if (dist > 1) cls += ' mynotch-cal-pill-far';
            pill.btn.set_style_class_name(cls);

            pill.weekday.set_text(d.toLocaleDateString([], { weekday: 'narrow' }).toUpperCase());
            pill.num.set_text(String(d.getDate()));
            pill.todayTag.visible = isToday;
        }
    }

    _calRefreshStripInPlace() {
        if (this._calStripRow) this._calUpdateStrip(this._calStripRow, this._calSelectedDate);
        if (this._calSummaryDay)
            this._calSummaryDay.set_text(this._calSelectedDate.toLocaleDateString([], { weekday: 'long' }));
        if (this._calSummaryDate)
            this._calSummaryDate.set_text(this._calSelectedDate.toLocaleDateString(
                [], { month: 'long', day: 'numeric', year: 'numeric' }));
    }

    _onCalDateScroll(event) {
        let dir = event.get_scroll_direction();
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
            delta = -1;
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
            delta = 1;
        else if (dir === Clutter.ScrollDirection.SMOOTH && event.get_scroll_delta) {
            let [dx, dy] = event.get_scroll_delta();
            let d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            let now = GLib.get_monotonic_time();
            if (d === 0 || now - this._calLastScrollAt < 120000)
                return Clutter.EVENT_STOP;
            this._calLastScrollAt = now;
            delta = d > 0 ? 1 : -1;
        }
        if (!delta) return Clutter.EVENT_PROPAGATE;

        let d = this._startOfDay(this._calSelectedDate);
        d.setDate(d.getDate() + delta);
        this._calSelectedDate = d;
        this._calRefreshStripInPlace();

        if (this._calScrollFlushId) GLib.Source.remove(this._calScrollFlushId);
        if (this._calRefreshId) GLib.Source.remove(this._calRefreshId);
        this._calScrollFlushId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._calScrollFlushId = 0;
            this._calRequestRange();
            this._refreshCalendarAgendaOnly();
            return GLib.SOURCE_REMOVE;
        });
        return Clutter.EVENT_STOP;
    }

    _refreshCalendarAgendaOnly() {
        let panel = this._calPanel;
        let old = this._calAgenda;
        if (!panel || !old) return;
        if (!old.get_parent()) return;

        let selected = this._startOfDay(this._calSelectedDate);
        let fresh = this._buildCalendarAgenda(selected);
        try {
            panel.replace_child(old, fresh);
        } catch (e) {
            return;
        }
        this._calAgenda = fresh;
    }

    _buildCalendarAgenda(selected) {
        let outer = new St.BoxLayout({
            style_class: 'mynotch-cal-agenda',
            vertical: true, x_expand: true,
        });

        let header = new St.BoxLayout({
            style_class: 'mynotch-cal-agenda-header',
            vertical: false, x_expand: true,
        });
        header.add_child(new St.Label({
            text: this._dayKey(selected) === this._dayKey(new Date()) ? 'Today' : 'Events',
            style_class: 'mynotch-cal-agenda-title',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            text: selected.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
            style_class: 'mynotch-cal-agenda-date',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        outer.add_child(header);

        let scroll = new St.ScrollView({
            style_class: 'mynotch-cal-scroll',
            x_expand: true,
        });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        let list = new St.BoxLayout({
            style_class: 'mynotch-cal-list',
            vertical: true, x_expand: true,
        });
        scroll.set_child(list);

        let events = this._collectCalendarEvents(selected);
        if (events.length === 0) {
            let empty = new St.BoxLayout({
                style_class: 'mynotch-cal-empty',
                vertical: true, x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            empty.add_child(new St.Icon({
                icon_name: 'x-office-calendar-symbolic',
                icon_size: 24,
                style_class: 'mynotch-cal-empty-icon',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            empty.add_child(new St.Label({
                text: 'No events for this day',
                style_class: 'mynotch-cal-empty-title',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            empty.add_child(new St.Label({
                text: 'Scroll the dates to check another day.',
                style_class: 'mynotch-cal-empty-sub',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            list.add_child(empty);
        } else {
            for (let ev of events) list.add_child(this._buildCalEventRow(ev));
        }

        outer.add_child(scroll);
        return outer;
    }

    _buildCalEventRow(ev) {
        let row = new St.BoxLayout({
            style_class: 'mynotch-cal-event',
            vertical: false, x_expand: true,
        });
        let time = new St.BoxLayout({
            style_class: 'mynotch-cal-time',
            vertical: true, y_align: Clutter.ActorAlign.START,
        });
        time.add_child(new St.Label({
            text: ev.allDay ? 'All' : this._fmtEventTime(ev.start),
            style_class: 'mynotch-cal-start',
        }));
        time.add_child(new St.Label({
            text: ev.allDay ? 'day' : this._fmtEventTime(ev.end),
            style_class: 'mynotch-cal-end',
        }));
        row.add_child(time);

        let text = new St.BoxLayout({ vertical: true, x_expand: true });
        let title = new St.Label({
            text: this._ellipsize(ev.title || 'Untitled event', 48),
            style_class: 'mynotch-cal-event-title',
        });
        text.add_child(title);
        if (ev.location) {
            text.add_child(new St.Label({
                text: this._ellipsize(ev.location, 60),
                style_class: 'mynotch-cal-event-location',
            }));
        }
        row.add_child(text);
        return row;
    }

    _collectCalendarEvents(selected) {
        let dayStart = this._startOfDay(selected);
        let dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        if (this._calEvents.size === 0) {
            try {
                let src = Main.panel.statusArea.dateMenu?._calendar?._eventSource ??
                          Main.panel.statusArea.dateMenu?._eventSource;
                if (src?.getEvents) {
                    let raw = src.getEvents(dayStart, dayEnd) || [];
                    for (let ev of raw) {
                        let s = this._eventDate(ev.date ?? ev.start ?? ev.startDate ?? null);
                        let e = this._eventDate(ev.end ?? ev.endDate ?? ev.endTime ?? s);
                        if (!s) continue;
                        if (!e || isNaN(e)) e = s;
                        let id = `dm:${ev.summary}|${s.getTime()}`;
                        if (!this._calEvents.has(id)) {
                            this._calEvents.set(id, {
                                id,
                                title: String(ev.summary ?? ev.title ?? 'Untitled event'),
                                location: String(ev.location ?? ''),
                                start: s, end: e,
                                allDay: Boolean(ev.allDay ?? ev.isAllDay),
                            });
                        }
                    }
                }
            } catch (e) {}
        }

        let out = [];
        let seen = new Set();
        for (let ev of this._calEvents.values()) {
            let eEnd = ev.end instanceof Date && !isNaN(ev.end) ? ev.end : ev.start;
            if (eEnd <= ev.start) eEnd = new Date(ev.start.getTime() + 1);
            if (!(ev.start < dayEnd && eEnd > dayStart)) continue;

            let key = `${ev.title}|${ev.allDay ? 'A' : 'T'}|${ev.start.getTime()}|${ev.end.getTime()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(ev);
        }
        out.sort((a, b) => a.start - b.start);
        return out.slice(0, 20);
    }

    _eventDate(v) {
        if (!v) return null;
        if (v instanceof Date) return v;
        if (v instanceof GLib.DateTime) return new Date(v.to_unix() * 1000);
        if (typeof v.toJSDate === 'function') return v.toJSDate();
        return new Date(v);
    }

    _startOfDay(date) {
        let d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    _dayKey(date) {
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }

    _fmtEventTime(date) {
        if (!(date instanceof Date) || isNaN(date)) return '--:--';
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    _ellipsize(text, max) {
        text = String(text || '');
        return text.length > max ? text.substring(0, max - 1) + '…' : text;
    }

    /* ============================================================
     * WALLPAPER
     * ============================================================ */
    _renderWallpaper() {
        let panel = new St.BoxLayout({
            style_class: 'mynotch-wp-panel',
            vertical: true, x_expand: true, y_expand: true,
        });
        this._content.add_child(panel);

        let folder = this._wallpaper.getFolder();
        let items = this._wallpaper.getWallpapers();

        let header = new St.BoxLayout({ style_class: 'mynotch-wp-header', vertical: false, x_expand: true });
        let titleBox = new St.BoxLayout({ vertical: true, x_expand: true });
        titleBox.add_child(new St.Label({ text: 'Wallpaper', style_class: 'mynotch-wp-title' }));
        let current = items.find(w => w.current);
        this._wpSubtitle = new St.Label({
            text: current ? current.name : (items.length ? 'Scroll to pick' : ''),
            style_class: 'mynotch-wp-subtitle',
        });
        titleBox.add_child(this._wpSubtitle);
        header.add_child(titleBox);
        let pickBtn = new St.Button({
            style_class: 'mynotch-wp-btn',
            reactive: true, can_focus: true,
            label: folder ? 'Change' : 'Choose folder',
            y_align: Clutter.ActorAlign.CENTER,
        });
        pickBtn.connect('clicked', () => this._onPickFolder());
        header.add_child(pickBtn);
        panel.add_child(header);

        if (!folder) {
            panel.add_child(this._mkWpEmpty('folder-pictures-symbolic', 'No folder selected', 'Choose a folder to begin.'));
            return;
        }
        if (items.length === 0) {
            panel.add_child(this._mkWpEmpty('image-missing-symbolic', 'No images found', 'Add .jpg/.png/.webp files to this folder.'));
            return;
        }

        let scroll = new St.ScrollView({
            style_class: 'mynotch-wp-scroll',
            x_expand: true, height: 140,
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        let strip = new St.BoxLayout({ style_class: 'mynotch-wp-strip', vertical: false, height: 140 });
        this._wpThumbs = [];
        this._wpActive = current ? current.path : null;
        for (let it of items) {
            let cell = this._mkWpThumb(it);
            this._wpThumbs.push(cell);
            strip.add_child(cell);
        }
        scroll.set_child(strip);
        this._wpScroll = scroll;
        scroll.connect('scroll-event', (a, e) => {
            let dir = e.get_scroll_direction();
            let now = GLib.get_monotonic_time();
            if (now - (this._lastWpScroll || 0) < 220000) return Clutter.EVENT_STOP;
            if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
                this._stepWp(-1);
            else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
                this._stepWp(1);
            else return Clutter.EVENT_PROPAGATE;
            this._lastWpScroll = now;
            return Clutter.EVENT_STOP;
        });
        panel.add_child(scroll);
        this._scrollWpIntoView();
    }

    _mkWpThumb(item) {
        let cell = new St.Button({
            style_class: item.current
                ? 'mynotch-wp-cell mynotch-wp-cell-active'
                : 'mynotch-wp-cell',
            reactive: true, can_focus: true,
        });
        cell._wpPath = item.path;
        let box = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER });
        let uri = Gio.File.new_for_path(item.path).get_uri();
        let thumb = new St.Widget({ style_class: 'mynotch-wp-thumb' });
        thumb.set_style(`background-image: url("${uri}"); background-size: cover; background-position: center;`);
        box.add_child(thumb);
        let name = new St.Label({ text: item.name, style_class: 'mynotch-wp-name' });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        box.add_child(name);
        cell.set_child(box);
        cell.connect('clicked', () => this._applyWp(item.path));
        return cell;
    }

    _mkWpEmpty(icon, title, sub) {
        let box = new St.BoxLayout({
            style_class: 'mynotch-wp-empty',
            vertical: true, x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Icon({ icon_name: icon, icon_size: 32,
            style_class: 'mynotch-wp-empty-icon', x_align: Clutter.ActorAlign.CENTER }));
        box.add_child(new St.Label({ text: title, style_class: 'mynotch-wp-empty-title',
            x_align: Clutter.ActorAlign.CENTER }));
        box.add_child(new St.Label({ text: sub, style_class: 'mynotch-wp-empty-sub',
            x_align: Clutter.ActorAlign.CENTER }));
        return box;
    }

    _stepWp(dir) {
        if (!this._wpThumbs || !this._wpThumbs.length) return;
        let cur = this._wpThumbs.findIndex(c => c._wpPath === this._wpActive);
        if (cur < 0) cur = 0;
        let next = (cur + dir + this._wpThumbs.length) % this._wpThumbs.length;
        this._applyWp(this._wpThumbs[next]._wpPath);
    }

    _applyWp(path) {
        if (!this._wallpaper.setWallpaper(path)) return;
        this._wpActive = path;
        for (let c of this._wpThumbs) {
            let active = c._wpPath === path;
            if (active) {
                c.add_style_class_name('mynotch-wp-cell-active');
            } else {
                c.remove_style_class_name('mynotch-wp-cell-active');
            }
        }
        if (this._wpSubtitle) this._wpSubtitle.set_text(GLib.path_get_basename(path));
        this._scrollWpIntoView();
    }

    _scrollWpIntoView() {
        if (!this._wpScroll || !this._wpThumbs) return;
        let active = this._wpThumbs.find(c => c._wpPath === this._wpActive);
        if (!active) return;
        let adj = this._wpScroll.get_hadjustment();
        if (!adj) return;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            try {
                let [x] = active.get_transformed_position();
                let [px] = this._wpScroll.get_transformed_position();
                let rel = x - px + adj.value;
                let w = active.width;
                let maxScroll = Math.max(0, adj.upper - adj.page_size);
                if (rel < adj.value) adj.value = Math.max(0, rel - 8);
                else if (rel + w > adj.value + adj.page_size)
                    adj.value = Math.min(maxScroll, rel + w - adj.page_size + 8);
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _onPickFolder() {
        this._wallpaper.pickFolder(folder => {
            if (!folder) return;
            this._config.set('wallpaperFolder', folder);
            if (this._activeTab === 'wallpaper') this._renderActiveTab(true);
        });
    }

    /* ============================================================
     * Album art
     * ============================================================ */
    _artCacheSet(url, path) {
        this._artCache.set(url, path);
        if (this._artCache.size > 100) {
            let keys = Array.from(this._artCache.keys()).slice(0, 50);
            for (let k of keys) this._artCache.delete(k);
        }
    }

    _loadArt(url, art) {
        if (!url || !art) return;
        if (url.startsWith('file://')) {
            try {
                let path = Gio.File.new_for_uri(url).get_path();
                if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) art.setArtPath(path);
            } catch (e) {}
            return;
        }
        if (!url.startsWith('http')) return;
        if (this._artCache.has(url)) { art.setArtPath(this._artCache.get(url)); return; }
        try {
            let hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
            let target = GLib.build_filenamev([this._artDir.get_path(), hash + '.img']);
            if (GLib.file_test(target, GLib.FileTest.EXISTS)) {
                this._artCacheSet(url, target);
                art.setArtPath(target);
                return;
            }
            let msg = Soup.Message.new('GET', url);
            this._artSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    let bytes = s.send_and_read_finish(res);
                    let file = Gio.File.new_for_path(target);
                    file.replace_contents_bytes_async(bytes, null, false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION, null, () => {});
                    this._artCacheSet(url, target);
                    if (art.get_stage()) art.setArtPath(target);
                } catch (e) {}
            });
        } catch (e) {}
    }

    /* ============================================================
     * Clock / pill
     * ============================================================ */
    _updateClock() {
        let now = new Date();
        const use24 = this._config.get('clockFormat24h') === true;
        const showSec = this._config.get('showClockSeconds') === true;
        const d = now.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
        const opts = { hour: 'numeric', minute: '2-digit', hour12: !use24 };
        if (showSec) opts.second = '2-digit';
        const t = now.toLocaleTimeString([], opts);
        this._pillClock.set_text(`${d}  ·  ${t}`);

        let show = this._config.get('showBattery', true);
        this._pillBatteryBox.visible = show;
        if (!show) return;
        let bat = this._quick.battery();
        let icon = bat.charging ? 'battery-caution-charging-symbolic'
                 : bat.pct <= 20 ? 'battery-caution-symbolic'
                 : 'battery-good-symbolic';
        this._pillBatteryIcon.icon_name = icon;
        this._pillBatteryLabel.set_text(`${bat.pct}%`);
    }

    _updatePillMusic() {
    let show = this._config.get('showMusic', true);
    let info = this._mpris.getTrackInfo();
    let visible = show && info.hasMedia &&
        (info.status === 'Playing' || info.status === 'Paused');
    this._pillMusicBox.visible = visible;

    if (visible) {
        let text = info.artist && info.artist !== 'Unknown Artist'
            ? `${info.title} — ${info.artist}` : info.title;
        this._pillTitle.set_text(text);

        // EqBars: luôn chạy nếu có media (kể cả paused → vẫn nhảy)
        // Chỉ stop khi không có media
        if (this._pillEq._running === false) this._pillEq.start();
    } else {
        if (this._pillEq._running) this._pillEq.stop();
        this._pillTitle.set_text('');
    }
}

    _onMusicChange() {
        this._updatePillMusic();
        if (!this._expanded || this._activeTab !== 'music') return;
        if (this._musicDebounceId) GLib.Source.remove(this._musicDebounceId);
        this._musicDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 220, () => {
            this._musicDebounceId = 0;
            if (this._expanded && this._activeTab === 'music')
                this._renderActiveTab(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    /* ============================================================
     * Interaction / expand-collapse
     * ============================================================ */
    _reposition() {
        let m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        let w = this._expanded ? this._metrics.dashWidth : this._metrics.pillWidthMin;
        const topY = m.y + (this._metrics.islandMode
            ? this._metrics.islandTopPadding : 0);
        this.set_position(m.x + Math.floor((m.width - w) / 2), topY);
        if (this._peekAdded) this._positionPeek();
    }

    _pointerIsOver() {
        let [px, py] = global.get_pointer();
        let [ax, ay] = this.get_transformed_position();
        let w = this.get_width(), h = this.get_height();
        return px >= ax && px <= ax + w && py >= ay && py <= ay + h;
    }

    _isDescendant(actor) {
        let p = actor;
        while (p) { if (p === this) return true; p = p.get_parent(); }
        return false;
    }

    _onCrossing(event, entering) {
        let related = event.get_related();
        if (related && this._isDescendant(related)) return Clutter.EVENT_PROPAGATE;
        if (!entering && related === null && this._pointerIsOver()) return Clutter.EVENT_PROPAGATE;
        this._pointerInside = entering;
        if (entering) {
            if (this._collapseTimeoutId) {
                GLib.Source.remove(this._collapseTimeoutId);
                this._collapseTimeoutId = null;
            }
            if (!this._metrics.hoverToExpand) return Clutter.EVENT_PROPAGATE;
            if (!this._expanded && !this._expandTimeoutId) {
                this._expandTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                    this._metrics.expandDelay, () => {
                    this._expandTimeoutId = null;
                    if (this._pointerInside && !this._expanded) this._expand();
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else {
            if (this._expandTimeoutId) {
                GLib.Source.remove(this._expandTimeoutId);
                this._expandTimeoutId = null;
            }
            if (this._expanded && !this._collapseTimeoutId) {
                this._collapseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                    this._metrics.collapseDelay, () => {
                    this._collapseTimeoutId = null;
                    if (this._powerMenu && this._powerMenu.isOpen) return GLib.SOURCE_REMOVE;
                    if (!this._pointerInside && this._expanded) this._collapse();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _expand() {
        if (this._expanded) return;
        this._expanded = true;
        this._isExpanding = true;

        let m = Main.layoutManager.primaryMonitor;
        if (!m) { this._isExpanding = false; this._expanded = false; return; }

        this._stopLive();
        this._content.destroy_all_children();
        this._content.translation_x = 0;
        this._content.opacity = 255;
        this._renderTabContent(this._activeTab);

        if (this._blurActive && this._blurCfg)
            this._animateBlurRadius(this._blurCfg.expandedRadius, 340);

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (!this._expanded) return GLib.SOURCE_REMOVE;
            let targetX = m.x + Math.floor((m.width - this._metrics.dashWidth) / 2);
            let targetY = m.y + (this._metrics.islandMode
                ? this._metrics.islandTopPadding : 0);
            let targetH = this._measureContentHeight();

            this._dashboard.opacity = 0;
            this._dashboard.visible = true;

            this._surface.set_pivot_point(0.5, 0.0);
            this._surface.scale_y = 0.94;
            this._surface.scale_x = 0.99;
            this._surface.opacity = 255;

            const D = 340;
            const C = Clutter.AnimationMode.EASE_OUT_QUINT;
            this._surface.ease({ scale_x: 1.0, scale_y: 1.0, duration: D, mode: C });
            this._dashboard.ease({ opacity: 255, duration: D, mode: C });
            this.ease({
                x: targetX, y: targetY, width: this._metrics.dashWidth, height: targetH,
                duration: D, mode: C,
                onComplete: () => { this._isExpanding = false; },
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _collapse() {
        if (!this._expanded) return;
        this._expanded = false;
        this._isExpanding = false;
        this._stopLive();
        if (this._resizeId) { GLib.Source.remove(this._resizeId); this._resizeId = 0; }

        let m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        let targetX = m.x + Math.floor((m.width - this._metrics.pillWidthMin) / 2);
        let targetY = m.y + (this._metrics.islandMode
            ? this._metrics.islandTopPadding : 0);

        const D = 280;
        const C = Clutter.AnimationMode.EASE_IN_OUT_QUINT;

        if (this._blurActive && this._blurCfg)
            this._animateBlurRadius(this._blurCfg.collapsedRadius, D);

        this._surface.set_pivot_point(0.5, 0.0);
        this._surface.ease({
            scale_y: 0.94, scale_x: 0.985, duration: D, mode: C,
            onComplete: () => { this._surface.scale_x = 1.0; this._surface.scale_y = 1.0; },
        });
        this._dashboard.ease({
            opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => { this._dashboard.visible = false; },
        });
        this.ease({
            x: targetX, y: targetY,
            width: this._metrics.pillWidthMin, height: this._metrics.pillHeight,
            duration: D, mode: C,
        });
    }

    _collapseImmediately() {
        if (this._collapseTimeoutId) {
            GLib.Source.remove(this._collapseTimeoutId);
            this._collapseTimeoutId = null;
        }
        if (this._expandTimeoutId) {
            GLib.Source.remove(this._expandTimeoutId);
            this._expandTimeoutId = null;
        }
        this._pointerInside = false;
        this._collapse();
    }

    destroy() {
        if (this._clockId) GLib.Source.remove(this._clockId);
        if (this._expandTimeoutId) GLib.Source.remove(this._expandTimeoutId);
        if (this._collapseTimeoutId) GLib.Source.remove(this._collapseTimeoutId);
        if (this._configReloadId) GLib.Source.remove(this._configReloadId);
        if (this._resizeId) GLib.Source.remove(this._resizeId);
        if (this._musicDebounceId) GLib.Source.remove(this._musicDebounceId);
        if (this._notifDebounceId) GLib.Source.remove(this._notifDebounceId);
        if (this._peekHideId) GLib.Source.remove(this._peekHideId);
        if (this._calScrollFlushId) GLib.Source.remove(this._calScrollFlushId);
        if (this._wpSlideId) { GLib.Source.remove(this._wpSlideId); this._wpSlideId = 0; }
        if (this._blurTimeline) { this._blurTimeline.stop(); this._blurTimeline = null; }
        if (this._blurActor) { try { this._blurActor.destroy(); } catch (e) {} this._blurActor = null; }
        if (this._blurEffect) { this._blurEffect = null; }
        if (this._powerMenu) { try { this._powerMenu.destroy(); } catch (e) {} this._powerMenu = null; }
        if (this._configMonitor) { this._configMonitor.cancel(); this._configMonitor = null; }

        const unload = (file) => {
            if (!file) return;
            try {
                St.ThemeContext.get_for_stage(global.stage).get_theme()
                    .unload_stylesheet(file);
            } catch (e) {}
        };
        unload(this._uiFontScaleStyleFile);   this._uiFontScaleStyleFile = null;
        unload(this._peekFontScaleStyleFile); this._peekFontScaleStyleFile = null;
        unload(this._accentStyleFile);        this._accentStyleFile = null;
        unload(this._surfaceStyleFile);       this._surfaceStyleFile = null;
        unload(this._textStyleFile);          this._textStyleFile = null;

        this._destroyCalendarServer();
        this._stopLive();
        if (this._bt) { this._bt = null; }
        if (this._notif) { this._notif.destroy(); this._notif = null; }
        if (this._mpris) { this._mpris.destroy(); this._mpris = null; }
        if (this._artSession) { this._artSession.abort(); this._artSession = null; }
        if (globalThis.__mynotchConfig === this._config)
            globalThis.__mynotchConfig = null;
        super.destroy();
    }
});

export default class MyNotchExtension extends Extension {
    enable() {
        this._notch = new MyNotch(this);
        Main.layoutManager.addTopChrome(this._notch, { trackFullscreen: false });
        this._notch.addPeek();
    }
    disable() {
        if (this._notch) {
            try { this._notch.removePeek(); } catch (e) {}
            Main.layoutManager.removeChrome(this._notch);
            this._notch.destroy();
            this._notch = null;
        }
    }
}
