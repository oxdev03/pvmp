export interface PackageJson {
  preview: boolean;
  engines?: {
    vscode?: string;
  };
  categories: string[];
}
