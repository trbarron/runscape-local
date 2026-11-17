import { expect, test } from 'bun:test';
import { cleanLookupText } from './lookup-text';
import { shopSelling } from './shops';

test('cleans invisible formatting, compatibility letters and whitespace', () => {
    expect(cleanLookupText(' \ufeffＳｔｕｄ\u00added\u200b\u00a0\t body ')).toBe('Studded body');
    expect(cleanLookupText('raw\nshrimps')).toBe('raw shrimps');
    expect(cleanLookupText('Iron platelegs')).toBe('Iron platelegs');
});

test('the observed studded-body purchase finds the real shop', () => {
    const sale = shopSelling('stud\u00added body');
    expect(sale?.item.name).toBe('Studded body');
    expect(sale?.shop.name).toBe("Horvik's Armour Shop");
    expect(shopSelling('runite platelegs')).toBeNull();
    expect(shopSelling('steel body')?.item.name).not.toBe('Studded body');
});
