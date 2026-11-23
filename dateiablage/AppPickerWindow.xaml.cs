using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;

namespace Dateiablage;

/// <summary>Ein installiertes Programm aus dem Windows-Ordner „Apps“ (shell:AppsFolder).</summary>
public class AppItem
{
    public string Name { get; init; } = "";
    public string Target { get; init; } = "";
    public string Kind => Store.AppKind(Target);
    public ImageSource? Icon => ShellIcon.Get(Target, false, false);
}

/// <summary>Liste aller installierten Programme (klassisch und Store) mit Suche.</summary>
public partial class AppPickerWindow : Window
{
    static List<AppItem>? _cache;
    readonly List<AppItem> _all;

    public List<AppItem> Selected { get; } = new();

    public AppPickerWindow(bool multi)
    {
        InitializeComponent();
        List.SelectionMode = multi ? SelectionMode.Extended : SelectionMode.Single;
        Hint.Text = multi ? "Mehrere mit Strg+Klick" : "";
        if (!multi) Title = "Programm wählen";
        Ok.Content = multi ? "Hinzufügen" : "Übernehmen";

        _all = _cache ??= Load();
        Search.TextChanged += (_, _) => Refresh();
        PreviewKeyDown += OnKey;
        Loaded += (_, _) => { Refresh(); Search.Focus(); };
        SourceInitialized += (_, _) => { if (App.Dark) Native.DarkTitleBar(new WindowInteropHelper(this).Handle); };
    }

    /// <summary>Liest den Windows-Ordner „Apps“ – derselbe Inhalt wie die Programmliste im Startmenü.</summary>
    static List<AppItem> Load()
    {
        var list = new List<AppItem>();
        try
        {
            var t = Type.GetTypeFromProgID("Shell.Application");
            if (t == null) return list;
            dynamic shell = Activator.CreateInstance(t)!;
            dynamic folder = shell.NameSpace("shell:AppsFolder");
            foreach (dynamic it in folder.Items())
            {
                string name = it.Name ?? "", path = it.Path ?? "";
                if (name.Trim().Length == 0 || path.Trim().Length == 0) continue;
                list.Add(new AppItem { Name = name.Trim(), Target = Store.AppsPrefix + path.Trim() });
            }
        }
        catch { }
        return list.GroupBy(a => a.Target, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
                   .OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    void Refresh()
    {
        var words = Search.Text.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var hits = _all.Where(a => words.All(w => a.Name.ToLowerInvariant().Contains(w))).ToList();
        List.ItemsSource = hits;
        if (hits.Count > 0) List.SelectedIndex = 0;
    }

    void Move(int delta)
    {
        int n = List.Items.Count;
        if (n == 0) return;
        List.SelectedIndex = Math.Max(0, Math.Min(n - 1, List.SelectedIndex + delta));
        List.ScrollIntoView(List.SelectedItem);
    }

    void OnKey(object sender, KeyEventArgs e)
    {
        if (!Search.IsKeyboardFocusWithin) return;   // in der Liste: normale Mehrfachauswahl
        switch (e.Key)
        {
            case Key.Down: Move(1); e.Handled = true; break;
            case Key.Up: Move(-1); e.Handled = true; break;
            case Key.PageDown: Move(10); e.Handled = true; break;
            case Key.PageUp: Move(-10); e.Handled = true; break;
        }
    }

    void Accept()
    {
        Selected.Clear();
        Selected.AddRange(List.SelectedItems.Cast<AppItem>());
        if (Selected.Count > 0) DialogResult = true;
    }

    void Ok_Click(object sender, RoutedEventArgs e) => Accept();

    void List_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (List.SelectedItem != null) Accept();
    }
}
