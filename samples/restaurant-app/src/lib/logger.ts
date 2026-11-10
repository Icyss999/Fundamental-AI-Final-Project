import { config } from "./config";

export function log(msg: string): void {
  console.log(`[${config.dbUrl}] ${msg}`);
}
