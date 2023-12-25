interface Property {
  $: {
    Id: string;
    Value: string;
  };
}

interface Properties {
  Property: Property[];
}

interface Identity {
  $: {
    Language: string;
    Id: string;
    Version: string;
    Publisher: string;
    TargetPlatform: string;
  };
}

interface Description {
  _: string;
  $: {
    'xml:space': string;
  };
}

interface Metadata {
  Identity: Identity;
  DisplayName: string;
  Description: Description;
  Tags: string;
  Categories: string;
  GalleryFlags: string;
  Properties: Properties;
  License: string;
  Icon: string;
}

interface Asset {
  $: {
    Type: string;
    Path: string;
    Addressable: string;
  };
}

interface PackageManifest {
  $: {
    Version: string;
    xmlns: string;
    'xmlns:d': string;
  };
  Metadata: Metadata;
  Installation: {
    InstallationTarget: {
      $: {
        Id: string;
      };
    };
  };
  Dependencies: string;
  Assets: {
    Asset: Asset[];
  };
}

export interface Manifest {
  PackageManifest: PackageManifest;
}
