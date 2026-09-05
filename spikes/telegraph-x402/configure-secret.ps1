# Writes the funded Base Sepolia burner key to a gitignored .env.local.
# The value is never echoed, never committed, and never reaches frontend code.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here '.env.local'

$secret = Read-Host "Enter the funded Telegraph burner private key" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($plain -notmatch '^0x[0-9a-fA-F]{64}$') {
        throw "Expected a 0x-prefixed 32-byte private key. Nothing was saved."
    }
    Set-Content -Path $target -Value "TELEGRAPH_EVM_PRIVATE_KEY=$plain" -Encoding ascii -NoNewline
    Write-Host "Saved to $target (gitignored)."
    Write-Host "Reply READY to continue the paid spike."
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $plain = $null
    $secret = $null
}
