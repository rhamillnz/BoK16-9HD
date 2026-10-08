import * as fs from 'fs';
let main = fs.readFileSync('src/game/main.ts', 'utf8');

const splashLogic = `
const splash = document.getElementById('splash')!;
const splashMsg = document.getElementById('splash-message')!;
const splashErr = document.getElementById('splash-error')!;

function setSplash(msg: string) {
  if (splash.style.display !== 'none') splashMsg.textContent = msg;
}
function crash(err: any) {
  if (splash) splash.style.display = 'flex';
  if (splashErr) {
    splashErr.style.display = 'block';
    splashErr.textContent = String(err instanceof Error ? err.message : err);
  }
  if (splashMsg) splashMsg.style.display = 'none';
  throw err;
}

try {
  setSplash('Initializing renderer...');
`;

main = main.replace(
  'const { renderer, camera, backend, scene, sky, post, applyGraphics, tickPerf } = await setupGraphics(stageEl);',
  splashLogic + '\n  const { renderer, camera, backend, scene, sky, post, applyGraphics, tickPerf } = await setupGraphics(stageEl);\n\n  if (backend === \'WebGL2\') {\n    console.warn(\'WebGPU not available, falling back to WebGL2\');\n  }'
);

main = main + '\n} catch (err) {\n  crash(err);\n}\n';

main = main.replace('hud.textContent = \'Loading game data.\';', 'setSplash(\'Loading game data...\');');
main = main.replace(
  "if (!rmf.ok || !data.ok) throw new Error('Game data not found: set BAK_DIR to your Betrayal at Krondor install');",
  "if (!rmf.ok || !data.ok) throw new Error('Game data not found: Please ensure KRONDOR.RMF and KRONDOR.001 are present in the bak directory.');"
);

main = main.replace(
  'let last = performance.now();',
  `splash.style.display = 'none';\n  if (backend === 'WebGL2') {\n    const toast = document.getElementById('toast')!;\n    toast.textContent = 'WebGPU not available, falling back to WebGL2';\n    toast.style.opacity = '1';\n    setTimeout(() => toast.style.opacity = '0', 4000);\n  }\n\n  let last = performance.now();`
);

main = main.replace(
  'const next = await zoneHost.switchTo(plan.zone);',
  `splash.style.display = 'flex';\n        setSplash(\`Loading Zone \${plan.zone}...\`);\n        // Wait a frame so the UI updates\n        await new Promise(r => setTimeout(r, 10));\n        const next = await zoneHost.switchTo(plan.zone);\n        splash.style.display = 'none';`
);

fs.writeFileSync('src/game/main.ts', main);
console.log('Modified main.ts');
