# MyNSnotch

> Personal notch extension for GNOME Shell 48 — by [Quansu](https://github.com/prodragon2like-maker)

A lightweight "dynamic island" / notch for GNOME Shell that packs music, notifications, system stats, calendar, and wallpaper controls into a single bar at the top of your screen.

---

## ✨ Features

### 🎵 Music (MPRIS)
- Now-playing track title + artist shown right on the pill
- Spinning vinyl animation while playing, stops on pause
- Album art auto-fetched from MPRIS (local files + HTTP)
- Draggable timeline, scroll to seek ±5s
- Controls: play/pause, next, prev, shuffle, loop
- Volume knob with scroll-to-adjust

### 🔔 Notifications
- List of active notifications with per-item dismiss
- "Clear all" button
- **Notification peek**: floating banner on new notifications, auto-hides
- Badge count on the tab label

### 💻 Tray (System)
- CPU / RAM / Disk / Network (down/up) — realtime ring meters
- Volume knob
- Toggles: WiFi, Focus (DND), Dark mode
- Battery card: percentage + charging state
- Bluetooth card: power toggle, paired/connected device list, per-device battery, click to connect/disconnect

### 📅 Calendar
- Date strip (7 days, scroll to navigate)
- Event agenda read from `org.gnome.Shell.CalendarServer`
- "Today" button

### 🖼️ Wallpaper
- Folder picker (uses `zenity`)
- Thumbnail grid, click to set wallpaper
- **Auto slideshow**: rotate every N minutes, optional shuffle

### 🎨 Appearance
- **Accent color** — every widget recolors on change
- **Surface color** + **opacity**
- **Text color** primary / secondary
- **Font scale** for UI and peek independently
- **Blur / Liquid Glass**: 4 presets (Liquid, Frosted, Clear, Acrylic) with separate blur radius for pill and dashboard
- **Island mode**: detach the notch from the top edge and float it
- Custom corner radius
- Hover / click to expand, configurable delays

### ⌨️ Controls
- **Hover** the pill → expands after `expandDelay` ms
- **Click** the pill → expands (if enabled)
- **Scroll on tab strip** → switch tabs
- **Scroll on knob / timeline / calendar strip** → adjust value
- **Power button** (top right) → menu: Lock / Logout / Suspend / Restart / Shutdown

---

## 📦 Installation

### Requirements
- GNOME Shell **48**
- These commands must be in `$PATH` (only needed for the corresponding feature):

| Command | Used for |
|---------|----------|
| `wpctl` (PipeWire) or `pactl` (PulseAudio) | Volume control |
| `brightnessctl` | Brightness control |
| `nmcli` | WiFi toggle |
| `zenity` | Wallpaper folder picker |

### Fedora

```bash
# zenity — graphical dialogs (wallpaper folder picker)
sudo dnf install zenity

# pipewire-utils — provides wpctl (volume control)
sudo dnf install pipewire-utils

# brightnessctl — screen brightness control
sudo dnf install brightnessctl

# NetworkManager — provides nmcli (WiFi toggle)
sudo dnf install NetworkManager
```

### Ubuntu / Debian / Linux Mint / Pop!_OS

```bash
# zenity — graphical dialogs (wallpaper folder picker)
sudo apt install zenity

# brightnessctl — screen brightness control
sudo apt install brightnessctl

# network-manager — provides nmcli (WiFi toggle)
sudo apt install network-manager

# Volume control uses pactl (pulseaudio-utils) or wpctl (pipewire-bin),
# both are preinstalled on modern Ubuntu/Debian. If wpctl is missing:
sudo apt install pipewire-bin
```

### Arch / Manjaro / EndeavourOS

```bash
# zenity — graphical dialogs (wallpaper folder picker)
sudo pacman -S zenity

# brightnessctl — screen brightness control
sudo pacman -S brightnessctl

# networkmanager — provides nmcli (WiFi toggle)
sudo pacman -S networkmanager

# pipewire — provides wpctl (volume control)
sudo pacman -S pipewire
```

### openSUSE

```bash
# zenity — graphical dialogs (wallpaper folder picker)
sudo zypper install zenity

# brightnessctl — screen brightness control
sudo zypper install brightnessctl

# NetworkManager — provides nmcli (WiFi toggle)
sudo zypper install NetworkManager

# pipewire-utils — provides wpctl (volume control)
sudo zypper install pipewire-utils
```

> Extension still runs without these — only the corresponding feature will be disabled.

### Install the extension

**Option A — Clone from GitHub (recommended)**

```bash
git clone https://github.com/prodragon2like-maker/MyNSnotch.git
cp -r MyNSnotch/mynotch@local ~/.local/share/gnome-shell/extensions/
```

**Option B — Install from zip**

1. Download the latest `.zip` from [Releases](https://github.com/prodragon2like-maker/MyNSnotch/releases)
2. Open the **Extensions** app → click **Install…** → pick the zip
3. Log out and back in (required on Wayland)

**Enable it**

```bash
gnome-extensions enable mynotch@local
```

---

## ⚙️ Configuration

Open the **Extensions** app → click the ⚙ icon next to **NSnotch**, or run:

```bash
gnome-extensions prefs mynotch@local
```

Config file: `~/.config/mynotch/config.json`

Preferences pages:
- **Appearance** — accent, surface, text color, opacity, font scale
- **Layout** — pill/dashboard size, island mode
- **Behaviour** — hover/click expand, delays, notification peek
- **Tabs** — enable/disable tabs, per-tab options
- **Blur** — preset + blur radius
- **About** — info + config path

---

## 🐛 Troubleshooting

### Extension doesn't appear after install

```bash
ls ~/.local/share/gnome-shell/extensions/mynotch@local/
journalctl --user -f -o cat /usr/bin/gnome-shell
```

### Blur doesn't work
Blur uses `Shell.BlurEffect` — some older GPUs/drivers don't support it. Try disabling it in Preferences → **Blur**.

### Volume / brightness won't change

```bash
which wpctl brightnessctl nmcli
```
Install whatever is missing from the list above.

---

## 🔄 Updating

```bash
cd MyNSnotch
git pull
cp -r mynotch@local ~/.local/share/gnome-shell/extensions/
```
Then log out and back in.

---

## 🗑️ Uninstall

```bash
rm -rf ~/.local/share/gnome-shell/extensions/mynotch@local
rm -rf ~/.config/mynotch
rm -rf ~/.cache/mynotch
```

---

## 📄 License

GPL-2.0-or-later — see [LICENSE](LICENSE).

---

## 👤 Author

**Quansu** — [@prodragon2like-maker](https://github.com/prodragon2like-maker)

If this extension is useful, drop a ⭐ on GitHub.
