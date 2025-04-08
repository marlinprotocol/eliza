import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOGS_DIR = '.tee-cloud/logs';

/**
 * Class representing DockerOperations for interacting with Docker containers.
 * @class
 */
export class DockerOperations {
  private imageName: string;
  private dockerHubUsername?: string;

  /**
   * Constructor for creating a new image with the specified image name and optional Docker Hub username.
   *
   * @param {string} imageName - The name of the image to be created.
   * @param {string} [dockerHubUsername] - The Docker Hub username if pulling the image from a private repository.
   */
  constructor(imageName: string, dockerHubUsername?: string) {
    this.imageName = imageName;
    this.dockerHubUsername = dockerHubUsername;
    this.ensureLogsDir();
  }

  /**
   * This method ensures that the logs directory exists by creating it if it does not already exist.
   */
  private ensureLogsDir(): void {
    const logsPath = path.resolve(LOGS_DIR);
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
    }
  }

  /**
   * Returns the file path for the log file based on the given operation.
   * @param {string} operation - The operation for which the log file is being created.
   * @returns {string} The file path for the log file.
   */
  private getLogFilePath(operation: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.resolve(LOGS_DIR, `${this.imageName}-${operation}-${timestamp}.log`);
  }

  /**
   * Retrieves the system architecture.
   *
   * @returns {string} The system architecture (e.g. "arm64", "amd64", etc.)
   */
  private getSystemArchitecture(): string {
    const arch = os.arch();
    switch (arch) {
      case 'arm':
      case 'arm64':
        return 'arm64';
      case 'x64':
        return 'amd64';
      default:
        return arch;
    }
  }

  /**
   * Spawns a new process with the specified command, arguments, and operation.
   * @param {string} command - The command to execute.
   * @param {string[]} args - The arguments to pass to the command.
   * @param {string} operation - A description of the operation being performed.
   * @returns {Promise<void>} A Promise that resolves when the process completes successfully
   * and rejects if there is an error during the process execution.
   */

  async buildImage(dockerfilePath: string, tag: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.dockerHubUsername) {
        return reject(new Error('Docker Hub username is required for building'));
      }

      const arch = this.getSystemArchitecture();
      const fullImageName = `${this.dockerHubUsername}/${this.imageName}:${tag}`;
      console.log(`Building Docker image ${fullImageName}...`);

      const platformArg = arch === 'arm64' ? '--platform linux/amd64 ' : '';
      const cmd = `sudo docker build ${platformArg}-t ${fullImageName} -f ${dockerfilePath} .`;

      console.log(`Running command: ${cmd}`);
      const child = exec(cmd, { maxBuffer: 1024 * 1024 * 10 }); // Increase buffer limit if needed

      child.stdout?.on('data', (data) => {
        process.stdout.write(data);
      });

      child.stderr?.on('data', (data) => {
        process.stderr.write(data);
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`Docker image ${fullImageName} built successfully.`);
          resolve();
        } else {
          reject(new Error(`Docker build failed with exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}
