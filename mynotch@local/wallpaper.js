import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'jxl'];

export class WallpaperHelper {
    constructor(config) {
        this._config = config;
    }

    getFolder() {
        return this._config.get('wallpaperFolder', '') || '';
    }

    // List ảnh trong folder — trả [{path, name, uri, current}].
    getWallpapers() {
        let folder = this.getFolder();
        if (!folder) return [];
        let currentPath = this.getCurrent();
        let out = [];
        try {
            let dir = Gio.File.new_for_path(folder);
            if (!dir.query_exists(null)) return [];
            let enumerator = dir.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                let name = info.get_name();
                let ext = name.split('.').pop().toLowerCase();
                if (!IMAGE_EXTS.includes(ext)) continue;
                let path = GLib.build_filenamev([folder, name]);
                out.push({
                    path,
                    name,
                    uri: Gio.File.new_for_path(path).get_uri(),
                    current: path === currentPath,
                });
            }
            enumerator.close(null);
        } catch (e) {
            console.error('MyNotch: getWallpapers failed', e);
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return out;
    }

    setWallpaper(path) {
        try {
            let uri = Gio.File.new_for_path(path).get_uri();
            let s = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
            s.set_string('picture-uri', uri);
            try { s.set_string('picture-uri-dark', uri); } catch (e) {}
            return true;
        } catch (e) {
            console.error('MyNotch: setWallpaper failed', e);
            return false;
        }
    }

    getCurrent() {
        try {
            let s = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
            let uri = s.get_string('picture-uri');
            if (!uri) return null;
            return Gio.File.new_for_uri(uri).get_path();
        } catch (e) {
            return null;
        }
    }

    // MyNotch không xoay landscape → preview chính là file gốc.
    previewPathFor(path) {
        return path;
    }

    pickFolder(callback) {
        try {
            let proc = Gio.Subprocess.new(
                ['zenity', '--file-selection', '--directory',
                 '--title=Chọn folder ảnh nền'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [, stdout] = p.communicate_utf8_finish(res);
                    let path = (stdout || '').trim();
                    callback(path || null);
                } catch (e) {
                    callback(null);
                }
            });
        } catch (e) {
            console.error('MyNotch: pickFolder failed', e);
            callback(null);
        }
    }

    /* ============================================================
     * Slideshow — chọn ảnh kế tiếp
     * ============================================================ */

    // Trả path của ảnh kế tiếp trong folder, hoặc null.
    // sequential: theo thứ tự alphabet; shuffle: ngẫu nhiên (khác ảnh hiện tại).
    nextWallpaper(shuffle = false) {
        const items = this.getWallpapers();
        if (items.length === 0) return null;
        if (items.length === 1) return items[0].path;

        const current = this.getCurrent();

        if (shuffle) {
            // Chọn random khác current
            const pool = items.filter(w => w.path !== current);
            const list = pool.length > 0 ? pool : items;
            return list[Math.floor(Math.random() * list.length)].path;
        }

        // Sequential: ảnh kế tiếp sau current (wrap về đầu)
        let idx = items.findIndex(w => w.path === current);
        if (idx < 0) idx = 0;
        const next = (idx + 1) % items.length;
        return items[next].path;
    }
}
