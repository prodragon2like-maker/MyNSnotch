import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';

export const ACCENT = [0.478, 0.635, 1.0];
export const AMBER  = [1.0, 0.78, 0.35];
export const RED    = [1.0, 0.42, 0.42];

/* ============================================================
 * Font scale helper — đọc từ globalThis.__mynotchFontScale
 * ============================================================ */
export function fontScale() {
    let s = Number(globalThis.__mynotchFontScale);
    if (!Number.isFinite(s) || s <= 0) s = 1.0;
    return Math.max(0.8, Math.min(1.3, s));
}

let _accentHex    = '#7aa2ff';
let _accentRgbStr = '122, 162, 255';
export const accentHex    = () => _accentHex;
export const accentRgbStr = () => _accentRgbStr;

// Mutate ACCENT in place so widgets that captured the array reference
// (RingMeter, Knob, Vinyl) pick up the new colour on their next repaint.
export function setAccent(hex) {
    if (typeof hex !== 'string') return;
    const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8)  & 255) / 255;
    const b = ( n        & 255) / 255;
    ACCENT[0] = r; ACCENT[1] = g; ACCENT[2] = b;
    _accentHex = '#' + m[1].toLowerCase();
    _accentRgbStr = `${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}`;
}

const TRACK = [1, 1, 1, 0.14];
const FACE  = [0.075, 0.075, 0.094];

function setSource(cr, rgb, a = 1) {
    cr.setSourceRGBA(rgb[0], rgb[1], rgb[2], rgb.length > 3 ? rgb[3] : a);
}

export const RingMeter = GObject.registerClass(
class RingMeter extends St.DrawingArea {
    _init(size = 56, color = ACCENT) {
        super._init({
            width: size, height: size,
            style_class: 'mynotch-ring',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._size = size;
        this._value = 0;
        this._color = color;
        this.connect('repaint', () => this._draw());
    }
    setColor(c) { this._color = c; this.queue_repaint(); }
    setValue(v) {
        v = Math.max(0, Math.min(1, v));
        if (Math.abs(this._value - v) < 0.001) return;
        this._value = v;
        this.queue_repaint();
    }
    _draw() {
        let cr = this.get_context();
        let s = this._size, c = s / 2, r = c - 3;
        cr.setLineWidth(5);
        cr.setLineCap(Cairo.LineCap.ROUND);
        setSource(cr, TRACK);
        cr.arc(c, c, r, 0, 2 * Math.PI);
        cr.stroke();
        if (this._value > 0.001) {
            setSource(cr, this._color);
            cr.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * this._value);
            cr.stroke();
        }
        cr.arc(c, c, r - 6, 0, 2 * Math.PI);
        setSource(cr, FACE);
        cr.fill();
        cr.$dispose();
    }
});

export const Knob = GObject.registerClass(
class Knob extends St.DrawingArea {
    _init(size = 76) {
        super._init({
            width: size, height: size,
            style_class: 'mynotch-knob',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._size = size;
        this._value = 0.5;
        this.connect('repaint', () => this._draw());
    }
    setValue(v) {
        v = Math.max(0, Math.min(1, v));
        if (Math.abs(this._value - v) < 0.001) return;
        this._value = v;
        this.queue_repaint();
    }
    _draw() {
        let cr = this.get_context();
        let s = this._size, c = s / 2, r = c - 3;
        let start = (135 * Math.PI) / 180;
        let sweep = (270 * Math.PI) / 180;
        let end = start + sweep * this._value;
        cr.setLineWidth(6);
        cr.setLineCap(Cairo.LineCap.ROUND);
        setSource(cr, TRACK);
        cr.arc(c, c, r, start, start + sweep);
        cr.stroke();
        setSource(cr, ACCENT);
        cr.arc(c, c, r, start, end);
        cr.stroke();
        let face = new Cairo.RadialGradient(c, c - r * 0.4, 2, c, c, r * 0.7);
        face.addColorStopRGBA(0, 0.149, 0.149, 0.173, 1);
        face.addColorStopRGBA(1, 0.078, 0.078, 0.094, 1);
        cr.arc(c, c, r * 0.66, 0, 2 * Math.PI);
        cr.setSource(face);
        cr.fill();
        let px = c + Math.cos(end) * r * 0.5;
        let py = c + Math.sin(end) * r * 0.5;
        let ix = c + Math.cos(end) * r * 0.24;
        let iy = c + Math.sin(end) * r * 0.24;
        cr.setLineWidth(3.5);
        setSource(cr, ACCENT);
        cr.moveTo(ix, iy);
        cr.lineTo(px, py);
        cr.stroke();
        cr.$dispose();
    }
});

export const Vinyl = GObject.registerClass(
class Vinyl extends St.DrawingArea {
    _init(size = 140) {
        super._init({
            width: size, height: size,
            style_class: 'mynotch-vinyl',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._size = size;
        this._spinning = false;
        this._tickId = 0;
        this.set_pivot_point(0.5, 0.5);
        this.connect('repaint', () => this._draw());
    }
    startSpin() {
        if (this._spinning) return;
        this._spinning = true;
        let started = GLib.get_monotonic_time();
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (!this._spinning) { this._tickId = 0; return GLib.SOURCE_REMOVE; }
            let ms = (GLib.get_monotonic_time() - started) / 1000;
            this.rotation_angle_z = (ms / 9000 * 360) % 360;
            return GLib.SOURCE_CONTINUE;
        });
    }
    stopSpin() {
        this._spinning = false;
        if (this._tickId) { GLib.Source.remove(this._tickId); this._tickId = 0; }
        this.remove_all_transitions();
    }
    destroy() { this.stopSpin(); super.destroy(); }
    _draw() {
        let cr = this.get_context();
        let s = this._size, c = s / 2, r = c - 1;
        cr.arc(c, c, r, 0, 2 * Math.PI);
        setSource(cr, [0.039, 0.039, 0.051]);
        cr.fill();
        cr.setLineWidth(1);
        for (let gr = r - 4; gr > s * 0.22; gr -= 3) {
            cr.arc(c, c, gr, 0, 2 * Math.PI);
            setSource(cr, [0.098, 0.098, 0.125], 0.55);
            cr.stroke();
        }
        let grad = new Cairo.RadialGradient(c * 0.76, c * 0.6, 2, c * 0.76, c * 0.6, r);
        grad.addColorStopRGBA(0, 1, 1, 1, 0.14);
        grad.addColorStopRGBA(0.45, 1, 1, 1, 0);
        cr.arc(c, c, r, 0, 2 * Math.PI);
        cr.setSource(grad);
        cr.fill();
        let lr = s * 0.2;
        let label = new Cairo.RadialGradient(c - lr * 0.3, c - lr * 0.4, 1, c, c, lr);
        label.addColorStopRGBA(0, AMBER[0], AMBER[1], AMBER[2], 1);
        label.addColorStopRGBA(0.5, 0.776, 0.416, 0.478, 1);
        label.addColorStopRGBA(1, ACCENT[0] * 0.9, 0.58, 0.75, 1);
        cr.arc(c, c, lr, 0, 2 * Math.PI);
        cr.setSource(label);
        cr.fill();
        cr.arc(c, c, lr, 0, 2 * Math.PI);
        cr.setLineWidth(2.5);
        setSource(cr, FACE);
        cr.stroke();
        cr.arc(c, c, s * 0.027, 0, 2 * Math.PI);
        setSource(cr, FACE);
        cr.fill();
        cr.arc(c, c, r - 0.75, 0, 2 * Math.PI);
        cr.setLineWidth(1.5);
        setSource(cr, [1, 1, 1], 0.16);
        cr.stroke();
        cr.$dispose();
    }
});

export const AlbumArtDisc = GObject.registerClass(
class AlbumArtDisc extends St.Widget {
    _init(size = 52) {
        super._init({
            width: size, height: size,
            style_class: 'mynotch-vinyl-art',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._size = size;
    }
    setArtPath(path) {
        if (!path) { this.set_style(''); this.visible = false; return; }
        try {
            let uri = GLib.filename_to_uri(path, null);
            this.set_style(`background-image: url("${uri}"); background-size: cover; background-position: center;`);
            this.visible = true;
        } catch (e) {
            this.set_style(''); this.visible = false;
        }
    }
});

export const EqBars = GObject.registerClass(
class EqBars extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'mynotch-eq',
            y_align: Clutter.ActorAlign.END,
            vertical: false,
        });
        this._bars = [];
        this._running = false;
        let delays = [100, 500, 800, 300];
        for (let i = 0; i < 4; i++) {
            let bar = new St.Widget({ style_class: 'mynotch-eq-bar', y_align: Clutter.ActorAlign.END });
            bar.set_style(`background-color: ${accentHex()};`);
            bar.set_pivot_point(0.5, 1.0);
            bar.scale_y = 0.3;
            this.add_child(bar);
            this._bars.push({ actor: bar, delay: delays[i] });
        }
    }
    setAccentColor() {
        let style = `background-color: ${accentHex()};`;
        for (let b of this._bars) b.actor.set_style(style);
    }
    start() {
        if (this._running) return;
        this._running = true;
        for (let b of this._bars) {
            b._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, b.delay, () => {
                this._bounce(b.actor);
                return GLib.SOURCE_REMOVE;
            });
        }
    }
    _bounce(actor) {
        if (!this._running) return;
        actor.ease({
            scale_y: 0.25 + Math.random() * 0.75,
            duration: 260 + Math.random() * 220,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: () => {
                if (!this._running) return;
                actor._bounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    actor._bounceId = 0;
                    this._bounce(actor);
                    return GLib.SOURCE_REMOVE;
                });
            },
        });
    }
    stop() {
    this._running = false;
    for (let b of this._bars) {
        if (b._id) { GLib.Source.remove(b._id); b._id = 0; }
        if (b.actor._bounceId) { GLib.Source.remove(b.actor._bounceId); b.actor._bounceId = 0; }
        b.actor.remove_all_transitions();
        b.actor.scale_y = 0.3;      // vẫn hiện nhưng thấp
    }
}
    destroy() { this.stop(); super.destroy(); }
});

/* ============================================================
 * Dynamic accent CSS — override mọi chỗ hardcode #7aa2ff
 * ============================================================ */
export function buildAccentCSS(hex) {
    const m = String(hex || '#7aa2ff').trim().match(/^#?([0-9a-fA-F]{6})$/);
    const h = m ? '#' + m[1].toLowerCase() : '#7aa2ff';
    const n = parseInt(m ? m[1] : '7aa2ff', 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const rgb = `${r}, ${g}, ${b}`;
    // Bản sáng hơn cho icon/hover
    const light = `rgb(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)})`;
    const lighter = `rgb(${Math.min(255, r + 100)}, ${Math.min(255, g + 100)}, ${Math.min(255, b + 100)})`;

    return `
.mynotch-surface .mynotch-tab-btn-active {
    color: #eaf0ff;
    background-color: rgba(${rgb}, 0.20);
    border: 1px solid rgba(${rgb}, 0.45);
}
.mynotch-surface .mynotch-tab-btn-active .mynotch-tab-icon { color: ${light}; }

.mynotch-surface .mynotch-settings-btn:hover {
    color: #eaf0ff;
    background-color: rgba(${rgb}, 0.20);
    border: 1px solid rgba(${rgb}, 0.38);
}

.mynotch-surface .mynotch-eyebrow { color: ${h}; }
.mynotch-surface .mynotch-eq-bar { background-color: ${h}; }

.mynotch-surface .mynotch-transport-primary {
    background-color: ${h};
    box-shadow: 0px 2px 8px rgba(${rgb}, 0.28);
}
.mynotch-surface .mynotch-transport-primary:hover {
    background-color: ${light};
}

.mynotch-surface .mynotch-timeline-fill { background-color: ${h}; }

.mynotch-surface .mynotch-tray-toggle-on {
    background-color: rgba(${rgb}, 0.20);
    border: 1px solid rgba(${rgb}, 0.50);
    color: #eaf0ff;
}
.mynotch-surface .mynotch-tray-toggle-on .mynotch-tray-toggle-label { color: #eaf0ff; }

.mynotch-surface .mynotch-tray-battery-icon { color: ${light}; }
.mynotch-surface .mynotch-bat-fill { background-color: ${h}; }

.mynotch-surface .mynotch-bt-toggle-on {
    background-color: rgba(${rgb}, 0.22);
    color: #ffffff;
}
.mynotch-surface .mynotch-bt-batt-fill { background-color: ${h}; }

.mynotch-surface .mynotch-wp-btn {
    background-color: rgba(${rgb}, 0.18);
    color: ${h};
}
.mynotch-surface .mynotch-wp-btn:hover {
    background-color: rgba(${rgb}, 0.30);
    color: ${lighter};
}
.mynotch-surface .mynotch-wp-cell-active {
    background-color: rgba(255, 255, 255, 0.09);
    border: 2px solid ${h};
}

.mynotch-surface .mynotch-notif-clear {
    background-color: rgba(${rgb}, 0.16);
    color: ${h};
}
.mynotch-surface .mynotch-notif-clear:hover {
    background-color: rgba(${rgb}, 0.30);
    color: ${lighter};
}
.mynotch-surface .mynotch-notif-icon { color: ${light}; }

.mynotch-surface .mynotch-cal-summary-icon {
    color: #eaf0ff;
    background-color: rgba(${rgb}, 0.18);
    border: 1px solid rgba(${rgb}, 0.28);
}
.mynotch-surface .mynotch-cal-today-btn {
    background-color: rgba(${rgb}, 0.16);
    color: ${h};
}
.mynotch-surface .mynotch-cal-today-btn:hover {
    background-color: rgba(${rgb}, 0.30);
    color: ${lighter};
}
.mynotch-surface .mynotch-cal-pill-active {
    color: #eaf0ff;
    background-color: rgba(${rgb}, 0.18);
    border: 1px solid rgba(${rgb}, 0.45);
}
.mynotch-surface .mynotch-cal-pill-today { color: ${h}; }
.mynotch-surface .mynotch-cal-pill-today .mynotch-cal-number { color: ${h}; }
.mynotch-surface .mynotch-cal-today-tag { color: ${h}; }
.mynotch-surface .mynotch-cal-start { color: #eaf0ff; }
.mynotch-surface .mynotch-cal-empty-icon { color: rgba(${rgb}, 0.75); }

.mynotch-surface .mynotch-bt-batt-fill.mynotch-bt-batt-low { background-color: #e8b06a; }
.mynotch-surface .mynotch-bat-fill.mynotch-bat-low { background-color: #e8b06a; }
`.trim();
}

/* ============================================================
 * Dynamic surface CSS — màu nền thanh bar
 * ============================================================ */
export function buildSurfaceCSS(hex, opacityPct) {
    const m = String(hex || '#0d0d10').trim().match(/^#?([0-9a-fA-F]{6})$/);
    const n = parseInt(m ? m[1] : '0d0d10', 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const o = Math.max(0, Math.min(1, (Number(opacityPct) || 100) / 100));

    return `
.mynotch-surface {
    background-color: rgba(${r}, ${g}, ${b}, ${o}) !important;
}
.mynotch-peek {
    background-color: rgba(${r}, ${g}, ${b}, ${Math.min(1, o + 0.08)}) !important;
}
`.trim();
}

/* ============================================================
 * Dynamic text color CSS — primary + secondary
 * ============================================================ */
export function buildTextCSS(primaryHex, secondaryCss) {
    // Primary: hex format (#rrggbb)
    const mp = String(primaryHex || '#f4f4f6').trim().match(/^#?([0-9a-fA-F]{6})$/);
    const ph = mp ? '#' + mp[1].toLowerCase() : '#f4f4f6';
    const pn = parseInt(mp ? mp[1] : 'f4f4f6', 16);
    const pr = (pn >> 16) & 255;
    const pg = (pn >> 8) & 255;
    const pb = pn & 255;

    // Secondary: accepts hex OR rgba()/rgb() string
    let sec = String(secondaryCss || 'rgba(255, 255, 255, 0.55)').trim();
    // Normalize hex → rgba string for consistency
    const ms = sec.match(/^#?([0-9a-fA-F]{6})$/);
    if (ms) {
        const n = parseInt(ms[1], 16);
        sec = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    }
    // If user only entered hex without alpha, apply default 0.55 alpha for a muted look
    let secCss = sec;
    if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(sec)) {
        secCss = sec.replace('rgb(', 'rgba(').replace(')', ', 0.55)');
    }

    const P = '.mynotch-surface';
    const K = '.mynotch-peek';

    return `
/* ---------- Primary text ---------- */
${P} .mynotch-pill-clock,
${P} .mynotch-pill-title,
${P} .mynotch-pill-battery-pct,
${P} .mynotch-track-title,
${P} .mynotch-knob-num,
${P} .mynotch-meter-num,
${P} .mynotch-tray-knob-val,
${P} .mynotch-tray-battery-text,
${P} .mynotch-bt-name,
${P} .mynotch-cal-summary-day,
${P} .mynotch-cal-number,
${P} .mynotch-cal-agenda-title,
${P} .mynotch-cal-event-title,
${P} .mynotch-cal-empty-title,
${P} .mynotch-wp-title,
${P} .mynotch-wp-empty-title,
${P} .mynotch-notif-title,
${P} .mynotch-notif-item-title,
${P} .mynotch-notif-empty-title,
${P} .mynotch-tray-knob-label,
${P} .mynotch-tray-toggle-label,
${P} .mynotch-meter-label-row {
    color: ${ph};
}

${K} .mynotch-peek-title {
    color: ${ph};
}

/* ---------- Secondary / muted text ---------- */
${P} .mynotch-pill-icon,
${P} .mynotch-track-artist,
${P} .mynotch-scroll-hint,
${P} .mynotch-timeline-elapsed,
${P} .mynotch-timeline-total,
${P} .mynotch-meter-num-sm,
${P} .mynotch-tray-battery-sub,
${P} .mynotch-bt-eyebrow,
${P} .mynotch-bt-pct,
${P} .mynotch-bt-status,
${P} .mynotch-bt-empty,
${P} .mynotch-bt-icon,
${P} .mynotch-cal-summary-date,
${P} .mynotch-cal-weekday,
${P} .mynotch-cal-pill,
${P} .mynotch-cal-pill-far,
${P} .mynotch-cal-agenda-date,
${P} .mynotch-cal-end,
${P} .mynotch-cal-event-location,
${P} .mynotch-cal-empty-sub,
${P} .mynotch-wp-subtitle,
${P} .mynotch-wp-name,
${P} .mynotch-wp-empty-sub,
${P} .mynotch-notif-subtitle,
${P} .mynotch-notif-item-body,
${P} .mynotch-notif-empty-sub,
${P} .mynotch-tab-btn:not(.mynotch-tab-btn-active),
${P} .mynotch-tab-btn:not(.mynotch-tab-btn-active) .mynotch-tab-icon,
${P} .mynotch-settings-btn:not(:hover) {
    color: ${secCss};
}

${K} .mynotch-peek-body {
    color: ${secCss};
}
`.trim();
}
