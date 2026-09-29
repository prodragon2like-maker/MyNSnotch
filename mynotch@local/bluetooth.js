// mynotch@local/bluetooth.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BLUEZ_NAME = 'org.bluez';

export class BluetoothHelper {
    constructor() {
        this._adapterPath = null;
        this._devicesCache = [];
        this._refreshing = false;
        this._poweredCache = false;
        this._poweredRefreshing = false;
        this.onDevicesChanged = null;
        this.onPoweredChanged = null;
    }

    // Find the object path of the first available Bluetooth adapter.
    _getAdapterPath() {
        if (this._adapterPath) return this._adapterPath;
        try {
            let res = Gio.DBus.system.call_sync(
                BLUEZ_NAME, '/', 'org.freedesktop.DBus.ObjectManager',
                'GetManagedObjects', null, null,
                Gio.DBusCallFlags.NONE, 2000, null);
            let [objects] = res.recursiveUnpack();
            for (let [path, ifaces] of Object.entries(objects)) {
                if (ifaces['org.bluez.Adapter1']) {
                    this._adapterPath = path;
                    break;
                }
            }
        } catch (e) {
            // BlueZ is not available.
        }
        return this._adapterPath;
    }

    // Get the radio power state (cached, refreshed in the background).
    isPowered() {
        this._refreshPowered();
        return this._poweredCache;
    }

    _refreshPowered() {
        if (this._poweredRefreshing) return;
        let path = this._getAdapterPath();
        if (!path) return;
        this._poweredRefreshing = true;
        Gio.DBus.system.call(
            BLUEZ_NAME, path, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.bluez.Adapter1', 'Powered']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 2000, null,
            (conn, res) => {
                this._poweredRefreshing = false;
                try {
                    let powered = conn.call_finish(res).recursiveUnpack()[0];
                    if (powered !== this._poweredCache) {
                        this._poweredCache = powered;
                        if (this.onPoweredChanged) this.onPoweredChanged(powered);
                    }
                } catch (e) { /* keep the previous cached value */ }
            });
    }

    // Turn the Bluetooth radio on or off.
    setPowered(on, callback) {
        let path = this._getAdapterPath();
        if (!path) { if (callback) callback(false); return; }
        Gio.DBus.system.call(
            BLUEZ_NAME, path, 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.bluez.Adapter1', 'Powered', new GLib.Variant('b', !!on)]),
            null, Gio.DBusCallFlags.NONE, 5000, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                    this._poweredCache = !!on;
                    if (this.onPoweredChanged) this.onPoweredChanged(!!on);
                    if (callback) callback(true);
                } catch (e) {
                    console.warn('MyNotch: BT power toggle failed', e.message);
                    if (callback) callback(false);
                }
            });
    }

    // Get the list of paired/connected devices (cached, refreshed in the background).
    getDevices() {
        this._refreshDevices();
        return this._devicesCache;
    }

    _refreshDevices() {
        if (this._refreshing) return;
        this._refreshing = true;
        Gio.DBus.system.call(
            BLUEZ_NAME, '/', 'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects', null, null,
            Gio.DBusCallFlags.NONE, 2000, null,
            (conn, res) => {
                this._refreshing = false;
                try {
                    let result = conn.call_finish(res);
                    let next = this._parseDevices(result);
                    let changed = this._signature(next) !== this._signature(this._devicesCache);
                    this._devicesCache = next;
                    if (changed && this.onDevicesChanged) this.onDevicesChanged(next);
                } catch (e) { /* keep the previous cached value */ }
            });
    }

    _signature(list) {
        return list.map(d => `${d.name}:${d.connected ? 1 : 0}:${d.percentage}`).sort().join('|');
    }

    _parseDevices(result) {
        let list = [];
        let [objects] = result.recursiveUnpack();
        for (let [path, ifaces] of Object.entries(objects)) {
            let dev = ifaces['org.bluez.Device1'];
            if (!dev) continue;
            let connected = dev.Connected === true;
            let paired = dev.Paired === true;
            if (!connected && !paired) continue;

            let battery = ifaces['org.bluez.Battery1'];
            let icon = this._iconFor(dev.Icon, dev.UUIDs || []);
            list.push({
                name: dev.Alias || dev.Name || 'Bluetooth Device',
                type: this._typeFor(dev.Icon, dev.UUIDs || []),
                percentage: battery && Number.isFinite(battery.Percentage) ? Math.round(battery.Percentage) : null,
                icon,
                address: dev.Address || path,
                dbusPath: path,
                connected,
            });
        }
        // Sort: connected devices first, then alphabetically by name.
        return list.sort((a, b) => {
            if (a.connected !== b.connected) return a.connected ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    _typeFor(iconName, uuids) {
        let icon = iconName || '';
        let uuidText = uuids.join(' ').toLowerCase();
        if (icon.includes('audio') || uuidText.includes('110b') || uuidText.includes('110e') || uuidText.includes('1108'))
            return 'Audio Device';
        if (icon.includes('mouse')) return 'Mouse';
        if (icon.includes('keyboard')) return 'Keyboard';
        if (icon.includes('phone')) return 'Phone';
        if (icon.includes('tablet')) return 'Tablet';
        return 'Bluetooth Device';
    }

    _iconFor(iconName, uuids) {
        let type = this._typeFor(iconName, uuids);
        if (type === 'Audio Device') return 'audio-headset-symbolic';
        if (type === 'Mouse') return 'input-mouse-symbolic';
        if (type === 'Keyboard') return 'input-keyboard-symbolic';
        if (type === 'Phone') return 'phone-symbolic';
        if (type === 'Tablet') return 'input-tablet-symbolic';
        return 'bluetooth-active-symbolic';
    }

    // Connect or disconnect a device.
    setConnected(dbusPath, connect, callback) {
        if (!dbusPath) { if (callback) callback(false, 'no path'); return; }
        Gio.DBus.system.call(
            BLUEZ_NAME, dbusPath, 'org.bluez.Device1',
            connect ? 'Connect' : 'Disconnect',
            null, null, Gio.DBusCallFlags.NONE, 15000, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                    if (callback) callback(true, null);
                } catch (e) {
                    console.error(`MyNotch: Bluetooth ${connect ? 'connect' : 'disconnect'} failed`, e);
                    if (callback) callback(false, e.message || String(e));
                }
            });
    }
}
