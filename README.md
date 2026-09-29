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

Ubuntu / Debian / Linux Mint / Pop!_OS

# zenity — graphical dialogs (wallpaper folder picker)
sudo apt install zenity

# brightnessctl — screen brightness control
sudo apt install brightnessctl

# network-manager — provides nmcli (WiFi toggle)
sudo apt install network-manager

# Volume control uses pactl (pulseaudio-utils) or wpctl (pipewire-bin),
# both are preinstalled on modern Ubuntu/Debian. If wpctl is missing:
sudo apt install pipewire-bin


Arch / Manjaro / EndeavourOS

# zenity — graphical dialogs (wallpaper folder picker)
sudo pacman -S zenity

# brightnessctl — screen brightness control
sudo pacman -S brightnessctl

# networkmanager — provides nmcli (WiFi toggle)
sudo pacman -S networkmanager

# pipewire — provides wpctl (volume control)
sudo pacman -S pipewire


> Extension still runs without these — only the corresponding feature will be disabled.
