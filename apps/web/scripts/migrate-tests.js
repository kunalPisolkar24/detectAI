import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const FEATURES_DIR = path.resolve(process.cwd(), 'features');

function getFiles(dir) {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const files = dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  });
  return Array.prototype.concat(...files);
}

const allFiles = getFiles(FEATURES_DIR);
const testFiles = allFiles.filter(f => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));

testFiles.forEach(oldPath => {
  const relativePath = path.relative(FEATURES_DIR, oldPath);
  const parts = relativePath.split(path.sep);
  const feature = parts[0];
  const filename = parts[parts.length - 1];
  const isIntegration = filename.includes('.integration.test.');
  
  let newPath;
  let depthChange;

  if (isIntegration) {
    // integration tests usually at feature root
    newPath = path.resolve(FEATURES_DIR, feature, '__tests__', 'integration', filename);
    depthChange = 2; 
  } else {
    // unit tests usually in sub-folders
    const subFolder = parts.slice(1, -1).join(path.sep);
    newPath = path.resolve(FEATURES_DIR, feature, '__tests__', 'unit', subFolder, filename);
    depthChange = 2; // e.g. features/chat/components/test.tsx -> features/chat/__tests__/unit/components/test.tsx
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(newPath), { recursive: true });

  // Read content to update imports
  let content = fs.readFileSync(oldPath, 'utf8');
  
  // Update relative imports
  // We want to replace something like from './' to '../../../'
  // Actually, we just need to add '../../' to the beginning of any relative import that points outside the __tests__ folder.
  // A relative import is one starting with ./ or ../
  
  content = content.replace(/(from\s+['"]|import\s+['"]|import\s*\(\s*['"]|vi\.mock\s*\(\s*['"]|vi\.importActual\s*(?:<.*?>)?\s*\(\s*['"])(\.\.?\/)/g, (match, prefix, start) => {
    return `${prefix}../../${start}`;
  });

  // Cleanup ../.././ to ../../
  content = content.replace(/\.\.\/\.\.\/\.\//g, '../../');

  // Special case for @/ paths (should remain unchanged as they are absolute from root)
  
  fs.writeFileSync(newPath, content);
  fs.unlinkSync(oldPath);
  console.log(`Moved ${relativePath} -> ${path.relative(process.cwd(), newPath)}`);
});
