/** Canvas capture and same-cycle recovery, independent of dashboard timers and Redis. */
const timeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('screenshot capture timed out')), ms); })]); }
    finally { clearTimeout(timer!); }
};
export async function captureGameShot(name: string, pages: Map<string, any>, browser: any): Promise<Buffer> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const page = pages.get(name);
            if (!page || page.isClosed?.()) throw new Error('screenshot page closed');
            const dataUrl: string = await timeout(page.evaluate(() => {
                const canvas = (window as any).gameCanvas || document.querySelector('canvas');
                if (!canvas || canvas.width === 0 || canvas.height === 0) throw new Error('no game canvas ready');
                return canvas.toDataURL('image/jpeg', 0.75);
            }), 10_000);
            if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('game canvas did not return JPEG data');
            const jpeg = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
            if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) throw new Error('game canvas returned invalid JPEG bytes');
            return jpeg;
        } catch (error) {
            if (attempt) throw error;
            const candidates = await timeout<any[]>(browser.pages(), 10_000);
            let replacement: any;
            for (const page of candidates.reverse()) {
                let matches = false;
                try { matches = new URL(page.url()).searchParams.get('bot') === name; } catch { /* non-game tab */ }
                if (!matches || page.isClosed?.() || page === pages.get(name)) continue;
                try { if (await timeout(page.evaluate(() => !!((window as any).gameCanvas || document.querySelector('canvas'))), 2000)) { replacement = page; break; } } catch { /* try the next candidate */ }
            }
            if (!replacement) throw error;
            pages.set(name, replacement);
        }
    }
    throw new Error('screenshot capture failed');
}

/** A capture can be visible locally while remote publication fails. Never mislabel the remote image. */
export async function storeGameShot(jpeg: Buffer, at: number, sinks: {
    local: (jpeg: Buffer, at: number) => void;
    publish: (jpeg: Buffer) => Promise<boolean>;
    published: (at: number) => void;
}): Promise<void> {
    sinks.local(jpeg, at);
    if (await sinks.publish(jpeg)) sinks.published(at);
}
