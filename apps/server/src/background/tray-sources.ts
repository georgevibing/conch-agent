/**
 * Conch in the menu bar, the tray or the panel (ADR 0029): the source of a
 * tiny helper for each computer, written by Conch and built (or simply run)
 * there. Nothing is downloaded and there's no app store: a Mac compiles the
 * Swift below with its own command-line tools, Windows runs the PowerShell
 * with its own NotifyIcon, Linux runs the Python with AppIndicator.
 *
 * Every helper does the same few things:
 * - every few seconds it asks the gateway on this computer how things are
 *   (`GET /api/tray/status`, loopback only, with the token in its own file);
 * - it shows whether Conch is running, and a dot when something needs you;
 * - Open Conch, Start Conch, Quit Conch, Always on… and Hide from here.
 *
 * Anything that needs you to confirm it's you (turning Always on on or off)
 * opens the page instead: the helper never holds more power than a person
 * sitting at the computer pressing the same buttons in Conch.
 */

export interface TraySpec {
  /** Where Conch answers: `http://localhost:4317`. */
  url: string;
  /**
   * Where the helper asks how things are, when that's best not `url`: the
   * loopback address by number (`http://127.0.0.1:4317`). Pages still open at `url`.
   */
  ask?: string;
  /** The file holding the helper's token (0600). */
  tokenFile: string;
  /** Starts Conch when it isn't running (the computer's own way, or the launcher). */
  startScript: string;
  /** The pearl, as a PNG (Linux) or ICO (Windows). */
  icon?: string;
}

const swiftString = (value: string) =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;

/** macOS: an NSStatusItem with a template pearl that suits light and dark menu bars. */
export function swiftSource(spec: TraySpec): string {
  return `// Conch in the menu bar (ADR 0029). Written by Conch; changes here don't last.
import AppKit

let base = ${swiftString(spec.url)}
let tokenFile = ${swiftString(spec.tokenFile)}
let startScript = ${swiftString(spec.startScript)}

struct Info { var name = "Conch"; var alwaysOn = false; var approvals = 0; var devices = 0 }

final class Menu: NSObject, NSApplicationDelegate, NSMenuDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  var info: Info?
  var timer: Timer?
  var starting = false

  func applicationDidFinishLaunching(_ note: Notification) {
    item.button?.image = pearl(dot: false)
    item.button?.setAccessibilityLabel("Conch")
    let menu = NSMenu()
    menu.delegate = self
    item.menu = menu
    refresh()
    timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() }
  }

  /** The pearl as a template image: a ring with a soft fill, and a dot when something needs you. */
  func pearl(dot: Bool) -> NSImage {
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
      let ring = NSBezierPath(ovalIn: rect.insetBy(dx: 2.5, dy: 2.5))
      NSColor.black.withAlphaComponent(0.35).setFill()
      ring.fill()
      ring.lineWidth = 1.5
      NSColor.black.setStroke()
      ring.stroke()
      let shine = NSBezierPath(ovalIn: NSRect(x: 5.5, y: 9.5, width: 4, height: 3))
      NSColor.black.setFill()
      shine.fill()
      if dot {
        NSBezierPath(ovalIn: NSRect(x: 12, y: 12, width: 6, height: 6)).fill()
      }
      return true
    }
    image.isTemplate = true
    return image
  }

  func token() -> String {
    (try? String(contentsOfFile: tokenFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  func request(_ path: String, method: String = "GET", done: @escaping (Data?) -> Void) {
    guard let url = URL(string: base + path) else { return done(nil) }
    var req = URLRequest(url: url, timeoutInterval: 2)
    req.httpMethod = method
    req.setValue(token(), forHTTPHeaderField: "X-Conch-Tray")
    URLSession.shared.dataTask(with: req) { data, response, _ in
      let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
      DispatchQueue.main.async { done(ok ? data : nil) }
    }.resume()
  }

  func refresh() {
    request("/api/tray/status") { data in
      if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        self.info = Info(
          name: json["name"] as? String ?? "Conch",
          alwaysOn: json["alwaysOn"] as? Bool ?? false,
          approvals: json["approvals"] as? Int ?? 0,
          devices: json["devices"] as? Int ?? 0)
        self.starting = false
      } else {
        self.info = nil
      }
      let needs = (self.info?.approvals ?? 0) + (self.info?.devices ?? 0) > 0
      self.item.button?.image = self.pearl(dot: needs)
      self.item.button?.toolTip = self.info == nil ? "Conch isn’t running" : needs ? "Conch needs you" : "Conch is running"
    }
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    func add(_ title: String, _ action: Selector?, key: String = "") {
      let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
      entry.target = self
      entry.isEnabled = action != nil
      menu.addItem(entry)
    }
    if let info {
      add(info.alwaysOn ? "\\(info.name) is running · Always on" : "\\(info.name) is running", nil)
      if info.approvals > 0 { add(info.approvals == 1 ? "1 question is waiting for you" : "\\(info.approvals) questions are waiting for you", #selector(open)) }
      if info.devices > 0 { add(info.devices == 1 ? "A new device wants to sign in" : "\\(info.devices) devices want to sign in", #selector(openDevices)) }
      menu.addItem(.separator())
      add("Open Conch", #selector(open), key: "o")
      add(info.alwaysOn ? "Always on: On…" : "Always on: Off…", #selector(openAlwaysOn))
      menu.addItem(.separator())
      add("Quit Conch", #selector(quitConch))
    } else {
      add(starting ? "Starting Conch…" : "Conch isn’t running", nil)
      menu.addItem(.separator())
      add("Start Conch", starting ? nil : #selector(start))
    }
    add("Hide from the menu bar", #selector(hide))
  }

  func openPage(_ path: String) {
    if let url = URL(string: base + path) { NSWorkspace.shared.open(url) }
  }

  @objc func open() { openPage("/") }
  @objc func openDevices() { openPage("/?open=devices") }
  @objc func openAlwaysOn() { openPage("/?open=background") }

  @objc func start() {
    starting = true
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/sh")
    task.arguments = [startScript]
    try? task.run()
  }

  @objc func quitConch() {
    request("/api/tray/quit", method: "POST") { data in
      // A chat is still working (or it was refused): the page says why.
      if data == nil { self.openPage("/?open=background") }
      self.refresh()
    }
  }

  @objc func hide() {
    request("/api/tray/hide", method: "POST") { _ in NSApp.terminate(nil) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.terminate(nil) }
  }
}

let app = NSApplication.shared
let delegate = Menu()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
`;
}

const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Windows: a NotifyIcon in the tray, from PowerShell and Windows Forms (no install).
 *
 * Four things make it sit in the tray like anything else there:
 * - The file starts with a byte-order mark. Windows PowerShell reads one
 *   without it in the computer's old code page, and "isn’t" comes out garbled.
 * - It asks Conch by number (`ask`). `localhost` is tried as `::1` first, and
 *   Windows takes two seconds to give up on that: longer than the helper waits.
 * - It asks in the background. Windows also takes two seconds to say nothing
 *   is listening, and a menu on the thread that waits would freeze with it.
 * - The menu is Windows' own, put together as it opens, in a process that
 *   says it draws at the screen's scale, so it's sharp, and dark when Windows is.
 */
export function powershellSource(spec: TraySpec): string {
  return `\uFEFF${[
    '# Conch in the tray (ADR 0029). Written by Conch; changes here don’t last.',
    'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
    '# Before any window: draw at the screen’s own scale, and let menus follow Windows into the dark.',
    'try {',
    "  Add-Type -Namespace Conch -Name Native -MemberDefinition @'",
    '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '[DllImport("uxtheme.dll", EntryPoint = "#135")] public static extern int SetPreferredAppMode(int mode);',
    '[DllImport("uxtheme.dll", EntryPoint = "#136")] public static extern void FlushMenuThemes();',
    "'@",
    '  [void][Conch.Native]::SetProcessDPIAware()',
    '  if ([Environment]::OSVersion.Version.Build -ge 18362) { [void][Conch.Native]::SetPreferredAppMode(1); [Conch.Native]::FlushMenuThemes() }',
    '} catch {}',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    `$base = ${ps(spec.url)}`,
    `$api = ${ps(spec.ask ?? spec.url)}`,
    `$tokenFile = ${ps(spec.tokenFile)}`,
    `$startScript = ${ps(spec.startScript)}`,
    `$iconFile = ${ps(spec.icon ?? '')}`,
    '$icon = New-Object System.Windows.Forms.NotifyIcon',
    'if ($iconFile -and (Test-Path $iconFile)) { $icon.Icon = New-Object System.Drawing.Icon($iconFile) } else { $icon.Icon = [System.Drawing.SystemIcons]::Application }',
    '$icon.Text = "Conch"',
    '$menu = New-Object System.Windows.Forms.ContextMenu',
    '$icon.ContextMenu = $menu',
    '$icon.Visible = $true',
    '$script:info = $null',
    '$script:waited = 0',
    'function Token { if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { "" } }',
    '# For a press in the menu, when Conch is there to answer at once.',
    'function Ask($path, $method = "GET") {',
    '  try { Invoke-RestMethod -Uri ($api + $path) -Method $method -Headers @{ "X-Conch-Tray" = (Token) } -TimeoutSec 2 } catch { $null }',
    '}',
    'function OpenPage($path) { Start-Process ($base + $path) }',
    'function Add($text, $action) {',
    '  $entry = New-Object System.Windows.Forms.MenuItem($text)',
    '  if ($action) { $entry.add_Click($action) } else { $entry.Enabled = $false }',
    '  [void]$menu.MenuItems.Add($entry)',
    '}',
    'function Build {',
    '  $menu.MenuItems.Clear()',
    '  $i = $script:info',
    '  if ($i) {',
    '    Add ($(if ($i.alwaysOn) { "$($i.name) is running · Always on" } else { "$($i.name) is running" })) $null',
    '    if ($i.approvals -gt 0) { Add "$($i.approvals) waiting for you" { OpenPage "/" } }',
    '    if ($i.devices -gt 0) { Add "A new device wants to sign in" { OpenPage "/?open=devices" } }',
    '    [void]$menu.MenuItems.Add("-")',
    '    Add "Open Conch" { OpenPage "/" }',
    '    Add ($(if ($i.alwaysOn) { "Always on: On…" } else { "Always on: Off…" })) { OpenPage "/?open=background" }',
    '    [void]$menu.MenuItems.Add("-")',
    '    Add "Quit Conch" { if (-not (Ask "/api/tray/quit" "POST")) { OpenPage "/?open=background" } }',
    '  } else {',
    '    Add "Conch isn’t running" $null',
    '    [void]$menu.MenuItems.Add("-")',
    '    Add "Start Conch" { Start-Process -WindowStyle Hidden -FilePath $startScript }',
    '  }',
    '  Add "Hide from the tray" { [void](Ask "/api/tray/hide" "POST"); $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() }',
    '}',
    '# Put together as it opens, from the last answer: never changed while it’s showing.',
    '$menu.add_Popup({ Build })',
    '# How things are, asked in the background. The answer has to come back to this thread (PowerShell',
    '# only runs here), and nothing else says so: a tray icon and its menu aren’t Windows Forms controls.',
    '[System.Threading.SynchronizationContext]::SetSynchronizationContext((New-Object System.Windows.Forms.WindowsFormsSynchronizationContext))',
    '$client = New-Object System.Net.WebClient',
    '$client.Encoding = [System.Text.Encoding]::UTF8',
    '$client.Proxy = $null',
    '$client.add_DownloadStringCompleted({',
    '  param($s, $e)',
    '  $script:info = $(if ($e.Cancelled -or $e.Error) { $null } else { try { $e.Result | ConvertFrom-Json } catch { $null } })',
    '  $needs = $script:info -and (($script:info.approvals + $script:info.devices) -gt 0)',
    '  $icon.Text = $(if (-not $script:info) { "Conch isn’t running" } elseif ($needs) { "Conch needs you" } else { "Conch is running" })',
    '})',
    'function Refresh {',
    '  # Still waiting for the last answer: give up on one that never comes.',
    '  if ($client.IsBusy) { $script:waited++; if ($script:waited -ge 3) { $client.CancelAsync() }; return }',
    '  $script:waited = 0',
    '  $client.Headers.Set("X-Conch-Tray", (Token))',
    '  $client.DownloadStringAsync([Uri]($api + "/api/tray/status"))',
    '}',
    '$icon.add_MouseClick({ param($s, $e) if ($e.Button -eq "Left") { OpenPage "/" } })',
    '$timer = New-Object System.Windows.Forms.Timer',
    '$timer.Interval = 3000',
    '$timer.add_Tick({ Refresh })',
    '$timer.Start()',
    'Refresh',
    '[System.Windows.Forms.Application]::Run()',
    '',
  ].join('\r\n')}`;
}

const py = (value: string) => JSON.stringify(value);

/** Linux: an AppIndicator in the panel, from Python's GObject bindings (when the desktop has them). */
export function pythonSource(spec: TraySpec): string {
  return `#!/usr/bin/env python3
# Conch in the panel (ADR 0029). Written by Conch; changes here don't last.
import json, os, subprocess, urllib.request, webbrowser
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk
try:
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as Indicator
except (ValueError, ImportError):
    gi.require_version("AppIndicator3", "0.1")
    from gi.repository import AppIndicator3 as Indicator

BASE = ${py(spec.url)}
TOKEN_FILE = ${py(spec.tokenFile)}
START = ${py(spec.startScript)}
ICON = ${py(spec.icon ?? 'applications-system')}

def token():
    try:
        with open(TOKEN_FILE) as f:
            return f.read().strip()
    except OSError:
        return ""

def ask(path, method="GET"):
    req = urllib.request.Request(BASE + path, method=method, headers={"X-Conch-Tray": token()})
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            return json.loads(r.read() or b"{}")
    except Exception:
        return None

indicator = Indicator.Indicator.new("conch", ICON, Indicator.IndicatorCategory.APPLICATION_STATUS)
indicator.set_status(Indicator.IndicatorStatus.ACTIVE)
indicator.set_title("Conch")

def item(menu, text, action=None):
    entry = Gtk.MenuItem(label=text)
    entry.set_sensitive(action is not None)
    if action:
        entry.connect("activate", lambda _w: action())
    menu.append(entry)

def build(info):
    menu = Gtk.Menu()
    if info:
        name = info.get("name", "Conch")
        item(menu, f"{name} is running · Always on" if info.get("alwaysOn") else f"{name} is running")
        if info.get("approvals"):
            item(menu, f"{info['approvals']} waiting for you", lambda: webbrowser.open(BASE + "/"))
        if info.get("devices"):
            item(menu, "A new device wants to sign in", lambda: webbrowser.open(BASE + "/?open=devices"))
        menu.append(Gtk.SeparatorMenuItem())
        item(menu, "Open Conch", lambda: webbrowser.open(BASE + "/"))
        item(menu, "Always on: On…" if info.get("alwaysOn") else "Always on: Off…", lambda: webbrowser.open(BASE + "/?open=background"))
        menu.append(Gtk.SeparatorMenuItem())
        item(menu, "Quit Conch", lambda: ask("/api/tray/quit", "POST") or webbrowser.open(BASE + "/?open=background"))
    else:
        item(menu, "Conch isn’t running")
        menu.append(Gtk.SeparatorMenuItem())
        item(menu, "Start Conch", lambda: subprocess.Popen(["/bin/sh", START], start_new_session=True))
    item(menu, "Hide from the panel", lambda: (ask("/api/tray/hide", "POST"), Gtk.main_quit()))
    menu.show_all()
    indicator.set_menu(menu)

def refresh():
    build(ask("/api/tray/status"))
    return True

refresh()
GLib.timeout_add_seconds(3, refresh)
Gtk.main()
`;
}
