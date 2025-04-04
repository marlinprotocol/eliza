import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

/**
 * Executes the `oyster-cvm list --address <address>` command and prints the response.
 * @param address The address to pass to the command.
 */
function executeOysterCvmListCommand(address: string): void {
  const oysterDir: string = path.join(os.homedir(), '.oyster');
  const oysterCvmExecutable: string = path.join(oysterDir, 'oyster-cvm');
  const args = ['list', '--address', address];

  const process = spawn(oysterCvmExecutable, args);

  process.stdout.on('data', (data) => {
    console.log(data.toString().trim());
  });

  process.stderr.on('data', (data) => {
    console.error(`${data.toString().trim()}`);
  });

  process.on('error', (error) => {
    console.error(`Error executing command: ${error.message}`);
  });
}

/**
 * Executes the `oyster-cvm logs --ip <ip>` command and prints the response.
 * @param ip The IP address to pass to the command.
 */
function executeOysterCvmLogsCommand(ip: string): void {
  const oysterDir: string = path.join(os.homedir(), '.oyster');
  const oysterCvmExecutable: string = path.join(oysterDir, 'oyster-cvm');
  const args = ['logs', '--ip', ip];

  const process = spawn(oysterCvmExecutable, args);

  process.stdout.on('data', (data) => {
    console.log(data.toString().trim());
  });

  process.stderr.on('data', (data) => {
    console.error(`${data.toString().trim()}`);
  });

  process.on('error', (error) => {
    console.error(`Error executing command: ${error.message}`);
  });
}

export { executeOysterCvmListCommand, executeOysterCvmLogsCommand };
