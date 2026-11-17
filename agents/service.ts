// User LaunchAgent management; secrets stay in the repository's .env.
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { controllerStale, processAlive, readJson, type ControllerHealth } from './runtime-health';

const root = realpathSync(resolve(import.meta.dir, '..'));
const label = 'com.trb.runscape-rascals';
const domain = `gui/${process.getuid!()}`;
const target = `${domain}/${label}`;
const file = join(process.env.HOME!, 'Library/LaunchAgents', `${label}.plist`);
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function launchctl(...args: string[]) {
    return Bun.spawnSync(['/bin/launchctl', ...args], { stdout: 'pipe', stderr: 'pipe' });
}
const loaded = () => launchctl('print', target).exitCode === 0;
export function servicePlist(repository: string, bun: string, path: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(bun)}</string><string>${xml(join(repository, 'agents/supervisor.ts'))}</string></array>
<key>WorkingDirectory</key><string>${xml(repository)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>360</integer>
<key>StandardOutPath</key><string>${xml(join(repository, 'agents/runs/service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(repository, 'agents/runs/service.log'))}</string>
</dict></plist>\n`;
}
function main() {
    if (process.platform !== 'darwin') throw new Error('This service command uses macOS launchd; run agents/run.sh with a system supervisor elsewhere');
    const command = process.argv[2] ?? 'status';
    if (command === 'install' || command === 'start') {
        mkdirSync(dirname(file), { recursive: true }); mkdirSync(join(root, 'agents/runs'), { recursive: true });
        if (!loaded()) {
            writeFileSync(file, servicePlist(root, process.execPath, `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`));
            const result = launchctl('bootstrap', domain, file);
            if (result.exitCode) throw new Error(result.stderr.toString());
        }
        console.log(`Service installed and running: ${label}`);
    } else if (command === 'stop') {
        if (loaded()) {
            const result = launchctl('bootout', target);
            if (result.exitCode) throw new Error(result.stderr.toString());
        }
        console.log('Service stopped; allow up to 360 seconds for graceful shutdown, recovery and saves');
    } else if (command === 'status') {
        const supervisor = readJson<{ pid: number; at: number; phase: string }>(join(root, 'agents/state/supervisor-heartbeat.json'));
        const controller = readJson<ControllerHealth>(join(root, 'agents/state/controller-heartbeat.json'));
        console.log(JSON.stringify({ loaded: loaded(), supervisor: supervisor && { ...supervisor, alive: processAlive(supervisor.pid), ageSeconds: Math.round((Date.now()-supervisor.at)/1000) },
            controller: controller && { pid: controller.pid, phase: controller.phase, alive: processAlive(controller.pid),
                ageSeconds: Math.round((Date.now()-controller.at)/1000), stale: controllerStale(controller, controller.pid, controller.startedAt), run: controller.run } }, null, 2));
    } else throw new Error('Usage: bun agents/service.ts install|start|stop|status');
}
if (import.meta.main) { try { main(); } catch (error) { console.error(String(error)); process.exitCode = 1; } }
