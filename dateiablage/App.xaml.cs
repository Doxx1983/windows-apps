using System;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;

namespace Dateiablage;

public partial class App : Application
{
    const int HotkeyId = 1;
    const uint ModAlt = 0x1, ModCtrl = 0x2, ModNoRepeat = 0x4000, VkD = 0x44;
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "Dateiablage";
    const string ShowEventName = "Dateiablage.Zeigen";

    public static bool Dark { get; private set; }

    Mutex? _mutex;
    EventWaitHandle? _showSignal;
    HwndSource? _msg;
    System.Windows.Forms.NotifyIcon? _tray;
    System.Windows.Forms.ToolStripMenuItem? _autostart;
    MainWindow? _main;
    Store? _store;
    volatile bool _exiting;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _mutex = new Mutex(true, "Dateiablage.Einzelinstanz", out bool created);
        if (!created)
        {
            // Läuft schon: dort das Fenster zeigen.
            try
            {
                Native.AllowSetForegroundWindow(-1);
                EventWaitHandle.OpenExisting(ShowEventName).Set();
            }
            catch { }
            Shutdown();
            return;
        }

        _showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        new Thread(() =>
        {
            while (_showSignal.WaitOne() && !_exiting)
                Dispatcher.BeginInvoke(new Action(ShowMain));
        }) { IsBackground = true }.Start();

        ApplyTheme();
        _store = new Store();
        _main = new MainWindow(_store);

        var p = new HwndSourceParameters("DateiablageMsg") { ParentWindow = new IntPtr(-3), Width = 0, Height = 0 };
        _msg = new HwndSource(p);
        _msg.AddHook(WndProc);

        CreateTray();
        if (!Native.RegisterHotKey(_msg.Handle, HotkeyId, ModCtrl | ModAlt | ModNoRepeat, VkD))
            _tray!.ShowBalloonTip(5000, "Dateiablage", "Strg+Alt+D ist schon belegt.", System.Windows.Forms.ToolTipIcon.Warning);

        if (_store.LoadWarning != null)
            MessageBox.Show(_store.LoadWarning, "Dateiablage", MessageBoxButton.OK, MessageBoxImage.Warning);

        if (!e.Args.Contains("--tray")) ShowMain();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _exiting = true;
        if (_msg != null)
        {
            Native.UnregisterHotKey(_msg.Handle, HotkeyId);
            _msg.Dispose();
        }
        _tray?.Dispose();
        _showSignal?.Set();
        _mutex?.Dispose();
        base.OnExit(e);
    }

    // ---------- Design: Hell/Dunkel nach Windows-Einstellung ----------

    void ApplyTheme()
    {
        bool light = true;
        try
        {
            light = (int)(Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                                            "AppsUseLightTheme", 1) ?? 1) != 0;
        }
        catch { }
        Dark = !light;
        if (light) return;
        void Set(string k, string hex) => Resources[k] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        Set("Bg", "#0F1115"); Set("Surface", "#171A21"); Set("Surface2", "#1F232C"); Set("Text", "#E7E9EE");
        Set("Muted", "#98A2B3"); Set("Line", "#2B303B"); Set("Accent", "#8196FF"); Set("AccentSoft", "#242C52");
    }

    // ---------- Tray ----------

    void CreateTray()
    {
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("Öffnen (Strg+Alt+D)", null, (_, _) => ShowMain());
        _autostart = new System.Windows.Forms.ToolStripMenuItem("Mit Windows starten") { Checked = IsAutostart() };
        _autostart.Click += (_, _) => { SetAutostart(!_autostart.Checked); _autostart.Checked = IsAutostart(); };
        menu.Items.Add(_autostart);
        menu.Items.Add("Beenden", null, (_, _) => Quit());

        System.Drawing.Icon icon;
        try { icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? System.Drawing.SystemIcons.Application; }
        catch { icon = System.Drawing.SystemIcons.Application; }

        _tray = new System.Windows.Forms.NotifyIcon { Icon = icon, Text = "Dateiablage", Visible = true, ContextMenuStrip = menu };
        _tray.MouseClick += (_, a) => { if (a.Button == System.Windows.Forms.MouseButtons.Left) ShowMain(); };
    }

    void Quit()
    {
        _main?.SaveBounds();
        if (_main != null) _main.AllowClose = true;
        Shutdown();
    }

    static bool IsAutostart()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey);
        return k?.GetValue(RunName) != null;
    }

    static void SetAutostart(bool on)
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey, true);
        if (k == null) return;
        if (on) k.SetValue(RunName, "\"" + Environment.ProcessPath + "\" --tray");
        else k.DeleteValue(RunName, false);
    }

    // ---------- Fenster ----------

    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == Native.WM_HOTKEY && wParam.ToInt32() == HotkeyId)
        {
            if (_main!.IsVisible && _main.IsActive) _main.Hide();
            else ShowMain();
            handled = true;
        }
        return IntPtr.Zero;
    }

    void ShowMain()
    {
        if (_main == null) return;
        if (_main.WindowState == WindowState.Minimized) _main.WindowState = WindowState.Normal;
        _main.ShowAndFocus();
    }
}
