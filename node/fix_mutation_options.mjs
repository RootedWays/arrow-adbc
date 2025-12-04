import fs from 'node:fs';
import { glob } from 'glob';

// Helper shim definition (TypeScript generic compatible)
// We assume UseMutationOptions is already imported in the file (Kubb usually does this)
const shim = `
// Shim for mutationOptions which is missing in v5
const mutationOptions = <TData = unknown, TError = unknown, TVariables = unknown, TContext = unknown>(options: UseMutationOptions<TData, TError, TVariables, TContext>) => options;
`;

// Find all generated hook files
const files = glob.sync("web-demo/src/api/hooks/**/*.ts");

let patchedCount = 0;

files.forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf-8');

    // Only process files that use mutationOptions
    if (!content.includes('mutationOptions')) {
        return;
    }

    // Skip if already patched (look for the unique shim comment)
    if (content.includes('// Shim for mutationOptions')) {
        // If it's the old shim (without generics), we should replace it
        if (content.includes('const mutationOptions = (options) => options;')) {
             console.log(`Repatching ${filePath} with TS-compatible shim`);
             const lines = content.split('\n');
             const newLines = lines.map(line => {
                 if (line.trim() === 'const mutationOptions = (options) => options;') {
                     return `const mutationOptions = <TData = unknown, TError = unknown, TVariables = unknown, TContext = unknown>(options: UseMutationOptions<TData, TError, TVariables, TContext>) => options;`;
                 }
                 return line;
             });
             fs.writeFileSync(filePath, newLines.join('\n'));
             patchedCount++;
             return;
        }
        console.log(`Skipping ${filePath} (already patched)`);
        return;
    }

    let importModified = false;
    const lines = content.split('\n');
    const newLines = [];

    lines.forEach(line => {
        // Check for the import line from @tanstack/react-query
        if (line.includes('@tanstack/react-query') && line.includes('import') && line.includes('mutationOptions')) {
            
            // Remove 'mutationOptions' from the import
            let newLine = line.replace('mutationOptions,', '').replace(', mutationOptions', '').replace('mutationOptions', '');
            
            // cleanup potential double spaces
            newLine = newLine.replace('  ', ' '); 

            newLines.push(newLine);
            
            // Inject the shim right after the import
            newLines.push(shim);
            importModified = true;
        } else {
            newLines.push(line);
        }
    });

    if (importModified) {
        fs.writeFileSync(filePath, newLines.join('\n'));
        console.log(`Patched ${filePath}`);
        patchedCount++;
    }
});

console.log(`\nTotal files patched/repatched: ${patchedCount}`);