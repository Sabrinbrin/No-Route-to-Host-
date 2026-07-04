// Regenerate the vendored, self-hosted front-end assets under public/vendor/
// from the pinned devDependencies, so the app runs with no external CDN
// (see NFR-3). Run after bumping react / react-dom / @fontsource versions:
//
//   npm install && node scripts/vendor-assets.mjs
//
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'vendor');
const fontsDir = join(vendor, 'fonts');
mkdirSync(fontsDir, { recursive: true });

// React / ReactDOM UMD — loaded before support.js so its CDN fetch is skipped.
copyFileSync(
  join(root, 'node_modules/react/umd/react.production.min.js'),
  join(vendor, 'react.production.min.js')
);
copyFileSync(
  join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'),
  join(vendor, 'react-dom.production.min.js')
);

// IBM Plex Sans/Mono (latin woff2) plus a generated @font-face stylesheet.
const fonts = [
  ['ibm-plex-sans', 'IBM Plex Sans', [400, 500, 600, 700]],
  ['ibm-plex-mono', 'IBM Plex Mono', [400, 500, 600]],
];
let css = '';
for (const [pkg, family, weights] of fonts) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    copyFileSync(join(root, 'node_modules/@fontsource', pkg, 'files', file), join(fontsDir, file));
    css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};`
      + `font-display:swap;src:url("/vendor/fonts/${file}") format("woff2")}\n`;
  }
}
writeFileSync(join(vendor, 'fonts.css'), css);
console.log('Vendored React + IBM Plex fonts into public/vendor/');
