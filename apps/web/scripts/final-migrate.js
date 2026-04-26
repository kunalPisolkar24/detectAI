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
const testFiles = allFiles.filter(f => (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) && !f.includes('__tests__'));

testFiles.forEach(oldPathFull => {
  const oldPathRelToFeatures = path.relative(FEATURES_DIR, oldPathFull);
  const parts = oldPathRelToFeatures.split(path.sep);
  const feature = parts[0];
  const oldPathRelToFeature = parts.slice(1).join(path.sep);
  
  const filename = parts[parts.length - 1];
  const isIntegration = filename.includes('.integration.test.');
  const type = isIntegration ? 'integration' : 'unit';
  
  const newPathRelToFeature = path.join('__tests__', type, oldPathRelToFeature);
  const newPathFull = path.resolve(FEATURES_DIR, feature, newPathRelToFeature);

  // Ensure directory exists
  fs.mkdirSync(path.dirname(newPathFull), { recursive: true });

  let content = fs.readFileSync(oldPathFull, 'utf8');

  // Regex to find relative imports
  const regex = /(from\s+['"]|import\s+['"]|import\s*\(\s*['"]|vi\.mock\s*(?:<.*?>)?\s*\(\s*['"]|vi\.importActual\s*(?:<.*?>)?\s*\(\s*['"])(\.\.?\/[^'"]*)/g;

  content = content.replace(regex, (match, prefix, importedPath) => {
    // 1. Resolve importedPath relative to original directory
    const absoluteImportedPath = path.normalize(path.join(path.dirname(oldPathRelToFeature), importedPath));
    
    // 2. Create new relative path from new test directory
    let newRelativeImport = path.relative(path.dirname(newPathRelToFeature), absoluteImportedPath);
    
    if (!newRelativeImport.startsWith('.')) {
      newRelativeImport = './' + newRelativeImport;
    }

    return `${prefix}${newRelativeImport}`;
  });

  fs.writeFileSync(newPathFull, content);
  fs.unlinkSync(oldPathFull);
  console.log(`Migrated ${oldPathRelToFeatures} -> ${path.join(feature, newPathRelToFeature)}`);
});
