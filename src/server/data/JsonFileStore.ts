import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * A tiny document store backed by a single JSON file.
 * Data is kept in memory; every mutation is flushed atomically (write to temp file, then rename).
 */
export class JsonFileStore<T> {
  private data: T;

  constructor(
    private readonly filePath: string,
    createDefault: () => T,
  ) {
    this.data = this.load(createDefault);
  }

  read(): Readonly<T> {
    return this.data;
  }

  update(mutate: (data: T) => void): void {
    const previous = this.data;
    this.data = structuredClone(previous);
    try { mutate(this.data); this.flush(); }
    catch (error) { this.data = previous; throw error; }
  }

  private load(createDefault: () => T): T {
    if (existsSync(this.filePath)) {
      try {
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as T;
      } catch (error) {
        throw new Error(`Cannot read database ${this.filePath}. Existing data was preserved.`, { cause: error });
      }
    }
    const fresh = createDefault();
    this.data = fresh;
    this.flush();
    return fresh;
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(temp, this.filePath);
  }
}
