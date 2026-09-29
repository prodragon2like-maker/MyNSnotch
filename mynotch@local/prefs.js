import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { Config, BLUR_PRESETS, BLUR_RADIUS_RANGE, BLUR_DEFAULTS, DEFAULTS } from './config.js';

const TABS = [
    { id: 'music',     label: 'Music' },
    { id: 'notif',     label: 'Notif' },
    { id: 'tray',      label: 'Tray' },
    { id: 'calendar',  label: 'Cal' },
    { id: 'wallpaper', label: 'Wall' },
];

export default class MyNotchPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._config = new Config();

        const appearance = this._page('Appearance', 'applications-graphics-symbolic');
        const layout     = this._page('Layout', 'view-fullscreen-symbolic');
        const behaviour  = this._page('Behaviour', 'input-mouse-symbolic');
        const tabsPage   = this._page('Tabs', 'view-grid-symbolic');
        const blurPage   = this._page('Blur', 'blur-symbolic');
        const aboutPage  = this._page('About', 'help-about-symbolic');

        window.add(appearance);
        window.add(layout);
        window.add(behaviour);
        window.add(tabsPage);
        window.add(blurPage);
        window.add(aboutPage);

        this._fillAppearance(appearance);
        this._fillLayout(layout);
        this._fillBehaviour(behaviour);
        this._fillTabs(tabsPage);
        this._fillBlur(blurPage);
        this._fillAbout(aboutPage);

        window.set_default_size(680, 780);
        window.search_enabled = true;
    }

    _page(title, icon) {
        return new Adw.PreferencesPage({ title, icon_name: icon });
    }

    /* ============================================================
     * Helpers
     * ============================================================ */
    _spin({ title, subtitle, key, min, max, step = 1, page = 10 }) {
        const row = new Adw.SpinRow({
            title, subtitle,
            adjustment: new Gtk.Adjustment({
                lower: min, upper: max, step_increment: step,
                page_increment: page,
                value: this._config.get(key),
            }),
        });
        row.connect('notify::value', () => this._config.set(key, Math.round(row.get_value())));
        return row;
    }

    _switch({ title, subtitle, key }) {
        const row = new Adw.SwitchRow({
            title, subtitle,
            active: this._config.get(key) === true,
        });
        row.connect('notify::active', () => this._config.set(key, row.get_active()));
        return row;
    }

    _colorRow({ title, subtitle, key, fallback }) {
        const row = new Adw.ActionRow({ title, subtitle });
        const btn = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({ with_alpha: false }),
            valign: Gtk.Align.CENTER,
        });
        const rgba = new Gdk.RGBA();
        const cur = this._config.get(key, fallback) || fallback;
        if (rgba.parse(cur)) btn.set_rgba(rgba);
        btn.connect('notify::rgba', () => {
            const c = btn.get_rgba();
            const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
            this._config.set(key, '#' + to(c.red) + to(c.green) + to(c.blue));
        });
        row.add_suffix(btn);
        row._btn = btn;
        return row;
    }

    _resetRow({ title, subtitle, key, fallback, colorRow }) {
        const row = new Adw.ActionRow({ title, subtitle });
        const btn = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER });
        btn.add_css_class('flat');
        btn.connect('clicked', () => {
            this._config.set(key, fallback);
            if (colorRow && colorRow._btn) {
                const r = new Gdk.RGBA();
                r.parse(fallback);
                colorRow._btn.set_rgba(r);
            }
        });
        row.add_suffix(btn);
        return row;
    }

    /* ============================================================
     * PAGE 1 — APPEARANCE
     * ============================================================ */
    _fillAppearance(page) {
        /* ---------- Colors ---------- */
        const colors = new Adw.PreferencesGroup({
            title: 'Colors',
            description: 'Accent, surface, and text colours',
        });
        page.add(colors);

        const accentRow = this._colorRow({
            title: 'Accent color',
            subtitle: 'Active tabs, highlights, progress bars, icons',
            key: 'accent', fallback: DEFAULTS.accent,
        });
        colors.add(accentRow);
        colors.add(this._resetRow({
            title: 'Reset accent', subtitle: 'Back to #7aa2ff',
            key: 'accent', fallback: DEFAULTS.accent, colorRow: accentRow,
        }));

        const surfaceRow = this._colorRow({
            title: 'Surface background',
            subtitle: 'Background colour of the notch / bar',
            key: 'surfaceColor', fallback: DEFAULTS.surfaceColor,
        });
        colors.add(surfaceRow);
        colors.add(this._resetRow({
            title: 'Reset surface colour', subtitle: 'Back to #0d0d10',
            key: 'surfaceColor', fallback: DEFAULTS.surfaceColor, colorRow: surfaceRow,
        }));

        const textPrimaryRow = this._colorRow({
            title: 'Text — primary',
            subtitle: 'Titles, numbers, main labels',
            key: 'textPrimary', fallback: DEFAULTS.textPrimary,
        });
        colors.add(textPrimaryRow);
        colors.add(this._resetRow({
            title: 'Reset primary text', subtitle: 'Back to #f4f4f6',
            key: 'textPrimary', fallback: DEFAULTS.textPrimary, colorRow: textPrimaryRow,
        }));

        const textSecondaryRow = this._colorRow({
            title: 'Text — secondary',
            subtitle: 'Subtitles, muted labels, timestamps',
            key: 'textSecondary', fallback: DEFAULTS.textSecondary,
        });
        colors.add(textSecondaryRow);
        colors.add(this._resetRow({
            title: 'Reset secondary text', subtitle: 'Back to rgba(255,255,255,0.55)',
            key: 'textSecondary', fallback: DEFAULTS.textSecondary, colorRow: textSecondaryRow,
        }));

        /* ---------- Opacity ---------- */
        const opacity = new Adw.PreferencesGroup({ title: 'Opacity' });
        page.add(opacity);
        opacity.add(this._spin({
            title: 'Surface opacity',
            subtitle: 'Background opacity of the notch surface (%)',
            key: 'surfaceOpacity', min: 30, max: 100, step: 5,
        }));

        /* ---------- Typography ---------- */
        const typo = new Adw.PreferencesGroup({ title: 'Typography' });
        page.add(typo);
        typo.add(this._spin({
            title: 'Font scale',
            subtitle: 'Global text scale inside the notch (%)',
            key: 'fontScale', min: 80, max: 130, step: 5,
        }));
        typo.add(this._spin({
            title: 'Notification peek font scale',
            subtitle: 'Text scale for the floating notification banner (%)',
            key: 'peekFontScale', min: 80, max: 150, step: 5,
        }));
    }

    /* ============================================================
     * PAGE 2 — LAYOUT
     * ============================================================ */
    _fillLayout(page) {
        const pill = new Adw.PreferencesGroup({
            title: 'Pill (collapsed)',
            description: 'Dimensions when the notch is collapsed',
        });
        page.add(pill);
        pill.add(this._spin({
            title: 'Height', subtitle: 'Height of the collapsed notch (px)',
            key: 'pillHeight', min: 28, max: 64, step: 2,
        }));
        pill.add(this._spin({
            title: 'Minimum width', subtitle: 'Minimum width of the collapsed notch (px)',
            key: 'pillWidthMin', min: 180, max: 520, step: 10,
        }));
        pill.add(this._spin({
            title: 'Corner radius', subtitle: 'Bottom corner rounding (px) — notch mode only',
            key: 'pillCornerRadius', min: 0, max: 40, step: 1,
        }));

        const dash = new Adw.PreferencesGroup({ title: 'Dashboard (expanded)' });
        page.add(dash);
        dash.add(this._spin({
            title: 'Dashboard width', subtitle: 'Width of the expanded notch (px)',
            key: 'dashWidth', min: 420, max: 900, step: 10,
        }));
        dash.add(this._spin({
            title: 'Dashboard minimum height', subtitle: 'Minimum height of the expanded notch (px)',
            key: 'dashMinHeight', min: 240, max: 600, step: 10,
        }));

        /* ---------- Island mode ---------- */
        const island = new Adw.PreferencesGroup({
            title: 'Island mode',
            description: 'Detach the notch from the screen edge and float it',
        });
        page.add(island);

        const enableRow = new Adw.SwitchRow({
            title: 'Enable island mode',
            subtitle: 'Float the panel below the top edge',
            active: this._config.get('islandMode') === true,
        });
        island.add(enableRow);

        const padRow = new Adw.SpinRow({
            title: 'Top padding', subtitle: 'Gap between island and screen top (px)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 64, step_increment: 1, page_increment: 4,
                value: Number(this._config.get('islandTopPadding')) || 8,
            }),
        });
        island.add(padRow);

        const cornerRow = new Adw.SpinRow({
            title: 'Island corner radius', subtitle: 'Rounded corners on all four sides (px)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 40, step_increment: 1, page_increment: 2,
                value: Number(this._config.get('islandCornerRadius')) || 22,
            }),
        });
        island.add(cornerRow);

        const sync = () => {
            const on = enableRow.get_active();
            padRow.set_sensitive(on);
            cornerRow.set_sensitive(on);
        };
        sync();
        enableRow.connect('notify::active', () => {
            this._config.set('islandMode', enableRow.get_active());
            sync();
        });
        padRow.connect('notify::value', () =>
            this._config.set('islandTopPadding', Math.round(padRow.get_value())));
        cornerRow.connect('notify::value', () =>
            this._config.set('islandCornerRadius', Math.round(cornerRow.get_value())));

        /* ---------- Pill content ---------- */
        const pillContent = new Adw.PreferencesGroup({ title: 'Pill content' });
        page.add(pillContent);
        pillContent.add(this._switch({
            title: 'Show battery on pill', subtitle: 'Battery icon and percentage',
            key: 'showBattery',
        }));
        pillContent.add(this._switch({
            title: 'Show music on pill', subtitle: 'Now-playing track title',
            key: 'showMusic',
        }));
        pillContent.add(this._switch({
            title: 'Show clock seconds', subtitle: 'Display HH:MM:SS instead of HH:MM',
            key: 'showClockSeconds',
        }));
        pillContent.add(this._switch({
            title: '24-hour clock', subtitle: 'Use 24-hour time format',
            key: 'clockFormat24h',
        }));
    }

    /* ============================================================
     * PAGE 3 — BEHAVIOUR
     * ============================================================ */
    _fillBehaviour(page) {
        const expand = new Adw.PreferencesGroup({
            title: 'Expand / collapse',
            description: 'How the notch reacts to hover and clicks',
        });
        page.add(expand);

        expand.add(this._switch({
            title: 'Hover to expand',
            subtitle: 'Expand the dashboard when pointer enters the pill',
            key: 'hoverToExpand',
        }));
        expand.add(this._switch({
            title: 'Click to expand',
            subtitle: 'Also expand when the pill is clicked',
            key: 'clickToExpand',
        }));
        expand.add(this._spin({
            title: 'Expand delay', subtitle: 'Delay before expanding after hover (ms)',
            key: 'expandDelay', min: 0, max: 1500, step: 20, page: 100,
        }));
        expand.add(this._spin({
            title: 'Collapse delay', subtitle: 'Delay before collapsing after pointer leaves (ms)',
            key: 'collapseDelay', min: 0, max: 2000, step: 20, page: 100,
        }));

        const peek = new Adw.PreferencesGroup({ title: 'Notification peek' });
        page.add(peek);
        peek.add(this._switch({
            title: 'Show notification peek',
            subtitle: 'Show a floating banner when a new notification arrives',
            key: 'showNotifPeek',
        }));
        peek.add(this._spin({
            title: 'Peek duration', subtitle: 'How long the peek stays visible (ms)',
            key: 'peekDuration', min: 1000, max: 15000, step: 200, page: 1000,
        }));
        peek.add(this._spin({
            title: 'Peek width', subtitle: 'Width of the peek banner (px)',
            key: 'peekWidth', min: 260, max: 720, step: 10,
        }));
        peek.add(this._spin({
            title: 'Peek height', subtitle: 'Height of the peek banner (px)',
            key: 'peekHeight', min: 56, max: 140, step: 2,
        }));
    }

    /* ============================================================
     * PAGE 4 — TABS
     * ============================================================ */
    _fillTabs(page) {
        /* ---------- Visibility ---------- */
        const vis = new Adw.PreferencesGroup({
            title: 'Tab visibility',
            description: 'Toggle which tabs appear in the dashboard',
        });
        page.add(vis);

        for (const tab of TABS) {
            const row = new Adw.SwitchRow({
                title: `Show "${tab.label}" tab`,
                subtitle: `Toggle visibility of the ${tab.label} tab`,
                active: !this._hiddenTabs().includes(tab.id),
            });
            row.connect('notify::active', () => {
                let hidden = this._hiddenTabs();
                if (row.get_active()) hidden = hidden.filter(id => id !== tab.id);
                else if (!hidden.includes(tab.id)) hidden.push(tab.id);
                this._config.set('hideTabs', hidden.join(','));
            });
            vis.add(row);
        }

        /* ---------- Music ---------- */
        const music = new Adw.PreferencesGroup({ title: 'Music tab' });
        page.add(music);
        music.add(this._switch({
            title: 'Vinyl spins while playing',
            subtitle: 'Rotate the vinyl disc when audio is playing',
            key: 'musicVinylSpin',
        }));
        music.add(this._spin({
            title: 'Vinyl size', subtitle: 'Diameter of the vinyl disc (px)',
            key: 'musicVinylSize', min: 90, max: 220, step: 4,
        }));
        music.add(this._switch({
            title: 'Show timeline', subtitle: 'Display seek bar and elapsed/total time',
            key: 'musicShowTimeline',
        }));

        /* ---------- Tray ---------- */
        const tray = new Adw.PreferencesGroup({ title: 'Tray tab' });
        page.add(tray);
        tray.add(this._spin({
            title: 'Refresh interval', subtitle: 'How often to poll CPU/RAM/Disk/Network (s)',
            key: 'trayRefreshSec', min: 1, max: 30, step: 1,
        }));
        tray.add(this._switch({
            title: 'Show Bluetooth card',
            subtitle: 'Show the Bluetooth device list in the Tray tab',
            key: 'trayShowBluetooth',
        }));
        tray.add(this._switch({
            title: 'Show battery card',
            subtitle: 'Show the battery status card in the Tray tab',
            key: 'trayShowBattery',
        }));

        /* ---------- Notifications ---------- */
        const notif = new Adw.PreferencesGroup({ title: 'Notifications tab' });
        page.add(notif);
        notif.add(this._spin({
            title: 'Max notifications shown',
            subtitle: 'Limit how many notifications appear in the list',
            key: 'notifMaxVisible', min: 5, max: 200, step: 5,
        }));
        notif.add(this._switch({
            title: 'Show "Clear all" button',
            subtitle: 'Display the clear-all button in the Notif tab',
            key: 'notifShowClearAll',
        }));

        /* ---------- Calendar ---------- */
        const cal = new Adw.PreferencesGroup({ title: 'Calendar tab' });
        page.add(cal);
        const weekModel = new Gtk.StringList();
        weekModel.append('Sunday');
        weekModel.append('Monday');
        const weekRow = new Adw.ComboRow({
            title: 'Week starts on',
            subtitle: 'First day of the week for date calculations',
            model: weekModel,
            selected: Number(this._config.get('calWeekStart')) === 0 ? 0 : 1,
        });
        weekRow.connect('notify::selected', () =>
            this._config.set('calWeekStart', weekRow.get_selected()));
        cal.add(weekRow);
        cal.add(this._spin({
            title: 'Date strip range',
            subtitle: 'Days shown on each side of the selected date',
            key: 'calStripRange', min: 1, max: 6, step: 1,
        }));

        /* ---------- Wallpaper ---------- */
        const wp = new Adw.PreferencesGroup({ title: 'Wallpaper tab' });
        page.add(wp);

        const folderRow = new Adw.ActionRow({
            title: 'Wallpaper folder',
            subtitle: this._config.get('wallpaperFolder', 'Not set') || 'Not set',
        });
        const pickBtn = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Choose folder',
        });
        pickBtn.add_css_class('flat');
        pickBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: 'Choose wallpaper folder' });
            const current = this._config.get('wallpaperFolder', '');
            if (current) {
                try { dialog.set_initial_folder(Gio.File.new_for_path(current)); } catch (e) {}
            }
            dialog.select_folder(page.get_root(), null, (d, res) => {
                try {
                    const file = d.select_folder_finish(res);
                    if (file) {
                        const path = file.get_path();
                        this._config.set('wallpaperFolder', path);
                        folderRow.set_subtitle(path);
                    }
                } catch (e) {}
            });
        });
        folderRow.add_suffix(pickBtn);
        wp.add(folderRow);

        const slideEnable = new Adw.SwitchRow({
            title: 'Auto change wallpaper',
            subtitle: 'Rotate through images in the folder on a timer',
            active: this._config.get('wpSlideshowEnabled', false) === true,
        });
        wp.add(slideEnable);

        const slideMin = new Adw.SpinRow({
            title: 'Change interval', subtitle: 'How often to switch (minutes)',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 1440, step_increment: 5, page_increment: 30,
                value: Number(this._config.get('wpSlideshowMin')) || 30,
            }),
        });
        wp.add(slideMin);

        const slideShuffle = new Adw.SwitchRow({
            title: 'Shuffle order',
            subtitle: 'Random image each time instead of alphabetical order',
            active: this._config.get('wpSlideshowShuffle', false) === true,
        });
        wp.add(slideShuffle);

        const syncSlide = () => {
            const on = slideEnable.get_active();
            slideMin.set_sensitive(on);
            slideShuffle.set_sensitive(on);
        };
        syncSlide();
        slideEnable.connect('notify::active', () => {
            this._config.set('wpSlideshowEnabled', slideEnable.get_active());
            syncSlide();
        });
        slideMin.connect('notify::value', () =>
            this._config.set('wpSlideshowMin', Math.round(slideMin.get_value())));
        slideShuffle.connect('notify::active', () =>
            this._config.set('wpSlideshowShuffle', slideShuffle.get_active()));
    }

    _hiddenTabs() {
        return String(this._config.get('hideTabs') || '')
            .split(',').map(s => s.trim()).filter(Boolean);
    }

    /* ============================================================
     * PAGE 5 — BLUR
     * ============================================================ */
    _fillBlur(page) {
        const group = new Adw.PreferencesGroup({
            title: 'Glass & Blur',
            description: 'Real gaussian blur of the wallpaper / windows behind the notch',
        });
        page.add(group);

        const enableRow = this._switch({
            title: 'Enable blur',
            subtitle: 'Composite a live backdrop blur behind the panel',
            key: 'blurEnabled',
        });
        group.add(enableRow);

        const presetIds = BLUR_PRESETS.map(p => p.id);
        const presetModel = new Gtk.StringList();
        for (const p of BLUR_PRESETS) presetModel.append(p.label);

        const currentPreset = this._config.blur.preset;
        const presetRow = new Adw.ComboRow({
            title: 'Glass style',
            subtitle: BLUR_PRESETS[Math.max(0, presetIds.indexOf(currentPreset))].description,
            model: presetModel,
            selected: Math.max(0, presetIds.indexOf(currentPreset)),
        });
        group.add(presetRow);

        let syncing = false;

        const collapsedRow = new Adw.SpinRow({
            title: 'Collapsed blur', subtitle: 'Blur strength while the notch is a pill',
            adjustment: new Gtk.Adjustment({
                lower: BLUR_RADIUS_RANGE.min, upper: BLUR_RADIUS_RANGE.max,
                step_increment: 2, page_increment: 8,
                value: this._config.blur.collapsedRadius,
            }),
        });
        group.add(collapsedRow);

        const expandedRow = new Adw.SpinRow({
            title: 'Expanded blur', subtitle: 'Blur strength while the dashboard is open',
            adjustment: new Gtk.Adjustment({
                lower: BLUR_RADIUS_RANGE.min, upper: BLUR_RADIUS_RANGE.max,
                step_increment: 2, page_increment: 8,
                value: this._config.blur.expandedRadius,
            }),
        });
        group.add(expandedRow);

        presetRow.connect('notify::selected', () => {
            if (syncing) return;
            const p = BLUR_PRESETS[presetRow.get_selected()];
            if (!p) return;
            presetRow.set_subtitle(p.description);
            this._config.setBlur({
                preset: p.id,
                collapsedRadius: p.collapsedRadius,
                expandedRadius: p.expandedRadius,
            });
            syncing = true;
            collapsedRow.set_value(p.collapsedRadius);
            expandedRow.set_value(p.expandedRadius);
            syncing = false;
        });

        collapsedRow.connect('notify::value', () => {
            if (syncing) return;
            this._config.setBlur({ collapsedRadius: collapsedRow.get_value() });
        });
        expandedRow.connect('notify::value', () => {
            if (syncing) return;
            this._config.setBlur({ expandedRadius: expandedRow.get_value() });
        });

        const resetRow = new Adw.ActionRow({
            title: 'Reset glass & blur',
            subtitle: 'Restore the default style and strengths',
        });
        const resetBtn = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER });
        resetBtn.add_css_class('flat');
        resetRow.add_suffix(resetBtn);
        resetRow.set_activatable_widget(resetBtn);
        group.add(resetRow);
        resetBtn.connect('clicked', () => {
            this._config.setBlur({
                preset: BLUR_DEFAULTS.preset,
                collapsedRadius: BLUR_DEFAULTS.collapsedRadius,
                expandedRadius: BLUR_DEFAULTS.expandedRadius,
            });
            syncing = true;
            const idx = Math.max(0, presetIds.indexOf(BLUR_DEFAULTS.preset));
            presetRow.set_selected(idx);
            presetRow.set_subtitle(BLUR_PRESETS[idx].description);
            collapsedRow.set_value(BLUR_DEFAULTS.collapsedRadius);
            expandedRow.set_value(BLUR_DEFAULTS.expandedRadius);
            syncing = false;
        });

        const syncSensitivity = () => {
            const on = enableRow.get_active();
            presetRow.set_sensitive(on);
            collapsedRow.set_sensitive(on);
            expandedRow.set_sensitive(on);
            resetRow.set_sensitive(on);
        };
        enableRow.connect('notify::active', syncSensitivity);
        syncSensitivity();

        /* ---------- Reset all ---------- */
        const resetAllGroup = new Adw.PreferencesGroup({ title: 'Reset' });
        page.add(resetAllGroup);

        const resetAllRow = new Adw.ActionRow({
            title: 'Reset all settings',
            subtitle: 'Restore every MyNotch setting to its default value',
        });
        const resetAllBtn = new Gtk.Button({
            label: 'Reset all',
            valign: Gtk.Align.CENTER,
        });
        resetAllBtn.add_css_class('destructive-action');
        resetAllBtn.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({
                transient_for: resetAllBtn.get_root(),
                heading: 'Reset all settings?',
                body: 'This will restore every MyNotch setting to its default value. The change is immediate.',
            });
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('reset', 'Reset');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (d, response) => {
                if (response !== 'reset') return;
                const c = new Config();
                c._data = {};
                c.save();
                try {
                    const root = resetAllBtn.get_root();
                    if (root && typeof root.reload === 'function') root.reload();
                    else if (root) root.close();
                } catch (e) {}
            });
            dialog.present();
        });
        resetAllRow.add_suffix(resetAllBtn);
        resetAllGroup.add(resetAllRow);
    }

    /* ============================================================
     * PAGE 6 — ABOUT
     * ============================================================ */
    _fillAbout(page) {
        const about = new Adw.PreferencesGroup({ title: 'About MyNotch' });
        page.add(about);
        about.add(new Adw.ActionRow({
            title: 'MyNotch',
            subtitle: 'Personal notch extension · v1',
        }));
        about.add(new Adw.ActionRow({
            title: 'GNOME Shell',
            subtitle: '45+ / 48',
        }));

        const links = new Adw.PreferencesGroup({ title: 'Settings location' });
        page.add(links);
        const cfgPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mynotch', 'config.json']);
        links.add(new Adw.ActionRow({
            title: 'Config file',
            subtitle: cfgPath,
        }));
    }
}
