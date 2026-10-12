using System;
using System.Security.Cryptography;
using System.Text;

internal static class SessionVault
{
    private static int Main(string[] args)
    {
        try
        {
            Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length != 1) return 1;
            string input = Console.In.ReadToEnd();
            if (input.Length > 256 * 1024) return 1;
            byte[] purpose = Encoding.UTF8.GetBytes("Eureka Atlas WPS session v1");
            if (args[0] == "encrypt") Console.Write(Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(input), purpose, DataProtectionScope.CurrentUser)));
            else if (args[0] == "decrypt") Console.Write(Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(input), purpose, DataProtectionScope.CurrentUser)));
            else return 1;
            return 0;
        }
        catch { return 1; } // No credential data in errors or logs.
    }
}
