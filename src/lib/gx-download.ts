export const MACOS_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_GX_DAEMON_MACOS_URL ??
  "https://download.gx.run/GX-macOS.dmg";

export const MACOS_DOWNLOAD_ZIP_URL =
  process.env.NEXT_PUBLIC_GX_DAEMON_MACOS_ZIP_URL ??
  "https://download.gx.run/GX-macOS.zip";

export const CLI_INSTALL_SCRIPT_URL = "https://download.gx.run/install.sh";

export const CLI_INSTALL_COMMAND = `curl -fsSL ${CLI_INSTALL_SCRIPT_URL} | sh`;
