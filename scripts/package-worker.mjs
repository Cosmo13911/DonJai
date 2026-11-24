import {readdir,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
const root=process.cwd(),out=path.join(root,'out');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.ico':'image/x-icon'};
const assets={};
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else{const rel='/'+path.relative(out,file).split(path.sep).join('/');assets[rel]={mime:types[path.extname(file)]||'application/octet-stream',data:(await readFile(file)).toString('base64')};}}}
await walk(out);
if(!assets['/index.html'])throw Error('Next export missing index.html');
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['worker/index.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,plugins:[{name:'embedded-next-export',setup(b){b.onResolve({filter:/^\.\/assets$/},()=>({path:'donjai-static-assets',namespace:'embedded'}));b.onLoad({filter:/.*/,namespace:'embedded'},()=>({contents:'export const assets='+JSON.stringify(assets)+';',loader:'js'}));}}]});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Packaged Next.js frontend + server API. Static assets:',Object.keys(assets).length);
