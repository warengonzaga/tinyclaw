declare module '@wgtechlabs/secrets-engine' {
  export interface SecretsEngineOptions {
    path?: string;
  }

  export class SecretsEngine {
    static open(options?: SecretsEngineOptions): Promise<SecretsEngine>;
    get storagePath(): string;
    get size(): number;
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string | null>;
    has(key: string): Promise<boolean>;
    keys(pattern?: string): Promise<string[]>;
    close(): Promise<void>;
  }
}
