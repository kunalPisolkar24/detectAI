import fs from 'fs';
import path from 'path';

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
// Only target files in __tests__ because I already moved them.
// I will fix them in place.
const testFiles = allFiles.filter(f => f.includes('__tests__') && (f.endsWith('.test.ts') || f.endsWith('.test.tsx')));

testFiles.forEach(currentPath => {
  const relativePath = path.relative(FEATURES_DIR, currentPath);
  const parts = relativePath.split(path.sep);
  const feature = parts[0];
  const type = parts[2]; // integration or unit
  
  // The original directory relative to feature root
  // features/chat/__tests__/unit/components/layout/test.tsx -> parts is [chat, __tests__, unit, components, layout, test.tsx]
  // Original subfolder was components/layout
  const subFolderParts = parts.slice(3, -1);
  const originalDirRelToFeature = subFolderParts.join(path.sep);
  
  // Depth of current file relative to feature root
  const currentDepth = parts.length - 2; // e.g. chat/__tests__/unit/file.tsx -> 4 - 2 = 2. 
  // Wait, let's count: chat (0), __tests__ (1), unit (2), file.tsx (3). 
  // From file.tsx to chat/ is 3 steps.
  const stepsToFeatureRoot = parts.length - 2; 

  let content = fs.readFileSync(currentPath, 'utf8');

  // Regex to find relative imports
  const regex = /(from\s+['"]|import\s+['"]|import\s*\(\s*['"]|vi\.mock\s*(?:<.*?>)?\s*\(\s*['"]|vi\.importActual\s*(?:<.*?>)?\s*\(\s*['"])(\.\.?\/[^'"]*)/g;

  content = content.replace(regex, (match, prefix, importedPath) => {
    // 1. Resolve importedPath relative to original directory
    const resolvedPathFromFeature = path.normalize(path.join(originalDirRelToFeature, importedPath));
    
    // 2. Create new relative path from current directory
    // Current directory is feature/__tests__/<type>/<subFolder>
    const currentDirRelToFeature = path.join('__tests__', type, originalDirRelToFeature);
    
    let newRelativePath = path.relative(currentDirRelToFeature, resolvedPathFromFeature);
    
    // path.relative might return 'actions/chat' if it's in the same folder, but we need './actions/chat'
    if (!newRelativePath.startsWith('.')) {
      newRelativePath = './' + newRelativePath;
    }

    return `${prefix}${newRelativePath}`;
  });

  fs.writeFileSync(currentPath, content);
  console.log(`Fixed imports in ${relativePath}`);
});
