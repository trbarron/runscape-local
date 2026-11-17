// Builds a copy of the game client with the portrait hook added, into agents/portraits/.build/.
// The rs-sdk checkout is left untouched and the live clients keep the bundle the server gives them.
//
//   bun agents/portraits/build.ts
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, appendFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const WEBCLIENT = join(import.meta.dir, '..', '..', 'rs-sdk', 'server', 'webclient');
export const BUILD = join(import.meta.dir, '.build');
export const BUNDLE = join(BUILD, 'out', 'Client.js');

export async function build(): Promise<void> {
    rmSync(BUILD, { recursive: true, force: true });
    mkdirSync(BUILD, { recursive: true });
    cpSync(join(WEBCLIENT, 'src'), join(BUILD, 'src'), { recursive: true });
    for (const f of ['tsconfig.json', 'package.json']) copyFileSync(join(WEBCLIENT, f), join(BUILD, f));
    symlinkSync(join(WEBCLIENT, 'node_modules'), join(BUILD, 'node_modules'));
    copyFileSync(join(import.meta.dir, 'hook.ts'), join(BUILD, 'src', 'portrait.ts'));
    appendFileSync(join(BUILD, 'src', 'client', 'Client.ts'), "\nimport '#/portrait.js';\n");

    // The same defines as the webclient's own bundle.ts uses for the bot client.
    const key = { n: '7162900525229798032761816791230527296329313291232324290237849263501208207972894053929065636522363163621000728841182238772712427862772219676577293600221789', e: '58778699976184461502525193738213253649000149147835990136706041084440742975821' };
    const result = await Bun.build({
        entrypoints: [join(BUILD, 'src', 'client', 'Client.ts')],
        outdir: join(BUILD, 'out'),
        define: {
            'process.env.SECURE_ORIGIN': '"false"',
            'process.env.LOGIN_RSAE': JSON.stringify(process.env.LOGIN_RSAE ?? key.e),
            'process.env.LOGIN_RSAN': JSON.stringify(process.env.LOGIN_RSAN ?? key.n),
            'process.env.BUILD_TIME': '"portraits"',
            'process.env.ENABLE_BOT_SDK': '"true"'
        }
    });
    if (!result.success) throw new Error(result.logs.map(String).join('\n'));
}

if (import.meta.main) {
    await build();
    console.log(`built ${existsSync(BUNDLE) ? BUNDLE : '(missing!)'}`);
}
