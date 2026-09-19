import { readExtensionId } from '@pvmp/contract';

import { mount } from './mount.tsx';
import { DetailsView } from './views/DetailsView.tsx';

// The host stamps the target onto #root when it builds the panel HTML.
mount((root) => <DetailsView extensionId={readExtensionId(root)} />);
