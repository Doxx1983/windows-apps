using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Dateiablage;

/// <summary>Ein Eintrag zeigt auf eine Datei, einen Ordner oder eine Webadresse. Die Datei selbst bleibt, wo sie ist.</summary>
public class Entry
{
    public string Name { get; set; } = "";
    public string Target { get; set; } = "";

    [JsonIgnore] public Group? Group { get; set; }
    [JsonIgnore] public bool Missing { get; private set; }
    [JsonIgnore] public bool ShowGroup { get; set; }

    [JsonIgnore] public bool IsUrl => Store.IsUrl(Target);
    [JsonIgnore] public double Opacity => Missing ? 0.5 : 1.0;
    [JsonIgnore] public ImageSource? Icon => ShellIcon.Get(Target, IsUrl, Missing);

    [JsonIgnore]
    public string Sub
    {
        get
        {
            var s = Missing ? "Nicht gefunden: " + Target : Target;
            return ShowGroup && Group != null ? Group.Name + "  ·  " + s : s;
        }
    }

    public void Check() => Missing = !IsUrl && !File.Exists(Target) && !Directory.Exists(Target);
}

public class Group
{
    public string Name { get; set; } = "";
    public List<Entry> Entries { get; set; } = new();
    [JsonIgnore] public int Count => Entries.Count;
}

public class Data
{
    public List<Group> Groups { get; set; } = new();
    public int SelectedGroup { get; set; }
    public double[]? Bounds { get; set; }
}

/// <summary>Speichert die Ablage als JSON unter %APPDATA%\Dateiablage (vorige Fassung als .bak).</summary>
public class Store
{
    public static readonly string Dir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Dateiablage");
    static readonly string FilePath = Path.Combine(Dir, "ablage.json");
    static readonly string BakPath = FilePath + ".bak";
    static readonly JsonSerializerOptions Opts = new() { WriteIndented = true };

    public Data Data { get; private set; } = new();
    public string? LoadWarning { get; private set; }

    public Store()
    {
        Directory.CreateDirectory(Dir);
        Load();
    }

    void Load()
    {
        if (File.Exists(FilePath))
        {
            try { Data = Read(FilePath); }
            catch
            {
                var bad = Path.Combine(Dir, $"ablage.defekt-{DateTime.Now:yyyyMMdd-HHmmss}.json");
                File.Copy(FilePath, bad, true);
                try
                {
                    Data = Read(BakPath);
                    LoadWarning = "Die Ablage-Datei war beschädigt. Die vorige Fassung wurde geladen.\nDefekte Datei: " + bad;
                }
                catch
                {
                    Data = new Data();
                    LoadWarning = "Die Ablage-Datei war beschädigt und ließ sich nicht laden. Die App startet leer.\nDefekte Datei: " + bad;
                }
            }
        }
        if (Data.Groups.Count == 0) Data.Groups.Add(new Group { Name = "Allgemein" });
        foreach (var g in Data.Groups)
        {
            g.Entries ??= new();
            foreach (var e in g.Entries) e.Group = g;
        }
    }

    static Data Read(string path) =>
        JsonSerializer.Deserialize<Data>(File.ReadAllText(path), Opts) ?? throw new InvalidDataException();

    public void Save()
    {
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(Data, Opts));
        if (File.Exists(FilePath)) File.Replace(tmp, FilePath, BakPath);
        else File.Move(tmp, FilePath);
    }

    // ---------- Einträge ----------

    public static bool IsUrl(string s) =>
        s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || s.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    public static string NameFor(string path)
    {
        if (IsUrl(path))
        {
            if (!Uri.TryCreate(path, UriKind.Absolute, out var u)) return path;
            var n = u.Host + (u.AbsolutePath == "/" ? "" : u.AbsolutePath.TrimEnd('/'));
            return n.Length > 70 ? n[..70] + "…" : n;
        }
        if (Directory.Exists(path))
        {
            var d = new DirectoryInfo(path).Name;
            return d.Length == 0 ? path : d;
        }
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext is ".lnk" or ".url" ? Path.GetFileNameWithoutExtension(path) : Path.GetFileName(path);
    }

    /// <summary>Fügt Dateien/Ordner/Adressen hinzu; schon vorhandene werden übersprungen. Liefert die neuen Einträge.</summary>
    public List<Entry> Add(Group g, IEnumerable<string> targets)
    {
        var added = new List<Entry>();
        foreach (var raw in targets)
        {
            var t = raw.Trim();
            if (t.Length == 0) continue;
            if (!IsUrl(t)) { try { t = Path.GetFullPath(t); } catch { continue; } }
            if (g.Entries.Any(e => string.Equals(e.Target, t, StringComparison.OrdinalIgnoreCase))) continue;
            var en = new Entry { Name = NameFor(t), Target = t, Group = g };
            g.Entries.Add(en);
            added.Add(en);
        }
        if (added.Count > 0) Save();
        return added;
    }

    public void Remove(Entry e)
    {
        e.Group?.Entries.Remove(e);
        Save();
    }

    public void MoveTo(Entry e, Group target)
    {
        if (e.Group == target) return;
        e.Group?.Entries.Remove(e);
        target.Entries.Add(e);
        e.Group = target;
        Save();
    }

    /// <summary>Verschiebt ein Element in seiner Liste um <paramref name="delta"/> Plätze.</summary>
    public bool Shift<T>(List<T> list, T item, int delta)
    {
        int i = list.IndexOf(item), j = i + delta;
        if (i < 0 || j < 0 || j >= list.Count) return false;
        list.RemoveAt(i);
        list.Insert(j, item);
        Save();
        return true;
    }

    public List<Entry> Search(string q)
    {
        var words = q.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return Data.Groups.SelectMany(g => g.Entries)
            .Where(e =>
            {
                var hay = (e.Name + " " + e.Target + " " + e.Group?.Name).ToLowerInvariant();
                return words.All(hay.Contains);
            })
            .ToList();
    }

    // ---------- Gruppen ----------

    public Group AddGroup(string name)
    {
        var g = new Group { Name = name };
        Data.Groups.Add(g);
        Save();
        return g;
    }

    public void DeleteGroup(Group g)
    {
        Data.Groups.Remove(g);
        if (Data.Groups.Count == 0) Data.Groups.Add(new Group { Name = "Allgemein" });
        Save();
    }
}

/// <summary>Symbole wie im Explorer (Windows-Shell), zwischengespeichert.</summary>
static class ShellIcon
{
    static readonly Dictionary<string, ImageSource?> Cache = new(StringComparer.OrdinalIgnoreCase);
    static readonly HashSet<string> OwnIcon = new(StringComparer.OrdinalIgnoreCase)
        { "", ".exe", ".lnk", ".ico", ".url", ".appref-ms", ".msc", ".cpl" };

    public static ImageSource? Get(string target, bool isUrl, bool missing)
    {
        string key, path;
        uint attr = Native.FILE_ATTRIBUTE_NORMAL, flags = Native.SHGFI_ICON;
        var ext = isUrl ? "" : Path.GetExtension(target);

        if (isUrl) { key = "::url"; path = ".url"; flags |= Native.SHGFI_USEFILEATTRIBUTES; }
        else if (missing)
        {
            key = "::fehlt" + ext;
            path = ext.Length == 0 ? "ordner" : "x" + ext;
            if (ext.Length == 0) attr = Native.FILE_ATTRIBUTE_DIRECTORY;
            flags |= Native.SHGFI_USEFILEATTRIBUTES;
        }
        else if (Directory.Exists(target) || OwnIcon.Contains(ext)) { key = target; path = target; }
        else { key = "::ext" + ext; path = target; }

        if (Cache.TryGetValue(key, out var hit)) return hit;
        ImageSource? img = null;
        try
        {
            var info = new Native.SHFILEINFO();
            Native.SHGetFileInfo(path, attr, ref info, (uint)Marshal.SizeOf(info), flags);
            if (info.hIcon != IntPtr.Zero)
            {
                var bs = Imaging.CreateBitmapSourceFromHIcon(info.hIcon, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                bs.Freeze();
                img = bs;
                Native.DestroyIcon(info.hIcon);
            }
        }
        catch { }
        Cache[key] = img;
        return img;
    }
}
