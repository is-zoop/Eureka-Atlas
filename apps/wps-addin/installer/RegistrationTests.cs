using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;
internal static class RegistrationTests
{
    private static void Check(bool ok, string name) { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); }
    private static void Main()
    {
        string folder = Path.Combine(Path.GetTempPath(), "atlas-registration-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        string path = Path.Combine(folder, "publish.xml");
        try
        {
            File.WriteAllText(path, "<jsplugins><jspluginonline name='Other' type='et' url='https://other.example/' enable='enable'/><jspluginonline name='AtlasWpsProbe' type='et' url='http://127.0.0.1:3889/'/></jsplugins>");
            Registration.Change(path, true);
            var doc = XDocument.Load(path); Check(doc.Root.Elements().Count() == 2, "register replaces only own identity");
            Check((string)doc.Root.Elements().First().Attribute("url") == "https://other.example/", "other plugin preserved");
            Check(doc.Root.Elements().Last().Attribute("debug") == null, "Atlas debugger entry disabled without changing other addons");
            Check(Directory.GetFiles(folder, "*.atlas-backup-*").Length == 1, "original configuration backed up");
            Registration.Change(path, true); Check(XDocument.Load(path).Root.Elements().Count() == 2, "reinstall idempotent");
            Registration.Change(path, false); Check(XDocument.Load(path).Root.Elements().Count() == 1, "uninstall own registration only");
            Registration.Change(path, false); Check(XDocument.Load(path).Root.Elements().Count() == 1, "repeated uninstall succeeds");
            File.WriteAllText(path, "<jsplugins><jspluginonline name='AtlasWpsProbe' type='et' url='https://atlas.example/wps/'/></jsplugins>");
            Registration.Change(path, false); Check(XDocument.Load(path).Root.Elements().Count() == 1, "changed deployment retained");
            File.WriteAllText(path, "<broken>"); string before = File.ReadAllText(path); bool failed = false;
            try { Registration.Change(path, true); } catch { failed = true; } Check(failed && File.ReadAllText(path) == before, "malformed XML not overwritten");
            File.WriteAllText(path, "<!DOCTYPE jsplugins [<!ENTITY x SYSTEM 'file:///C:/Windows/win.ini'>]><jsplugins>&x;</jsplugins>"); failed = false;
            try { Registration.Change(path, true); } catch { failed = true; } Check(failed, "external entity rejected");
            File.Delete(path); Registration.Change(path, true); Check(XDocument.Load(path).Root.Elements().Count() == 1, "first installation works");
            Console.WriteLine("11 registration checks passed; real WPS configuration untouched.");
        }
        finally { foreach (string file in Directory.GetFiles(folder)) File.Delete(file); Directory.Delete(folder); }
    }
}
