import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class MprisHelper {
    constructor() {
        this._proxy = null;
        this._playerName = null;
        this._onChange = null;
        this._propsId = 0;
        this._pollId = 0;
        this._busWatchId = 0;
        this._watchNameOwners();
        this._connectToActivePlayer();
    }

    _watchNameOwners() {
        if (this._busWatchId) return;
        try {
            this._busWatchId = Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',
                'org.freedesktop.DBus',
                'NameOwnerChanged',
                '/org/freedesktop/DBus',
                null,
                Gio.DBusSignalFlags.NONE,
                (conn, sender, path, iface, signal, params) => {
                    try {
                        const [name, _old, newOwner] = params.deep_unpack();
                        if (typeof name !== 'string' ||
                            !name.startsWith('org.mpris.MediaPlayer2.'))
                            return;
                        // Our current player vanished -> tear down and reconnect.
                        if (this._playerName &&
                            name === `org.mpris.MediaPlayer2.${this._playerName}` &&
                            !newOwner) {
                            this._teardownProxy();
                            this._connectToActivePlayer();
                            return;
                        }
                        // No player yet -> try to connect to a fresh one.
                        if (!this._proxy) this._connectToActivePlayer();
                    } catch (e) {}
                }
            );
        } catch (e) {
            console.error('MyNotch: NameOwnerChanged subscribe failed', e);
        }
    }

    _teardownProxy() {
        if (this._proxy && this._propsId) {
            try { this._proxy.disconnect(this._propsId); } catch (e) {}
        }
        this._proxy = null;
        this._propsId = 0;
        this._playerName = null;
        this._notify();
    }

    set onChange(cb) { this._onChange = cb; }

    _notify() {
        if (this._onChange) this._onChange();
    }

    _connectToActivePlayer() {
        let players = [];
        try {
            let bus = Gio.DBus.session;
            let [names] = bus.call_sync(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null, null,
                Gio.DBusCallFlags.NONE, -1, null
            ).deep_unpack();
            players = names
                .filter(n => n.startsWith('org.mpris.MediaPlayer2.'))
                .map(n => n.replace('org.mpris.MediaPlayer2.', ''));
        } catch (e) {
            return;
        }

        if (players.length === 0) {
            this._scheduleRetry();
            return;
        }

        let name = players[0];
        this._playerName = name;

        try {
            this._proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                `org.mpris.MediaPlayer2.${name}`,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2.Player',
                null
            );
            this._propsId = this._proxy.connect('g-properties-changed',
                () => this._notify());
            this._notify();
        } catch (e) {
            this._proxy = null;
            this._scheduleRetry();
        }
    }

    _scheduleRetry() {
        if (this._pollId) return;
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            this._pollId = 0;
            if (!this._proxy) this._connectToActivePlayer();
            return GLib.SOURCE_REMOVE;
        });
    }

    _getProp(name) {
        if (!this._proxy) return null;
        try {
            let v = this._proxy.get_cached_property(name);
            return v ? v.deep_unpack() : null;
        } catch (e) {
            return null;
        }
    }

    _unpackValue(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            return v;
        if (typeof v.deep_unpack === 'function') {
            try { return v.deep_unpack(); } catch (e) { return null; }
        }
        if (typeof v.unpack === 'function') {
            try { return v.unpack(); } catch (e) { return null; }
        }
        return v;
    }

    getTrackInfo() {
        let empty = {
            hasMedia: false, title: '', artist: '', status: 'Stopped',
            canPlay: false, canNext: false, canPrev: false,
            albumArt: null, length: 0, trackId: null,
            shuffle: false, loopStatus: 'None',
            hasShuffle: false, hasLoop: false,
        };
        if (!this._proxy) return empty;

        let metadata = this._getProp('Metadata') || {};
        let status = this._getProp('PlaybackStatus') || 'Stopped';

        let title = '';
        let artist = '';
        let albumArt = null;
        let length = 0;
        let trackId = null;

        try {
            let t = this._unpackValue(metadata['xesam:title']);
            if (t) title = String(t);

            let a = this._unpackValue(metadata['xesam:artist']);
            if (Array.isArray(a)) artist = a.map(String).join(', ');
            else if (a) artist = String(a);

            let art = this._unpackValue(metadata['mpris:artUrl']);
            if (art) albumArt = String(art);

            let len = this._unpackValue(metadata['mpris:length']);
            if (len) length = Number(len);

            let tid = this._unpackValue(metadata['mpris:trackid']);
            if (tid) trackId = String(tid);
        } catch (e) {}

        let hasMedia = !!(title && title.length);

        return {
            hasMedia,
            title: title || 'Không có nhạc',
            artist: artist || '',
            status,
            albumArt,
            length,
            trackId,
            shuffle: !!this._getProp('Shuffle'),
            loopStatus: this._getProp('LoopStatus') || 'None',
            canPlay: !!this._getProp('CanPlay'),
            canNext: !!this._getProp('CanGoNext'),
            canPrev: !!this._getProp('CanGoPrevious'),
            hasShuffle: this._getProp('Shuffle') !== null,
            hasLoop: this._getProp('LoopStatus') !== null,
        };
    }

    playPause() {
        if (!this._proxy) return;
        try { this._proxy.call_sync('PlayPause', null, Gio.DBusCallFlags.NONE, -1, null); }
        catch (e) {}
    }

    next() {
        if (!this._proxy) return;
        try { this._proxy.call_sync('Next', null, Gio.DBusCallFlags.NONE, -1, null); }
        catch (e) {}
    }

    previous() {
        if (!this._proxy) return;
        try { this._proxy.call_sync('Previous', null, Gio.DBusCallFlags.NONE, -1, null); }
        catch (e) {}
    }

    toggleShuffle() {
        if (!this._proxy) return;
        try {
            let cur = this._getProp('Shuffle');
            this._proxy.call_sync('org.freedesktop.DBus.Properties.Set',
                new GLib.Variant('(ssv)', [
                    'org.mpris.MediaPlayer2.Player', 'Shuffle', new GLib.Variant('b', !cur)
                ]),
                Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {}
    }

    cycleLoop() {
        if (!this._proxy) return;
        try {
            let cur = this._getProp('LoopStatus') || 'None';
            let next = cur === 'None' ? 'Playlist' : cur === 'Playlist' ? 'Track' : 'None';
            this._proxy.call_sync('org.freedesktop.DBus.Properties.Set',
                new GLib.Variant('(ssv)', [
                    'org.mpris.MediaPlayer2.Player', 'LoopStatus', new GLib.Variant('s', next)
                ]),
                Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {}
    }

    getPositionAsync(cb) {
        if (!this._proxy || !this._playerName) { cb(0); return; }
        Gio.DBus.session.call(
            `org.mpris.MediaPlayer2.${this._playerName}`,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null,
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    let v = conn.call_finish(res);
                    let inner = v.deep_unpack();
                    let val = inner?.[0]?.deep_unpack?.() ?? 0;
                    cb(Number(val) || 0);
                } catch (e) {
                    cb(0);
                }
            }
        );
    }

    setPosition(trackId, posUs) {
        if (!this._proxy || !this._playerName) return;
        try {
            Gio.DBus.session.call(
                `org.mpris.MediaPlayer2.${this._playerName}`,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2.Player',
                'SetPosition',
                new GLib.Variant('(ox)', [trackId || '/', BigInt(Math.round(posUs))]),
                null,
                Gio.DBusCallFlags.NONE, -1, null, null
            );
        } catch (e) {}
    }

    seek(offsetUs) {
        if (!this._proxy) return;
        try {
            this._proxy.call_sync('Seek',
                new GLib.Variant('(x)', [BigInt(Math.round(offsetUs))]),
                Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {}
    }

    destroy() {
        if (this._proxy && this._propsId) {
            try { this._proxy.disconnect(this._propsId); } catch (e) {}
        }
        this._proxy = null;
        this._propsId = 0;
        this._playerName = null;
        this._onChange = null;
        if (this._pollId) { GLib.Source.remove(this._pollId); this._pollId = 0; }
        if (this._busWatchId) {
            try { Gio.DBus.session.signal_unsubscribe(this._busWatchId); }
            catch (e) {}
            this._busWatchId = 0;
        }
    }
}
