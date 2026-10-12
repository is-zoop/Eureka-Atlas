using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private static readonly string Base = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string Identity = WindowsIdentity.GetCurrent().User.Value;
    private static readonly string MutexName = "Local\\AtlasWps.Runtime." + Identity;
    private static readonly string EventName = "Local\\AtlasWps.Stop." + Identity;
    private static void Configure(string value)
    {
        string origin = Validate(value), path = Path.Combine(Base, "atlas-origin.txt");
        if (File.Exists(path) && File.ReadAllText(path).Trim() != origin) File.Delete(Path.Combine(Base, "session.dat"));
        File.WriteAllText(path, origin, new System.Text.UTF8Encoding(false));
    }
    internal static string Validate(string value)
    {
        Uri uri;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri) || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "" || uri.AbsolutePath != "/" ||
            (uri.Scheme != "https" && !(uri.Scheme == "http" && (uri.Host == "127.0.0.1" || uri.Host == "localhost"))))
            throw new Exception("请输入 HTTPS 服务根地址。本机试用可以使用 http://127.0.0.1:3001。");
        return uri.GetLeftPart(UriPartial.Authority);
    }
    private static void Stop()
    {
        try { using (var signal = EventWaitHandle.OpenExisting(EventName)) signal.Set(); }
        catch (WaitHandleCannotBeOpenedException) { }
        using (var mutex = new Mutex(false, MutexName))
        {
            bool acquired = false;
            try { acquired = mutex.WaitOne(15000); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new Exception("Atlas 助手未及时退出，请从系统托盘退出后重试。");
            mutex.ReleaseMutex();
        }
    }
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            if (args.Length > 0 && args[0] == "--stop") { Stop(); return 0; }
            if (args.Length > 0 && args[0] == "--register") { Registration.Change(Registration.PathForUser(), true); return 0; }
            if (args.Length > 0 && args[0] == "--unregister") { Registration.Change(Registration.PathForUser(), false); return 0; }
            if (args.Length > 0 && args[0] == "--validate")
            {
                if (args.Length != 2) throw new Exception("缺少 Atlas 地址"); Validate(args[1]); return 0;
            }
            if (args.Length > 0 && args[0] == "--configure")
            {
                if (args.Length != 2) throw new Exception("缺少 Atlas 地址");
                Configure(args[1]); return 0;
            }
            if (args.Length > 0 && args[0] == "--settings")
            {
                using (var form = new Form { Icon = new Icon(Path.Combine(Base, "atlas-badge.ico")), Text = "Atlas WPS 服务设置", ClientSize = new Size(480, 170), StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false })
                {
                    var label = new Label { Left = 20, Top = 18, Width = 440, Height = 42, Text = "Atlas 服务根地址（服务器用 HTTPS）\n本机试用：http://127.0.0.1:3001" };
                    var input = new TextBox { Left = 20, Top = 66, Width = 440, Text = File.ReadAllText(Path.Combine(Base, "atlas-origin.txt")).Trim() };
                    var button = new Button { Left = 300, Top = 112, Width = 160, Text = "保存并重启助手" };
                    button.Click += (sender, ev) => {
                        try { string origin = Validate(input.Text); Stop(); Configure(origin); form.DialogResult = DialogResult.OK; }
                        catch (Exception ex) { MessageBox.Show(ex.Message, "Atlas 设置失败"); }
                    };
                    form.Controls.AddRange(new Control[] { label, input, button }); form.AcceptButton = button;
                    if (form.ShowDialog() == DialogResult.OK) Process.Start(new ProcessStartInfo(Path.Combine(Base, "AtlasWps.exe")) { UseShellExecute = false, CreateNoWindow = true });
                }
                return 0;
            }
            bool created;
            using (var mutex = new Mutex(true, MutexName, out created))
            {
                if (!created) return 0;
                try { Run(); } finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "Atlas WPS 助手", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
    }
    private static void Run()
    {
        Validate(File.ReadAllText(Path.Combine(Base, "atlas-origin.txt")));
        using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, EventName))
        using (var ready = new ManualResetEvent(false))
        using (var child = new Process())
        {
            child.StartInfo = new ProcessStartInfo(Path.Combine(Base, "node.exe"), "\"" + Path.Combine(Base, "runtime", "server.mjs") + "\"") {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Base,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            child.OutputDataReceived += (s, ev) => { if (ev.Data == "ATLAS_READY") ready.Set(); };
            child.ErrorDataReceived += (s, ev) => { /* Never persist credentials or server response bodies. */ };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
            try
            {
                if (!ready.WaitOne(10000) || child.HasExited) throw new Exception("本地助手启动失败。请确认 3891 端口未被占用，且安装文件完整。未修改 WPS 或终止其他程序。");
                using (var tray = new NotifyIcon { Icon = new Icon(Path.Combine(Base, "atlas-badge.ico")), Text = "Atlas WPS 数据助手（运行中）", Visible = true })
                using (var menu = new ContextMenuStrip())
                using (var timer = new System.Windows.Forms.Timer { Interval = 500 })
                {
                    menu.Items.Add("Atlas 服务设置", null, (s, ev) => Process.Start(new ProcessStartInfo(Path.Combine(Base, "AtlasWps.exe"), "--settings") { UseShellExecute = false, CreateNoWindow = true }));
                    menu.Items.Add("退出本地助手", null, (s, ev) => Application.ExitThread());
                    tray.ContextMenuStrip = menu;
                    timer.Tick += (s, ev) => {
                        if (stop.WaitOne(0)) Application.ExitThread();
                        else if (child.HasExited) { MessageBox.Show("Atlas 本地助手已停止，请从开始菜单重新启动。", "Atlas WPS"); Application.ExitThread(); }
                    };
                    timer.Start(); Application.Run(); tray.Visible = false;
                }
            }
            finally
            {
                if (!child.HasExited) { child.StandardInput.Close(); if (!child.WaitForExit(5000)) child.Kill(); }
            }
        }
    }
}
