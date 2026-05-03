import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const dataDir = (): string => {
  const explicit = process.env.MANGO_DATA_DIR;
  if (explicit) return explicit;
  return path.resolve(process.cwd(), ".mango");
};

const ensureDir = (file: string): void => {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

/**
 * Tiny JSON-file store. Single-writer (one server process), so we keep it
 * simple: read once into memory, mutate in place, write atomically via
 * temp-file + rename. Pretty-printed so users can poke around the file by hand.
 */
export class JsonFileStore<T> {
  private cache: T | null = null;

  constructor(
    private readonly filename: string,
    private readonly defaultValue: () => T,
  ) {}

  private filePath(): string {
    return path.join(dataDir(), this.filename);
  }

  read(): T {
    if (this.cache) return this.cache;
    const file = this.filePath();
    if (!existsSync(file)) {
      this.cache = this.defaultValue();
      return this.cache;
    }
    const raw = readFileSync(file, "utf8");
    try {
      this.cache = JSON.parse(raw) as T;
    } catch (e) {
      throw new Error(
        `Could not parse ${file}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return this.cache;
  }

  write(next: T): void {
    const file = this.filePath();
    ensureDir(file);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    this.cache = next;
  }

  mutate(fn: (current: T) => T): T {
    const next = fn(this.read());
    this.write(next);
    return next;
  }
}
