# Popup entry for the funded Base Sepolia burner key.
# The value is masked on screen, written only to a gitignored .env.local,
# never echoed to the console, never committed, never sent to frontend code.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here '.env.local'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Telegraph burner key'
$form.Size = New-Object System.Drawing.Size(560, 210)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = "Paste the funded Base Sepolia burner private key." + [Environment]::NewLine +
              "64 hex characters, with or without the 0x prefix."
$label.Location = New-Object System.Drawing.Point(16, 18)
$label.Size = New-Object System.Drawing.Size(510, 40)
$form.Controls.Add($label)

$box = New-Object System.Windows.Forms.TextBox
$box.Location = New-Object System.Drawing.Point(16, 62)
$box.Size = New-Object System.Drawing.Size(510, 26)
$box.UseSystemPasswordChar = $true
$form.Controls.Add($box)

$show = New-Object System.Windows.Forms.CheckBox
$show.Text = 'Show characters'
$show.Location = New-Object System.Drawing.Point(16, 94)
$show.Size = New-Object System.Drawing.Size(160, 24)
$show.Add_CheckedChanged({ $box.UseSystemPasswordChar = -not $show.Checked })
$form.Controls.Add($show)

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(16, 122)
$status.Size = New-Object System.Drawing.Size(510, 20)
$status.ForeColor = [System.Drawing.Color]::Firebrick
$form.Controls.Add($status)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save'
$save.Location = New-Object System.Drawing.Point(350, 138)
$save.Size = New-Object System.Drawing.Size(85, 30)
$form.Controls.Add($save)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.Location = New-Object System.Drawing.Point(441, 138)
$cancel.Size = New-Object System.Drawing.Size(85, 30)
$cancel.Add_Click({ $form.Tag = 'cancelled'; $form.Close() })
$form.Controls.Add($cancel)

$save.Add_Click({
    $raw = $box.Text
    if ($null -eq $raw) { $raw = '' }
    # Tolerate stray whitespace, quotes, a KEY= prefix, and a missing 0x.
    $clean = $raw.Trim().Trim('"').Trim("'")
    $clean = $clean -replace '^\s*(?:export\s+)?TELEGRAPH_EVM_PRIVATE_KEY\s*=\s*', ''
    $clean = $clean -replace '\s', ''
    if ($clean -match '^(?:0x)?([0-9a-fA-F]{64})$') {
        $normalized = '0x' + $Matches[1].ToLower()
        Set-Content -Path $target -Value "TELEGRAPH_EVM_PRIVATE_KEY=$normalized" -Encoding ascii -NoNewline
        $form.Tag = 'saved'
        $form.Close()
        return
    }
    $hexOnly = ($clean -replace '^0x', '')
    $status.Text = "Not a 32-byte key: got $($hexOnly.Length) hex characters, need 64. Nothing saved."
    $box.Focus()
    $box.SelectAll()
})

$form.AcceptButton = $save
$form.Add_Shown({ $box.Focus() })
[void]$form.ShowDialog()

if ($form.Tag -eq 'saved') {
    Write-Host "Saved to $target (gitignored). Reply READY to continue the paid spike."
} else {
    Write-Host "Cancelled. Nothing was saved."
}
$form.Dispose()
