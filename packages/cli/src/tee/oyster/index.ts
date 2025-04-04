import { downloadAndInstall } from '../oyster/install';
import { executeOysterCvmListCommand, executeOysterCvmLogsCommand } from '../oyster/oyster-cvm';

function installOysterCvmCli() {
  downloadAndInstall();
}

function fetchCvmList(address: string) {
  executeOysterCvmListCommand(address);
}

async function fetchOysterCvmLogs(ip: string) {
  executeOysterCvmLogsCommand(ip);
}

export { installOysterCvmCli, fetchCvmList, fetchOysterCvmLogs };
