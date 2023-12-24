import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import xml2js from 'xml2js';
import { Extension } from './models/extension';
import { Package } from './models/package';
import * as vscode from 'vscode';
import { CONSTANTS } from './constants';

const getExtensionPathsRecursively = (dir: string, depth: number, extensionPaths: string[] = []): string[] => {
  if (depth <= 0) {
    return extensionPaths;
  }

  try {
    const contents = fs.readdirSync(dir, { withFileTypes: true });

    for (const content of contents) {
      const fullPath = path.join(dir, content.name);

      if (content.isDirectory()) {
        extensionPaths = getExtensionPathsRecursively(fullPath, depth - 1, extensionPaths);
      } else if (content.name.endsWith('.vsix')) {
        extensionPaths.push(fullPath);
      }
    }
  } catch (err) {
    console.log(err);
  }

  return extensionPaths;
};

export const getPackages = async (dir: string): Promise<Package[]> => {
  const packages: Package[] = [];
  const extensions = await getExtensions(dir);
  if (!extensions?.length) return [];

  for (const extension of extensions) {
    let packageIndex = packages.findIndex((x) => x.id === extension.id);
    if (packageIndex === -1) {
      const pkg = new Package();
      pkg.id = extension.id;
      pkg.installedVersion = getExtensionInstalledVersion(extension.metadata.identifier);
      packages.push(pkg);
      packageIndex = packages.length - 1;
    }

    packages[packageIndex].addExtension(extension);
  }

  packages.map((x) => x.sort());

  return packages;
};

const getExtensions = async (dir: string): Promise<Extension[]> => {
  const extensionPaths = getExtensionPathsRecursively(dir, 3);
  const extensions: Extension[] = [];
  const parser = new xml2js.Parser({ explicitArray: false });

  for (const extensionPath of extensionPaths) {
    const zip = new AdmZip(extensionPath);
    const extManifest = await parser.parseStringPromise(zip.readAsText('extension.vsixmanifest'));
    const npmManifest = JSON.parse(zip.readAsText('extension/package.json'));
    const extension = new Extension();

    extension.identity.target = extManifest?.PackageManifest?.Metadata?.Identity?.$?.TargetPlatform || 'any';
    if (!isCompatibleTarget(extension.identity.target)) continue;

    /* BASE */
    extension.name = extManifest?.PackageManifest?.Metadata?.DisplayName;
    extension.id = extManifest?.PackageManifest?.Metadata?.Identity?.$?.Id;
    extension.extensionPath = extensionPath;

    const propertiesArray = (extManifest?.PackageManifest?.Metadata?.Properties?.Property as any[]) || [];

    /* IDENTIFY */
    extension.identity.version = extManifest?.PackageManifest?.Metadata?.Identity?.$?.Version;
    extension.identity.preRelease = !!propertiesArray.find((prop: any) => prop?.$?.Id === 'Microsoft.VisualStudio.Code.PreRelease');
    extension.identity.preview = npmManifest?.preview;
    extension.identity.engine = npmManifest?.engines?.vscode;

    /* METADATA */
    extension.metadata.description = extManifest?.PackageManifest?.Metadata?.Description?._;
    extension.metadata.publisher = extManifest?.PackageManifest?.Metadata?.Identity?.$?.Publisher;
    extension.metadata.publishedAt = fs.statSync(extensionPath).ctime;
    extension.metadata.identifier = `${extension.metadata.publisher.toLowerCase()}.${extension.id.toLowerCase()}`;
    extension.metadata.language = extManifest?.PackageManifest?.Metadata?.Identity?.$?.Language || 'en-US';
    extension.metadata.categories = npmManifest.categories || [];

    /* ASSETS */
    const readmePath = (extension.assets.readme = extManifest?.PackageManifest?.Assets?.Asset?.find((asset: any) => asset?.$?.Type === 'Microsoft.VisualStudio.Services.Content.Details')?.$?.Path);
    const changelogPath = (extension.assets.readme = extManifest?.PackageManifest?.Assets?.Asset?.find(
      (asset: any) => asset?.$?.Type === 'Microsoft.VisualStudio.Services.Content.Changelog'
    )?.$?.Path);
    const imagePath = extManifest?.PackageManifest?.Metadata?.Icon;

    extension.assets.readme = readmePath ? zip.readAsText(readmePath) : '';
    extension.assets.changelog = changelogPath ? zip.readAsText(changelogPath) : '';
    extension.assets.image = imagePath ? `data:image/png;base64,${Buffer.from(zip.readFile(imagePath) as Buffer).toString('base64')}` : '';

    /* LINKS */
    extension.links.getStarted = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Getstarted'))?.$?.Value;
    extension.links.learn = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Learn'))?.$?.Value;
    extension.links.repository = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Repository'))?.$?.Value;
    extension.links.support = propertiesArray?.find((x) => x?.$?.Id?.endsWith('Links.Support'))?.$?.Value;

    extensions.push(extension);
  }

  return extensions;
};

const isCompatibleTarget = (target: string): boolean => {
  const targetPlatform = `${process.platform}-${process.arch}`;
  if (target === 'any' || targetPlatform.toLowerCase() === target.toLowerCase()) {
    return true;
  }
  return false;
};

const getExtensionInstalledVersion = (identifier: string): string => {
  const ext = vscode.extensions.getExtension(identifier);
  return ext?.packageJSON?.version;
};

export const installExtension = async (pkg: Package, ctx: vscode.ExtensionContext): Promise<string> => {
  const downloadDir = downloadDirectoryExists(ctx);
  const copiedExtensionPath = path.join(downloadDir, path.basename(pkg.extension.extensionPath));
  // copy ext to download dir
  fs.copyFileSync(pkg.extension.extensionPath, copiedExtensionPath);

  // install extension

  try {
    await vscode.commands.executeCommand(CONSTANTS.vsCmdInstall, vscode.Uri.file(copiedExtensionPath));
    // cleanup
    fs.rmSync(copiedExtensionPath);
    vscode.window.showInformationMessage(`Successfully installed ${pkg.extension.id}:v${pkg.extension.identity.version}`);
    return pkg.extension.identity.version;
  } catch (err) {
    console.error(err);
    await vscode.window.showErrorMessage(`Failed to install ${pkg.extension.id}:v${pkg.extension.identity.version} with error ${err}`);
  }

  return '';
};

export const uninstallExtension = async (pkg: Package): Promise<boolean> => {
  try {
    await vscode.commands.executeCommand(CONSTANTS.vsCmdUninstall, pkg.extension.metadata.identifier);
    vscode.window.showInformationMessage(`Successfully uninstalled ${pkg.extension.id}:v${pkg.installedVersion}`);
    return true;
  } catch (err) {
    await vscode.window.showErrorMessage(`Failed to uninstall ${pkg.extension.id}:v${pkg.installedVersion} with error ${err}`);
  }
  return false;
};

const downloadDirectoryExists = (ctx: vscode.ExtensionContext): string => {
  const downloadDir = vscode.Uri.joinPath(ctx.globalStorageUri, 'temp');

  if (!fs.existsSync(downloadDir.fsPath)) {
    fs.mkdirSync(downloadDir.fsPath, { recursive: true });
  }

  return downloadDir.fsPath;
};

export const getExtensionSources = async (): Promise<string[]> => {
  let paths = (await vscode.workspace.getConfiguration('').get<string[]>(CONSTANTS.propSource)) || [];
  return paths;
};
