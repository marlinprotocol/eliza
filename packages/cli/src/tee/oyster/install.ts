import os from 'os';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { execSync } from 'child_process';

const BASE_URL: string = 'https://artifacts.marlin.org/oyster/binaries/';
const FILE_NAME: string = 'oyster-cvm';

// Define clearer types for platform/arch maps
const PLATFORM_MAP: { [key: string]: string } = {
  linux: 'linux',
  darwin: 'darwin',
};

const ARCH_MAP: { [key: string]: string } = {
  x64: 'amd64',
  arm64: 'arm64',
};

function getDownloadUrl(): string {
  const platform: NodeJS.Platform = os.platform();
  const arch: string = os.arch();

  const mappedPlatform: string | undefined = PLATFORM_MAP[platform];
  const mappedArch: string | undefined = ARCH_MAP[arch];

  if (!mappedPlatform || !mappedArch) {
    console.error(`Error: Unsupported platform/architecture: ${platform}/${arch}`);
    process.exit(1);
  }

  if (mappedPlatform === 'darwin' && mappedArch !== 'arm64') {
    console.error(
      `Error: Unsupported architecture for Darwin: ${arch}. Only arm64 (M-series Macs) is supported.`
    );
    process.exit(1);
  }

  const binaryName: string = `${FILE_NAME}_latest_${mappedPlatform}_${mappedArch}`;
  return `${BASE_URL}${binaryName}`;
}

export function downloadAndInstall(): void {
  const url: string = getDownloadUrl();
  const oysterDir: string = path.join(os.homedir(), '.oyster');
  const destination: string = path.join(oysterDir, 'oyster-cvm');

  // Create .oyster directory if it doesn't exist
  if (!fs.existsSync(oysterDir)) {
    fs.mkdirSync(oysterDir, { mode: 0o755 });
  }

  // Download to destination
  const file = fs.createWriteStream(destination);
  https
    .get(url, (response) => {
      if (response.statusCode !== 200) {
        console.error(`Failed to download file. HTTP Status: ${response.statusCode}`);
        process.exit(1);
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          try {
            // Set executable permissions
            fs.chmodSync(destination, 0o755);
            console.log(`Installed oyster-cvm-cli!`);
          } catch (error) {
            console.error(`Failed to set permissions: ${error.message}`);
            process.exit(1);
          }
        });
      });
    })
    .on('error', (error) => {
      console.error(`Error during download: ${error.message}`);
      process.exit(1);
    });
}
