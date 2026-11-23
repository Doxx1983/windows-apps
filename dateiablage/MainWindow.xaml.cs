using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace Dateiablage;

public partial class MainWindow : Window
{
    const string Hint = "Enter öffnen · Strg+Enter im Ordner · Rechtsklick: mehr";

    readonly Store _store;
    readonly DispatcherTimer _statusTimer = new() { Interval = TimeSpan.FromSeconds(4) };
    public bool AllowClose;

    public MainWindow(Store store)
    {
        InitializeComponent();
        _store = store;

        var b = store.Data.Bounds;
        if (b is { Length: 4 } && b[2] >= MinWidth && b[3] >= MinHeight
            && b[0] < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 100
            && b[1] < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 100
            && b[0] + b[2] > SystemParameters.VirtualScreenLeft + 100 && b[1] >= SystemParameters.VirtualScreenTop - 10)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = b[0]; Top = b[1]; Width = b[2]; Height = b[3];
        }

        Status.Text = Hint;
        _statusTimer.Tick += (_, _) => { _statusTimer.Stop(); Status.Text = Hint; };

        Groups.SelectionChanged += (_, _) =>
        {
            if (Search.Text.Length > 0) Search.Text = "";   // löst RefreshEntries aus
            else RefreshEntries();
        };
        Search.TextChanged += (_, _) => RefreshEntries();
        PreviewKeyDown += OnKey;
        PreviewTextInput += OnTextInput;
        DragOver += OnDragOver;
        Drop += OnDrop;
        Groups.ContextMenuOpening += GroupMenu;
        Entries.ContextMenuOpening += EntryMenu;
        Groups.ContextMenu = new ContextMenu();
        Entries.ContextMenu = new ContextMenu();
        IsVisibleChanged += (_, _) => { if (!IsVisible) SaveBounds(); };

        RefreshGroups(_store.Data.Groups.ElementAtOrDefault(_store.Data.SelectedGroup));
    }

    Group? CurrentGroup => Groups.SelectedItem as Group;
    Entry? CurrentEntry => Entries.SelectedItem as Entry;
    bool Searching => Search.Text.Trim().Length > 0;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        if (App.Dark) Native.DarkTitleBar(new WindowInteropHelper(this).Handle);
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (!AllowClose) { e.Cancel = true; Hide(); }   // Schließen = in den Infobereich
        base.OnClosing(e);
    }

    public void ShowAndFocus()
    {
        RefreshEntries(CurrentEntry);   // „nicht gefunden“ neu prüfen
        Show();
        Activate();
        Native.SetForegroundWindow(new WindowInteropHelper(this).Handle);
        Search.SelectAll();
        Search.Focus();
        Keyboard.Focus(Search);
    }

    public void SaveBounds()
    {
        var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        if (!r.IsEmpty && r.Width > 0) _store.Data.Bounds = new[] { r.Left, r.Top, r.Width, r.Height };
        _store.Data.SelectedGroup = Math.Max(0, _store.Data.Groups.IndexOf(CurrentGroup!));
        try { _store.Save(); } catch { }
    }

    // ---------- Anzeige ----------

    void RefreshGroups(Group? select = null)
    {
        var keep = select ?? CurrentGroup;
        Groups.ItemsSource = _store.Data.Groups.ToList();
        Groups.SelectedItem = keep != null && _store.Data.Groups.Contains(keep) ? keep : _store.Data.Groups.FirstOrDefault();
    }

    void RefreshEntries(Entry? select = null)
    {
        bool searching = Searching;
        var list = searching ? _store.Search(Search.Text) : CurrentGroup?.Entries.ToList() ?? new List<Entry>();
        foreach (var en in list) { en.ShowGroup = searching; en.Check(); }
        Entries.ItemsSource = list;
        Entries.SelectedItem = select != null && list.Contains(select) ? select : list.FirstOrDefault();
        if (Entries.SelectedItem != null) Entries.ScrollIntoView(Entries.SelectedItem);

        Empty.Visibility = list.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        Empty.Text = searching ? "Nichts gefunden." : "Dateien, Ordner oder Links hierher ziehen\noder unten hinzufügen.";
    }

    void Say(string text)
    {
        Status.Text = text;
        _statusTimer.Stop();
        _statusTimer.Start();
    }

    // ---------- Öffnen ----------

    void Open(Entry e, bool reveal)
    {
        e.Check();
        if (e.Missing)
        {
            var r = MessageBox.Show(this, $"„{e.Name}“ wurde nicht gefunden:\n{e.Target}\n\nWurde sie verschoben oder umbenannt? Neuen Ort auswählen?",
                                    "Dateiablage", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (r == MessageBoxResult.Yes) Relink(e);
            return;
        }
        try
        {
            if (reveal && !e.IsUrl) Process.Start("explorer.exe", $"/select,\"{e.Target}\"");
            else Process.Start(new ProcessStartInfo(e.Target) { UseShellExecute = true });
            Hide();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Konnte nicht geöffnet werden:\n" + ex.Message, "Dateiablage",
                            MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    void Relink(Entry e)
    {
        string? start = NearestFolder(e.Target);
        string? picked = null;
        bool folder = !e.IsUrl && (Directory.Exists(e.Target) || Path.GetExtension(e.Target).Length == 0);
        if (e.IsUrl)
        {
            picked = Prompt("Adresse ändern", "Webadresse:", e.Target);
            if (picked != null && !Store.IsUrl(picked)) { Say("Keine gültige Adresse (http… oder https…)."); return; }
        }
        else if (folder)
        {
            var d = new Microsoft.Win32.OpenFolderDialog { Title = "Neuen Ort für „" + e.Name + "“ wählen", InitialDirectory = start ?? "" };
            if (d.ShowDialog(this) == true) picked = d.FolderName;
        }
        else
        {
            var d = new Microsoft.Win32.OpenFileDialog { Title = "Neuen Ort für „" + e.Name + "“ wählen", InitialDirectory = start ?? "",
                                                         FileName = Path.GetFileName(e.Target) };
            if (d.ShowDialog(this) == true) picked = d.FileName;
        }
        if (string.IsNullOrWhiteSpace(picked)) return;
        e.Target = picked.Trim();
        _store.Save();
        RefreshEntries(e);
        Say("Neu zugeordnet.");
    }

    static string? NearestFolder(string path)
    {
        try
        {
            var d = Path.GetDirectoryName(path);
            while (!string.IsNullOrEmpty(d) && !Directory.Exists(d)) d = Path.GetDirectoryName(d);
            return string.IsNullOrEmpty(d) ? null : d;
        }
        catch { return null; }
    }

    void Entries_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is DependencyObject d && FindItem(d) != null && CurrentEntry is { } en) Open(en, false);
    }

    // ---------- Hinzufügen ----------

    void AddTargets(IEnumerable<string> targets, Group? into = null)
    {
        var g = into ?? CurrentGroup;
        if (g == null) return;
        var list = targets.ToList();
        var added = _store.Add(g, list);
        if (Searching) Search.Text = "";
        RefreshGroups(g);
        RefreshEntries(added.LastOrDefault());
        if (added.Count == 0) Say(list.Count == 1 ? "Ist schon in dieser Gruppe." : "Alles schon in dieser Gruppe.");
        else Say(added.Count == 1 ? $"„{added[0].Name}“ zu {g.Name} hinzugefügt." : $"{added.Count} Einträge zu {g.Name} hinzugefügt.");
    }

    /// <summary>Dateien/Ordner (Explorer) oder Webadresse (Browser) aus Drag & Drop bzw. Zwischenablage.</summary>
    static List<string>? TargetsFrom(IDataObject? d)
    {
        if (d == null) return null;
        try
        {
            if (d.GetDataPresent(DataFormats.FileDrop) && d.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0)
                return files.ToList();
            if (d.GetDataPresent(DataFormats.UnicodeText) && d.GetData(DataFormats.UnicodeText) is string t)
            {
                var line = t.Trim().Split('\n')[0].Trim();
                if (Store.IsUrl(line) && !line.Contains(' ')) return new List<string> { line };
            }
        }
        catch { }
        return null;
    }

    void OnDragOver(object sender, DragEventArgs e)
    {
        if (TargetsFrom(e.Data) == null) e.Effects = DragDropEffects.None;
        else e.Effects = (e.AllowedEffects & DragDropEffects.Link) != 0 ? DragDropEffects.Link : DragDropEffects.Copy;
        e.Handled = true;
    }

    void OnDrop(object sender, DragEventArgs e)
    {
        var t = TargetsFrom(e.Data);
        if (t == null) return;
        // Auf eine Gruppe links gezogen? Dann dorthin.
        Group? into = e.OriginalSource is DependencyObject d && FindItem(d)?.DataContext is Group g ? g : null;
        AddTargets(t, into);
        e.Handled = true;
        Activate();
    }

    void AddFiles_Click(object sender, RoutedEventArgs e)
    {
        var d = new Microsoft.Win32.OpenFileDialog { Title = "Dateien hinzufügen", Multiselect = true };
        if (d.ShowDialog(this) == true) AddTargets(d.FileNames);
    }

    void AddFolder_Click(object sender, RoutedEventArgs e)
    {
        var d = new Microsoft.Win32.OpenFolderDialog { Title = "Ordner hinzufügen", Multiselect = true };
        if (d.ShowDialog(this) == true) AddTargets(d.FolderNames);
    }

    static ListBoxItem? FindItem(DependencyObject? d)
    {
        while (d != null && d is not ListBoxItem)
            d = d is Visual or System.Windows.Media.Media3D.Visual3D ? VisualTreeHelper.GetParent(d) : LogicalTreeHelper.GetParent(d);
        return d as ListBoxItem;
    }

    // ---------- Bearbeiten ----------

    void RenameEntry(Entry e)
    {
        var n = Prompt("Umbenennen", "Anzeigename (die Datei selbst bleibt unverändert):", e.Name);
        if (string.IsNullOrEmpty(n)) return;
        e.Name = n;
        _store.Save();
        RefreshEntries(e);
    }

    void RemoveEntry(Entry e)
    {
        var list = (List<Entry>)Entries.ItemsSource;
        int i = list.IndexOf(e);
        _store.Remove(e);
        RefreshGroups();
        RefreshEntries();
        if (Entries.Items.Count > 0) Entries.SelectedIndex = Math.Min(Math.Max(i, 0), Entries.Items.Count - 1);
        Say($"„{e.Name}“ aus der Ablage entfernt (Datei bleibt erhalten).");
    }

    void ShiftEntry(Entry e, int delta)
    {
        if (Searching || e.Group == null) return;
        if (_store.Shift(e.Group.Entries, e, delta)) RefreshEntries(e);
    }

    void NewGroup_Click(object sender, RoutedEventArgs e) => NewGroup();

    void NewGroup()
    {
        var n = Prompt("Neue Gruppe", "Name der Gruppe:", "");
        if (string.IsNullOrEmpty(n)) return;
        RefreshGroups(_store.AddGroup(n));
    }

    void RenameGroup(Group g)
    {
        var n = Prompt("Gruppe umbenennen", "Name der Gruppe:", g.Name);
        if (string.IsNullOrEmpty(n)) return;
        g.Name = n;
        _store.Save();
        RefreshGroups(g);
    }

    void DeleteGroup(Group g)
    {
        if (g.Entries.Count > 0)
        {
            var r = MessageBox.Show(this, $"Gruppe „{g.Name}“ mit {g.Entries.Count} Einträgen aus der Ablage entfernen?\nDie Dateien selbst bleiben unverändert.",
                                    "Dateiablage", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (r != MessageBoxResult.Yes) return;
        }
        int i = _store.Data.Groups.IndexOf(g);
        _store.DeleteGroup(g);
        RefreshGroups(_store.Data.Groups[Math.Min(Math.Max(i, 0), _store.Data.Groups.Count - 1)]);
    }

    void ShiftGroup(Group g, int delta)
    {
        if (_store.Shift(_store.Data.Groups, g, delta)) RefreshGroups(g);
    }

    // ---------- Kontextmenüs ----------

    static MenuItem Item(string header, Action act, string? gesture = null, bool enabled = true)
    {
        var m = new MenuItem { Header = header, InputGestureText = gesture ?? "", IsEnabled = enabled };
        m.Click += (_, _) => act();
        return m;
    }

    void EntryMenu(object sender, ContextMenuEventArgs e)
    {
        var menu = Entries.ContextMenu!;
        menu.Items.Clear();
        if (FindItem(e.OriginalSource as DependencyObject) == null || CurrentEntry is not { } en) { e.Handled = true; return; }

        menu.Items.Add(Item("Öffnen", () => Open(en, false), "Enter"));
        if (!en.IsUrl) menu.Items.Add(Item("Im Ordner zeigen", () => Open(en, true), "Strg+Enter"));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("Umbenennen", () => RenameEntry(en), "F2"));
        menu.Items.Add(Item(en.IsUrl ? "Adresse ändern …" : "Neuen Ort zuordnen …", () => Relink(en)));

        var move = new MenuItem { Header = "Verschieben nach" };
        foreach (var g in _store.Data.Groups)
            move.Items.Add(Item(g.Name, () => { _store.MoveTo(en, g); RefreshGroups(); RefreshEntries(); Say($"Nach {g.Name} verschoben."); },
                                enabled: g != en.Group));
        menu.Items.Add(move);
        if (!Searching)
        {
            menu.Items.Add(Item("Nach oben", () => ShiftEntry(en, -1), "Alt+↑"));
            menu.Items.Add(Item("Nach unten", () => ShiftEntry(en, 1), "Alt+↓"));
        }
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("Aus der Ablage entfernen", () => RemoveEntry(en), "Strg+Entf"));
    }

    void GroupMenu(object sender, ContextMenuEventArgs e)
    {
        var menu = Groups.ContextMenu!;
        menu.Items.Clear();
        if (FindItem(e.OriginalSource as DependencyObject)?.DataContext is not Group g)
        {
            menu.Items.Add(Item("Neue Gruppe", NewGroup, "Strg+N"));
            return;
        }
        Groups.SelectedItem = g;
        menu.Items.Add(Item("Umbenennen", () => RenameGroup(g), "F2"));
        menu.Items.Add(Item("Nach oben", () => ShiftGroup(g, -1), "Alt+↑"));
        menu.Items.Add(Item("Nach unten", () => ShiftGroup(g, 1), "Alt+↓"));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("Gruppe löschen", () => DeleteGroup(g)));
        menu.Items.Add(new Separator());
        menu.Items.Add(Item("Neue Gruppe", NewGroup, "Strg+N"));
    }

    // ---------- Tastatur ----------

    void Move(int delta)
    {
        int n = Entries.Items.Count;
        if (n == 0) return;
        Entries.SelectedIndex = Math.Max(0, Math.Min(n - 1, Entries.SelectedIndex + delta));
        Entries.ScrollIntoView(Entries.SelectedItem);
    }

    void OnKey(object sender, KeyEventArgs e)
    {
        var mods = Keyboard.Modifiers;
        bool ctrl = (mods & ModifierKeys.Control) != 0, alt = (mods & ModifierKeys.Alt) != 0;
        var key = e.Key == Key.System ? e.SystemKey : e.Key;
        bool inGroups = Groups.IsKeyboardFocusWithin;
        var en = CurrentEntry;

        switch (key)
        {
            case Key.Up or Key.Down when alt:
                int d = key == Key.Up ? -1 : 1;
                if (inGroups) { if (CurrentGroup is { } g) ShiftGroup(g, d); }
                else if (en != null) ShiftEntry(en, d);
                e.Handled = true;
                break;
            case Key.Down when !inGroups: Move(1); e.Handled = true; break;
            case Key.Up when !inGroups: Move(-1); e.Handled = true; break;
            case Key.PageDown when !inGroups: Move(6); e.Handled = true; break;
            case Key.PageUp when !inGroups: Move(-6); e.Handled = true; break;
            case Key.Enter:
                if (en != null) Open(en, ctrl);
                e.Handled = true;
                break;
            case Key.F2:
                if (inGroups) { if (CurrentGroup is { } rg) RenameGroup(rg); }
                else if (en != null) RenameEntry(en);
                e.Handled = true;
                break;
            case Key.Delete when ctrl:
                if (en != null) RemoveEntry(en);
                e.Handled = true;
                break;
            case Key.Escape:
                if (Search.Text.Length > 0) Search.Text = "";
                else Hide();
                e.Handled = true;
                break;
            case Key.N when ctrl: NewGroup(); e.Handled = true; break;
            case Key.F when ctrl: Search.Focus(); Search.SelectAll(); e.Handled = true; break;
            case Key.V when ctrl:
                var t = TargetsFrom(Clipboard.GetDataObject());
                if (t != null) { AddTargets(t); e.Handled = true; }
                break;
            case >= Key.D1 and <= Key.D9 when ctrl:
                int gi = key - Key.D1;
                if (gi < _store.Data.Groups.Count) Groups.SelectedItem = _store.Data.Groups[gi];
                e.Handled = true;
                break;
        }
    }

    // Einfach lostippen = suchen, auch wenn gerade die Liste den Fokus hat.
    void OnTextInput(object sender, TextCompositionEventArgs e)
    {
        if (Search.IsKeyboardFocusWithin || string.IsNullOrEmpty(e.Text) || char.IsControl(e.Text[0])) return;
        Search.Focus();
        Search.Text += e.Text;
        Search.CaretIndex = Search.Text.Length;
        e.Handled = true;
    }

    // ---------- Eingabedialog ----------

    string? Prompt(string title, string label, string value)
    {
        Brush R(string k) => (Brush)Application.Current.Resources[k];
        var w = new Window
        {
            Title = title, Owner = this, SizeToContent = SizeToContent.WidthAndHeight, ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, ShowInTaskbar = false,
            Background = R("Bg"), FontFamily = FontFamily, FontSize = 13
        };
        var tb = new TextBox
        {
            Text = value, Width = 340, Padding = new Thickness(8, 6, 8, 6), Margin = new Thickness(0, 6, 0, 14),
            Background = R("Surface"), Foreground = R("Text"), BorderBrush = R("Line"), CaretBrush = R("Text")
        };
        var style = (Style)Application.Current.Resources["Flat"];
        var ok = new Button { Content = "OK", IsDefault = true, MinWidth = 90, Style = style, Margin = new Thickness(0, 0, 8, 0) };
        var cancel = new Button { Content = "Abbrechen", IsCancel = true, MinWidth = 90, Style = style };
        ok.Click += (_, _) => w.DialogResult = true;

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(ok);
        buttons.Children.Add(cancel);
        var panel = new StackPanel { Margin = new Thickness(16) };
        panel.Children.Add(new TextBlock { Text = label, Foreground = R("Text") });
        panel.Children.Add(tb);
        panel.Children.Add(buttons);
        w.Content = panel;
        w.SourceInitialized += (_, _) => { if (App.Dark) Native.DarkTitleBar(new WindowInteropHelper(w).Handle); };
        w.Loaded += (_, _) => { tb.Focus(); tb.SelectAll(); };
        return w.ShowDialog() == true ? tb.Text.Trim() : null;
    }
}
