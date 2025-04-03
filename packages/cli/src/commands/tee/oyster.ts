import { Command } from 'commander';
import { fetchCvmList, fetchOysterCvmLogs, installOysterCvmCli } from '@/src/tee/oyster';

/**
 * Install oyster-cvm-cli
 *
 * @returns {Promise<void>} - A promise that resolves when the initialization is complete.
 */
const initCommand = new Command()
  .command('install-cli')
  .description('Installs oyster-cvm-cli')
  .action(async () => {
    try {
      console.log('Installing oyster-cvm-cli...');
      await installOysterCvmCli();
    } catch (error) {
      console.error('Failed to install oyster-cvm-cli:', error);
      process.exit(1);
    }
  });

/**
 * List running CVMs for a user
 * @param options - Command line options
 * @param {string} options.address - address.
 * @returns {Promise<void>} - Promise that resolves after listing the tags.
 */
const listCvmCommand = new Command()
  .command('list-cvms')
  .description('List running CVMs for a user')
  .requiredOption('-a, --address <address>', 'Address')
  .action(async (options) => {
    const { address } = options;
    try {
      fetchCvmList(address);
    } catch (error) {
      console.error('Failed to list CVMs:', error);
      process.exit(1);
    }
  });

/**
 * Fetch logs for a CVM using its IP address
 * @param options - Command line options
 * @param {string} options.ip - IP address.
 * @returns {Promise<void>} - Promise that resolves after fetching the logs.
 */
const fetchCvmLogsCommand = new Command()
  .command('logs')
  .description('Fetch logs for a CVM using its IP address')
  .requiredOption('-i, --ip <ip>', 'IP address')
  .action(async (options) => {
    const { ip } = options;
    try {
      fetchOysterCvmLogs(ip);
    } catch (error) {
      console.error('Failed to fetch CVM logs:', error);
      process.exit(1);
    }
  });

/**
 * A command for managing Oyster TEE deployments.
 *
 * @type {Command}
 */
export const oysterCommand = new Command('oyster')
  .description('Manage Oyster TEE deployments')
  .addCommand(initCommand)
  .addCommand(listCvmCommand)
  .addCommand(fetchCvmLogsCommand);
