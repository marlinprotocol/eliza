import { Command } from 'commander';
import { installOysterCvmCli } from '@/src/tee/oyster';

/**
 * Command to install oyster-cvm-cli.
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
 * A command for managing Oyster TEE deployments.
 *
 * @type {Command}
 */
export const oysterCommand = new Command('oyster')
  .description('Manage Oyster TEE deployments')
  .addCommand(initCommand);
