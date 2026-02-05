import { homedir } from "node:os";
import { join } from "node:path";

export function getBaseDir(): string {
  return join(homedir(), ".agents", "pi-langlearn");
}
