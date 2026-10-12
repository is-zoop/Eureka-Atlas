using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;
using System.Xml.Linq;

internal static class Registration
{
    internal const string Url = "http://127.0.0.1:3891/";
    internal const string Name = "AtlasWpsProbe";
    internal static string PathForUser()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "kingsoft", "wps", "jsaddons", "publish.xml");
    }
    internal static void Change(string path, bool install)
    {
        bool exists = File.Exists(path);
        if (!install && !exists) return;
        byte[] original = exists ? File.ReadAllBytes(path) : null;
        XDocument doc;
        if (exists)
        {
            using (var input = new MemoryStream(original))
            using (var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
                doc = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
        }
        else doc = new XDocument(new XDeclaration("1.0", "UTF-8", null), new XElement("jsplugins"));
        if (doc.Root == null || doc.Root.Name != "jsplugins") throw new Exception("WPS 加载项配置格式不正确，未修改文件。");
        var entries = doc.Root.Elements().Where(e => (string)e.Attribute("name") == Name && (string)e.Attribute("type") == "et").ToList();
        if (!install) entries = entries.Where(e => (string)e.Attribute("url") == Url).ToList();
        if (!install && entries.Count == 0) return;
        foreach (var entry in entries) entry.Remove();
        if (install) doc.Root.Add(new XElement("jspluginonline", new XAttribute("name", Name), new XAttribute("type", "et"),
            new XAttribute("url", Url), new XAttribute("enable", "enable_dev"), new XAttribute("install", "null")));
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        string temp = path + ".atlas-" + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var writer = XmlWriter.Create(temp, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true })) doc.Save(writer);
            if (exists)
            {
                if (!File.ReadAllBytes(path).SequenceEqual(original)) throw new Exception("WPS 配置刚刚被其他程序修改，请退出 WPS 后重试。");
                File.Replace(temp, path, path + ".atlas-backup-" + Guid.NewGuid().ToString("N"));
            }
            else File.Move(temp, path);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
