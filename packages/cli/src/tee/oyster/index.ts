import { downloadAndInstall } from '../oyster/install';
import { executeOysterCvmListCommand, executeOysterCvmLogsCommand } from '../oyster/oyster-cvm';

async function installOysterCvmCli() {
  downloadAndInstall();
}

async function fetchCvmList(address: string) {
  executeOysterCvmListCommand(address);
}

async function fetchOysterCvmLogs(ip: string) {
  executeOysterCvmLogsCommand(ip);
}

export { installOysterCvmCli, fetchCvmList, fetchOysterCvmLogs };
