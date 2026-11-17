/** Clean model-supplied lookup text without guessing which game item it means. */
export function cleanLookupText(text: string): string {
    return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ').trim();
}
